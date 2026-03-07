// ============================================================
//  api_server.cpp — AngkorSearch v2.2 API
//  Changes vs v2.1:
//   • Search fixed: uses 'simple' FTS dict + ILIKE fallback
//     so "cam" matches "cambodia", Khmer text works
//   • /admin/stats  — full dashboard data (domain, type, lang, searches)
//   • /ai/answer    — local LLM answer box via Ollama
//   • /live         — real-time crawl progress (unchanged)
//   • All existing endpoints unchanged
// ============================================================

#include <iostream>
#include <sstream>
#include <fstream>
#include <string>
#include <vector>
#include <unordered_map>
#include <thread>
#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <algorithm>
#include <chrono>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <sys/statvfs.h>
#include <libpq-fe.h>
#include <hiredis/hiredis.h>
#include <curl/curl.h>

static auto g_start_time = std::chrono::steady_clock::now();

// ─────────────────────────────────────────
// Config
// ─────────────────────────────────────────
struct Config {
    std::string dbHost="postgres", dbPort="5432",
                dbName="angkorsearch", dbUser="angkor",
                dbPass="angkor_secret_2024", redisHost="redis";
    std::string ollamaHost="http://ollama:11434";
    std::string ollamaModel="qwen2.5:3b";
    int redisPort=6379, apiPort=8080;
    Config() {
        auto e=[](const char* k,const char* d){ const char* v=std::getenv(k); return v?std::string(v):std::string(d); };
        dbHost      = e("DB_HOST","postgres");
        dbPort      = e("DB_PORT","5432");
        dbName      = e("DB_NAME","angkorsearch");
        dbUser      = e("DB_USER","angkor");
        dbPass      = e("DB_PASS","angkor_secret_2024");
        redisHost   = e("REDIS_HOST","redis");
        redisPort   = std::stoi(e("REDIS_PORT","6379"));
        apiPort     = std::stoi(e("API_PORT","8080"));
        ollamaHost  = e("OLLAMA_HOST","http://ollama:11434");
        ollamaModel = e("OLLAMA_MODEL","qwen2.5:3b");
    }
};

// ─────────────────────────────────────────
// HTTP / curl helpers
// ─────────────────────────────────────────
static size_t curlWriteCb(char* ptr, size_t size, size_t nmemb, std::string* data) {
    data->append(ptr, size * nmemb);
    return size * nmemb;
}

// GET a URL (used for force-crawl now endpoint)
std::string httpGet(const std::string& url, long timeout=20) {
    CURL* c = curl_easy_init();
    if (!c) return "";
    std::string resp;
    curl_easy_setopt(c, CURLOPT_URL,            url.c_str());
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION,  curlWriteCb);
    curl_easy_setopt(c, CURLOPT_WRITEDATA,      &resp);
    curl_easy_setopt(c, CURLOPT_TIMEOUT,        timeout);
    curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(c, CURLOPT_MAXREDIRS,      5L);
    curl_easy_setopt(c, CURLOPT_USERAGENT,
        "AngkorSearchBot/2.2 (+https://angkorsearch.com.kh/bot)");
    struct curl_slist* h = nullptr;
    h = curl_slist_append(h, "Accept: text/html,application/xhtml+xml");
    curl_easy_setopt(c, CURLOPT_HTTPHEADER, h);
    CURLcode res = curl_easy_perform(c);
    long code = 0;
    curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &code);
    curl_slist_free_all(h);
    curl_easy_cleanup(c);
    if (res != CURLE_OK || (code != 200 && code != 301 && code != 302)) return "";
    return resp;
}

// ── Simple HTML helpers for inline crawl ────────────────────────────────────
// Extract content of first matching tag pair, e.g. <title>...</title>
static std::string htmlTagContent(const std::string& html, const std::string& tag) {
    std::string open = "<" + tag, close = "</" + tag + ">";
    auto s = html.find(open);
    if (s == std::string::npos) return "";
    auto e = html.find('>', s);
    if (e == std::string::npos) return "";
    auto end = html.find(close, e + 1);
    if (end == std::string::npos) return "";
    std::string v = html.substr(e + 1, end - e - 1);
    while (!v.empty() && (v.front()==' '||v.front()=='\n'||v.front()=='\r')) v.erase(v.begin());
    while (!v.empty() && (v.back()==' '||v.back()=='\n'||v.back()=='\r')) v.pop_back();
    return v;
}

// Extract content= from a <meta name="X" content="Y"> or <meta property="X" content="Y">
static std::string htmlMetaContent(const std::string& html, const std::string& name) {
    for (const std::string& attr : {"name=\""+name+"\"", "name='"+name+"'",
                                    "property=\""+name+"\"", "property='"+name+'"'}) {
        auto pos = html.find(attr);
        if (pos == std::string::npos) continue;
        auto tagStart = html.rfind('<', pos);
        auto tagEnd   = html.find('>', pos);
        if (tagStart == std::string::npos || tagEnd == std::string::npos) continue;
        std::string tag = html.substr(tagStart, tagEnd - tagStart);
        for (const std::string& ca : {"content=\"", "content='"}) {
            auto cs = tag.find(ca);
            if (cs == std::string::npos) continue;
            cs += ca.size();
            char delim = ca.back();
            auto ce = tag.find(delim, cs);
            if (ce != std::string::npos) return tag.substr(cs, ce - cs);
        }
    }
    return "";
}

// Strip HTML tags, collapse whitespace → plain text
static std::string htmlToText(const std::string& html) {
    std::string out;
    out.reserve(html.size() / 2);
    bool inTag=false, inScript=false, inStyle=false;
    for (size_t i = 0; i < html.size(); i++) {
        if (html[i] == '<') {
            auto sub = [&](const char* s){ return html.compare(i, strlen(s), s)==0; };
            if (sub("<script")||sub("<SCRIPT")) inScript=true;
            else if (sub("<style")||sub("<STYLE")) inStyle=true;
            else if (sub("</script>")||sub("</SCRIPT>")) inScript=false;
            else if (sub("</style>")||sub("</STYLE>")) inStyle=false;
            inTag=true;
        } else if (html[i]=='>') {
            inTag=false; if (!inScript&&!inStyle) out+=' ';
        } else if (!inTag&&!inScript&&!inStyle) {
            out+=html[i];
        }
    }
    // decode basic entities
    auto rep=[](std::string& s,const char* f,const char* t){
        size_t p=0; size_t fl=strlen(f); size_t tl=strlen(t);
        while((p=s.find(f,p))!=std::string::npos){s.replace(p,fl,t);p+=tl;}
    };
    rep(out,"&amp;","&"); rep(out,"&lt;","<"); rep(out,"&gt;",">");
    rep(out,"&quot;","\""); rep(out,"&#39;","'"); rep(out,"&nbsp;"," ");
    // collapse whitespace
    std::string result; bool sp=true;
    for (char c : out) {
        bool ws=(c==' '||c=='\n'||c=='\r'||c=='\t');
        if (ws) { if (!sp) { result+=' '; sp=true; } }
        else { result+=c; sp=false; }
    }
    return result;
}

// POST JSON to a URL (used for Ollama API calls)
std::string httpPost(const std::string& url, const std::string& body, long timeout=60) {
    CURL* c = curl_easy_init();
    if (!c) return "";
    std::string resp;
    curl_easy_setopt(c, CURLOPT_URL,           url.c_str());
    curl_easy_setopt(c, CURLOPT_POSTFIELDS,    body.c_str());
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, curlWriteCb);
    curl_easy_setopt(c, CURLOPT_WRITEDATA,     &resp);
    curl_easy_setopt(c, CURLOPT_TIMEOUT,       timeout);
    struct curl_slist* h = nullptr;
    h = curl_slist_append(h, "Content-Type: application/json");
    curl_easy_setopt(c, CURLOPT_HTTPHEADER, h);
    curl_easy_perform(c);
    curl_slist_free_all(h);
    curl_easy_cleanup(c);
    return resp;
}

// Extract a quoted JSON string value — handles escape sequences
// e.g. extractJsonStr(json, "response") → the Ollama answer text
std::string extractJsonStr(const std::string& j, const std::string& key) {
    std::string search = "\"" + key + "\":\"";
    auto pos = j.find(search);
    if (pos == std::string::npos) return "";
    pos += search.size();
    std::string result;
    bool escape = false;
    for (size_t i = pos; i < j.size(); i++) {
        if (escape) {
            char c = j[i];
            if      (c == 'n')  result += '\n';
            else if (c == 't')  result += '\t';
            else if (c == 'r')  result += '\r';
            else if (c == '"')  result += '"';
            else if (c == '\\') result += '\\';
            else                result += c;
            escape = false;
        } else if (j[i] == '\\') {
            escape = true;
        } else if (j[i] == '"') {
            break;
        } else {
            result += j[i];
        }
    }
    return result;
}

// ─────────────────────────────────────────
// HTTP server helpers
// ─────────────────────────────────────────
std::string urlDecode(const std::string& s) {
    std::string r; char h[3]={};
    for (size_t i=0;i<s.size();i++) {
        if(s[i]=='+'){r+=' ';continue;}
        if(s[i]=='%'&&i+2<s.size()){h[0]=s[i+1];h[1]=s[i+2];r+=(char)std::stoi(h,nullptr,16);i+=2;}
        else r+=s[i];
    }
    return r;
}

std::unordered_map<std::string,std::string> parseQuery(const std::string& qs) {
    std::unordered_map<std::string,std::string> m;
    std::istringstream ss(qs); std::string tok;
    while(std::getline(ss,tok,'&')){ auto eq=tok.find('='); if(eq!=std::string::npos) m[urlDecode(tok.substr(0,eq))]=urlDecode(tok.substr(eq+1)); }
    return m;
}

