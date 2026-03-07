// ============================================================
//  crawler.cpp — AngkorSearch v2 Mega Crawler (PARALLEL EDITION)
//
//  Overview:
//    A multi-threaded web crawler that indexes Cambodian websites
//    and (optionally) GitHub repos related to Cambodia/Khmer.
//
//  Architecture:
//    - N_THREADS worker threads crawl URLs simultaneously
//    - Each worker owns its own PostgreSQL + Redis connection
//    - Pages are written to DB immediately upon crawl (no batching)
//    - Redis is used as a shared visited-set and queue lock
//    - NODE_ID env var lets multiple containers crawl without overlap
//
//  TODO (later):
//    - Re-enable GitHub crawling (currently commented out in main())
//    - Crawl individual GitHub repo websites / README pages
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
#include <mutex>
#include <atomic>
#include <cstring>
#include <cstdint>
#include <cstdlib>
#include <ctime>
#include <algorithm>
#include <regex>
#include <curl/curl.h>       // HTTP fetching
#include <libpq-fe.h>        // PostgreSQL client
#include <hiredis/hiredis.h> // Redis client
#include <gumbo.h>           // HTML parsing (Google's Gumbo parser)

// ─────────────────────────────────────────
// Config — reads all settings from env vars
// with sensible defaults for local dev
// ─────────────────────────────────────────
struct Config {
    std::string dbHost    = "postgres";
    std::string dbPort    = "5432";
    std::string dbName    = "angkorsearch";
    std::string dbUser    = "angkor";
    std::string dbPass    = "angkor_secret_2024";
    std::string redisHost = "redis";
    std::string githubToken = "";  // Optional: set for higher GitHub API rate limits
    std::string nodeId    = "1";   // Unique ID per container — prevents duplicate work
    int redisPort   = 6379;
    int maxPages    = 500000; // Stop crawling after this many pages total
    int crawlDelay  = 200;    // ms between regular page fetches (was 800 in v1)
    int maxDepth    = 6;      // How many link hops from seed before stopping
    int githubDelay = 1000;   // ms between GitHub API calls (was 2000 in v1)
    int nThreads       = 8;    // Worker threads per container
    int maxDomainPages = 500;  // Max pages indexed per domain per day (crawl budget)
    std::string totalNodes = "1"; // Total crawler nodes for URL sharding

    // Constructor reads each setting from env, falls back to default
    Config() {
        auto e = [](const char* k, const char* d) {
            const char* v = std::getenv(k); return v ? std::string(v) : std::string(d);
        };
        dbHost      = e("DB_HOST",      "postgres");
        dbPort      = e("DB_PORT",      "5432");
        dbName      = e("DB_NAME",      "angkorsearch");
        dbUser      = e("DB_USER",      "angkor");
        dbPass      = e("DB_PASS",      "angkor_secret_2024");
        redisHost   = e("REDIS_HOST",   "redis");
        redisPort   = std::stoi(e("REDIS_PORT",   "6379"));
        maxPages    = std::stoi(e("MAX_PAGES",    "500000"));
        crawlDelay  = std::stoi(e("CRAWL_DELAY",  "200"));
        githubToken = e("GITHUB_TOKEN", "");
        nodeId      = e("NODE_ID",      "1");
        nThreads       = std::stoi(e("N_THREADS",       "8"));
        maxDomainPages = std::stoi(e("MAX_DOMAIN_PAGES","500"));
        totalNodes     = e("TOTAL_NODES",  "1");
    }
};

// ─────────────────────────────────────────
// HTTP — libcurl helpers
// ─────────────────────────────────────────

// libcurl write callback: appends received bytes into a std::string
static size_t curlWrite(char* ptr, size_t size, size_t nmemb, std::string* data) {
    data->append(ptr, size * nmemb);
    return size * nmemb;
}

// Fetch a URL and return its body as a string.
// Returns empty string on failure or non-200/301 status.
// extraHeader: optional string like "Authorization: token xyz"
std::string fetchURL(const std::string& url,
                     const std::string& extraHeader = "",
                     long timeout = 15) {
    CURL* curl = curl_easy_init();
    std::string response;
    if (!curl) return "";

    curl_easy_setopt(curl, CURLOPT_URL,            url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION,  curlWrite);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA,      &response);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L); // follow redirects
    curl_easy_setopt(curl, CURLOPT_TIMEOUT,        timeout);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS,      5L);
    curl_easy_setopt(curl, CURLOPT_MAXFILESIZE,    5L*1024L*1024L); // 5 MB cap — prevents hanging on PDFs/videos
    curl_easy_setopt(curl, CURLOPT_USERAGENT,
        "AngkorSearchBot/2.0 (+https://angkorsearch.com.kh/bot)");

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Accept: text/html,application/json");
    if (!extraHeader.empty())
        headers = curl_slist_append(headers, extraHeader.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    CURLcode res = curl_easy_perform(curl);
    long httpCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    // Only accept success or permanent redirect
    if (res != CURLE_OK || (httpCode != 200 && httpCode != 301)) return "";
    return response;
}

// Send a HEAD request and return the Content-Type header (no body downloaded).
// Used to skip PDFs, ZIPs, images before wasting bandwidth on a full GET.
std::string headContentType(const std::string& url, long timeout=5) {
    CURL* curl=curl_easy_init(); if(!curl) return "";
    curl_easy_setopt(curl, CURLOPT_URL,            url.c_str());
    curl_easy_setopt(curl, CURLOPT_NOBODY,         1L); // HEAD only — no response body
    curl_easy_setopt(curl, CURLOPT_TIMEOUT,        timeout);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS,      3L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT,
        "AngkorSearchBot/2.0 (+https://angkorsearch.com.kh/bot)");
    curl_easy_perform(curl);
    char* ctPtr=nullptr;
    curl_easy_getinfo(curl, CURLINFO_CONTENT_TYPE, &ctPtr);
    std::string ct = ctPtr ? ctPtr : "";
    curl_easy_cleanup(curl);
    return ct;
}

// Returns true if the Content-Type is HTML or plain text (safe to crawl).
// Empty Content-Type = unknown = assume crawlable to avoid skipping valid pages.
bool isCrawlableContentType(const std::string& ct) {
    if (ct.empty()) return true;
    return ct.find("text/html")         != std::string::npos ||
           ct.find("application/xhtml") != std::string::npos ||
           ct.find("text/plain")        != std::string::npos;
}

// ─────────────────────────────────────────
// HTML Parsing — using Google's Gumbo parser
// Extracts: title, description, body text,
//           links, images, video embeds, meta tags
// ─────────────────────────────────────────
struct ParsedPage {
    std::string title, description, text, ogImage, twitterImage, publishedAt, author;
    std::vector<std::string> links;
    std::vector<std::pair<std::string,std::string>> images; // {url, alt_text}
    std::vector<std::string> videoUrls;
    std::vector<std::pair<std::string,std::string>> socialUrls; // {platform, url}
};

// Recursively walk DOM tree and collect visible text,
// skipping script/style/nav/footer nodes
void walkText(GumboNode* node, std::string& text) {
    if (!node) return;
    if (node->type == GUMBO_NODE_TEXT) { text += node->v.text.text; text += " "; return; }
    if (node->type != GUMBO_NODE_ELEMENT) return;
    GumboTag tag = node->v.element.tag;
    // Skip non-content tags
    if (tag==GUMBO_TAG_SCRIPT||tag==GUMBO_TAG_STYLE||tag==GUMBO_TAG_NAV||tag==GUMBO_TAG_FOOTER) return;
    GumboVector* ch = &node->v.element.children;
    for (unsigned i=0;i<ch->length;i++) walkText((GumboNode*)ch->data[i], text);
}

// Recursively find the <title> element and return its text
std::string getTitle(GumboNode* node) {
    if (!node || node->type != GUMBO_NODE_ELEMENT) return "";
    if (node->v.element.tag == GUMBO_TAG_TITLE) {
        std::string t; walkText(node, t); return t;
    }
    GumboVector* ch = &node->v.element.children;
    for (unsigned i=0;i<ch->length;i++) {
        std::string t=getTitle((GumboNode*)ch->data[i]);
        if (!t.empty()) return t;
    }
    return "";
}

// Collect all absolute <a href> links from the page
void walkLinks(GumboNode* node, std::vector<std::string>& links) {
    if (!node || node->type != GUMBO_NODE_ELEMENT) return;
    if (node->v.element.tag == GUMBO_TAG_A) {
        GumboAttribute* href = gumbo_get_attribute(&node->v.element.attributes, "href");
        if (href && href->value) {
            std::string h(href->value);
            if (h.substr(0,4)=="http") links.push_back(h); // only absolute URLs
        }
    }
    GumboVector* ch = &node->v.element.children;
    for (unsigned i=0;i<ch->length;i++) walkLinks((GumboNode*)ch->data[i], links);
}

