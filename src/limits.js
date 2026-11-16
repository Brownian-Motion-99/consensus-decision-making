// 開放到外網時用的簡單限流。不碰網路，時間來源可以注入，方便測試。

/** 滑動視窗限流：每個 key 在 windowMs 內最多 limit 次。 */
export class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.limit
   * @param {number} opts.windowMs
   * @param {() => number} [opts.now]
   */
  constructor({ limit, windowMs, now = Date.now }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map(); // key -> 視窗內每次的時間戳記（由舊到新）
    this.lastSweep = now();
  }

  /** 記一次，回傳這次是否允許。被擋下的那次不算進去。 */
  hit(key) {
    const now = this.now();
    this.sweep(now);
    const cutoff = now - this.windowMs;
    const times = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (times.length >= this.limit) {
      this.hits.set(key, times);
      return false;
    }
    times.push(now);
    this.hits.set(key, times);
    return true;
  }

  /** 每過一個視窗就清掉已經沒有紀錄的 key，避免記憶體一直長大。 */
  sweep(now) {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    const cutoff = now - this.windowMs;
    for (const [key, times] of this.hits) {
      if (times[times.length - 1] <= cutoff) this.hits.delete(key);
    }
  }
}

/** 同時連線數：全部加起來最多 total 條，每個 key 最多 perKey 條。 */
export class ConnectionCounter {
  /**
   * @param {object} opts
   * @param {number} opts.total
   * @param {number} opts.perKey
   */
  constructor({ total, perKey }) {
    this.total = total;
    this.perKey = perKey;
    this.count = 0;
    this.byKey = new Map();
  }

  /** 佔一個名額，回傳是否成功。成功的話之後一定要呼叫 release。 */
  acquire(key) {
    const current = this.byKey.get(key) ?? 0;
    if (this.count >= this.total || current >= this.perKey) return false;
    this.count++;
    this.byKey.set(key, current + 1);
    return true;
  }

  release(key) {
    const current = this.byKey.get(key) ?? 0;
    if (current === 0) return;
    this.count--;
    if (current === 1) this.byKey.delete(key);
    else this.byKey.set(key, current - 1);
  }
}