// JSON escape a string value
std::string je(const std::string& s) {
    std::string r;
    for(char c:s){switch(c){case '"':r+="\\\"";break;case '\\':r+="\\\\";break;case '\n':r+="\\n";break;case '\r':r+="\\r";break;case '\t':r+="\\t";break;default:r+=c;}}
    return r;
}

struct Req { std::string method,path,qs,body; std::unordered_map<std::string,std::string> p; };
struct Res { int status=200; std::string body,ct="application/json"; };

Req parseReq(const std::string& raw) {
    Req req; std::istringstream ss(raw); std::string line;
    std::getline(ss,line); std::istringstream fl(line);
    std::string pq; fl>>req.method>>pq;
    auto q=pq.find('?');
    if(q!=std::string::npos){req.path=pq.substr(0,q);req.qs=pq.substr(q+1);req.p=parseQuery(req.qs);}
    else req.path=pq;
    size_t bs=raw.find("\r\n\r\n"); if(bs!=std::string::npos) req.body=raw.substr(bs+4);
    return req;
}

std::string buildRes(const Res& res) {
    std::string st="OK";
    if(res.status==400)st="Bad Request";
    if(res.status==404)st="Not Found";
    if(res.status==500)st="Internal Server Error";
    if(res.status==503)st="Service Unavailable";
    return "HTTP/1.1 "+std::to_string(res.status)+" "+st+"\r\n"
           "Content-Type: "+res.ct+"; charset=utf-8\r\n"
           "Access-Control-Allow-Origin: *\r\n"
           "Access-Control-Allow-Methods: GET,POST,DELETE,PATCH,OPTIONS\r\n"
           "Access-Control-Allow-Headers: Content-Type\r\n"
           "Content-Length: "+std::to_string(res.body.size())+"\r\n"
           "Connection: close\r\n\r\n"+res.body;
}

// ─────────────────────────────────────────
// API
// ─────────────────────────────────────────
class API {
    Config cfg;

    PGconn* db() {
        std::string c="host="+cfg.dbHost+" port="+cfg.dbPort+
                       " dbname="+cfg.dbName+" user="+cfg.dbUser+
                       " password="+cfg.dbPass;
        return PQconnectdb(c.c_str());
    }

    redisContext* rc() { return redisConnect(cfg.redisHost.c_str(),cfg.redisPort); }

    std::string cacheGet(redisContext* r,const std::string& k) {
        redisReply* rep=(redisReply*)redisCommand(r,"GET %s",k.c_str());
        std::string v; if(rep&&rep->type==REDIS_REPLY_STRING) v=std::string(rep->str,rep->len);
        freeReplyObject(rep); return v;
    }

    void cacheSet(redisContext* r,const std::string& k,const std::string& v,int ttl=60) {
        redisReply* rep=(redisReply*)redisCommand(r,"SETEX %s %d %s",k.c_str(),ttl,v.c_str());
        freeReplyObject(rep);
    }

    std::string param(const Req& r,const std::string& k,const std::string& def="") {
        return r.p.count(k)?r.p.at(k):def;
    }

    void logSearch(PGconn* d,const std::string& q,int cnt,const std::string& type,const std::string& lang) {
        const char* p[4]={q.c_str(),std::to_string(cnt).c_str(),type.c_str(),lang.c_str()};
        PQexecParams(d,"INSERT INTO search_history (query,result_count,search_type,language) VALUES ($1,$2::int,$3,$4)",4,nullptr,p,nullptr,nullptr,0);
        PQexecParams(d,"INSERT INTO suggestions (query,normalized,language,source) VALUES ($1,lower($1),$4,'search') ON CONFLICT (query) DO UPDATE SET count=suggestions.count+1,updated_at=NOW()",4,nullptr,p,nullptr,nullptr,0);
        const char* p2[1]={q.c_str()};
        PQexecParams(d,"INSERT INTO popular_searches (query,count) VALUES ($1,1) ON CONFLICT (query) DO UPDATE SET count=popular_searches.count+1,last_at=NOW()",1,nullptr,p2,nullptr,nullptr,0);
    }

public:
    API(const Config& c):cfg(c){}

    // ── /health ──
    Res health() { return {200,R"({"status":"ok","version":"2.2","engine":"AngkorSearch"})"}; }

    // ── /live — real-time crawl progress ──
    Res live(const Req& req) {
        int since = std::stoi(param(req,"since","10"));
        if (since < 1)  since = 1;
        if (since > 60) since = 60;

        auto* d = db();
        std::string sinceStr = std::to_string(since);

        const char* p1[1] = {sinceStr.c_str()};
        PGresult* r1 = PQexecParams(d,
            "SELECT COUNT(*) FROM pages "
            "WHERE updated_at >= NOW() - ($1::int || ' seconds')::interval",
            1,nullptr,p1,nullptr,nullptr,0);

        PGresult* r2 = PQexec(d,
            "SELECT url,title,domain,page_type,language,updated_at "
            "FROM pages ORDER BY updated_at DESC LIMIT 8");

        PGresult* r3 = PQexec(d,
            "SELECT COUNT(*) FROM crawl_queue WHERE crawled=FALSE");

        PGresult* r4 = PQexec(d,
            "SELECT "
            "(SELECT COUNT(*) FROM pages)   AS pages,"
            "(SELECT COUNT(*) FROM images)  AS images,"
            "(SELECT COUNT(*) FROM videos)  AS videos,"
            "(SELECT COUNT(*) FROM news)    AS news,"
            "(SELECT COUNT(*) FROM github_repos) AS github");

        std::string newPages  = (PQresultStatus(r1)==PGRES_TUPLES_OK&&PQntuples(r1)>0) ? PQgetvalue(r1,0,0) : "0";
        std::string queueLeft = (PQresultStatus(r3)==PGRES_TUPLES_OK&&PQntuples(r3)>0) ? PQgetvalue(r3,0,0) : "0";

        std::string json = "{";
        json += "\"new_in_last_" + sinceStr + "s\":" + newPages + ",";
        json += "\"queue_remaining\":" + queueLeft + ",";

        if (PQresultStatus(r4)==PGRES_TUPLES_OK && PQntuples(r4)>0) {
            json += "\"total_pages\":"  + std::string(PQgetvalue(r4,0,0)) + ",";
            json += "\"total_images\":" + std::string(PQgetvalue(r4,0,1)) + ",";
            json += "\"total_videos\":" + std::string(PQgetvalue(r4,0,2)) + ",";
            json += "\"total_news\":"   + std::string(PQgetvalue(r4,0,3)) + ",";
            json += "\"total_github\":" + std::string(PQgetvalue(r4,0,4)) + ",";
        }

        json += "\"latest\":[";
        if (PQresultStatus(r2)==PGRES_TUPLES_OK) {
            int rows=PQntuples(r2);
            for (int i=0;i<rows;i++) {
                if(i>0) json+=",";
                json += "{\"url\":\""    + je(PQgetvalue(r2,i,0)) + "\","
                         "\"title\":\""  + je(PQgetvalue(r2,i,1)) + "\","
                         "\"domain\":\"" + je(PQgetvalue(r2,i,2)) + "\","
                         "\"type\":\""   + je(PQgetvalue(r2,i,3)) + "\","
                         "\"lang\":\""   + je(PQgetvalue(r2,i,4)) + "\","
                         "\"at\":\""     + je(PQgetvalue(r2,i,5)) + "\"}";
            }
        }
        json += "]}";

        PQclear(r1); PQclear(r2); PQclear(r3); PQclear(r4);
        PQfinish(d);
        return {200,json};
    }