// Collect all <img src> and lazy-loaded <img data-src/data-lazy-src/srcset> with alt text.
// Also picks up profile/avatar/banner images that sites lazy-load via various data attributes.
void walkImages(GumboNode* node, std::vector<std::pair<std::string,std::string>>& images) {
    if (!node || node->type != GUMBO_NODE_ELEMENT) return;
    if (node->v.element.tag == GUMBO_TAG_IMG) {
        GumboAttribute* alt = gumbo_get_attribute(&node->v.element.attributes, "alt");
        std::string a = alt ? alt->value : "";

        // Helper lambda: push if absolute URL and not already seen
        auto push = [&](const char* val) {
            if (!val) return;
            std::string s(val);
            if (s.substr(0,4)=="http") images.push_back({s, a});
        };

        // Standard src
        GumboAttribute* src = gumbo_get_attribute(&node->v.element.attributes, "src");
        if (src) push(src->value);

        // Common lazy-load variants
        for (const char* attr : {"data-src","data-lazy-src","data-original","data-lazy"}) {
            GumboAttribute* ds = gumbo_get_attribute(&node->v.element.attributes, attr);
            if (ds && ds->value) { push(ds->value); break; }
        }

        // srcset — take the first URL (highest quality listed first on most sites)
        GumboAttribute* ss = gumbo_get_attribute(&node->v.element.attributes, "srcset");
        if (ss && ss->value) {
            std::string first(ss->value);
            auto sp = first.find(' '); if (sp!=std::string::npos) first=first.substr(0,sp);
            auto cm = first.find(','); if (cm!=std::string::npos) first=first.substr(0,cm);
            push(first.c_str());
        }
    }
    GumboVector* ch = &node->v.element.children;
    for (unsigned i=0;i<ch->length;i++) walkImages((GumboNode*)ch->data[i], images);
}

// Extract Open Graph meta tags (og:image, og:description),
// article metadata, and YouTube iframe embeds
void walkMeta(GumboNode* node, ParsedPage& page) {
    if (!node || node->type != GUMBO_NODE_ELEMENT) return;
    if (node->v.element.tag == GUMBO_TAG_META) {
        GumboAttribute* name    = gumbo_get_attribute(&node->v.element.attributes, "name");
        GumboAttribute* prop    = gumbo_get_attribute(&node->v.element.attributes, "property");
        GumboAttribute* content = gumbo_get_attribute(&node->v.element.attributes, "content");
        if (!content || !content->value) return;
        std::string val(content->value);
        if (name) {
            std::string n(name->value);
            if(n=="description")                               page.description=val.substr(0,300);
            if(n=="author")                                    page.author=val;
            // Twitter Card meta tags — profile pages use these for avatar/cover images
            if(n=="twitter:image"&&page.twitterImage.empty())  page.twitterImage=val;
            if(n=="twitter:image:src"&&page.twitterImage.empty()) page.twitterImage=val;
            if(n=="twitter:title"&&page.title.empty())         page.title=val;
            if(n=="twitter:description"&&page.description.empty()) page.description=val.substr(0,300);
        }
        if (prop) {
            std::string p(prop->value);
            if(p=="og:image")                                  page.ogImage=val;
            if(p=="og:description"&&page.description.empty())  page.description=val.substr(0,300);
            if(p=="article:published_time")                    page.publishedAt=val;
            if(p=="article:author")                            page.author=val;
        }
    }
    // Extract social media links from <a href> — Facebook, YouTube, TikTok, Telegram, Twitter/X
    if (node->v.element.tag == GUMBO_TAG_A) {
        GumboAttribute* href = gumbo_get_attribute(&node->v.element.attributes, "href");
        if (href && href->value) {
            std::string h(href->value);
            static const std::vector<std::pair<std::string,std::string>> socialPatterns = {
                {"facebook.com/",   "facebook"},
                {"fb.com/",         "facebook"},
                {"youtube.com/",    "youtube"},
                {"youtu.be/",       "youtube"},
                {"tiktok.com/",     "tiktok"},
                {"t.me/",           "telegram"},
                {"telegram.me/",    "telegram"},
                {"twitter.com/",    "twitter"},
                {"x.com/",          "twitter"},
                {"instagram.com/",  "instagram"},
                {"linkedin.com/",   "linkedin"},
            };
            for (const auto& [pattern, platform] : socialPatterns) {
                if (h.find(pattern) != std::string::npos) {
                    page.socialUrls.push_back({platform, h});
                    break;
                }
            }
        }
    }
    // Detect embedded YouTube videos via <iframe src="...youtube.com/embed/...">
    if (node->v.element.tag == GUMBO_TAG_IFRAME) {
        GumboAttribute* src = gumbo_get_attribute(&node->v.element.attributes, "src");
        if (src && src->value) {
            std::string s(src->value);
            if(s.find("youtube.com/embed")!=std::string::npos ||
               s.find("youtu.be")!=std::string::npos)
                page.videoUrls.push_back(s);
        }
    }
    GumboVector* ch = &node->v.element.children;
    for (unsigned i=0;i<ch->length;i++) walkMeta((GumboNode*)ch->data[i], page);
}

// Full HTML parse: builds a ParsedPage from raw HTML string
ParsedPage parseHTML(const std::string& html, const std::string& url) {
    ParsedPage page;
    GumboOutput* out = gumbo_parse(html.c_str());
    if (!out) return page;

    page.title = getTitle(out->root);
    walkText(out->root, page.text);
    walkLinks(out->root, page.links);
    walkImages(out->root, page.images);
    walkMeta(out->root, page);

    // Normalize whitespace: collapse tabs/newlines/spaces into single spaces
    std::string clean; bool sp=false;
    for (char c : page.text) {
        if (c=='\n'||c=='\t'||c=='\r') c=' ';
        if (c==' '&&sp) continue;
        clean+=c; sp=(c==' ');
    }
    page.text = clean.substr(0, 100000); // cap at 100k chars

    gumbo_destroy_output(&kGumboDefaultOptions, out);
    return page;
}

// ─────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────

// Normalize a URL: lowercase scheme+host, strip tracking params, remove trailing slash.
// Prevents indexing example.com/page and example.com/page/ as two separate pages.
std::string normalizeURL(const std::string& url) {
    if (url.empty()) return url;
    std::string r = url;

    // 1. Lowercase scheme and host
    auto sse = r.find("://"); if (sse==std::string::npos) return url;
    for (size_t i=0; i<=sse+2; i++) r[i]=tolower(r[i]);
    size_t hs=sse+3;
    size_t ps=r.find('/',hs); if (ps==std::string::npos) ps=r.find('?',hs);
    size_t he=(ps!=std::string::npos)?ps:r.size();
    for (size_t i=hs; i<he; i++) r[i]=tolower(r[i]);

    // 2. Strip tracking params (utm_*, fbclid, gclid, _ga, _gl)
    auto qp=r.find('?');
    if (qp!=std::string::npos) {
        std::string path=r.substr(0,qp), qs=r.substr(qp+1), clean;
        std::istringstream ss(qs); std::string tok;
        while (std::getline(ss,tok,'&')) {
            if (tok.empty()) continue;
            std::string key=tok.substr(0,tok.find('='));
            if (key.find("utm_")==0||key=="fbclid"||key=="gclid"||key=="_ga"||key=="_gl") continue;
            if (!clean.empty()) clean+='&'; clean+=tok;
        }
        r=path+(clean.empty()?"":"?"+clean);
    }

    // 3. Strip trailing slash — but keep root slash (https://example.com/)
    if (r.back()=='/') {
        size_t rps=r.find('/',sse+3);
        if (rps!=std::string::npos && rps<r.size()-1) r.pop_back();
    }
    return r;
}

// Pull hostname from a URL, e.g. "https://example.com/path" → "example.com"
std::string extractDomain(const std::string& url) {
    std::regex re(R"(https?://([^/]+))");
    std::smatch m;
    if (std::regex_search(url, m, re)) return m[1].str();
    return url;
}

// Language detection: count confirmed Khmer sequences vs Latin chars.
// Old code checked byte 0xE1 alone — false positive since Vietnamese and Greek also use E1 lead byte.
// Khmer U+1780–U+17FF → UTF-8: E1 9E xx or E1 9F xx specifically.
// Requires at least 3% of text to be Khmer to classify as "km".
std::string detectLang(const std::string& text) {
    int kh=0, la=0;
    for (size_t i=0; i<text.size(); i++) {
        unsigned char c=(unsigned char)text[i];
        if (c==0xE1 && i+1<text.size()) {
            unsigned char c2=(unsigned char)text[i+1];
            if (c2==0x9E||c2==0x9F) { kh++; i+=2; continue; } // confirmed Khmer codepoint
        }
        if ((c>='a'&&c<='z')||(c>='A'&&c<='Z')) la++;
    }
    int total=kh+la;
    float khPct=total>0?(float)kh/total:0.0f;
    if (kh>la && khPct>=0.03f) return "km";
    if (la>kh) return "en";
    return "mixed";
}

