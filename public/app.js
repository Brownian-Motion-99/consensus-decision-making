// 前端只負責顯示 server 傳來的狀態，並把操作送回去。
// 所有使用者輸入的文字都用 textContent 放進畫面，不用 innerHTML。

import { createBoard } from './board.js';
import { loadSounds, playSound, stopSound } from './sounds.js';
import { createGreeting } from './greeting.js';
import { fadeUp } from './fade-up.js';
import { playSplash } from './splash.js';
import { playCurtain } from './curtain.js';
import { captureSubmit, playSubmit } from './submit-transition.js';
import { initHoldButton } from './hold-button.js';
import { playIris } from './iris.js';
import { stackAnswers } from './photo-stack.js';
import { playConfetti } from './confetti.js';

const $ = (id) => document.getElementById(id);
createGreeting($('connecting-greeting'));
const board = createBoard($('board'), {
  fontFamily: getComputedStyle(document.body).fontFamily,
  // SVG 沒有 hidden 屬性可以直接設，要改 attribute
  onChange: (empty) => $('board-hint').toggleAttribute('hidden', !empty),
});

let ws;
let previewMode = false; // 開發用預覽，不連線（見 preview.js）
let state = null;
let lastQuestionNumber = null;
let noticeTimer = null;
let warmImage = null; // 送出時先解碼好的答案圖，見 submit-btn

const params = new URLSearchParams(location.search);

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  // 網址帶房號（掃 QR code 進來）就直接進房，否則顯示首頁
  ws.addEventListener('open', () => {
    const code = params.get('room');
    if (code) sendAction('enter', { code });
    else showScreen('home', { splash: true });
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'welcome') {
      setInvite(msg.code, msg.joinUrl);
      $('join-hint').hidden = !msg.owner;
      // 網址換成這間房，方便直接複製分享
      history.replaceState(null, '', `/?room=${msg.code}`);
    } else if (msg.type === 'state') {
      applyState(msg.state);
    } else if (msg.type === 'closed') {
      // 房間閒置太久被 server 收掉了，回到首頁
      state = null;
      history.replaceState(null, '', '/');
      params.delete('room');
      showNotice(msg.message, true, { persist: true });
      showScreen('home');
    } else if (msg.type === 'error' || msg.type === 'notice') {
      showNotice(msg.message, msg.type === 'error');
      // 還沒進房間時的錯誤（找不到房號、房間數滿了）回到首頁
      if (msg.type === 'error' && !state) {
        $('code-input').value = params.get('room') ?? $('code-input').value;
        history.replaceState(null, '', '/');
        params.delete('room');
        showScreen('home');
      }
    }
  });

  ws.addEventListener('close', () => showScreen('disconnected'));
}

/** 套用新狀態：畫面更新，並在狀態切換時播放音效。連線和劇本預覽都走這裡。 */
function applyState(next) {
  const prev = state;
  state = next;
  render();
  playTransitionSound(prev, state);
}

let invite = { code: '', url: '' };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function setInvite(code, url) {
  // 從外網（tunnel）或區網 IP 連進來時，用瀏覽器的網址產生連結最可靠；
  // 只有主持人用 localhost 開時，才用 server 給的區網連結
  if (!LOOPBACK_HOSTS.has(location.hostname)) url = `${location.origin}/?room=${code}`;
  invite = { code, url };
  $('room-code').textContent = code;
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 區網用 http 連線不是安全環境，沒有 clipboard API，改用舊方法
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) return showNotice(`無法複製，請手動輸入：${text}`, true);
  }
  showNotice(`已複製${label}`, false);
}

function sendAction(type, payload = {}) {
  if (previewMode) return showNotice(`預覽模式：不會送出「${type}」`, false);
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}

// ---- 畫面工具 ----

let currentScreen = null;
let enterTween = null;

// 圓形轉場還沒結束時，要等轉場的音效（結算）先排著，轉場結束才播
let irisBusy = false;
let queuedSound = null;

// 用圓形展開換頁的路徑：到 name 這個畫面要從哪個畫面來、起點是哪顆按鈕
const IRIS_ROUTES = {
  revealed: { from: 'answering', button: 'reveal-btn' },
  finished: { from: 'revealed', button: 'next-btn' },
};

