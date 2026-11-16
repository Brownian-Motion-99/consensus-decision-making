# 默契一致：工作進度

最後更新：2026-11-16（commit `25883e3`）

## 現況

**基本骨架已完成，可以完整玩一局。** 下一階段是加入品牌特色（logo、字型、插圖、動畫），需要大量美術工作，目前正在研究美術工作流程。

- 產品規則與架構：見 [PLAN.md](PLAN.md)
- 啟動、測試、預覽頁的用法：見 [README.md](../README.md)

## 已完成

### 遊戲流程

- **房間**：任何人都能在首頁開新房間，取得 4 碼房號，開房的人就是主持人。其他人輸入房號，或開啟主持人複製的連結加入。一台 server 可以同時開多間房，上限 100 間。房間只能靠房號進入，最後一人離開就會收掉。
- **取暱稱**：開房或輸入房號之後才取暱稱。暱稱可以重複，因為玩家是用隨機 id 區分。暱稱沒有長度上限，畫面上太長的會截成「…」，滑鼠移上去可以看全名。
- **大廳**：顯示房號、「複製房號」「複製連結」按鈕和玩家名單（2–8 人）。主持人設定「一致幾次才結束」（1–99，預設 3），再按「開始遊戲」。
- **作答**：在白板上手寫或畫畫，也可以打字，文字會即時畫到白板上。答案送出後不能修改。送出之後才看得到作答進度。
- **公開與判定**：全員送出後，主持人按「公開答案」，接著判定「一致」或「不一致」。畫面會即時統計一致幾題、不一致幾題。
- **結束條件**：一致次數達到目標才結束。題目會無限循環，題庫用完就重新洗牌。
- **結算**：只顯示總題數和一致次數，不顯示每題的回顧。
- **斷線處理**：主持人斷線時，隨機挑一位玩家當新主持人。剩不到 2 人時直接進入結算。

### 體驗細節

- 音效：判定一致、不一致，以及結算時播放。載入時會依照感知響度（EBU R128）把三個音效都調到 -14 LUFS，峰值上限是 -1 dBFS。單聲道檔案會照左右喇叭同時播出的情況計算。回到大廳時會中斷結算音效。
- 手機操作：
  - 寫白板時不會選取到文字，只有作答畫面禁止縮放。
  - 有安全區域和底部留白，避開 Safari 的浮動工具列。
- 連線中畫面：心跳放大動畫，文字佔畫面橫向中間的 1/3。
- 首頁：畫面中間 1/2 預留了 logo 區塊，目前用文字標題代替。
- 空白的白板中央有半透明的鉛筆提示。
- 提示訊息浮在畫面上方，不會推動下面的內容。

### 視覺

- 配色：Baltic Blue `#33658A`（背景）、Sky Reflection `#86BBD8`（白板外框）、Charcoal Blue `#2F4858`（深色模式卡片）、Honey Bronze `#F6AE2D`（主色、按鈕）。
- 所有顏色、字級、間距都集中在 `public/style.css` 的 `:root` 變數。

### 開發工具

- **預覽總覽頁**：`/preview.html`（手機）、`/preview-desktop.html`（16:9）。所有畫面並排顯示，可以切換裝置、縮放和身分。
- **劇本模式**：`/?preview=flow`，依序播放狀態切換，可以檢查動畫和音效。
- **調整面板**：在總覽頁用滑桿和色票即時調整 CSS 變數，所有預覽同步更新，按「複製改動」就能拿到要寫回的 CSS。
- **啟動模式**：`npm start` 只接受本機連線，用來改畫面；`npm run start:lan` 開放給同一個 Wi-Fi 的手機；`npm run tunnel` 用 Docker 和 Cloudflare Tunnel 開放外網連線（見下方「外網連線」）。
- **測試**：`npm test`，共 37 個，涵蓋遊戲狀態機、多房間、限流和響度計算。

### 外網連線

- `npm run tunnel` 會啟動兩個容器：遊戲 server，以及建立 Cloudflare quick tunnel 的 cloudflared。終端機會印出 `https://xxx.trycloudflare.com` 網址和 QR code，免帳號，不用設定 router。`npm run tunnel:down` 關閉。
- **Sandbox**：遊戲容器只接在 `internal` 網路，不能上網，本機也沒有開 port；不掛載本機資料夾、檔案系統唯讀、非 root、拿掉所有 Linux 特權，並限制記憶體、CPU 和 process 數量。已實際驗證過以上各項。
- **限流**（`src/limits.js`）：每個 IP 每分鐘最多開 5 間房、最多同時 20 條連線，全站最多 200 條；每條連線每秒最多 20 則訊息。容器模式的房間上限為 20 間。
- **邀請連結**：從外網或區網 IP 開啟時，用瀏覽器的網址產生連結；用 `localhost` 開啟時，才用 server 給的區網連結。

## 架構速覽

```
server.js            HTTP 靜態檔案＋WebSocket，只負責把連線轉給對應的房間
src/rooms.js         RoomRegistry（房號、上限、回收）、RoomSession（一間房：遊戲＋連線＋廣播）
src/game.js          Room：遊戲狀態機，唯一的權威狀態，不碰網路
src/limits.js        RateLimiter、ConnectionCounter：限流，不碰網路
public/app.js        前端，依照 server 傳來的狀態切換畫面
public/board.js      手寫白板（筆畫層＋文字層）
public/sounds.js     音效（Web Audio，自動解鎖、響度正規化）
public/loudness.js   感知響度計算（BS.1770），結果與 ffmpeg 的 ebur128 一致
public/preview*.js   預覽頁與劇本模式
public/tweaks.js     調整面板
```

