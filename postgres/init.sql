-- ============================================================
--  AngkorSearch v2 — Full Database Schema
--  Tables: pages, images, videos, github_repos, news,
--          suggestions, crawl_queue, seeds, users,
--          bookmarks, search_history, crawler_stats
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ─────────────────────────────────────────
-- Pages
-- ─────────────────────────────────────────
CREATE TABLE pages (
    id           SERIAL PRIMARY KEY,
    url          TEXT UNIQUE NOT NULL,
    domain       TEXT NOT NULL,
    title        TEXT,
    description  TEXT,
    language     VARCHAR(10) DEFAULT 'km',
    content      TEXT,
    html_path    TEXT,
    word_count   INT DEFAULT 0,
    page_type    VARCHAR(20) DEFAULT 'web',
    score        FLOAT DEFAULT 1.0,
    crawled_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW(),
    status       VARCHAR(20) DEFAULT 'indexed'
);
CREATE INDEX idx_pages_fts    ON pages USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(content,'')));
CREATE INDEX idx_pages_domain ON pages(domain);
CREATE INDEX idx_pages_lang   ON pages(language);
CREATE INDEX idx_pages_type   ON pages(page_type);
CREATE INDEX idx_pages_score  ON pages(score DESC);
CREATE INDEX idx_pages_trgm   ON pages USING gin(title gin_trgm_ops);

-- ─────────────────────────────────────────
-- Images
-- ─────────────────────────────────────────
CREATE TABLE images (
    id          SERIAL PRIMARY KEY,
    url         TEXT UNIQUE NOT NULL,
    page_url    TEXT,
    thumb_url   TEXT,
    alt_text    TEXT,
    title       TEXT,
    domain      TEXT,
    width       INT,
    height      INT,
    file_type   VARCHAR(10),
    language    VARCHAR(10) DEFAULT 'km',
    crawled_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_images_fts    ON images USING gin(to_tsvector('english', coalesce(alt_text,'') || ' ' || coalesce(title,'')));
CREATE INDEX idx_images_domain ON images(domain);
CREATE INDEX idx_images_trgm   ON images USING gin(coalesce(alt_text,'') gin_trgm_ops);

-- ─────────────────────────────────────────
-- Videos
-- ─────────────────────────────────────────
CREATE TABLE videos (
    id           SERIAL PRIMARY KEY,
    url          TEXT UNIQUE NOT NULL,
    embed_url    TEXT,
    thumb_url    TEXT,
    title        TEXT,
    description  TEXT,
    channel      TEXT,
    duration     TEXT,
    domain       TEXT,
    language     VARCHAR(10) DEFAULT 'km',
    crawled_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_videos_fts  ON videos USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));
CREATE INDEX idx_videos_trgm ON videos USING gin(coalesce(title,'') gin_trgm_ops);

-- ─────────────────────────────────────────
-- GitHub Repos
-- ─────────────────────────────────────────
CREATE TABLE github_repos (
    id           SERIAL PRIMARY KEY,
    repo_url     TEXT UNIQUE NOT NULL,
    name         TEXT,
    full_name    TEXT,
    description  TEXT,
    language     TEXT,
    stars        INT DEFAULT 0,
    forks        INT DEFAULT 0,
    owner        TEXT,
    owner_url    TEXT,
    topics       TEXT[],
    is_cambodian BOOLEAN DEFAULT TRUE,
    crawled_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_github_fts   ON github_repos USING gin(to_tsvector('english', coalesce(name,'') || ' ' || coalesce(description,'')));
CREATE INDEX idx_github_stars ON github_repos(stars DESC);
CREATE INDEX idx_github_lang  ON github_repos(language);
CREATE INDEX idx_github_trgm  ON github_repos USING gin(coalesce(name,'') gin_trgm_ops);

-- ─────────────────────────────────────────
-- News
-- ─────────────────────────────────────────
CREATE TABLE news (
    id           SERIAL PRIMARY KEY,
    url          TEXT UNIQUE NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT,
    content      TEXT,
    image_url    TEXT,
    source       TEXT,
    author       TEXT,
    language     VARCHAR(10) DEFAULT 'km',
    published_at TIMESTAMP,
    crawled_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_news_fts  ON news USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));
CREATE INDEX idx_news_pub  ON news(published_at DESC);
CREATE INDEX idx_news_src  ON news(source);
CREATE INDEX idx_news_trgm ON news USING gin(coalesce(title,'') gin_trgm_ops);

