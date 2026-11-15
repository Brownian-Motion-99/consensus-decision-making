# 默契一致（demo）

同一個區域網路內 2–6 人一起玩的派對遊戲：大家對同一題自由作答，由主持人判定答案是否一致。

## 啟動

```sh
npm install
npm start          # 預設 port 3000，可用 PORT=xxxx npm start 修改
```

終端機會印出區網網址和 QR code。主持人電腦和玩家手機要連同一個 Wi-Fi，用瀏覽器開啟網址加入。第一個加入的人是主持人。

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
