// 前端只負責顯示 server 傳來的狀態，並把操作送回去。
// 所有使用者輸入的文字都用 textContent 放進畫面，不用 innerHTML。

import { createBoard } from './board.js';
import { loadSounds, playSound, stopSound } from './sounds.js';

const $ = (id) => document.getElementById(id);
const board = createBoard($('board'), {
  fontFamily: getComputedStyle(document.body).fontFamily,
});

let ws;
let previewMode = false; // 開發用預覽，不連線（見 preview.js）
let state = null;
let lastQuestionNumber = null;
let noticeTimer = null;

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'welcome') {
      $('qr').src = msg.qrDataUrl;
      $('join-url').textContent = msg.joinUrl;
    } else if (msg.type === 'state') {
      const prev = state;
      state = msg.state;
      render();
      playTransitionSound(prev, state);
    } else if (msg.type === 'error' || msg.type === 'notice') {
      showNotice(msg.message, msg.type === 'error');
    }
  });

  ws.addEventListener('close', () => showScreen('disconnected'));
}

function sendAction(type, payload = {}) {
  if (previewMode) return showNotice(`預覽模式：不會送出「${type}」`, false);
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}

// ---- 畫面工具 ----

function showScreen(name) {
  for (const el of document.querySelectorAll('[data-screen]')) {
    el.hidden = el.dataset.screen !== name;
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
      li.textContent = p.name;
      if (p.id === state.you.id) li.classList.add('is-me');
      if (p.isHost) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '主持人';
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

function renderAnswers(listEl, answers) {
  listEl.replaceChildren(
    ...answers.map((a) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'answer-name';
      name.textContent = a.name;
      const img = document.createElement('img');
      img.className = 'drawing';
      img.alt = `${a.name} 的答案`;
      img.src = a.image;
      li.append(name, img);
      return li;
    }),
  );
}

function progressText(q) {
  return `第 ${q.number} 題｜目標：一致 ${state.targetMatches} 次`;
}

// 只在狀態「切換」的那一刻播放，剛連上線或其他更新不會重播
function playTransitionSound(prev, next) {
  if (!prev || !next.you.joined || prev.phase === next.phase) return;
  if (next.phase === 'judged') playSound(next.lastMatch ? 'correct' : 'wrong');
  else if (next.phase === 'finished' && next.targetReached) playSound('congrats');
  else if (prev.phase === 'finished') stopSound('congrats'); // 回到大廳就中斷
}

// ---- 各畫面 ----

function render() {
  const { phase, you, players } = state;
  document.body.classList.toggle('is-host', you.isHost);

  const me = players.find((p) => p.id === you.id);
  $('me').hidden = !me;
  $('me').textContent = me ? (you.isHost ? `${me.name}（主持人）` : me.name) : '';

  if (!you.joined) {
    if (phase === 'lobby') {
      $('name-input').maxLength = state.limits.maxNameLength;
      showScreen('join');
    } else {
      showScreen('locked');
    }
    return;
  }

  if (phase === 'lobby') renderLobby();
  else if (phase === 'answering') renderAnswering();
  else if (phase === 'revealed' || phase === 'judged') renderRevealed();
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
  $('lobby-target').textContent = `目標：一致 ${targetMatches} 次才結束`;

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

  $('answer-progress').textContent = progressText(question);
  $('answer-question').textContent = question.text;
  $('answer-form').hidden = Boolean(you.answer);
  $('my-answer').hidden = !you.answer;
  if (you.answer && $('my-answer-img').getAttribute('src') !== you.answer) {
    $('my-answer-img').src = you.answer;
  }

  const done = players.filter((p) => p.answered).length;
  $('answered-count').textContent = `${done} / ${players.length}`;
  renderPlayers($('answer-players'), players, { showAnswered: true });

  $('reveal-btn').disabled = !allAnswered;
  $('reveal-btn').textContent = allAnswered ? '公開答案' : '等待所有人作答…';
  showScreen('answering');
}

function renderRevealed() {
  const { phase, question, revealed, lastMatch, tally, targetMatches, targetReached } = state;
  $('reveal-progress').textContent = progressText(question);
  $('reveal-question').textContent = question.text;
  renderAnswers($('reveal-answers'), revealed);
  $('tally').textContent =
    `目前一致 ${tally.match} 題・不一致 ${tally.miss} 題（目標一致 ${targetMatches} 次）`;

  const judged = phase === 'judged';
  const result = $('result');
  result.hidden = !judged;
  if (judged) {
    result.textContent = lastMatch ? '一致！' : '沒有一致…';
    result.classList.toggle('is-match', lastMatch);
  }

  $('judge-buttons').hidden = judged;
  $('next-btn').hidden = !judged;
  $('next-btn').textContent = targetReached ? '看結算' : '下一題';
  $('reveal-wait').textContent = judged ? '等待主持人進到下一題…' : '等待主持人判定…';
  showScreen('revealed');
}

function renderFinished() {
  const { rounds, tally, targetMatches, targetReached } = state;
  $('score').textContent = targetReached
    ? `達成目標！一共答了 ${rounds} 題，一致 ${tally.match} 次`
    : `人數不足，提前結束：一致 ${tally.match} / ${targetMatches} 次，一共答了 ${rounds} 題`;
  showScreen('finished');
}

// ---- 事件 ----

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
  sendAction('answer', { image });
});

$('reveal-btn').addEventListener('click', () => sendAction('reveal'));
$('match-btn').addEventListener('click', () => sendAction('judge', { match: true }));
$('nomatch-btn').addEventListener('click', () => sendAction('judge', { match: false }));
$('next-btn').addEventListener('click', () => sendAction('next'));
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

const params = new URLSearchParams(location.search);
if (params.has('preview')) {
  previewMode = true;
  const { startPreview } = await import('./preview.js');
  const found = startPreview(params.get('preview'), params.get('as'), {
    setState: (s) => {
      state = s;
      render();
    },
    setInvite: (url, qr) => {
      $('join-url').textContent = url;
      $('qr').src = qr;
    },
    showScreen,
    showNotice,
  });
  if (!found) location.replace('/preview.html');
} else {
  connect();
}