-- ─────────────────────────────────────────
-- Suggestions — smart autocomplete
-- ─────────────────────────────────────────
CREATE TABLE suggestions (
    id         SERIAL PRIMARY KEY,
    query      TEXT UNIQUE NOT NULL,
    normalized TEXT,
    language   VARCHAR(10),
    count      INT DEFAULT 1,
    source     VARCHAR(20),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_suggest_trgm  ON suggestions USING gin(coalesce(normalized,'') gin_trgm_ops);
CREATE INDEX idx_suggest_count ON suggestions(count DESC);

-- Pre-seeded Khmer + English suggestions
INSERT INTO suggestions (query, normalized, language, count, source) VALUES
-- Khmer suggestions
('កម្ពុជា',           'កម្ពុជា',           'km', 1000, 'seed'),
('ភ្នំពេញ',           'ភ្នំពេញ',           'km', 900,  'seed'),
('អង្គរវត្ត',         'អង្គរវត្ត',         'km', 800,  'seed'),
('ព័ត៌មានថ្មី',       'ព័ត៌មានថ្មី',       'km', 700,  'seed'),
('ការអប់រំ',          'ការអប់រំ',          'km', 600,  'seed'),
('សេដ្ឋកិច្ច',        'សេដ្ឋកិច្ច',        'km', 500,  'seed'),
('បច្ចេកវិទ្យា',      'បច្ចេកវិទ្យា',      'km', 500,  'seed'),
('ទេសចរណ៍',          'ទេសចរណ៍',          'km', 400,  'seed'),
('រដ្ឋាភិបាល',        'រដ្ឋាភិបាល',        'km', 400,  'seed'),
('ខ្មែរ',             'ខ្មែរ',             'km', 900,  'seed'),
('សុខភាព',           'សុខភាព',           'km', 350,  'seed'),
('កីឡា',             'កីឡា',             'km', 300,  'seed'),
('វប្បធម៌ខ្មែរ',      'វប្បធម៌ខ្មែរ',      'km', 300,  'seed'),
('ភាពយន្ត',          'ភាពយន្ត',          'km', 280,  'seed'),
('អានីមេ',           'អានីមេ',           'km', 250,  'seed'),
-- English suggestions
('cambodia',          'cambodia',          'en', 1000, 'seed'),
('phnom penh',        'phnom penh',        'en', 900,  'seed'),
('angkor wat',        'angkor wat',        'en', 800,  'seed'),
('cambodia news',     'cambodia news',     'en', 700,  'seed'),
('khmer',             'khmer',             'en', 600,  'seed'),
('cambodia economy',  'cambodia economy',  'en', 500,  'seed'),
('cambodia github',   'cambodia github',   'en', 400,  'seed'),
('cambodia tech',     'cambodia tech',     'en', 400,  'seed'),
('siem reap',         'siem reap',         'en', 500,  'seed'),
('cambodia jobs',     'cambodia jobs',     'en', 300,  'seed'),
('cambodia tourism',  'cambodia tourism',  'en', 400,  'seed'),
('cambodia developer','cambodia developer','en', 300,  'seed'),
('mekong tunnel',     'mekong tunnel',     'en', 200,  'seed'),
('anime',             'anime',             'en', 500,  'seed'),
('9anime',            '9anime',            'en', 400,  'seed'),
('gogoanime',         'gogoanime',         'en', 350,  'seed'),
('watch anime',       'watch anime',       'en', 300,  'seed'),
('anime cambodia',    'anime cambodia',    'en', 200,  'seed');

-- ─────────────────────────────────────────
-- Crawl Queue
-- ─────────────────────────────────────────
CREATE TABLE crawl_queue (
    id         SERIAL PRIMARY KEY,
    url        TEXT UNIQUE NOT NULL,
    domain     TEXT,
    source_url TEXT,
    queue_type VARCHAR(20) DEFAULT 'web',
    priority   INT DEFAULT 5,
    depth      INT DEFAULT 0,
    added_at   TIMESTAMP DEFAULT NOW(),
    crawled_at TIMESTAMP,
    crawled    BOOLEAN DEFAULT FALSE,
    error      TEXT
);
CREATE INDEX idx_queue_next   ON crawl_queue(priority, crawled, added_at) WHERE crawled = FALSE;
CREATE INDEX idx_queue_domain ON crawl_queue(domain, crawled);
CREATE INDEX idx_queue_type   ON crawl_queue(queue_type, crawled);

-- ─────────────────────────────────────────
-- Seeds — all sites to crawl
-- ─────────────────────────────────────────
CREATE TABLE seeds (
    id        SERIAL PRIMARY KEY,
    url       TEXT UNIQUE NOT NULL,
    domain    TEXT,
    seed_type VARCHAR(20) DEFAULT 'web',
    priority  INT DEFAULT 1,
    active    BOOLEAN DEFAULT TRUE,
    added_at  TIMESTAMP DEFAULT NOW()
);

INSERT INTO seeds (url, domain, seed_type, priority) VALUES
-- ── Cambodian News ──
('https://phnompenhpost.com',          'phnompenhpost.com',         'news',   1),
('https://khmertimeskh.com',           'khmertimeskh.com',          'news',   1),
('https://rfa.org/khmer',              'rfa.org',                   'news',   1),
('https://voacambodia.com',            'voacambodia.com',           'news',   1),
('https://dap-news.com',               'dap-news.com',              'news',   1),
('https://freshnewsasia.com',          'freshnewsasia.com',         'news',   1),
('https://thmey11.com',                'thmey11.com',               'news',   1),
('https://cambodiadaily.com',          'cambodiadaily.com',         'news',   1),
('https://cambodianess.com',           'cambodianess.com',          'news',   2),
('https://kohsantepheapdaily.com.kh',  'kohsantepheapdaily.com.kh', 'news',   2),
('https://postkhmer.com',              'postkhmer.com',             'news',   2),
('https://sabay.com.kh',               'sabay.com.kh',              'news',   2),
('https://akp.gov.kh',                 'akp.gov.kh',                'news',   2),
-- ── Cambodian Government ──
('https://mef.gov.kh',                 'mef.gov.kh',                'web',    3),
('https://moh.gov.kh',                 'moh.gov.kh',                'web',    3),
('https://moeys.gov.kh',               'moeys.gov.kh',              'web',    3),
-- ── Cambodian Education ──
('https://rupp.edu.kh',                'rupp.edu.kh',               'web',    3),
('https://ifa.edu.kh',                 'ifa.edu.kh',                'web',    3),
-- ── Cambodian Tech ──
('https://techcambodia.com',           'techcambodia.com',          'web',    2),
('https://cambohub.com',               'cambohub.com',              'web',    2),
-- ── MekongTunnel Project ──
('https://mekongtunnel-dev.vercel.app','mekongtunnel-dev.vercel.app','web',   1),
-- ── Anime Sites ──
('https://9anime.to',                  '9anime.to',                 'web',    2),
('https://gogoanime.tv',               'gogoanime.tv',              'web',    2),
('https://zoro.to',                    'zoro.to',                   'web',    2),
('https://animesuge.to',               'animesuge.to',              'web',    3),
-- ── GitHub Cambodia ──
('https://github.com/topics/cambodia', 'github.com',                'github', 1),
('https://github.com/topics/khmer',    'github.com',                'github', 1),
('https://github.com/camb-lang',       'github.com',                'github', 1);

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
    id        SERIAL PRIMARY KEY,
    user_id   INT REFERENCES users(id) ON DELETE CASCADE,
    url       TEXT NOT NULL,
    title     TEXT,
    folder    TEXT DEFAULT 'Default',
    saved_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, url)
);
CREATE INDEX idx_bookmarks_user ON bookmarks(user_id);

