import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { RoomRegistry, MAX_ROOMS, send } from './src/rooms.js';
import { RateLimiter, ConnectionCounter } from './src/limits.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// 預設只接受本機連線（改畫面時用）；LAN=1 才開放同一個區網的裝置連進來
const LAN = process.env.LAN === '1';
// 容器裡要聽 0.0.0.0 才連得到，用 HOST 直接指定
const HOST = process.env.HOST || (LAN ? '0.0.0.0' : '127.0.0.1');
// 只有在 Cloudflare Tunnel 後面才信任它帶的玩家 IP，否則 header 可以被偽造
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const HEARTBEAT_MS = 10_000;
// 連續幾次沒回 pong 才斷線。網路慢的玩家收大快照（公開答案後約 1.8MB）時，pong 會排在快照後面，不能太快判定
const MAX_MISSED_PONGS = 3;

// 開放到外網時擋洗頻用，正常遊玩遠低於這些數字
const connections = new ConnectionCounter({ total: 200, perKey: 20 });
const createLimiter = new RateLimiter({ limit: 5, windowMs: 60_000 });
const MESSAGES_PER_SECOND = 20;

// 只提供這幾個檔案，避免路徑穿越。路徑相對於專案根目錄
const STATIC_FILES = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/index.html': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/board.js': ['public/board.js', 'text/javascript; charset=utf-8'],
  '/sounds.js': ['public/sounds.js', 'text/javascript; charset=utf-8'],
  '/fade-up.js': ['public/fade-up.js', 'text/javascript; charset=utf-8'],
  '/title-reveal.js': ['public/title-reveal.js', 'text/javascript; charset=utf-8'],
  '/confetti.js': ['public/confetti.js', 'text/javascript; charset=utf-8'],
  '/iris.js': ['public/iris.js', 'text/javascript; charset=utf-8'],
  '/photo-stack.js': ['public/photo-stack.js', 'text/javascript; charset=utf-8'],
  '/hold-button.js': ['public/hold-button.js', 'text/javascript; charset=utf-8'],
  '/submit-transition.js': ['public/submit-transition.js', 'text/javascript; charset=utf-8'],
  '/curtain.js': ['public/curtain.js', 'text/javascript; charset=utf-8'],
  '/splash.js': ['public/splash.js', 'text/javascript; charset=utf-8'],
  '/greeting.js': ['public/greeting.js', 'text/javascript; charset=utf-8'],
  '/vendor/Physics2DPlugin.min.js': ['node_modules/gsap/dist/Physics2DPlugin.min.js', 'text/javascript; charset=utf-8'],
  '/vendor/gsap.min.js': ['node_modules/gsap/dist/gsap.min.js', 'text/javascript; charset=utf-8'],
  '/loudness.js': ['public/loudness.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/preview.html': ['public/preview.html', 'text/html; charset=utf-8'],
  '/preview.js': ['public/preview.js', 'text/javascript; charset=utf-8'],
  '/preview-desktop.html': ['public/preview-desktop.html', 'text/html; charset=utf-8'],
  '/preview-gallery.js': ['public/preview-gallery.js', 'text/javascript; charset=utf-8'],
  '/preview.css': ['public/preview.css', 'text/css; charset=utf-8'],
  '/tweaks.js': ['public/tweaks.js', 'text/javascript; charset=utf-8'],
  '/audio/correct.mp3': ['audio/correct.mp3', 'audio/mpeg'],
  '/audio/wrong.mp3': ['audio/wrong.mp3', 'audio/mpeg'],
  '/audio/congrats.mp3': ['audio/congrats.mp3', 'audio/mpeg'],
};

/** 找出本機的區網 IPv4，優先選常見的私有網段。 */
function lanAddress() {
  const candidates = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) candidates.push(addr.address);
    }
  }
  const isPrivate = (ip) =>
    ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return candidates.find(isPrivate) ?? candidates[0] ?? 'localhost';
}

const questions = JSON.parse(await readFile(join(ROOT, 'questions.json'), 'utf8'));
const baseUrl = `http://${LAN ? lanAddress() : 'localhost'}:${PORT}`;
const rooms = new RoomRegistry({
  questions,
  joinUrlFor: (code) => `${baseUrl}/?room=${code}`,
  maxRooms: Number(process.env.MAX_ROOMS) || MAX_ROOMS,
});

function clientIp(req) {
  const forwarded = TRUST_PROXY ? req.headers['cf-connecting-ip'] : undefined;
  return (typeof forwarded === 'string' && forwarded) || req.socket.remoteAddress || 'unknown';
}