    // ── /search — multi-strategy query expansion (like Google/Naver) ──
    // Strategy:
    //  1. FTS  — full-text search (simple dict, handles word boundaries)
    //  2. Trigram similarity — title % $1 (pg_trgm, fuzzy: "muyleang"~"muyleanging")
    //  3. URL search — url ILIKE $2  (finds github.com/muyleanging by searching "muyleanging")
    //  4. Query expansion — prefix/suffix variants of long words:
    //       "muyleanging"(11) → prefix "muyleang"(7) + suffix "leanging"(7)
    //  5. Per-word ILIKE — each word in multi-word queries searched independently
    //  6. Ranking boost — URL match, title match, trigram score, FTS rank combined
    Res search(const Req& req) {
        std::string q=param(req,"q"), type=param(req,"type","web"), lang=param(req,"lang");
        std::string dateFrom=param(req,"date_from"); // optional ISO date: "2024-01-01"
        int page=std::stoi(param(req,"page","1")), limit=10, offset=(page-1)*limit;
        if(q.empty()) return {400,R"({"error":"missing q"})"};

        auto* r=rc();
        std::string ck="s:"+q+":"+type+":"+lang+":"+dateFrom+":"+std::to_string(page);
        std::string cached=cacheGet(r,ck);
        if(!cached.empty()){redisFree(r);return{200,cached};}

        auto* d=db();
        PGresult* res=nullptr;
        std::string json;

        // ── Query expansion ─────────────────────────────────────────────────
        // Lower-case first word for prefix/suffix generation
        std::string fw=q; { auto sp=q.find(' '); if(sp!=std::string::npos) fw=q.substr(0,sp); }
        for(auto& c:fw) c=tolower(c);

        // Full-query ILIKE (e.g. "%muyleanging%")
        std::string likeQ="%"+q+"%";
        // First-word ILIKE (e.g. "%muyleang%") — useful for multi-word queries
        std::string likeW="%"+fw+"%";
        // Prefix variant: first ~65% of long words (e.g. "muyleang" from "muyleanging")
        std::string likeP=likeW;
        if(fw.size()>=6){
            size_t n=std::max((size_t)4,(size_t)(fw.size()*65/100));
            likeP="%"+fw.substr(0,n)+"%";
        }
        // Suffix variant: last ~60% of long words (e.g. "leanging" from "muyleanging")
        std::string likeS=likeW;
        if(fw.size()>=7){
            size_t n=std::max((size_t)4,(size_t)(fw.size()*60/100));
            likeS="%"+fw.substr(fw.size()-n)+"%";
        }
        // Second word ILIKE for two-word queries (e.g. "ing" from "muyleang ing")
        std::string likeW2=likeW;
        { auto sp=q.find(' ');
          if(sp!=std::string::npos){
              std::string w2=q.substr(sp+1); for(auto&c:w2) c=tolower(c);
              if(w2.size()>=3) likeW2="%"+w2+"%";
          }
        }

        if(type=="image") {
            const char* p[4]={q.c_str(),likeW.c_str(),std::to_string(limit).c_str(),std::to_string(offset).c_str()};
            res=PQexecParams(d,
                "SELECT url,page_url,alt_text,domain,file_type FROM images "
                "WHERE (to_tsvector('simple',coalesce(alt_text,'')||' '||coalesce(title,'')) @@ plainto_tsquery('simple',$1) "
                "  OR alt_text ILIKE $2 OR title ILIKE $2 OR page_url ILIKE $2) "
                "ORDER BY crawled_at DESC LIMIT $3::int OFFSET $4::int",
                4,nullptr,p,nullptr,nullptr,0);
            json="{\"type\":\"image\",\"results\":[";
            int rows=PQntuples(res);
            for(int i=0;i<rows;i++){if(i>0)json+=",";json+="{\"url\":\""+je(PQgetvalue(res,i,0))+"\",\"page_url\":\""+je(PQgetvalue(res,i,1))+"\",\"alt\":\""+je(PQgetvalue(res,i,2))+"\",\"domain\":\""+je(PQgetvalue(res,i,3))+"\",\"type\":\""+std::string(PQgetvalue(res,i,4))+"\"}"; }
            json+="],\"count\":"+std::to_string(rows)+"}";

        } else if(type=="video") {
            const char* p[4]={q.c_str(),likeW.c_str(),std::to_string(limit).c_str(),std::to_string(offset).c_str()};
            res=PQexecParams(d,
                "SELECT url,embed_url,thumb_url,title,description,channel FROM videos "
                "WHERE (to_tsvector('simple',coalesce(title,'')||' '||coalesce(description,'')) @@ plainto_tsquery('simple',$1) "
                "  OR title ILIKE $2 OR description ILIKE $2) "
                "ORDER BY crawled_at DESC LIMIT $3::int OFFSET $4::int",
                4,nullptr,p,nullptr,nullptr,0);
            json="{\"type\":\"video\",\"results\":[";
            int rows=PQntuples(res);
            for(int i=0;i<rows;i++){if(i>0)json+=",";json+="{\"url\":\""+je(PQgetvalue(res,i,0))+"\",\"embed\":\""+je(PQgetvalue(res,i,1))+"\",\"thumb\":\""+je(PQgetvalue(res,i,2))+"\",\"title\":\""+je(PQgetvalue(res,i,3))+"\",\"desc\":\""+je(PQgetvalue(res,i,4))+"\",\"channel\":\""+je(PQgetvalue(res,i,5))+"\"}"; }
            json+="],\"count\":"+std::to_string(rows)+"}";

        } else if(type=="github") {
            // Also search owner name, full_name, and repo_url
            const char* p[4]={q.c_str(),likeW.c_str(),std::to_string(limit).c_str(),std::to_string(offset).c_str()};
            res=PQexecParams(d,
                "SELECT repo_url,name,full_name,description,language,stars,forks,owner FROM github_repos "
                "WHERE (to_tsvector('simple',coalesce(name,'')||' '||coalesce(description,'')||' '||coalesce(owner,'')) @@ plainto_tsquery('simple',$1) "
                "  OR name ILIKE $2 OR full_name ILIKE $2 OR owner ILIKE $2"
                "  OR description ILIKE $2 OR repo_url ILIKE $2) "
                "ORDER BY stars DESC LIMIT $3::int OFFSET $4::int",
                4,nullptr,p,nullptr,nullptr,0);
            json="{\"type\":\"github\",\"results\":[";
            int rows=PQntuples(res);
            for(int i=0;i<rows;i++){if(i>0)json+=",";json+="{\"url\":\""+je(PQgetvalue(res,i,0))+"\",\"name\":\""+je(PQgetvalue(res,i,1))+"\",\"full_name\":\""+je(PQgetvalue(res,i,2))+"\",\"desc\":\""+je(PQgetvalue(res,i,3))+"\",\"lang\":\""+je(PQgetvalue(res,i,4))+"\",\"stars\":"+std::string(PQgetvalue(res,i,5))+",\"forks\":"+std::string(PQgetvalue(res,i,6))+",\"owner\":\""+je(PQgetvalue(res,i,7))+"\"}"; }
            json+="],\"count\":"+std::to_string(rows)+"}";

        } else if(type=="news") {
            // $5=lang ('' = all), $6=date_from ('' = no filter)
            std::vector<std::string> pv={q,likeW,std::to_string(limit),std::to_string(offset),lang,dateFrom};
            std::string sql=
                "SELECT url,title,description,image_url,source,published_at FROM news "
                "WHERE (to_tsvector('simple',coalesce(title,'')||' '||coalesce(description,'')) @@ plainto_tsquery('simple',$1) "
                "  OR title ILIKE $2 OR description ILIKE $2) "
                "AND ($5 = '' OR language = $5) "
                "AND ($6 = '' OR crawled_at >= $6::date) "
                "ORDER BY published_at DESC NULLS LAST LIMIT $3::int OFFSET $4::int";
            std::vector<const char*> pp; for(auto& s:pv) pp.push_back(s.c_str());
            res=PQexecParams(d,sql.c_str(),(int)pp.size(),nullptr,pp.data(),nullptr,nullptr,0);
            json="{\"type\":\"news\",\"results\":[";
            int rows=PQntuples(res);
            for(int i=0;i<rows;i++){if(i>0)json+=",";json+="{\"url\":\""+je(PQgetvalue(res,i,0))+"\",\"title\":\""+je(PQgetvalue(res,i,1))+"\",\"desc\":\""+je(PQgetvalue(res,i,2))+"\",\"image\":\""+je(PQgetvalue(res,i,3))+"\",\"source\":\""+je(PQgetvalue(res,i,4))+"\",\"published\":\""+std::string(PQgetvalue(res,i,5))+"\"}"; }
            json+="],\"count\":"+std::to_string(rows)+"}";

        } else {
            // ── Web / All — full expanded search ──────────────────────────────
            // Params: $1=q  $2=likeW(firstWord)  $3=limit  $4=offset
            //         $5=likeP(prefix)  $6=likeS(suffix)  $7=likeW2(word2)
            //         $8=likeQ(fullQuery)  [$9=lang if set]
            // $1=q  $2=likeW  $3=limit  $4=offset  $5=likeP  $6=likeS  $7=likeW2  $8=likeQ
            // $9=lang ('' = all)  $10=date_from ('' = no filter)
            std::vector<std::string> pv={q,likeW,std::to_string(limit),std::to_string(offset),
                                          likeP,likeS,likeW2,likeQ,lang,dateFrom};
            std::string sql=
                "SELECT id,url,title,description,"
                "ts_headline('simple',coalesce(content,''),plainto_tsquery('simple',$1),"
                "  'MaxWords=30,MinWords=15,StartSel=<b>,StopSel=</b>') AS snippet,"
                "language,page_type,"
                // ── Combined relevance score ──────────────────────────────────
                "("
                // FTS rank (highest weight — exact token match)
                " COALESCE(ts_rank(to_tsvector('simple',"
                "   coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(content,'')),"
                "   plainto_tsquery('simple',$1)),0) * 3.0"
                // Trigram similarity on title (pg_trgm — catches "muyleang"~"muyleanging")
                "+ CASE WHEN title % $1 THEN 1.2 ELSE 0.0 END"
                // URL contains query — very strong signal for personal pages/profiles
                "+ CASE WHEN lower(url) LIKE lower($8) THEN 1.5 ELSE"
                "   CASE WHEN lower(url) LIKE lower($2) THEN 1.0 ELSE"
                "   CASE WHEN lower(url) LIKE lower($5) THEN 0.6 ELSE 0.0 END END END"
                // Title match signals
                "+ CASE WHEN title ILIKE $8 THEN 0.8 ELSE"
                "   CASE WHEN title ILIKE $2 THEN 0.5 ELSE"
                "   CASE WHEN title ILIKE $5 THEN 0.3 ELSE 0.0 END END END"
                // Description match
                "+ CASE WHEN description ILIKE $8 THEN 0.2 ELSE"
                "   CASE WHEN description ILIKE $2 THEN 0.1 ELSE 0.0 END END"
                ") AS rank "
                "FROM pages WHERE ("
                // 1. Full-text search (token-based, fast GIN index)
                " to_tsvector('simple',coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(content,''))"
                "   @@ plainto_tsquery('simple',$1)"
                // 2. Trigram fuzzy on title (pg_trgm GIN index)
                " OR title % $1"
                // 3. URL search — key for name/username searches
                " OR lower(url) LIKE lower($8)"
                " OR lower(url) LIKE lower($2)"
                " OR lower(url) LIKE lower($5)"
                // 4. Title/desc with full query
                " OR title       ILIKE $8 OR description ILIKE $8"
                // 5. Title with first-word and prefix/suffix variants
                " OR title       ILIKE $2 OR title       ILIKE $5 OR title       ILIKE $6"
                // 6. Description with first-word variant
                " OR description ILIKE $2 OR description ILIKE $5"
                // 7. Second word in multi-word queries
                " OR title       ILIKE $7 OR description ILIKE $7"
                // 8. Domain name search
                " OR domain      ILIKE $2"
                ") "
            "AND ($9 = '' OR language = $9) "
            "AND ($10 = '' OR updated_at >= $10::date) ";
            sql+="ORDER BY rank DESC NULLS LAST, updated_at DESC LIMIT $3::int OFFSET $4::int";
            std::vector<const char*> pp; for(auto& s:pv) pp.push_back(s.c_str());
            res=PQexecParams(d,sql.c_str(),(int)pp.size(),nullptr,pp.data(),nullptr,nullptr,0);
            json="{\"type\":\"web\",\"query\":\""+je(q)+"\",\"page\":"+std::to_string(page)+",\"results\":[";
            int rows=PQntuples(res);
            // Deduplicate by URL — multiple OR conditions can score the same page differently
            std::unordered_map<std::string,bool> seenUrls;
            int deduped=0;
            for(int i=0;i<rows;i++){
                std::string u=PQgetvalue(res,i,1);
                if(seenUrls.count(u)) continue; seenUrls[u]=true;
                if(deduped>0)json+=",";
                json+="{\"id\":"+std::string(PQgetvalue(res,i,0))+",\"url\":\""+je(u)+"\",\"title\":\""+je(PQgetvalue(res,i,2))+"\",\"description\":\""+je(PQgetvalue(res,i,3))+"\",\"snippet\":\""+je(PQgetvalue(res,i,4))+"\",\"lang\":\""+std::string(PQgetvalue(res,i,5))+"\",\"type\":\""+std::string(PQgetvalue(res,i,6))+"\",\"score\":"+std::string(PQgetvalue(res,i,7))+"}";
                deduped++;
            }
            json+="],\"count\":"+std::to_string(deduped)+"}";
        }

        if(res) PQclear(res);
        logSearch(d,q,(int)std::count(json.begin(),json.end(),'{'),type,lang);
        PQfinish(d);
        cacheSet(r,ck,json,300); // 5 minutes — reduces DB load on repeated searches
        redisFree(r);
        return {200,json};
    }

