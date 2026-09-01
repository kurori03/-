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
const http   = require("http");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");
const crypto = require("crypto");

/* =========================================================
 *  管理者の設定  ここを書き換えれば管理者とパスワードを変更できます
 *  （api.php を使う場合は、そちらの同じ設定も合わせて直してください）
 * ========================================================= */
const ADMIN_PASSWORD = "suzuki01";                                 // 管理者共通のパスワード
const ADMIN_NAMES    = ["黒田", "稲垣", "深沢", "岩田", "野口"];     // 管理者として承認できる人
const TOKEN_DAYS     = 30;                                         // ログインを保持する日数
/* ======================================================== */

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

/* ---------- 管理者の認証 ---------- */
const SECRET = crypto.createHash("sha256").update("dispatch-board|" + ADMIN_PASSWORD).digest("hex");

function b64u(buf){ return Buffer.from(buf).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function b64ud(s){ return Buffer.from(s.replace(/-/g,"+").replace(/_/g,"/"), "base64").toString("utf8"); }
function sign(payload){ return crypto.createHmac("sha256", SECRET).update(payload).digest("hex"); }

function makeToken(name){
  const payload = b64u(JSON.stringify({n:name, e:(Date.now() + TOKEN_DAYS*86400*1000)}));
  return payload + "." + sign(payload);
}
function tokenName(token){
  if(!token || token.indexOf(".") < 0) return null;
  const i = token.indexOf(".");
  const payload = token.slice(0, i), sig = token.slice(i+1);
  const good = sign(payload);
  if(sig.length !== good.length) return null;
  if(!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  let j; try{ j = JSON.parse(b64ud(payload)); }catch(e){ return null; }
  if(!j || !j.n || !j.e) return null;
  if(Number(j.e) < Date.now()) return null;                 // 期限切れ
  if(ADMIN_NAMES.indexOf(j.n) < 0) return null;             // 管理者から外された
  return j.n;
}
function isAdminReq(req){ return tokenName(req.headers["x-auth"] || "") !== null; }
function safeEqual(a, b){
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const DENIED = {error:"この操作には管理者のパスワードが必要です。右上の「自分の情報」から入力してください。"};

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
function withAdmins(store){
  return {version:store.version, settings:store.settings, requests:store.requests, admins:ADMIN_NAMES};
}

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
    if(p === "/api/login" && req.method === "POST"){
      const b = await readBody(req) || {};
      const name = String(b.name || "").trim(), pw = String(b.password || "");
      await new Promise(r => setTimeout(r, 300));            // 総当たり対策の待ち時間
      if(ADMIN_NAMES.indexOf(name) < 0)
        return sendJson(res, {error:"「"+name+"」は管理者として登録されていません。登録名: "+ADMIN_NAMES.join("・")}, 403);
      if(!safeEqual(ADMIN_PASSWORD, pw))
        return sendJson(res, {error:"パスワードが違います。"}, 403);
      return sendJson(res, {token: makeToken(name), name: name});
    }

    if(p === "/api/state" && req.method === "GET") return sendJson(res, withAdmins(store));

    if(p === "/api/request" && req.method === "PUT"){
      const r = await readBody(req);
      if(!r || typeof r !== "object" || !r.id) return sendJson(res, {error:"id がありません"}, 400);
      // 承認・差戻しは管理者のみ
      if((r.status === "approved" || r.status === "rejected") && !isAdminReq(req)) return sendJson(res, DENIED, 401);
      store.requests[String(r.id)] = r;
      writeStore();
      return sendJson(res, withAdmins(store));
    }

    if(p === "/api/request" && req.method === "DELETE"){
      if(!isAdminReq(req)) return sendJson(res, DENIED, 401);   // 削除は管理者のみ
      const id = u.searchParams.get("id");
      if(!id) return sendJson(res, {error:"id がありません"}, 400);
      delete store.requests[id];
      writeStore();
      return sendJson(res, withAdmins(store));
    }

    if(p === "/api/settings" && req.method === "PUT"){
      if(!isAdminReq(req)) return sendJson(res, DENIED, 401);   // スタッフ設定は管理者のみ
      const b = await readBody(req);
      if(!b || !Array.isArray(b.staff)) return sendJson(res, {error:"staff がありません"}, 400);
      store.settings = {staff: b.staff};
      writeStore();
      return sendJson(res, withAdmins(store));
    }

    if(p.startsWith("/api/")) return sendJson(res, {error:"不明なAPIです"}, 404);

    if(req.method !== "GET" && req.method !== "HEAD"){ res.writeHead(405); res.end(); return; }

    // データファイルは配信しない
    const hidden = ["/data.json", "/data.bak.json", "/data.json.tmp", "/server.js", "/api.php", "/start.sh", "/start.bat"];
    if(hidden.indexOf(p) >= 0){ res.writeHead(403); res.end("Forbidden"); return; }

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
