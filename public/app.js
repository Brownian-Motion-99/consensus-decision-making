// 前端只負責顯示 server 傳來的狀態，並把操作送回去。
// 所有使用者輸入的文字都用 textContent 放進畫面，不用 innerHTML。

const $ = (id) => document.getElementById(id);

let ws;
let state = null;
let lastQuestionNumber = null;
let noticeTimer = null;

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'welcome') {
      $('qr').src = msg.qrDataUrl;
      $('join-url').textContent = msg.joinUrl;
    } else if (msg.type === 'state') {
      state = msg.state;
      render();
    } else if (msg.type === 'error' || msg.type === 'notice') {
      showNotice(msg.message, msg.type === 'error');
    }
  });

  ws.addEventListener('close', () => showScreen('disconnected'));
}

function sendAction(type, payload = {}) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}

// ---- 畫面工具 ----

function showScreen(name) {
  for (const el of document.querySelectorAll('[data-screen]')) {
    el.hidden = el.dataset.screen !== name;
  }
}

function showNotice(message, isError) {
  const el = $('notice');
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (el.hidden = true), 4000);
}

function renderPlayers(listEl, players, { showAnswered = false } = {}) {
  listEl.replaceChildren(
    ...players.map((p) => {
      const li = document.createElement('li');
      li.textContent = p.name;
      if (p.id === state.you.id) li.classList.add('is-me');
      if (p.isHost) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '主持人';
        li.append(badge);
      }
      if (showAnswered) {
        const mark = document.createElement('span');
        mark.className = p.answered ? 'mark is-done' : 'mark';
        mark.textContent = p.answered ? '已作答' : '思考中';
        li.append(mark);
      }
      return li;
    }),
  );
}

function renderAnswers(listEl, answers) {
  listEl.replaceChildren(
    ...answers.map((a) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'answer-name';
      name.textContent = a.name;
      const text = document.createElement('span');
      text.className = 'answer-text';
      text.textContent = a.text;
      li.append(name, text);
      return li;
    }),
  );
}

function progressText(q) {
  return `第 ${q.number} / ${q.total} 題`;
}

// ---- 各畫面 ----

function render() {
  const { phase, you, players } = state;
  document.body.classList.toggle('is-host', you.isHost);

  const me = players.find((p) => p.id === you.id);
  $('me').hidden = !me;
  $('me').textContent = me ? (you.isHost ? `${me.name}（主持人）` : me.name) : '';

  if (!you.joined) {
    if (phase === 'lobby') {
      $('name-input').maxLength = state.limits.maxNameLength;
      showScreen('join');
    } else {
      showScreen('locked');
    }
    return;
  }

  if (phase === 'lobby') renderLobby();
  else if (phase === 'answering') renderAnswering();
  else if (phase === 'revealed' || phase === 'judged') renderRevealed();
  else if (phase === 'finished') renderFinished();
}

function renderLobby() {
  const { players, limits, questionCount } = state;
  $('lobby-count').textContent = `${players.length} / ${limits.maxPlayers}`;
  renderPlayers($('lobby-players'), players);

  const select = $('question-count');
  if (select.options.length === 0) {
    for (let n = limits.minQuestions; n <= limits.maxQuestions; n++) {
      select.append(new Option(`${n} 題`, String(n)));
    }
  }
  select.value = String(questionCount);

  const enough = players.length >= limits.minPlayers;
  $('start-btn').disabled = !enough;
  $('start-btn').textContent = enough ? '開始遊戲' : `至少需要 ${limits.minPlayers} 人`;
  lastQuestionNumber = null;
  showScreen('lobby');
}

function renderAnswering() {
  const { question, players, you, allAnswered, limits } = state;

  // 換題時清空輸入框；同一題內收到狀態更新時不要動到正在打字的內容
  if (question.number !== lastQuestionNumber) {
    lastQuestionNumber = question.number;
    $('answer-input').value = '';
  }
  $('answer-input').maxLength = limits.maxAnswerLength;

  $('answer-progress').textContent = progressText(question);
  $('answer-question').textContent = question.text;
  $('answer-btn').textContent = you.answer ? '更新答案' : '送出答案';
  $('my-answer').textContent = you.answer ? `你的答案：${you.answer}（公開前都可以修改）` : '';

  const done = players.filter((p) => p.answered).length;
  $('answered-count').textContent = `${done} / ${players.length}`;
  renderPlayers($('answer-players'), players, { showAnswered: true });

  $('reveal-btn').disabled = !allAnswered;
  $('reveal-btn').textContent = allAnswered ? '公開答案' : '等待所有人作答…';
  showScreen('answering');
}

function renderRevealed() {
  const { phase, question, revealed, lastMatch } = state;
  $('reveal-progress').textContent = progressText(question);
  $('reveal-question').textContent = question.text;
  renderAnswers($('reveal-answers'), revealed);

  const judged = phase === 'judged';
  const result = $('result');
  result.hidden = !judged;
  if (judged) {
    result.textContent = lastMatch ? '一致！' : '沒有一致…';
    result.classList.toggle('is-match', lastMatch);
  }

  $('judge-buttons').hidden = judged;
  $('next-btn').hidden = !judged;
  $('next-btn').textContent = question.number >= question.total ? '看結算' : '下一題';
  $('reveal-wait').textContent = judged ? '等待主持人進到下一題…' : '等待主持人判定…';
  showScreen('revealed');
}

function renderFinished() {
  const { history, score } = state;
  $('score').textContent = `一致 ${score} / ${history.length} 題`;
  $('history').replaceChildren(
    ...history.map((h) => {
      const li = document.createElement('li');
      li.className = h.match ? 'is-match' : '';
      const title = document.createElement('div');
      title.className = 'history-question';
      title.textContent = `${h.match ? '一致' : '不一致'}｜${h.question}`;
      const answers = document.createElement('ul');
      answers.className = 'answers is-compact';
      renderAnswers(answers, h.answers);
      li.append(title, answers);
      return li;
    }),
  );
  showScreen('finished');
}

// ---- 事件 ----

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  sendAction('join', { name: $('name-input').value });
});

$('question-count').addEventListener('change', (e) => {
  sendAction('setQuestionCount', { count: Number(e.target.value) });
});

$('start-btn').addEventListener('click', () => sendAction('start'));

$('answer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  sendAction('answer', { text: $('answer-input').value });
});

$('reveal-btn').addEventListener('click', () => sendAction('reveal'));
$('match-btn').addEventListener('click', () => sendAction('judge', { match: true }));
$('nomatch-btn').addEventListener('click', () => sendAction('judge', { match: false }));
$('next-btn').addEventListener('click', () => sendAction('next'));
$('lobby-btn').addEventListener('click', () => sendAction('backToLobby'));
$('reload-btn').addEventListener('click', () => location.reload());

connect();
