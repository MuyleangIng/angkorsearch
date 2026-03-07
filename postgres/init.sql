-- ============================================================
--  AngkorSearch v2 — Full Database Schema
--  v2.2 fixes:
--   • All CREATE TABLE/INDEX use IF NOT EXISTS
--   • FTS indexes use 'simple' dict (supports Khmer + all languages)
--   • crawler_live table added (was missing, caused silent crash)
--   • INSERT seeds use ON CONFLICT DO NOTHING (safe to re-run)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ─────────────────────────────────────────
-- Pages
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pages (
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
CREATE INDEX IF NOT EXISTS idx_pages_fts    ON pages USING gin(to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(content,'')));
CREATE INDEX IF NOT EXISTS idx_pages_domain ON pages(domain);
CREATE INDEX IF NOT EXISTS idx_pages_lang   ON pages(language);
CREATE INDEX IF NOT EXISTS idx_pages_type   ON pages(page_type);
CREATE INDEX IF NOT EXISTS idx_pages_score  ON pages(score DESC);
CREATE INDEX IF NOT EXISTS idx_pages_trgm      ON pages USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pages_desc_trgm ON pages USING gin(description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pages_updated ON pages(updated_at DESC);

-- ─────────────────────────────────────────
-- Images
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS images (
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
CREATE INDEX IF NOT EXISTS idx_images_fts    ON images USING gin(to_tsvector('simple', coalesce(alt_text,'') || ' ' || coalesce(title,'')));
CREATE INDEX IF NOT EXISTS idx_images_domain ON images(domain);
CREATE INDEX IF NOT EXISTS idx_images_trgm   ON images USING gin(coalesce(alt_text,'') gin_trgm_ops);

-- ─────────────────────────────────────────
-- Videos
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS videos (
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
CREATE INDEX IF NOT EXISTS idx_videos_fts  ON videos USING gin(to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'')));
CREATE INDEX IF NOT EXISTS idx_videos_trgm ON videos USING gin(coalesce(title,'') gin_trgm_ops);

-- ─────────────────────────────────────────
-- GitHub Repos
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS github_repos (
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
    source       VARCHAR(20) DEFAULT 'github', -- 'github' or 'gitlab'
    crawled_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_github_fts   ON github_repos USING gin(to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,'')));
CREATE INDEX IF NOT EXISTS idx_github_stars ON github_repos(stars DESC);
CREATE INDEX IF NOT EXISTS idx_github_lang  ON github_repos(language);
CREATE INDEX IF NOT EXISTS idx_github_trgm  ON github_repos USING gin(coalesce(name,'') gin_trgm_ops);

-- ─────────────────────────────────────────
-- News
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news (
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
CREATE INDEX IF NOT EXISTS idx_news_fts  ON news USING gin(to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'')));
CREATE INDEX IF NOT EXISTS idx_news_pub  ON news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_src  ON news(source);
CREATE INDEX IF NOT EXISTS idx_news_trgm ON news USING gin(coalesce(title,'') gin_trgm_ops);

