import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, MAX_DRAWING_LENGTH } from '../src/game.js';

const QUESTIONS = Array.from({ length: 12 }, (_, i) => `題目 ${i + 1}`);

function setup(names = ['A', 'B', 'C'], random = () => 0) {
  const room = new Room({ questions: QUESTIONS, random });
  names.forEach((name) => assert.equal(room.join(name, name), null));
  return room;
}

const png = (data) => `data:image/png;base64,${data}`;

function answerAll(room, data = 'AAAA') {
  for (const id of room.players.keys()) assert.equal(room.answer(id, png(data)), null);
}

test('第一個加入的人是主持人', () => {
  const room = setup();
  assert.equal(room.hostId, 'A');
});

test('加入的限制：空白、人數上限、遊戲中', () => {
  const room = setup(['A']);
  assert.match(room.join('x', '  '), /暱稱/);
  for (const n of ['B', 'C', 'D', 'E', 'F']) assert.equal(room.join(n, n), null);
  assert.match(room.join('G', 'G'), /已滿/);

  const room2 = setup(['A', 'B']);
  room2.start('A');
  assert.match(room2.join('C', 'C'), /進行中/);
});

test('暱稱可以重複，玩家用 id 區分', () => {
  const room = new Room({ questions: QUESTIONS });
  assert.equal(room.join('id-1', '小明'), null);
  assert.equal(room.join('id-2', '小明'), null);
  assert.equal(room.players.size, 2);
  const view = room.viewFor('id-2');
  assert.equal(view.you.isHost, false);
  assert.deepEqual(view.players.map((p) => p.id), ['id-1', 'id-2']);
});

test('只有主持人能開始，且至少 2 人', () => {
  const solo = setup(['A']);
  assert.match(solo.start('A'), /至少/);
  const room = setup();
  assert.match(room.start('B'), /主持人/);
  assert.equal(room.start('A'), null);
  assert.equal(room.phase, 'answering');
  assert.equal(room.viewFor('B').question.number, 1);
});

test('目標一致次數只能由主持人在開局前設定，範圍 1 到 99', () => {
  const room = setup();
  assert.match(room.setTargetMatches('A', 0), /目標/);
  assert.match(room.setTargetMatches('A', 100), /目標/);
  assert.match(room.setTargetMatches('A', 2.5), /目標/);
  assert.equal(room.setTargetMatches('A', 99), null);
  assert.match(room.setTargetMatches('B', 2), /主持人/);
  assert.equal(room.setTargetMatches('A', 2), null);
  assert.equal(room.viewFor('B').targetMatches, 2);
  room.start('A');
  assert.match(room.setTargetMatches('A', 5), /開始後/);
});

test('公開前不會洩漏其他人的答案', () => {
  const room = setup();
  room.start('A');
  room.answer('B', png('SECRETB'));
  for (const viewer of ['A', 'B', 'C']) {
    const json = JSON.stringify(room.viewFor(viewer));
    if (viewer === 'B') assert.ok(json.includes('SECRETB'));
    else assert.ok(!json.includes('SECRETB'), `${viewer} 看到了 B 的答案`);
  }
});

test('還沒全員作答時不能公開；只有主持人能公開', () => {
  const room = setup();
  room.start('A');
  room.answer('A', png('AA'));
  room.answer('B', png('AA'));
  assert.match(room.reveal('A'), /沒送出/);
  room.answer('C', png('AA'));
  assert.match(room.reveal('B'), /主持人/);
  assert.equal(room.reveal('A'), null);
  assert.equal(room.phase, 'revealed');
  assert.equal(room.viewFor('B').revealed.length, 3);
});

test('送出答案後不能修改', () => {
  const room = setup();
  room.start('A');
  assert.equal(room.answer('B', png('OLD')), null);
  assert.match(room.answer('B', png('NEW')), /不能修改/);
  room.answer('A', png('AA'));
  room.answer('C', png('AA'));
  room.reveal('A');
  assert.equal(room.revealed.find((a) => a.name === 'B').image, png('OLD'));
});

