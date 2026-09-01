/*
 * 回送・納車依頼ボード — 社内サーバー（Node.js版）
 *
 * 使い方:  node server.js
 * ポートを変える: PORT=9000 node server.js  （Windows: set PORT=9000 と打ってから node server.js）
 *
 * 追加のインストールは不要です（Node.js の標準機能だけで動きます）。
 * データは同じフォルダの data.json に保存され、上書き前に data.bak.json へ退避します。
 */
"use strict";
const http = require("http");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const PORT      = Number(process.env.PORT || 8080);
const ROOT      = __dirname;
const DATA_FILE = path.join(ROOT, "data.json");
const BAK_FILE  = path.join(ROOT, "data.bak.json");
const MAX_BODY  = 1024 * 512;         // 1件あたりの上限 512KB
const MIME = {
  ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",   ".json":"application/json; charset=utf-8",
  ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml", ".ico":"image/x-icon"
};

/* ---------- データ ---------- */
let store = readStore();

function readStore(){
  try{
    const j = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      version:  Number(j.version) || 0,
      settings: (j.settings && Array.isArray(j.settings.staff)) ? j.settings : null,
      requests: (j.requests && typeof j.requests === "object") ? j.requests : {}
    };
  }catch(e){
    return { version: 0, settings: null, requests: {} };
  }
}

function writeStore(){
  store.version++;
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  try{ if(fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, BAK_FILE); }catch(e){}
  fs.renameSync(tmp, DATA_FILE);
}

/* ---------- HTTP ---------- */
function sendJson(res, obj, code){
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(code || 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req){
  return new Promise((resolve, reject)=>{
    let size = 0; const chunks = [];
    req.on("data", c=>{
      size += c.length;
      if(size > MAX_BODY){ reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", ()=>{
      if(!chunks.length) return resolve(null);
      try{ resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch(e){ reject(new Error("invalid json")); }
    });
    req.on("error", reject);
  });
}

function serveFile(res, rel){
  const file = path.join(ROOT, rel);
  if(path.relative(ROOT, file).startsWith("..")){ res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(file, (err, buf)=>{
    if(err){ res.writeHead(404, {"Content-Type":"text/plain; charset=utf-8"}); res.end("見つかりません: " + rel); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": buf.length,
      "Cache-Control": "no-cache"
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res)=>{
  const u = new URL(req.url, "http://localhost");
  const p = u.pathname;

  try{
    if(p === "/api/state" && req.method === "GET") return sendJson(res, store);

    if(p === "/api/request" && req.method === "PUT"){
      const r = await readBody(req);
      if(!r || typeof r !== "object" || !r.id) return sendJson(res, {error:"id がありません"}, 400);
      store.requests[String(r.id)] = r;
      writeStore();
      return sendJson(res, store);
    }

    if(p === "/api/request" && req.method === "DELETE"){
      const id = u.searchParams.get("id");
      if(!id) return sendJson(res, {error:"id がありません"}, 400);
      delete store.requests[id];
      writeStore();
      return sendJson(res, store);
    }

    if(p === "/api/settings" && req.method === "PUT"){
      const b = await readBody(req);
      if(!b || !Array.isArray(b.staff)) return sendJson(res, {error:"staff がありません"}, 400);
      store.settings = {staff: b.staff};
      writeStore();
      return sendJson(res, store);
    }

    if(p.startsWith("/api/")) return sendJson(res, {error:"不明なAPIです"}, 404);

    if(req.method !== "GET" && req.method !== "HEAD"){ res.writeHead(405); res.end(); return; }

    // データファイルは配信しない
    if(p === "/data.json" || p === "/data.bak.json"){ res.writeHead(403); res.end("Forbidden"); return; }

    return serveFile(res, p === "/" ? "index.html" : decodeURIComponent(p).replace(/^\/+/, ""));
  }catch(e){
    return sendJson(res, {error: e.message || "エラーが発生しました"}, 400);
  }
});

server.listen(PORT, ()=>{
  const addrs = [];
  const nics = os.networkInterfaces();
  for(const name of Object.keys(nics))
    for(const n of nics[name])
      if(n.family === "IPv4" && !n.internal) addrs.push(n.address);

  console.log("");
  console.log("  回送・納車依頼ボード を起動しました");
  console.log("  ------------------------------------------------");
  console.log("  このPCから      :  http://localhost:" + PORT + "/");
  addrs.forEach(a => console.log("  社内の他のPCから:  http://" + a + ":" + PORT + "/"));
  console.log("  ------------------------------------------------");
  console.log("  データの保存先  :  " + DATA_FILE);
  console.log("  終了するには    :  Ctrl + C");
  console.log("");
});

server.on("error", err=>{
  if(err.code === "EADDRINUSE"){
    console.error("\n  ポート " + PORT + " は既に使われています。");
    console.error("  別のポートで起動してください（例: PORT=8081 node server.js）\n");
  }else{
    console.error(err);
  }
  process.exit(1);
});
