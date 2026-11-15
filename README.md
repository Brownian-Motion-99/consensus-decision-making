# 默契一致（demo）

同一個區域網路內 2–6 人一起玩的派對遊戲：大家對同一題自由作答，由主持人判定答案是否一致。

## 啟動

```sh
npm install
npm start          # 預設 port 3000，可用 PORT=xxxx npm start 修改
```

終端機會印出區網網址和 QR code。主持人電腦和玩家手機要連同一個 Wi-Fi，用瀏覽器開啟網址加入。第一個加入的人是主持人。

## 畫面預覽（細修版面用）

啟動 server 後開啟 `http://localhost:3000/preview.html`，會用手機尺寸並排顯示所有畫面，可以切換寬度和身分。
單一畫面可以直接開 `/?preview=<名稱>&as=<host|guest>`，例如 `/?preview=revealed&as=guest`。
預覽使用假資料、不會連線，按鈕也不會真的送出。要新增預覽，編輯 `public/preview.js` 的 `PREVIEWS`。

## 測試

```sh
npm test
```

## 檔案

- `src/game.js`：遊戲狀態機（唯一的權威狀態）
- `server.js`：HTTP 靜態檔案 + WebSocket
- `public/`：前端骨架，樣式變數集中在 `style.css` 的 `:root`
- `questions.json`：題庫
- `PLAN.md`：產品設計與架構規劃
