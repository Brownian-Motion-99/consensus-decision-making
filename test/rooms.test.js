import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  RoomRegistry,
  CODE_LENGTH,
  EMPTY_ROOM_GRACE_MS,
  IDLE_ROOM_MS,
  MAX_PENDING_CONNECTIONS,
} from '../src/rooms.js';

// 房間回收用 setTimeout，換成假的時鐘，用 tick() 快轉
mock.timers.enable({ apis: ['setTimeout'] });

const QUESTIONS = Array.from({ length: 12 }, (_, i) => `題目 ${i + 1}`);

function registry(opts = {}) {
  return new RoomRegistry({
    questions: QUESTIONS,
    joinUrlFor: (code) => `http://x/?room=${code}`,
    ...opts,
  });
}

/** 假的連線：只記錄收到的訊息，每則訊息都馬上送完。 */
function fakeSocket() {
  return {
    OPEN: 1,
    readyState: 1,
    messages: [],
    send(raw, done) {
      this.messages.push(JSON.parse(raw));
      done?.();
    },
    last(type) {
      return this.messages.findLast((m) => m.type === type);
    },
    count(type) {
      return this.messages.filter((m) => m.type === type).length;
    },
  };
}

/** 網路很慢的連線：訊息要等 flush() 才算送完。 */
function slowSocket() {
  const ws = fakeSocket();
  ws.pending = [];
  ws.send = function (raw, done) {
    this.messages.push(JSON.parse(raw));
    if (done) this.pending.push(done);
  };
  ws.flush = function () {
    this.pending.shift()?.();
  };
  return ws;
}

test('開房會產生不重複、好辨認的房號', () => {
  const rooms = registry();
  const codes = new Set();
  for (let i = 0; i < 50; i++) {
    const { session } = rooms.create();
    assert.equal(session.code.length, CODE_LENGTH);
    assert.doesNotMatch(session.code, /[01OIL]/);
    codes.add(session.code);
  }
  assert.equal(codes.size, 50);
});

test('房號不分大小寫，前後空白也沒關係', () => {
  const rooms = registry();
  const { session } = rooms.create();
  assert.equal(rooms.get(` ${session.code.toLowerCase()} `), session);
  assert.equal(rooms.get('ZZZZZ'), null);
});

test('房間數有上限', () => {
  const rooms = registry({ maxRooms: 2 });
  rooms.create();
  rooms.create();
  const { error } = rooms.create();
  assert.match(error, /借光/);
});

test('不同房間的狀態和廣播互不干擾', () => {
  const rooms = registry();
  const { session: a } = rooms.create();
  const { session: b } = rooms.create();
  const [a1, a2, b1] = [fakeSocket(), fakeSocket(), fakeSocket()];
  a.attach(a1, 'a1');
  a.attach(a2, 'a2');
  b.attach(b1, 'b1');
  assert.equal(a.handle(a1, { type: 'join', name: '甲' }), null);
  assert.equal(a.handle(a2, { type: 'join', name: '乙' }), null);
  assert.equal(b.handle(b1, { type: 'join', name: '丙' }), null);

  const before = b1.messages.length;
  assert.equal(a.handle(a1, { type: 'start' }), null);
  assert.equal(a2.last('state').state.phase, 'answering');
  assert.equal(b1.messages.length, before);
  assert.equal(b.room.phase, 'lobby');
});

test('進房時會收到房號和邀請連結', () => {
  const rooms = registry();
  const { session } = rooms.create();
  const ws = fakeSocket();
  session.attach(ws, 'x');
  const welcome = ws.last('welcome');
  assert.equal(welcome.code, session.code);
  assert.equal(welcome.joinUrl, `http://x/?room=${session.code}`);
  assert.equal(ws.last('state').state.you.joined, false);
});

test('未知的操作會回傳錯誤', () => {
  const rooms = registry();
  const { session } = rooms.create();
  const ws = fakeSocket();
  session.attach(ws, 'x');
  assert.match(session.handle(ws, { type: 'hack' }), /未知/);
});

test('有人離線會通知同房的人', () => {
  const rooms = registry();
  const { session } = rooms.create();
  const [s1, s2] = [fakeSocket(), fakeSocket()];
  session.attach(s1, 'p1');
  session.attach(s2, 'p2');
  session.handle(s1, { type: 'join', name: '甲' });
  session.handle(s2, { type: 'join', name: '乙' });

  session.detach(s1);
  assert.match(s2.last('notice').message, /甲 離席了，新主席是 乙/);
  assert.equal(rooms.get(session.code), session);
});

