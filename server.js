import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { Room } from './src/game.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HEARTBEAT_MS = 10_000;

// 只提供這幾個檔案，避免路徑穿越
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/board.js': ['board.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
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
const room = new Room({ questions });
const joinUrl = `http://${lanAddress()}:${PORT}`;
const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, width: 240 });

const http = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const entry = STATIC_FILES[path];
  if (!entry) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  try {
    const body = await readFile(join(ROOT, 'public', entry[0]));
    res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end();
  }
});

const wss = new WebSocketServer({ server: http, maxPayload: 256 * 1024 });
const clients = new Map(); // ws -> playerId

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastState() {
  for (const [ws, id] of clients) send(ws, { type: 'state', state: room.viewFor(id) });
}

function broadcastNotice(message) {
  for (const ws of clients.keys()) send(ws, { type: 'notice', message });
}

const handlers = {
  join: (id, msg) => room.join(id, msg.name),
  setTargetMatches: (id, msg) => room.setTargetMatches(id, msg.count),
  start: (id) => room.start(id),
  answer: (id, msg) => room.answer(id, msg.image),
  reveal: (id) => room.reveal(id),
  judge: (id, msg) => room.judge(id, msg.match),
  next: (id) => room.next(id),
  backToLobby: (id) => room.backToLobby(id),
};

wss.on('connection', (ws) => {
  const id = randomUUID();
  clients.set(ws, id);
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  send(ws, { type: 'welcome', joinUrl, qrDataUrl });
  send(ws, { type: 'state', state: room.viewFor(id) });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(ws, { type: 'error', message: '訊息格式錯誤' });
    }
    const handler = handlers[msg?.type];
    if (!handler) return send(ws, { type: 'error', message: '未知的操作' });
    const error = handler(id, msg);
    if (error) return send(ws, { type: 'error', message: error });
    broadcastState();
  });

  ws.on('close', () => {
    clients.delete(ws);
    const player = room.players.get(id);
    if (!player) return;
    const wasInGame = room.inGame();
    const newHostId = room.leave(id);
    const notices = [`${player.name} 離線了`];
    if (newHostId) notices.push(`新主持人是 ${room.players.get(newHostId).name}`);
    if (wasInGame && room.phase === 'finished') notices.push('人數不足，直接進入結算');
    broadcastNotice(notices.join('，'));
    broadcastState();
  });
});

// 手機鎖螢幕時連線常常不會正常關閉，定期 ping 來偵測
setInterval(() => {
  for (const ws of clients.keys()) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

http.listen(PORT, '0.0.0.0', async () => {
  console.log('默契一致 server 已啟動');
  console.log(`本機：http://localhost:${PORT}`);
  console.log(`區網：${joinUrl}`);
  console.log(await QRCode.toString(joinUrl, { type: 'terminal', small: true }));
});
