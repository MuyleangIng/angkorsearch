// ============================================================
//  api_server.cpp — AngkorSearch v2 API
//  Endpoints: search, suggest, images, videos, github,
//             news, bookmarks, history
// ============================================================

#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <unordered_map>
#include <thread>
#include <cstring>
#include <cstdlib>
#include <algorithm>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <libpq-fe.h>
#include <hiredis/hiredis.h>

// ─────────────────────────────────────────
// Config
// ─────────────────────────────────────────
struct Config {
    std::string dbHost="postgres", dbPort="5432",
                dbName="angkorsearch", dbUser="angkor",
                dbPass="angkor_secret_2024",
                redisHost="redis";
    int redisPort=6379, apiPort=8080;
    Config() {
        auto e=[](const char* k,const char* d){ const char* v=std::getenv(k); return v?std::string(v):std::string(d); };
        dbHost    = e("DB_HOST","postgres");   dbPort  = e("DB_PORT","5432");
        dbName    = e("DB_NAME","angkorsearch"); dbUser = e("DB_USER","angkor");
        dbPass    = e("DB_PASS","angkor_secret_2024");
        redisHost = e("REDIS_HOST","redis");
        redisPort = std::stoi(e("REDIS_PORT","6379"));
        apiPort   = std::stoi(e("API_PORT","8080"));
    }
};

