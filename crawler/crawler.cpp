// ============================================================
//  crawler.cpp — AngkorSearch v2 Mega Crawler
//  Crawls: Web pages, News, Images, Videos, GitHub repos
//  All focused on Cambodia / Khmer content
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
#include <curl/curl.h>
#include <libpq-fe.h>
#include <hiredis/hiredis.h>
#include <gumbo.h>

// ─────────────────────────────────────────
// Config
// ─────────────────────────────────────────
struct Config {
    std::string dbHost    = "postgres";
    std::string dbPort    = "5432";
    std::string dbName    = "angkorsearch";
    std::string dbUser    = "angkor";
    std::string dbPass    = "angkor_secret_2024";
    std::string redisHost = "redis";
    std::string githubToken = ""; // optional: set GITHUB_TOKEN env var
    int redisPort  = 6379;
    int maxPages   = 500000;
    int crawlDelay = 800;
    int maxDepth   = 6;
    int githubDelay= 2000; // GitHub rate limit friendly

    Config() {
        auto e = [](const char* k, const char* d) {
            const char* v = std::getenv(k); return v ? std::string(v) : std::string(d);
        };
        dbHost       = e("DB_HOST",      "postgres");
        dbPort       = e("DB_PORT",      "5432");
        dbName       = e("DB_NAME",      "angkorsearch");
        dbUser       = e("DB_USER",      "angkor");
        dbPass       = e("DB_PASS",      "angkor_secret_2024");
        redisHost    = e("REDIS_HOST",   "redis");
        redisPort    = std::stoi(e("REDIS_PORT",   "6379"));
        maxPages     = std::stoi(e("MAX_PAGES",    "500000"));
        crawlDelay   = std::stoi(e("CRAWL_DELAY",  "800"));
        githubToken  = e("GITHUB_TOKEN", "");
    }
};

// ─────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────
static size_t curlWrite(char* ptr, size_t size, size_t nmemb, std::string* data) {
    data->append(ptr, size * nmemb);
    return size * nmemb;
}

std::string fetchURL(const std::string& url,
                     const std::string& extraHeader = "",
                     long timeout = 15) {
    CURL* curl = curl_easy_init();
    std::string response;
    if (!curl) return "";

    curl_easy_setopt(curl, CURLOPT_URL,            url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION,  curlWrite);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA,      &response);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
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

    if (res != CURLE_OK || (httpCode != 200 && httpCode != 301)) return "";
    return response;
}

// ─────────────────────────────────────────
// HTML Parsing Helpers
// ─────────────────────────────────────────
struct ParsedPage {
    std::string title;
    std::string description;
    std::string text;
    std::string ogImage;       // og:image meta
    std::string publishedAt;   // article:published_time
    std::string author;        // article:author
    std::vector<std::string> links;
    std::vector<std::pair<std::string,std::string>> images; // url, alt
    std::vector<std::string> videoUrls;
};

void walkText(GumboNode* node, std::string& text) {
    if (!node) return;
    if (node->type == GUMBO_NODE_TEXT) {
        text += node->v.text.text;
        text += " ";
        return;
    }
    if (node->type != GUMBO_NODE_ELEMENT) return;
    GumboTag tag = node->v.element.tag;
    if (tag == GUMBO_TAG_SCRIPT || tag == GUMBO_TAG_STYLE ||
        tag == GUMBO_TAG_NAV    || tag == GUMBO_TAG_FOOTER) return;
    GumboVector* ch = &node->v.element.children;
    for (unsigned i = 0; i < ch->length; i++)
        walkText((GumboNode*)ch->data[i], text);
}

std::string getTitle(GumboNode* node) {
    if (!node || node->type != GUMBO_NODE_ELEMENT) return "";
    if (node->v.element.tag == GUMBO_TAG_TITLE) {
        std::string t;
        walkText(node, t);
        return t;
    }
    GumboVector* ch = &node->v.element.children;
    for (unsigned i = 0; i < ch->length; i++) {
        std::string t = getTitle((GumboNode*)ch->data[i]);
        if (!t.empty()) return t;
    }
    return "";
}

void walkLinks(GumboNode* node, std::vector<std::string>& links) {
    if (!node || node->type != GUMBO_NODE_ELEMENT) return;
    if (node->v.element.tag == GUMBO_TAG_A) {
        GumboAttribute* href = gumbo_get_attribute(&node->v.element.attributes, "href");
        if (href && href->value) {
            std::string h(href->value);
            if (h.substr(0,4) == "http") links.push_back(h);
        }
    }
    GumboVector* ch = &node->v.element.children;
    for (unsigned i = 0; i < ch->length; i++)
        walkLinks((GumboNode*)ch->data[i], links);
}

