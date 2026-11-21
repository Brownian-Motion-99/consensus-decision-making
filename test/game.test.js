import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, MAX_DRAWING_LENGTH, MAX_NAME_LENGTH } from '../src/game.js';

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

test('加入的限制：空白、人數上限', () => {
  const room = setup(['A']);
  assert.match(room.join('x', '  '), /暱稱/);
  for (const n of ['B', 'C', 'D', 'E', 'F', 'G', 'H']) assert.equal(room.join(n, n), null);
  assert.match(room.join('I', 'I'), /已滿/);
});

test('暱稱最多 100 個字，以 code point 計算', () => {
  assert.equal(MAX_NAME_LENGTH, 100);
  const room = new Room({ questions: QUESTIONS });
  assert.equal(room.join('a', '字'.repeat(100)), null);
  assert.match(room.join('b', '字'.repeat(101)), /最多 100 個字/);
  // emoji 在 JS 字串裡佔 2 個長度，但只算 1 個字
  assert.equal(room.join('c', '😀'.repeat(100)), null);
  assert.match(room.join('d', '😀'.repeat(101)), /最多 100 個字/);
  // 前後空白不算
  assert.equal(room.join('e', ` ${'字'.repeat(100)} `), null);
});

test('只有看不見字元的暱稱，換成「匿名＋動物」', () => {
  const invisible = ['\u200b', '\u200b\u200d\ufeff', '\u3164', '\u2800', '\u00ad', ' \u200b '];
  for (const raw of invisible) {
    const room = new Room({ questions: QUESTIONS, random: () => 0 });
    assert.equal(room.join('a', raw), null, JSON.stringify(raw));
    assert.equal(room.players.get('a').name, '匿名水豚', JSON.stringify(raw));
  }
  const room = new Room({ questions: QUESTIONS, random: () => 0.999 });
  room.join('a', '\u200b');
  assert.equal(room.players.get('a').name, '匿名帝雉');
});

