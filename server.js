import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { RoomRegistry } from './src/rooms.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// 預設只接受本機連線（改畫面時用）；LAN=1 才開放同一個區網的裝置連進來
const LAN = process.env.LAN === '1';
const HEARTBEAT_MS = 10_000;

// 只提供這幾個檔案，避免路徑穿越。路徑相對於專案根目錄
const STATIC_FILES = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/index.html': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/board.js': ['public/board.js', 'text/javascript; charset=utf-8'],
  '/sounds.js': ['public/sounds.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/preview.html': ['public/preview.html', 'text/html; charset=utf-8'],
  '/preview.js': ['public/preview.js', 'text/javascript; charset=utf-8'],
  '/preview-desktop.html': ['public/preview-desktop.html', 'text/html; charset=utf-8'],
  '/preview-gallery.js': ['public/preview-gallery.js', 'text/javascript; charset=utf-8'],
  '/preview.css': ['public/preview.css', 'text/css; charset=utf-8'],
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
  makeInvite: async (code) => {
    const joinUrl = `${baseUrl}/?room=${code}`;
    return { joinUrl, qrDataUrl: await QRCode.toDataURL(joinUrl, { margin: 1, width: 240 }) };
  },
});

const http = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const entry = STATIC_FILES[path];
  if (!entry) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  try {
    const body = await readFile(join(ROOT, entry[0]));
    res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end();
  }
});

const wss = new WebSocketServer({ server: http, maxPayload: 256 * 1024 });
const sockets = new Set();

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
  const id = randomUUID();
  let session = null; // 這條連線所在的房間，開房或輸入房號之後才有
  let creating = false;
  sockets.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // 還沒進房間時只能開房或輸入房號
  const entryHandlers = {
    async create() {
      creating = true;
      try {
        const { session: created, error } = await rooms.create();
        if (error) return error;
        // 產生 QR code 的期間連線可能已經斷了
        if (ws.readyState !== ws.OPEN) {
          rooms.release(created);
          return null;
        }
        session = created;
        session.attach(ws, id, { owner: true });
        return null;
      } finally {
        creating = false;
      }
    },
    enter(msg) {
      const found = rooms.get(msg.code);
      if (!found) return `找不到房號「${String(msg.code ?? '').trim().slice(0, 8)}」`;
      session = found;
      session.attach(ws, id);
      return null;
    },
  };

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(ws, { type: 'error', message: '訊息格式錯誤' });
    }
    let error;
    if (session) {
      error = entryHandlers[msg?.type] ? '你已經在房間裡了' : session.handle(ws, msg);
    } else if (creating) {
      error = '正在開房間，請稍候';
    } else {
      const handler = entryHandlers[msg?.type];
      error = handler ? await handler(msg) : '請先開房間或輸入房號';
    }
    if (error) send(ws, { type: 'error', message: error });
  });

  ws.on('close', () => {
    sockets.delete(ws);
    if (!session) return;
    session.detach(ws);
    rooms.release(session);
  });
});

// 手機鎖螢幕時連線常常不會正常關閉，定期 ping 來偵測
setInterval(() => {
  for (const ws of sockets) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

http.listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', async () => {
  console.log('默契一致 server 已啟動');
  console.log(`本機：http://localhost:${PORT}`);
  if (!LAN) {
    console.log('只接受本機連線，要讓手機連進來請用 npm run start:lan');
    return;
  }
  console.log(`區網：${baseUrl}`);
  console.log(await QRCode.toString(baseUrl, { type: 'terminal', small: true }));
});
