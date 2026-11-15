// 遊戲狀態機：lobby → answering → revealed → judged → (answering | finished)
// 這裡是唯一的權威狀態，不碰網路，方便測試。

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const MIN_QUESTIONS = 6;
export const MAX_QUESTIONS = 10;
export const MAX_NAME_LENGTH = 12;
export const MAX_ANSWER_LENGTH = 30;

export class Room {
  /**
   * @param {object} opts
   * @param {string[]} opts.questions 題庫
   * @param {() => number} [opts.random] 可注入的亂數，測試用
   */
  constructor({ questions, random = Math.random }) {
    if (questions.length < MIN_QUESTIONS) {
      throw new Error(`題庫至少需要 ${MIN_QUESTIONS} 題`);
    }
    this.questionBank = questions;
    this.random = random;
    this.players = new Map(); // id -> { id, name }
    this.hostId = null;
    this.questionCount = Math.min(8, MAX_QUESTIONS, questions.length);
    this.resetGame();
  }

  resetGame() {
    this.phase = 'lobby';
    this.questions = [];
    this.index = 0;
    this.answers = new Map(); // 目前題目：playerId -> text
    this.revealed = null; // 公開時的答案快照：[{ name, text }]
    this.history = []; // [{ question, answers: [{ name, text }], match }]
  }

  // ---- 玩家進出 ----

  join(id, rawName) {
    if (this.phase !== 'lobby') return '遊戲進行中，目前無法加入';
    if (this.players.has(id)) return '你已經在房間裡了';
    if (this.players.size >= MAX_PLAYERS) return `房間已滿（最多 ${MAX_PLAYERS} 人）`;
    const name = String(rawName ?? '').trim();
    if (!name) return '請輸入暱稱';
    if ([...name].length > MAX_NAME_LENGTH) return `暱稱最多 ${MAX_NAME_LENGTH} 個字`;
    for (const p of this.players.values()) {
      if (p.name === name) return '這個暱稱已經有人用了';
    }
    this.players.set(id, { id, name });
    if (!this.hostId) this.hostId = id;
    return null;
  }

  /** 玩家離開。回傳新主持人的 id（如果有換人），否則 null。 */
  leave(id) {
    if (!this.players.has(id)) return null;
    this.players.delete(id);
    this.answers.delete(id);

    if (this.players.size === 0) {
      this.hostId = null;
      this.resetGame();
      return null;
    }

    let newHostId = null;
    if (this.hostId === id) {
      const ids = [...this.players.keys()];
      this.hostId = ids[Math.floor(this.random() * ids.length)];
      newHostId = this.hostId;
    }

    if (this.inGame() && this.players.size < MIN_PLAYERS) {
      this.phase = 'finished';
      this.revealed = null;
    }
    return newHostId;
  }

  inGame() {
    return this.phase !== 'lobby' && this.phase !== 'finished';
  }

  // ---- 主持人操作 ----

  setQuestionCount(id, count) {
    if (id !== this.hostId) return '只有主持人可以調整題數';
    if (this.phase !== 'lobby') return '遊戲開始後不能調整題數';
    const n = Number(count);
    const max = Math.min(MAX_QUESTIONS, this.questionBank.length);
    if (!Number.isInteger(n) || n < MIN_QUESTIONS || n > max) {
      return `題數需介於 ${MIN_QUESTIONS} 到 ${max} 之間`;
    }
    this.questionCount = n;
    return null;
  }

  start(id) {
    if (id !== this.hostId) return '只有主持人可以開始遊戲';
    if (this.phase !== 'lobby') return '遊戲已經開始了';
    if (this.players.size < MIN_PLAYERS) return `至少需要 ${MIN_PLAYERS} 人才能開始`;
    this.resetGame();
    this.questions = this.drawQuestions(this.questionCount);
    this.phase = 'answering';
    return null;
  }

  reveal(id) {
    if (id !== this.hostId) return '只有主持人可以公開答案';
    if (this.phase !== 'answering') return '現在不能公開答案';
    if (!this.allAnswered()) return '還有人沒送出答案';
    this.revealed = [...this.players.values()].map((p) => ({
      name: p.name,
      text: this.answers.get(p.id),
    }));
    this.phase = 'revealed';
    return null;
  }

  judge(id, match) {
    if (id !== this.hostId) return '只有主持人可以判定';
    if (this.phase !== 'revealed') return '現在不能判定';
    if (typeof match !== 'boolean') return '判定結果格式錯誤';
    this.history.push({
      question: this.questions[this.index],
      answers: this.revealed,
      match,
    });
    this.phase = 'judged';
    return null;
  }

  next(id) {
    if (id !== this.hostId) return '只有主持人可以進到下一題';
    if (this.phase !== 'judged') return '現在不能進到下一題';
    this.answers = new Map();
    this.revealed = null;
    if (this.index + 1 >= this.questions.length) {
      this.phase = 'finished';
    } else {
      this.index += 1;
      this.phase = 'answering';
    }
    return null;
  }

  backToLobby(id) {
    if (id !== this.hostId) return '只有主持人可以回到大廳';
    if (this.phase !== 'finished') return '遊戲還沒結束';
    this.resetGame();
    return null;
  }

  // ---- 玩家操作 ----

  answer(id, rawText) {
    if (!this.players.has(id)) return '你不在這局遊戲裡';
    if (this.phase !== 'answering') return '現在不能作答';
    const text = String(rawText ?? '').trim();
    if (!text) return '答案不能是空的';
    if ([...text].length > MAX_ANSWER_LENGTH) return `答案最多 ${MAX_ANSWER_LENGTH} 個字`;
    this.answers.set(id, text); // 公開前可以改答案
    return null;
  }

  // ---- 查詢 ----

  allAnswered() {
    for (const id of this.players.keys()) {
      if (!this.answers.has(id)) return false;
    }
    return true;
  }

  drawQuestions(n) {
    const pool = [...this.questionBank];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
  }

  /**
   * 給特定玩家看的狀態快照。公開前絕不包含其他人的答案。
   * @param {string} viewerId
   */
  viewFor(viewerId) {
    const showQuestion = this.inGame();
    return {
      phase: this.phase,
      you: {
        id: viewerId,
        joined: this.players.has(viewerId),
        isHost: viewerId === this.hostId,
        answer: this.answers.get(viewerId) ?? null,
      },
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.id === this.hostId,
        answered: this.phase === 'answering' && this.answers.has(p.id),
      })),
      limits: {
        minPlayers: MIN_PLAYERS,
        maxPlayers: MAX_PLAYERS,
        minQuestions: MIN_QUESTIONS,
        maxQuestions: Math.min(MAX_QUESTIONS, this.questionBank.length),
        maxNameLength: MAX_NAME_LENGTH,
        maxAnswerLength: MAX_ANSWER_LENGTH,
      },
      questionCount: this.questionCount,
      question: showQuestion
        ? { number: this.index + 1, total: this.questions.length, text: this.questions[this.index] }
        : null,
      allAnswered: this.phase === 'answering' && this.allAnswered(),
      revealed:
        this.phase === 'revealed' || this.phase === 'judged' ? this.revealed : null,
      lastMatch: this.phase === 'judged' ? this.history.at(-1).match : null,
      history: this.phase === 'finished' ? this.history : null,
      score: this.history.filter((h) => h.match).length,
      judgedCount: this.history.length,
    };
  }
}
