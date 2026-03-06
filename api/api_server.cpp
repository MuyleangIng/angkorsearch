// ============================================================
//  api_server.cpp — AngkorSearch HTTP API Server
//  Pure C++ HTTP server (no external web framework)
//  Endpoints:
//    GET  /health
//    GET  /search?q=...&lang=...&page=...
//    GET  /suggest?q=...
//    POST /bookmark
//    GET  /bookmarks?user_id=...
//    GET  /history?user_id=...
//    DELETE /history?user_id=...
// ============================================================

#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <unordered_map>
#include <thread>
#include <mutex>
#include <cstring>
#include <cstdlib>
#include <algorithm>

// Networking
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <arpa/inet.h>

// PostgreSQL + Redis
#include <libpq-fe.h>
#include <hiredis/hiredis.h>

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
    int         redisPort = 6379;
    int         apiPort   = 8080;

    Config() {
        auto e = [](const char* k, const char* d) {
            const char* v = std::getenv(k);
            return v ? std::string(v) : std::string(d);
        };
        dbHost    = e("DB_HOST",    "postgres");
        dbPort    = e("DB_PORT",    "5432");
        dbName    = e("DB_NAME",    "angkorsearch");
        dbUser    = e("DB_USER",    "angkor");
        dbPass    = e("DB_PASS",    "angkor_secret_2024");
        redisHost = e("REDIS_HOST", "redis");
        redisPort = std::stoi(e("REDIS_PORT", "6379"));
        apiPort   = std::stoi(e("API_PORT",   "8080"));
    }
};

// ─────────────────────────────────────────
// URL decode
// ─────────────────────────────────────────
std::string urlDecode(const std::string& s) {
    std::string result;
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '+') { result += ' '; continue; }
        if (s[i] == '%' && i + 2 < s.size()) {
            char hex[3] = {s[i+1], s[i+2], 0};
            result += (char)std::stoi(hex, nullptr, 16);
            i += 2;
        } else {
            result += s[i];
        }
    }
    return result;
}

// Parse query string → map
std::unordered_map<std::string,std::string>
parseQuery(const std::string& qs) {
    std::unordered_map<std::string,std::string> params;
    std::istringstream ss(qs);
    std::string token;
    while (std::getline(ss, token, '&')) {
        auto eq = token.find('=');
        if (eq != std::string::npos)
            params[urlDecode(token.substr(0, eq))] =
                urlDecode(token.substr(eq + 1));
    }
    return params;
}

// Escape JSON string
std::string jsonEscape(const std::string& s) {
    std::string r;
    for (char c : s) {
        switch (c) {
            case '"':  r += "\\\""; break;
            case '\\': r += "\\\\"; break;
            case '\n': r += "\\n";  break;
            case '\r': r += "\\r";  break;
            case '\t': r += "\\t";  break;
            default:   r += c;
        }
    }
    return r;
}

// ─────────────────────────────────────────
// HTTP Request/Response
// ─────────────────────────────────────────
struct HttpRequest {
    std::string method;
    std::string path;
    std::string queryString;
    std::string body;
    std::unordered_map<std::string,std::string> params;
};

struct HttpResponse {
    int         status = 200;
    std::string body;
    std::string contentType = "application/json";
};

HttpRequest parseRequest(const std::string& raw) {
    HttpRequest req;
    std::istringstream ss(raw);
    std::string line;

    // First line: METHOD /path?query HTTP/1.1
    std::getline(ss, line);
    std::istringstream firstLine(line);
    std::string pathAndQuery;
    firstLine >> req.method >> pathAndQuery;

    auto qPos = pathAndQuery.find('?');
    if (qPos != std::string::npos) {
        req.path        = pathAndQuery.substr(0, qPos);
        req.queryString = pathAndQuery.substr(qPos + 1);
        req.params      = parseQuery(req.queryString);
    } else {
        req.path = pathAndQuery;
    }

    // Find body (after blank line)
    size_t bodyStart = raw.find("\r\n\r\n");
    if (bodyStart != std::string::npos)
        req.body = raw.substr(bodyStart + 4);

    return req;
}