// Extract file extension from URL, lowercased, without query string
std::string fileExtension(const std::string& url) {
    auto pos=url.rfind('.'); if(pos==std::string::npos) return "";
    std::string ext=url.substr(pos+1);
    auto q=ext.find('?'); if(q!=std::string::npos) ext=ext.substr(0,q);
    std::transform(ext.begin(),ext.end(),ext.begin(),::tolower);
    return ext;
}

// Returns true if the URL points to a common image format
bool isImageUrl(const std::string& url) {
    std::string ext=fileExtension(url);
    return ext=="jpg"||ext=="jpeg"||ext=="png"||ext=="gif"||ext=="webp"||ext=="svg";
}

// Returns true if the domain is Cambodian or in our custom whitelist.
// Used to decide whether to index a URL or skip it.
bool isCambodianDomain(const std::string& domain) {
    // Keyword-based: .kh TLD or known Cambodian news/culture site names
    static const std::vector<std::string> camboKeywords = {
        ".kh","cambodia","khmer","kampuchea","phnompenh","angkor","mekong",
        "khmertimes","phnompenhpost","thmey11","dap-news","voacambodia","rfa.org",
        "freshnews","sabay","postkhmer","cambodiadaily","cambodianess"
    };
    for (const auto& kw : camboKeywords) if(domain.find(kw)!=std::string::npos) return true;

    // Custom domain whitelist — anime, Wikipedia Cambodia, popular sites, dev platforms
    static const std::vector<std::string> customDomains = {
        "mekongtunnel","mekongtunnel-dev.vercel.app",
        // Developer platforms (Cambodian devs indexed here)
        "gitlab.com",
        // Anime
        "9anime","gogoanime","animesuge","zoro.to","animixplay","crunchyroll","animedao",
        "myanimelist.net","animenewsnetwork.com","anilist.co",
        // Wikipedia (for Cambodia/anime/history articles seeded directly)
        "en.wikipedia.org",
        // Popular Cambodian sites
        "khmer24.com","tourismcambodia.com","cambodia.org","wondersofcambodia.com",
    };
    for (const auto& d : customDomains) if(domain.find(d)!=std::string::npos) return true;
    return false;
}

// Minimal JSON string field extractor: finds "key":"value" patterns.
// Not a full JSON parser — only works for flat string fields.
std::string parseJsonField(const std::string& json, const std::string& key) {
    std::string search="\""+key+"\":\"";
    auto pos=json.find(search); if(pos==std::string::npos) return "";
    pos+=search.size(); auto end=json.find('"',pos); if(end==std::string::npos) return "";
    return json.substr(pos,end-pos);
}

// Minimal JSON integer extractor: finds "key":123 patterns.
int parseJsonInt(const std::string& json, const std::string& key) {
    std::string search="\""+key+"\":";
    auto pos=json.find(search); if(pos==std::string::npos) return 0;
    pos+=search.size(); std::string num;
    while(pos<json.size()&&(std::isdigit(json[pos])||json[pos]=='-')) num+=json[pos++];
    return num.empty()?0:std::stoi(num);
}

// Escape a string for safe inclusion as a JSON value
std::string je(const std::string& s) {
    std::string r;
    for (char c:s) {
        switch(c){
            case '"':  r+="\\\""; break;
            case '\\': r+="\\\\"; break;
            case '\n': r+="\\n";  break;
            case '\r': r+="\\r";  break;
            case '\t': r+="\\t";  break;
            default:   r+=c;
        }
    }
    return r;
}

// Returns today's date as "YYYY-MM-DD" — used as part of per-domain budget Redis keys
std::string today() {
    time_t t = time(nullptr);
    struct tm tm_buf;
    localtime_r(&t, &tm_buf); // thread-safe POSIX variant
    char buf[12];
    snprintf(buf, sizeof(buf), "%04d-%02d-%02d",
             tm_buf.tm_year+1900, tm_buf.tm_mon+1, tm_buf.tm_mday);
    return buf;
}

// FNV-1a 64-bit hash — fast, non-cryptographic, used for content dedup and URL sharding
uint64_t fnv1a(const std::string& s) {
    uint64_t h = 14695981039346656037ULL;
    for (unsigned char c : s) { h ^= c; h *= 1099511628211ULL; }
    return h;
}

// ─────────────────────────────────────────
// Stats — thread-safe atomic counters
// Shared across all Worker threads.
// ─────────────────────────────────────────
struct Stats {
    std::atomic<int> pages{0};   // total pages crawled
    std::atomic<int> images{0};  // total images saved
    std::atomic<int> videos{0};  // total video embeds saved
    std::atomic<int> github{0};  // total GitHub repos indexed
    std::atomic<int> news{0};    // total news articles saved
    std::atomic<int> errors{0};  // total fetch failures
};

// Return type for getNextURL — bundles url, queue_type, and crawl depth together
struct QueueItem { std::string url, qtype; int depth = 0; };

// ─────────────────────────────────────────
// Worker — one instance per thread.
// Each Worker has its own DB and Redis connection
// to avoid contention and connection pool issues.
// ─────────────────────────────────────────
class Worker {
    const Config& cfg;
    Stats&        stats;
    int           workerId; // 1-based ID used in log output
    PGconn*       db    = nullptr;
    redisContext* redis = nullptr;

    // Open a new PostgreSQL connection for this worker
    bool connectDB() {
        std::string c="host="+cfg.dbHost+" port="+cfg.dbPort+
                       " dbname="+cfg.dbName+" user="+cfg.dbUser+
                       " password="+cfg.dbPass;
        db=PQconnectdb(c.c_str());
        return PQstatus(db)==CONNECTION_OK;
    }

    // Open a new Redis connection for this worker
    bool connectRedis() {
        redis=redisConnect(cfg.redisHost.c_str(),cfg.redisPort);
        return redis && !redis->err;
    }

    // Check if a URL has already been crawled (Redis SISMEMBER on "visited" set)
    bool isVisited(const std::string& url) {
        redisReply* r=(redisReply*)redisCommand(redis,"SISMEMBER visited %s",url.c_str());
        bool v=r&&r->integer==1; freeReplyObject(r); return v;
    }

    // Mark a URL as visited (Redis SADD to "visited" set)
    void markVisited(const std::string& url) {
        redisReply* r=(redisReply*)redisCommand(redis,"SADD visited %s",url.c_str());
        freeReplyObject(r);
    }

    // Atomically claim the next uncrawled URL from the PostgreSQL queue.
    // Uses FOR UPDATE SKIP LOCKED so multiple workers don't grab the same row.
    // Returns a QueueItem — url is empty if the queue is exhausted.
    QueueItem getNextURL() {
        std::string sql=
            "UPDATE crawl_queue SET crawled=TRUE, crawled_at=NOW() "
            "WHERE id=(SELECT id FROM crawl_queue "
            "WHERE crawled=FALSE "
            "ORDER BY priority, added_at LIMIT 1 FOR UPDATE SKIP LOCKED) "
            "RETURNING url, queue_type, depth";
        PGresult* res=PQexec(db, sql.c_str());
        QueueItem item;
        if (PQresultStatus(res)==PGRES_TUPLES_OK && PQntuples(res)>0) {
            item.url   = PQgetvalue(res,0,0);
            item.qtype = PQgetvalue(res,0,1);
            item.depth = std::stoi(PQgetvalue(res,0,2));
        }
        PQclear(res);
        return item;
    }

    // Returns true if a domain is a social media walled garden that requires login
    // and returns no useful HTML content to crawlers.
    bool isWalledGarden(const std::string& domain) {
        static const std::vector<std::string> blocked = {
            "facebook.com","fb.com","instagram.com","tiktok.com",
            "twitter.com","x.com","snapchat.com","whatsapp.com",
            "mail.google.com","accounts.google.com","login.",
            "signin.","auth.","oauth."
        };
        for (const auto& b : blocked) if (domain.find(b)!=std::string::npos) return true;
        return false;
    }