    // ── /suggest ──
    Res suggest(const Req& req) {
        std::string q=param(req,"q");
        if(q.size()<1) return {200,R"({"suggestions":[]})"};
        auto* r=rc(); std::string ck="sug:"+q;
        std::string cached=cacheGet(r,ck); if(!cached.empty()){redisFree(r);return{200,cached};}
        auto* d=db();
        std::string pattern=q+"%", similar="%"+q+"%";
        const char* p[2]={pattern.c_str(),similar.c_str()};
        PGresult* res=PQexecParams(d,
            "SELECT DISTINCT query FROM suggestions "
            "WHERE normalized LIKE lower($1) OR normalized LIKE lower($2) "
            "ORDER BY count DESC LIMIT 10",
            2,nullptr,p,nullptr,nullptr,0);
        std::string json="{\"suggestions\":["; int rows=PQntuples(res);
        for(int i=0;i<rows;i++){if(i>0)json+=",";json+="\""+je(PQgetvalue(res,i,0))+"\"";}
        json+="]}"; PQclear(res); PQfinish(d); cacheSet(r,ck,json,120); redisFree(r);
        return {200,json};
    }

    // ── /stats ──
    Res stats() {
        auto* d=db();
        PGresult* res=PQexec(d,"SELECT * FROM v_index_summary");
        std::string json="{}";
        if(PQresultStatus(res)==PGRES_TUPLES_OK&&PQntuples(res)>0)
            json="{\"pages\":"+std::string(PQgetvalue(res,0,0))+
                 ",\"images\":"+std::string(PQgetvalue(res,0,1))+
                 ",\"videos\":"+std::string(PQgetvalue(res,0,2))+
                 ",\"github\":"+std::string(PQgetvalue(res,0,3))+
                 ",\"news\":"+std::string(PQgetvalue(res,0,4))+
                 ",\"queue_pending\":"+std::string(PQgetvalue(res,0,5))+"}";
        PQclear(res); PQfinish(d); return {200,json};
    }

    // ── /admin/stats — full dashboard data ──
    Res adminStats() {
        auto* d = db();

        // Overview counts
        PGresult* r_ov = PQexec(d,
            "SELECT "
            "(SELECT COUNT(*) FROM pages) AS pages,"
            "(SELECT COUNT(*) FROM images) AS images,"
            "(SELECT COUNT(*) FROM videos) AS videos,"
            "(SELECT COUNT(*) FROM github_repos) AS github,"
            "(SELECT COUNT(*) FROM news) AS news,"
            "(SELECT COUNT(*) FROM crawl_queue WHERE crawled=FALSE) AS queue_pending,"
            "(SELECT COUNT(*) FROM crawl_queue WHERE crawled=TRUE) AS queue_done,"
            "(SELECT COUNT(*) FROM crawl_queue) AS queue_total");

        // Pages by domain (top 20)
        PGresult* r_dom = PQexec(d,
            "SELECT domain, COUNT(*) AS count FROM pages "
            "GROUP BY domain ORDER BY count DESC LIMIT 20");

        // Pages by type
        PGresult* r_type = PQexec(d,
            "SELECT page_type, COUNT(*) AS count FROM pages "
            "GROUP BY page_type ORDER BY count DESC");

        // Pages by language
        PGresult* r_lang = PQexec(d,
            "SELECT language, COUNT(*) AS count FROM pages "
            "GROUP BY language ORDER BY count DESC");

        // Top searches
        PGresult* r_srch = PQexec(d,
            "SELECT query, count FROM popular_searches "
            "ORDER BY count DESC LIMIT 20");

        // Recent crawled pages
        PGresult* r_rec = PQexec(d,
            "SELECT url, title, domain, page_type, language, updated_at "
            "FROM pages ORDER BY updated_at DESC LIMIT 15");

        // Queue by domain
        PGresult* r_qdom = PQexec(d,
            "SELECT domain, "
            "COUNT(*) FILTER (WHERE crawled=FALSE) AS pending, "
            "COUNT(*) FILTER (WHERE crawled=TRUE) AS done "
            "FROM crawl_queue GROUP BY domain ORDER BY pending DESC LIMIT 15");

        std::string json = "{";

        // Overview
        if (PQresultStatus(r_ov)==PGRES_TUPLES_OK && PQntuples(r_ov)>0) {
            json += "\"overview\":{"
                    "\"pages\":"         + std::string(PQgetvalue(r_ov,0,0)) + ","
                    "\"images\":"        + std::string(PQgetvalue(r_ov,0,1)) + ","
                    "\"videos\":"        + std::string(PQgetvalue(r_ov,0,2)) + ","
                    "\"github\":"        + std::string(PQgetvalue(r_ov,0,3)) + ","
                    "\"news\":"          + std::string(PQgetvalue(r_ov,0,4)) + ","
                    "\"queue_pending\":" + std::string(PQgetvalue(r_ov,0,5)) + ","
                    "\"queue_done\":"    + std::string(PQgetvalue(r_ov,0,6)) + ","
                    "\"queue_total\":"   + std::string(PQgetvalue(r_ov,0,7)) + "},";
        } else {
            json += "\"overview\":{\"pages\":0,\"images\":0,\"videos\":0,\"github\":0,\"news\":0,\"queue_pending\":0,\"queue_done\":0,\"queue_total\":0},";
        }

        // By domain
        json += "\"by_domain\":[";
        if (PQresultStatus(r_dom)==PGRES_TUPLES_OK) {
            int rows=PQntuples(r_dom);
            for(int i=0;i<rows;i++){
                if(i>0) json+=",";
                json+="{\"domain\":\""+je(PQgetvalue(r_dom,i,0))+"\",\"count\":"+std::string(PQgetvalue(r_dom,i,1))+"}";
            }
        }
        json += "],";

        // By type
        json += "\"by_type\":[";
        if (PQresultStatus(r_type)==PGRES_TUPLES_OK) {
            int rows=PQntuples(r_type);
            for(int i=0;i<rows;i++){
                if(i>0) json+=",";
                json+="{\"type\":\""+je(PQgetvalue(r_type,i,0))+"\",\"count\":"+std::string(PQgetvalue(r_type,i,1))+"}";
            }
        }
        json += "],";

        // By language
        json += "\"by_language\":[";
        if (PQresultStatus(r_lang)==PGRES_TUPLES_OK) {
            int rows=PQntuples(r_lang);
            for(int i=0;i<rows;i++){
                if(i>0) json+=",";
                json+="{\"language\":\""+je(PQgetvalue(r_lang,i,0))+"\",\"count\":"+std::string(PQgetvalue(r_lang,i,1))+"}";
            }
        }
        json += "],";

        // Top searches
        json += "\"top_searches\":[";
        if (PQresultStatus(r_srch)==PGRES_TUPLES_OK) {
            int rows=PQntuples(r_srch);
            for(int i=0;i<rows;i++){
                if(i>0) json+=",";
                json+="{\"query\":\""+je(PQgetvalue(r_srch,i,0))+"\",\"count\":"+std::string(PQgetvalue(r_srch,i,1))+"}";
            }
        }
        json += "],";

        // Queue by domain
        json += "\"queue_by_domain\":[";
        if (PQresultStatus(r_qdom)==PGRES_TUPLES_OK) {
            int rows=PQntuples(r_qdom);
            for(int i=0;i<rows;i++){
                if(i>0) json+=",";
                json+="{\"domain\":\""+je(PQgetvalue(r_qdom,i,0))+"\","
                      "\"pending\":"+std::string(PQgetvalue(r_qdom,i,1))+","
                      "\"done\":"+std::string(PQgetvalue(r_qdom,i,2))+"}";
            }
        }
        json += "],";

        // Recent pages
        json += "\"recent_pages\":[";
        if (PQresultStatus(r_rec)==PGRES_TUPLES_OK) {
            int rows=PQntuples(r_rec);
            for(int i=0;i<rows;i++){
                if(i>0) json+=",";
                json+="{\"url\":\""+je(PQgetvalue(r_rec,i,0))+"\","
                      "\"title\":\""+je(PQgetvalue(r_rec,i,1))+"\","
                      "\"domain\":\""+je(PQgetvalue(r_rec,i,2))+"\","
                      "\"type\":\""+je(PQgetvalue(r_rec,i,3))+"\","
                      "\"lang\":\""+je(PQgetvalue(r_rec,i,4))+"\","
                      "\"at\":\""+je(PQgetvalue(r_rec,i,5))+"\"}";
            }
        }
        json += "]}";

        PQclear(r_ov); PQclear(r_dom); PQclear(r_type);
        PQclear(r_lang); PQclear(r_srch); PQclear(r_rec); PQclear(r_qdom);
        PQfinish(d);
        return {200, json};
    }

