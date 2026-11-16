import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, ConnectionCounter } from '../src/limits.js';

function clock() {
  const c = { t: 0, now: () => c.t };
  return c;
}

test('限流：視窗內超過上限就擋下', () => {
  const c = clock();
  const limiter = new RateLimiter({ limit: 3, windowMs: 1000, now: c.now });
  assert.equal(limiter.hit('a'), true);
  assert.equal(limiter.hit('a'), true);
  assert.equal(limiter.hit('a'), true);
  assert.equal(limiter.hit('a'), false);
});

test('限流：舊紀錄過期後就放行', () => {
  const c = clock();
  const limiter = new RateLimiter({ limit: 2, windowMs: 1000, now: c.now });
  limiter.hit('a');
  c.t = 500;
  limiter.hit('a');
  assert.equal(limiter.hit('a'), false);
  c.t = 1001; // 第一次已經過期，第二次還在
  assert.equal(limiter.hit('a'), true);
  assert.equal(limiter.hit('a'), false);
});

test('限流：不同 key 互不影響', () => {
  const c = clock();
  const limiter = new RateLimiter({ limit: 1, windowMs: 1000, now: c.now });
  assert.equal(limiter.hit('a'), true);
  assert.equal(limiter.hit('b'), true);
  assert.equal(limiter.hit('a'), false);
});

test('限流：沒有紀錄的 key 會被清掉', () => {
  const c = clock();
  const limiter = new RateLimiter({ limit: 1, windowMs: 1000, now: c.now });
  limiter.hit('a');
  c.t = 5000;
  limiter.hit('b');
  assert.deepEqual([...limiter.hits.keys()], ['b']);
});

test('連線數：全部加起來有上限', () => {
  const counter = new ConnectionCounter({ total: 2, perKey: 5 });
  assert.equal(counter.acquire('a'), true);
  assert.equal(counter.acquire('b'), true);
  assert.equal(counter.acquire('c'), false);
});

test('連線數：每個 key 有上限，release 後可以再取得', () => {
  const counter = new ConnectionCounter({ total: 10, perKey: 2 });
  assert.equal(counter.acquire('a'), true);
  assert.equal(counter.acquire('a'), true);
  assert.equal(counter.acquire('a'), false);
  assert.equal(counter.acquire('b'), true);
  counter.release('a');
  assert.equal(counter.acquire('a'), true);
});

test('連線數：多呼叫 release 不會讓計數變負的', () => {
  const counter = new ConnectionCounter({ total: 1, perKey: 1 });
  counter.release('a');
  assert.equal(counter.acquire('a'), true);
  assert.equal(counter.acquire('b'), false);
});