void walkImages(GumboNode* node,
                std::vector<std::pair<std::string,std::string>>& images) {
    if (!node || node->type != GUMBO_NODE_ELEMENT) return;
    if (node->v.element.tag == GUMBO_TAG_IMG) {
        GumboAttribute* src = gumbo_get_attribute(&node->v.element.attributes, "src");
        GumboAttribute* alt = gumbo_get_attribute(&node->v.element.attributes, "alt");
        if (src && src->value) {
            std::string srcStr(src->value);
            std::string altStr = alt ? alt->value : "";
            if (srcStr.substr(0,4) == "http" && altStr.size() > 2)
                images.push_back({srcStr, altStr});
        }
    }
    // Also check data-src (lazy loading)
    if (node->v.element.tag == GUMBO_TAG_IMG) {
        GumboAttribute* ds = gumbo_get_attribute(&node->v.element.attributes, "data-src");
        GumboAttribute* alt= gumbo_get_attribute(&node->v.element.attributes, "alt");
        if (ds && ds->value) {
            std::string s(ds->value);
            if (s.substr(0,4) == "http")
                images.push_back({s, alt ? alt->value : ""});
        }
    }
    GumboVector* ch = &node->v.element.children;
    for (unsigned i = 0; i < ch->length; i++)
        walkImages((GumboNode*)ch->data[i], images);
}

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
            if (n == "description") page.description = val.substr(0, 300);
            if (n == "author")      page.author = val;
        }
        if (prop) {
            std::string p(prop->value);
            if (p == "og:image")                page.ogImage = val;
            if (p == "og:description" && page.description.empty()) page.description = val.substr(0,300);
            if (p == "article:published_time")  page.publishedAt = val;
            if (p == "article:author")          page.author = val;
        }
    }
    // iframe src for videos (YouTube etc)
    if (node->v.element.tag == GUMBO_TAG_IFRAME) {
        GumboAttribute* src = gumbo_get_attribute(&node->v.element.attributes, "src");
        if (src && src->value) {
            std::string s(src->value);
            if (s.find("youtube.com/embed") != std::string::npos ||
                s.find("youtu.be")          != std::string::npos)
                page.videoUrls.push_back(s);
        }
    }
    GumboVector* ch = &node->v.element.children;
    for (unsigned i = 0; i < ch->length; i++)
        walkMeta((GumboNode*)ch->data[i], page);
}

ParsedPage parseHTML(const std::string& html, const std::string& url) {
    ParsedPage page;
    GumboOutput* out = gumbo_parse(html.c_str());
    if (!out) return page;

    page.title = getTitle(out->root);
    walkText(out->root, page.text);
    walkLinks(out->root, page.links);
    walkImages(out->root, page.images);
    walkMeta(out->root, page);

    // Clean text
    std::string clean;
    bool sp = false;
    for (char c : page.text) {
        if (c == '\n' || c == '\t' || c == '\r') c = ' ';
        if (c == ' ' && sp) continue;
        clean += c; sp = (c == ' ');
    }
    page.text = clean.substr(0, 100000);

    gumbo_destroy_output(&kGumboDefaultOptions, out);
    return page;
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
std::string extractDomain(const std::string& url) {
    std::regex re(R"(https?://([^/]+))");
    std::smatch m;
    if (std::regex_search(url, m, re)) return m[1].str();
    return url;
}

std::string detectLang(const std::string& text) {
    int kh = 0, la = 0;
    for (unsigned char c : text) {
        if (c == 0xE1) kh++;
        else if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) la++;
    }
    if (kh > la) return "km";
    if (la > kh) return "en";
    return "mixed";
}

std::string pgEscape(const std::string& s) {
    std::string r;
    for (char c : s) { if (c == '\'') r += '\''; r += c; }
    return r;
}