-- ─────────────────────────────────────────
-- Search History
-- ─────────────────────────────────────────
CREATE TABLE search_history (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id) ON DELETE CASCADE,
    session_id   TEXT,
    query        TEXT NOT NULL,
    result_count INT DEFAULT 0,
    search_type  VARCHAR(20) DEFAULT 'web',
    language     VARCHAR(10),
    searched_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_history_user ON search_history(user_id, searched_at DESC);

-- ─────────────────────────────────────────
-- Popular Searches
-- ─────────────────────────────────────────
CREATE TABLE popular_searches (
    query   TEXT PRIMARY KEY,
    count   INT DEFAULT 1,
    last_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Crawler Stats
-- ─────────────────────────────────────────
CREATE TABLE crawler_stats (
    id             SERIAL PRIMARY KEY,
    pages_crawled  INT DEFAULT 0,
    images_found   INT DEFAULT 0,
    videos_found   INT DEFAULT 0,
    github_found   INT DEFAULT 0,
    news_found     INT DEFAULT 0,
    errors         INT DEFAULT 0,
    recorded_at    TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Useful Views
-- ─────────────────────────────────────────
CREATE VIEW v_crawl_status AS
SELECT domain,
    COUNT(*) FILTER (WHERE crawled=TRUE)  AS crawled,
    COUNT(*) FILTER (WHERE crawled=FALSE) AS pending,
    COUNT(*) AS total
FROM crawl_queue GROUP BY domain ORDER BY total DESC;

CREATE VIEW v_index_summary AS
SELECT
    (SELECT COUNT(*) FROM pages)        AS total_pages,
    (SELECT COUNT(*) FROM images)       AS total_images,
    (SELECT COUNT(*) FROM videos)       AS total_videos,
    (SELECT COUNT(*) FROM github_repos) AS total_github,
    (SELECT COUNT(*) FROM news)         AS total_news,
    (SELECT COUNT(*) FROM crawl_queue WHERE crawled=FALSE) AS queue_pending;

COMMIT;