    // Fetch and cache robots.txt for a domain in Redis (TTL 24 hours).
    // Returns false if the URL's path is Disallowed for * or AngkorSearchBot.
    // crawlDelayMs is set to the Crawl-delay directive value (0 = not specified).
    bool isAllowedByRobots(const std::string& url, const std::string& domain, int& crawlDelayMs) {
        crawlDelayMs = 0;
        std::string key = "robots:" + domain;
        redisReply* cr = (redisReply*)redisCommand(redis, "GET %s", key.c_str());
        std::string robotsTxt;
        if (cr && cr->type == REDIS_REPLY_STRING) {
            robotsTxt = cr->str;
            // Read cached crawl delay
            redisReply* dr = (redisReply*)redisCommand(redis, "GET robots:delay:%s", domain.c_str());
            if (dr && dr->type == REDIS_REPLY_STRING && dr->len > 0)
                crawlDelayMs = std::stoi(dr->str) * 1000; // robots.txt delay is in seconds
            freeReplyObject(dr);
        } else {
            std::string robotsUrl = "https://" + domain + "/robots.txt";
            robotsTxt = fetchURL(robotsUrl, "", 10);
            if (robotsTxt.empty()) robotsTxt = "OK"; // no robots.txt = fully open
            redisReply* sr = (redisReply*)redisCommand(redis,
                "SETEX %s 86400 %s", key.c_str(), robotsTxt.c_str());
            freeReplyObject(sr);
        }
        freeReplyObject(cr);
        if (robotsTxt == "OK") return true;

        // Extract path from URL for Disallow matching
        std::string path = "/";
        auto p = url.find("://");
        if (p != std::string::npos) {
            p = url.find('/', p + 3);
            if (p != std::string::npos) path = url.substr(p);
        }
        auto q = path.find('?'); if (q != std::string::npos) path = path.substr(0, q);

        bool inOurSection = false;
        std::istringstream ss(robotsTxt);
        std::string line;
        while (std::getline(ss, line)) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (line.empty() || line[0] == '#') continue;
            if (line.find("User-agent:") == 0) {
                std::string agent = line.substr(11);
                while (!agent.empty() && agent[0] == ' ') agent = agent.substr(1);
                inOurSection = (agent == "*" || agent == "AngkorSearchBot");
            } else if (inOurSection && line.find("Disallow:") == 0) {
                std::string dis = line.substr(9);
                while (!dis.empty() && dis[0] == ' ') dis = dis.substr(1);
                if (!dis.empty() && path.find(dis) == 0) return false;
            } else if (inOurSection && line.find("Crawl-delay:") == 0) {
                // Honor the site's requested crawl delay (convert seconds → ms)
                std::string val = line.substr(12);
                while (!val.empty() && val[0] == ' ') val = val.substr(1);
                try {
                    crawlDelayMs = std::stoi(val) * 1000;
                    // Cache so we don't re-parse on every request
                    redisReply* dr = (redisReply*)redisCommand(redis,
                        "SETEX robots:delay:%s 86400 %s", domain.c_str(), val.c_str());
                    freeReplyObject(dr);
                } catch (...) {}
            }
        }
        return true;
    }

    // On first visit to a domain, fetch /sitemap.xml and enqueue all <loc> URLs.
    // Uses Redis set "sitemap_done" so each domain is only processed once.
    void discoverSitemap(const std::string& domain, const std::string& sourceUrl) {
        redisReply* r = (redisReply*)redisCommand(redis,
            "SADD sitemap_done %s", domain.c_str());
        bool isNew = r && r->integer == 1;
        freeReplyObject(r);
        if (!isNew) return;

        std::string sitemapUrl = "https://" + domain + "/sitemap.xml";
        std::string xml = fetchURL(sitemapUrl, "", 10);
        if (xml.empty()) return;

        std::regex locRe("<loc>([^<]+)</loc>");
        std::sregex_iterator it(xml.begin(), xml.end(), locRe), end;
        int count = 0;
        for (; it != end && count < 5000; ++it, ++count) {
            std::string loc = (*it)[1].str();
            if (loc.size() >= 4 && loc.substr(0,4) == "http") {
                std::string ld = extractDomain(loc);
                enqueue(loc, sourceUrl, 1, computePriority(loc, ld), "web");
            }
        }
        if (count > 0)
            std::cout << "[Sitemap] " << domain << " +" << count << " URLs\n";
    }

    // Circuit breaker — returns true if this domain has been blocked after 10 failures.
    // Failure count stored in cb:fail:{domain} (resets after 10 min idle).
    // Block key cb:block:{domain} set for 1 hour once threshold is reached.
    bool isCircuitOpen(const std::string& domain) {
        redisReply* r=(redisReply*)redisCommand(redis,"EXISTS cb:block:%s",domain.c_str());
        bool open=r&&r->integer==1; freeReplyObject(r); return open;
    }

    // Record a fetch failure for a domain. Trips the circuit breaker at 10 failures.
    void recordFetchFailure(const std::string& domain) {
        redisReply* r=(redisReply*)redisCommand(redis,"INCR cb:fail:%s",domain.c_str());
        int fails=r?(int)r->integer:0; freeReplyObject(r);
        if (fails==1) { // first failure — set TTL so counter resets after 10 min of no failures
            redisReply* er=(redisReply*)redisCommand(redis,"EXPIRE cb:fail:%s 600",domain.c_str());
            freeReplyObject(er);
        }
        if (fails>=10) { // trip breaker — block domain for 1 hour
            redisReply* br=(redisReply*)redisCommand(redis,"SETEX cb:block:%s 3600 1",domain.c_str());
            freeReplyObject(br);
            std::cout<<"[CircuitBreaker] "<<domain<<" blocked 1h after "<<fails<<" failures\n";
        }
    }

    // Dynamic priority score (lower = crawled sooner).
    // Signals: Cambodia/Khmer boost, GitHub, short URL, domain authority (pages indexed).
    int computePriority(const std::string& link, const std::string& linkDomain) {
        int score = 5;
        if (isCambodianDomain(linkDomain))                              score -= 2; // Cambodia/Khmer
        if (linkDomain.find("github.com") != std::string::npos)         score -= 1; // GitHub
        if (link.size() < 50)                                           score -= 1; // short = index page
        // Domain authority: domains with 1000+ pages already indexed are trusted
        redisReply* ar = (redisReply*)redisCommand(redis,
            "GET domain:authority:%s", linkDomain.c_str());
        if (ar && ar->type == REDIS_REPLY_STRING && ar->len > 0) {
            try { if (std::stoi(ar->str) >= 1000) score -= 1; } catch (...) {}
        }
        freeReplyObject(ar);
        return std::max(1, std::min(9, score));
    }

    // Add a URL to the crawl queue if it hasn't been visited.
    // Supports URL hash sharding: each node only enqueues URLs assigned to it.
    void enqueue(const std::string& rawUrl, const std::string& source, int depth, int priority=5, const std::string& qtype="web") {
        std::string url = normalizeURL(rawUrl); // normalize before any dedup check
        if (depth>cfg.maxDepth || isVisited(url)) return;
        std::string domain=extractDomain(url);
        // Block social login walls — they return no useful content to crawlers
        if (isWalledGarden(domain)) return;
        // URL hash sharding — each node only owns URLs where fnv1a(url) % totalNodes == nodeId-1
        int totalNodes = std::stoi(cfg.totalNodes);
        if (totalNodes > 1) {
            int assigned = static_cast<int>(fnv1a(url) % totalNodes) + 1;
            if (assigned != std::stoi(cfg.nodeId)) return;
        }
        std::string depthStr=std::to_string(depth), prioStr=std::to_string(priority);
        const char* p[6]={url.c_str(),domain.c_str(),source.c_str(),qtype.c_str(),prioStr.c_str(),depthStr.c_str()};
        PQexecParams(db,
            "INSERT INTO crawl_queue (url,domain,source_url,queue_type,priority,depth) "
            "VALUES ($1,$2,$3,$4,$5::int,$6::int) ON CONFLICT (url) DO NOTHING",
            6,nullptr,p,nullptr,nullptr,0);
    }

    // Write a crawled page to the `pages` table immediately (no batching).
    // maxContent: max chars of body text to store. Use 500 for summary-only (non-priority) pages,
    // 80000 for full Cambodian/news/priority pages. Title+description always saved in full.
    void savePage(const std::string& url, const ParsedPage& page,
                  const std::string& lang, const std::string& pageType,
                  size_t maxContent = 80000) {
        // Content-hash dedup: skip DB write if page text hasn't changed (FNV-1a)
        std::string hashKey = "hash:" + url;
        std::string newHash = std::to_string(fnv1a(page.text));
        redisReply* hr = (redisReply*)redisCommand(redis, "GET %s", hashKey.c_str());
        bool unchanged = hr && hr->type == REDIS_REPLY_STRING && std::string(hr->str) == newHash;
        freeReplyObject(hr);
        if (unchanged) return; // content identical — skip 60-80% of DB writes at scale
        redisReply* hw = (redisReply*)redisCommand(redis, "SET %s %s", hashKey.c_str(), newHash.c_str());
        freeReplyObject(hw);

        std::string domain=extractDomain(url);
        std::string content = page.text.substr(0, maxContent);
        std::string wc=std::to_string(std::count(content.begin(),content.end(),' '));
        const char* p[8]={url.c_str(),domain.c_str(),page.title.c_str(),
            page.description.c_str(),lang.c_str(),
            content.c_str(),wc.c_str(),pageType.c_str()};
        PQexecParams(db,
            "INSERT INTO pages (url,domain,title,description,language,content,word_count,page_type) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7::int,$8) "
            "ON CONFLICT (url) DO UPDATE SET title=$3,description=$4,content=$6,updated_at=NOW()",
            8,nullptr,p,nullptr,nullptr,0);

        // Bump live counter immediately so dashboard shows fresh stats
        PQexec(db,"UPDATE crawler_live SET pages_live=pages_live+1 WHERE id=1");

        // Domain authority: track total pages indexed per domain in Redis
        // Used by computePriority() to boost crawl priority for established domains
        redisReply* ar=(redisReply*)redisCommand(redis,"INCR domain:authority:%s",domain.c_str());
        freeReplyObject(ar);
    }

    // Save social media links found on a page to the `social_links` table.
    // Associates Facebook/YouTube/TikTok/Telegram/Twitter URLs with the crawled domain.
    void saveSocialLinks(const std::string& pageUrl, const std::string& domain,
                         const std::vector<std::pair<std::string,std::string>>& socialUrls) {
        for (const auto& [platform, socialUrl] : socialUrls) {
            const char* p[4]={domain.c_str(), platform.c_str(), socialUrl.c_str(), pageUrl.c_str()};
            PQexecParams(db,
                "INSERT INTO social_links (domain, platform, url, source_page) "
                "VALUES ($1,$2,$3,$4) ON CONFLICT (domain, platform, url) DO NOTHING",
                4,nullptr,p,nullptr,nullptr,0);
        }
    }

    // Save an image reference to the `images` table
    void saveImage(const std::string& imgUrl, const std::string& pageUrl,
                   const std::string& alt, const std::string& lang) {
        std::string domain=extractDomain(imgUrl), ext=fileExtension(imgUrl);
        const char* p[6]={imgUrl.c_str(),pageUrl.c_str(),alt.c_str(),domain.c_str(),lang.c_str(),ext.c_str()};
        PQexecParams(db,
            "INSERT INTO images (url,page_url,alt_text,domain,language,file_type) "
            "VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (url) DO NOTHING",
            6,nullptr,p,nullptr,nullptr,0);
        stats.images++;
    }

    // Extract YouTube video ID from embed/watch/short URLs.
    // Returns "" if not a YouTube URL or ID cannot be determined.
    static std::string extractYouTubeId(const std::string& url) {
        // youtube.com/embed/ID or youtube.com/v/ID
        for (const char* pfx : {"/embed/", "/v/"}) {
            auto p = url.find(pfx);
            if (p != std::string::npos) {
                std::string id = url.substr(p + strlen(pfx));
                auto e = id.find_first_of("?&/");
                return e != std::string::npos ? id.substr(0, e) : id;
            }
        }
        // youtu.be/ID
        auto yb = url.find("youtu.be/");
        if (yb != std::string::npos) {
            std::string id = url.substr(yb + 9);
            auto e = id.find_first_of("?&/");
            return e != std::string::npos ? id.substr(0, e) : id;
        }
        // youtube.com/watch?v=ID
        auto wv = url.find("v=");
        if (wv != std::string::npos && url.find("youtube.com") != std::string::npos) {
            std::string id = url.substr(wv + 2);
            auto e = id.find_first_of("&/?");
            return e != std::string::npos ? id.substr(0, e) : id;
        }
        return "";
    }

    // Save a video (YouTube embed or oEmbed result) to the `videos` table.
    // Automatically constructs YouTube thumbnail URL from video ID.
    void saveVideo(const std::string& videoUrl, const std::string& title,
                   const std::string& desc, const std::string& lang,
                   const std::string& thumbOverride = "") {
        std::string domain = extractDomain(videoUrl);
        // Build thumbnail URL: prefer explicit override, then derive from YouTube ID
        std::string thumb = thumbOverride;
        if (thumb.empty()) {
            std::string vid = extractYouTubeId(videoUrl);
            if (!vid.empty())
                thumb = "https://img.youtube.com/vi/" + vid + "/maxresdefault.jpg";
        }
        const char* p[6]={videoUrl.c_str(),title.c_str(),desc.c_str(),domain.c_str(),lang.c_str(),thumb.c_str()};
        PQexecParams(db,
            "INSERT INTO videos (url,title,description,domain,language,thumb_url) "
            "VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (url) DO UPDATE SET thumb_url=EXCLUDED.thumb_url",
            6,nullptr,p,nullptr,nullptr,0);
        stats.videos++;
    }

    // Fetch TikTok/Twitter/Spotify oEmbed thumbnail — no login required.
    // Returns thumbnail URL string, or "" on failure.
    std::string fetchOEmbedThumb(const std::string& videoUrl) {
        std::string oembedUrl;
        if (videoUrl.find("tiktok.com") != std::string::npos)
            oembedUrl = "https://www.tiktok.com/oembed?url=" + videoUrl;
        else if (videoUrl.find("twitter.com") != std::string::npos ||
                 videoUrl.find("x.com") != std::string::npos)
            oembedUrl = "https://publish.twitter.com/oembed?url=" + videoUrl;
        else if (videoUrl.find("open.spotify.com") != std::string::npos)
            oembedUrl = "https://open.spotify.com/oembed?url=" + videoUrl;
        else return "";

        std::string json = fetchURL(oembedUrl);
        if (json.empty()) return "";
        // Quick JSON extract: find "thumbnail_url":"VALUE"
        auto pos = json.find("\"thumbnail_url\"");
        if (pos == std::string::npos) return "";
        auto q1 = json.find('"', pos + 16); if (q1 == std::string::npos) return "";
        auto q2 = json.find('"', q1 + 1);   if (q2 == std::string::npos) return "";
        return json.substr(q1 + 1, q2 - q1 - 1);
    }

    // Save a news article to the dedicated `news` table (separate from general pages)
    void saveNews(const std::string& url, const ParsedPage& page, const std::string& lang) {
        std::string source=extractDomain(url);
        const char* p[7]={url.c_str(),page.title.c_str(),page.description.c_str(),
            page.text.substr(0,5000).c_str(),page.ogImage.c_str(),source.c_str(),lang.c_str()};
        PQexecParams(db,
            "INSERT INTO news (url,title,description,content,image_url,source,language) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (url) DO NOTHING",
            7,nullptr,p,nullptr,nullptr,0);
        stats.news++;
    }

    // Save a GitHub repo to the `github_repos` table.
    // Called by the standalone GitHub crawler — NOT used during normal web crawl.
    // TODO: hook this into the main web crawl when GitHub website indexing is re-enabled
    void saveGithubRepo(const std::string& repoUrl, const std::string& name,
                        const std::string& fullName, const std::string& desc,
                        const std::string& lang, int stars, int forks, const std::string& owner) {
        std::string ss=std::to_string(stars), fs=std::to_string(forks);
        const char* p[8]={repoUrl.c_str(),name.c_str(),fullName.c_str(),desc.c_str(),lang.c_str(),ss.c_str(),fs.c_str(),owner.c_str()};
        PQexecParams(db,
            "INSERT INTO github_repos (repo_url,name,full_name,description,language,stars,forks,owner) "
            "VALUES ($1,$2,$3,$4,$5,$6::int,$7::int,$8) ON CONFLICT (repo_url) DO UPDATE SET stars=$6::int",
            8,nullptr,p,nullptr,nullptr,0);
        stats.github++;
    }

    // Add a search suggestion derived from a page title.
    // ON CONFLICT increments the count so popular terms surface in autocomplete.
    void addSuggestion(const std::string& query, const std::string& lang) {
        if (query.size()<2||query.size()>100) return;
        const char* p[2]={query.c_str(),lang.c_str()};
        PQexecParams(db,
            "INSERT INTO suggestions (query,normalized,language,source) VALUES ($1,lower($1),$2,'crawl') "
            "ON CONFLICT (query) DO UPDATE SET count=suggestions.count+1,updated_at=NOW()",
            2,nullptr,p,nullptr,nullptr,0);
    }

    // Determine content category based on URL and domain
    std::string pageTypeFromUrl(const std::string& url, const std::string& domain) {
        if (url.find("github.com")!=std::string::npos) return "github";
        if (url.find("gitlab.com")!=std::string::npos) return "github"; // stored in same table
        if (domain.find("youtube.com")!=std::string::npos) return "video";
        // Known Cambodian news outlets → classify as "news" for dedicated indexing
        static const std::vector<std::string> newsDomains={
            "phnompenhpost","khmertimes","rfa.org","voacambodia",
            "dap-news","freshnews","thmey11","cambodiadaily","cambodianess","kohsantepheap","postkhmer","sabay"
        };
        for (const auto& nd : newsDomains) if(domain.find(nd)!=std::string::npos) return "news";
        return "web";
    }

