// 開發用預覽：不連線 server，用假資料直接顯示指定畫面，方便細修版面。
// 用法：/?preview=<key>&as=<host|guest>，所有畫面的總覽在 /preview.html

import { createBoard } from './board.js';

const LIMITS = {
  minPlayers: 2,
  maxPlayers: 6,
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
export const PREVIEWS = {
  connecting: { label: '連線中', screen: 'connecting' },
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
export function startPreview(key, role, app) {
  const preview = PREVIEWS[key];
  if (!preview) return false;

  app.setInvite('http://192.168.0.10:3000', fakeDrawing('QR code', 240, 240));
  if (preview.screen) {
    app.showScreen(preview.screen);
  } else {
    app.setState(preview.build(role === 'guest' ? 'guest' : 'host'));
  }
  // 錯誤提示預設 4 秒後消失，預覽時讓它一直留著
  if (preview.notice) app.showNotice(preview.notice, true, { persist: true });
  return true;
}