// 用簾幕換頁的路徑：大廳 → 作答（開始遊戲）、判定完 → 下一題的作答
const CURTAIN_FROM = new Set(['lobby', 'revealed']);

/** splash：從連線中進入首頁時，播放啟動頁轉場（只有真的連線完成的那一次）。 */
function showScreen(name, { splash = false } = {}) {
  const previous = currentScreen;
  const entering = name !== previous;
  // 離開畫面時，還沒播完的進場動畫（或簾幕）直接還原，免得下次回來看到半透明的元素
  if (entering) enterTween?.revert();
  currentScreen = name;
  if (!entering) return setZoomLocked(name === 'answering');

  // 簾幕蓋滿以前畫面還是舊的；這段時間收到的新狀態只會更新看不到的作答畫面內容，不會再進到這裡
  if (name === 'answering' && CURTAIN_FROM.has(previous)) {
    enterTween = playCurtain($('curtain'), () => {
      switchScreen(name);
      return document.querySelector('[data-screen="answering"]');
    });
    return;
  }
  // 用圓形展開轉場的換頁：全員送出後主席公開答案（作答 → 公開答案）、看會議紀錄（公開答案 → 結算）。
  // 白色圓從主席剛按的按鈕展開蓋住畫面，再從同一點展開透明的洞轉入新畫面；
  // 公開答案的答案卡先疊在中央再展開，結算的文字彈出並噴彩紙
  const route = IRIS_ROUTES[name];
  if (route && route.from === previous) {
    let stack = null;
    let finale = null;
    irisBusy = true;
    const iris = playIris($('iris'), irisOrigin(route.button), {
      swap: () => {
        switchScreen(name);
        if (name === 'revealed') stack = stackAnswers($('reveal-answers'));
        else finale = playConfetti($('score'), $('confetti'), { delay: 0.5 }); // 洞開到一半時彈出
      },
      opened: () => {
        irisBusy = false;
        if (queuedSound) playSound(queuedSound); // 白色轉場結束後才播結算音效
        queuedSound = null;
        stack?.spread({ delay: 0.3 });
      },
    });
    enterTween = {
      revert() {
        irisBusy = false;
        queuedSound = null;
        iris?.revert();
        stack?.revert();
        finale?.revert();
      },
    };
    return;
  }
  switchScreen(name, { splash });
  // 每次收到狀態都會呼叫 showScreen，所以只在換畫面的那一次播進場動畫
  if (name === 'lobby') enterTween = fadeUp(document.querySelector('[data-screen="lobby"]'));
  else if (name === 'finished') enterTween = playConfetti($('score'), $('confetti'));
  else if (name === 'home' && splash) enterTween = playSplash(document.querySelector('[data-screen="connecting"]'), document.querySelector('[data-screen="home"]'));
  else enterTween = null;
}

/** 圓形展開的起點：剛按下的按鈕的中心（只有主席看得到）；沒有按鈕就用畫面正中央。 */
function irisOrigin(buttonId) {
  const button = $(buttonId);
  if (!button.getClientRects().length) return { x: innerWidth / 2, y: innerHeight / 2 };
  const rect = button.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function switchScreen(name, { splash = false } = {}) {
  for (const el of document.querySelectorAll('[data-screen]')) {
    // 轉場時，連線中的字還要飛出去，先留著，由 splash.js 播完後隱藏
    el.hidden = el.dataset.screen !== name && !(splash && el.dataset.screen === 'connecting');
  }
  setZoomLocked(name === 'answering');
}

// 作答時鎖住縮放，避免寫白板時誤觸；其他畫面可以自由縮放
const VIEWPORT_DEFAULT = 'width=device-width, initial-scale=1, viewport-fit=cover';
const VIEWPORT_LOCKED = `${VIEWPORT_DEFAULT}, maximum-scale=1, user-scalable=no`;
let zoomLocked = false;

function setZoomLocked(locked) {
  if (locked === zoomLocked) return;
  zoomLocked = locked;
  $('viewport').content = locked ? VIEWPORT_LOCKED : VIEWPORT_DEFAULT;
  document.documentElement.classList.toggle('zoom-locked', locked);
}

function showNotice(message, isError, { persist = false } = {}) {
  const el = $('notice');
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.hidden = false;
  clearTimeout(noticeTimer);
  if (!persist) noticeTimer = setTimeout(() => (el.hidden = true), 4000);
}

function renderPlayers(listEl, players, { showAnswered = false } = {}) {
  listEl.replaceChildren(
    ...players.map((p) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = p.name;
      name.title = p.name; // 名字被截成「…」時，滑鼠移上去可以看全名
      li.append(name);
      if (p.id === state.you.id) li.classList.add('is-me');
      if (p.isHost) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '主席';
        li.append(badge);
      }
      if (showAnswered) {
        const mark = document.createElement('span');
        mark.className = p.answered ? 'mark is-done' : 'mark';
        mark.textContent = p.answered ? '已作答' : '思考中';
        li.append(mark);
      }
      return li;
    }),
  );
}