test('開房的人晚一步取暱稱，加入時還是主持人', () => {
  const rooms = registry();
  const { session } = rooms.create();
  const [owner, guest] = [fakeSocket(), fakeSocket()];
  session.attach(owner, 'owner', { owner: true });
  session.attach(guest, 'guest');
  assert.equal(owner.last('welcome').owner, true);
  assert.equal(guest.last('welcome').owner, false);

  assert.equal(session.handle(guest, { type: 'join', name: '先來的' }), null);
  assert.equal(session.room.hostId, 'guest');
  assert.equal(session.handle(owner, { type: 'join', name: '房主' }), null);
  assert.equal(session.room.hostId, 'owner');
});

// ---- 中途加入與房間回收 ----

/** 開一間房，第一個人取好暱稱加入。 */
function roomWithOne(rooms) {
  const { session } = rooms.create();
  const ws = fakeSocket();
  session.attach(ws, 'p1', { owner: true });
  assert.equal(session.handle(ws, { type: 'join', name: '甲' }), null);
  return { session, ws };
}

test('遊戲中加入的人列席，會通知同房的人', () => {
  const rooms = registry();
  const { session, ws: s1 } = roomWithOne(rooms);
  const [s2, s3] = [fakeSocket(), fakeSocket()];
  session.attach(s2, 'p2');
  session.handle(s2, { type: 'join', name: '乙' });
  session.handle(s1, { type: 'start' });

  session.attach(s3, 'p3');
  assert.equal(session.handle(s3, { type: 'join', name: '丙' }), null);
  assert.match(s1.last('notice').message, /丙.*列席/);
  assert.equal(s3.last('state').state.you.observer, true);
});

test('最後一人離開後，30 秒內用會議編號回來，還是同一間房', () => {
  const rooms = registry();
  const { session, ws } = roomWithOne(rooms);
  session.detach(ws);
  mock.timers.tick(EMPTY_ROOM_GRACE_MS - 1);
  assert.equal(rooms.get(session.code), session);

  session.attach(fakeSocket(), 'p2');
  mock.timers.tick(EMPTY_ROOM_GRACE_MS);
  assert.equal(rooms.get(session.code), session);
});

test('30 秒內沒有人回來，房間就收掉', () => {
  const rooms = registry();
  const { session, ws } = roomWithOne(rooms);
  session.detach(ws);
  mock.timers.tick(EMPTY_ROOM_GRACE_MS);
  assert.equal(rooms.get(session.code), null);
});

test('一個人在房間裡重新整理，可以回到同一間房', () => {
  const rooms = registry();
  const { session, ws: before } = roomWithOne(rooms);
  session.detach(before); // 重新整理：舊連線先斷
  const after = fakeSocket();
  rooms.get(session.code).attach(after, 'p1-new');
  assert.equal(session.handle(after, { type: 'join', name: '甲' }), null);
  const { you, phase } = after.last('state').state;
  assert.equal(phase, 'lobby');
  assert.equal(you.joined, true);
  assert.equal(you.isHost, true);
});

test('連續 10 分鐘沒有玩家或列席人員時，收掉房間，還連著的人收到提示', () => {
  const rooms = registry();
  const { session } = rooms.create();
  const ws = fakeSocket();
  session.attach(ws, 'x', { owner: true }); // 開了房但沒取暱稱
  mock.timers.tick(IDLE_ROOM_MS - 1);
  assert.equal(rooms.get(session.code), session);
  mock.timers.tick(1);
  assert.equal(rooms.get(session.code), null);
  assert.match(ws.last('closed').message, /閒置/);
  assert.equal(session.closed, true);
});

test('期間有人加入的話，10 分鐘的計時就取消', () => {
  const rooms = registry();
  const { session } = rooms.create();
  const [s1, s2] = [fakeSocket(), fakeSocket()];
  session.attach(s1, 'p1', { owner: true });
  session.attach(s2, 'p2');
  mock.timers.tick(IDLE_ROOM_MS - 1);
  session.handle(s1, { type: 'join', name: '甲' });
  mock.timers.tick(IDLE_ROOM_MS * 2);
  assert.equal(rooms.get(session.code), session);

  // 唯一的玩家離開，只剩沒取暱稱的連線：重新開始計時
  session.detach(s1);
  mock.timers.tick(IDLE_ROOM_MS);
  assert.equal(rooms.get(session.code), null);
  assert.match(s2.last('closed').message, /閒置/);
});