    // ── /ai/answer — LLM answer box via local Ollama ──
    Res aiAnswer(const Req& req) {
        std::string q = param(req, "q");
        if (q.empty()) return {400, R"({"error":"missing q"})"};

        // Get top 3 search results for context
        auto* d = db();
        std::string likeP = "%" + q + "%";
        const char* p[3] = {q.c_str(), likeP.c_str(), "3"};
        PGresult* res = PQexecParams(d,
            "SELECT title, description, url FROM pages WHERE ("
            "to_tsvector('simple',coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(content,''))"
            " @@ plainto_tsquery('simple',$1)"
            " OR title ILIKE $2 OR description ILIKE $2"
            ") ORDER BY ts_rank(to_tsvector('simple',coalesce(title,'')||' '||coalesce(description,'')),plainto_tsquery('simple',$1)) DESC NULLS LAST"
            " LIMIT $3::int",
            3, nullptr, p, nullptr, nullptr, 0);

        std::string context;
        if (PQresultStatus(res) == PGRES_TUPLES_OK) {
            int rows = PQntuples(res);
            for (int i = 0; i < rows; i++) {
                std::string title = PQgetvalue(res, i, 0);
                std::string desc  = PQgetvalue(res, i, 1);
                context += std::to_string(i+1) + ". " + title;
                if (!desc.empty()) context += ": " + desc.substr(0, 200);
                context += "\n";
            }
        }
        PQclear(res);
        PQfinish(d);

        // Build prompt — use search context if available, otherwise use Ollama's own knowledge
        std::string prompt;
        if (context.empty()) {
            prompt = "You are a helpful assistant for AngkorSearch, Cambodia's search engine. "
                     "Answer the following question clearly in 2-3 sentences. "
                     "Focus on Cambodia, Khmer history, culture, anime, and technology when relevant.\n\n"
                     "Question: " + q + "\n\nAnswer:";
        } else {
            prompt = "You are a helpful assistant for AngkorSearch, Cambodia's search engine. "
                     "Answer the question briefly and clearly in 2-3 sentences based on the search results below. "
                     "If the results are not relevant, use your own knowledge to answer.\n\n"
                     "Question: " + q + "\n\n"
                     "Search results:\n" + context + "\nAnswer:";
        }

        // Escape prompt for JSON embedding
        std::string ep;
        for (char c : prompt) {
            if      (c == '"')  ep += "\\\"";
            else if (c == '\\') ep += "\\\\";
            else if (c == '\n') ep += "\\n";
            else if (c == '\t') ep += "\\t";
            else                ep += c;
        }

        std::string body = "{\"model\":\"" + cfg.ollamaModel + "\","
                           "\"prompt\":\"" + ep + "\","
                           "\"stream\":false}";

        std::string ollamaResp = httpPost(cfg.ollamaHost + "/api/generate", body, 180);

        if (ollamaResp.empty()) {
            return {503, R"({"error":"AI service unavailable. Is Ollama running?"})"};
        }

        std::string answer = extractJsonStr(ollamaResp, "response");
        if (answer.empty()) {
            return {503, R"({"error":"Could not parse AI response"})"};
        }

        std::string json = "{\"answer\":\"" + je(answer) + "\","
                           "\"model\":\"" + cfg.ollamaModel + "\"}";
        return {200, json};
    }

    // ── POST /click — CTR tracking ──
    // Called when a user clicks a search result. Logs url+query+position and
    // bumps pages.score by 0.1 (capped at 10.0) to feed clicks back into ranking.
    Res logClick(const Req& req) {
        auto b=parseQuery(req.body);
        std::string url  =b.count("url")     ?b.at("url")     :"";
        std::string query=b.count("query")   ?b.at("query")   :"";
        std::string pos  =b.count("position")?b.at("position"):"0";
        if(url.empty()||query.empty()) return {400,R"({"error":"url and query required"})"};
        auto* d=db();
        const char* p1[3]={url.c_str(),query.c_str(),pos.c_str()};
        PQexecParams(d,"INSERT INTO click_logs (url,query,position) VALUES ($1,$2,$3::int)",
            3,nullptr,p1,nullptr,nullptr,0);
        const char* p2[1]={url.c_str()};
        PQexecParams(d,"UPDATE pages SET score=LEAST(score+0.1,10.0) WHERE url=$1",
            1,nullptr,p2,nullptr,nullptr,0);
        PQfinish(d); return {200,R"({"ok":true})"};
    }

    // ── Bookmark endpoints ──
    Res addBookmark(const Req& req) {
        auto b=parseQuery(req.body);
        auto uid=b.count("user_id")?b.at("user_id"):"", url=b.count("url")?b.at("url"):"", title=b.count("title")?b.at("title"):"";
        if(uid.empty()||url.empty()) return {400,R"({"error":"user_id and url required"})"};
        auto* d=db(); const char* p[3]={uid.c_str(),url.c_str(),title.c_str()};
        PQexecParams(d,"INSERT INTO bookmarks(user_id,url,title) VALUES($1::int,$2,$3) ON CONFLICT DO NOTHING",3,nullptr,p,nullptr,nullptr,0);
        PQfinish(d); return {200,R"({"ok":true})"};
    }

    Res getBookmarks(const Req& req) {
        auto uid=param(req,"user_id"); if(uid.empty()) return {400,R"({"error":"user_id required"})"};
        auto* d=db(); const char* p[1]={uid.c_str()};
        PGresult* res=PQexecParams(d,"SELECT url,title,folder,saved_at FROM bookmarks WHERE user_id=$1::int ORDER BY saved_at DESC",1,nullptr,p,nullptr,nullptr,0);
        std::string json="{\"bookmarks\":["; int rows=PQntuples(res);
        for(int i=0;i<rows;i++){if(i>0)json+=",";json+="{\"url\":\""+je(PQgetvalue(res,i,0))+"\",\"title\":\""+je(PQgetvalue(res,i,1))+"\",\"folder\":\""+je(PQgetvalue(res,i,2))+"\",\"saved_at\":\""+std::string(PQgetvalue(res,i,3))+"\"}"; }
        json+="]}"; PQclear(res); PQfinish(d); return {200,json};
    }

    Res getHistory(const Req& req) {
        auto uid=param(req,"user_id"); if(uid.empty()) return {400,R"({"error":"user_id required"})"};
        auto* d=db(); const char* p[1]={uid.c_str()};
        PGresult* res=PQexecParams(d,"SELECT query,search_type,result_count,searched_at FROM search_history WHERE user_id=$1::int ORDER BY searched_at DESC LIMIT 50",1,nullptr,p,nullptr,nullptr,0);
        std::string json="{\"history\":["; int rows=PQntuples(res);
        for(int i=0;i<rows;i++){if(i>0)json+=",";json+="{\"query\":\""+je(PQgetvalue(res,i,0))+"\",\"type\":\""+std::string(PQgetvalue(res,i,1))+"\",\"results\":"+std::string(PQgetvalue(res,i,2))+",\"at\":\""+std::string(PQgetvalue(res,i,3))+"\"}"; }
        json+="]}"; PQclear(res); PQfinish(d); return {200,json};
    }

    Res clearHistory(const Req& req) {
        auto uid=param(req,"user_id"); if(uid.empty()) return {400,R"({"error":"user_id required"})"};
        auto* d=db(); const char* p[1]={uid.c_str()};
        PQexecParams(d,"DELETE FROM search_history WHERE user_id=$1::int",1,nullptr,p,nullptr,nullptr,0);
        PQfinish(d); return {200,R"({"ok":true})"};
    }

    // ── GET /admin/seeds — list all seeds with page counts ──
    Res getSeeds() {
        auto* d = db();
        PGresult* res = PQexec(d,
            "SELECT s.id, s.url, s.domain, s.seed_type, s.priority, s.active::text, "
            "s.added_at::text, COUNT(p.id) AS page_count "
            "FROM seeds s LEFT JOIN pages p ON p.domain = s.domain "
            "GROUP BY s.id ORDER BY s.priority ASC, s.added_at DESC");
        std::string json = "{\"seeds\":[";
        if (PQresultStatus(res) == PGRES_TUPLES_OK) {
            int rows = PQntuples(res);
            for (int i = 0; i < rows; i++) {
                if (i > 0) json += ",";
                std::string active = std::string(PQgetvalue(res, i, 5));
                json += "{\"id\":" + std::string(PQgetvalue(res, i, 0)) + ","
                        "\"url\":\"" + je(PQgetvalue(res, i, 1)) + "\","
                        "\"domain\":\"" + je(PQgetvalue(res, i, 2)) + "\","
                        "\"type\":\"" + je(PQgetvalue(res, i, 3)) + "\","
                        "\"priority\":" + std::string(PQgetvalue(res, i, 4)) + ","
                        "\"active\":" + (active == "t" ? "true" : "false") + ","
                        "\"added_at\":\"" + je(PQgetvalue(res, i, 6)) + "\","
                        "\"page_count\":" + std::string(PQgetvalue(res, i, 7)) + "}";
            }
        }
        json += "]}";
        PQclear(res); PQfinish(d);
        return {200, json};
    }

