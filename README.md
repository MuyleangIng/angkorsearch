# 🇰🇭 AngkorSearch v2

> Cambodia's open-source search engine — built to index, search, and surface **Khmer & English** content from across the web.

**Made with ♥ by [Ing Muyleang](https://muyleanging.com) · [KhmerStack](https://khmerstack.muyleanging.com)**

---

## What is AngkorSearch?

AngkorSearch is a fully self-hosted, open-source search engine built from scratch for Cambodia. It crawls Cambodian and Khmer-language websites, indexes the content using PostgreSQL full-text search, and serves fast results through a C++ REST API — with a modern Next.js frontend styled like a real search engine.

No external search APIs. No Google. No Bing. 100% self-hosted.

---

## Features

- **Full-text search** — Khmer + English, ranked by relevance
- **Multiple tabs** — All, News, Images, Videos, Dev & Tech, Saved, History
- **AI Answer overview** — powered by local Ollama LLM (no cloud)
- **Knowledge Panel** — right-side info card for top results, Wikipedia thumbnail auto-fetch
- **Dark / Light mode** — persisted via localStorage, CSS variable theming
- **Autocomplete suggestions** — as you type
- **Bookmarks & Search History** — saved per user
- **Admin Dashboard** — seed domains, crawl queue, system monitoring, top searches
- **Multi-worker crawler** — 4 concurrent C++ crawler processes
- **Priority crawling** — Force P1 / High / Normal / Low preset priorities
- **Responsive UI** — works on mobile, tablet, and desktop
- **People Also Ask** widget
- **Discover Feed** — recent crawled pages on the homepage

---

## Architecture

```
Browser
  └── nginx (port 80)
        ├── /api/*  → C++ API server   (port 8080)
        └── /*      → Next.js frontend (port 3000)

PostgreSQL (port 5432)   pages, crawl_queue, users, bookmarks, history, seeds
Redis      (port 6379)   search result cache, crawl queue signaling
Ollama     (port 11434)  local LLM for AI answer generation
C++ Crawlers × 4         parallel web crawlers, priority queue
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, Framer Motion |
| API Server | C++20, libpqxx, hiredis, cpp-httplib, nlohmann/json |
| Crawler | C++20, libcurl, libpq, hiredis |
| Database | PostgreSQL 16 with `pg_trgm`, `unaccent`, full-text search |
| Cache / Queue | Redis 7 |
| AI Answers | Ollama (local LLM — Llama 3 / Gemma / Mistral) |
| Proxy | nginx Alpine |
| Container | Docker + Docker Compose |

---

## Quick Start

### Requirements

- Docker Desktop (Mac/Windows) or Docker + Docker Compose v2 (Linux)
- 4 GB RAM minimum (8 GB recommended for Ollama)

### Run

```bash
# Clone
git clone https://github.com/MuyleangIng/angkorsearch
cd angkorsearch

# Start everything (builds all images)
docker compose up -d --build

# Open in browser
open http://localhost
```

First boot takes ~2–3 minutes for all services to become healthy. The crawler will start indexing seed domains automatically.

### Stop

```bash
# Stop services (keeps data)
docker compose down

# Stop and delete all data (database, redis)
docker compose down -v
```

---

## Docker Services

| Service | Description | Port |
|---------|-------------|------|
| `nginx` | Reverse proxy — routes traffic | 80 |
| `frontend` | Next.js 14 UI (standalone build) | 3000 |
| `api` | C++ REST API server | 8080 |
| `crawler_1–4` | 4 parallel C++ crawlers | — |
| `postgres` | PostgreSQL 16 database | 5432 |
| `redis` | Redis 7 cache + queue | 6379 |
| `ollama` | Local LLM inference | 11434 |

---

## API Endpoints

### Search & Discovery

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/search?q=angkor&type=web&page=1&lang=km` | Full-text search |
| `GET` | `/suggest?q=cambo` | Autocomplete suggestions |
| `GET` | `/ai/answer?q=what+is+angkor+wat` | AI-generated answer |
| `GET` | `/live?since=10` | Recently crawled pages |
| `GET` | `/stats` | Index statistics |
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
| `GET` | `/admin/system` | System resource metrics |

---

## Admin Dashboard

Access at **http://localhost/admin**

| Tab | Features |
|-----|---------|
| **Overview** | Index stats (pages, images, videos, news, dev), top domains, content breakdown, crawl progress, recently crawled table |
| **Seed Domains** | Add/remove seed URLs, set priority (Force/High/Normal/Low), block/allow toggle, inline priority editing, page count per domain |
| **Crawl Queue** | Force-add any URL at Priority 1, domain progress bars, queue stats |
| **System** | RAM, Disk, Redis memory gauges, pages/hour, API uptime, DB table sizes — auto-refreshes every 8 seconds |
| **Searches** | Top search queries bar chart |

---

## Project Structure

```
angkorsearch/
├── docker-compose.yml          orchestrates all services
│
├── angkorsearch-web/           Next.js 14 frontend (TypeScript)
│   ├── app/
│   │   ├── page.tsx            Homepage with search + discover feed
│   │   ├── search/page.tsx     Search results + Knowledge Panel
│   │   ├── admin/page.tsx      Admin dashboard (5 tabs)
│   │   └── about/page.tsx      About page + contributors
│   ├── components/
│   │   ├── layout/             Header, Footer, Sidebar
│   │   ├── search/             SearchBox, SearchTabs, SearchResults, Pagination
│   │   ├── results/            WebResult, NewsResult, ImageResult, VideoResult, GithubResult
│   │   ├── widgets/            AIOverview, KnowledgePanel, TopResult, PeopleAlsoAsk, StatsBar, DiscoverFeed
│   │   └── ui/                 Skeleton, Badge, ThemeToggle
│   ├── hooks/                  useSearch, useSuggest, useBookmark
│   ├── lib/                    api.ts, constants.ts, utils.ts, theme.tsx
│   └── Dockerfile              Multi-stage Node 20 Alpine → standalone output
│
├── api/
│   ├── api_server.cpp          C++ HTTP API (libpqxx + hiredis + cpp-httplib)
│   └── Dockerfile
│
├── crawler/
│   ├── crawler.cpp             C++ multi-worker web crawler (libcurl + libpq)
│   └── Dockerfile
│
├── postgres/
│   └── init.sql                Database schema + indexes + views
│
├── nginx/
│   └── nginx.conf              Reverse proxy config
│
└── data/
    └── dict/
        └── khmer_dict.txt      Khmer word segmentation dictionary
```

---

## Database Schema (key tables)

```sql
pages          -- indexed web pages (url, title, description, content, type, lang, score)
crawl_queue    -- URLs to crawl (url, type, priority, crawled)
seeds          -- seed domains (url, domain, type, priority, active)
users          -- user accounts
bookmarks      -- saved pages per user
search_history -- search queries per user
```

Useful queries:

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U angkor -d angkorsearch
```

```sql
-- Pages indexed
SELECT COUNT(*) FROM pages;

-- By content type
SELECT type, COUNT(*) FROM pages GROUP BY type ORDER BY COUNT(*) DESC;

-- Crawl status by domain
SELECT * FROM v_crawl_status;

-- Top searches
SELECT query, count FROM search_history GROUP BY query ORDER BY count DESC LIMIT 20;

-- Queue status
SELECT COUNT(*) FILTER (WHERE NOT crawled) AS pending,
       COUNT(*) FILTER (WHERE crawled)     AS done
FROM crawl_queue;
```

---

## Adding Seed Domains

Via the Admin UI at `/admin` → **Seed Domains** tab, or via API:

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
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` | API URL for the frontend |
| `OLLAMA_MODEL` | `llama3` | Ollama model for AI answers |

---

## Scale Up

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

# Set your domain in nginx/nginx.conf
# Then start
docker compose up -d --build
```

For HTTPS, add Certbot + nginx SSL config, or put Cloudflare in front.

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
  <strong>🇰🇭 Built for Cambodia · by Cambodians</strong><br/>
  <a href="https://muyleanging.com">muyleanging.com</a> ·
  <a href="https://khmerstack.muyleanging.com">KhmerStack</a>
</div>
