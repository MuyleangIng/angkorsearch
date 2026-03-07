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
#include <cstdlib>
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
    int nThreads    = 8;      // Worker threads per container

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
        nThreads    = std::stoi(e("N_THREADS",    "8"));
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

// ─────────────────────────────────────────
// HTML Parsing — using Google's Gumbo parser
// Extracts: title, description, body text,
//           links, images, video embeds, meta tags
// ─────────────────────────────────────────
struct ParsedPage {
    std::string title, description, text, ogImage, publishedAt, author;
    std::vector<std::string> links;
    std::vector<std::pair<std::string,std::string>> images; // {url, alt_text}
    std::vector<std::string> videoUrls;
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

// Collect all <img src> and lazy-loaded <img data-src> with alt text
void walkImages(GumboNode* node, std::vector<std::pair<std::string,std::string>>& images) {
    if (!node || node->type != GUMBO_NODE_ELEMENT) return;
    if (node->v.element.tag == GUMBO_TAG_IMG) {
        GumboAttribute* src = gumbo_get_attribute(&node->v.element.attributes, "src");
        GumboAttribute* alt = gumbo_get_attribute(&node->v.element.attributes, "alt");
        if (src && src->value) {
            std::string s(src->value), a = alt ? alt->value : "";
            if (s.substr(0,4)=="http" && a.size()>2) images.push_back({s,a});
        }
        // Lazy-loaded images use data-src instead of src
        GumboAttribute* ds = gumbo_get_attribute(&node->v.element.attributes, "data-src");
        if (ds && ds->value) {
            std::string s(ds->value);
            if (s.substr(0,4)=="http") images.push_back({s, alt ? alt->value : ""});
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
            if(n=="description") page.description=val.substr(0,300);
            if(n=="author")      page.author=val;
        }
        if (prop) {
            std::string p(prop->value);
            if(p=="og:image")                                  page.ogImage=val;
            if(p=="og:description"&&page.description.empty())  page.description=val.substr(0,300);
            if(p=="article:published_time")                    page.publishedAt=val;
            if(p=="article:author")                            page.author=val;
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

// Pull hostname from a URL, e.g. "https://example.com/path" → "example.com"
std::string extractDomain(const std::string& url) {
    std::regex re(R"(https?://([^/]+))");
    std::smatch m;
    if (std::regex_search(url, m, re)) return m[1].str();
    return url;
}

// Heuristic language detection: count Khmer byte markers vs Latin characters
std::string detectLang(const std::string& text) {
    int kh=0, la=0;
    for (unsigned char c : text) {
        if(c==0xE1) kh++;                                    // Khmer Unicode lead byte
        else if((c>='a'&&c<='z')||(c>='A'&&c<='Z')) la++;   // ASCII Latin
    }
    if (kh>la) return "km";
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

    // Custom domain whitelist — anime, Wikipedia Cambodia, popular sites
    static const std::vector<std::string> customDomains = {
        "mekongtunnel","mekongtunnel-dev.vercel.app",
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
    // Returns {url, queue_type} — both empty strings if the queue is empty.
    std::pair<std::string,std::string> getNextURL() {
        std::string sql=
            "UPDATE crawl_queue SET crawled=TRUE, crawled_at=NOW() "
            "WHERE id=(SELECT id FROM crawl_queue "
            "WHERE crawled=FALSE "
            "ORDER BY priority, added_at LIMIT 1 FOR UPDATE SKIP LOCKED) "
            "RETURNING url, queue_type";
        PGresult* res=PQexec(db, sql.c_str());
        std::string url, qtype;
        if (PQresultStatus(res)==PGRES_TUPLES_OK && PQntuples(res)>0) {
            url   = PQgetvalue(res,0,0);
            qtype = PQgetvalue(res,0,1);
        }
        PQclear(res);
        return {url,qtype};
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

    // Add a URL to the crawl queue if it hasn't been visited.
    // Priority scheme: Cambodian=3 (high), GitHub=4, all other public sites=7 (low)
    // Walled-garden social networks are blocked entirely (they return login pages).
    void enqueue(const std::string& url, const std::string& source, int depth, int priority=5, const std::string& qtype="web") {
        if (depth>cfg.maxDepth || isVisited(url)) return;
        std::string domain=extractDomain(url);
        // Block social login walls — they return no useful content to crawlers
        if (isWalledGarden(domain)) return;
        std::string depthStr=std::to_string(depth), prioStr=std::to_string(priority);
        const char* p[6]={url.c_str(),domain.c_str(),source.c_str(),qtype.c_str(),prioStr.c_str(),depthStr.c_str()};
        PQexecParams(db,
            "INSERT INTO crawl_queue (url,domain,source_url,queue_type,priority,depth) "
            "VALUES ($1,$2,$3,$4,$5::int,$6::int) ON CONFLICT (url) DO NOTHING",
            6,nullptr,p,nullptr,nullptr,0);
    }

    // Write a crawled page to the `pages` table immediately (no batching).
    // Also bumps the live page counter so the dashboard API shows fresh numbers.
    void savePage(const std::string& url, const ParsedPage& page,
                  const std::string& lang, const std::string& pageType) {
        std::string domain=extractDomain(url);
        std::string wc=std::to_string(std::count(page.text.begin(),page.text.end(),' '));
        const char* p[8]={url.c_str(),domain.c_str(),page.title.c_str(),
            page.description.c_str(),lang.c_str(),
            page.text.substr(0,80000).c_str(),wc.c_str(),pageType.c_str()};
        PQexecParams(db,
            "INSERT INTO pages (url,domain,title,description,language,content,word_count,page_type) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7::int,$8) "
            "ON CONFLICT (url) DO UPDATE SET title=$3,description=$4,content=$6,updated_at=NOW()",
            8,nullptr,p,nullptr,nullptr,0);

        // Bump live counter immediately so dashboard shows fresh stats
        PQexec(db,"UPDATE crawler_live SET pages_live=pages_live+1 WHERE id=1");
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

    // Save a YouTube embed URL to the `videos` table
    void saveVideo(const std::string& videoUrl, const std::string& title,
                   const std::string& desc, const std::string& lang) {
        std::string domain=extractDomain(videoUrl);
        const char* p[5]={videoUrl.c_str(),title.c_str(),desc.c_str(),domain.c_str(),lang.c_str()};
        PQexecParams(db,
            "INSERT INTO videos (url,title,description,domain,language) "
            "VALUES ($1,$2,$3,$4,$5) ON CONFLICT (url) DO NOTHING",
            5,nullptr,p,nullptr,nullptr,0);
        stats.videos++;
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
            // Claim next URL atomically (FOR UPDATE SKIP LOCKED prevents double-crawl)
            auto [url, qtype] = getNextURL();

            if (url.empty()) {
                // Queue is exhausted — wait briefly and retry
                std::this_thread::sleep_for(std::chrono::milliseconds(500));
                continue;
            }
            // Guard against race where another worker already visited this URL
            if (isVisited(url)) continue;
            markVisited(url);

            std::string html = fetchURL(url);
            if (html.empty()) { stats.errors++; continue; }

            std::string domain   = extractDomain(url);
            ParsedPage  page     = parseHTML(html, url);
            std::string lang     = detectLang(page.text);
            std::string pageType = pageTypeFromUrl(url, domain);
            int n = ++stats.pages; // atomic — safe across threads

            // ── Persist to DB immediately (no batching) ──
            savePage(url, page, lang, pageType);

            // News domains also get written to the dedicated news table
            if (pageType=="news" && !page.title.empty())
                saveNews(url, page, lang);

            // Save page images from any crawled page
            for (const auto& [imgUrl, alt] : page.images)
                saveImage(imgUrl, url, alt, lang);

            // Also index the Open Graph featured image
            if (!page.ogImage.empty())
                saveImage(page.ogImage, url, page.title, lang);

            // Index embedded YouTube videos
            for (const auto& vUrl : page.videoUrls)
                saveVideo(vUrl, page.title, page.description, lang);

            // Generate autocomplete suggestion from page title
            addSuggestion(page.title.substr(0, 80), lang);

            // Enqueue outbound links for future crawling.
            // Priority: Cambodian=3, GitHub=4, all other public sites=7
            for (const auto& link : page.links) {
                std::string ld=extractDomain(link);
                int lp = isCambodianDomain(ld) ? 3 : (ld.find("github.com")!=std::string::npos ? 4 : 7);
                enqueue(link, url, 1, lp, "web");
            }

            // Progress log every 25 pages per worker
            if (n % 25 == 0) {
                std::cout << "[Node " << cfg.nodeId << " W" << workerId << "]"
                          << " pages=" << stats.pages
                          << " img="   << stats.images
                          << " vid="   << stats.videos
                          << " news="  << stats.news
                          << " errs="  << stats.errors << "\n";
            }

            // Polite crawl delay — GitHub queue type uses longer delay
            int delay = (qtype=="github") ? cfg.githubDelay : cfg.crawlDelay;
            std::this_thread::sleep_for(std::chrono::milliseconds(delay));
        }

        // Release connections when this worker exits
        if (db)    PQfinish(db);
        if (redis) redisFree(redis);
    }
};

// ─────────────────────────────────────────
// GitHub API Crawler
//
// STATUS: Disabled in main() — see TODO block below.
//
// Queries the GitHub Search API for repos related to Cambodia/Khmer
// and saves results directly to `github_repos`.
//
// Only runs on NODE_ID="1" to avoid burning API quota on every container.
//
// TODO: Re-enable and extend to also crawl the GitHub website itself:
//   - Enqueue github.com/<owner>/<repo> pages into crawl_queue
//   - Fetch raw README.md via api.github.com/repos/<owner>/<repo>/readme
//   - Discover and crawl GitHub Pages: https://<owner>.github.io/<repo>
// ─────────────────────────────────────────
void crawlGitHub(const Config& cfg, Stats& stats) {
    // Guard: only the primary node runs this to avoid duplicate API calls
    if (cfg.nodeId != "1") return;

    // Authenticated requests get 5000 req/hr vs 60 unauthenticated
    std::string authHeader = cfg.githubToken.empty() ? "" :
        "Authorization: token " + cfg.githubToken;

    // Search queries covering Cambodia/Khmer-related repos sorted by popularity
    std::vector<std::string> queries = {
        "https://api.github.com/search/repositories?q=cambodia&sort=stars&per_page=100",
        "https://api.github.com/search/repositories?q=khmer&sort=stars&per_page=100",
        "https://api.github.com/search/repositories?q=angkor&sort=stars&per_page=100",
        "https://api.github.com/search/repositories?q=topic:cambodia&sort=stars&per_page=100",
        "https://api.github.com/search/repositories?q=topic:khmer&sort=stars&per_page=100",
        "https://api.github.com/search/repositories?q=phnom+penh&sort=stars&per_page=100"
    };

    // GitHub crawler gets its own dedicated DB connection (not shared with workers)
    std::string connStr="host="+cfg.dbHost+" port="+cfg.dbPort+
                         " dbname="+cfg.dbName+" user="+cfg.dbUser+
                         " password="+cfg.dbPass;
    PGconn* db=PQconnectdb(connStr.c_str());
    if (PQstatus(db)!=CONNECTION_OK) { std::cerr<<"[GitHub] DB connect failed\n"; return; }

    for (const auto& apiUrl : queries) {
        std::cout << "[GitHub] " << apiUrl << "\n";
        std::string json=fetchURL(apiUrl, authHeader, 20);
        if (json.empty()) continue;

        // Parse each repo block from the JSON response.
        // Uses simple substring scanning rather than a full JSON parser.
        size_t pos=0;
        while ((pos=json.find("\"html_url\":",pos))!=std::string::npos) {
            // Find the enclosing JSON object boundaries for this repo entry
            size_t blockStart=json.rfind('{',pos);
            size_t blockEnd=json.find("\"visibility\"",pos);
            if (blockEnd==std::string::npos){ pos++; continue; }
            std::string block=json.substr(blockStart,blockEnd-blockStart);

            // Extract repo fields from the JSON block
            std::string repoUrl  = parseJsonField(block,"html_url");
            std::string name     = parseJsonField(block,"name");
            std::string fullName = parseJsonField(block,"full_name");
            std::string desc     = parseJsonField(block,"description");
            std::string lang     = parseJsonField(block,"language");
            std::string owner    = parseJsonField(block,"login");
            int stars = parseJsonInt(block,"stargazers_count");
            int forks = parseJsonInt(block,"forks_count");

            if (!repoUrl.empty() && !name.empty()) {
                std::string ss=std::to_string(stars), fs=std::to_string(forks);
                const char* p[8]={repoUrl.c_str(),name.c_str(),fullName.c_str(),desc.c_str(),lang.c_str(),ss.c_str(),fs.c_str(),owner.c_str()};
                PQexecParams(db,
                    "INSERT INTO github_repos (repo_url,name,full_name,description,language,stars,forks,owner) "
                    "VALUES ($1,$2,$3,$4,$5,$6::int,$7::int,$8) ON CONFLICT (repo_url) DO UPDATE SET stars=$6::int",
                    8,nullptr,p,nullptr,nullptr,0);
                stats.github++;
                std::cout<<"  [Repo] "<<fullName<<" ★"<<stars<<"\n";
            }
            pos=blockEnd;
        }
        // Respect GitHub's rate limit with a delay between API calls
        std::this_thread::sleep_for(std::chrono::milliseconds(cfg.githubDelay));
    }
    PQfinish(db);
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

    Stats stats;

    // ── Phase 1: GitHub API Crawl ─────────────────────────
    // Queries GitHub API for Cambodia/Khmer repos, saves to github_repos table.
    // Only runs on NODE_ID=1 to avoid burning API quota.
    std::cout << "\n[Phase 1] GitHub Crawl (Cambodia/Khmer repos)\n";
    crawlGitHub(cfg, stats);

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