bool isCambodianDomain(const std::string& domain) {
    // ── Cambodian domains ──
    static const std::vector<std::string> camboKeywords = {
        ".kh", "cambodia", "khmer", "kampuchea",
        "phnompenh", "angkor", "mekong",
        "khmertimes", "phnompenhpost", "thmey11",
        "dap-news", "voacambodia", "rfa.org",
        "freshnews", "sabay", "postkhmer",
        "cambodiadaily", "cambodianess"
    };
    for (const auto& kw : camboKeywords)
        if (domain.find(kw) != std::string::npos) return true;

    // ── Custom whitelisted domains (any site you want to crawl) ──
    static const std::vector<std::string> customDomains = {
        // MekongTunnel project
        "mekongtunnel",
        "mekongtunnel-dev.vercel.app",
        // Anime sites
        "9anime",
        "gogoanime",
        "animesuge",
        "zoro.to",
        "animixplay",
        "crunchyroll",
        "animedao",
        // Add any other custom site below this line:
        // "example.com",
    };
    for (const auto& d : customDomains)
        if (domain.find(d) != std::string::npos) return true;

    return false;
}

std::string fileExtension(const std::string& url) {
    auto pos = url.rfind('.');
    if (pos == std::string::npos) return "";
    std::string ext = url.substr(pos + 1);
    // Remove query params
    auto q = ext.find('?');
    if (q != std::string::npos) ext = ext.substr(0, q);
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
    return ext;
}

bool isImageUrl(const std::string& url) {
    std::string ext = fileExtension(url);
    return ext == "jpg" || ext == "jpeg" || ext == "png" ||
           ext == "gif" || ext == "webp" || ext == "svg";
}

// ─────────────────────────────────────────
// GitHub API crawler
// ─────────────────────────────────────────
std::string parseJsonField(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\":\"";
    auto pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos += search.size();
    auto end = json.find('"', pos);
    if (end == std::string::npos) return "";
    return json.substr(pos, end - pos);
}

int parseJsonInt(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\":";
    auto pos = json.find(search);
    if (pos == std::string::npos) return 0;
    pos += search.size();
    std::string num;
    while (pos < json.size() && (std::isdigit(json[pos]) || json[pos] == '-'))
        num += json[pos++];
    return num.empty() ? 0 : std::stoi(num);
}

// ─────────────────────────────────────────
// Main Crawler Class
// ─────────────────────────────────────────
class MegaCrawler {
private:
    Config        cfg;
    PGconn*       db    = nullptr;
    redisContext* redis = nullptr;
    int totalPages   = 0;
    int totalImages  = 0;
    int totalVideos  = 0;
    int totalGithub  = 0;
    int totalNews    = 0;
    int errors       = 0;

    // ── DB Connect ──
    bool connectDB() {
        std::string c = "host=" + cfg.dbHost + " port=" + cfg.dbPort +
                        " dbname=" + cfg.dbName + " user=" + cfg.dbUser +
                        " password=" + cfg.dbPass;
        db = PQconnectdb(c.c_str());
        if (PQstatus(db) != CONNECTION_OK) {
            std::cerr << "[DB] Error: " << PQerrorMessage(db) << "\n";
            return false;
        }
        std::cout << "[DB] Connected\n";
        return true;
    }

    bool connectRedis() {
        redis = redisConnect(cfg.redisHost.c_str(), cfg.redisPort);
        if (!redis || redis->err) {
            std::cerr << "[Redis] Error\n";
            return false;
        }
        std::cout << "[Redis] Connected\n";
        return true;
    }

    // ── Redis visited set ──
    bool isVisited(const std::string& url) {
        redisReply* r = (redisReply*)redisCommand(redis, "SISMEMBER visited %s", url.c_str());
        bool v = r && r->integer == 1;
        freeReplyObject(r);
        return v;
    }

    void markVisited(const std::string& url) {
        redisReply* r = (redisReply*)redisCommand(redis, "SADD visited %s", url.c_str());
        freeReplyObject(r);
    }

    // ── Get next URL from queue ──
    std::pair<std::string,std::string> getNextURL() {
        PGresult* res = PQexec(db,
            "UPDATE crawl_queue SET crawled=TRUE, crawled_at=NOW() "
            "WHERE id=(SELECT id FROM crawl_queue "
            "WHERE crawled=FALSE ORDER BY priority,added_at LIMIT 1 FOR UPDATE SKIP LOCKED) "
            "RETURNING url, queue_type");
        std::string url, qtype;
        if (PQresultStatus(res) == PGRES_TUPLES_OK && PQntuples(res) > 0) {
            url   = PQgetvalue(res, 0, 0);
            qtype = PQgetvalue(res, 0, 1);
        }
        PQclear(res);
        return {url, qtype};
    }

