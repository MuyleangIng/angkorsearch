# AngkorSearch v2.3

> Cambodia's open-source search engine — built to index, search, and surface **Khmer & English** content from across the web.

**Made with love by [Ing Muyleang](https://muyleanging.com) · [KhmerStack](https://khmerstack.muyleanging.com)**

---

## What is AngkorSearch?

AngkorSearch is a fully self-hosted, open-source search engine built from scratch for Cambodia. It crawls websites across the entire web (with priority on Cambodian and Khmer-language sites), indexes content using PostgreSQL full-text search + trigram fuzzy matching, and serves results through a C++ REST API — with a modern Next.js frontend.

No external search APIs. No Google. No Bing. 100% self-hosted.

---

## Features

- **9-strategy fuzzy search** — FTS + trigram + URL + prefix/suffix + per-word + description + domain matching
- **Google-style sitelinks** — top result shows sub-page links from the same domain
- **Auto Web Discovery** — when no results found, auto-discovers related URLs (GitHub, personal sites, npm, LinkedIn, Twitter/X, Substack) and crawls them live
- **Direct Force Crawl** — instantly fetch and index any URL; automatically saves og:image, twitter:image, and GitHub profile avatars to the images table
- **Multiple content tabs** — All, News, Images, Videos, Dev & Tech, AI Tools, Saved, History
- **Full-width media grid** — masonry image grid (2–6 columns), video grid (1–4 columns) with platform filter pills
- **Image side panel** — click any image to open a fixed right panel with preview, details, prev/next navigation (arrow keys + ESC), full-size / source / copy-URL actions
- **Right-click image context menu** — View details, Open full size, Open source page, Copy URL
- **Video platform badges** — per-result color badge (YouTube, TikTok, Twitter, Vimeo, etc.) with platform filter pills
- **YouTube thumbnails** — auto-constructed from video ID (`maxresdefault.jpg`)
- **oEmbed thumbnails** — TikTok, Twitter, Spotify thumbnails fetched via official oEmbed APIs
- **Social links extraction** — crawler saves Facebook, YouTube, TikTok, Telegram, Twitter, Instagram, LinkedIn links found on pages; exposed via `GET /social?domain=`
- **AI Answer overview** — powered by local Ollama LLM (no cloud, no API keys)
- **AI Tools tab** — quick-launch grid for Claude, ChatGPT, Perplexity, Gemini, HuggingFace, Ollama, arXiv, Discord
- **Knowledge Panel** — right-side info card for top results
- **Data Manager** (Admin) — storage overview (DB size, Redis, disk free), per-table size bars, delete all pages for a domain by name
- **Dark / Light mode** — persisted via localStorage
- **Autocomplete suggestions** — as you type
- **Bookmarks & Search History** — saved per user
- **Admin Dashboard** — seed domains, crawl queue, system monitoring, top searches, data management
- **Multi-worker crawler** — 4 concurrent C++ crawlers, up to 100,000 pages each
- **Smart content cap** — Cambodian/news/shallow pages get 80 KB of content indexed; all other pages get 500 chars summary-only to save DB space
- **Fast search** — no ILIKE on large content column (FTS GIN index covers it); Redis cache TTL 300s
- **Open-domain crawling** — crawls any public website (blocks walled gardens: Facebook, Instagram, TikTok, Twitter)
- **Responsive UI** — works on mobile, tablet, and desktop

---

## Architecture

### High-Level Overview

```
                        ┌──────────────────────────────────────────┐
                        │              User's Browser               │
                        └──────────────────┬───────────────────────┘
                                           │ HTTP :80
                        ┌──────────────────▼───────────────────────┐
                        │                nginx                      │
                        │          Reverse Proxy :80                │
                        └──────┬──────────────┬──────────────┬─────┘
                               │              │              │
              /auth/* /admin/  │   /api/*     │     /*       │
              (users,roles...) │  C++ API     │  Next.js     │
                               │              │  Frontend    │
                 ┌─────────────▼──┐  ┌────────▼──┐  ┌───────▼──────┐
                 │  auth service  │  │ C++ API   │  │  Next.js 14  │
                 │  Go :8081      │  │ :8080     │  │  :3000       │
                 └────────────────┘  └─────┬─────┘  └──────┬───────┘
                                           │               │
                              ┌────────────┼───────────────┘
                              │            │
               ┌──────────────▼──┐  ┌──────▼───────────────┐
               │   PostgreSQL 16  │  │      Redis 7          │
               │   :5432          │  │      :6379            │
               │                  │  │                       │
               │  pages           │  │  visited URL set      │
               │  crawl_queue     │  │  search result cache  │
               │  seeds           │  │  (TTL 300s)           │
               │  users           │  │  domain cooldown      │
               │  bookmarks       │  └───────────────────────┘
               │  search_history  │
               │  images          │         ┌────────────────┐
               │  videos          │         │   Ollama LLM   │
               │  news            │         │   :11434       │
               │  github_repos    │         │   qwen2.5:3b   │
               │  social_links    │         └────────────────┘
               │  crawler_live    │
               └──────────────────┘

               ┌───────────────────────────────────────────────┐
               │              C++ Crawlers × 4                 │
               │  crawler_1  crawler_2  crawler_3  crawler_4   │
               │                                               │
               │  1. Pull URL from crawl_queue (priority ASC)  │
               │  2. Fetch with libcurl (12s timeout)          │
               │  3. Parse HTML (Gumbo parser)                 │
               │     · title, meta description, body text      │
               │     · og:image, twitter:image (social meta)   │
               │     · srcset / data-lazy-src images           │
               │     · social link hrefs (FB/YT/TG/IG/TW/LI)  │
               │     · YouTube embed → thumbnail URL           │
               │     · TikTok/Twitter oEmbed thumbnails        │
               │  4. Smart content cap:                        │
               │     · Cambodian / news / depth≤2 → 80 KB     │
               │     · Everything else → 500 chars (summary)  │
               │  5. Save to pages table (PostgreSQL FTS)      │
               │  6. Save images/videos/social_links tables    │
               │  7. Enqueue outbound links                    │
               │  8. Track visited URLs in Redis SET           │
               └───────────────────────────────────────────────┘
```

### Data Flow: Search Request

```
User types query
      │
      ▼
Next.js frontend
  useSearch hook → GET /api/search?q=muyleang
      │
      ▼
nginx → C++ API :8080  /search endpoint
      │
      ▼
  Query Expansion (9 strategies)
  ┌─────────────────────────────────────────────────────────┐
  │  1. FTS  — tsvector @@ plainto_tsquery('simple', q)     │
  │  2. Trigram — title % q  (pg_trgm fuzzy match)          │
  │  3. URL — url ILIKE '%q%'                               │
  │  4. Title exact — title ILIKE '%q%'                     │
  │  5. Title prefix — title ILIKE '%first65%'              │
  │  6. Title suffix — title ILIKE '%last60%'               │
  │  7. Per-word — title ILIKE '%word2%'                    │
  │  8. Description — description ILIKE '%q%'               │
  │  9. Domain — domain ILIKE '%q%'                         │
  └─────────────────────────────────────────────────────────┘
      │
      ▼
  Ranking Score = FTS*3.0 + URL_match*1.5 + trigram*1.2
                + title_match*0.8 + description*0.2
      │
      ▼
  Check Redis cache → return if hit
      │
      ▼
JSON response → Next.js → SearchResults component
      │
      ▼ (if 0 results)
WebDiscovery component (SSE)
  → /api/auto-discover?q=muyleang
  → guesses URLs: github.com/muyleang, muyleang.com,
                  muyleang.github.io, muyleang.dev, ...
  → calls /admin/crawl-now for each candidate
  → streams live terminal output to user
  → auto-refreshes search when pages found
```

### Data Flow: Force Crawl (Admin)

```
Admin enters URL in dashboard
      │
      ▼
POST /api/crawl-stream?url=https://example.com
      │
      ▼
nginx → Next.js API route (SSE stream)
  → POST /admin/crawl-now  (C++ API)
        │
        ├── fetch URL with libcurl (timeout 12s)
        ├── parse HTML: title, meta description, body text
        ├── detect language (Khmer Unicode range U+1780–U+17FF)
        ├── INSERT INTO pages ... ON CONFLICT DO UPDATE
        ├── mark crawled in crawl_queue
        └── SADD visited in Redis
      │
      ▼
SSE stream → shows progress live in admin UI
  → "Fetching page content..."
  → "Indexed: <title> (N words)"
```

### Mermaid Architecture Diagram

```mermaid
graph TB
    Browser["Browser"] --> Nginx["nginx :80\nReverse Proxy"]

    Nginx -->|"/auth/* /admin/users..."| Auth["auth service\nGo :8081"]
    Nginx -->|"/api/*"| API["C++ API Server\n:8080"]
    Nginx -->|"/api/crawl-stream\n/api/auto-discover"| Frontend["Next.js 14\n:3000"]
    Nginx -->|"/*"| Frontend

    API --> PG[("PostgreSQL 16\n:5432")]
    API --> Redis[("Redis 7\n:6379")]
    API --> Ollama["Ollama LLM\n:11434\nqwen2.5:3b"]

    Frontend --> API

    Crawlers["C++ Crawlers × 4"] --> PG
    Crawlers --> Redis

    subgraph Search Algorithm
        FTS["1. FTS tsvector"]
        Trigram["2. pg_trgm fuzzy"]
        URLMatch["3. URL ILIKE"]
        TitleExact["4. Title exact"]
        TitlePrefix["5. Title prefix"]
        TitleSuffix["6. Title suffix"]
        PerWord["7. Per-word"]
        DescMatch["8. Description"]
        DomainMatch["9. Domain"]
    end

    API --> FTS
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, Framer Motion |
| API Server | C++20, libpq, hiredis, libcurl, nlohmann/json |
| Crawler | C++20, libcurl, Gumbo HTML parser, libpq, hiredis |
| Database | PostgreSQL 16 with `pg_trgm`, `unaccent`, full-text search |
| Cache / Queue | Redis 7 |
| AI Answers | Ollama (local LLM — qwen2.5:3b by default) |
| Auth | Go service with JWT + session cookies |
| Proxy | nginx Alpine |
| Container | Docker + Docker Compose |

---

## Quick Start

### Requirements

- Docker Desktop (Mac/Windows) or Docker + Docker Compose v2 (Linux)
- 4 GB RAM minimum (8 GB recommended for Ollama LLM)

### Run

```bash
# Clone
git clone https://github.com/MuyleangIng/angkorsearch
cd angkorsearch

# Start everything (builds all images, ~3-5 min first time)
docker compose up -d --build

# Open in browser
open http://localhost
```

First boot takes 2–3 minutes. The crawler starts indexing seed domains automatically.

### Stop

```bash
# Stop services (keeps data)
docker compose down

# Stop and wipe all data (fresh start)
docker compose down -v
```

---

## Docker Services

| Service | Description | Port |
|---------|-------------|------|
| `nginx` | Reverse proxy — routes all traffic | 80 |
| `frontend` | Next.js 14 UI (standalone build) | 3000 |
| `api` | C++ REST API server | 8080 |
| `auth` | Go authentication service | 8081 |
| `crawler_1–4` | 4 parallel C++ web crawlers | — |
| `postgres` | PostgreSQL 16 database | 5432 |
| `redis` | Redis 7 cache + queue | 6379 |
| `ollama` | Local LLM inference server | 11434 |
| `ollama-init` | One-shot model downloader | — |

---

## API Endpoints

### Search & Discovery

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/search?q=angkor&type=web&page=1&lang=km` | Full-text + fuzzy search |
| `GET` | `/suggest?q=cambo` | Autocomplete suggestions |
| `GET` | `/ai/answer?q=what+is+angkor+wat` | AI-generated answer (Ollama) |
| `GET` | `/live?since=10` | Recently crawled pages |
| `GET` | `/stats` | Index statistics |
| `GET` | `/sitelinks?domain=example.com&exclude=https://example.com` | Sub-page links for Google-style sitelinks |
| `GET` | `/social?domain=example.com` | Social media links extracted from a domain |
| `GET` | `/health` | Health check |

**Search types:** `web`, `news`, `image`, `video`, `github`
**Lang filter:** `km` (Khmer), `en` (English), or omit for all

### Bookmarks & History

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/bookmark` | Save a bookmark |
| `GET` | `/bookmarks?user_id=1` | Get saved bookmarks |
| `GET` | `/history?user_id=1` | Get search history |
| `DELETE` | `/history?user_id=1` | Clear search history |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/stats` | Full index + crawl statistics |
| `GET` | `/admin/seeds` | List seed domains |
| `POST` | `/admin/seeds` | Add new seed domain |
| `PATCH` | `/admin/seeds` | Update seed priority or status |
| `DELETE` | `/admin/seeds?id=1` | Delete a seed |
| `POST` | `/admin/queue` | Force-add URL to crawl queue (P1) |
| `POST` | `/admin/crawl-now` | Directly fetch + index a URL; saves og:image + GitHub avatar |
| `DELETE` | `/admin/domain?domain=example.com` | Delete all pages/images/videos/news/social_links for a domain |
| `GET` | `/admin/system` | System resource metrics |

### Next.js API Routes (SSE)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/crawl-stream?url=...` | Force-crawl a URL, stream progress via SSE |
| `GET` | `/api/auto-discover?q=...` | Auto-discover related URLs for a query, stream results via SSE |

---

## Search Algorithm

AngkorSearch uses 9 parallel strategies to find results, then combines them with a ranking score:

```
Score = FTS_rank × 3.0          (full-text search — most important)
      + URL_match × 1.5          (query appears in URL)
      + trigram_similarity × 1.2 (fuzzy match via pg_trgm)
      + title_match × 0.8        (query in title)
      + description_match × 0.2  (query in description)
```

**Example — searching "muyleang":**

| Strategy | Match example |
|----------|--------------|
| FTS | documents with "muyleang" in indexed tsvector |
| Trigram | "muyleanging.com" has ~33% trigram overlap with "muyleang" |
| URL ILIKE | `url LIKE '%muyleang%'` — catches muyleanging.com, github.com/muyleanging |
| Title prefix | searches `%muylea%` (65% of first word) |
| Title suffix | searches `%eang%` (last 60%) |
| Per-word | if multi-word query, searches each word separately |
| Description | `description LIKE '%muyleang%'` |
| Domain | `domain LIKE '%muyleang%'` |

This means a search for "leang" can still find "muyleanging.com" because the URL contains "leang".

---

## Auto Web Discovery

When a search returns 0 results, the WebDiscovery component activates automatically:

1. Sends the query to `/api/auto-discover?q=...`
2. Generates candidate URLs from the query words (ordered by likelihood):
   - `github.com/{slug}` + `{slug}.github.io` — GitHub profile / pages
   - `gitlab.com/{slug}` — GitLab profile
   - `{slug}.com`, `{slug}.io`, `{slug}.dev`, `{slug}.me`, … (20 TLDs) — personal/project sites
   - `{slug}.vercel.app`, `{slug}.netlify.app`, `{slug}.pages.dev` — hosted deployments
   - `dev.to/{slug}`, `medium.com/@{slug}`, `{slug}.hashnode.dev` — dev blogs
   - `npmjs.com/package/{slug}`, `pypi.org/user/{slug}` — package registries
   - `linkedin.com/in/{slug}` — LinkedIn profile
   - `twitter.com/{slug}`, `x.com/{slug}` — Twitter/X public profiles
   - `{slug}.substack.com` — Substack newsletter
   - `youtube.com/@{slug}` — YouTube channel
   - `huggingface.co/{slug}` — HuggingFace profile
3. Calls `/admin/crawl-now` for each candidate in parallel (8 at a time, 8s timeout each)
4. Streams live progress in a terminal-style UI
5. Auto-refreshes search results when new pages are indexed

**Note:** Facebook, Instagram, TikTok, and other walled gardens block all bots. Even Google does not index private social media content. Public Twitter/X profile pages can sometimes be crawled.

---

## Admin Dashboard

Access at **http://localhost/admin**

| Tab | Features |
|-----|---------|
| **Overview** | Index stats, top domains, content breakdown, crawl progress, recently crawled table |
| **Seed Domains** | Add/remove seeds, set priority, block/allow toggle |
| **Crawl Queue** | Force-add any URL at Priority 1, domain progress bars, queue stats |
| **System** | RAM, Disk, Redis memory gauges, pages/hour, API uptime, DB table sizes |
| **Searches** | Top search queries bar chart |
| **Data Manager** | DB + Redis + disk storage overview, per-table size bars, delete all data for a domain |

---

## Project Structure

```
angkorsearch/
├── docker-compose.yml              orchestrates all services
│
├── angkorsearch-web/               Next.js 14 frontend (TypeScript)
│   ├── app/
│   │   ├── page.tsx                Homepage — search + discover feed
│   │   ├── search/page.tsx         Search results + Knowledge Panel
│   │   ├── admin/page.tsx          Admin dashboard (5 tabs)
│   │   ├── about/page.tsx          About page + contributors
│   │   └── api/
│   │       ├── crawl-stream/       SSE: force-crawl any URL live
│   │       │   └── route.ts
│   │       └── auto-discover/      SSE: auto-discover + crawl related URLs
│   │           └── route.ts
│   ├── components/
│   │   ├── layout/                 Header, Footer, Sidebar
│   │   ├── search/                 SearchBox, SearchTabs, SearchResults
│   │   │                           └── WebDiscovery (auto-discovery panel)
│   │   ├── results/                WebResult, NewsResult, ImageResult,
│   │   │                               VideoResult, GithubResult
│   │   └── widgets/                AIOverview, KnowledgePanel, TopResult,
│   │                                   PeopleAlsoAsk, StatsBar, DiscoverFeed
│   ├── hooks/                      useSearch, useSuggest, useBookmark
│   ├── lib/                        api.ts, constants.ts, utils.ts, theme.tsx
│   └── Dockerfile                  Multi-stage Node 20 Alpine -> standalone
│
├── api/
│   ├── api_server.cpp              C++ HTTP API server
│   │                               Endpoints: search, suggest, ai/answer,
│   │                               live, stats, bookmarks, history,
│   │                               admin/stats, admin/seeds, admin/queue,
│   │                               admin/crawl-now, admin/system
│   └── Dockerfile
│
├── crawler/
│   ├── crawler.cpp                 C++ multi-worker web crawler
│   │                               libcurl + Gumbo HTML parser + libpq
│   │                               Crawls all public domains (blocks walled gardens)
│   │                               Priority: Cambodian=3, GitHub=4, others=7
│   └── Dockerfile
│
├── auth/
│   └── ...                         Go auth service (JWT + sessions)
│
├── postgres/
│   └── init.sql                    Database schema + indexes + views
│                                   Tables: pages, crawl_queue, seeds, users,
│                                   bookmarks, search_history, images, videos,
│                                   news, github_repos, social_links,
│                                   crawler_live
│
├── nginx/
│   └── nginx.conf                  Reverse proxy config
│                                   SSE routes: /api/crawl-stream,
│                                   /api/auto-discover -> Next.js
│                                   /api/* -> C++ API
│                                   /auth/* -> Go auth
│
└── data/
    └── dict/
        └── khmer_dict.txt          Khmer word segmentation dictionary
```

---

## Database Schema

### Key Tables

```sql
-- Indexed web pages
pages (
    id          SERIAL PRIMARY KEY,
    url         TEXT UNIQUE,
    domain      TEXT,
    title       TEXT,
    description TEXT,
    content     TEXT,
    type        TEXT,   -- 'web' | 'news' | 'image' | 'video' | 'github'
    lang        TEXT,   -- 'km' | 'en'
    score       FLOAT,
    indexed_at  TIMESTAMP,
    tsv         TSVECTOR  -- FTS index
)

-- Crawl queue with priority
crawl_queue (
    id        SERIAL PRIMARY KEY,
    url       TEXT UNIQUE,
    domain    TEXT,
    priority  INT,   -- 1=force, 2=high, 5=normal, 10=low
    crawled   BOOLEAN DEFAULT FALSE,
    added_at  TIMESTAMP
)

-- Seed domains
seeds (
    id       SERIAL PRIMARY KEY,
    url      TEXT,
    domain   TEXT,
    type     TEXT,
    priority INT,
    active   BOOLEAN
)

-- Social media links extracted from crawled pages
social_links (
    id          SERIAL PRIMARY KEY,
    domain      TEXT,
    platform    TEXT,   -- 'facebook' | 'youtube' | 'tiktok' | 'telegram' | 'twitter' | 'instagram' | 'linkedin'
    url         TEXT,
    source_page TEXT,
    found_at    TIMESTAMP,
    UNIQUE(domain, platform, url)
)

-- Images indexed from crawled pages
images (
    id         SERIAL PRIMARY KEY,
    url        TEXT UNIQUE,
    src        TEXT,
    alt        TEXT,
    domain     TEXT,
    page_url   TEXT,
    width      INT,
    height     INT,
    indexed_at TIMESTAMP
)

-- Videos indexed from crawled pages
videos (
    id         SERIAL PRIMARY KEY,
    url        TEXT UNIQUE,
    title      TEXT,
    thumb_url  TEXT,
    domain     TEXT,
    channel    TEXT,
    page_url   TEXT,
    indexed_at TIMESTAMP
)
```

### Useful Queries

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U angkor -d angkorsearch
```

```sql
-- Total pages indexed
SELECT COUNT(*) FROM pages;

-- By content type
SELECT type, COUNT(*) FROM pages GROUP BY type ORDER BY COUNT(*) DESC;

-- Crawl status by domain
SELECT * FROM v_crawl_status;

-- Top searches
SELECT query, COUNT(*) FROM search_history GROUP BY query ORDER BY COUNT(*) DESC LIMIT 20;

-- Queue status
SELECT
  COUNT(*) FILTER (WHERE NOT crawled) AS pending,
  COUNT(*) FILTER (WHERE crawled)     AS done
FROM crawl_queue;

-- Search for a specific page
SELECT url, title, lang, score FROM pages WHERE url ILIKE '%muyleang%';
```

---

## Adding Seed Domains

Via Admin UI at `/admin` → **Seed Domains** tab, or via API:

```bash
curl -X POST http://localhost/api/admin/seeds \
  -d "url=https://phnompenhpost.com&type=news&priority=2"
```

Priority levels:
- `1` — Force (crawled immediately)
- `2` — High
- `5` — Normal (default)
- `10` — Low

---

## Environment Variables

Set in `docker-compose.yml` or a `.env` file:

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_DB` | `angkorsearch` | Database name |
| `POSTGRES_USER` | `angkor` | Database user |
| `POSTGRES_PASSWORD` | `angkor123` | Database password |
| `NEXT_PUBLIC_API_URL` | `http://localhost` | Public API URL |
| `API_INTERNAL_URL` | `http://api:8080` | Internal API URL (Next.js → C++ API) |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Ollama model for AI answers |
| `MAX_PAGES` | `100000` | Max pages per crawler worker |

---

## Scaling

Run more crawler workers:

```bash
docker compose up -d --scale crawler=8
```

Run multiple API instances behind nginx:

```bash
docker compose up -d --scale api=3
```

---

## Production Deployment

```bash
# On Ubuntu / Debian VPS
curl -fsSL https://get.docker.com | sh

git clone https://github.com/MuyleangIng/angkorsearch
cd angkorsearch

# Set your domain in nginx/nginx.conf:
# server_name yourdomain.com www.yourdomain.com;

docker compose up -d --build
```

For HTTPS, add Certbot + nginx SSL config, or put Cloudflare in front.

---

## Changelog

### v2.3 (2025)
- Google-style **sitelinks** on top search result (`/sitelinks` endpoint)
- **Social links** extraction — crawler detects and stores FB/YT/TT/TG/TW/IG/LI links (`social_links` table, `/social` endpoint)
- **YouTube thumbnails** auto-constructed from embed video IDs
- **oEmbed thumbnails** for TikTok, Twitter, Spotify via official APIs
- `crawlNow` now saves **og:image**, **twitter:image**, and **GitHub avatar** to `images` table
- **Full-width media layout** — masonry image grid, video grid with platform filter pills
- **Image side panel** with keyboard nav (arrows + ESC), context menu, copy/open actions
- **Video platform badges** (YouTube, TikTok, Vimeo, Twitter, etc.)
- **AI Tools tab** — quick-launch panel for popular AI services
- **Data Manager** admin tab — storage stats + delete-by-domain
- `DELETE /admin/domain` endpoint — wipes all rows for a domain across 6 tables
- Auto-discovery expanded: Twitter/X profiles, Substack newsletters
- **Smart content cap**: 80 KB for Cambodian/news/shallow pages, 500 chars for others
- **Search speed**: removed `content ILIKE` from WHERE (FTS covers it); Redis TTL 300s

### v2.2 (2024)
- FTS switched to `'simple'` dictionary + ILIKE fallback (fixed Khmer/short-word search)
- 4 parallel C++ crawler workers
- AI Answer via local Ollama (qwen2.5:3b)
- Admin dashboard with domain chart, type/lang breakdown, live feed
- Knowledge Panel, PeopleAlsoAsk, WebDiscovery SSE stream

### v2.0 (2024)
- Complete rewrite: C++ API + Next.js 14 frontend
- PostgreSQL FTS + pg_trgm 9-strategy search
- Docker Compose multi-service setup

---

## Contributors

| Avatar | Username | Role |
|--------|----------|------|
| [![MuyleangIng](https://avatars.githubusercontent.com/u/116934056?s=40)](https://github.com/MuyleangIng) | [MuyleangIng](https://github.com/MuyleangIng) | Creator & Lead Engineer |
| [![ingdavann](https://avatars.githubusercontent.com/u/112704849?s=40)](https://github.com/ingdavann) | [ingdavann](https://github.com/ingdavann) | Contributor |
| [![Jessiebrownleo](https://avatars.githubusercontent.com/u/154412765?s=40)](https://github.com/Jessiebrownleo) | [Jessiebrownleo](https://github.com/Jessiebrownleo) | Contributor |
| [![MengseuThoeng](https://avatars.githubusercontent.com/u/152089680?s=40)](https://github.com/MengseuThoeng) | [MengseuThoeng](https://github.com/MengseuThoeng) | Contributor |
| [![prox-dex](https://avatars.githubusercontent.com/u/225996771?s=40)](https://github.com/prox-dex) | [prox-dex](https://github.com/prox-dex) | Contributor |
| [![YithSopheaktra8](https://avatars.githubusercontent.com/u/102577536?s=40)](https://github.com/YithSopheaktra8) | [YithSopheaktra8](https://github.com/YithSopheaktra8) | Contributor |

Part of the **[KhmerStack](https://khmerstack.muyleanging.com)** organization — building modern tech for Cambodia.

---

## License

MIT License — free to use, modify, and deploy.

---

<div align="center">
  <strong>Built for Cambodia · by Cambodians</strong><br/>
  <a href="https://muyleanging.com">muyleanging.com</a> ·
  <a href="https://khmerstack.muyleanging.com">KhmerStack</a>
</div>