    // ── POST /admin/seeds — add new seed URL ──
    Res addSeed(const Req& req) {
        auto b = parseQuery(req.body);
        std::string url      = b.count("url")      ? b.at("url")      : "";
        std::string type     = b.count("type")     ? b.at("type")     : "web";
        std::string priority = b.count("priority") ? b.at("priority") : "5";
        if (url.empty()) return {400, R"({"error":"url required"})"};

        // Extract domain
        std::string domain = url;
        auto schemeEnd = domain.find("://");
        if (schemeEnd != std::string::npos) domain = domain.substr(schemeEnd + 3);
        auto slashPos = domain.find('/');
        if (slashPos != std::string::npos) domain = domain.substr(0, slashPos);

        auto* d = db();
        const char* p1[4] = {url.c_str(), domain.c_str(), type.c_str(), priority.c_str()};
        PQexecParams(d,
            "INSERT INTO seeds (url, domain, seed_type, priority) VALUES ($1, $2, $3, $4::int) "
            "ON CONFLICT (url) DO UPDATE SET active=TRUE",
            4, nullptr, p1, nullptr, nullptr, 0);
        const char* p2[3] = {url.c_str(), domain.c_str(), type.c_str()};
        PQexecParams(d,
            "INSERT INTO crawl_queue (url, domain, queue_type, priority) VALUES ($1, $2, $3, 1) "
            "ON CONFLICT (url) DO UPDATE SET crawled=FALSE, crawled_at=NULL, priority=1",
            3, nullptr, p2, nullptr, nullptr, 0);
        PQfinish(d);
        return {200, R"({"ok":true})"};
    }

    // ── PATCH /admin/seeds — update active status and/or priority ──
    Res updateSeed(const Req& req) {
        auto b = parseQuery(req.body);
        std::string id       = b.count("id")       ? b.at("id")       : "";
        std::string active   = b.count("active")   ? b.at("active")   : "";
        std::string priority = b.count("priority") ? b.at("priority") : "";
        if (id.empty()) return {400, R"({"error":"id required"})"};
        auto* d = db();
        if (!active.empty()) {
            const char* p[2] = {active.c_str(), id.c_str()};
            PQexecParams(d, "UPDATE seeds SET active=($1='true') WHERE id=$2::int",
                         2, nullptr, p, nullptr, nullptr, 0);
        }
        if (!priority.empty()) {
            const char* p[2] = {priority.c_str(), id.c_str()};
            PQexecParams(d, "UPDATE seeds SET priority=$1::int WHERE id=$2::int",
                         2, nullptr, p, nullptr, nullptr, 0);
        }
        PQfinish(d);
        return {200, R"({"ok":true})"};
    }

    // ── GET /admin/system — resource + performance metrics ──
    Res systemStats() {
        auto* d = db();
        auto* r = rc();

        // DB size + table sizes
        PGresult* r_db = PQexec(d,
            "SELECT pg_database_size('angkorsearch'),"
            "pg_size_pretty(pg_database_size('angkorsearch'))");

        PGresult* r_tbl = PQexec(d,
            "SELECT relname, pg_total_relation_size(relid) AS sz "
            "FROM pg_stat_user_tables ORDER BY sz DESC LIMIT 8");

        // Pages indexed per hour/day
        PGresult* r_rate = PQexec(d,
            "SELECT "
            "(SELECT COUNT(*) FROM pages WHERE updated_at >= NOW()-INTERVAL '1 hour') AS per_hour,"
            "(SELECT COUNT(*) FROM pages WHERE updated_at >= NOW()-INTERVAL '1 day')  AS per_day,"
            "(SELECT COUNT(*) FROM crawl_queue WHERE crawled=TRUE)::float / "
            " NULLIF((SELECT COUNT(*) FROM crawl_queue),0) * 100 AS queue_pct");

        // Crawler speed (avg pages/min over last 5 mins)
        PGresult* r_speed = PQexec(d,
            "SELECT COUNT(*) FROM crawler_live "
            "WHERE ts >= NOW()-INTERVAL '5 minutes'");

        // Redis INFO memory
        std::string redis_used_bytes = "0", redis_max_bytes = "0",
                    redis_used_human = "N/A", redis_hit_rate = "0";
        {
            redisReply* rep = (redisReply*)redisCommand(r, "INFO memory");
            if (rep && rep->type == REDIS_REPLY_STRING) {
                std::string info(rep->str, rep->len);
                auto pick = [&](const std::string& key) -> std::string {
                    auto pos = info.find(key + ":");
                    if (pos == std::string::npos) return "";
                    pos += key.size() + 1;
                    auto end = info.find('\n', pos);
                    auto val = info.substr(pos, end - pos);
                    while (!val.empty() && (val.back()=='\r'||val.back()==' ')) val.pop_back();
                    return val;
                };
                redis_used_bytes  = pick("used_memory");
                redis_used_human  = pick("used_memory_human");
                redis_max_bytes   = pick("maxmemory");
            }
            freeReplyObject(rep);

            redisReply* rep2 = (redisReply*)redisCommand(r, "INFO stats");
            if (rep2 && rep2->type == REDIS_REPLY_STRING) {
                std::string info(rep2->str, rep2->len);
                auto pick = [&](const std::string& key) -> std::string {
                    auto pos = info.find(key + ":");
                    if (pos == std::string::npos) return "0";
                    pos += key.size() + 1;
                    auto end = info.find('\n', pos);
                    auto val = info.substr(pos, end - pos);
                    while (!val.empty() && (val.back()=='\r'||val.back()==' ')) val.pop_back();
                    return val;
                };
                long hits   = std::stol(pick("keyspace_hits").empty() ? "0" : pick("keyspace_hits"));
                long misses = std::stol(pick("keyspace_misses").empty() ? "0" : pick("keyspace_misses"));
                if (hits + misses > 0)
                    redis_hit_rate = std::to_string((int)(hits * 100 / (hits + misses)));
            }
            freeReplyObject(rep2);
        }
        redisFree(r);

        // System memory (Linux /proc/meminfo)
        long mem_total_kb = 0, mem_avail_kb = 0, mem_free_kb = 0;
        {
            std::ifstream f("/proc/meminfo");
            std::string line;
            while (std::getline(f, line)) {
                if (line.rfind("MemTotal:",     0) == 0) sscanf(line.c_str(), "MemTotal: %ld kB", &mem_total_kb);
                if (line.rfind("MemFree:",      0) == 0) sscanf(line.c_str(), "MemFree: %ld kB",  &mem_free_kb);
                if (line.rfind("MemAvailable:", 0) == 0) sscanf(line.c_str(), "MemAvailable: %ld kB", &mem_avail_kb);
            }
        }

        // Disk usage
        long disk_total_kb = 0, disk_avail_kb = 0;
        {
            struct statvfs vfs;
            if (statvfs("/", &vfs) == 0) {
                disk_total_kb = (long)((unsigned long long)vfs.f_blocks * vfs.f_frsize / 1024);
                disk_avail_kb = (long)((unsigned long long)vfs.f_bavail * vfs.f_frsize / 1024);
            }
        }

        // API uptime
        auto now = std::chrono::steady_clock::now();
        long uptime_sec = (long)std::chrono::duration_cast<std::chrono::seconds>(now - g_start_time).count();

        // System uptime (/proc/uptime)
        double sys_uptime = 0;
        { std::ifstream f("/proc/uptime"); f >> sys_uptime; }

        std::string json = "{";

        // DB
        if (PQresultStatus(r_db)==PGRES_TUPLES_OK && PQntuples(r_db)>0) {
            json += "\"db_size_bytes\":"  + std::string(PQgetvalue(r_db,0,0)) + ","
                    "\"db_size_pretty\":\"" + je(PQgetvalue(r_db,0,1)) + "\",";
        } else {
            json += "\"db_size_bytes\":0,\"db_size_pretty\":\"N/A\",";
        }

        json += "\"tables\":[";
        if (PQresultStatus(r_tbl)==PGRES_TUPLES_OK) {
            int rows=PQntuples(r_tbl);
            for(int i=0;i<rows;i++){
                if(i>0) json+=",";
                json+="{\"name\":\""+je(PQgetvalue(r_tbl,i,0))+"\",\"bytes\":"+std::string(PQgetvalue(r_tbl,i,1))+"}";
            }
        }
        json += "],";

        if (PQresultStatus(r_rate)==PGRES_TUPLES_OK && PQntuples(r_rate)>0) {
            std::string qpct = PQgetvalue(r_rate,0,2);
            if (qpct.empty()) qpct = "0";
            json += "\"pages_per_hour\":"    + std::string(PQgetvalue(r_rate,0,0)) + ","
                    "\"pages_per_day\":"     + std::string(PQgetvalue(r_rate,0,1)) + ","
                    "\"queue_progress_pct\":" + qpct + ",";
        } else {
            json += "\"pages_per_hour\":0,\"pages_per_day\":0,\"queue_progress_pct\":0,";
        }

        std::string speed = (PQresultStatus(r_speed)==PGRES_TUPLES_OK&&PQntuples(r_speed)>0)
                            ? PQgetvalue(r_speed,0,0) : "0";
        json += "\"crawler_events_5m\":" + speed + ",";

        json += "\"redis_used_bytes\":"  + redis_used_bytes + ","
                "\"redis_max_bytes\":"   + redis_max_bytes  + ","
                "\"redis_used_human\":\"" + je(redis_used_human) + "\","
                "\"redis_hit_rate\":"    + redis_hit_rate   + ",";

        json += "\"mem_total_kb\":"   + std::to_string(mem_total_kb)  + ","
                "\"mem_avail_kb\":"   + std::to_string(mem_avail_kb)  + ","
                "\"disk_total_kb\":"  + std::to_string(disk_total_kb) + ","
                "\"disk_avail_kb\":"  + std::to_string(disk_avail_kb) + ","
                "\"api_uptime_sec\":" + std::to_string(uptime_sec)    + ","
                "\"sys_uptime_sec\":" + std::to_string((long)sys_uptime) + "}";

        PQclear(r_db); PQclear(r_tbl); PQclear(r_rate); PQclear(r_speed);
        PQfinish(d);
        return {200, json};
    }

