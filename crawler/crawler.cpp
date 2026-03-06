// ============================================================
//  crawler.cpp — AngkorSearch Web Crawler
//  Fetches Cambodian pages and stores in PostgreSQL
//  Uses Redis to avoid re-crawling visited URLs
//  Uses libcurl for HTTP, gumbo for HTML parsing
//  Uses libpq for PostgreSQL
// ============================================================

#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <queue>
#include <unordered_set>
#include <chrono>
#include <thread>
#include <cstring>
#include <cstdlib>
#include <algorithm>
#include <regex>

// HTTP
#include <curl/curl.h>

// PostgreSQL
#include <libpq-fe.h>

// Redis
#include <hiredis/hiredis.h>

// HTML parsing
#include <gumbo.h>

// ─────────────────────────────────────────
// Config from environment variables
// ─────────────────────────────────────────
struct Config {
    std::string dbHost     = "postgres";
    std::string dbPort     = "5432";
    std::string dbName     = "angkorsearch";
    std::string dbUser     = "angkor";
    std::string dbPass     = "angkor_secret_2024";
    std::string redisHost  = "redis";
    int         redisPort  = 6379;
    int         maxPages   = 100000;
    int         crawlDelay = 1000; // ms
    int         maxDepth   = 5;

    Config() {
        auto env = [](const char* k, const char* def) {
            const char* v = std::getenv(k);
            return v ? std::string(v) : std::string(def);
        };
        dbHost     = env("DB_HOST",     "postgres");
        dbPort     = env("DB_PORT",     "5432");
        dbName     = env("DB_NAME",     "angkorsearch");
        dbUser     = env("DB_USER",     "angkor");
        dbPass     = env("DB_PASS",     "angkor_secret_2024");
        redisHost  = env("REDIS_HOST",  "redis");
        redisPort  = std::stoi(env("REDIS_PORT", "6379"));
        maxPages   = std::stoi(env("MAX_PAGES",   "100000"));
        crawlDelay = std::stoi(env("CRAWL_DELAY", "1000"));
    }
};

// ─────────────────────────────────────────
// HTTP fetch with libcurl
// ─────────────────────────────────────────
static size_t curlWrite(char* ptr, size_t size,
                        size_t nmemb, std::string* data) {
    data->append(ptr, size * nmemb);
    return size * nmemb;
}

std::string fetchURL(const std::string& url, long timeoutSec = 10) {
    CURL* curl = curl_easy_init();
    std::string response;
    if (!curl) return "";

    curl_easy_setopt(curl, CURLOPT_URL,            url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION,  curlWrite);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA,      &response);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT,        timeoutSec);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS,      5L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT,
        "AngkorSearchBot/1.0 (+https://angkorsearch.com.kh/bot)");
    // Only accept HTML
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Accept: text/html");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    CURLcode res = curl_easy_perform(curl);
    long httpCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK || httpCode != 200) return "";
    return response;
}

// ─────────────────────────────────────────
// HTML parsing with gumbo
// ─────────────────────────────────────────
struct ParsedPage {
    std::string title;
    std::string text;
    std::vector<std::string> links;
};

void extractText(GumboNode* node, std::string& text) {
    if (node->type == GUMBO_NODE_TEXT) {
        text += node->v.text.text;
        text += " ";
        return;
    }
    if (node->type != GUMBO_NODE_ELEMENT) return;

    // Skip script/style tags
    GumboTag tag = node->v.element.tag;
    if (tag == GUMBO_TAG_SCRIPT || tag == GUMBO_TAG_STYLE) return;

    GumboVector* children = &node->v.element.children;
    for (unsigned int i = 0; i < children->length; i++)
        extractText((GumboNode*)children->data[i], text);
}

void extractLinks(GumboNode* node,
                  std::vector<std::string>& links,
                  const std::string& baseUrl) {
    if (node->type != GUMBO_NODE_ELEMENT) return;

    if (node->v.element.tag == GUMBO_TAG_A) {
        GumboAttribute* href = gumbo_get_attribute(
            &node->v.element.attributes, "href");
        if (href && href->value) {
            std::string link(href->value);
            // Only keep http(s) links
            if (link.substr(0, 4) == "http") {
                links.push_back(link);
            }
        }
    }

    GumboVector* children = &node->v.element.children;
    for (unsigned int i = 0; i < children->length; i++)
        extractLinks((GumboNode*)children->data[i], links, baseUrl);
}

std::string extractTitle(GumboNode* node) {
    if (node->type != GUMBO_NODE_ELEMENT) return "";
    if (node->v.element.tag == GUMBO_TAG_TITLE) {
        if (node->v.element.children.length > 0) {
            GumboNode* child = (GumboNode*)node->v.element.children.data[0];
            if (child->type == GUMBO_NODE_TEXT)
                return std::string(child->v.text.text);
        }
    }
    GumboVector* children = &node->v.element.children;
    for (unsigned int i = 0; i < children->length; i++) {
        std::string t = extractTitle((GumboNode*)children->data[i]);
        if (!t.empty()) return t;
    }
    return "";
}

