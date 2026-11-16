// 多房間：每間房是一個 RoomSession（Room + 連在這間房的連線），RoomRegistry 用房號管理所有房間。
// 不直接依賴 ws 套件，連線物件只需要 readyState、OPEN 和 send()，方便測試。

import { Room } from './game.js';

// 去掉容易看錯的 0/O、1/I/L
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;
export const MAX_ROOMS = 100;

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
   * @param {{ joinUrl: string, qrDataUrl: string }} opts.invite 這間房的邀請連結和 QR code
   * @param {() => number} [opts.random]
   */
  constructor({ code, questions, invite, random }) {
    this.code = code;
    this.invite = invite;
    this.room = new Room({ questions, random });
    this.clients = new Map(); // ws -> playerId（還沒加入的旁觀者也在這裡，加入後才是玩家）
    this.ownerId = null; // 開房的人，取好暱稱加入後就是主持人
  }

  get isEmpty() {
    return this.clients.size === 0;
  }

  attach(ws, id, { owner = false } = {}) {
    this.clients.set(ws, id);
    if (owner) this.ownerId = id;
    send(ws, { type: 'welcome', code: this.code, owner, ...this.invite });
    send(ws, { type: 'state', state: this.room.viewFor(id) });
  }

  /** 處理房間內的操作，回傳錯誤訊息或 null；成功時會廣播新狀態。 */
  handle(ws, msg) {
    const id = this.clients.get(ws);
    const handler = HANDLERS[msg?.type];
    if (!handler) return '未知的操作';
    const error = handler(this, id, msg);
    if (!error) this.broadcastState();
    return error;
  }

  detach(ws) {
    const id = this.clients.get(ws);
    this.clients.delete(ws);
    const { room } = this;
    const player = room.players.get(id);
    if (!player) return;
    const wasInGame = room.inGame();
    const newHostId = room.leave(id);
    const notices = [`${player.name} 離線了`];
    if (newHostId) notices.push(`新主持人是 ${room.players.get(newHostId).name}`);
    if (wasInGame && room.phase === 'finished') notices.push('人數不足，直接進入結算');
    this.broadcast({ type: 'notice', message: notices.join('，') });
    this.broadcastState();
  }

  broadcast(msg) {
    for (const ws of this.clients.keys()) send(ws, msg);
  }

  broadcastState() {
    for (const [ws, id] of this.clients) send(ws, { type: 'state', state: this.room.viewFor(id) });
  }
}

const HANDLERS = {
  join: ({ room, ownerId }, id, msg) => room.join(id, msg.name, { asHost: id === ownerId }),
  setTargetMatches: ({ room }, id, msg) => room.setTargetMatches(id, msg.count),
  start: ({ room }, id) => room.start(id),
  answer: ({ room }, id, msg) => room.answer(id, msg.image),
  reveal: ({ room }, id) => room.reveal(id),
  judge: ({ room }, id, msg) => room.judge(id, msg.match),
  next: ({ room }, id) => room.next(id),
  backToLobby: ({ room }, id) => room.backToLobby(id),
};

export class RoomRegistry {
  /**
   * @param {object} opts
   * @param {string[]} opts.questions
   * @param {(code: string) => Promise<{ joinUrl: string, qrDataUrl: string }>} opts.makeInvite
   * @param {number} [opts.maxRooms]
   * @param {() => number} [opts.random]
   */
  constructor({ questions, makeInvite, maxRooms = MAX_ROOMS, random = Math.random }) {
    this.questions = questions;
    this.makeInvite = makeInvite;
    this.maxRooms = maxRooms;
    this.random = random;
    this.sessions = new Map(); // code -> RoomSession
    this.reserved = new Set(); // 正在產生 QR code、還沒放進 sessions 的房號
  }

  get(rawCode) {
    return this.sessions.get(normalizeCode(rawCode)) ?? null;
  }

  /** 開一間新房間。回傳 { session } 或 { error }。 */
  async create() {
    if (this.sessions.size + this.reserved.size >= this.maxRooms) {
      return { error: '目前房間數已達上限，請稍後再試' };
    }
    const code = this.uniqueCode();
    this.reserved.add(code);
    try {
      const invite = await this.makeInvite(code);
      const session = new RoomSession({ code, questions: this.questions, invite, random: this.random });
      this.sessions.set(code, session);
      return { session };
    } finally {
      this.reserved.delete(code);
    }
  }

  /** 最後一條連線離開時呼叫，把空房間收掉。 */
  release(session) {
    if (session.isEmpty && this.sessions.get(session.code) === session) this.sessions.delete(session.code);
  }

  uniqueCode() {
    // 31^4 ≈ 92 萬種組合，房間上限遠小於此，重抽幾次一定會成功
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)];
      }
      if (!this.sessions.has(code) && !this.reserved.has(code)) return code;
    }
  }
}