test('答案必須是大小合理的 PNG data URL', () => {
  const room = setup();
  room.start('A');
  assert.match(room.answer('A', '文字答案'), /格式/);
  assert.match(room.answer('A', 'data:image/svg+xml;base64,AAAA'), /格式/);
  assert.match(room.answer('A', 'data:image/png;base64,<script>'), /格式/);
  assert.match(room.answer('A', { image: 'x' }), /格式/);
  assert.match(room.answer('A', png('A'.repeat(MAX_DRAWING_LENGTH))), /太大/);
  assert.equal(room.answer('A', png('iVBORw0KGgo=')), null);
});

function playRound(room, match) {
  answerAll(room);
  assert.equal(room.reveal('A'), null);
  assert.equal(room.judge('A', match), null);
  assert.equal(room.phase, 'judged');
  assert.equal(room.next('A'), null);
}

test('完整一局：達到目標一致次數才結算，之後回大廳', () => {
  const room = setup();
  room.setTargetMatches('A', 2);
  room.start('A');
  answerAll(room);
  room.reveal('A');
  assert.match(room.judge('B', true), /主持人/);
  room.judge('A', false);
  room.next('A');
  playRound(room, true);
  playRound(room, false);
  assert.deepEqual(room.viewFor('B').tally, { match: 1, miss: 2 });
  assert.equal(room.phase, 'answering');
  playRound(room, true);
  assert.equal(room.phase, 'finished');
  const view = room.viewFor('B');
  assert.equal(view.targetReached, true);
  assert.deepEqual(view.tally, { match: 2, miss: 2 });
  assert.equal(view.rounds, 4);
  assert.equal(room.backToLobby('A'), null);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.players.size, 3);
});

test('一直沒一致就無限出題，題庫用完會重新洗牌且不連續重複', () => {
  const room = new Room({ questions: ['Q1', 'Q2', 'Q3'], random: Math.random });
  room.join('A', 'A');
  room.join('B', 'B');
  room.start('A');
  let prev = room.question;
  const seen = new Set([prev]);
  for (let i = 0; i < 30; i++) {
    playRound(room, false);
    assert.equal(room.phase, 'answering');
    assert.notEqual(room.question, prev);
    prev = room.question;
    seen.add(prev);
  }
  assert.equal(room.viewFor('A').question.number, 31);
  assert.equal(seen.size, 3);
});

test('作答中的狀態快照不含題目總數，revealed 時有統計', () => {
  const room = setup();
  room.start('A');
  answerAll(room);
  room.reveal('A');
  const view = room.viewFor('B');
  assert.equal(view.question.total, undefined);
  assert.deepEqual(view.tally, { match: 0, miss: 0 });
});

test('主持人斷線時隨機挑一位在線玩家接手', () => {
  const room = setup(['A', 'B', 'C'], () => 0.99);
  room.start('A');
  const newHost = room.leave('A');
  assert.equal(newHost, 'C');
  assert.equal(room.hostId, 'C');
  assert.equal(room.phase, 'answering');
});

test('玩家斷線後，作答進度只算在線的人', () => {
  const room = setup();
  room.start('A');
  room.answer('A', png('AA'));
  room.answer('B', png('AA'));
  assert.equal(room.leave('C'), null);
  assert.equal(room.viewFor('A').allAnswered, true);
  assert.equal(room.reveal('A'), null);
});

test('遊戲中只剩 1 人時直接結算', () => {
  const room = setup(['A', 'B']);
  room.start('A');
  room.leave('B');
  assert.equal(room.phase, 'finished');
});

test('所有人都離開時房間重置', () => {
  const room = setup(['A', 'B']);
  room.start('A');
  room.leave('A');
  room.leave('B');
  assert.equal(room.phase, 'lobby');
  assert.equal(room.hostId, null);
});