    // ── Add URLs to queue ──
    void enqueue(const std::string& url, const std::string& source,
                 int depth, int priority = 5,
                 const std::string& qtype = "web") {
        if (depth > cfg.maxDepth || isVisited(url)) return;
        std::string domain = extractDomain(url);
        if (!isCambodianDomain(domain) && domain.find("github.com") == std::string::npos) return;

        std::string depthStr    = std::to_string(depth);
        std::string priorityStr = std::to_string(priority);
        const char* params[6] = {
            url.c_str(), domain.c_str(), source.c_str(),
            qtype.c_str(), priorityStr.c_str(), depthStr.c_str()
        };
        PQexecParams(db,
            "INSERT INTO crawl_queue (url,domain,source_url,queue_type,priority,depth) "
            "VALUES ($1,$2,$3,$4,$5::int,$6::int) ON CONFLICT (url) DO NOTHING",
            6, nullptr, params, nullptr, nullptr, 0);
    }

    // ── Save raw HTML ──
    std::string saveHTML(int id, const std::string& html) {
        std::string path = "/app/data/html/" + std::to_string(id) + ".html";
        std::ofstream f(path);
        if (f.is_open()) f << html;
        return path;
    }

    // ── Save web page ──
    void savePage(const std::string& url, const ParsedPage& page,
                  const std::string& htmlPath, const std::string& lang,
                  const std::string& pageType) {
        std::string domain   = extractDomain(url);
        std::string wc       = std::to_string(std::count(page.text.begin(), page.text.end(), ' '));
        const char* p[9] = {
            url.c_str(), domain.c_str(), page.title.c_str(),
            page.description.c_str(), lang.c_str(),
            page.text.substr(0,80000).c_str(),
            htmlPath.c_str(), wc.c_str(), pageType.c_str()
        };
        PQexecParams(db,
            "INSERT INTO pages (url,domain,title,description,language,content,html_path,word_count,page_type) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8::int,$9) "
            "ON CONFLICT (url) DO UPDATE SET title=$3,description=$4,content=$6,updated_at=NOW()",
            9, nullptr, p, nullptr, nullptr, 0);
    }

    // ── Save image ──
    void saveImage(const std::string& imgUrl, const std::string& pageUrl,
                   const std::string& alt, const std::string& lang) {
        std::string domain = extractDomain(imgUrl);
        std::string ext    = fileExtension(imgUrl);
        const char* p[6] = {
            imgUrl.c_str(), pageUrl.c_str(), alt.c_str(),
            domain.c_str(), lang.c_str(), ext.c_str()
        };
        PQexecParams(db,
            "INSERT INTO images (url,page_url,alt_text,domain,language,file_type) "
            "VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (url) DO NOTHING",
            6, nullptr, p, nullptr, nullptr, 0);
        totalImages++;
    }

    // ── Save video ──
    void saveVideo(const std::string& videoUrl, const std::string& title,
                   const std::string& desc, const std::string& lang) {
        std::string domain = extractDomain(videoUrl);
        const char* p[5] = {
            videoUrl.c_str(), title.c_str(),
            desc.c_str(), domain.c_str(), lang.c_str()
        };
        PQexecParams(db,
            "INSERT INTO videos (url,title,description,domain,language) "
            "VALUES ($1,$2,$3,$4,$5) ON CONFLICT (url) DO NOTHING",
            5, nullptr, p, nullptr, nullptr, 0);
        totalVideos++;
    }

    // ── Save news ──
    void saveNews(const std::string& url, const ParsedPage& page,
                  const std::string& lang) {
        std::string source = extractDomain(url);
        const char* p[7] = {
            url.c_str(), page.title.c_str(),
            page.description.c_str(),
            page.text.substr(0,5000).c_str(),
            page.ogImage.c_str(), source.c_str(), lang.c_str()
        };
        PQexecParams(db,
            "INSERT INTO news (url,title,description,content,image_url,source,language) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (url) DO NOTHING",
            7, nullptr, p, nullptr, nullptr, 0);
        totalNews++;
    }

    // ── Save GitHub repo ──
    void saveGithubRepo(const std::string& repoUrl,
                        const std::string& name,
                        const std::string& fullName,
                        const std::string& desc,
                        const std::string& lang,
                        int stars, int forks,
                        const std::string& owner) {
        std::string starsStr = std::to_string(stars);
        std::string forksStr = std::to_string(forks);
        const char* p[8] = {
            repoUrl.c_str(), name.c_str(), fullName.c_str(),
            desc.c_str(), lang.c_str(),
            starsStr.c_str(), forksStr.c_str(), owner.c_str()
        };
        PQexecParams(db,
            "INSERT INTO github_repos (repo_url,name,full_name,description,language,stars,forks,owner) "
            "VALUES ($1,$2,$3,$4,$5,$6::int,$7::int,$8) ON CONFLICT (repo_url) DO UPDATE SET stars=$6::int",
            8, nullptr, p, nullptr, nullptr, 0);
        totalGithub++;
    }