// 依人數決定幾欄：1 人 1 欄、2 人 2 欄、3 人 3 欄、4 人 2×2、5～6 人 3×2、7～8 人 4×2；
// 每張卡至少留 100px，手機放不下就少一欄
const MIN_CARD_WIDTH = 100;
function answerColumns(count, width) {
  const ideal = count <= 3 ? count : count === 4 ? 2 : count <= 6 ? 3 : 4;
  return Math.max(1, Math.min(ideal, Math.floor(width / MIN_CARD_WIDTH)));
}

// 每次收到狀態都會重畫，答案沒變就不要動 DOM，免得打斷正在播的展開動畫
const renderedAnswers = new WeakMap();

function renderAnswers(listEl, answers) {
  listEl.style.setProperty('--cols', String(answerColumns(answers.length, document.querySelector('.container').clientWidth - 2 * 16)));
  const key = answers.map((a) => `${a.name}\n${a.image}`).join('\0');
  if (renderedAnswers.get(listEl) === key) return;
  renderedAnswers.set(listEl, key);
  listEl.replaceChildren(
    ...answers.map((a) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'answer-name';
      name.textContent = a.name;
      name.title = a.name;
      const img = document.createElement('img');
      img.className = 'drawing';
      img.alt = `${a.name} 的答案`;
      img.src = a.image;
      li.append(img, name);
      return li;
    }),
  );
}

function progressText(q) {
  return `第 ${q.number} 題｜目標：通過 ${state.targetMatches} 項決議`;
}

// 只在狀態「切換」的那一刻播放，剛連上線或其他更新不會重播
function playTransitionSound(prev, next) {
  if (!prev || !next.you.joined || prev.phase === next.phase) return;
  if (next.phase === 'judged') playSound(next.lastMatch ? 'correct' : 'wrong');
  else if (next.phase === 'finished' && next.targetReached) {
    // 從公開答案過來有白色轉場，等轉場結束再播（見 showScreen）
    if (irisBusy) queuedSound = 'congrats';
    else playSound('congrats');
  }
  else if (prev.phase === 'finished') stopSound('congrats'); // 回到大廳就中斷
}

// ---- 各畫面 ----

function render() {
  const { phase, you } = state;
  document.body.classList.toggle('is-host', you.isHost);

  // 任何時候都能加入；題目進行中加入的人先列席
  if (!you.joined) return showScreen('join');
  if (you.observer) return showScreen('observing');

  if (phase === 'lobby') renderLobby();
  else if (phase === 'answering') renderAnswering();
  else if (phase === 'revealed' || phase === 'judged') renderRevealed();
  else if (phase === 'paused') renderPaused();
  else if (phase === 'finished') renderFinished();
}