ParsedPage parseHTML(const std::string& html, const std::string& url) {
    ParsedPage page;
    GumboOutput* output = gumbo_parse(html.c_str());
    if (!output) return page;

    page.title = extractTitle(output->root);
    extractText(output->root, page.text);
    extractLinks(output->root, page.links, url);

    // Clean up text
    std::string clean;
    bool lastSpace = false;
    for (char c : page.text) {
        if (c == '\n' || c == '\t') c = ' ';
        if (c == ' ' && lastSpace) continue;
        clean += c;
        lastSpace = (c == ' ');
    }
    page.text = clean.substr(0, 50000); // cap at 50KB

    gumbo_destroy_output(&kGumboDefaultOptions, output);
    return page;
}

// ─────────────────────────────────────────
// Extract domain from URL
// ─────────────────────────────────────────
std::string extractDomain(const std::string& url) {
    std::regex re(R"(https?://([^/]+))");
    std::smatch m;
    if (std::regex_search(url, m, re)) return m[1];
    return url;
}

// ─────────────────────────────────────────
// Detect language (simple heuristic)
// ─────────────────────────────────────────
std::string detectLang(const std::string& text) {
    int khmer = 0, latin = 0;
    for (unsigned char c : text) {
        // Rough UTF-8 Khmer detection (3-byte sequences starting with 0xE1)
        if (c == 0xE1) khmer++;
        else if (c >= 'a' && c <= 'z') latin++;
    }
    if (khmer > latin) return "km";
    if (latin > khmer) return "en";
    return "mixed";
}

// ─────────────────────────────────────────
// Crawler class
// ─────────────────────────────────────────
class Crawler {
private:
    Config     cfg;
    PGconn*    db    = nullptr;
    redisContext* redis = nullptr;
    int        pagesCrawled = 0;
    int        errors = 0;

    // ── Database ──
    bool connectDB() {
        std::string connStr =
            "host="     + cfg.dbHost +
            " port="    + cfg.dbPort +
            " dbname="  + cfg.dbName +
            " user="    + cfg.dbUser +
            " password="+ cfg.dbPass;
        db = PQconnectdb(connStr.c_str());
        if (PQstatus(db) != CONNECTION_OK) {
            std::cerr << "DB error: " << PQerrorMessage(db) << "\n";
            return false;
        }
        std::cout << "[DB] Connected to PostgreSQL\n";
        return true;
    }

    bool connectRedis() {
        redis = redisConnect(cfg.redisHost.c_str(), cfg.redisPort);
        if (!redis || redis->err) {
            std::cerr << "Redis error: "
                      << (redis ? redis->errstr : "null") << "\n";
            return false;
        }
        std::cout << "[Redis] Connected\n";
        return true;
    }

    // Check if URL already visited (Redis SET)
    bool isVisited(const std::string& url) {
        redisReply* r = (redisReply*)redisCommand(
            redis, "SISMEMBER visited_urls %s", url.c_str());
        bool visited = r && r->integer == 1;
        freeReplyObject(r);
        return visited;
    }

    void markVisited(const std::string& url) {
        redisReply* r = (redisReply*)redisCommand(
            redis, "SADD visited_urls %s", url.c_str());
        freeReplyObject(r);
        // Expire after 30 days
        r = (redisReply*)redisCommand(
            redis, "EXPIRE visited_urls 2592000");
        freeReplyObject(r);
    }

    // Get next URL from crawl_queue
    std::string getNextURL() {
        PGresult* res = PQexec(db,
            "UPDATE crawl_queue SET crawled=TRUE, crawled_at=NOW() "
            "WHERE id = ("
            "  SELECT id FROM crawl_queue "
            "  WHERE crawled=FALSE "
            "  ORDER BY priority ASC, added_at ASC "
            "  LIMIT 1 FOR UPDATE SKIP LOCKED"
            ") RETURNING url");

        if (PQresultStatus(res) != PGRES_TUPLES_OK ||
            PQntuples(res) == 0) {
            PQclear(res);
            return "";
        }
        std::string url = PQgetvalue(res, 0, 0);
        PQclear(res);
        return url;
    }

    // Add URLs to crawl queue
    void addToQueue(const std::vector<std::string>& urls,
                    const std::string& sourceUrl, int depth) {
        if (depth > cfg.maxDepth) return;
        for (const auto& url : urls) {
            if (isVisited(url)) continue;
            std::string domain = extractDomain(url);
            bool isCambodian =
                domain.find(".kh")         != std::string::npos ||
                domain.find("rfa.org")     != std::string::npos ||
                domain.find("voacambodia") != std::string::npos ||
                domain.find("khmertimes")  != std::string::npos ||
                domain.find("phnompenh")   != std::string::npos;
            if (!isCambodian) continue;

            // Fix: build full SQL string first, use $4 as literal int
            std::string depthStr = std::to_string(depth);
            const char* params[4] = {
                url.c_str(),
                domain.c_str(),
                sourceUrl.c_str(),
                depthStr.c_str()
            };
            PQexecParams(db,
                "INSERT INTO crawl_queue (url, domain, source_url, depth) "
                "VALUES ($1, $2, $3, $4::int) "
                "ON CONFLICT (url) DO NOTHING",
                4, nullptr, params, nullptr, nullptr, 0);
        }
    }

