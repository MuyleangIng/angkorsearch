# Contributing to AngkorSearch

Thank you for your interest in contributing to AngkorSearch — Cambodia's open-source search engine!

This guide covers how to set up your development environment, understand the codebase, and submit contributions.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Contributing to Each Service](#contributing-to-each-service)
  - [C++ API Server](#c-api-server)
  - [C++ Crawler](#c-crawler)
  - [Next.js Frontend](#nextjs-frontend)
  - [Database Schema](#database-schema)
  - [nginx Config](#nginx-config)
- [Code Style Guidelines](#code-style-guidelines)
- [How to Submit a PR](#how-to-submit-a-pr)
- [Good First Issues](#good-first-issues)

---

## Project Overview

AngkorSearch has 5 main services you can contribute to:

| Service | Language | Location | What it does |
|---------|----------|----------|--------------|
| API Server | C++20 | `api/api_server.cpp` | REST API — search, crawl-now, admin endpoints |
| Crawler | C++20 | `crawler/crawler.cpp` | Web crawler — fetch, parse, index pages |
| Frontend | TypeScript / Next.js 14 | `angkorsearch-web/` | Search UI, admin dashboard, SSE streams |
| Database | PostgreSQL SQL | `postgres/init.sql` | Schema, indexes, views |
| Proxy | nginx | `nginx/nginx.conf` | Routing, rate limiting, SSE config |

---

## Development Setup

### Requirements

- Docker Desktop (Mac/Windows) or Docker Engine + Compose v2 (Linux)
- Node.js 20+ (for frontend development without Docker)
- Git

### Step 1 — Clone the repository

```bash
git clone https://github.com/MuyleangIng/angkorsearch
cd angkorsearch
```

### Step 2 — Start all services

```bash
docker compose up -d --build
```

This builds all Docker images and starts every service. First run takes 3–5 minutes.

### Step 3 — Verify everything is running

```bash
# Check service health
docker compose ps

# Check API is alive
curl http://localhost/health

# Check logs for a service
docker compose logs api --tail=50 --follow
docker compose logs crawler_1 --tail=50 --follow
docker compose logs frontend --tail=50 --follow
```

Open http://localhost in your browser to see the frontend.

### Step 4 — Rebuild after making changes

```bash
# Rebuild a specific service
docker compose up -d --build api
docker compose up -d --build frontend
docker compose up -d --build crawler_1 crawler_2 crawler_3 crawler_4

# Or rebuild everything
docker compose up -d --build
```

### Full Reset (wipe all data)

```bash
docker compose down -v
docker compose up -d --build
```

---

## Project Structure

```
angkorsearch/
├── docker-compose.yml          Service definitions, env vars, volumes
│
├── angkorsearch-web/           Next.js 14 frontend
│   ├── app/                    App Router pages + API routes
│   │   └── api/
│   │       ├── crawl-stream/   SSE route: force-crawl a URL
│   │       └── auto-discover/  SSE route: auto-discover related URLs
│   ├── components/             React components
│   ├── hooks/                  Custom React hooks
│   └── lib/                    Shared utilities
│
├── api/
│   └── api_server.cpp          All C++ API code in one file
│
├── crawler/
│   └── crawler.cpp             All C++ crawler code in one file
│
├── postgres/
│   └── init.sql                Database schema (runs once on first boot)
│
├── nginx/
│   └── nginx.conf              Reverse proxy config
│
└── auth/                       Go authentication service
```

---

## Contributing to Each Service

### C++ API Server

**File:** `api/api_server.cpp`

The API server is a single C++ file. It uses raw POSIX sockets (no framework), libpq for PostgreSQL, hiredis for Redis, libcurl for HTTP fetching, and nlohmann/json for JSON.

**Adding a new endpoint:**

1. Write your handler function:
```cpp
Res myEndpoint(const Req& req) {
    // Parse params
    std::string myParam = req.getParam("param_name");

    // Query PostgreSQL
    PGresult* r = PQexecParams(db, "SELECT ...", 1, nullptr,
                               &myParam, nullptr, nullptr, 0);
    if (PQresultStatus(r) != PGRES_TUPLES_OK) {
        PQclear(r);
        return {500, "application/json", R"({"error":"db error"})"};
    }

    // Build JSON response
    nlohmann::json out = nlohmann::json::array();
    for (int i = 0; i < PQntuples(r); i++) {
        out.push_back({ {"field", PQgetvalue(r, i, 0)} });
    }
    PQclear(r);
    return {200, "application/json", out.dump()};
}
```

2. Register the route in the `dispatch()` function:
```cpp
if (req.path == "/my-endpoint" && req.method == "GET")
    return myEndpoint(req);
```

3. Rebuild and test:
```bash
docker compose up -d --build api
curl http://localhost/api/my-endpoint?param_name=test
```

**Important notes:**
- Always `PQclear(r)` after every PGresult, even on error
- Use parameterized queries (`$1`, `$2`, ...) — never string concatenation in SQL
- The server is multi-threaded; use `thread_local` PG connections or connection pooling
- libpq and hiredis errors should always be checked and returned as JSON `{"error":"..."}`

---

### C++ Crawler

**File:** `crawler/crawler.cpp`

The crawler pulls URLs from `crawl_queue` (lowest priority first), fetches with libcurl, parses HTML with Gumbo, saves to the `pages` table, and enqueues outbound links.

**Key functions:**

| Function | What it does |
|----------|-------------|
| `getNextURL()` | Claims the next URL from crawl_queue |
| `fetchURL(url)` | Downloads page content with libcurl |
| `parseHTML(html, url)` | Extracts title, description, text, links via Gumbo |
| `savePage(data)` | INSERT INTO pages, update crawl_queue |
| `enqueue(url, priority)` | Add new URL to crawl_queue if not visited |
| `isWalledGarden(domain)` | Returns true for Facebook, Instagram, TikTok, etc. |

**Adding a new domain filter or extraction rule:**

```cpp
// In enqueue() — add a new blocked domain
bool isWalledGarden(const std::string& domain) {
    static const std::vector<std::string> blocked = {
        "facebook.com", "instagram.com", /* add here */
    };
    for (const auto& b : blocked) {
        if (domain.find(b) != std::string::npos) return true;
    }
    return false;
}

// In parseHTML() — extract a new metadata field
// Gumbo tree walk example:
std::string extractOgImage(GumboNode* root) {
    // walk tree, find <meta property="og:image" content="...">
}
```

**Changing crawl behavior:**
- `MAX_PAGES` env var controls when a crawler worker stops (default: 100,000)
- `CRAWL_DELAY_MS` controls delay between requests (be polite to servers)
- Priority values: 1=force, 2=high, 5=normal (Cambodian=3, GitHub=4), 10=low

**Rebuild crawlers:**
```bash
docker compose up -d --build crawler_1 crawler_2 crawler_3 crawler_4
```

---

### Next.js Frontend

**Location:** `angkorsearch-web/`

The frontend is Next.js 14 with the App Router, TypeScript, and Tailwind CSS.

**Local development (without Docker):**

```bash
cd angkorsearch-web
npm install

# Set API URL in .env.local
echo "NEXT_PUBLIC_API_URL=http://localhost" > .env.local
echo "API_INTERNAL_URL=http://localhost:8080" >> .env.local

npm run dev
# Open http://localhost:3000
```

**Key files:**

| File | Description |
|------|-------------|
| `app/page.tsx` | Homepage — search box + discover feed |
| `app/search/page.tsx` | Search results page |
| `app/admin/page.tsx` | Admin dashboard (5 tabs) |
| `app/api/crawl-stream/route.ts` | SSE route — force crawl any URL |
| `app/api/auto-discover/route.ts` | SSE route — auto-discover related URLs |
| `components/search/SearchResults.tsx` | Results list + WebDiscovery panel |
| `components/widgets/AIOverview.tsx` | AI answer box |
| `hooks/useSearch.ts` | Search state + API calls |
| `lib/api.ts` | API client functions |

**Adding a new page:**

```
app/
└── my-page/
    └── page.tsx
```

```tsx
// app/my-page/page.tsx
export default function MyPage() {
  return <div>Hello</div>
}
```

**Adding a new API route (SSE example):**

```typescript
// app/api/my-route/route.ts
import { type NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q') ?? ''
  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ msg: 'hello' })}\n\n`))
      ctrl.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
```

**Important:** If your API route returns SSE, you must also add a nginx location block for it (see [nginx Config](#nginx-config)).

**Rebuild frontend:**
```bash
docker compose up -d --build frontend
```

---

### Database Schema

**File:** `postgres/init.sql`

This file runs once when PostgreSQL starts for the first time. If you change it:

```bash
# Wipe and re-init (WARNING: deletes all data)
docker compose down -v
docker compose up -d --build
```

**Adding a new table:**

```sql
-- Always use IF NOT EXISTS
CREATE TABLE IF NOT EXISTS my_table (
    id         SERIAL PRIMARY KEY,
    url        TEXT UNIQUE NOT NULL,
    data       TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes for columns you query often
CREATE INDEX IF NOT EXISTS idx_my_table_url ON my_table(url);
```

**Adding a new column to an existing table:**

```sql
ALTER TABLE pages ADD COLUMN IF NOT EXISTS my_column TEXT;
```

---

### nginx Config

**File:** `nginx/nginx.conf`

**Adding a new proxy route:**

```nginx
# Add BEFORE the generic /api/ block
location /api/my-new-route {
    proxy_pass         http://frontend_servers;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
}
```

**Adding a new SSE route (streaming):**

```nginx
# SSE needs proxy_buffering off and long timeout
location ~ ^/api/(crawl-stream|auto-discover|my-sse-route)(/|$) {
    proxy_pass         http://frontend_servers;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_read_timeout 180s;
    proxy_buffering    off;
    add_header         X-Accel-Buffering no;
}
```

**IMPORTANT:** In nginx, more specific `location` blocks must come before generic ones. Always put regex `location ~` blocks before prefix blocks like `location /api/`.

**Rebuild nginx:**
```bash
docker compose up -d --build nginx
# or reload config without downtime:
docker compose exec nginx nginx -s reload
```

---

## Code Style Guidelines

### C++ (API + Crawler)

- Use C++20 features where helpful
- Use `std::string` not raw `char*`
- Check every PostgreSQL result with `PQresultStatus()`
- Always call `PQclear()` — no memory leaks
- Use parameterized SQL queries — never string concatenation for user input
- Keep functions focused and under ~100 lines when possible

### TypeScript / Next.js

- Use TypeScript types everywhere — avoid `any`
- Use `const` by default, `let` only when reassignment is needed
- Keep components focused — one responsibility per component
- Use React hooks for stateful logic
- Handle loading and error states in UI components

### SQL

- Always use `IF NOT EXISTS` for `CREATE TABLE` and `CREATE INDEX`
- Use parameterized queries in application code (`$1`, `$2`, ...)
- Add an index for every column used in `WHERE` or `ORDER BY`

---

## How to Submit a PR

1. **Fork** the repository on GitHub

2. **Create a branch** for your change:
   ```bash
   git checkout -b feature/my-feature-name
   # or
   git checkout -b fix/bug-description
   ```

3. **Make your changes** and test locally:
   ```bash
   docker compose up -d --build
   # test your changes
   ```

4. **Commit** with a clear message:
   ```bash
   git commit -m "feat: add support for video thumbnails in search results"
   git commit -m "fix: crawl-now returns 500 when URL has no title"
   git commit -m "docs: update API endpoint table in README"
   ```

   Commit message prefixes:
   - `feat:` — new feature
   - `fix:` — bug fix
   - `docs:` — documentation only
   - `refactor:` — code restructure, no behavior change
   - `perf:` — performance improvement
   - `test:` — adding tests

5. **Push** and open a Pull Request:
   ```bash
   git push origin feature/my-feature-name
   ```
   Then open a PR on GitHub with a description of what you changed and why.

6. **PR checklist:**
   - [ ] Docker build succeeds (`docker compose up -d --build`)
   - [ ] The feature/fix works as expected
   - [ ] No regressions in existing functionality
   - [ ] README updated if you added new endpoints or changed behavior

---

## Good First Issues

If you are new to the project, these are good areas to start:

- **Add robots.txt respect to the crawler** — check `robots.txt` before crawling a domain
- **Add crawl delay per domain** — avoid hammering the same server too fast
- **Add more search filters** — filter by date indexed, domain, or content length
- **Improve Khmer language detection** — current detection is Unicode range based
- **Add pagination to admin Seed Domains tab**
- **Write tests for the search API** — currently no automated tests
- **Add Open Graph image extraction to the crawler** — save og:image as thumbnail
- **Add sitemap.xml support to the crawler** — parse sitemaps for faster discovery
- **Support multiple Ollama models** — let users choose model from admin UI

---

## Questions?

Open an issue on GitHub or reach out to the maintainer:

- GitHub: [MuyleangIng](https://github.com/MuyleangIng)
- Website: [muyleanging.com](https://muyleanging.com)
- Community: [KhmerStack](https://khmerstack.muyleanging.com)

---

<div align="center">
  <strong>Built for Cambodia · by Cambodians</strong>
</div>