public:
    Worker(const Config& c, Stats& s, int id) : cfg(c), stats(s), workerId(id) {}

    // Main crawl loop — runs until global page count hits maxPages
    void run() {
        if (!connectDB() || !connectRedis()) {
            std::cerr << "[Worker " << workerId << "] Failed to connect\n";
            return;
        }
        std::cout << "[Worker " << workerId << "] Started\n";

        while (stats.pages < cfg.maxPages) {
            // Force-crawl: pop from Redis list fed by POST /admin/queue (pub/sub substitute).
            // Priority=0 jumps ahead of all seeded URLs in the DB queue.
            {
                redisReply* fr=(redisReply*)redisCommand(redis,"RPOP crawl:force");
                if (fr && fr->type==REDIS_REPLY_STRING) {
                    std::string fu=normalizeURL(std::string(fr->str,fr->len));
                    freeReplyObject(fr);
                    if (!fu.empty() && !isVisited(fu)) {
                        std::string fd=extractDomain(fu);
                        if (!isWalledGarden(fd)) enqueue(fu,"force",0,0,"web");
                    }
                } else { freeReplyObject(fr); }
            }

            // Claim next URL atomically (FOR UPDATE SKIP LOCKED prevents double-crawl)
            auto item = getNextURL();

            if (item.url.empty()) {
                // Queue is exhausted — wait briefly and retry
                std::this_thread::sleep_for(std::chrono::milliseconds(500));
                continue;
            }
            // Guard against race where another worker already visited this URL
            if (isVisited(item.url)) continue;

            std::string domain = extractDomain(item.url);

            // Circuit breaker — skip domains blocked after 10+ consecutive failures
            if (isCircuitOpen(domain)) { markVisited(item.url); continue; }

            // Domain crawl budget — skip if we've already hit MAX_DOMAIN_PAGES today
            {
                std::string bkey = "budget:" + domain + ":" + today();
                redisReply* br=(redisReply*)redisCommand(redis,"GET %s",bkey.c_str());
                int used=(br&&br->type==REDIS_REPLY_STRING&&br->len>0)?std::stoi(br->str):0;
                freeReplyObject(br);
                if (used >= cfg.maxDomainPages) continue; // budget exhausted for today
            }

            // Per-domain cooldown — if another worker hit this domain in the last 2s, wait
            {
                redisReply* r = (redisReply*)redisCommand(redis,
                    "SET crawl:last:%s 1 NX PX 2000", domain.c_str());
                bool onCooldown = !(r && r->type == REDIS_REPLY_STATUS);
                freeReplyObject(r);
                if (onCooldown)
                    std::this_thread::sleep_for(std::chrono::milliseconds(2000));
            }

            // robots.txt compliance — also captures Crawl-delay directive
            int robotsDelay = 0;
            if (!isAllowedByRobots(item.url, domain, robotsDelay)) {
                markVisited(item.url);
                continue;
            }

            markVisited(item.url);

            // Sitemap discovery — runs once per domain, enqueues all <loc> URLs
            discoverSitemap(domain, item.url);

            // Content-type HEAD check — skip PDFs, ZIPs, images before downloading.
            // Only fires for non-obvious extensions (skips the check for .html, .php, etc.)
            {
                std::string ext = fileExtension(item.url);
                bool knownHtml = (ext=="html"||ext=="htm"||ext=="php"||ext=="asp"||ext=="aspx"||ext.empty());
                if (!knownHtml && !isCrawlableContentType(headContentType(item.url))) {
                    markVisited(item.url);
                    continue;
                }
            }

            // Fetch with timing — log slow fetches (>3s) for visibility
            auto t0 = std::chrono::steady_clock::now();
            std::string html = fetchURL(item.url);
            long fetchMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - t0).count();

            if (html.empty()) {
                stats.errors++;
                recordFetchFailure(domain);
                if (fetchMs > 3000)
                    std::cout << "[Slow/Fail] " << domain << " " << fetchMs << "ms\n";
                continue;
            }

            ParsedPage  page     = parseHTML(html, item.url);
            std::string lang     = detectLang(page.text);
            std::string pageType = pageTypeFromUrl(item.url, domain);
            int n = ++stats.pages; // atomic — safe across threads

            // Smart content cap: full text for Cambodian/news/shallow pages, summary-only for others.
            // Summary-only still stores title + description — enough to be searchable via FTS/ILIKE.
            bool isPriority = isCambodianDomain(domain) || pageType=="news" || item.depth <= 2;
            size_t contentCap = isPriority ? 80000 : 500;

            // ── Persist to DB immediately (no batching) ──
            savePage(item.url, page, lang, pageType, contentCap);

            // Increment domain crawl budget for today (resets at midnight via 86400s TTL)
            {
                std::string bkey = "budget:" + domain + ":" + today();
                redisReply* br=(redisReply*)redisCommand(redis,"INCR %s",bkey.c_str());
                if (br && br->integer==1) { // first page today — set daily TTL
                    redisReply* er=(redisReply*)redisCommand(redis,"EXPIRE %s 86400",bkey.c_str());
                    freeReplyObject(er);
                }
                freeReplyObject(br);
            }

            // News domains also get written to the dedicated news table
            if (pageType=="news" && !page.title.empty())
                saveNews(item.url, page, lang);

            // Save page images from any crawled page
            for (const auto& [imgUrl, alt] : page.images)
                saveImage(imgUrl, item.url, alt, lang);

            // Also index the Open Graph featured image
            if (!page.ogImage.empty())
                saveImage(page.ogImage, item.url, page.title, lang);

            // Twitter Card image — profile pages (GitHub, LinkedIn, personal sites) use this
            // for avatar/banner. Save separately so image search captures it.
            if (!page.twitterImage.empty() && page.twitterImage != page.ogImage)
                saveImage(page.twitterImage, item.url, page.title, lang);

            // Save social media links discovered on this page
            if (!page.socialUrls.empty())
                saveSocialLinks(item.url, domain, page.socialUrls);

            // Index embedded YouTube videos (thumbnail auto-derived from video ID)
            for (const auto& vUrl : page.videoUrls)
                saveVideo(vUrl, page.title, page.description, lang);

            // oEmbed: for TikTok/Twitter/Spotify links found on this page,
            // fetch their thumbnail via oEmbed API (no login needed) and save as videos.
            for (const auto& [platform, socialUrl] : page.socialUrls) {
                if (platform == "tiktok" || platform == "twitter" || platform == "youtube") {
                    // Only index video-style URLs (not profile pages)
                    bool isVideo = socialUrl.find("/video/") != std::string::npos ||
                                   socialUrl.find("/watch?v=") != std::string::npos ||
                                   socialUrl.find("youtu.be/") != std::string::npos ||
                                   socialUrl.find("/status/") != std::string::npos;
                    if (isVideo) {
                        std::string thumb = fetchOEmbedThumb(socialUrl);
                        saveVideo(socialUrl, page.title, page.description, lang, thumb);
                    }
                }
            }

            // Generate autocomplete suggestion from page title
            addSuggestion(page.title.substr(0, 80), lang);

            // Enqueue outbound links — frontier scoring + correct depth propagation
            for (const auto& link : page.links) {
                std::string ld = extractDomain(link);
                enqueue(link, item.url, item.depth + 1, computePriority(link, ld), "web");
            }

            // Progress log every 25 pages per worker (includes last fetch timing)
            if (n % 25 == 0) {
                std::cout << "[Node " << cfg.nodeId << " W" << workerId << "]"
                          << " pages=" << stats.pages
                          << " img="   << stats.images
                          << " vid="   << stats.videos
                          << " news="  << stats.news
                          << " errs="  << stats.errors
                          << " last="  << fetchMs << "ms\n";
            }
            if (fetchMs > 3000)
                std::cout << "[Slow] " << domain << " " << fetchMs << "ms\n";

            // Polite crawl delay — robots.txt Crawl-delay takes priority over our defaults
            int delay = robotsDelay > 0 ? robotsDelay :
                        (item.qtype=="github") ? cfg.githubDelay : cfg.crawlDelay;
            std::this_thread::sleep_for(std::chrono::milliseconds(delay));
        }

        // Release connections when this worker exits
        if (db)    PQfinish(db);
        if (redis) redisFree(redis);
    }
};

