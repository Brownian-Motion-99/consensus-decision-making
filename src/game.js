// 遊戲狀態機：lobby → answering → revealed → judged → (answering | finished)
// 遊戲中人數不足時進入 paused，主持人繼續後的行為和「下一題」相同。
// 這裡是唯一的權威狀態，不碰網路，方便測試。

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MIN_TARGET = 1;
export const MAX_TARGET = 99;
export const DEFAULT_TARGET = 3;
// 手寫答案是 PNG data URL，限制大小避免塞爆連線
export const MAX_DRAWING_LENGTH = 200_000;
const DRAWING_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;
// 暱稱在每一份快照的玩家名單裡，每次廣播都會送，所以要有上限。以 code point 計算
export const MAX_NAME_LENGTH = 100;
// trim() 不會去掉零寬空格、韓文填充字元這類看不見的字元，只由它們組成的暱稱要換掉
// 不用 \p{Cf}：裡面有看得見的字元（例如阿拉伯文的 ۝），看不見的那些大多已經在 Default_Ignorable 裡
const INVISIBLE_NAME = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}\u2800]*$/u;
const ANIMALS = ['水豚', '石虎', '黑熊', '穿山甲', '藍鵲', '白海豚', '櫻花鉤吻鮭', '梅花鹿', '水獺', '帝雉'];

export class Room {
  /**
   * @param {object} opts
   * @param {string[]} opts.questions 題庫
   * @param {() => number} [opts.random] 可注入的亂數，測試用
   */
  constructor({ questions, random = Math.random }) {
    if (questions.length < 2) throw new Error('題庫至少需要 2 題');
    this.questionBank = questions;
    this.random = random;
    this.players = new Map(); // id -> { id, name }
    this.observers = new Map(); // 列席人員：題目進行中才加入的人，下一題開始時轉為玩家。id -> { id, name }
    this.hostId = null;
    this.targetMatches = DEFAULT_TARGET;
    this.resetGame();
  }

  resetGame() {
    this.promoteObservers();
    this.phase = 'lobby';
    this.deck = []; // 還沒出過的題目，抽完會重新洗牌
    this.question = null;
    this.number = 0; // 目前是第幾題
    this.answers = new Map(); // 目前題目：playerId -> 手寫圖片 data URL
    this.revealed = null; // 公開時的答案快照：[{ name, image }]
    this.history = []; // [{ question, match }]，不保留圖片，避免無限出題時記憶體一直長
  }

  // ---- 玩家進出 ----

  /**
   * 題目進行中加入的人先列席，其他時候直接成為玩家。
   * asHost：開房的人晚一步取暱稱，在大廳加入時仍然拿回主持人；遊戲開始後就不搶了。
   */
  join(id, rawName, { asHost = false } = {}) {
    if (this.isMember(id)) return '你已經在會議室裡了';
    if (this.players.size + this.observers.size >= MAX_PLAYERS) {
      return `會議室已滿（最多 ${MAX_PLAYERS} 人）`;
    }
    // 不用 String() 轉型：陣列會變成意外的字串，有自訂 toString 的物件還會丟例外
    if (typeof rawName !== 'string') return '暱稱格式錯誤';
    let name = rawName.trim();
    if (!name) return '請輸入暱稱';
    if ([...name].length > MAX_NAME_LENGTH) return `暱稱最多 ${MAX_NAME_LENGTH} 個字`;
    if (INVISIBLE_NAME.test(name)) name = this.randomName();
    if (this.inRound()) {
      this.observers.set(id, { id, name });
      return null;
    }
    this.players.set(id, { id, name });
    if (!this.hostId || (asHost && this.phase === 'lobby')) this.hostId = id;
    return null;
  }

  /** 玩家或列席人員離開。回傳新主持人的 id（如果有換人），否則 null。 */
  leave(id) {
    if (this.observers.delete(id)) return null;
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

    if (this.inRound() && this.players.size < MIN_PLAYERS) this.pause();
    return newHostId;
  }

  /** 「匿名水豚」這類暱稱，給看不見的暱稱用。可以重複。 */
  randomName() {
    return `匿名${ANIMALS[Math.floor(this.random() * ANIMALS.length)]}`;
  }

  isMember(id) {
    return this.players.has(id) || this.observers.has(id);
  }

  /** 有題目正在進行：這時加入的人要列席。 */
  inRound() {
    return this.phase === 'answering' || this.phase === 'revealed' || this.phase === 'judged';
  }

  // ---- 主持人操作 ----

  setTargetMatches(id, count) {
    if (id !== this.hostId) return '只有主席可以調整目標';
    if (this.phase !== 'lobby') return '遊戲開始後不能調整目標';
    const n = Number(count);
    if (!Number.isInteger(n) || n < MIN_TARGET || n > MAX_TARGET) {
      return `目標決議數需介於 ${MIN_TARGET} 到 ${MAX_TARGET} 之間`;
    }
    this.targetMatches = n;
    return null;
  }

