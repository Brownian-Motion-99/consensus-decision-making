// 從 cloudflared 的 log 抓出 trycloudflare 網址，印出網址和 QR code。
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import QRCode from 'qrcode';

const TIMEOUT_MS = 30_000;
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g;

function latestUrl() {
  const logs = execFileSync('docker', ['compose', 'logs', '--no-log-prefix', 'tunnel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 容器重開過的話 log 裡會有舊網址，取最後一個
  return logs.match(URL_PATTERN)?.at(-1) ?? null;
}

const deadline = Date.now() + TIMEOUT_MS;
let url = null;
while (!(url = latestUrl()) && Date.now() < deadline) await sleep(1000);

if (!url) {
  console.error('等了 30 秒還沒拿到網址，請用 docker compose logs tunnel 看看狀況');
  process.exit(1);
}

console.log(`外網：${url}`);
console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
console.log('關閉：npm run tunnel:down');
