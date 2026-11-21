# 本次會議我們採取共識決（demo）

2–8 人一起玩的派對遊戲（同一個區網，或透過 Cloudflare Tunnel 從外網連線）：大家對同一題自由作答，由主持人判定答案是否一致。畫面上的用語模仿開會（主持人叫「主席」、一致叫「達成共識」等），對照表見 [docs/PLAN.md](docs/PLAN.md)。

## 啟動

```sh
npm install
npm start          # 只接受本機連線，預設 port 3000，可用 PORT=xxxx npm start 修改
npm run start:lan  # 開放同一個區網的裝置連進來
```

`npm start` 只聽 `127.0.0.1`，外部裝置連不進來，適合單機改畫面。要用手機玩時改用 `npm run start:lan`，終端機會印出區網網址和 QR code。主持人電腦和玩家手機要連同一個 Wi-Fi，用瀏覽器開啟網址。

在首頁按「開新房間」，再取暱稱加入，開房的人就是主持人。主持人在大廳可以複製房號或連結（網址會帶 `?room=房號`）傳給其他人，其他人開連結或在首頁輸入 4 碼房號，進房後再取暱稱。一台 server 可以同時開多間房（上限 100 間），房間只能靠房號進入。遊戲進行中也能加入，題目進行中加入的人先列席，下一題開始時才一起作答；重新整理也是用這個方式回到房間。最後一個人離開 30 秒後，或連續 10 分鐘沒有人取暱稱加入時，房間會自動收掉。

## 外網連線（Docker ＋ Cloudflare Tunnel）

不同網路的朋友也想一起玩，又不想部署到雲端時使用。需要先安裝並開啟 Docker Desktop。

```sh
npm run tunnel       # build 並啟動容器，印出 https://xxx.trycloudflare.com 網址和 QR code
npm run tunnel:down  # 關閉，網址會立刻失效
```

- 不需要 Cloudflare 帳號，也不用設定 router。但每次啟動網址都會不同，不玩的時候記得關掉。
- 拿到網址的人都連得進來，請只傳給要一起玩的人。
- 改了程式碼之後重跑 `npm run tunnel` 就會重新 build。

遊戲 server 跑在 sandbox 容器裡，跟本機隔開：

- 容器放在 `internal` 網路上，不能上網，本機也沒有開任何 port，唯一的入口是 cloudflared 容器。
- 不掛載任何本機資料夾，檔案系統唯讀，用非 root 的 `node` 使用者執行，拿掉所有 Linux 特權。
- 限制記憶體（256 MB）、CPU 和 process 數量。
- 房間上限降為 20 間。每個 IP 最多同時 20 條連線，每分鐘最多開 5 間房；每條連線每秒最多 20 則訊息。

設定都在 `docker-compose.yml`。server 用到的環境變數：`HOST`（監聽位址）、`TRUST_PROXY=1`（信任 Cloudflare 帶的 `CF-Connecting-IP`，只有在 tunnel 後面才能開）、`MAX_ROOMS`。

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
- `docs/`：給 Claude Code 讀的文件。`PLAN.md` 是產品設計與架構規劃，`PROGRESS.md` 是工作進度
