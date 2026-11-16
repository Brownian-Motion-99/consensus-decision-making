# 默契一致（demo）

同一個區域網路內 2–6 人一起玩的派對遊戲：大家對同一題自由作答，由主持人判定答案是否一致。

## 啟動

```sh
npm install
npm start          # 只接受本機連線，預設 port 3000，可用 PORT=xxxx npm start 修改
npm run start:lan  # 開放同一個區網的裝置連進來
```

`npm start` 只聽 `127.0.0.1`，外部裝置連不進來，適合單機改畫面。要用手機玩時改用 `npm run start:lan`，終端機會印出區網網址和 QR code。主持人電腦和玩家手機要連同一個 Wi-Fi，用瀏覽器開啟網址。

在首頁按「開新房間」，再取暱稱加入，開房的人就是主持人。主持人在大廳可以複製房號或連結（網址會帶 `?room=房號`）傳給其他人，其他人開連結或在首頁輸入 4 碼房號，進房後再取暱稱。一台 server 可以同時開多間房（上限 100 間），房間只能靠房號進入，最後一個人離開就會自動收掉。

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
- `public/`：前端骨架，樣式變數集中在 `style.css` 的 `:root`
- `questions.json`：題庫
- `PLAN.md`：產品設計與架構規劃