test('每間房最多 5 條還沒取暱稱的連線，超過的會被拒絕', () => {
  const rooms = registry();
  const { session } = rooms.create();
  const pending = Array.from({ length: MAX_PENDING_CONNECTIONS }, fakeSocket);
  pending.forEach((ws, i) => assert.equal(session.attach(ws, `p${i}`, { owner: i === 0 }), null));

  const extra = fakeSocket();
  assert.match(session.attach(extra, 'extra'), /無法/);
  assert.equal(session.clients.has(extra), false);
  assert.equal(extra.messages.length, 0, '被拒絕的連線不該收到房間的任何資訊');

  // 有人取好暱稱，就空出一個位置
  session.handle(pending[0], { type: 'join', name: '甲' });
  assert.equal(session.attach(extra, 'extra'), null);
});

test('列席人員離開時，只通知離席，不影響遊戲', () => {
  const rooms = registry();
  const { session, ws: s1 } = roomWithOne(rooms);
  const [s2, s3] = [fakeSocket(), fakeSocket()];
  session.attach(s2, 'p2');
  session.handle(s2, { type: 'join', name: '乙' });
  session.handle(s1, { type: 'start' });
  session.attach(s3, 'p3');
  session.handle(s3, { type: 'join', name: '丙' });

  session.detach(s3);
  assert.equal(s1.last('notice').message, '丙 離席了');
  assert.equal(session.room.phase, 'answering');
  assert.equal(session.room.players.size, 2);
});

test('回收時間照規格：空房 30 秒、沒人加入 10 分鐘', () => {
  // 測試裡其他地方都用常數，這裡把規格上的數字釘住，避免常數被改了也沒人發現
  assert.equal(EMPTY_ROOM_GRACE_MS, 30_000);
  assert.equal(IDLE_ROOM_MS, 10 * 60_000);
  assert.equal(MAX_PENDING_CONNECTIONS, 5);
});

test('網路慢的連線：上一份快照沒送完就不送新的，送完後只補送最新的一份', () => {
  const rooms = registry();
  const { session, ws: fast } = roomWithOne(rooms);
  const slow = slowSocket();
  session.attach(slow, 'p2');
  assert.equal(slow.count('state'), 1);

  // 這段期間有三次廣播，慢的連線一份都沒有多收
  session.handle(slow, { type: 'join', name: '乙' });
  session.handle(fast, { type: 'setTargetMatches', count: 5 });
  session.handle(fast, { type: 'setTargetMatches', count: 7 });
  assert.equal(slow.count('state'), 1);
  // 網路快的人不受影響
  assert.equal(fast.last('state').state.targetMatches, 7);

  // 送完之後補送一份，而且是最新的
  slow.flush();
  assert.equal(slow.count('state'), 2);
  const latest = slow.last('state').state;
  assert.equal(latest.targetMatches, 7);
  assert.equal(latest.you.joined, true);

  // 沒有新的變化，就不會再送
  slow.flush();
  assert.equal(slow.count('state'), 2);
  assert.equal(slow.pending.length, 0);
});

test('網路慢的連線照常收到通知', () => {
  const rooms = registry();
  const { session, ws: s1 } = roomWithOne(rooms);
  const slow = slowSocket();
  session.attach(slow, 'p2');
  session.handle(slow, { type: 'join', name: '乙' });
  const s3 = fakeSocket();
  session.attach(s3, 'p3');
  session.handle(s3, { type: 'join', name: '丙' });
  session.detach(s3);
  assert.equal(slow.last('notice').message, '丙 離席了');
  assert.equal(slow.count('state'), 1);
  assert.equal(s1.last('notice').message, '丙 離席了');
});

test('網路慢的連線離開或房間收掉後，送完也不會再補送', () => {
  const rooms = registry();
  const { session } = roomWithOne(rooms);
  const slow = slowSocket();
  session.attach(slow, 'p2');
  session.handle(slow, { type: 'join', name: '乙' });
  session.detach(slow);
  // 斷線時資料可能永遠送不完、callback 不會來，所以離開時就要清掉，不能等 callback
  assert.equal(session.sending.size + session.stale.size, 0, '離開的連線不能留在名單裡');
  slow.flush();
  assert.equal(slow.count('state'), 1);

  const other = registry();
  const { session: s2 } = roomWithOne(other);
  const slow2 = slowSocket();
  s2.attach(slow2, 'p2');
  s2.handle(slow2, { type: 'join', name: '乙' });
  s2.close('收掉了');
  assert.equal(s2.sending.size + s2.stale.size, 0);
  slow2.flush();
  assert.equal(slow2.count('state'), 1);
});