    // ── Update suggestion table ──
    void updateSuggestion(const std::string& query, const std::string& lang) {
        if (query.size() < 2 || query.size() > 100) return;
        std::string lower = query;
        std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
        const char* p[3] = { query.c_str(), lower.c_str(), lang.c_str() };
        PQexecParams(db,
            "INSERT INTO suggestions (query,normalized,language,source) "
            "VALUES ($1,$2,$3,'search') "
            "ON CONFLICT (query) DO UPDATE SET count=suggestions.count+1, updated_at=NOW()",
            3, nullptr, p, nullptr, nullptr, 0);
    }

    // ── Add titles as suggestions ──
    void addTitleAsSuggestion(const std::string& title, const std::string& lang) {
        if (title.empty()) return;
        // Add full title
        updateSuggestion(title.substr(0, 80), lang);
        // Add first few words as partial suggestion
        std::istringstream ss(title);
        std::string word, partial;
        int count = 0;
        while (ss >> word && count < 4) {
            partial += (count > 0 ? " " : "") + word;
            if (partial.size() > 3) updateSuggestion(partial, lang);
            count++;
        }
    }

    // ── Crawl GitHub topics/search ──
    void crawlGitHub(const std::string& url) {
        std::string authHeader = cfg.githubToken.empty() ? "" :
            "Authorization: token " + cfg.githubToken;

        // GitHub API: search repos with cambodia/khmer topics
        std::vector<std::string> queries = {
            "https://api.github.com/search/repositories?q=cambodia&sort=stars&per_page=100",
            "https://api.github.com/search/repositories?q=khmer&sort=stars&per_page=100",
            "https://api.github.com/search/repositories?q=angkor&sort=stars&per_page=100",
            "https://api.github.com/search/repositories?q=topic:cambodia&sort=stars&per_page=100",
            "https://api.github.com/search/repositories?q=topic:khmer&sort=stars&per_page=100",
            "https://api.github.com/search/repositories?q=phnom+penh&sort=stars&per_page=100"
        };

        for (const auto& apiUrl : queries) {
            std::cout << "[GitHub] " << apiUrl << "\n";
            std::string json = fetchURL(apiUrl, authHeader, 20);
            if (json.empty()) continue;

            // Parse items array (simple approach)
            size_t pos = 0;
            while ((pos = json.find("\"html_url\":", pos)) != std::string::npos) {
                // Extract repo block
                size_t blockStart = json.rfind('{', pos);
                size_t blockEnd   = json.find("\"visibility\"", pos);
                if (blockEnd == std::string::npos) { pos++; continue; }
                std::string block = json.substr(blockStart, blockEnd - blockStart);

                std::string repoUrl  = parseJsonField(block, "html_url");
                std::string name     = parseJsonField(block, "name");
                std::string fullName = parseJsonField(block, "full_name");
                std::string desc     = parseJsonField(block, "description");
                std::string lang     = parseJsonField(block, "language");
                std::string owner    = parseJsonField(block, "login");
                int stars = parseJsonInt(block, "stargazers_count");
                int forks = parseJsonInt(block, "forks_count");

                if (!repoUrl.empty() && !name.empty()) {
                    saveGithubRepo(repoUrl, name, fullName, desc, lang, stars, forks, owner);
                    addTitleAsSuggestion(name + " " + desc, "en");
                    std::cout << "  [Repo] " << fullName << " ★" << stars << "\n";
                }
                pos = blockEnd;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(cfg.githubDelay));
        }
    }

    // ── Seed queue from seeds table ──
    void seedQueue() {
        PGresult* res = PQexec(db,
            "INSERT INTO crawl_queue (url,domain,queue_type,priority) "
            "SELECT url,domain,seed_type,priority FROM seeds WHERE active=TRUE "
            "ON CONFLICT (url) DO NOTHING");
        PQclear(res);
        std::cout << "[Crawler] Seeds loaded\n";
    }

    // ── Determine page type from URL/domain ──
    std::string pageTypeFromUrl(const std::string& url, const std::string& domain) {
        if (url.find("github.com") != std::string::npos) return "github";
        if (domain.find("youtube.com") != std::string::npos) return "video";
        // News domains
        static const std::vector<std::string> newsDomains = {
            "phnompenhpost","khmertimes","rfa.org","voacambodia",
            "dap-news","freshnews","thmey11","cambodiadaily",
            "cambodianess","kohsantepheap","postkhmer","sabay"
        };
        for (const auto& nd : newsDomains)
            if (domain.find(nd) != std::string::npos) return "news";
        return "web";
    }

