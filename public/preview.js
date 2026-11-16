// 開發用預覽：不連線 server，用假資料直接顯示指定畫面，方便細修版面。
// 用法：/?preview=<key>&as=<host|guest>，所有畫面的總覽在 /preview.html（手機）和 /preview-desktop.html（電腦）
// 劇本模式：/?preview=flow&as=<host|guest>，依序切換狀態，可以看切換時的動畫和音效

import { createBoard } from './board.js';
import { watchTweaks } from './tweaks.js';

const LIMITS = {
  minPlayers: 2,
  maxPlayers: 8,
  minTarget: 1,
  maxTarget: 99,
  maxNameLength: 12,
  maxDrawingLength: 200_000,
};

const PLAYERS = [
  { id: 'p1', name: '小明' },
  { id: 'p2', name: '阿美' },
  { id: 'p3', name: '大雄' },
  { id: 'p4', name: '一個名字很長的玩家' },
];

const QUESTION = { number: 3, text: '早餐店必點的一樣餐點是？' };

/** 用白板程式把文字畫成圖片，當作假的手寫答案。 */
function fakeDrawing(text, width = 600, height = 400) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const board = createBoard(canvas, { fontFamily: getComputedStyle(document.body).fontFamily });
  board.setText(text);
  return board.toDataURL();
}

function makeState(role, overrides = {}) {
  const youId = role === 'guest' ? 'p2' : 'p1';
  const answered = new Set(overrides.answeredIds ?? []);
  return {
    phase: 'lobby',
    you: { id: youId, joined: true, isHost: role !== 'guest', answer: null },
    players: PLAYERS.map((p) => ({ ...p, isHost: p.id === 'p1', answered: answered.has(p.id) })),
    limits: LIMITS,
    targetMatches: 3,
    question: null,
    allAnswered: false,
    revealed: null,
    lastMatch: null,
    tally: { match: 1, miss: 1 },
    targetReached: false,
    rounds: 2,
    ...overrides,
  };
}

function revealedAnswers() {
  const texts = ['蛋餅', '蛋餅', '蘿蔔糕', '鐵板麵加蛋加起司'];
  return PLAYERS.map((p, i) => ({ name: p.name, image: fakeDrawing(texts[i]) }));
}

/**
 * 每個預覽：label 是說明，roles 是有差異的身分，
 * build(role) 回傳假的狀態，或用 screen 直接指定非狀態畫面（連線中、斷線）。
 */
export const FLOW_KEY = 'flow';

