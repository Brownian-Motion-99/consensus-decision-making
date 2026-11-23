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

### 動態效果的出處

動態效果參考自 [Hannah's Motion Library](https://kittenjam-motion-library.vercel.app/)。下面列出遊戲裡用到的效果、用在哪裡、和原版不一樣的地方，以及當時使用的提示詞（原文）。提示詞的最後一行是請 AI 依照網站既有的主題色搭配，不另外指定顏色。

| 效果 | 用在哪裡 |
|---|---|
| 多語問候切換（Multilingual Greeting） | 連線中畫面 |
| 啟動頁轉場（Splash to Home） | 連線完成後進入首頁 |
| 逐行揭示（Line Reveal） | 首頁標題 |
| 柔和上浮（Gentle Fade Up） | 進入大廳 |
| 頁面轉場簾幕（Curtain Page Transition） | 大廳 → 作答（開始遊戲）、判定完 → 下一題的作答 |
| 長按確認（Hold to Confirm） | 主席的「公開答案」按鈕 |
| 照片堆展開（Stack to Grid） | 公開答案的答案卡 |
| 彩紙爆發（Confetti Burst） | 結算畫面 |

<details>
<summary>多語問候切換（Multilingual Greeting）</summary>

- **用在**：連線中畫面
- **和原版不一樣的地方**：文字換成各語言的「連線中」（Connecting、連線中、接続中、Connexion、Conectando、연결 중、Connessione）；連線完成時停住，接上啟動頁轉場。

```
「多語問候切換（Multilingual Greeting）」動態效果：Hero 標題位置輪流顯示不同語言的「你好」（Hello、你好、こんにちは、Bonjour、Hola、안녕하세요、Ciao），每隔約 1.6 秒切換：舊的詞往上模糊淡出，新的詞從下方模糊淡入變清楚；因為每個詞長度不同，包住文字的容器寬度會平滑地縮放到新詞的寬度，讓後面跟著的小圓點也平滑移動，而不是瞬間跳動。（GSAP：先量出新詞的寬度（隱藏的量測元素），容器 width tween 到新寬度 power3.inOut；文字 opacity、filter:blur、y 做淡出淡入）
配色：請依照網站既有的主題色與風格自行搭配，不要另外指定顏色。
```

</details>

<details>
<summary>啟動頁轉場（Splash to Home）</summary>

- **用在**：連線完成後進入首頁
- **和原版不一樣的地方**：沒有另外做 logo，改成「連線中的字從中間飛出，然後才是首頁」：正在輪播的那個詞停住、呼吸一次，再加速放大淡出，同時首頁內容依序浮上。

```
「啟動頁轉場（Splash to Home）」動態效果：App 開啟時，畫面中央的 Logo 從小彈出（back.out），輕輕呼吸一次；接著 Logo 加速放大到充滿整個螢幕並淡出，像穿過 Logo 進入 App，底下的首頁內容（主視覺卡片、列表）同時由上到下依序淡入上浮。整段約 2 秒，結束後停在首頁。（GSAP：timeline：logo scale 0.6→1 → yoyo 1.06 → scale 14（power3.in）＋啟動層 opacity 0 → 首頁元素 stagger fromTo y:10 / opacity:0）
配色：請依照網站既有的主題色與風格自行搭配，不要另外指定顏色。
```

</details>

<details>
<summary>逐行揭示（Line Reveal）</summary>

- **用在**：首頁標題
- **和原版不一樣的地方**：標題拆成「本次會議／我們採取／共識決」三行，只要畫面停留在首頁就重複播放。

```
「逐行揭示（Line Reveal）」動態效果：多行文字逐行從各自的遮罩下方帶一點旋轉翻上來，最後一行用強調色，下方一條細線由左往右畫出，停留後整段往上收走。（GSAP：每行包 overflow hidden，from yPercent:115，stagger 0.14）
配色：請依照網站既有的主題色與風格自行搭配，不要另外指定顏色。
```

</details>

<details>
<summary>柔和上浮（Gentle Fade Up）</summary>

- **用在**：進入大廳
- **和原版不一樣的地方**：沒有搭配 ScrollTrigger，進入大廳時直接播放一次；大廳裡的區塊（會議編號、玩家名單、主席的設定等）當作要依序浮上的元素。簾幕轉場和送出答案的轉場也沿用這個上浮。

```
「柔和上浮（Gentle Fade Up）」動態效果：一個內容區塊（小標、主標題、兩行內文、按鈕）進場時，依照由上到下的閱讀順序，每個元素從下方約 18px、完全透明的狀態輕輕浮上並淡入，元素之間間隔約 0.14 秒，每個約 0.9 秒、平順減速（power2.out），沒有彈跳也沒有縮放，讓視線自然地從標題被帶到按鈕。（GSAP：fromTo y:18 / opacity:0 → y:0 / opacity:1，stagger 0.14；實際網站搭配 ScrollTrigger 在區塊進入畫面時播放一次即可）
配色：請依照網站既有的主題色與風格自行搭配，不要另外指定顏色。
```

</details>

<details>
<summary>頁面轉場簾幕（Curtain Page Transition）</summary>

- **用在**：大廳 → 作答（開始遊戲）、判定完 → 下一題的作答
- **和原版不一樣的地方**：兩個轉換都是 server 推播的狀態切換，不是點擊導覽；簾幕蓋住畫面時擋住點擊。

```
「頁面轉場簾幕（Curtain Page Transition）」動態效果：點擊導覽切換頁面時，三片直條狀的簾幕從上方依序（間隔約 0.08 秒）落下蓋住整個畫面，此時在背後替換成新頁面，接著三片簾幕再依序往下收走，新頁面的標題與內容區塊由上到下淡入上浮。整段約 1.4 秒，讓換頁有完整的節奏感。（GSAP：簾幕 yPercent -101→0→101，stagger 0.08，ease power3.inOut；在兩段之間的 callback 切換內容；SPA 可搭配 Barba.js 或框架的路由轉場 hook）
配色：請依照網站既有的主題色與風格自行搭配，不要另外指定顏色。
```

</details>

<details>
<summary>長按確認（Hold to Confirm）</summary>

- **用在**：主席的「公開答案」按鈕
- **和原版不一樣的地方**：不是危險操作用的按鈕，是用來避免誤觸公開；平常是黃底白字，按住時白底黃字從左往右蓋過去，按滿後文字變成「已公開 ✓」。

```
「長按確認（Hold to Confirm）」動態效果：危險操作（例如刪除）用的按鈕：外框樣式，使用者按住不放時，一層填滿從左往右以約 1.2 秒等速填滿整顆按鈕、按鈕微微縮小；中途放開則填滿快速退回、不執行；填滿後按鈕輕微彈一下、文字變成「已刪除 ✓」。可避免誤觸。（CSS：填滿層 transform:scaleX(0)，按住時加 class 改成 scaleX(1) 並設 transition 1.2s linear，放開時移除 class 用較短的 transition 退回；JS 在 pointerdown 開 1.2 秒計時器，pointerup / pointerleave 取消）
配色：請依照網站既有的主題色與風格自行搭配，不要另外指定顏色。
```

</details>

<details>
<summary>照片堆展開（Stack to Grid）</summary>

- **用在**：公開答案的答案卡
- **和原版不一樣的地方**：不做「再點一次收回」；網格的欄數依人數調整（1 人 1 欄、2 人 2 欄、3 人 3 欄、4 人 2×2、5～6 人 3×2、7～8 人 4×2）；進入公開答案後自動展開（也可以點一下立刻展開）；沒有用 Flip 外掛，改用 transform 搬到中央再歸零。

```
「照片堆展開（Stack to Grid）」動態效果：一疊散亂的照片（每張帶寬邊框、隨機歪斜不同角度、疊在中央）：點擊後，照片一張接一張（間隔約 0.04 秒）平滑地飛到整齊的 3 × 2 網格位置並轉正；再點一次則從網格飛回成散亂的一疊。約 0.7 秒、緩入緩出。（GSAP Flip：Flip.getState(照片) → 切換容器的 class（從絕對定位堆疊改成 grid 排列、rotate 歸零）→ Flip.from(state, {absolute:true, stagger:.04})）
配色：請依照網站既有的主題色與風格自行搭配，不要另外指定顏色。
```

</details>

<details>
<summary>彩紙爆發（Confetti Burst）</summary>

- **用在**：結算畫面
- **和原版不一樣的地方**：只彈出一次，不重複。

```
「彩紙爆發（Confetti Burst）」動態效果：文字彈性放大的同時，從下方噴出一大把紙片，紙片受重力拋物線落下、旋轉並在尾段淡出，每 2 秒一次。（GSAP：Physics2DPlugin velocity / angle / gravity，random 隨機化）
配色：請依照網站既有的主題色與風格自行搭配，不要另外指定顏色。
```

</details>

另外還有幾個轉場是依照使用者自己寫的描述做的，不是出自這個資料庫：送出答案的轉場（共有的元件平移、其餘淡出或浮上）、公開答案和結算用的圓形展開轉場，以及按鈕按下去時明度微微降低。