// ─────────────────────────────────────────
// Developer Platform Crawlers
//
// GitHub: finds ALL Cambodian developers by location + keyword repo search.
//         For each developer found, fetches their full repo list.
// GitLab: searches for Cambodia/Khmer projects and users on gitlab.com.
//
// Both write to the `github_repos` table (repo_url distinguishes the source).
// Only runs on NODE_ID="1" to avoid burning API quota on every container.
// ─────────────────────────────────────────

// Save a single repo row (GitHub or GitLab) to the github_repos table.
static void saveRepo(PGconn* db, Stats& stats,
                     const std::string& repoUrl, const std::string& name,
                     const std::string& fullName, const std::string& desc,
                     const std::string& lang, int stars, int forks,
                     const std::string& owner) {
    if (repoUrl.empty() || name.empty()) return;
    std::string ss=std::to_string(stars), fs=std::to_string(forks);
    std::string src = (repoUrl.find("gitlab.com") != std::string::npos) ? "gitlab" : "github";
    const char* p[9]={repoUrl.c_str(),name.c_str(),fullName.c_str(),desc.c_str(),
                      lang.c_str(),ss.c_str(),fs.c_str(),owner.c_str(),src.c_str()};
    PQexecParams(db,
        "INSERT INTO github_repos (repo_url,name,full_name,description,language,stars,forks,owner,source) "
        "VALUES ($1,$2,$3,$4,$5,$6::int,$7::int,$8,$9) ON CONFLICT (repo_url) DO UPDATE SET stars=$6::int,source=$9",
        9,nullptr,p,nullptr,nullptr,0);
    stats.github++;
    std::cout << "  [" << (repoUrl.find("gitlab")!=std::string::npos?"GitLab":"GitHub")
              << "] " << fullName << " ★" << stars << "\n";
}