// ─────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────
std::string urlDecode(const std::string& s) {
    std::string r; char h[3]={};
    for (size_t i=0;i<s.size();i++) {
        if (s[i]=='+'){ r+=' '; continue; }
        if (s[i]=='%'&&i+2<s.size()){ h[0]=s[i+1];h[1]=s[i+2];r+=(char)std::stoi(h,nullptr,16);i+=2; }
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

std::string je(const std::string& s) { // JSON escape
    std::string r;
    for(char c:s){ switch(c){ case '"':r+="\\\"";break; case '\\':r+="\\\\";break; case '\n':r+="\\n";break; case '\r':r+="\\r";break; case '\t':r+="\\t";break; default:r+=c; } }
    return r;
}

struct Req { std::string method,path,qs,body; std::unordered_map<std::string,std::string> p; };
struct Res { int status=200; std::string body,ct="application/json"; };

Req parseReq(const std::string& raw) {
    Req req; std::istringstream ss(raw); std::string line;
    std::getline(ss,line); std::istringstream fl(line);
    std::string pq; fl>>req.method>>pq;
    auto q=pq.find('?');
    if(q!=std::string::npos){ req.path=pq.substr(0,q); req.qs=pq.substr(q+1); req.p=parseQuery(req.qs); }
    else req.path=pq;
    size_t bs=raw.find("\r\n\r\n");
    if(bs!=std::string::npos) req.body=raw.substr(bs+4);
    return req;
}

std::string buildRes(const Res& res) {
    std::string st="OK";
    if(res.status==400)st="Bad Request";
    if(res.status==404)st="Not Found";
    if(res.status==500)st="Internal Server Error";
    return "HTTP/1.1 "+std::to_string(res.status)+" "+st+"\r\n"
           "Content-Type: "+res.ct+"; charset=utf-8\r\n"
           "Access-Control-Allow-Origin: *\r\n"
           "Access-Control-Allow-Methods: GET,POST,DELETE,OPTIONS\r\n"
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

    redisContext* rc() {
        return redisConnect(cfg.redisHost.c_str(), cfg.redisPort);
    }

    std::string cacheGet(redisContext* r, const std::string& k) {
        redisReply* rep=(redisReply*)redisCommand(r,"GET %s",k.c_str());
        std::string v; if(rep&&rep->type==REDIS_REPLY_STRING) v=std::string(rep->str,rep->len);
        freeReplyObject(rep); return v;
    }

    void cacheSet(redisContext* r,const std::string& k,const std::string& v,int ttl=60) {
        redisReply* rep=(redisReply*)redisCommand(r,"SETEX %s %d %s",k.c_str(),ttl,v.c_str());
        freeReplyObject(rep);
    }

    std::string param(const Req& r, const std::string& k, const std::string& def="") {
        return r.p.count(k) ? r.p.at(k) : def;
    }

    void logSearch(PGconn* d, const std::string& q, int cnt, const std::string& type, const std::string& lang) {
        const char* p[4]={q.c_str(),std::to_string(cnt).c_str(),type.c_str(),lang.c_str()};
        PQexecParams(d,
            "INSERT INTO search_history (query,result_count,search_type,language) VALUES ($1,$2::int,$3,$4)",
            4,nullptr,p,nullptr,nullptr,0);
        PQexecParams(d,
            "INSERT INTO suggestions (query,normalized,language,source) VALUES ($1,lower($1),$4,'search') "
            "ON CONFLICT (query) DO UPDATE SET count=suggestions.count+1,updated_at=NOW()",
            4,nullptr,p,nullptr,nullptr,0);
        const char* p2[1]={q.c_str()};
        PQexecParams(d,
            "INSERT INTO popular_searches (query,count) VALUES ($1,1) "
            "ON CONFLICT (query) DO UPDATE SET count=popular_searches.count+1,last_at=NOW()",
            1,nullptr,p2,nullptr,nullptr,0);
    }

public:
    API(const Config& c):cfg(c){}

    // ── /health ──
    Res health() { return {200,R"({"status":"ok","version":"2.0","engine":"AngkorSearch"})"}; }

    // ── /search?q=...&type=web|news|image|video|github&lang=km|en&page=1 ──
    Res search(const Req& req) {
        std::string q    = param(req,"q");
        std::string type = param(req,"type","web");
        std::string lang = param(req,"lang");
        int page         = std::stoi(param(req,"page","1"));
        int limit=10, offset=(page-1)*limit;
        if(q.empty()) return {400,R"({"error":"missing q"})"};

        auto* r = rc();
        std::string ck="s:"+q+":"+type+":"+lang+":"+std::to_string(page);
        std::string cached=cacheGet(r,ck);
        if(!cached.empty()){ redisFree(r); return {200,cached}; }

        auto* d=db();
        PGresult* res=nullptr;
        std::string json;

        if(type=="image") {
            // Image search
            const char* p[3]={q.c_str(),std::to_string(limit).c_str(),std::to_string(offset).c_str()};
            res=PQexecParams(d,
                "SELECT url,page_url,alt_text,domain,file_type FROM images "
                "WHERE to_tsvector('english',coalesce(alt_text,'')||' '||coalesce(title,'')) "
                "@@ plainto_tsquery($1) "
                "ORDER BY crawled_at DESC LIMIT $2::int OFFSET $3::int",
                3,nullptr,p,nullptr,nullptr,0);
            json="{\"type\":\"image\",\"results\":[";
            int rows=PQntuples(res);
            for(int i=0;i<rows;i++){
                if(i>0)json+=",";
                json+="{\"url\":\""+je(PQgetvalue(res,i,0))+"\","
                      "\"page_url\":\""+je(PQgetvalue(res,i,1))+"\","
                      "\"alt\":\""+je(PQgetvalue(res,i,2))+"\","
                      "\"domain\":\""+je(PQgetvalue(res,i,3))+"\","
                      "\"type\":\""+std::string(PQgetvalue(res,i,4))+"\"}";
            }
            json+="],\"count\":"+std::to_string(rows)+"}";

        } else if(type=="video") {
            // Video search
            const char* p[3]={q.c_str(),std::to_string(limit).c_str(),std::to_string(offset).c_str()};
            res=PQexecParams(d,
                "SELECT url,embed_url,thumb_url,title,description,channel FROM videos "
                "WHERE to_tsvector('english',coalesce(title,'')||' '||coalesce(description,'')) "
                "@@ plainto_tsquery($1) "
                "ORDER BY crawled_at DESC LIMIT $2::int OFFSET $3::int",
                3,nullptr,p,nullptr,nullptr,0);
            json="{\"type\":\"video\",\"results\":[";
            int rows=PQntuples(res);
            for(int i=0;i<rows;i++){
                if(i>0)json+=",";
                json+="{\"url\":\""+je(PQgetvalue(res,i,0))+"\","
                      "\"embed\":\""+je(PQgetvalue(res,i,1))+"\","
                      "\"thumb\":\""+je(PQgetvalue(res,i,2))+"\","
                      "\"title\":\""+je(PQgetvalue(res,i,3))+"\","
                      "\"desc\":\""+je(PQgetvalue(res,i,4))+"\","
                      "\"channel\":\""+je(PQgetvalue(res,i,5))+"\"}";
            }
            json+="],\"count\":"+std::to_string(rows)+"}";

        } else if(type=="github") {
            // GitHub search
            const char* p[3]={q.c_str(),std::to_string(limit).c_str(),std::to_string(offset).c_str()};
            res=PQexecParams(d,
                "SELECT repo_url,name,full_name,description,language,stars,forks,owner FROM github_repos "
                "WHERE to_tsvector('english',coalesce(name,'')||' '||coalesce(description,'')) "
                "@@ plainto_tsquery($1) "
                "ORDER BY stars DESC LIMIT $2::int OFFSET $3::int",
                3,nullptr,p,nullptr,nullptr,0);
            json="{\"type\":\"github\",\"results\":[";
            int rows=PQntuples(res);
            for(int i=0;i<rows;i++){
                if(i>0)json+=",";
                json+="{\"url\":\""+je(PQgetvalue(res,i,0))+"\","
                      "\"name\":\""+je(PQgetvalue(res,i,1))+"\","
                      "\"full_name\":\""+je(PQgetvalue(res,i,2))+"\","
                      "\"desc\":\""+je(PQgetvalue(res,i,3))+"\","
                      "\"lang\":\""+je(PQgetvalue(res,i,4))+"\","
                      "\"stars\":"+std::string(PQgetvalue(res,i,5))+","
                      "\"forks\":"+std::string(PQgetvalue(res,i,6))+","
                      "\"owner\":\""+je(PQgetvalue(res,i,7))+"\"}";
            }
            json+="],\"count\":"+std::to_string(rows)+"}";

        } else if(type=="news") {
            // News search
            std::vector<std::string> pv={q,std::to_string(limit),std::to_string(offset)};
            std::string sql="SELECT url,title,description,image_url,source,published_at FROM news "
                "WHERE to_tsvector('english',coalesce(title,'')||' '||coalesce(description,'')) "
                "@@ plainto_tsquery($1) ";
            if(!lang.empty()){ sql+="AND language=$4 "; pv.push_back(lang); }
            sql+="ORDER BY published_at DESC NULLS LAST LIMIT $2::int OFFSET $3::int";
            std::vector<const char*> pp; for(auto& s:pv) pp.push_back(s.c_str());
            res=PQexecParams(d,sql.c_str(),(int)pp.size(),nullptr,pp.data(),nullptr,nullptr,0);
            json="{\"type\":\"news\",\"results\":[";
            int rows=PQntuples(res);
            for(int i=0;i<rows;i++){
                if(i>0)json+=",";
                json+="{\"url\":\""+je(PQgetvalue(res,i,0))+"\","
                      "\"title\":\""+je(PQgetvalue(res,i,1))+"\","
                      "\"desc\":\""+je(PQgetvalue(res,i,2))+"\","
                      "\"image\":\""+je(PQgetvalue(res,i,3))+"\","
                      "\"source\":\""+je(PQgetvalue(res,i,4))+"\","
                      "\"published\":\""+std::string(PQgetvalue(res,i,5))+"\"}";
            }
            json+="],\"count\":"+std::to_string(rows)+"}";

        } else {
            // Web search (default)
            std::vector<std::string> pv={q,std::to_string(limit),std::to_string(offset)};
            std::string sql=
                "SELECT id,url,title,description,"
                "ts_headline('english',coalesce(content,''),plainto_tsquery($1),'MaxWords=30,MinWords=15') AS snippet,"
                "language,page_type,"
                "ts_rank(to_tsvector('english',coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(content,'')),plainto_tsquery($1)) AS rank "
                "FROM pages "
                "WHERE to_tsvector('english',coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(content,'')) "
                "@@ plainto_tsquery($1) ";
            if(!lang.empty()){ sql+="AND language=$4 "; pv.push_back(lang); }
            sql+="ORDER BY rank DESC LIMIT $2::int OFFSET $3::int";
            std::vector<const char*> pp; for(auto& s:pv) pp.push_back(s.c_str());
            res=PQexecParams(d,sql.c_str(),(int)pp.size(),nullptr,pp.data(),nullptr,nullptr,0);
            json="{\"type\":\"web\",\"query\":\""+je(q)+"\",\"page\":"+std::to_string(page)+",\"results\":[";
            int rows=PQntuples(res);
            for(int i=0;i<rows;i++){
                if(i>0)json+=",";
                json+="{\"id\":"+std::string(PQgetvalue(res,i,0))+","
                      "\"url\":\""+je(PQgetvalue(res,i,1))+"\","
                      "\"title\":\""+je(PQgetvalue(res,i,2))+"\","
                      "\"description\":\""+je(PQgetvalue(res,i,3))+"\","
                      "\"snippet\":\""+je(PQgetvalue(res,i,4))+"\","
                      "\"lang\":\""+std::string(PQgetvalue(res,i,5))+"\","
                      "\"type\":\""+std::string(PQgetvalue(res,i,6))+"\","
                      "\"score\":"+std::string(PQgetvalue(res,i,7))+"}";
            }
            json+="],\"count\":"+std::to_string(rows)+"}";
        }

        if(res) PQclear(res);
        logSearch(d,q,(int)std::count(json.begin(),json.end(),'{'),type,lang);
        PQfinish(d);
        cacheSet(r,ck,json,60);
        redisFree(r);
        return {200,json};
    }

    // ── /suggest?q=... — smart Khmer+English suggestions ──
    Res suggest(const Req& req) {
        std::string q=param(req,"q");
        if(q.size()<1) return {200,R"({"suggestions":[]})"};

        auto* r=rc();
        std::string ck="sug:"+q;
        std::string cached=cacheGet(r,ck);
        if(!cached.empty()){ redisFree(r); return {200,cached}; }

        auto* d=db();
        std::string pattern=q+"%";
        std::string similar="%"+q+"%";
        const char* p[2]={pattern.c_str(),similar.c_str()};

        // Trigram similarity + prefix match combined
        PGresult* res=PQexecParams(d,
            "SELECT DISTINCT query FROM suggestions "
            "WHERE normalized LIKE lower($1) "
            "   OR normalized LIKE lower($2) "
            "ORDER BY count DESC LIMIT 10",
            2,nullptr,p,nullptr,nullptr,0);

        std::string json="{\"suggestions\":[";
        int rows=PQntuples(res);
        for(int i=0;i<rows;i++){
            if(i>0)json+=",";
            json+="\""+je(PQgetvalue(res,i,0))+"\"";
        }
        json+="]}";

        PQclear(res);
        PQfinish(d);
        cacheSet(r,ck,json,120);
        redisFree(r);
        return {200,json};
    }

    // ── /stats — index summary ──
    Res stats() {
        auto* d=db();
        PGresult* res=PQexec(d,"SELECT * FROM v_index_summary");
        std::string json="{}";
        if(PQresultStatus(res)==PGRES_TUPLES_OK && PQntuples(res)>0){
            json="{\"pages\":"+std::string(PQgetvalue(res,0,0))+","
                  "\"images\":"+std::string(PQgetvalue(res,0,1))+","
                  "\"videos\":"+std::string(PQgetvalue(res,0,2))+","
                  "\"github\":"+std::string(PQgetvalue(res,0,3))+","
                  "\"news\":"+std::string(PQgetvalue(res,0,4))+","
                  "\"queue_pending\":"+std::string(PQgetvalue(res,0,5))+"}";
        }
        PQclear(res); PQfinish(d);
        return {200,json};
    }

    // ── /bookmark POST ──
    Res addBookmark(const Req& req) {
        auto b=parseQuery(req.body);
        auto uid=b.count("user_id")?b.at("user_id"):"";
        auto url=b.count("url")?b.at("url"):"";
        auto title=b.count("title")?b.at("title"):"";
        if(uid.empty()||url.empty()) return {400,R"({"error":"user_id and url required"})"};
        auto* d=db();
        const char* p[3]={uid.c_str(),url.c_str(),title.c_str()};
        PQexecParams(d,"INSERT INTO bookmarks(user_id,url,title) VALUES($1::int,$2,$3) ON CONFLICT DO NOTHING",3,nullptr,p,nullptr,nullptr,0);
        PQfinish(d);
        return {200,R"({"ok":true})"};
    }

    // ── /bookmarks GET ──
    Res getBookmarks(const Req& req) {
        auto uid=param(req,"user_id");
        if(uid.empty()) return {400,R"({"error":"user_id required"})"};
        auto* d=db(); const char* p[1]={uid.c_str()};
        PGresult* res=PQexecParams(d,
            "SELECT url,title,folder,saved_at FROM bookmarks WHERE user_id=$1::int ORDER BY saved_at DESC",
            1,nullptr,p,nullptr,nullptr,0);
        std::string json="{\"bookmarks\":[";
        int rows=PQntuples(res);
        for(int i=0;i<rows;i++){
            if(i>0)json+=",";
            json+="{\"url\":\""+je(PQgetvalue(res,i,0))+"\","
                  "\"title\":\""+je(PQgetvalue(res,i,1))+"\","
                  "\"folder\":\""+je(PQgetvalue(res,i,2))+"\","
                  "\"saved_at\":\""+std::string(PQgetvalue(res,i,3))+"\"}";
        }
        json+="]}";
        PQclear(res); PQfinish(d);
        return {200,json};
    }

    // ── /history GET ──
    Res getHistory(const Req& req) {
        auto uid=param(req,"user_id");
        if(uid.empty()) return {400,R"({"error":"user_id required"})"};
        auto* d=db(); const char* p[1]={uid.c_str()};
        PGresult* res=PQexecParams(d,
            "SELECT query,search_type,result_count,searched_at FROM search_history WHERE user_id=$1::int ORDER BY searched_at DESC LIMIT 50",
            1,nullptr,p,nullptr,nullptr,0);
        std::string json="{\"history\":[";
        int rows=PQntuples(res);
        for(int i=0;i<rows;i++){
            if(i>0)json+=",";
            json+="{\"query\":\""+je(PQgetvalue(res,i,0))+"\","
                  "\"type\":\""+std::string(PQgetvalue(res,i,1))+"\","
                  "\"results\":"+std::string(PQgetvalue(res,i,2))+","
                  "\"at\":\""+std::string(PQgetvalue(res,i,3))+"\"}";
        }
        json+="]}";
        PQclear(res); PQfinish(d);
        return {200,json};
    }

    // ── /history DELETE ──
    Res clearHistory(const Req& req) {
        auto uid=param(req,"user_id");
        if(uid.empty()) return {400,R"({"error":"user_id required"})"};
        auto* d=db(); const char* p[1]={uid.c_str()};
        PQexecParams(d,"DELETE FROM search_history WHERE user_id=$1::int",1,nullptr,p,nullptr,nullptr,0);
        PQfinish(d);
        return {200,R"({"ok":true})"};
    }

    Res route(const Req& req) {
        if(req.method=="OPTIONS") return {200,""};
        if(req.path=="/health")    return health();
        if(req.path=="/search")    return search(req);
        if(req.path=="/suggest")   return suggest(req);
        if(req.path=="/stats")     return stats();
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
    Config cfg; API api(cfg);
    int sfd=socket(AF_INET,SOCK_STREAM,0);
    int opt=1; setsockopt(sfd,SOL_SOCKET,SO_REUSEADDR,&opt,sizeof(opt));
    sockaddr_in addr{}; addr.sin_family=AF_INET;
    addr.sin_addr.s_addr=INADDR_ANY; addr.sin_port=htons(cfg.apiPort);
    bind(sfd,(sockaddr*)&addr,sizeof(addr)); listen(sfd,256);
    std::cout<<"AngkorSearch API v2.0 on port "<<cfg.apiPort<<"\n";
    while(true) {
        int cfd=accept(sfd,nullptr,nullptr);
        if(cfd<0) continue;
        std::thread([cfd,&api](){ handleClient(cfd,api); }).detach();
    }
}