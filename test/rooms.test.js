import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry, CODE_LENGTH } from '../src/rooms.js';

const QUESTIONS = Array.from({ length: 12 }, (_, i) => `題目 ${i + 1}`);

function registry(opts = {}) {
  return new RoomRegistry({
    questions: QUESTIONS,
    joinUrlFor: (code) => `http://x/?room=${code}`,
    ...opts,
  });
}

/** 假的連線：只記錄收到的訊息。 */
function fakeSocket() {
  return {
    OPEN: 1,
    readyState: 1,
    messages: [],
    send(raw) {
      this.messages.push(JSON.parse(raw));
    },
    last(type) {
      return this.messages.findLast((m) => m.type === type);
    },
  };
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
  assert.match(error, /上限/);
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

test('有人離線會通知同房的人，最後一人離開就收掉房間', () => {
  const rooms = registry();
  const { session } = rooms.create();
  const [s1, s2] = [fakeSocket(), fakeSocket()];
  session.attach(s1, 'p1');
  session.attach(s2, 'p2');
  session.handle(s1, { type: 'join', name: '甲' });
  session.handle(s2, { type: 'join', name: '乙' });

  session.detach(s1);
  rooms.release(session);
  assert.match(s2.last('notice').message, /甲 離線了，新主持人是 乙/);
  assert.equal(rooms.get(session.code), session);

  session.detach(s2);
  rooms.release(session);
  assert.equal(rooms.get(session.code), null);
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