export const PREVIEWS = {
  connecting: { label: '連線中', screen: 'connecting' },
  home: { label: '首頁（開房間／輸入房號）', screen: 'home' },
  join: {
    label: '加入遊戲',
    build: (role) => makeState(role, { you: { id: 'x', joined: false, isHost: false, answer: null } }),
  },
  locked: {
    label: '遊戲進行中，無法加入',
    build: (role) =>
      makeState(role, { phase: 'answering', question: QUESTION, you: { id: 'x', joined: false, isHost: false, answer: null } }),
  },
  lobby: { label: '大廳', roles: ['host', 'guest'], build: (role) => makeState(role) },
  'lobby-alone': {
    label: '大廳（人數不足）',
    build: (role) => ({ ...makeState(role), players: [{ ...PLAYERS[0], isHost: true, answered: false }] }),
  },
  answering: {
    label: '作答中（還沒送出）',
    roles: ['host', 'guest'],
    build: (role) => makeState(role, { phase: 'answering', question: QUESTION, answeredIds: ['p3', 'p4'] }),
  },
  'answering-sent': {
    label: '作答中（已送出）',
    roles: ['host', 'guest'],
    build: (role) => {
      const s = makeState(role, {
        phase: 'answering',
        question: QUESTION,
        answeredIds: ['p1', 'p2', 'p3'],
      });
      s.you.answer = fakeDrawing('蛋餅');
      return s;
    },
  },
  'answering-all': {
    label: '作答中（全員已送出）',
    roles: ['host', 'guest'],
    build: (role) => {
      const s = makeState(role, {
        phase: 'answering',
        question: QUESTION,
        answeredIds: PLAYERS.map((p) => p.id),
        allAnswered: true,
      });
      s.you.answer = fakeDrawing('蛋餅');
      return s;
    },
  },
  revealed: {
    label: '公開答案（等待判定）',
    roles: ['host', 'guest'],
    build: (role) => makeState(role, { phase: 'revealed', question: QUESTION, revealed: revealedAnswers() }),
  },
  'judged-match': {
    label: '判定：一致',
    roles: ['host', 'guest'],
    build: (role) =>
      makeState(role, {
        phase: 'judged',
        question: QUESTION,
        revealed: revealedAnswers(),
        lastMatch: true,
        tally: { match: 2, miss: 1 },
      }),
  },
  'judged-miss': {
    label: '判定：不一致',
    roles: ['host', 'guest'],
    build: (role) =>
      makeState(role, {
        phase: 'judged',
        question: QUESTION,
        revealed: revealedAnswers(),
        lastMatch: false,
        tally: { match: 1, miss: 2 },
      }),
  },
  'judged-last': {
    label: '判定：達成目標（看結算）',
    build: (role) =>
      makeState(role, {
        phase: 'judged',
        question: QUESTION,
        revealed: revealedAnswers(),
        lastMatch: true,
        tally: { match: 3, miss: 0 },
        targetReached: true,
      }),
  },
  finished: {
    label: '結算（達成目標）',
    roles: ['host', 'guest'],
    build: (role) =>
      makeState(role, { phase: 'finished', tally: { match: 3, miss: 4 }, rounds: 7, targetReached: true }),
  },
  'finished-early': {
    label: '結算（人數不足提前結束）',
    build: (role) =>
      makeState(role, { phase: 'finished', tally: { match: 1, miss: 2 }, rounds: 3, targetReached: false }),
  },
  notice: {
    label: '錯誤提示',
    notice: '還有人沒送出答案',
    build: (role) => makeState(role, { phase: 'answering', question: QUESTION, answeredIds: ['p2'] }),
  },
  disconnected: { label: '連線中斷', screen: 'disconnected' },
};

/**
 * 啟動預覽。app 是 app.js 提供的掛勾，讓預覽能直接設定狀態和畫面。
 * @returns {boolean} 找不到這個預覽時回傳 false
 */
// ---- 劇本模式：依序切換狀態，看切換時的動畫和音效 ----

/** 劇本的每一步。目標設成一致 1 次，兩題就能走完一整局。 */
function flowSteps(role) {
  const youId = role === 'guest' ? 'p2' : 'p1';
  const allIds = PLAYERS.map((p) => p.id);
  const q1 = { number: 1, text: '說到夏天，你會想到什麼？' };
  const q2 = { number: 2, text: '早餐店必點的一樣餐點是？' };
  const myAnswer1 = fakeDrawing('西瓜');
  const myAnswer2 = fakeDrawing('蛋餅');
  const answers1 = PLAYERS.map((p, i) => ({ name: p.name, image: fakeDrawing(['西瓜', '海邊', '西瓜', '冰淇淋'][i]) }));
  const answers2 = PLAYERS.map((p) => ({ name: p.name, image: fakeDrawing('蛋餅') }));

  const base = (overrides) => makeState(role, { targetMatches: 1, tally: { match: 0, miss: 0 }, rounds: 0, ...overrides });
  const answering = (question, answeredIds, myAnswer) => {
    const s = base({
      phase: 'answering',
      question,
      answeredIds,
      allAnswered: answeredIds.length === allIds.length,
      tally: question.number === 1 ? { match: 0, miss: 0 } : { match: 0, miss: 1 },
    });
    if (answeredIds.includes(youId)) s.you.answer = myAnswer;
    return s;
  };

  return [
    { label: '大廳', state: base({}) },
    { label: '第 1 題：作答中', state: answering(q1, ['p3'], myAnswer1) },
    { label: '第 1 題：自己已送出', state: answering(q1, [youId, 'p3'], myAnswer1) },
    { label: '第 1 題：全員已送出', state: answering(q1, allIds, myAnswer1) },
    { label: '第 1 題：公開答案', state: base({ phase: 'revealed', question: q1, revealed: answers1 }) },
    {
      label: '第 1 題：判定不一致（音效）',
      state: base({ phase: 'judged', question: q1, revealed: answers1, lastMatch: false, tally: { match: 0, miss: 1 } }),
    },
    { label: '第 2 題：作答中', state: answering(q2, [], myAnswer2) },
    { label: '第 2 題：全員已送出', state: answering(q2, allIds, myAnswer2) },
    {
      label: '第 2 題：公開答案',
      state: base({ phase: 'revealed', question: q2, revealed: answers2, tally: { match: 0, miss: 1 } }),
    },
    {
      label: '第 2 題：判定一致（音效）',
      state: base({
        phase: 'judged',
        question: q2,
        revealed: answers2,
        lastMatch: true,
        tally: { match: 1, miss: 1 },
        targetReached: true,
      }),
    },
    {
      label: '結算（音效）',
      state: base({ phase: 'finished', tally: { match: 1, miss: 1 }, rounds: 2, targetReached: true }),
    },
    { label: '回到大廳（中斷音效）', state: base({ tally: { match: 0, miss: 0 } }) },
  ];
}