    void logStats() {
        std::string q =
            "INSERT INTO crawler_stats (pages_crawled,images_found,videos_found,github_found,news_found,errors) "
            "VALUES (" + std::to_string(totalPages) + "," +
            std::to_string(totalImages) + "," +
            std::to_string(totalVideos) + "," +
            std::to_string(totalGithub) + "," +
            std::to_string(totalNews) + "," +
            std::to_string(errors) + ")";
        PGresult* r = PQexec(db, q.c_str());
        PQclear(r);
    }

public:
    explicit MegaCrawler(const Config& c) : cfg(c) {}

    bool init() {
        curl_global_init(CURL_GLOBAL_DEFAULT);
        return connectDB() && connectRedis();
    }

    void run() {
        seedQueue();

        // First: crawl GitHub (API-based, fast)
        std::cout << "\n[Phase 1] GitHub Crawl\n";
        crawlGitHub("https://github.com/topics/cambodia");

        // Then: crawl web pages
        std::cout << "\n[Phase 2] Web Crawl (target: "
                  << cfg.maxPages << " pages)\n";

        while (totalPages < cfg.maxPages) {
            auto [url, qtype] = getNextURL();
            if (url.empty()) {
                std::cout << "[Crawler] Queue empty, waiting 30s...\n";
                std::this_thread::sleep_for(std::chrono::seconds(30));
                continue;
            }
            if (isVisited(url)) continue;
            markVisited(url);

            std::cout << "[" << ++totalPages << "] [" << qtype << "] " << url << "\n";

            std::string html = fetchURL(url);
            if (html.empty()) { errors++; continue; }

            std::string domain   = extractDomain(url);
            ParsedPage  page     = parseHTML(html, url);
            std::string lang     = detectLang(page.text);
            std::string pageType = pageTypeFromUrl(url, domain);
            std::string htmlPath = saveHTML(totalPages, html);

            // Save page
            savePage(url, page, htmlPath, lang, pageType);

            // Save as news if it's a news domain
            if (pageType == "news" && !page.title.empty())
                saveNews(url, page, lang);

            // Save images found on page
            for (const auto& [imgUrl, alt] : page.images) {
                if (isCambodianDomain(extractDomain(imgUrl)) ||
                    isCambodianDomain(domain))
                    saveImage(imgUrl, url, alt, lang);
            }

            // Save og:image
            if (!page.ogImage.empty())
                saveImage(page.ogImage, url, page.title, lang);

            // Save videos
            for (const auto& vUrl : page.videoUrls)
                saveVideo(vUrl, page.title, page.description, lang);

            // Add title as search suggestion
            addTitleAsSuggestion(page.title, lang);

            // Enqueue discovered links
            for (const auto& link : page.links) {
                std::string ldomain = extractDomain(link);
                int priority = isCambodianDomain(ldomain) ? 3 : 7;
                enqueue(link, url, 1, priority, "web");
            }

            // Log every 50 pages
            if (totalPages % 50 == 0) {
                logStats();
                std::cout << "[Stats] pages=" << totalPages
                          << " images=" << totalImages
                          << " videos=" << totalVideos
                          << " github=" << totalGithub
                          << " news=" << totalNews
                          << " errors=" << errors << "\n";
            }

            int delay = (qtype == "github") ? cfg.githubDelay : cfg.crawlDelay;
            std::this_thread::sleep_for(std::chrono::milliseconds(delay));
        }

        logStats();
        std::cout << "[Crawler] Complete. Pages=" << totalPages << "\n";
    }

    ~MegaCrawler() {
        if (db)    PQfinish(db);
        if (redis) redisFree(redis);
        curl_global_cleanup();
    }
};

// ─────────────────────────────────────────
int main() {
    std::cout << "AngkorSearch MegaCrawler v2.0\n";
    std::cout << "Crawling: Web | News | Images | Videos | GitHub\n\n";

    for (int i = 0; i < 10; i++) {
        Config cfg;
        MegaCrawler crawler(cfg);
        if (crawler.init()) {
            crawler.run();
            return 0;
        }
        std::cerr << "Retry in 5s...\n";
        std::this_thread::sleep_for(std::chrono::seconds(5));
    }
    return 1;
}