狀態機：`lobby → answering → revealed → judged → (answering | finished)`，每一步都由主持人推進。

## 已知限制

- **不支援重新連線**：斷線後要重新整理頁面，以新玩家身分加入下一局。
- **macOS 的系統密碼自動填寫**：在 Mac 上，房號輸入框會跳出密碼自動填寫。這是 macOS Tahoe 的系統行為，網頁擋不掉，已試過各種 HTML 屬性。手機上的狀況還沒確認。
- **置中有些微偏移**：內容上下置中時，底部為 Safari 工具列保留的 96px 也算在內，所以內容會比正中央略高（約 48px）。
- **部分尺寸寫死**：「連線中…」的字級、首頁標題字級、房號字級、複製按鈕大小沒有做成變數，調整面板調不到。
- **tunnel 網址每次都會變**：quick tunnel 每次啟動都換網址。想要固定網址，可以在 Cloudflare 綁自己的網域（named tunnel），或改用 Tailscale Funnel。
- **暱稱長度只受訊息大小限制**：暱稱沒有長度上限，只受 WebSocket 單則訊息 256KB 的限制。有人故意取超長暱稱的話，每次廣播狀態都會帶著它，上線前可以考慮加一個很寬鬆的保護上限。
- **暱稱重複時難以分辨**：兩個「小明」在畫面上看起來一樣。
- **主持人無法中途結束遊戲**：只能等到達成目標，或人數不足時自動結束。

## 下一步

### 品牌與美術（下一階段的重點）

建議流程：**情緒板 → 2～3 張 style tile 選方向 → 製作素材（logo、字型、配色、插圖，用 SVG 或 Rive）→ 整合進程式碼**，再用預覽頁、劇本模式和調整面板驗收。

參考資料：

| 主題 | 資料 |
|---|---|
| 決定品牌方向 | Style Tiles（styletil.es）、《Logo Design Love》（David Airey）、《Designing Brand Identity》（Alina Wheeler）、YouTube：The Futur、Satori Graphics |
| 工程師的介面美感 | **《Refactoring UI》**（Adam Wathan、Steve Schoger）、《The Non-Designer's Design Book》（Robin Williams） |
| 遊戲的「好玩感」 | **GDC〈Juice it or lose it〉**、〈The Art of Screenshake〉（Jan Willem Nijman）、《Game Feel》（Steve Swink）、Game UI Database（gameuidatabase.com） |
| 同類產品 | Jackbox Party Pack、Gartic Phone、skribbl.io、原版《一致するまで終われまテン》 |
| 中文字型 | 《字型散步》（柯志杰、蘇煒翔）、justfont 部落格、jf open 粉圓 |
| 素材進網頁 | Rive（rive.app）、Lottie／LottieFiles、情緒板工具 Milanote、Are.na |

優先順序：先看《Refactoring UI》和〈Juice it or lose it〉，再實際玩一輪 Gartic Phone 和 Jackbox。

### 之後可以做的功能

- 把寫死的尺寸改成 CSS 變數，讓調整面板調得到。
- 主持人可以手動「結束遊戲」。
- 暱稱重複時加上區分，例如「小明 #a3f」或標示「（你）」。
- 支援斷線重連。

### 上線前要處理

- 部署平台：建議 Render、Railway、Fly.io，或 Cloudflare Workers 搭配 Durable Objects。GitHub Actions 只能做 CI 和自動部署，不能當 server。
- 依實際流量調整房間上限和限流數字（基本版的限流已完成，見「外網連線」）。

## 版本紀錄

| commit | 日期 | 內容 |
|---|---|---|
| `7f9dae4` | 11-15 | 第一版：區網派對遊戲 demo |
| `e2a8c22` | 11-15 | 改成手寫作答、以一致次數作為結束條件 |
| `3187e71` | 11-15 | 改善手機白板操作、允許重複暱稱 |
| `6952aab` | 11-15 | 加入判定與結算音效 |
| `8e39adf` | 11-15 | 手機 Safari 的安全區域與底部留白 |
| `3077fcf` | 11-16 | 每個畫面的預覽頁 |
| `1d9a6f9` | 11-16 | 套用配色 |
| `5cbf0d1` | 11-16 | 劇本模式與 16:9 電腦預覽頁 |
| `71c3b30` | 11-16 | 調亮「一致！」的顏色 |
| `3e96536` | 11-16 | 拿掉大廳和結算的標題 |
| `70dc70b` | 11-16 | 多房間與房號、預設只接受本機連線 |
| `6f81a2e` | 11-16 | 介面骨架細修、預覽頁的調整面板 |
| `2b8ed3e` | 11-16 | 新增工作進度文件 |
| `9430789` | 11-16 | Docker sandbox 與 Cloudflare Tunnel 外網連線、限流、人數上限改為 8 人 |
| `e5c4ecb` | 11-16 | 規劃與進度文件移到 docs/ |
| `3b8f673` | 11-16 | 音效改用感知響度正規化 |
| `08a78c1` | 11-16 | 新增 CLAUDE.md，開工前先讀進度與規劃文件 |
| `fe054c6` | 11-16 | 擴充題庫，加入意見分歧的題目 |
| `25883e3` | 11-16 | 暱稱不設長度上限，太長的以「…」截斷 |