const AUTO_INTERVAL_MS = 2500;

function startFlow(role, app) {
  const steps = flowSteps(role);
  let index = 0;
  let timer = null;

  // 控制面板是開發工具，樣式寫在這裡，不放進遊戲的 style.css
  const style = document.createElement('style');
  style.textContent = `
    .flow-panel {
      position: fixed;
      left: 8px;
      bottom: calc(8px + env(safe-area-inset-bottom, 0px));
      z-index: 9999;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      max-width: calc(100vw - 16px);
      padding: 6px 8px;
      font: 13px/1.2 system-ui, sans-serif;
      color: #fff;
      background: rgba(0, 0, 0, 0.75);
      border-radius: 8px;
      -webkit-user-select: none;
      user-select: none;
    }
    .flow-panel button, .flow-panel select {
      font: inherit;
      color: #000;
      background: #fff;
      border: 0;
      border-radius: 4px;
      padding: 4px 8px;
    }
    .flow-panel select { max-width: 200px; }
  `;
  document.head.append(style);

  const panel = document.createElement('div');
  panel.className = 'flow-panel';
  const prevBtn = Object.assign(document.createElement('button'), { textContent: '◀', title: '上一步（←）' });
  const nextBtn = Object.assign(document.createElement('button'), { textContent: '▶', title: '下一步（→）' });
  const autoBtn = document.createElement('button');
  const select = document.createElement('select');
  steps.forEach((step, i) => select.append(new Option(`${i + 1}. ${step.label}`, String(i))));
  panel.append(prevBtn, select, nextBtn, autoBtn);
  document.body.append(panel);

  function go(i) {
    index = (i + steps.length) % steps.length;
    select.value = String(index);
    app.applyState(structuredClone(steps[index].state));
  }

  function setAuto(on) {
    clearInterval(timer);
    timer = on ? setInterval(() => go(index + 1), AUTO_INTERVAL_MS) : null;
    autoBtn.textContent = on ? '■ 停止' : '▶▶ 自動';
  }

  prevBtn.addEventListener('click', () => go(index - 1));
  nextBtn.addEventListener('click', () => go(index + 1));
  select.addEventListener('change', () => go(Number(select.value)));
  autoBtn.addEventListener('click', () => setAuto(!timer));
  document.addEventListener('keydown', (e) => {
    if (e.target.matches?.('input, select, textarea')) return;
    if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'ArrowLeft') go(index - 1);
  });

  setAuto(false);
  go(0);
}

/**
 * 啟動預覽。app 是 app.js 提供的掛勾，讓預覽能直接設定狀態和畫面。
 * @returns {boolean} 找不到這個預覽時回傳 false
 */
export function startPreview(key, role, app) {
  watchTweaks();
  const normalizedRole = role === 'guest' ? 'guest' : 'host';
  app.setInvite('K7QX', 'http://192.168.0.10:3000/?room=K7QX');

  if (key === FLOW_KEY) {
    startFlow(normalizedRole, app);
    return true;
  }

  const preview = PREVIEWS[key];
  if (!preview) return false;
  if (preview.screen) {
    app.showScreen(preview.screen);
  } else {
    app.applyState(preview.build(normalizedRole));
  }
  // 錯誤提示預設 4 秒後消失，預覽時讓它一直留著
  if (preview.notice) app.showNotice(preview.notice, true, { persist: true });
  return true;
}