std::string buildResponse(const HttpResponse& res) {
    std::string statusText = "OK";
    if (res.status == 400) statusText = "Bad Request";
    if (res.status == 404) statusText = "Not Found";
    if (res.status == 500) statusText = "Internal Server Error";

    return "HTTP/1.1 " + std::to_string(res.status) + " " + statusText + "\r\n"
           "Content-Type: " + res.contentType + "; charset=utf-8\r\n"
           "Access-Control-Allow-Origin: *\r\n"
           "Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\n"
           "Access-Control-Allow-Headers: Content-Type\r\n"
           "Content-Length: " + std::to_string(res.body.size()) + "\r\n"
           "Connection: close\r\n"
           "\r\n" + res.body;
}

// ─────────────────────────────────────────
// Search API Handler
// ─────────────────────────────────────────
class SearchAPI {
private:
    Config cfg;
    std::mutex dbMutex;

    PGconn* getDB() {
        std::string conn =
            "host="     + cfg.dbHost +
            " port="    + cfg.dbPort +
            " dbname="  + cfg.dbName +
            " user="    + cfg.dbUser +
            " password="+ cfg.dbPass;
        return PQconnectdb(conn.c_str());
    }

    redisContext* getRedis() {
        return redisConnect(cfg.redisHost.c_str(), cfg.redisPort);
    }

    // Check Redis cache
    std::string cacheGet(redisContext* rc, const std::string& key) {
        redisReply* r = (redisReply*)redisCommand(
            rc, "GET %s", key.c_str());
        std::string val;
        if (r && r->type == REDIS_REPLY_STRING)
            val = std::string(r->str, r->len);
        freeReplyObject(r);
        return val;
    }

    void cacheSet(redisContext* rc, const std::string& key,
                  const std::string& val, int ttl = 60) {
        redisReply* r = (redisReply*)redisCommand(
            rc, "SETEX %s %d %s", key.c_str(), ttl, val.c_str());
        freeReplyObject(r);
    }

    // Log search to DB (async-ish)
    void logSearch(PGconn* db, const std::string& query,
                   int count, const std::string& lang) {
        const char* params[3] = {
            query.c_str(), lang.c_str(),
            std::to_string(count).c_str()
        };
        PQexecParams(db,
            "INSERT INTO search_history "
            "(query, language, result_count) VALUES ($1,$2,$3)",
            3, nullptr, params, nullptr, nullptr, 0);

        // Update popular searches
        PQexecParams(db,
            "INSERT INTO popular_searches (query, count) VALUES ($1, 1) "
            "ON CONFLICT (query) DO UPDATE SET count = popular_searches.count+1, "
            "last_at = NOW()",
            1, nullptr, &params[0], nullptr, nullptr, 0);
    }

public:
    explicit SearchAPI(const Config& c) : cfg(c) {}

    // ── GET /health ──
    HttpResponse health() {
        return {200, R"({"status":"ok","service":"AngkorSearch API"})"};
    }

