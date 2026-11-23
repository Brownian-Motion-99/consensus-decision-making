# 開發者指引

此為開發者指引。玩法與架設伺服器見 [README.md](../README.md)。產品規則與架構見 [PLAN.md](PLAN.md)，工作進度見 [PROGRESS.md](PROGRESS.md)。

## 啟動

```sh
npm install
npm start          # 只接受本機連線，預設 port 3000，可用 PORT=xxxx npm start 修改
npm run start:lan  # 開放同一個區網的裝置連進來，終端機會印出區網網址和 QR code
```

`npm start` 只聽 `127.0.0.1`，外部裝置連不進來，適合單機改畫面。要用手機測試時改用 `npm run start:lan`。

## 外網連線（Docker ＋ Cloudflare Tunnel）

```sh
npm run tunnel       # build 並啟動容器，印出 https://xxx.trycloudflare.com 網址和 QR code
npm run tunnel:down  # 關閉，網址會立刻失效
```

改了程式碼之後重跑 `npm run tunnel` 就會重新 build。設定都在 `docker-compose.yml`。

遊戲 server 跑在 sandbox 容器裡，跟本機隔開：

- 容器放在 `internal` 網路上，不能上網，本機也沒有開任何 port，唯一的入口是 cloudflared 容器。
- 不掛載任何本機資料夾，檔案系統唯讀，用非 root 的 `node` 使用者執行，拿掉所有 Linux 特權。
- 限制記憶體（256 MB）、CPU 和 process 數量。
- 房間上限降為 20 間。每個 IP 最多同時 20 條連線，每分鐘最多開 5 間房；每條連線每秒最多 20 則訊息。

### 環境變數

| 變數 | 用途 |
|---|---|
| `PORT` | 監聽的 port，預設 3000 |
| `LAN=1` | 聽 `0.0.0.0`，開放區網連線，啟動時印出區網網址和 QR code |
| `HOST` | 直接指定監聽位址（容器裡用 `0.0.0.0`），設定後不印網址 |
| `TRUST_PROXY=1` | 信任 Cloudflare 帶的 `CF-Connecting-IP`。只有在 tunnel 後面才能開，否則 header 可以被偽造 |
| `MAX_ROOMS` | 房間上限，預設 100 |

## 畫面預覽（細修版面用）

啟動 server 後開啟：

- `http://localhost:3000/preview.html`：手機尺寸，並排顯示所有畫面，可以切換裝置、縮放和身分
- `http://localhost:3000/preview-desktop.html`：電腦 16:9（1280×720 到 1920×1080），以原解析度渲染後縮小顯示

單一畫面可以直接開 `/?preview=<名稱>&as=<host|guest>`，例如 `/?preview=revealed&as=guest`。

劇本模式 `/?preview=flow&as=<host|guest>` 會在左下角顯示控制面板，用 ◀ ▶（或鍵盤 ← →）依序切換狀態，也可以自動播放，用來看狀態切換時的動畫和音效。

總覽頁右上角的「調整面板」可以用滑桿和色票即時調整 `style.css` 裡 `:root` 的變數，改動會同步套用到所有預覽畫面（包括另開的分頁），按「複製改動」可以拿到要寫回 CSS 的內容。改動只存在瀏覽器的 localStorage，不會改到檔案。

預覽使用假資料、不會連線，按鈕也不會真的送出。要新增預覽，編輯 `public/preview.js` 的 `PREVIEWS`。

## 測試

```sh
npm test
```

## 檔案

- `src/game.js`：遊戲狀態機（唯一的權威狀態）
- `src/rooms.js`：多房間。`RoomSession` 是一間房（遊戲狀態＋連線＋廣播），`RoomRegistry` 用房號管理所有房間
- `server.js`：HTTP 靜態檔案 + WebSocket，連線先開房或輸入房號，之後的操作交給所在的房間
- `src/limits.js`：限流（開房頻率、訊息頻率、同時連線數）
- `Dockerfile`、`docker-compose.yml`、`scripts/tunnel-url.js`：外網連線用的容器與 tunnel
- `public/`：前端骨架，樣式變數集中在 `style.css` 的 `:root`
- `questions.json`：題庫
- `docs/`：給 Claude Code 讀的文件。`PLAN.md` 是產品設計與架構規劃，`PROGRESS.md` 是工作進度，`DEVELOPMENT.md` 是本文件

## 授權

本專案**不是開源軟體**，完整條款見 [LICENSE](../LICENSE)。重點：

- 可以：個人、非商業目的的下載、執行、自架伺服器和朋友玩；為了自己使用而修改。
- 不可以：散布本軟體或修改版（包括在 fork 裡放修改版）、商業使用、移除授權條款。
- 歡迎開 issue 回報問題或提出建議。提交 pull request 即表示你同意作者以任何條款使用、修改和散布你提交的內容。

### 第三方素材

`audio/` 的三個音效取自 [Freesound](https://freesound.org/)，依照各自的授權使用，不適用本專案的 LICENSE。

| 檔案 | 用途 | 出處 | 授權 |
|---|---|---|---|
| `audio/correct.mp3` | 達成共識 | ["correct.wav"](https://freesound.org/people/StavSounds/sounds/546084/) by StavSounds | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `audio/wrong.mp3` | 未達共識 | ["Wrong Buzzer"](https://freesound.org/people/KevinVG207/sounds/331912/) by KevinVG207 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `audio/congrats.mp3` | 會議紀錄（結算） | ["Party Pack, Horn Coil 01, Long, 01.wav"](https://freesound.org/people/InspectorJ/sounds/484267/) by InspectorJ ([www.jshaw.co.uk](https://www.jshaw.co.uk)) of Freesound.org | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

另外，連線中的輪播動畫、啟動頁轉場、換頁簾幕、送出答案的轉場、公開答案的轉場、結算的彩紙和大廳的進場動畫用 [GSAP](https://gsap.com/)（npm 套件 `gsap`），依照它的 [Standard "no charge" license](https://gsap.com/standard-license) 使用，不適用本專案的 LICENSE。server 從 `node_modules/gsap/dist/gsap.min.js` 以 `/vendor/gsap.min.js` 提供，不從 CDN 載入，區網沒有外網時也能用；本 repo 不含它的檔案，需要先 `npm install`。

三個檔案都是 Freesound 的 preview（低音質 mp3），檔案本身沒有修改；播放時的響度正規化是在瀏覽器裡即時計算的。`congrats.mp3` 是 CC BY 4.0，**散布時一定要保留上面的作者標示**。

換音效時要同步更新這張表。Freesound 的音效常見三種授權：CC0（不用標示）、CC BY（要標示作者和出處）、CC BY-NC（要標示，且不能商用）。