function renderLobby() {
  const { players, limits, targetMatches } = state;
  $('lobby-count').textContent = `${players.length} / ${limits.maxPlayers}`;
  renderPlayers($('lobby-players'), players);

  const input = $('target-input');
  input.min = limits.minTarget;
  input.max = limits.maxTarget;
  // 主持人正在輸入時不要覆蓋
  if (document.activeElement !== input) input.value = String(targetMatches);
  $('lobby-target').textContent = `目標：通過 ${targetMatches} 項決議才散會`;

  const enough = players.length >= limits.minPlayers;
  $('start-btn').disabled = !enough;
  $('start-btn').textContent = enough ? '開始遊戲' : `至少需要 ${limits.minPlayers} 人`;
  lastQuestionNumber = null;
  showScreen('lobby');
}

function renderAnswering() {
  const { question, players, you, allAnswered } = state;

  // 換題時清空白板；同一題內收到狀態更新時不要動到正在寫的內容
  if (question.number !== lastQuestionNumber) {
    lastQuestionNumber = question.number;
    clearAnswer();
  }

  // 這一刻剛送出答案（畫面上還是作答的樣子）：先記下舊位置，換完內容再播轉場
  const answering = document.querySelector('[data-screen="answering"]');
  const submitted = Boolean(you.answer) && !answering.hidden && !$('answer-form').hidden;
  const before = submitted && captureSubmit({
    shared: [
      { from: $('answer-progress'), to: $('answer-progress') },
      { from: $('answer-question'), to: $('answer-question') },
      { from: $('board'), to: $('my-answer-img') },
      { from: answering.querySelector('.host-only'), to: answering.querySelector('.host-only') },
    ],
    exiting: [$('type-form'), $('answer-form').querySelector('.row')],
  });

  $('answer-progress').textContent = progressText(question);
  $('answer-question').textContent = question.text;
  $('answer-form').hidden = Boolean(you.answer);
  $('my-answer').hidden = !you.answer;
  if (you.answer && $('my-answer-img').getAttribute('src') !== you.answer) {
    $('my-answer-img').src = you.answer;
  }

  $('answer-status').hidden = !you.answer;
  const done = players.filter((p) => p.answered).length;
  $('answered-count').textContent = `${done} / ${players.length}`;
  renderPlayers($('answer-players'), players, { showAnswered: true });

  $('reveal-btn').disabled = !allAnswered;
  // 長按確認後的幾秒鐘文字固定顯示「已公開 ✓」，不被狀態更新蓋掉
  if (!$('reveal-btn').classList.contains('is-confirmed')) renderRevealLabel();
  showScreen('answering');
  if (before) {
    enterTween?.revert();
    enterTween = playSubmit(before, { entering: [$('my-answer').querySelector('.muted'), $('answer-status')] });
  }
}

/** 按鈕上的字有兩份：底下的白字，和長按時蓋過去那一層自己帶的黃字 */
function setRevealLabel(text) {
  $('reveal-label').textContent = text;
  $('reveal-fill').dataset.label = text;
}

function renderRevealLabel() {
  setRevealLabel(state?.allAnswered ? '公開答案' : '等待所有人作答…');
}

function renderRevealed() {
  const { phase, question, revealed, lastMatch, tally, targetMatches, targetReached } = state;
  $('reveal-progress').textContent = progressText(question);
  $('reveal-question').textContent = question.text;
  renderAnswers($('reveal-answers'), revealed);
  $('tally').textContent =
    `目前達成共識 ${tally.match} 題・未達共識 ${tally.miss} 題（目標通過 ${targetMatches} 項決議）`;

  const judged = phase === 'judged';
  const result = $('result');
  if (judged) {
    result.textContent = lastMatch ? '達成共識！' : '未達共識…';
    result.classList.toggle('is-match', lastMatch);
  }

  // 判定後，兩顆判定按鈕換成結果文字（同一個位置），主席的「下一題」在文字右邊
  $('judge-slot').hidden = judged;
  $('verdict').hidden = !judged;
  $('next-btn').textContent = targetReached ? '看會議紀錄' : '下一題';
  $('reveal-wait').textContent = judged ? '等待主席進到下一題…' : '等待主席判定…';
  showScreen('revealed');
}

