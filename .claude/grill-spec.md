# grill-spec 的專案設定

全域的 `/grill-spec` skill（`~/.claude/skills/grill-spec/`）會先讀這份檔案。這裡只寫這個專案特有的東西。

## 文件

- **規格**：`docs/PLAN.md`。「威脅模型」一節決定多壞才算壞。PLAN.md 規定要等使用者說「實作程式碼」才開始寫程式。
- **心智模型筆記**：`docs/MENTAL-MODEL.md`。新的盲點補進「練習與答案」或「三個反覆出現的盲點」。身分 × 階段表在「6-3」，新操作要加一列。
- **進度**：`docs/PROGRESS.md`，結束時更新「下一步」。

## 身分和階段

- **身分**：主席（`hostId`）、玩家（`players`）、列席人員（`observers`）、還沒取暱稱的連線（只在 `clients` 裡）。
- **加入的三個階段**：連上線 → 輸入會議編號（在 `clients` 裡）→ 取好暱稱（在 `players` 或 `observers` 裡）。
- **遊戲階段**：見 `src/game.js` 的 `phase`（大廳、作答中、已公開、已判定、休會、結算）。

## 拿來乘的數字

- 每間房最多 8 人，列席人員也算在內。
- 一張圖最大 `MAX_DRAWING_LENGTH`（`src/game.js`），約 200KB。
- 容器模式最多 20 間房，容器記憶體上限 256MB。

## 這個專案的接縫

- 權威狀態只在 `src/game.js` 的 `Room`。前端不記得任何事，每次收到快照就從頭重畫（`public/app.js` 的 `applyState` → `render`）。
- 快照是替每個人分別產生的（`viewFor`），每份都是完整狀態。不該給某人看的東西，`viewFor` 就不能放。
- **放大器**：每次操作成功（`handle`）和每次斷線（`detach`）都會對 `clients` 裡的每一條連線廣播一次完整快照（`broadcastState`）。
- Node 一次只處理一則訊息，所以同時按按鈕由 server 的階段檢查擋下。
- 前端一律用 `textContent` 放使用者輸入的文字，不能用 `innerHTML`。
- 沒辦法拒絕的事件：斷線（`leave`、`detach`）、房間回收的計時器、心跳逾時。
- 觀察資料流：DevTools → Network → 篩選 `Socket` → 點連線 → Messages。要先開 DevTools 再載入頁面。