    // ── GET /search?q=...&lang=...&page=... ──
    HttpResponse search(const HttpRequest& req) {
        auto q    = req.params.count("q")    ? req.params.at("q")    : "";
        auto lang = req.params.count("lang") ? req.params.at("lang") : "";
        auto page = req.params.count("page") ? std::stoi(req.params.at("page")) : 1;
        int  limit  = 10;
        int  offset = (page - 1) * limit;

        if (q.empty())
            return {400, R"({"error":"Missing query parameter 'q'"})"};

        // Check Redis cache
        auto* rc = getRedis();
        std::string cacheKey = "search:" + q + ":" + lang + ":" + std::to_string(page);
        std::string cached = cacheGet(rc, cacheKey);
        if (!cached.empty()) {
            redisFree(rc);
            return {200, cached};
        }

        // PostgreSQL full-text search
        auto* db = getDB();

        std::string sql;
        std::vector<std::string> paramVec;

        if (!lang.empty()) {
            sql = "SELECT id, url, title, "
                  "ts_headline('english', content, plainto_tsquery($1)) AS snippet, "
                  "language, "
                  "ts_rank(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')), "
                  "plainto_tsquery($1)) AS rank "
                  "FROM pages "
                  "WHERE to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')) "
                  "@@ plainto_tsquery($1) "
                  "AND language = $2 "
                  "ORDER BY rank DESC "
                  "LIMIT $3 OFFSET $4";
            paramVec = {q, lang, std::to_string(limit), std::to_string(offset)};
        } else {
            sql = "SELECT id, url, title, "
                  "ts_headline('english', content, plainto_tsquery($1)) AS snippet, "
                  "language, "
                  "ts_rank(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')), "
                  "plainto_tsquery($1)) AS rank "
                  "FROM pages "
                  "WHERE to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')) "
                  "@@ plainto_tsquery($1) "
                  "ORDER BY rank DESC "
                  "LIMIT $2 OFFSET $3";
            paramVec = {q, std::to_string(limit), std::to_string(offset)};
        }

        std::vector<const char*> params;
        for (auto& p : paramVec) params.push_back(p.c_str());

        PGresult* res = PQexecParams(db, sql.c_str(),
            (int)params.size(), nullptr,
            params.data(), nullptr, nullptr, 0);

        // Build JSON
        std::string json = "{\"query\":\"" + jsonEscape(q) + "\","
                           "\"page\":" + std::to_string(page) + ","
                           "\"results\":[";

        int rows = PQntuples(res);
        for (int i = 0; i < rows; i++) {
            if (i > 0) json += ",";
            json += "{"
                "\"id\":"       + std::string(PQgetvalue(res,i,0)) + ","
                "\"url\":\""    + jsonEscape(PQgetvalue(res,i,1)) + "\","
                "\"title\":\""  + jsonEscape(PQgetvalue(res,i,2)) + "\","
                "\"snippet\":\"" + jsonEscape(PQgetvalue(res,i,3)) + "\","
                "\"lang\":\""   + std::string(PQgetvalue(res,i,4)) + "\","
                "\"score\":"    + std::string(PQgetvalue(res,i,5)) +
                "}";
        }
        json += "],\"count\":" + std::to_string(rows) + "}";

        PQclear(res);
        logSearch(db, q, rows, lang);
        PQfinish(db);

        // Cache result
        cacheSet(rc, cacheKey, json, 60);
        redisFree(rc);

        return {200, json};
    }

    // ── GET /suggest?q=... ──
    HttpResponse suggest(const HttpRequest& req) {
        auto q = req.params.count("q") ? req.params.at("q") : "";
        if (q.empty()) return {400, R"({"error":"missing q"})"};

        auto* db = getDB();
        const char* params[1] = {(q + "%").c_str()};

        PGresult* res = PQexecParams(db,
            "SELECT query FROM popular_searches "
            "WHERE query ILIKE $1 "
            "ORDER BY count DESC LIMIT 8",
            1, nullptr, params, nullptr, nullptr, 0);

        std::string json = "{\"suggestions\":[";
        int rows = PQntuples(res);
        for (int i = 0; i < rows; i++) {
            if (i > 0) json += ",";
            json += "\"" + jsonEscape(PQgetvalue(res,i,0)) + "\"";
        }
        json += "]}";

        PQclear(res);
        PQfinish(db);
        return {200, json};
    }