-- ─────────────────────────────────────────
-- Suggestions
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suggestions (
    id         SERIAL PRIMARY KEY,
    query      TEXT UNIQUE NOT NULL,
    normalized TEXT,
    language   VARCHAR(10),
    count      INT DEFAULT 1,
    source     VARCHAR(20),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_suggest_trgm  ON suggestions USING gin(coalesce(normalized,'') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_suggest_count ON suggestions(count DESC);

INSERT INTO suggestions (query, normalized, language, count, source) VALUES
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
('anime cambodia',    'anime cambodia',    'en', 200,  'seed')
ON CONFLICT (query) DO NOTHING;

-- ─────────────────────────────────────────
-- Crawl Queue
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crawl_queue (
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
CREATE INDEX IF NOT EXISTS idx_queue_next   ON crawl_queue(priority, crawled, added_at) WHERE crawled = FALSE;
CREATE INDEX IF NOT EXISTS idx_queue_domain ON crawl_queue(domain, crawled);
CREATE INDEX IF NOT EXISTS idx_queue_type   ON crawl_queue(queue_type, crawled);

-- ─────────────────────────────────────────
-- Seeds
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seeds (
    id        SERIAL PRIMARY KEY,
    url       TEXT UNIQUE NOT NULL,
    domain    TEXT,
    seed_type VARCHAR(20) DEFAULT 'web',
    priority  INT DEFAULT 1,
    active    BOOLEAN DEFAULT TRUE,
    added_at  TIMESTAMP DEFAULT NOW()
);

INSERT INTO seeds (url, domain, seed_type, priority) VALUES
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
('https://mef.gov.kh',                 'mef.gov.kh',                'web',    3),
('https://moh.gov.kh',                 'moh.gov.kh',                'web',    3),
('https://moeys.gov.kh',               'moeys.gov.kh',              'web',    3),
('https://rupp.edu.kh',                'rupp.edu.kh',               'web',    3),
('https://ifa.edu.kh',                 'ifa.edu.kh',                'web',    3),
('https://techcambodia.com',           'techcambodia.com',          'web',    2),
('https://cambohub.com',               'cambohub.com',              'web',    2),
('https://mekongtunnel-dev.vercel.app','mekongtunnel-dev.vercel.app','web',   1),
('https://9anime.to',                  '9anime.to',                 'web',    2),
('https://gogoanime.tv',               'gogoanime.tv',              'web',    2),
('https://zoro.to',                    'zoro.to',                   'web',    2),
('https://animesuge.to',               'animesuge.to',              'web',    3),
('https://github.com/topics/cambodia',       'github.com',  'github', 1),
('https://github.com/topics/khmer',         'github.com',  'github', 1),
('https://github.com/camb-lang',            'github.com',  'github', 1),
('https://github.com/search?q=location%3ACambodia&type=users', 'github.com', 'github', 1),
-- GitLab: Cambodia/Khmer projects and developers
('https://gitlab.com/explore/projects?sort=stars_desc&search=cambodia', 'gitlab.com', 'github', 2),
('https://gitlab.com/explore/projects?sort=stars_desc&search=khmer',    'gitlab.com', 'github', 2),
('https://gitlab.com/users/sign_in',         'gitlab.com',  'github', 9),
-- Tech companies — public sites, products, docs
('https://www.apple.com',                    'apple.com',               'web',   3),
('https://www.samsung.com',                  'samsung.com',             'web',   3),
('https://www.sony.com',                     'sony.com',                'web',   4),
('https://www.nokia.com',                    'nokia.com',               'web',   4),
('https://www.oppo.com',                     'oppo.com',                'web',   4),
('https://www.ibm.com',                      'ibm.com',                 'web',   3),
('https://research.ibm.com/quantum-computing','ibm.com',                'web',   2),
('https://www.google.com',                   'google.com',              'web',   3),
-- Quantum computing
('https://quantumai.google',                 'quantumai.google',        'web',   2),
('https://xanadu.ai',                        'xanadu.ai',               'web',   2),
('https://pennylane.ai',                     'pennylane.ai',            'web',   2),
('https://www.ibm.com/quantum',              'ibm.com',                 'web',   2),
-- Shopping — Cambodia + popular
('https://khmer24.com',                      'khmer24.com',             'web',   1),
('https://www.coupang.com',                  'coupang.com',             'web',   3),
('https://shop.com.kh',                      'shop.com.kh',             'web',   2),
('https://jd.com',                           'jd.com',                  'web',   4),
-- Developer resources — StackOverflow, MDN, dev.to, Medium, HackerNews
('https://stackoverflow.com/questions/tagged/cambodia',      'stackoverflow.com',     'web',   2),
('https://stackoverflow.com/questions/tagged/khmer',         'stackoverflow.com',     'web',   2),
('https://developer.mozilla.org/en-US/docs/Learn_web_development', 'developer.mozilla.org','web',3),
('https://developer.mozilla.org/en-US/docs/Web',             'developer.mozilla.org', 'web',   3),
('https://dev.to',                                           'dev.to',                'web',   2),
('https://dev.to/t/cambodia',                                'dev.to',                'web',   2),
('https://medium.com/tag/cambodia',                          'medium.com',            'web',   2),
('https://medium.com/tag/khmer',                             'medium.com',            'web',   2),
('https://news.ycombinator.com',                             'news.ycombinator.com',  'web',   3),
-- AI Tools — public landing pages are crawlable; their content shows in web search
('https://claude.ai',                        'claude.ai',               'web',   3),
('https://chat.openai.com',                  'chat.openai.com',         'web',   3),
('https://www.perplexity.ai',                'perplexity.ai',           'web',   3),
('https://gemini.google.com',                'gemini.google.com',       'web',   3),
('https://huggingface.co',                   'huggingface.co',          'web',   2),
('https://huggingface.co/models',            'huggingface.co',          'web',   2),
('https://ollama.com/library',               'ollama.com',              'web',   3),
-- Quantum / Advanced tech
('https://research.ibm.com/quantum-computing','ibm.com',                'web',   4),
('https://quantumai.google',                 'quantumai.google',        'web',   4),
('https://arxiv.org/cs.AI',                  'arxiv.org',               'web',   3),
('https://arxiv.org/cs.CR',                  'arxiv.org',               'web',   4),
-- Community / Popular
('https://discord.com/safety',               'discord.com',             'web',   5),
('https://www.reddit.com/r/cambodia',        'reddit.com',              'web',   3),
('https://www.reddit.com/r/learnprogramming','reddit.com',              'web',   4),
('https://dev.to/t/cambodia',                'dev.to',                  'web',   2),
('https://medium.com/tag/cambodia',          'medium.com',              'web',   3),
('https://stackoverflow.com/questions/tagged/khmer', 'stackoverflow.com','web',  3),
-- Additional Cambodian news / media
('https://m.freshnews.com.kh/',              'freshnews.com.kh',        'news',  1),
('https://ams.com.kh/',                      'ams.com.kh',              'news',  2),
('https://khmercivilization.ams.com.kh/ams-khmer-portal', 'ams.com.kh','web',   2),
-- Government portal — lists all ministries; crawler discovers sub-domains from here
('https://www.gov.kh/',                      'gov.kh',                  'web',   1),
-- Key ministry sites (crawler will follow links to discover more .gov.kh sub-domains)
('https://mfa.gov.kh',                       'mfa.gov.kh',              'web',   2),
('https://commerce.gov.kh',                  'commerce.gov.kh',         'web',   2),
('https://mlmupc.gov.kh',                    'mlmupc.gov.kh',           'web',   2),
('https://mot.gov.kh',                       'mot.gov.kh',              'web',   2),
('https://mptc.gov.kh',                      'mptc.gov.kh',             'web',   2),
('https://mef.gov.kh',                       'mef.gov.kh',              'web',   2),
('https://moh.gov.kh',                       'moh.gov.kh',              'web',   2),
('https://moeys.gov.kh',                     'moeys.gov.kh',            'web',   2)
ON CONFLICT (url) DO NOTHING;

-- ─────────────────────────────────────────
-- Roles
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

-- ─────────────────────────────────────────
-- Permissions
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permissions (
    id          SERIAL PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

-- ─────────────────────────────────────────
-- Role Permissions (RBAC join table)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id       INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- ─────────────────────────────────────────
-- Seed Roles
-- ─────────────────────────────────────────
INSERT INTO roles (id, name, description) VALUES
    (1, 'user',  'Regular registered user'),
    (2, 'admin', 'Administrator with full system access')
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────
-- Seed Permissions
-- ─────────────────────────────────────────
INSERT INTO permissions (name, description) VALUES
    ('search',           'Search the index'),
    ('bookmark:create',  'Create bookmarks'),
    ('bookmark:read',    'Read own bookmarks'),
    ('bookmark:delete',  'Delete own bookmarks'),
    ('history:read',     'Read own search history'),
    ('history:delete',   'Delete own search history'),
    ('profile:update',   'Update own profile'),
    ('account:delete',   'Delete own account'),
    ('admin:users',      'View and manage all users'),
    ('admin:stats',      'View admin statistics'),
    ('admin:crawl',      'Manage crawl queue')
ON CONFLICT (name) DO NOTHING;

-- user role: all non-admin permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions WHERE name NOT LIKE 'admin:%'
ON CONFLICT DO NOTHING;

-- admin role: all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────
-- Users  (v2.3 — RBAC: role_id, github_id, username, avatar_url, is_active)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id             SERIAL PRIMARY KEY,
    email          TEXT UNIQUE NOT NULL,
    username       TEXT NOT NULL DEFAULT '',
    password_hash  TEXT,
    avatar_url     TEXT NOT NULL DEFAULT '',
    bio            TEXT NOT NULL DEFAULT '',
    website        TEXT NOT NULL DEFAULT '',
    location       TEXT NOT NULL DEFAULT '',
    google_id      TEXT UNIQUE,
    github_id      TEXT UNIQUE,
    role_id        INT NOT NULL REFERENCES roles(id) DEFAULT 1,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW(),
    last_login     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id   ON users(role_id);

-- ─────────────────────────────────────────
-- Sessions  (no JWT — session cookie stored server-side)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id         CHAR(64) PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ─────────────────────────────────────────
-- Email Verifications  (one pending token per user)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verifications (
    user_id    INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token      CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Password Resets  (one pending token per user)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_resets (
    user_id    INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token      CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Bookmarks
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookmarks (
    id        SERIAL PRIMARY KEY,
    user_id   INT REFERENCES users(id) ON DELETE CASCADE,
    url       TEXT NOT NULL,
    title     TEXT,
    folder    TEXT DEFAULT 'Default',
    saved_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, url)
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);

-- ─────────────────────────────────────────
-- Search History
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_history (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id) ON DELETE CASCADE,
    session_id   TEXT,
    query        TEXT NOT NULL,
    result_count INT DEFAULT 0,
    search_type  VARCHAR(20) DEFAULT 'web',
    language     VARCHAR(10),
    searched_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_history_user ON search_history(user_id, searched_at DESC);

-- ─────────────────────────────────────────
-- Popular Searches
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS popular_searches (
    query   TEXT PRIMARY KEY,
    count   INT DEFAULT 1,
    last_at TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Crawler Stats
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crawler_stats (
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
-- Social Links (Facebook/YouTube/TikTok/Telegram discovered per domain)
-- Captured by crawler when it finds social media links on a crawled page.
-- Used by /api/social?domain= to display social links on search result cards.
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_links (
    id          SERIAL PRIMARY KEY,
    domain      TEXT NOT NULL,
    platform    VARCHAR(20) NOT NULL,  -- 'facebook','youtube','tiktok','telegram','twitter','instagram','linkedin'
    url         TEXT NOT NULL,
    source_page TEXT,
    found_at    TIMESTAMP DEFAULT NOW(),
    UNIQUE(domain, platform, url)
);
CREATE INDEX IF NOT EXISTS idx_social_domain   ON social_links(domain);
CREATE INDEX IF NOT EXISTS idx_social_platform ON social_links(platform);

-- ─────────────────────────────────────────
-- Click Logs (CTR tracking — feeds back into ranking)
-- POST /click logs url + query + position when a user clicks a search result.
-- pages.score is bumped +0.1 per click (capped at 10.0).
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS click_logs (
    id         SERIAL PRIMARY KEY,
    url        TEXT NOT NULL,
    query      TEXT NOT NULL,
    position   INT DEFAULT 0,
    session_id TEXT,
    clicked_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clicks_url   ON click_logs(url);
CREATE INDEX IF NOT EXISTS idx_clicks_query ON click_logs(query, clicked_at DESC);

-- ─────────────────────────────────────────
-- Crawler Live Counter (was missing in v2.0)
-- Used by crawler.cpp to bump a live pages counter
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crawler_live (
    id         INT PRIMARY KEY DEFAULT 1,
    pages_live BIGINT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO crawler_live (id, pages_live) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────
-- Views
-- ─────────────────────────────────────────
CREATE OR REPLACE VIEW v_crawl_status AS
SELECT domain,
    COUNT(*) FILTER (WHERE crawled=TRUE)  AS crawled,
    COUNT(*) FILTER (WHERE crawled=FALSE) AS pending,
    COUNT(*) AS total
FROM crawl_queue GROUP BY domain ORDER BY total DESC;

CREATE OR REPLACE VIEW v_index_summary AS
SELECT
    (SELECT COUNT(*) FROM pages)        AS total_pages,
    (SELECT COUNT(*) FROM images)       AS total_images,
    (SELECT COUNT(*) FROM videos)       AS total_videos,
    (SELECT COUNT(*) FROM github_repos) AS total_github,
    (SELECT COUNT(*) FROM news)         AS total_news,
    (SELECT COUNT(*) FROM crawl_queue WHERE crawled=FALSE) AS queue_pending;

COMMIT;
