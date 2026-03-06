-- ============================================================
--  AngkorSearch Database Schema
--  PostgreSQL 16
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fast text search
CREATE EXTENSION IF NOT EXISTS unaccent;  -- normalize accents

-- ─────────────────────────────────────────
-- Pages — every crawled web page
-- ─────────────────────────────────────────
CREATE TABLE pages (
    id          SERIAL PRIMARY KEY,
    url         TEXT UNIQUE NOT NULL,
    domain      TEXT NOT NULL,
    title       TEXT,
    language    VARCHAR(10) DEFAULT 'km',   -- 'km','en','mixed'
    content     TEXT,                        -- clean extracted text
    html_path   TEXT,                        -- path to raw HTML file
    word_count  INT DEFAULT 0,
    score       FLOAT DEFAULT 1.0,           -- page importance score
    crawled_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW(),
    status      VARCHAR(20) DEFAULT 'indexed'
);

-- Fast text search index on title + content
CREATE INDEX idx_pages_title   ON pages USING gin(to_tsvector('english', coalesce(title,'')));
CREATE INDEX idx_pages_content ON pages USING gin(to_tsvector('english', coalesce(content,'')));
CREATE INDEX idx_pages_domain  ON pages(domain);
CREATE INDEX idx_pages_lang    ON pages(language);
CREATE INDEX idx_pages_status  ON pages(status);

-- ─────────────────────────────────────────
-- Crawl Queue — URLs waiting to be crawled
-- ─────────────────────────────────────────
CREATE TABLE crawl_queue (
    id          SERIAL PRIMARY KEY,
    url         TEXT UNIQUE NOT NULL,
    domain      TEXT,
    source_url  TEXT,
    priority    INT DEFAULT 5,      -- 1=highest, 10=lowest
    depth       INT DEFAULT 0,      -- how many hops from seed
    added_at    TIMESTAMP DEFAULT NOW(),
    crawled_at  TIMESTAMP,
    crawled     BOOLEAN DEFAULT FALSE,
    error       TEXT
);

CREATE INDEX idx_queue_priority ON crawl_queue(priority, crawled, added_at);
CREATE INDEX idx_queue_domain   ON crawl_queue(domain, crawled);

-- ─────────────────────────────────────────
-- Seed URLs — starting points for crawler
-- ─────────────────────────────────────────
CREATE TABLE seeds (
    id       SERIAL PRIMARY KEY,
    url      TEXT UNIQUE NOT NULL,
    domain   TEXT,
    priority INT DEFAULT 1,
    active   BOOLEAN DEFAULT TRUE,
    added_at TIMESTAMP DEFAULT NOW()
);

-- Insert Cambodian seed URLs
INSERT INTO seeds (url, domain, priority) VALUES
    ('https://phnompenhpost.com',           'phnompenhpost.com',           1),
    ('https://khmertimeskh.com',            'khmertimeskh.com',            1),
    ('https://rfa.org/khmer',               'rfa.org',                     1),
    ('https://voacambodia.com',             'voacambodia.com',             1),
    ('https://dap-news.com',                'dap-news.com',                1),
    ('https://freshnewsasia.com',           'freshnewsasia.com',           1),
    ('https://sabay.com.kh',                'sabay.com.kh',                1),
    ('https://kohsantepheapdaily.com.kh',   'kohsantepheapdaily.com.kh',   2),
    ('https://postkhmer.com',               'postkhmer.com',               2),
    ('https://mef.gov.kh',                  'mef.gov.kh',                  2),
    ('https://moh.gov.kh',                  'moh.gov.kh',                  2),
    ('https://rupp.edu.kh',                 'rupp.edu.kh',                 3),
    ('https://ifa.edu.kh',                  'ifa.edu.kh',                  3);

-- ─────────────────────────────────────────
-- Users
-- ─────────────────────────────────────────
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT,
    password_hash TEXT,
    google_id     TEXT UNIQUE,
    created_at    TIMESTAMP DEFAULT NOW(),
    last_login    TIMESTAMP
);

-- ─────────────────────────────────────────
-- Bookmarks
-- ─────────────────────────────────────────
CREATE TABLE bookmarks (
    id         SERIAL PRIMARY KEY,
    user_id    INT REFERENCES users(id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    title      TEXT,
    folder     TEXT DEFAULT 'Default',
    saved_at   TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, url)
);

CREATE INDEX idx_bookmarks_user ON bookmarks(user_id);

-- ─────────────────────────────────────────
-- Search History
-- ─────────────────────────────────────────
CREATE TABLE search_history (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id) ON DELETE CASCADE,
    session_id   TEXT,                     -- anonymous sessions
    query        TEXT NOT NULL,
    result_count INT DEFAULT 0,
    language     VARCHAR(10),
    searched_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_history_user    ON search_history(user_id, searched_at DESC);
CREATE INDEX idx_history_session ON search_history(session_id, searched_at DESC);

-- ─────────────────────────────────────────
-- Popular Searches — cached analytics
-- ─────────────────────────────────────────
CREATE TABLE popular_searches (
    query      TEXT PRIMARY KEY,
    count      INT DEFAULT 1,
    last_at    TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Crawler Stats
-- ─────────────────────────────────────────
CREATE TABLE crawler_stats (
    id           SERIAL PRIMARY KEY,
    pages_crawled INT DEFAULT 0,
    pages_indexed INT DEFAULT 0,
    errors        INT DEFAULT 0,
    recorded_at   TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Helpful views
-- ─────────────────────────────────────────
CREATE VIEW v_crawl_status AS
SELECT
    domain,
    COUNT(*) FILTER (WHERE crawled = TRUE)  AS crawled,
    COUNT(*) FILTER (WHERE crawled = FALSE) AS pending,
    COUNT(*)                                AS total
FROM crawl_queue
GROUP BY domain
ORDER BY total DESC;

CREATE VIEW v_top_domains AS
SELECT domain, COUNT(*) as page_count
FROM pages
GROUP BY domain
ORDER BY page_count DESC;

COMMIT;
