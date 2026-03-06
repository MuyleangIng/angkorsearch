# 🇰🇭 AngkorSearch — Cambodia's Open Source Search Engine

Full-stack search engine for Cambodia supporting **Khmer + English**.

## Architecture

```
nginx (port 80)
  ├── /api/*   → C++ API server (port 8080)
  └── /*       → Next.js frontend (port 3000)

PostgreSQL (port 5432)  — pages, users, bookmarks, history
Redis (port 6379)       — search cache, sessions
C++ Crawler             — crawls Cambodian websites
```

## Quick Start

### Requirements
- Docker Desktop (Mac/Windows) or Docker + Docker Compose (Linux)

### Run

```bash
# 1. Copy your Khmer dictionary
cp path/to/khmer_dict.txt data/dict/

# 2. Start everything
chmod +x start.sh
./start.sh

# 3. Open browser
open http://localhost
```

### Manual Docker commands

```bash
# Start
docker compose up -d --build

# View logs
docker compose logs -f

# View specific service
docker compose logs -f crawler
docker compose logs -f api

# Stop
docker compose down

# Stop and delete all data
docker compose down -v
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/search?q=angkor&lang=km&page=1` | Search |
| GET | `/suggest?q=cambo` | Autocomplete |
| POST | `/bookmark` | Save bookmark |
| GET | `/bookmarks?user_id=1` | Get bookmarks |
| GET | `/history?user_id=1` | Get history |
| DELETE | `/history?user_id=1` | Clear history |

## Database

Connect to PostgreSQL:
```bash
docker compose exec postgres psql -U angkor -d angkorsearch
```

Useful queries:
```sql
-- How many pages indexed?
SELECT COUNT(*) FROM pages;

-- Crawl status by domain
SELECT * FROM v_crawl_status;

-- Top searches
SELECT * FROM popular_searches ORDER BY count DESC LIMIT 10;

-- Check crawler queue
SELECT COUNT(*) FROM crawl_queue WHERE crawled = FALSE;
```

## Project Structure

```
angkorsearch/
├── docker-compose.yml   ← orchestrates everything
├── crawler/
│   ├── crawler.cpp      ← C++ web crawler
│   └── Dockerfile
├── api/
│   ├── api_server.cpp   ← C++ HTTP API
│   └── Dockerfile
├── frontend/
│   ├── pages/index.js   ← Next.js UI
│   └── Dockerfile
├── postgres/
│   └── init.sql         ← database schema
├── nginx/
│   └── nginx.conf       ← reverse proxy
└── data/
    └── dict/
        └── khmer_dict.txt
```

## Scale Up

For more traffic, scale the API server:
```bash
docker compose up -d --scale api=3
```

For production deployment on a VPS:
```bash
# Install Docker on Ubuntu server
curl -fsSL https://get.docker.com | sh

# Clone your repo
git clone https://github.com/YOUR_USERNAME/angkorsearch
cd angkorsearch

# Run
./start.sh
```