// Fetch and index all public repos for a given GitHub username.
static void crawlGitHubUserRepos(const std::string& login,
                                  const std::string& authHeader,
                                  const Config& cfg, PGconn* db, Stats& stats) {
    std::string apiUrl = "https://api.github.com/users/" + login +
                         "/repos?per_page=100&sort=updated&type=public";
    std::string json = fetchURL(apiUrl, authHeader, 20);
    if (json.empty()) return;

    size_t pos = 0;
    while ((pos = json.find("\"html_url\":", pos)) != std::string::npos) {
        size_t blockStart = json.rfind('{', pos);
        size_t blockEnd   = json.find("\"visibility\"", pos);
        if (blockEnd == std::string::npos) { pos++; continue; }
        std::string block = json.substr(blockStart, blockEnd - blockStart);

        std::string repoUrl  = parseJsonField(block, "html_url");
        if (repoUrl.find("github.com/"+login) == std::string::npos) { pos=blockEnd; continue; }
        saveRepo(db, stats,
                 repoUrl,
                 parseJsonField(block, "name"),
                 parseJsonField(block, "full_name"),
                 parseJsonField(block, "description"),
                 parseJsonField(block, "language"),
                 parseJsonInt(block, "stargazers_count"),
                 parseJsonInt(block, "forks_count"),
                 login);
        pos = blockEnd;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(cfg.githubDelay));
}

void crawlGitHub(const Config& cfg, Stats& stats) {
    if (cfg.nodeId != "1") return;

    std::string authHeader = cfg.githubToken.empty() ? "" :
        "Authorization: token " + cfg.githubToken;
    std::string connStr = "host="+cfg.dbHost+" port="+cfg.dbPort+
                          " dbname="+cfg.dbName+" user="+cfg.dbUser+
                          " password="+cfg.dbPass;
    PGconn* db = PQconnectdb(connStr.c_str());
    if (PQstatus(db) != CONNECTION_OK) { std::cerr<<"[GitHub] DB connect failed\n"; return; }

    // ── Phase A: Repo keyword searches ──────────────────────────────────────
    std::vector<std::string> repoQueries = {
        // Keyword searches
        "https://api.github.com/search/repositories?q=cambodia&sort=stars&per_page=100",
        "https://api.github.com/search/repositories?q=khmer&sort=stars&per_page=100",
        "https://api.github.com/search/repositories?q=angkor&sort=stars&per_page=100",
        "https://api.github.com/search/repositories?q=phnom+penh&sort=stars&per_page=100",
        "https://api.github.com/search/repositories?q=kampuchea&sort=stars&per_page=100",
        // Topic tags
        "https://api.github.com/search/repositories?q=topic:cambodia&sort=stars&per_page=100",
        "https://api.github.com/search/repositories?q=topic:khmer&sort=stars&per_page=100",
        "https://api.github.com/search/repositories?q=topic:phnom-penh&sort=stars&per_page=100",
        // Khmer language code (repos written in Khmer script)
        "https://api.github.com/search/repositories?q=language:khmer&sort=stars&per_page=100",
    };

    for (const auto& apiUrl : repoQueries) {
        std::cout << "[GitHub Repos] " << apiUrl << "\n";
        std::string json = fetchURL(apiUrl, authHeader, 20);
        if (json.empty()) { std::this_thread::sleep_for(std::chrono::milliseconds(cfg.githubDelay)); continue; }

        size_t pos = 0;
        while ((pos = json.find("\"html_url\":", pos)) != std::string::npos) {
            size_t blockStart = json.rfind('{', pos);
            size_t blockEnd   = json.find("\"visibility\"", pos);
            if (blockEnd == std::string::npos) { pos++; continue; }
            std::string block = json.substr(blockStart, blockEnd - blockStart);
            saveRepo(db, stats,
                     parseJsonField(block, "html_url"),
                     parseJsonField(block, "name"),
                     parseJsonField(block, "full_name"),
                     parseJsonField(block, "description"),
                     parseJsonField(block, "language"),
                     parseJsonInt(block, "stargazers_count"),
                     parseJsonInt(block, "forks_count"),
                     parseJsonField(block, "login"));
            pos = blockEnd;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(cfg.githubDelay));
    }

    // ── Phase B: Location-based developer discovery ──────────────────────────
    // Finds ALL Cambodian developers by their GitHub profile location field.
    // Then fetches every public repo for each developer found.
    std::vector<std::string> userQueries = {
        "https://api.github.com/search/users?q=location:Cambodia&per_page=100&sort=joined",
        "https://api.github.com/search/users?q=location:Cambodia&per_page=100&page=2&sort=joined",
        "https://api.github.com/search/users?q=location:Cambodia&per_page=100&page=3&sort=joined",
        "https://api.github.com/search/users?q=location:%22Phnom+Penh%22&per_page=100",
        "https://api.github.com/search/users?q=location:%22Siem+Reap%22&per_page=100",
        "https://api.github.com/search/users?q=location:%22Battambang%22&per_page=100",
        "https://api.github.com/search/users?q=location:Kampuchea&per_page=100",
    };

    for (const auto& apiUrl : userQueries) {
        std::cout << "[GitHub Devs] " << apiUrl << "\n";
        std::string json = fetchURL(apiUrl, authHeader, 20);
        if (json.empty()) { std::this_thread::sleep_for(std::chrono::milliseconds(cfg.githubDelay)); continue; }

        // Extract each developer's login and crawl all their repos
        size_t pos = 0;
        while ((pos = json.find("\"login\":\"", pos)) != std::string::npos) {
            pos += 9;
            auto end = json.find('"', pos);
            if (end == std::string::npos) break;
            std::string login = json.substr(pos, end - pos);
            pos = end;
            if (login.empty() || login == "null") continue;
            std::cout << "  [Dev] " << login << "\n";
            crawlGitHubUserRepos(login, authHeader, cfg, db, stats);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(cfg.githubDelay));
    }

    PQfinish(db);
}

