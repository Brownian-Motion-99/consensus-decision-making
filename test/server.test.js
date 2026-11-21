// 從外面打真的 server：任何輸入最多只能斷掉那一條連線，不能讓整個 process 結束。
// 每個測試各開一台 server，每個情境之後都確認 process 還活著、HTTP 還回應得了。

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let server;
let port;
let stderr = '';

function freePort() {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

beforeEach(async () => {
  stderr = '';
  port = await freePort();
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port) } });
  server.stderr.on('data', (d) => (stderr += d));
  await new Promise((resolve) => server.stdout.once('data', resolve));
});

afterEach(() => server.kill());

async function assertAlive(what) {
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(server.exitCode, null, `${what} 讓 server 掛了：\n${stderr}`);
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
}

/** 開一條連線，送出訊息，收集回覆，最後關掉。 */
function session(steps) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const replies = [];
    ws.on('message', (raw) => replies.push(JSON.parse(raw)));
    ws.on('error', () => {});
    ws.on('close', () => resolve(replies));
    ws.on('open', async () => {
      await steps(ws, replies);
      await new Promise((r) => setTimeout(r, 100));
      ws.close();
    });
  });
}

const tick = () => new Promise((r) => setTimeout(r, 20));
// 每個物件都會繼承的屬性名稱（__proto__、constructor、valueOf…），拿來當訊息的 type
const INHERITED = Object.getOwnPropertyNames(Object.prototype);

test('還沒進房時，type 是物件繼承的屬性名稱也不會讓 server 掛掉', async () => {
  for (const type of INHERITED) {
    const replies = await session(async (ws) => ws.send(JSON.stringify({ type })));
    assert.ok(replies.some((m) => m.type === 'error'), `type=${type} 沒有回錯誤`);
    await assertAlive(`還沒進房時送 type=${type}`);
  }
});

test('進房後，type 是物件繼承的屬性名稱也不會讓 server 掛掉', async () => {
  // 同一間房裡全部送一遍（每個 IP 每分鐘只能開 5 間房）
  const replies = await session(async (ws) => {
    ws.send(JSON.stringify({ type: 'create' }));
    await tick();
    for (const type of INHERITED) {
      ws.send(JSON.stringify({ type }));
      await tick();
    }
  });
  const errors = replies.filter((m) => m.type === 'error').map((m) => m.message);
  assert.equal(errors.length, INHERITED.length);
  for (const message of errors) assert.match(message, /未知的操作/);
  await assertAlive('進房後送物件繼承的屬性名稱');
});

test('超過大小上限的訊息只會斷掉那條連線', async () => {
  await session(async (ws) => ws.send('x'.repeat(300 * 1024)));
  await assertAlive('超過 256KB 的訊息');
});

test('不合法的 WebSocket frame 只會斷掉那條連線', async () => {
  // 文字 frame 裡放不合法的 UTF-8（0xFF 0xFE），client 端照規定要 mask
  await session(async (ws) => ws._socket.write(Buffer.from([0x81, 0x82, 0, 0, 0, 0, 0xff, 0xfe])));
  await assertAlive('不合法的 UTF-8 frame');
});

test('格式錯誤的網址回傳 400，server 不會掛', async () => {
  const response = await new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1', () => socket.write('GET http://[ HTTP/1.1\r\nHost: x\r\n\r\n'));
    let data = '';
    socket.on('data', (d) => (data += d));
    socket.on('error', () => {});
    socket.on('close', () => resolve(data));
    setTimeout(() => socket.destroy(), 500);
  });
  assert.match(response, /^HTTP\/1\.1 400/);
  await assertAlive('格式錯誤的網址');
});

test('不讀資料的連線一直送小訊息，排隊超過上限就被斷線，server 記憶體不會一直長', async () => {
  const rssKB = () =>
    new Promise((resolve) => {
      const ps = spawn('ps', ['-o', 'rss=', '-p', String(server.pid)]);
      let out = '';
      ps.stdout.on('data', (d) => (out += d));
      ps.on('close', () => resolve(Number(out.trim())));
    });
  const before = await rssKB();
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.on('error', () => {});
  await new Promise((r) => ws.on('open', r));
  ws._socket.pause(); // 不讀 server 送來的任何東西
  let closed = false;
  ws._socket.on('close', () => (closed = true));
  // 每則 1 byte 的訊息都會換到一則錯誤回覆（格式錯誤或太頻繁），沒有上限的話會放大幾十倍
  for (let sent = 0; sent < 1_000_000 && !closed; sent += 10_000) {
    for (let i = 0; i < 10_000; i++) ws.send('x');
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(closed, true, '排隊超過上限的連線要被斷掉');
  const grownMB = ((await rssKB()) - before) / 1024;
  assert.ok(grownMB < 100, `server 記憶體長了 ${grownMB.toFixed(0)}MB`);
  await assertAlive('不讀資料又一直送小訊息');
});