    // ── DELETE /admin/seeds — remove a seed ──
    Res deleteSeed(const Req& req) {
        std::string id = param(req, "id");
        if (id.empty()) return {400, R"({"error":"id required"})"};
        auto* d = db();
        const char* p[1] = {id.c_str()};
        PQexecParams(d, "DELETE FROM seeds WHERE id=$1::int", 1, nullptr, p, nullptr, nullptr, 0);
        PQfinish(d);
        return {200, R"({"ok":true})"};
    }

    // ── POST /admin/queue — manually add URL to crawl queue ──
    Res addToQueue(const Req& req) {
        auto b = parseQuery(req.body);
        std::string url  = b.count("url")  ? b.at("url")  : "";
        std::string type = b.count("type") ? b.at("type") : "web";
        if (url.empty()) return {400, R"({"error":"url required"})"};
        std::string domain = url;
        auto schemeEnd = domain.find("://");
        if (schemeEnd != std::string::npos) domain = domain.substr(schemeEnd + 3);
        auto slashPos = domain.find('/');
        if (slashPos != std::string::npos) domain = domain.substr(0, slashPos);
        auto* d = db();
        const char* p[3] = {url.c_str(), domain.c_str(), type.c_str()};
        PQexecParams(d,
            // priority=0 beats all seeds (priority>=1) — absolute front of queue
            "INSERT INTO crawl_queue (url, domain, queue_type, priority) VALUES ($1, $2, $3, 0) "
            "ON CONFLICT (url) DO UPDATE SET crawled=FALSE, crawled_at=NULL, priority=0",
            3, nullptr, p, nullptr, nullptr, 0);
        PQfinish(d);
        // Redis: purge visited set (so crawler doesn't skip it) + push to force list
        // (pub/sub substitute — workers RPOP crawl:force at the start of each loop)
        auto* r = rc();
        if (r && !r->err) {
            redisReply* r1=(redisReply*)redisCommand(r,"SREM visited %s",url.c_str());
            freeReplyObject(r1);
            redisReply* r2=(redisReply*)redisCommand(r,"LPUSH crawl:force %s",url.c_str());
            freeReplyObject(r2);
            redisFree(r);
        }
        return {200, R"({"ok":true})"};
    }

    // ── POST /admin/crawl-now — directly fetch, parse and index a URL (bypasses crawler queue) ──
    Res crawlNow(const Req& req) {
        auto b = parseQuery(req.body);
        std::string url  = b.count("url") ? b.at("url") : "";
        if (url.empty()) return {400, R"({"error":"url required"})"};

        // Extract domain
        std::string domain = url;
        auto se = domain.find("://");
        if (se != std::string::npos) domain = domain.substr(se + 3);
        auto sl = domain.find('/');
        if (sl != std::string::npos) domain = domain.substr(0, sl);

        // Fetch the page
        std::string html = httpGet(url);
        if (html.empty()) {
            return {502, "{\"error\":\"fetch_failed\",\"msg\":\"Could not fetch the URL. "
                         "The server may be unreachable or returned a non-200 status.\"}"};
        }

        // Parse
        std::string title = htmlTagContent(html, "title");
        if (title.empty()) title = htmlTagContent(html, "TITLE");
        std::string desc  = htmlMetaContent(html, "description");
        if (desc.empty()) desc = htmlMetaContent(html, "og:description");
        std::string text  = htmlToText(html);
        if (text.size() > 80000) text.resize(80000);

        // Detect language (Khmer Unicode U+1780–U+17FF → UTF-8 E1 9E/9F xx)
        std::string lang = "en";
        for (size_t i = 0; i + 2 < text.size(); i++) {
            unsigned char a=(unsigned char)text[i], b2=(unsigned char)text[i+1];
            if (a==0xE1 && (b2==0x9E||b2==0x9F)) { lang="km"; break; }
        }

        // Page type
        std::string pageType = "web";
        if (domain.find("github.com") != std::string::npos) pageType = "github";
        else if (url.find("/news")!=std::string::npos||url.find("article")!=std::string::npos) pageType="news";

        int wc = (int)std::count(text.begin(), text.end(), ' ');
        std::string wcStr = std::to_string(wc);

        // Save to pages
        auto* d = db();
        const char* pp[8]={url.c_str(),domain.c_str(),title.c_str(),desc.c_str(),
                            lang.c_str(),text.c_str(),wcStr.c_str(),pageType.c_str()};
        PGresult* pr = PQexecParams(d,
            "INSERT INTO pages (url,domain,title,description,language,content,word_count,page_type) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7::int,$8) "
            "ON CONFLICT (url) DO UPDATE SET "
            "title=$3,description=$4,language=$5,content=$6,word_count=$7::int,updated_at=NOW()",
            8,nullptr,pp,nullptr,nullptr,0);
        bool saved = (PQresultStatus(pr)==PGRES_COMMAND_OK);
        PQclear(pr);

        // ── Save og:image / twitter:image to images table ──────────────────────
        // This is why force-crawling a GitHub/LinkedIn profile shows the avatar in image search.
        auto saveImg = [&](const std::string& imgUrl, const std::string& altText) {
            if (imgUrl.empty() || imgUrl.substr(0,4) != "http") return;
            std::string ext; { auto dot=imgUrl.rfind('.'); if(dot!=std::string::npos) ext=imgUrl.substr(dot+1); if(ext.size()>5) ext=""; }
            const char* ip[6]={imgUrl.c_str(),url.c_str(),altText.c_str(),domain.c_str(),lang.c_str(),ext.c_str()};
            PQexecParams(d,
                "INSERT INTO images (url,page_url,alt_text,domain,language,file_type) "
                "VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (url) DO NOTHING",
                6,nullptr,ip,nullptr,nullptr,0);
        };
        std::string ogImage = htmlMetaContent(html, "og:image");
        if (ogImage.empty()) ogImage = htmlMetaContent(html, "twitter:image");
        saveImg(ogImage, title);

        // ── GitHub profile: call GitHub API to get avatar_url directly ──────────
        // More reliable than HTML scraping — always returns the correct profile photo.
        if (domain == "github.com") {
            // Extract username: github.com/{username} — only shallow profiles (no sub-paths)
            std::string slug = url;
            auto sep = url.find("github.com/");
            if (sep != std::string::npos) {
                slug = url.substr(sep + 11);
                if (!slug.empty() && slug.back()=='/') slug.pop_back();
                if (!slug.empty() && slug.find('/')==std::string::npos) {
                    // Fetch GitHub API with JSON Accept header
                    CURL* gc = curl_easy_init();
                    std::string apiResp;
                    if (gc) {
                        std::string apiUrl = "https://api.github.com/users/" + slug;
                        struct curl_slist* gh = nullptr;
                        gh = curl_slist_append(gh, "Accept: application/vnd.github+json");
                        gh = curl_slist_append(gh, "X-GitHub-Api-Version: 2022-11-28");
                        curl_easy_setopt(gc, CURLOPT_URL,           apiUrl.c_str());
                        curl_easy_setopt(gc, CURLOPT_WRITEFUNCTION, curlWriteCb);
                        curl_easy_setopt(gc, CURLOPT_WRITEDATA,     &apiResp);
                        curl_easy_setopt(gc, CURLOPT_TIMEOUT,       8L);
                        curl_easy_setopt(gc, CURLOPT_USERAGENT,     "AngkorSearchBot/2.3");
                        curl_easy_setopt(gc, CURLOPT_HTTPHEADER,    gh);
                        curl_easy_perform(gc);
                        curl_slist_free_all(gh); curl_easy_cleanup(gc);
                    }
                    // Parse avatar_url from JSON
                    auto av = apiResp.find("\"avatar_url\"");
                    if (av != std::string::npos) {
                        auto q1 = apiResp.find('"', av + 13);
                        auto q2 = q1!=std::string::npos ? apiResp.find('"', q1+1) : std::string::npos;
                        if (q2 != std::string::npos) {
                            std::string avatarUrl = apiResp.substr(q1+1, q2-q1-1);
                            saveImg(avatarUrl, title); // save avatar to images table
                        }
                    }
                }
            }
        }

        // Mark crawled in queue
        const char* qp[3]={url.c_str(),domain.c_str(),"web"};
        PQexecParams(d,
            "INSERT INTO crawl_queue (url,domain,queue_type,priority,crawled,crawled_at) "
            "VALUES ($1,$2,$3,0,TRUE,NOW()) "
            "ON CONFLICT (url) DO UPDATE SET crawled=TRUE,crawled_at=NOW(),priority=0",
            3,nullptr,qp,nullptr,nullptr,0);
        PQfinish(d);

        // Mark visited in Redis
        auto* r = rc();
        if (r && !r->err) {
            redisReply* rep=(redisReply*)redisCommand(r,"SADD visited %s",url.c_str());
            freeReplyObject(rep); redisFree(r);
        }

        if (!saved) return {500,R"({"error":"db_error","msg":"Page fetched but failed to save to database."})"};

        std::string json = "{\"ok\":true,"
            "\"title\":"    + (title.empty()?"\"(no title)\"":"\""+je(title)+"\"") + ","
            "\"desc\":"     + (desc.empty()?"\"\"":"\""+je(desc.size()>200?desc.substr(0,200):desc)+"\"") + ","
            "\"lang\":\""   + je(lang) + "\","
            "\"type\":\""   + je(pageType) + "\","
            "\"words\":"    + wcStr + ","
            "\"chars\":"    + std::to_string(text.size()) + "}";
        return {200, json};
    }