// ─────────────────────────────────────────
// GitLab Crawler
//
// Searches gitlab.com for Cambodia/Khmer projects and Cambodian developers.
// Uses GitLab's public REST API (no token needed for public data).
// Writes to the same `github_repos` table — repo_url distinguishes the source.
// ─────────────────────────────────────────
void crawlGitLab(const Config& cfg, Stats& stats) {
    if (cfg.nodeId != "1") return;

    std::string connStr = "host="+cfg.dbHost+" port="+cfg.dbPort+
                          " dbname="+cfg.dbName+" user="+cfg.dbUser+
                          " password="+cfg.dbPass;
    PGconn* db = PQconnectdb(connStr.c_str());
    if (PQstatus(db) != CONNECTION_OK) { std::cerr << "[GitLab] DB connect failed\n"; return; }

    // GitLab project searches (public API, 60 req/min unauthenticated)
    std::vector<std::string> projectQueries = {
        "https://gitlab.com/api/v4/projects?search=cambodia&order_by=star_count&per_page=100",
        "https://gitlab.com/api/v4/projects?search=khmer&order_by=star_count&per_page=100",
        "https://gitlab.com/api/v4/projects?search=angkor&order_by=star_count&per_page=100",
        "https://gitlab.com/api/v4/projects?search=phnom+penh&order_by=star_count&per_page=100",
        "https://gitlab.com/api/v4/projects?topic=cambodia&order_by=star_count&per_page=100",
        "https://gitlab.com/api/v4/projects?topic=khmer&order_by=star_count&per_page=100",
    };

    for (const auto& apiUrl : projectQueries) {
        std::cout << "[GitLab Projects] " << apiUrl << "\n";
        std::string json = fetchURL(apiUrl, "", 20);
        if (json.empty()) { std::this_thread::sleep_for(std::chrono::milliseconds(cfg.githubDelay)); continue; }

        // GitLab project objects use "web_url" and "path_with_namespace"
        size_t pos = 0;
        while ((pos = json.find("\"web_url\":\"https://gitlab.com/", pos)) != std::string::npos) {
            size_t blockStart = json.rfind(',', pos);
            if (blockStart == std::string::npos || json[blockStart+1] != '{')
                blockStart = json.rfind('{', pos);
            // Find block end: next top-level object boundary
            size_t blockEnd = json.find(",{\"id\":", pos);
            if (blockEnd == std::string::npos) blockEnd = json.size();
            std::string block = json.substr(blockStart, blockEnd - blockStart);

            std::string webUrl   = parseJsonField(block, "web_url");
            std::string name     = parseJsonField(block, "name");
            std::string fullName = parseJsonField(block, "path_with_namespace");
            std::string desc     = parseJsonField(block, "description");
            int stars = parseJsonInt(block, "star_count");
            int forks = parseJsonInt(block, "forks_count");

            // Owner is the first segment of path_with_namespace
            std::string owner = fullName;
            auto slash = owner.find('/');
            if (slash != std::string::npos) owner = owner.substr(0, slash);

            saveRepo(db, stats, webUrl, name, fullName, desc, "", stars, forks, owner);
            pos = blockEnd;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(cfg.githubDelay));
    }

    // GitLab user searches — find Cambodian developers by name/location
    std::vector<std::string> userQueries = {
        "https://gitlab.com/api/v4/users?search=cambodia&per_page=100",
        "https://gitlab.com/api/v4/users?search=khmer&per_page=100",
    };

    for (const auto& apiUrl : userQueries) {
        std::cout << "[GitLab Devs] " << apiUrl << "\n";
        std::string json = fetchURL(apiUrl, "", 20);
        if (json.empty()) { std::this_thread::sleep_for(std::chrono::milliseconds(cfg.githubDelay)); continue; }

        // For each user found, enqueue their GitLab profile page for full web crawl
        size_t pos = 0;
        while ((pos = json.find("\"web_url\":\"https://gitlab.com/", pos)) != std::string::npos) {
            pos += 11;
            auto end = json.find('"', pos);
            if (end == std::string::npos) break;
            std::string profileUrl = json.substr(pos, end - pos);
            pos = end;
            // Enqueue profile page — crawler will follow links to their projects
            const char* p[3] = {profileUrl.c_str(), "gitlab.com", "github"};
            PQexecParams(db,
                "INSERT INTO crawl_queue (url,domain,queue_type,priority) VALUES ($1,$2,$3,2) "
                "ON CONFLICT (url) DO NOTHING",
                3, nullptr, p, nullptr, nullptr, 0);
            std::cout << "  [GLab Dev] " << profileUrl << "\n";
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(cfg.githubDelay));
    }

    PQfinish(db);
}

// ─────────────────────────────────────────
// Freshness Re-crawl Thread
//
// Runs on NODE_ID="1" only. Wakes every 30 minutes and re-queues up to 500
// pages that haven't been updated in 7+ days at priority=6 (below new content).
// This ensures the index stays fresh without manual intervention.
// ─────────────────────────────────────────
void freshnessRequeueThread(const Config& cfg) {
    if (cfg.nodeId != "1") return;
    std::string connStr = "host="+cfg.dbHost+" port="+cfg.dbPort+
                          " dbname="+cfg.dbName+" user="+cfg.dbUser+
                          " password="+cfg.dbPass;
    while (true) {
        std::this_thread::sleep_for(std::chrono::minutes(30));
        PGconn* db = PQconnectdb(connStr.c_str());
        if (PQstatus(db) != CONNECTION_OK) { PQfinish(db); continue; }

        // Re-queue stale pages — ON CONFLICT resets crawled=FALSE so workers pick them up
        PGresult* res = PQexec(db,
            "INSERT INTO crawl_queue (url,domain,queue_type,priority,depth) "
            "SELECT url,domain,page_type,6,0 FROM pages "
            "WHERE updated_at < NOW() - INTERVAL '7 days' "
            "AND page_type != 'github' "
            "ORDER BY updated_at ASC LIMIT 500 "
            "ON CONFLICT (url) DO UPDATE "
            "SET crawled=FALSE, crawled_at=NULL, priority=6");

        int requeued = 0;
        if (PQresultStatus(res)==PGRES_COMMAND_OK) {
            std::string ct = PQcmdTuples(res);
            if (!ct.empty()) try { requeued=std::stoi(ct); } catch(...) {}
        }
        PQclear(res);
        if (requeued > 0)
            std::cout << "[Freshness] Re-queued " << requeued << " stale pages\n";
        PQfinish(db);
    }
}

// ─────────────────────────────────────────
// Seed Queue
// Copies active rows from the `seeds` table into `crawl_queue` at startup.
// Only NODE_ID="1" runs this to avoid duplicate inserts across containers.
// ─────────────────────────────────────────
void seedQueue(const Config& cfg) {
    if (cfg.nodeId != "1") return;
    std::string c="host="+cfg.dbHost+" port="+cfg.dbPort+
                   " dbname="+cfg.dbName+" user="+cfg.dbUser+
                   " password="+cfg.dbPass;
    PGconn* db=PQconnectdb(c.c_str());
    if (PQstatus(db)!=CONNECTION_OK) return;
    PQexec(db,
        "INSERT INTO crawl_queue (url,domain,queue_type,priority) "
        "SELECT url,domain,seed_type,priority FROM seeds WHERE active=TRUE "
        "ON CONFLICT (url) DO NOTHING");
    PQfinish(db);
    std::cout<<"[Node 1] Seeds loaded\n";
}

// ─────────────────────────────────────────
// main
// ─────────────────────────────────────────
int main() {
    Config cfg;
    std::cout << "AngkorSearch MegaCrawler v2.1 (Parallel)\n";
    std::cout << "Node=" << cfg.nodeId
              << " Threads=" << cfg.nThreads
              << " Target=" << cfg.maxPages << " pages\n\n";

    curl_global_init(CURL_GLOBAL_DEFAULT);

    // Wait for DB to be ready — retry up to 10 times with 5s gaps (50s total)
    for (int i=0;i<10;i++) {
        std::string connStr="host="+cfg.dbHost+" port="+cfg.dbPort+
                             " dbname="+cfg.dbName+" user="+cfg.dbUser+
                             " password="+cfg.dbPass;
        PGconn* db=PQconnectdb(connStr.c_str());
        if (PQstatus(db)==CONNECTION_OK) { PQfinish(db); break; }
        PQfinish(db);
        std::cerr<<"[Crawler] DB not ready, retry "<<i+1<<"/10...\n";
        std::this_thread::sleep_for(std::chrono::seconds(5));
        if (i==9) return 1; // give up
    }

    // Load seed URLs into the crawl queue (node 1 only)
    seedQueue(cfg);

    // Start freshness re-crawl background thread (node 1 only, wakes every 30 min)
    std::thread([&cfg](){ freshnessRequeueThread(cfg); }).detach();

    Stats stats;

    // ── Phase 1: GitHub API Crawl ─────────────────────────
    // Queries GitHub API for Cambodia/Khmer repos, saves to github_repos table.
    // Only runs on NODE_ID=1 to avoid burning API quota.
    std::cout << "\n[Phase 1a] GitHub Crawl — repos + ALL Cambodian developers\n";
    crawlGitHub(cfg, stats);

    std::cout << "\n[Phase 1b] GitLab Crawl — Cambodia/Khmer projects + developers\n";
    crawlGitLab(cfg, stats);

    // ── Phase 2: Parallel Web Crawl ──────────────────────
    std::cout << "\n[Phase 2] Parallel Web Crawl — " << cfg.nThreads << " threads\n";
    std::vector<std::thread> threads;
    threads.reserve(cfg.nThreads);

    // Spin up N worker threads — each owns its own DB/Redis connection
    for (int i=0; i<cfg.nThreads; i++) {
        threads.emplace_back([&cfg, &stats, i](){
            Worker w(cfg, stats, i+1);
            w.run();
        });
    }

    // Block until all workers finish
    for (auto& t : threads) t.join();

    // Final crawl summary
    std::cout << "\n[Crawler] Complete."
              << " pages="  << stats.pages
              << " images=" << stats.images
              << " videos=" << stats.videos
              << " github=" << stats.github
              << " news="   << stats.news
              << " errors=" << stats.errors << "\n";

    curl_global_cleanup();
    return 0;
}