function renderPaused() {
  const { players, limits, tally, targetMatches } = state;
  $('paused-message').textContent =
    `出席人數不足。目前通過 ${tally.match} / ${targetMatches} 項決議，人數湊齊後從下一題繼續。`;
  $('paused-count').textContent = `${players.length} / ${limits.maxPlayers}`;
  renderPlayers($('paused-players'), players);

  const enough = players.length >= limits.minPlayers;
  $('resume-btn').disabled = !enough;
  $('resume-btn').textContent = enough ? '繼續會議' : `至少需要 ${limits.minPlayers} 人`;
  // 作廢那一題的題號會留給下一題，要讓白板在繼續時清空
  lastQuestionNumber = null;
  showScreen('paused');
}

function renderFinished() {
  const { rounds, tally } = state;
  $('score').textContent = `會議圓滿結束！一共討論了 ${rounds} 題，通過 ${tally.match} 項決議`;
  showScreen('finished');
}

// ---- 事件 ----

$('create-btn').addEventListener('click', () => sendAction('create'));

$('enter-form').addEventListener('submit', (e) => {
  e.preventDefault();
  sendAction('enter', { code: $('code-input').value });
});

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  sendAction('join', { name: $('name-input').value });
});

$('target-input').addEventListener('change', (e) => {
  const n = Number(e.target.value);
  const { minTarget, maxTarget } = state.limits;
  if (!Number.isInteger(n) || n < minTarget || n > maxTarget) {
    showNotice(`請輸入 ${minTarget} 到 ${maxTarget} 之間的整數`, true);
    e.target.value = String(state.targetMatches);
    return;
  }
  sendAction('setTargetMatches', { count: n });
});

$('start-btn').addEventListener('click', () => sendAction('start'));
$('copy-code-btn').addEventListener('click', () => copyText(invite.code, '會議編號'));
$('copy-link-btn').addEventListener('click', () => copyText(invite.url, '連結'));

function clearAnswer() {
  board.clear();
  $('type-input').value = '';
}

$('clear-btn').addEventListener('click', clearAnswer);

// 打字即時同步到白板的文字層
$('type-input').addEventListener('input', (e) => board.setText(e.target.value));

$('type-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('type-input').blur(); // 按完成時收起手機鍵盤，才看得到整個白板
});

$('submit-btn').addEventListener('click', () => {
  if (board.isEmpty()) return showNotice('白板上還沒有寫東西', true);
  const image = board.toDataURL();
  if (image.length > state.limits.maxDrawingLength) {
    return showNotice('圖太大了，請清除後簡化一點再送出', true);
  }
  // 先讓瀏覽器解碼這張圖，等 server 回來顯示「已送出」時才不會閃一下空白
  warmImage = new Image();
  warmImage.src = image;
  warmImage.decode?.().catch(() => {});
  sendAction('answer', { image });
});

// 公開答案要長按 1.2 秒才會送出，避免主席誤觸，大家還沒看完的答案就被公開
initHoldButton($('reveal-btn'), {
  duration: 1200,
  onConfirm: () => {
    setRevealLabel('已公開 ✓');
    sendAction('reveal');
  },
  onReset: renderRevealLabel,
});
$('match-btn').addEventListener('click', () => sendAction('judge', { match: true }));
$('nomatch-btn').addEventListener('click', () => sendAction('judge', { match: false }));
$('next-btn').addEventListener('click', () => sendAction('next'));
$('resume-btn').addEventListener('click', () => sendAction('resume'));
$('lobby-btn').addEventListener('click', () => sendAction('backToLobby'));
$('reload-btn').addEventListener('click', () => location.reload());

// iOS Safari 會忽略 user-scalable=no，作答時要另外擋掉雙指縮放手勢
for (const type of ['gesturestart', 'gesturechange']) {
  document.addEventListener(type, (e) => {
    if (zoomLocked) e.preventDefault();
  });
}

loadSounds({
  correct: '/audio/correct.mp3',
  wrong: '/audio/wrong.mp3',
  congrats: '/audio/congrats.mp3',
});

if (params.has('preview')) {
  previewMode = true;
  const { startPreview } = await import('./preview.js');
  const found = startPreview(params.get('preview'), params.get('as'), {
    applyState,
    setInvite,
    showScreen,
    showNotice,
  });
  if (!found) location.replace('/preview.html');
} else {
  connect();
}