    // Save page to HTML file
    std::string saveHTML(int pageId, const std::string& html) {
        std::string dir  = "data/html/" + std::to_string(pageId / 1000);
        std::string path = dir + "/" + std::to_string(pageId) + ".html";
        // In production: mkdir -p dir
        std::ofstream f(path);
        if (f.is_open()) f << html;
        return path;
    }

    // Save parsed page to PostgreSQL
    int savePage(const std::string& url,
                  const ParsedPage& page,
                  const std::string& htmlPath,
                  const std::string& lang) {
        std::string domain = extractDomain(url);
        int wordCount = (int)std::count(
            page.text.begin(), page.text.end(), ' ');

        const char* params[7] = {
            url.c_str(),
            domain.c_str(),
            page.title.c_str(),
            lang.c_str(),
            page.text.c_str(),
            htmlPath.c_str(),
            std::to_string(wordCount).c_str()
        };

        PGresult* res = PQexecParams(db,
            "INSERT INTO pages "
            "(url, domain, title, language, content, html_path, word_count) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7) "
            "ON CONFLICT (url) DO UPDATE SET "
            "  title=$3, language=$4, content=$5, "
            "  updated_at=NOW(), status='indexed' "
            "RETURNING id",
            7, nullptr, params, nullptr, nullptr, 0);

        int id = -1;
        if (PQresultStatus(res) == PGRES_TUPLES_OK && PQntuples(res) > 0)
            id = std::stoi(PQgetvalue(res, 0, 0));
        PQclear(res);
        return id;
    }

    // Seed the queue from the seeds table
    void seedQueue() {
        PGresult* res = PQexec(db,
            "INSERT INTO crawl_queue (url, domain, priority) "
            "SELECT url, domain, priority FROM seeds "
            "WHERE active=TRUE "
            "ON CONFLICT (url) DO NOTHING");
        PQclear(res);
        std::cout << "[Crawler] Seeds loaded into queue\n";
    }

    // Log stats to DB
    void logStats() {
        std::string q =
            "INSERT INTO crawler_stats "
            "(pages_crawled, pages_indexed, errors) VALUES (" +
            std::to_string(pagesCrawled) + "," +
            std::to_string(pagesCrawled - errors) + "," +
            std::to_string(errors) + ")";
        PGresult* r = PQexec(db, q.c_str());
        PQclear(r);
    }

public:
    explicit Crawler(const Config& c) : cfg(c) {}

    bool init() {
        curl_global_init(CURL_GLOBAL_DEFAULT);
        return connectDB() && connectRedis();
    }

    void run() {
        seedQueue();
        std::cout << "[Crawler] Starting. Max pages: "
                  << cfg.maxPages << "\n";

        while (pagesCrawled < cfg.maxPages) {
            std::string url = getNextURL();
            if (url.empty()) {
                std::cout << "[Crawler] Queue empty. Waiting...\n";
                std::this_thread::sleep_for(
                    std::chrono::seconds(30));
                continue;
            }

            if (isVisited(url)) continue;
            markVisited(url);

            std::cout << "[" << ++pagesCrawled << "] " << url << "\n";

            // Fetch page
            std::string html = fetchURL(url);
            if (html.empty()) {
                errors++;
                PQexec(db, ("UPDATE crawl_queue SET error='fetch failed' "
                             "WHERE url='" + url + "'").c_str());
                continue;
            }

            // Parse
            ParsedPage page = parseHTML(html, url);
            std::string lang = detectLang(page.text);

            // Save HTML to disk
            std::string htmlPath = saveHTML(pagesCrawled, html);

            // Save to DB
            int pageId = savePage(url, page, htmlPath, lang);
            if (pageId > 0) {
                // Add discovered links to queue
                addToQueue(page.links, url, 1);
            }

            // Log every 100 pages
            if (pagesCrawled % 100 == 0) {
                logStats();
                std::cout << "[Stats] Crawled: " << pagesCrawled
                          << " Errors: " << errors << "\n";
            }

            // Polite delay
            std::this_thread::sleep_for(
                std::chrono::milliseconds(cfg.crawlDelay));
        }

        logStats();
        std::cout << "[Crawler] Done. Total: " << pagesCrawled << "\n";
    }

    ~Crawler() {
        if (db)    PQfinish(db);
        if (redis) redisFree(redis);
        curl_global_cleanup();
    }
};

// ─────────────────────────────────────────
// Main
// ─────────────────────────────────────────
int main() {
    std::cout << "AngkorSearch Crawler v1.0\n";

    // Retry DB connection (wait for postgres to be ready)
    for (int i = 0; i < 10; i++) {
        Config cfg;
        Crawler crawler(cfg);
        if (crawler.init()) {
            crawler.run();
            return 0;
        }
        std::cerr << "Retrying in 5s...\n";
        std::this_thread::sleep_for(std::chrono::seconds(5));
    }
    return 1;
}
