// 多房間：每間房是一個 RoomSession（Room + 連在這間房的連線），RoomRegistry 用房號管理所有房間。
// 不直接依賴 ws 套件，連線物件只需要 readyState、OPEN 和 send()，方便測試。

import { Room } from './game.js';

// 去掉容易看錯的 0/O、1/I/L
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;
export const MAX_ROOMS = 100;
// 最後一條連線離開後保留一下，一個人重新整理時才回得來
export const EMPTY_ROOM_GRACE_MS = 30_000;
// 開了房卻一直沒有人加入（例如分頁開著沒人管），就收掉
export const IDLE_ROOM_MS = 10 * 60_000;

export function normalizeCode(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export class RoomSession {
  /**
   * @param {object} opts
   * @param {string} opts.code 房號
   * @param {string[]} opts.questions
   * @param {string} opts.joinUrl 這間房的邀請連結
   * @param {() => number} [opts.random]
   * @param {() => void} [opts.onChange] 連線或成員變動時呼叫，讓 RoomRegistry 安排回收
   */
  constructor({ code, questions, joinUrl, random, onChange = () => {} }) {
    this.code = code;
    this.joinUrl = joinUrl;
    this.room = new Room({ questions, random });
    this.clients = new Map(); // ws -> playerId（還沒取暱稱的連線也在這裡，加入後才是玩家或列席人員）
    this.ownerId = null; // 開房的人，取好暱稱加入後就是主持人
    this.onChange = onChange;
    this.closed = false;
  }

  get isEmpty() {
    return this.clients.size === 0;
  }

  /** 有沒有取好暱稱的人（玩家或列席人員）。 */
  get hasMembers() {
    return this.room.players.size + this.room.observers.size > 0;
  }

  attach(ws, id, { owner = false } = {}) {
    this.clients.set(ws, id);
    if (owner) this.ownerId = id;
    send(ws, { type: 'welcome', code: this.code, owner, joinUrl: this.joinUrl });
    send(ws, { type: 'state', state: this.room.viewFor(id) });
    this.onChange();
  }

  /** 處理房間內的操作，回傳錯誤訊息或 null；成功時會廣播新狀態。 */
  handle(ws, msg) {
    const id = this.clients.get(ws);
    const handler = HANDLERS[msg?.type];
    if (!handler) return '未知的操作';
    const error = handler(this, id, msg);
    if (!error) this.broadcastState();
    this.onChange();
    return error;
  }

  detach(ws) {
    const id = this.clients.get(ws);
    this.clients.delete(ws);
    this.notifyLeave(id);
    this.onChange();
  }

  notifyLeave(id) {
    const { room } = this;
    const member = room.players.get(id) ?? room.observers.get(id);
    if (!member) return;
    const wasInRound = room.inRound();
    const newHostId = room.leave(id);
    const notices = [`${member.name} 離席了`];
    if (newHostId) notices.push(`新主席是 ${room.players.get(newHostId).name}`);
    if (wasInRound && room.phase === 'paused') notices.push('出席人數不足，暫時休會');
    this.broadcast({ type: 'notice', message: notices.join('，') });
    this.broadcastState();
  }

  /** 收掉房間：通知還連著的人回首頁，之後這間房不再處理任何操作。 */
  close(message) {
    this.broadcast({ type: 'closed', message });
    this.clients.clear();
    this.closed = true;
  }

  broadcast(msg) {
    for (const ws of this.clients.keys()) send(ws, msg);
  }

  broadcastState() {
    for (const [ws, id] of this.clients) send(ws, { type: 'state', state: this.room.viewFor(id) });
  }
}

const HANDLERS = {
  join: (session, id, msg) => {
    const { room, ownerId } = session;
    const error = room.join(id, msg.name, { asHost: id === ownerId });
    const observer = room.observers.get(id);
    if (!error && observer) {
      session.broadcast({ type: 'notice', message: `${observer.name} 列席，下個議案開始時加入會議` });
    }
    return error;
  },
  setTargetMatches: ({ room }, id, msg) => room.setTargetMatches(id, msg.count),
  start: ({ room }, id) => room.start(id),
  answer: ({ room }, id, msg) => room.answer(id, msg.image),
  reveal: ({ room }, id) => room.reveal(id),
  judge: ({ room }, id, msg) => room.judge(id, msg.match),
  next: ({ room }, id) => room.next(id),
  resume: ({ room }, id) => room.resume(id),
  backToLobby: ({ room }, id) => room.backToLobby(id),
};

export class RoomRegistry {
  /**
   * @param {object} opts
   * @param {string[]} opts.questions
   * @param {(code: string) => string} opts.joinUrlFor 用房號產生邀請連結
   * @param {number} [opts.maxRooms]
   * @param {() => number} [opts.random]
   */
  constructor({ questions, joinUrlFor, maxRooms = MAX_ROOMS, random = Math.random }) {
    this.questions = questions;
    this.joinUrlFor = joinUrlFor;
    this.maxRooms = maxRooms;
    this.random = random;
    this.sessions = new Map(); // code -> RoomSession
    this.timers = new Map(); // RoomSession -> { empty, idle }：回收房間的計時
  }

  get(rawCode) {
    return this.sessions.get(normalizeCode(rawCode)) ?? null;
  }

  /** 開一間新房間。回傳 { session } 或 { error }。 */
  create() {
    if (this.sessions.size >= this.maxRooms) return { error: '目前會議室都借光了，請稍後再試' };
    const code = this.uniqueCode();
    const joinUrl = this.joinUrlFor(code);
    const session = new RoomSession({
      code,
      questions: this.questions,
      joinUrl,
      random: this.random,
      onChange: () => this.scheduleCleanup(session),
    });
    this.sessions.set(code, session);
    this.timers.set(session, { empty: null, idle: null });
    this.scheduleCleanup(session);
    return { session };
  }

  /**
   * 依照房間現況安排或取消回收：
   * 沒有任何連線時，保留 EMPTY_ROOM_GRACE_MS；沒有任何玩家或列席人員時，保留 IDLE_ROOM_MS。
   */
  scheduleCleanup(session) {
    const timers = this.timers.get(session);
    if (!timers) return;
    timers.empty = this.toggleTimer(timers.empty, session.isEmpty, EMPTY_ROOM_GRACE_MS, () => this.remove(session));
    timers.idle = this.toggleTimer(timers.idle, !session.hasMembers, IDLE_ROOM_MS, () => {
      session.close('會議室閒置太久，已經關閉了');
      this.remove(session);
    });
  }

  /** wanted 時確保有計時（已經在跑就不重來），否則取消。回傳目前的計時。 */
  toggleTimer(timer, wanted, ms, fn) {
    if (!wanted) {
      clearTimeout(timer);
      return null;
    }
    if (timer) return timer;
    timer = setTimeout(fn, ms);
    timer.unref?.(); // 計時不該讓 process 撐著不結束
    return timer;
  }

  remove(session) {
    const timers = this.timers.get(session);
    if (!timers) return;
    clearTimeout(timers.empty);
    clearTimeout(timers.idle);
    this.timers.delete(session);
    if (this.sessions.get(session.code) === session) this.sessions.delete(session.code);
  }

  uniqueCode() {
    // 31^4 ≈ 92 萬種組合，房間上限遠小於此，重抽幾次一定會成功
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)];
      }
      if (!this.sessions.has(code)) return code;
    }
  }
}
