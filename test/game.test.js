import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/game.js';

const QUESTIONS = Array.from({ length: 12 }, (_, i) => `題目 ${i + 1}`);

function setup(names = ['A', 'B', 'C'], random = () => 0) {
  const room = new Room({ questions: QUESTIONS, random });
  names.forEach((name) => assert.equal(room.join(name, name), null));
  return room;
}

function answerAll(room, text = '蘋果') {
  for (const id of room.players.keys()) assert.equal(room.answer(id, text), null);
}

test('第一個加入的人是主持人', () => {
  const room = setup();
  assert.equal(room.hostId, 'A');
});

test('加入的限制：暱稱重複、空白、人數上限、遊戲中', () => {
  const room = setup(['A']);
  assert.match(room.join('x', 'A'), /暱稱/);
  assert.match(room.join('x', '  '), /暱稱/);
  for (const n of ['B', 'C', 'D', 'E', 'F']) assert.equal(room.join(n, n), null);
  assert.match(room.join('G', 'G'), /已滿/);

  const room2 = setup(['A', 'B']);
  room2.start('A');
  assert.match(room2.join('C', 'C'), /進行中/);
});

test('只有主持人能開始，且至少 2 人', () => {
  const solo = setup(['A']);
  assert.match(solo.start('A'), /至少/);
  const room = setup();
  assert.match(room.start('B'), /主持人/);
  assert.equal(room.start('A'), null);
  assert.equal(room.phase, 'answering');
  assert.equal(room.questions.length, 8);
});

test('題數只能在 6 到 10 之間', () => {
  const room = setup();
  assert.match(room.setQuestionCount('A', 5), /題數/);
  assert.match(room.setQuestionCount('A', 11), /題數/);
  assert.match(room.setQuestionCount('B', 6), /主持人/);
  assert.equal(room.setQuestionCount('A', 6), null);
  room.start('A');
  assert.equal(room.questions.length, 6);
});

test('公開前不會洩漏其他人的答案', () => {
  const room = setup();
  room.start('A');
  room.answer('B', '秘密答案');
  for (const viewer of ['A', 'B', 'C']) {
    const json = JSON.stringify(room.viewFor(viewer));
    if (viewer === 'B') assert.ok(json.includes('秘密答案'));
    else assert.ok(!json.includes('秘密答案'), `${viewer} 看到了 B 的答案`);
  }
});

test('還沒全員作答時不能公開；只有主持人能公開', () => {
  const room = setup();
  room.start('A');
  room.answer('A', 'x');
  room.answer('B', 'x');
  assert.match(room.reveal('A'), /沒送出/);
  room.answer('C', 'x');
  assert.match(room.reveal('B'), /主持人/);
  assert.equal(room.reveal('A'), null);
  assert.equal(room.phase, 'revealed');
  assert.equal(room.viewFor('B').revealed.length, 3);
});

test('公開前可以改答案，公開後不行', () => {
  const room = setup();
  room.start('A');
  answerAll(room, '舊');
  room.answer('B', '新');
  room.reveal('A');
  assert.deepEqual(room.revealed.find((a) => a.name === 'B').text, '新');
  assert.match(room.answer('B', '更新'), /不能作答/);
});

test('完整一局：判定、下一題、結算、回大廳', () => {
  const room = setup();
  room.setQuestionCount('A', 6);
  room.start('A');
  for (let i = 0; i < 6; i++) {
    answerAll(room);
    assert.equal(room.reveal('A'), null);
    assert.match(room.judge('B', true), /主持人/);
    assert.equal(room.judge('A', i % 2 === 0), null);
    assert.equal(room.phase, 'judged');
    assert.equal(room.next('A'), null);
  }
  assert.equal(room.phase, 'finished');
  const view = room.viewFor('B');
  assert.equal(view.score, 3);
  assert.equal(view.history.length, 6);
  assert.equal(room.backToLobby('A'), null);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.players.size, 3);
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
  room.answer('A', 'x');
  room.answer('B', 'x');
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