test('看得見的暱稱不會被換掉，空白暱稱照樣拒絕', () => {
  const room = new Room({ questions: QUESTIONS });
  assert.equal(room.join('a', '小明\u200b'), null);
  assert.equal(room.players.get('a').name, '小明\u200b');
  assert.match(room.join('b', '\u3000'), /請輸入暱稱/);
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
  assert.match(room.start('B'), /主席/);
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
  assert.match(room.setTargetMatches('B', 2), /主席/);
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
  assert.match(room.reveal('B'), /主席/);
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
  assert.match(room.judge('B', true), /主席/);
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


test('所有人都離開時房間重置', () => {
  const room = setup(['A', 'B']);
  room.start('A');
  room.leave('A');
  room.leave('B');
  assert.equal(room.phase, 'lobby');
  assert.equal(room.hostId, null);
});

// ---- 中途加入與休會 ----

/** 公開並判定目前這題，但不進到下一題。 */
function judgeRound(room, match) {
  answerAll(room);
  assert.equal(room.reveal('A'), null);
  assert.equal(room.judge('A', match), null);
}

test('大廳、休會中、結算時加入的人，直接成為玩家', () => {
  const lobby = setup(['A']);
  assert.equal(lobby.join('B', 'B'), null);
  assert.equal(lobby.players.has('B'), true);

  const paused = setup(['A', 'B']);
  paused.start('A');
  paused.leave('B');
  assert.equal(paused.phase, 'paused');
  assert.equal(paused.join('C', 'C'), null);
  assert.equal(paused.players.has('C'), true);

  const finished = setup(['A', 'B']);
  finished.setTargetMatches('A', 1);
  finished.start('A');
  playRound(finished, true);
  assert.equal(finished.phase, 'finished');
  assert.equal(finished.join('C', 'C'), null);
  assert.equal(finished.players.has('C'), true);
});

test('作答中、已公開、已判定時加入的人，成為列席人員', () => {
  for (const phase of ['answering', 'revealed', 'judged']) {
    const room = setup(['A', 'B']);
    room.start('A');
    if (phase !== 'answering') {
      answerAll(room);
      room.reveal('A');
    }
    if (phase === 'judged') room.judge('A', false);
    assert.equal(room.phase, phase);
    assert.equal(room.join('C', 'C'), null);
    assert.equal(room.players.has('C'), false, `${phase} 時加入成了玩家`);
    const { you } = room.viewFor('C');
    assert.equal(you.joined, true);
    assert.equal(you.observer, true);
  }
});

test('列席人員收到的狀態不含題目和任何答案', () => {
  const room = setup(['A', 'B']);
  room.start('A');
  room.join('C', 'C');
  room.answer('A', png('SECRETA'));
  room.answer('B', png('SECRETB'));
  room.reveal('A');
  const json = JSON.stringify(room.viewFor('C'));
  assert.ok(!json.includes('SECRET'), '列席人員看到了答案');
  assert.ok(!json.includes(room.question), '列席人員看到了題目');
});

test('列席人員不算在「全員已作答」裡，也不能作答', () => {
  const room = setup(['A', 'B']);
  room.start('A');
  room.join('C', 'C');
  assert.match(room.answer('C', png('CC')), /列席/);
  answerAll(room);
  assert.equal(room.viewFor('A').allAnswered, true);
  assert.equal(room.reveal('A'), null);
});

test('下一題開始時，列席人員轉為玩家', () => {
  const room = setup(['A', 'B']);
  room.start('A');
  room.join('C', 'C');
  playRound(room, false);
  assert.equal(room.phase, 'answering');
  assert.equal(room.players.has('C'), true);
  assert.equal(room.viewFor('C').you.observer, false);
  room.answer('A', png('AA'));
  room.answer('B', png('BB'));
  assert.match(room.reveal('A'), /沒送出/);
});

test('玩家加上列席人員最多 8 人', () => {
  const room = setup(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  room.start('A');
  assert.equal(room.join('H', 'H'), null);
  assert.match(room.join('I', 'I'), /已滿/);
  room.leave('H');
  assert.equal(room.join('I', 'I'), null);
});

test('主持人離開時，只從玩家中挑新主持人', () => {
  // 亂數固定取最後一位：列席人員如果也在候選名單裡，就會挑到 D
  const room = setup(['A', 'B', 'C'], () => 0.99);
  room.start('A');
  room.join('D', 'D');
  assert.equal(room.leave('A'), 'C');
});

test('遊戲中玩家少於 2 人時進入休會，保留目標、已判定的結果和題號', () => {
  const room = setup(['A', 'B']);
  room.setTargetMatches('A', 3);
  room.start('A');
  playRound(room, true);
  judgeRound(room, false);
  room.leave('B');
  assert.equal(room.phase, 'paused');
  const view = room.viewFor('A');
  assert.equal(view.targetMatches, 3);
  assert.deepEqual(view.tally, { match: 1, miss: 1 });

  room.join('C', 'C');
  assert.equal(room.resume('A'), null);
  assert.equal(room.viewFor('A').question.number, 3);
});

test('休會時，還沒判定的那一題不算進統計', () => {
  const room = setup(['A', 'B']);
  room.start('A');
  playRound(room, false);
  answerAll(room);
  room.reveal('A');
  room.leave('B');
  assert.deepEqual(room.viewFor('A').tally, { match: 0, miss: 1 });

  room.join('C', 'C');
  room.resume('A');
  const view = room.viewFor('A');
  assert.equal(view.rounds, 1);
  assert.equal(view.question.number, 2, '作廢的那一題不佔題號');
});

test('進入休會時，列席人員轉為玩家', () => {
  const room = setup(['A', 'B']);
  room.start('A');
  room.join('C', 'C');
  room.leave('B');
  assert.equal(room.phase, 'paused');
  assert.equal(room.players.has('C'), true);
  assert.equal(room.viewFor('C').you.observer, false);
});

test('玩家不到 2 人時不能繼續會議，而且只有主持人能繼續', () => {
  const room = setup(['A', 'B']);
  room.start('A');
  room.leave('B');
  assert.match(room.resume('A'), /至少/);
  room.join('C', 'C');
  assert.match(room.resume('C'), /主席/);
  assert.equal(room.resume('A'), null);
  assert.equal(room.phase, 'answering');
  assert.match(room.resume('A'), /休會/);
});

test('繼續會議時，已達目標就進入結算，否則出下一題', () => {
  const reached = setup(['A', 'B']);
  reached.setTargetMatches('A', 1);
  reached.start('A');
  judgeRound(reached, true);
  reached.leave('B');
  reached.join('C', 'C');
  assert.equal(reached.resume('A'), null);
  assert.equal(reached.phase, 'finished');

  const notYet = setup(['A', 'B']);
  notYet.setTargetMatches('A', 2);
  notYet.start('A');
  judgeRound(notYet, true);
  notYet.leave('B');
  notYet.join('C', 'C');
  assert.equal(notYet.resume('A'), null);
  assert.equal(notYet.phase, 'answering');
});

test('休會中所有玩家都離開時，重置回大廳', () => {
  const room = setup(['A', 'B']);
  room.start('A');
  room.leave('B');
  assert.equal(room.phase, 'paused');
  room.leave('A');
  assert.equal(room.phase, 'lobby');
  assert.equal(room.hostId, null);
});

test('還沒取暱稱的連線收不到題目和任何答案', () => {
  const room = setup(['A', 'B']);
  room.start('A');
  room.answer('A', png('SECRETA'));
  room.answer('B', png('SECRETB'));
  room.reveal('A');
  const json = JSON.stringify(room.viewFor('stranger'));
  assert.ok(!json.includes('SECRET'), '還沒取暱稱的連線看到了答案');
  assert.ok(!json.includes(room.question), '還沒取暱稱的連線看到了題目');
});

test('開房的人只有在大廳加入時才拿回主持人', () => {
  for (const phase of ['paused', 'finished']) {
    const room = setup(['B', 'C']);
    room.setTargetMatches('B', 1);
    room.start('B');
    if (phase === 'paused') room.leave('C');
    else {
      for (const id of ['B', 'C']) room.answer(id, png('AA'));
      room.reveal('B');
      room.judge('B', true);
      room.next('B');
    }
    assert.equal(room.phase, phase);
    assert.equal(room.join('A', 'A', { asHost: true }), null);
    assert.equal(room.hostId, 'B', `${phase} 時開房的人搶走了主持人`);
  }
});

test('結算或回到大廳時，列席人員轉為玩家', () => {
  const finished = setup(['A', 'B']);
  finished.setTargetMatches('A', 1);
  finished.start('A');
  finished.join('C', 'C');
  playRound(finished, true);
  assert.equal(finished.phase, 'finished');
  assert.equal(finished.players.has('C'), true);

  // 回到大廳的那條路：所有玩家都離開時重置
  const reset = setup(['A', 'B']);
  reset.start('A');
  reset.observers.set('C', { id: 'C', name: 'C' }); // 直接塞一位列席人員，模擬重置當下還有人列席
  reset.resetGame();
  assert.equal(reset.players.has('C'), true);
  assert.equal(reset.observers.size, 0);
});

test('休會時清空答案，繼續後大家重新作答', () => {
  const room = setup(['A', 'B', 'C']);
  room.start('A');
  room.answer('A', png('OLD'));
  room.leave('B');
  room.leave('C');
  assert.equal(room.phase, 'paused');
  assert.equal(room.viewFor('A').you.answer, null, '休會時還留著作廢那一題的答案');
  room.join('D', 'D');
  room.resume('A');
  assert.equal(room.viewFor('A').you.answer, null);
  assert.equal(room.answer('A', png('NEW')), null);
});