    // ── GET /admin/crawl-status?url=... — check crawl queue + pages for a specific URL ──
    Res crawlStatus(const Req& req) {
        std::string url = param(req, "url");
        if (url.empty()) return {400, R"({"error":"url required"})"};

        auto* d = db();
        const char* p[1] = {url.c_str()};

        // Check crawl_queue
        PGresult* qr = PQexecParams(d,
            "SELECT crawled, priority, added_at, crawled_at FROM crawl_queue WHERE url=$1",
            1, nullptr, p, nullptr, nullptr, 0);

        // Check pages table
        PGresult* pr = PQexecParams(d,
            "SELECT title, description, lang, type, updated_at FROM pages WHERE url=$1",
            1, nullptr, p, nullptr, nullptr, 0);

        std::string json = "{\"url\":\"" + je(url) + "\",";

        bool in_queue = PQntuples(qr) > 0;
        bool in_pages = PQntuples(pr) > 0;

        if (in_pages) {
            json += "\"status\":\"done\","
                    "\"page_title\":\""   + je(PQgetvalue(pr,0,0)) + "\","
                    "\"page_desc\":\""    + je(PQgetvalue(pr,0,1)) + "\","
                    "\"page_lang\":\""    + je(PQgetvalue(pr,0,2)) + "\","
                    "\"page_type\":\""    + je(PQgetvalue(pr,0,3)) + "\","
                    "\"page_indexed\":\"" + je(PQgetvalue(pr,0,4)) + "\"";
        } else if (in_queue) {
            bool crawled = std::string(PQgetvalue(qr,0,0)) == "t";
            json += "\"status\":\""   + std::string(crawled ? "claimed" : "queued") + "\","
                    "\"priority\":"   + std::string(PQgetvalue(qr,0,1)) + ","
                    "\"added_at\":\"" + je(PQgetvalue(qr,0,2)) + "\"";
            if (crawled) {
                json += std::string(",\"crawled_at\":\"") + je(PQgetvalue(qr,0,3)) + "\"";
            }
        } else {
            json += "\"status\":\"not_found\"";
        }

        json += "}";
        PQclear(qr); PQclear(pr); PQfinish(d);
        return {200, json};
    }

    // ── GET /social?domain= — social media links for a domain ──
    // Returns Facebook/YouTube/TikTok/Telegram/Twitter links discovered during crawl.
    // Used by search result cards to surface official social pages.
    Res getSocialLinks(const Req& req) {
        std::string domain = param(req, "domain");
        if (domain.empty()) return {400, R"({"error":"domain required"})"};

        PGconn* d = db();
        if (PQstatus(d) != CONNECTION_OK) { PQfinish(d); return {500, R"({"error":"db"})"}; }

        const char* p[1] = {domain.c_str()};
        PGresult* r = PQexecParams(d,
            "SELECT platform, url FROM social_links WHERE domain=$1 ORDER BY platform",
            1, nullptr, p, nullptr, nullptr, 0);

        std::string json = "{\"domain\":\"" + je(domain) + "\",\"links\":[";
        int n = PQntuples(r);
        for (int i = 0; i < n; i++) {
            if (i) json += ",";
            json += "{\"platform\":\"" + je(PQgetvalue(r,i,0)) + "\","
                    "\"url\":\""       + je(PQgetvalue(r,i,1)) + "\"}";
        }
        json += "]}";
        PQclear(r); PQfinish(d);
        return {200, json};
    }

    // ── GET /sitelinks?domain=&exclude= — top sub-pages from a domain ──
    // Used by TopResult to show Google-style sitelinks under the first result.
    Res sitelinks(const Req& req) {
        std::string domain  = param(req, "domain");
        std::string exclude = param(req, "exclude");
        if (domain.empty()) return {400, R"({"error":"domain required"})"};

        auto* d = db();
        const char* p[2] = {domain.c_str(), exclude.c_str()};
        PGresult* r = PQexecParams(d,
            "SELECT url, title, description FROM pages "
            "WHERE domain=$1 AND url!=$2 AND title IS NOT NULL AND title!='' "
            "ORDER BY score DESC, word_count DESC LIMIT 6",
            2, nullptr, p, nullptr, nullptr, 0);

        std::string json = "{\"domain\":\"" + je(domain) + "\",\"links\":[";
        int n = PQntuples(r);
        for (int i = 0; i < n; i++) {
            if (i) json += ",";
            json += "{\"url\":\""   + je(PQgetvalue(r,i,0)) + "\","
                    "\"title\":\""  + je(PQgetvalue(r,i,1)) + "\","
                    "\"desc\":\""   + je(std::string(PQgetvalue(r,i,2)).substr(0,80)) + "\"}";
        }
        json += "]}";
        PQclear(r); PQfinish(d);
        return {200, json};
    }

    // ── DELETE /admin/domain?domain= — wipe all data for a domain ──
    // Removes from: pages, images, videos, news, social_links, crawl_queue.
    // Returns deleted row counts per table.
    Res deleteDomain(const Req& req) {
        std::string domain = param(req, "domain");
        if (domain.empty()) return {400, R"({"error":"domain required"})"};

        PGconn* d = db();
        if (PQstatus(d) != CONNECTION_OK) { PQfinish(d); return {500, R"({"error":"db"})"}; }

        const char* p[1] = {domain.c_str()};
        struct { const char* table; long deleted; } tables[] = {
            {"pages",       0},
            {"images",      0},
            {"videos",      0},
            {"news",        0},
            {"social_links",0},
            {"crawl_queue", 0},
        };
        long total = 0;
        std::string json = "{\"domain\":\"" + je(domain) + "\",\"deleted\":{";
        for (auto& t : tables) {
            std::string sql = std::string("DELETE FROM ") + t.table + " WHERE domain=$1";
            PGresult* r = PQexecParams(d, sql.c_str(), 1, nullptr, p, nullptr, nullptr, 0);
            if (PQresultStatus(r) == PGRES_COMMAND_OK) {
                t.deleted = std::stol(PQcmdTuples(r));
                total += t.deleted;
            }
            PQclear(r);
        }
        bool first = true;
        for (auto& t : tables) {
            if (!first) json += ",";
            json += "\"" + std::string(t.table) + "\":" + std::to_string(t.deleted);
            first = false;
        }
        json += "},\"total\":" + std::to_string(total) + "}";
        PQfinish(d);
        return {200, json};
    }

    Res route(const Req& req) {
        if(req.method=="OPTIONS")     return {200,""};
        if(req.path=="/health")       return health();
        if(req.path=="/live")         return live(req);
        if(req.path=="/search")       return search(req);
        if(req.path=="/suggest")      return suggest(req);
        if(req.path=="/stats")        return stats();
        if(req.path=="/social")        return getSocialLinks(req);
        if(req.path=="/sitelinks")     return sitelinks(req);
        if(req.path=="/admin/stats")  return adminStats();
        if(req.path=="/admin/seeds"  && req.method=="GET")    return getSeeds();
        if(req.path=="/admin/seeds"  && req.method=="POST")   return addSeed(req);
        if(req.path=="/admin/seeds"  && req.method=="PATCH")  return updateSeed(req);
        if(req.path=="/admin/seeds"  && req.method=="DELETE") return deleteSeed(req);
        if(req.path=="/admin/domain" && req.method=="DELETE") return deleteDomain(req);
        if(req.path=="/admin/queue"        && req.method=="POST") return addToQueue(req);
        if(req.path=="/admin/crawl-now"    && req.method=="POST") return crawlNow(req);
        if(req.path=="/admin/crawl-status" && req.method=="GET")  return crawlStatus(req);
        if(req.path=="/admin/system"       && req.method=="GET")  return systemStats();
        if(req.path=="/ai/answer")    return aiAnswer(req);
        if(req.path=="/click"     && req.method=="POST")   return logClick(req);
        if(req.path=="/bookmark"  && req.method=="POST")   return addBookmark(req);
        if(req.path=="/bookmarks" && req.method=="GET")    return getBookmarks(req);
        if(req.path=="/history"   && req.method=="GET")    return getHistory(req);
        if(req.path=="/history"   && req.method=="DELETE") return clearHistory(req);
        return {404,R"({"error":"not found"})"};
    }
};

void handleClient(int fd, API& api) {
    char buf[65536]={};
    recv(fd,buf,sizeof(buf)-1,0);
    Req req=parseReq(std::string(buf));
    Res res=api.route(req);
    std::string r=buildRes(res);
    send(fd,r.c_str(),r.size(),0);
    close(fd);
}

int main() {
    curl_global_init(CURL_GLOBAL_DEFAULT);
    Config cfg; API api(cfg);
    int sfd=socket(AF_INET,SOCK_STREAM,0);
    int opt=1; setsockopt(sfd,SOL_SOCKET,SO_REUSEADDR,&opt,sizeof(opt));
    sockaddr_in addr{}; addr.sin_family=AF_INET;
    addr.sin_addr.s_addr=INADDR_ANY; addr.sin_port=htons(cfg.apiPort);
    bind(sfd,(sockaddr*)&addr,sizeof(addr)); listen(sfd,256);
    std::cout<<"AngkorSearch API v2.2 on port "<<cfg.apiPort<<"\n";
    std::cout<<"Endpoints: /health /live /search /suggest /stats /admin/stats /admin/seeds /admin/queue /ai/answer\n";
    std::cout<<"Ollama: "<<cfg.ollamaHost<<" model="<<cfg.ollamaModel<<"\n";
    while(true){
        int cfd=accept(sfd,nullptr,nullptr); if(cfd<0) continue;
        std::thread([cfd,&api](){handleClient(cfd,api);}).detach();
    }
    curl_global_cleanup();
}