const http = createServer(async (req, res) => {
  let path;
  try {
    path = new URL(req.url, 'http://x').pathname;
  } catch {
    // 網址格式錯誤（例如 `GET http://[`），new URL 會丟例外，沒接住的話整個 process 會結束
    res.writeHead(400);
    res.end();
    return;
  }
  const entry = STATIC_FILES[path];
  if (!entry) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  try {
    const body = await readFile(join(ROOT, entry[0]));
    res.writeHead(200, {
      'Content-Type': entry[1],
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end();
  }
});

const wss = new WebSocketServer({ server: http, maxPayload: 256 * 1024 });
const sockets = new Set();

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  if (!connections.acquire(ip)) {
    ws.close(1013, 'Too many connections');
    return;
  }
  const id = randomUUID();
  const messageLimiter = new RateLimiter({ limit: MESSAGES_PER_SECOND, windowMs: 1000 });
  let session = null; // 這條連線所在的房間，開房或輸入房號之後才有
  sockets.add(ws);
  ws.missedPongs = 0;
  // 訊息超過大小上限、frame 格式錯誤時，ws 會發出 error 再自己關掉連線。
  // 沒有 error listener 的話，Node 會把它當成沒處理的錯誤，整個 process 結束
  ws.on('error', () => {});
  ws.on('pong', () => {
    ws.missedPongs = 0;
  });

  // 還沒進房間時只能開房或輸入房號
  const entryHandlers = {
    create() {
      if (!createLimiter.hit(ip)) return '開房太頻繁，請稍後再試';
      const { session: created, error } = rooms.create();
      if (error) return error;
      session = created;
      session.attach(ws, id, { owner: true }); // 新房間一定進得去
      return null;
    },
    enter(msg) {
      const found = rooms.get(msg.code);
      if (!found) return `找不到會議編號「${String(msg.code ?? '').trim().slice(0, 8)}」`;
      const error = found.attach(ws, id);
      if (error) {
        // 還沒取暱稱的連線太多，大概是有人在灌連線：不說明原因，直接斷線
        send(ws, { type: 'error', message: error });
        ws.close(1008);
        return null;
      }
      session = found;
      return null;
    },
  };

  ws.on('message', (raw) => {
    try {
      handleMessage(raw);
    } catch (err) {
      // 最後一道防線：處理單一訊息時出了沒想到的錯，只回錯誤給這條連線，不讓整個 server 掛掉
      console.error('處理訊息時發生錯誤', err);
      send(ws, { type: 'error', message: '發生錯誤，請重新整理' });
    }
  });

  function handleMessage(raw) {
    if (!messageLimiter.hit(id)) return send(ws, { type: 'error', message: '操作太頻繁，請稍後再試' });
    if (session?.closed) session = null; // 房間閒置太久被收掉了，回到還沒進房的狀態
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(ws, { type: 'error', message: '訊息格式錯誤' });
    }
    // 用 hasOwn 查表：type 是 __proto__、valueOf 這類物件繼承的屬性名稱時，不能被當成處理函式
    const isEntry = Object.hasOwn(entryHandlers, msg?.type);
    let error;
    if (session) {
      error = isEntry ? '你已經在會議室裡了' : session.handle(ws, msg);
    } else {
      error = isEntry ? entryHandlers[msg.type](msg) : '請先召開會議或輸入會議編號';
    }
    if (error) send(ws, { type: 'error', message: error });
  }

  ws.on('close', () => {
    sockets.delete(ws);
    connections.release(ip);
    session?.detach(ws);
  });
});

// 手機鎖螢幕時連線常常不會正常關閉，定期 ping 來偵測
setInterval(() => {
  for (const ws of sockets) {
    if (ws.missedPongs >= MAX_MISSED_PONGS) {
      ws.terminate();
      continue;
    }
    ws.missedPongs += 1;
    ws.ping();
  }
}, HEARTBEAT_MS);

http.listen(PORT, HOST, async () => {
  console.log('本次會議我們採取共識決 server 已啟動');
  if (process.env.HOST) {
    console.log(`監聽 ${HOST}:${PORT}`);
    return;
  }
  console.log(`本機：http://localhost:${PORT}`);
  if (!LAN) {
    console.log('只接受本機連線，要讓手機連進來請用 npm run start:lan');
    return;
  }
  console.log(`區網：${baseUrl}`);
  console.log(await QRCode.toString(baseUrl, { type: 'terminal', small: true }));
});