  start(id) {
    if (id !== this.hostId) return '只有主席可以開始會議';
    if (this.phase !== 'lobby') return '遊戲已經開始了';
    if (this.players.size < MIN_PLAYERS) return `至少需要 ${MIN_PLAYERS} 人才能開始`;
    this.resetGame();
    this.nextQuestion();
    return null;
  }

  reveal(id) {
    if (id !== this.hostId) return '只有主席可以公開答案';
    if (this.phase !== 'answering') return '現在不能公開答案';
    if (!this.allAnswered()) return '還有人沒送出答案';
    this.revealed = [...this.players.values()].map((p) => ({
      name: p.name,
      image: this.answers.get(p.id),
    }));
    this.phase = 'revealed';
    return null;
  }

  judge(id, match) {
    if (id !== this.hostId) return '只有主席可以判定';
    if (this.phase !== 'revealed') return '現在不能判定';
    if (typeof match !== 'boolean') return '判定結果格式錯誤';
    this.history.push({ question: this.question, match });
    this.phase = 'judged';
    return null;
  }

  /** 達到目標一致次數就結算，否則一直出下一題。 */
  next(id) {
    if (id !== this.hostId) return '只有主席可以進到下一題';
    if (this.phase !== 'judged') return '現在不能進到下一題';
    this.advance();
    return null;
  }

  /** 休會後繼續，行為和「下一題」相同。 */
  resume(id) {
    if (id !== this.hostId) return '只有主席可以繼續會議';
    if (this.phase !== 'paused') return '現在沒有休會';
    if (this.players.size < MIN_PLAYERS) return `至少需要 ${MIN_PLAYERS} 人才能繼續`;
    this.advance();
    return null;
  }

  backToLobby(id) {
    if (id !== this.hostId) return '只有主席可以召開下一場會議';
    if (this.phase !== 'finished') return '遊戲還沒結束';
    this.resetGame();
    return null;
  }

  // ---- 玩家操作 ----

  answer(id, image) {
    if (this.observers.has(id)) return '列席人員要等下個議案開始才能作答';
    if (!this.players.has(id)) return '你不在這局遊戲裡';
    if (this.phase !== 'answering') return '現在不能作答';
    if (this.answers.has(id)) return '已經送出答案，不能修改';
    if (typeof image !== 'string' || !DRAWING_PATTERN.test(image)) return '答案格式錯誤';
    if (image.length > MAX_DRAWING_LENGTH) return '圖太大了，請簡化一點再送出';
    this.answers.set(id, image);
    return null;
  }

  // ---- 內部 ----

  advance() {
    if (this.targetReached()) {
      this.promoteObservers();
      this.answers = new Map();
      this.revealed = null;
      this.phase = 'finished';
    } else {
      this.nextQuestion();
    }
  }

  /** 人數不足時休會。還沒判定的那一題作廢，題號留給下一題用。 */
  pause() {
    if (this.phase !== 'judged') this.number -= 1;
    this.promoteObservers();
    this.answers = new Map();
    this.revealed = null;
    this.phase = 'paused';
  }

  promoteObservers() {
    for (const [id, observer] of this.observers) this.players.set(id, observer);
    this.observers.clear();
  }

  nextQuestion() {
    this.promoteObservers();
    if (this.deck.length === 0) {
      this.deck = this.shuffle([...this.questionBank]);
      // 重新洗牌後，避免下一題剛好和上一題一樣
      if (this.deck.at(-1) === this.question) {
        [this.deck[0], this.deck[this.deck.length - 1]] = [this.deck.at(-1), this.deck[0]];
      }
    }
    this.question = this.deck.pop();
    this.number += 1;
    this.answers = new Map();
    this.revealed = null;
    this.phase = 'answering';
  }

  shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  // ---- 查詢 ----

  allAnswered() {
    for (const id of this.players.keys()) {
      if (!this.answers.has(id)) return false;
    }
    return true;
  }

  matchCount() {
    return this.history.filter((h) => h.match).length;
  }

  targetReached() {
    return this.matchCount() >= this.targetMatches;
  }

  /**
   * 給特定玩家看的狀態快照。公開前絕不包含其他人的答案。
   * @param {string} viewerId
   */
  viewFor(viewerId) {
    const matches = this.matchCount();
    // 只有玩家看得到題目和答案；列席人員和還沒取暱稱的連線都不送
    const isPlayer = this.players.has(viewerId);
    return {
      phase: this.phase,
      you: {
        id: viewerId,
        joined: this.isMember(viewerId),
        observer: this.observers.has(viewerId),
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
        minTarget: MIN_TARGET,
        maxTarget: MAX_TARGET,
        maxDrawingLength: MAX_DRAWING_LENGTH,
      },
      targetMatches: this.targetMatches,
      question: this.inRound() && isPlayer ? { number: this.number, text: this.question } : null,
      allAnswered: this.phase === 'answering' && this.allAnswered(),
      revealed:
        (this.phase === 'revealed' || this.phase === 'judged') && isPlayer ? this.revealed : null,
      lastMatch: this.phase === 'judged' ? this.history.at(-1).match : null,
      rounds: this.history.length,
      tally: { match: matches, miss: this.history.length - matches },
      targetReached: this.targetReached(),
    };
  }
}