    // ── POST /bookmark  body: user_id=1&url=...&title=... ──
    HttpResponse addBookmark(const HttpRequest& req) {
        auto body   = parseQuery(req.body);
        auto userId = body.count("user_id") ? body.at("user_id") : "";
        auto url    = body.count("url")     ? body.at("url")     : "";
        auto title  = body.count("title")   ? body.at("title")   : "";

        if (userId.empty() || url.empty())
            return {400, R"({"error":"user_id and url required"})"};

        auto* db = getDB();
        const char* params[3] = {userId.c_str(), url.c_str(), title.c_str()};
        PQexecParams(db,
            "INSERT INTO bookmarks (user_id, url, title) "
            "VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            3, nullptr, params, nullptr, nullptr, 0);
        PQfinish(db);
        return {200, R"({"ok":true})"};
    }

    // ── GET /bookmarks?user_id=... ──
    HttpResponse getBookmarks(const HttpRequest& req) {
        auto userId = req.params.count("user_id")
                    ? req.params.at("user_id") : "";
        if (userId.empty())
            return {400, R"({"error":"user_id required"})"};

        auto* db = getDB();
        const char* params[1] = {userId.c_str()};
        PGresult* res = PQexecParams(db,
            "SELECT url, title, folder, saved_at "
            "FROM bookmarks WHERE user_id=$1 "
            "ORDER BY saved_at DESC",
            1, nullptr, params, nullptr, nullptr, 0);

        std::string json = "{\"bookmarks\":[";
        int rows = PQntuples(res);
        for (int i = 0; i < rows; i++) {
            if (i > 0) json += ",";
            json += "{"
                "\"url\":\""    + jsonEscape(PQgetvalue(res,i,0)) + "\","
                "\"title\":\""  + jsonEscape(PQgetvalue(res,i,1)) + "\","
                "\"folder\":\"" + jsonEscape(PQgetvalue(res,i,2)) + "\","
                "\"saved_at\":\"" + std::string(PQgetvalue(res,i,3)) + "\""
                "}";
        }
        json += "]}";
        PQclear(res);
        PQfinish(db);
        return {200, json};
    }

    // ── GET /history?user_id=... ──
    HttpResponse getHistory(const HttpRequest& req) {
        auto userId = req.params.count("user_id")
                    ? req.params.at("user_id") : "";
        if (userId.empty())
            return {400, R"({"error":"user_id required"})"};

        auto* db = getDB();
        const char* params[1] = {userId.c_str()};
        PGresult* res = PQexecParams(db,
            "SELECT query, result_count, searched_at "
            "FROM search_history WHERE user_id=$1 "
            "ORDER BY searched_at DESC LIMIT 50",
            1, nullptr, params, nullptr, nullptr, 0);

        std::string json = "{\"history\":[";
        int rows = PQntuples(res);
        for (int i = 0; i < rows; i++) {
            if (i > 0) json += ",";
            json += "{"
                "\"query\":\""  + jsonEscape(PQgetvalue(res,i,0)) + "\","
                "\"results\":"  + std::string(PQgetvalue(res,i,1)) + ","
                "\"at\":\""     + std::string(PQgetvalue(res,i,2)) + "\""
                "}";
        }
        json += "]}";
        PQclear(res);
        PQfinish(db);
        return {200, json};
    }

    // ── DELETE /history?user_id=... ──
    HttpResponse clearHistory(const HttpRequest& req) {
        auto userId = req.params.count("user_id")
                    ? req.params.at("user_id") : "";
        if (userId.empty())
            return {400, R"({"error":"user_id required"})"};

        auto* db = getDB();
        const char* params[1] = {userId.c_str()};
        PQexecParams(db,
            "DELETE FROM search_history WHERE user_id=$1",
            1, nullptr, params, nullptr, nullptr, 0);
        PQfinish(db);
        return {200, R"({"ok":true,"message":"History cleared"})"};
    }

    // ── Route request ──
    HttpResponse route(const HttpRequest& req) {
        if (req.method == "OPTIONS")
            return {200, ""};
        if (req.path == "/health")
            return health();
        if (req.path == "/search" && req.method == "GET")
            return search(req);
        if (req.path == "/suggest" && req.method == "GET")
            return suggest(req);
        if (req.path == "/bookmark" && req.method == "POST")
            return addBookmark(req);
        if (req.path == "/bookmarks" && req.method == "GET")
            return getBookmarks(req);
        if (req.path == "/history" && req.method == "GET")
            return getHistory(req);
        if (req.path == "/history" && req.method == "DELETE")
            return clearHistory(req);
        return {404, R"({"error":"Not found"})"};
    }
};

// ─────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────
void handleClient(int clientFd, SearchAPI& api) {
    char buf[65536] = {};
    recv(clientFd, buf, sizeof(buf)-1, 0);
    std::string raw(buf);

    HttpRequest req = parseRequest(raw);
    HttpResponse res = api.route(req);
    std::string response = buildResponse(res);

    send(clientFd, response.c_str(), response.size(), 0);
    close(clientFd);
}

int main() {
    Config cfg;
    SearchAPI api(cfg);

    // Create TCP socket
    int serverFd = socket(AF_INET, SOCK_STREAM, 0);
    int opt = 1;
    setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    sockaddr_in addr{};
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port        = htons(cfg.apiPort);

    bind(serverFd, (sockaddr*)&addr, sizeof(addr));
    listen(serverFd, 128);

    std::cout << "AngkorSearch API running on port "
              << cfg.apiPort << "\n";

    while (true) {
        int clientFd = accept(serverFd, nullptr, nullptr);
        if (clientFd < 0) continue;
        // Handle each request in its own thread
        std::thread([clientFd, &api]() {
            handleClient(clientFd, api);
        }).detach();
    }
}
