// 開發用的調整面板：在預覽總覽頁即時調整 style.css 裡 :root 的變數。
// 面板把改動存進 localStorage，各個預覽畫面（iframe 或另開的分頁）收到 storage 事件就同步套用。
// 只在預覽模式作用，不影響真正的遊戲。

const STORAGE_KEY = 'tweak-vars';

const LABELS = {
  '--color-bg': '背景',
  '--color-surface': '卡片',
  '--color-text': '文字',
  '--color-muted': '說明文字',
  '--color-border': '卡片邊框',
  '--color-primary': '主色（按鈕）',
  '--color-primary-text': '主色上的文字',
  '--color-match': '「達成共識！」',
  '--color-error': '錯誤',
  '--color-done': '已作答',
  '--color-board': '白板底色',
  '--color-frame': '白板外框',
  '--color-board-hint': '白板鉛筆提示',
  '--frame-width': '外框粗細',
  '--color-input-bg': '輸入框底色',
  '--color-input-text': '輸入框文字',
  '--color-input-placeholder': '輸入框提示字',
  '--font-family': '字型',
  '--font-size-base': '基本字級',
  '--font-size-question': '題目字級',
  '--font-size-result': '判定結果字級',
  '--font-size-title': '首頁標題字級',
  '--font-size-connecting': '「連線中…」字級',
  '--font-size-room-code': '會議編號字級',
  '--font-size-small-btn': '複製按鈕字級',
  '--space-1': '間距 1',
  '--space-2': '間距 2',
  '--space-3': '間距 3',
  '--space-4': '間距 4',
  '--radius': '圓角',
  '--max-width': '內容最大寬度',
  '--bottom-bleed': '底部留白',
};

const GROUPS = [
  { title: '顏色與外框', test: (name) => name.startsWith('--color-') || name === '--frame-width' },
  { title: '字', test: (name) => name.startsWith('--font-') },
  { title: '間距與尺寸', test: () => true },
];

export function loadTweaks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveTweaks(tweaks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tweaks));
  } catch {}
}

let appliedNames = [];

function applyTweaks(tweaks) {
  const root = document.documentElement;
  for (const name of appliedNames) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(tweaks)) root.style.setProperty(name, value);
  appliedNames = Object.keys(tweaks);
}

/** 預覽畫面呼叫：套用目前的改動，之後面板一有變動就跟著更新。 */
export function watchTweaks() {
  applyTweaks(loadTweaks());
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY || e.key === null) applyTweaks(loadTweaks());
  });
}

/** 從 style.css 讀出原本的變數值：第一個 :root 是淺色模式，第二個在 prefers-color-scheme: dark 裡。 */
async function readBaseVars() {
  const res = await fetch('/style.css', { cache: 'no-cache' });
  const css = (await res.text()).replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const parse = (body = '') =>
    Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  return { light: parse(blocks[0]), dark: parse(blocks[1]) };
}

function kindOf(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return { type: 'color' };
  const length = value.match(/^(-?[\d.]+)(px|rem)$/);
  if (length) return { type: 'length', unit: length[2] };
  return { type: 'text' };
}

function rangeFor(name, value, unit) {
  const n = parseFloat(value);
  if (unit === 'rem') return { min: 0.5, max: Math.max(4, n * 2), step: 0.05 };
  if (name.startsWith('--font-size')) return { min: 10, max: 40, step: 1 };
  if (name === '--max-width') return { min: 320, max: 1400, step: 10 };
  return { min: 0, max: Math.max(64, Math.ceil(n * 2)), step: 1 };
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** 總覽頁呼叫：建立調整面板。 */
export async function initTweakPanel() {
  const { light, dark } = await readBaseVars();
  const darkMode = matchMedia('(prefers-color-scheme: dark)');
  const base = () => (darkMode.matches ? { ...light, ...dark } : light);
  let tweaks = loadTweaks();
  // style.css 拿掉的變數就不要留著
  for (const name of Object.keys(tweaks)) if (!(name in light)) delete tweaks[name];

  const rows = new Map(); // name -> { setValue(value), resetBtn }
  const output = el('pre', { className: 'tweak-output' });
  const copyBtn = el('button', { type: 'button', textContent: '複製改動' });
  const resetAllBtn = el('button', { type: 'button', textContent: '全部重設' });
  const toggleBtn = document.getElementById('tweak-toggle');

  function update(name, value) {
    if (value === base()[name]) delete tweaks[name];
    else tweaks[name] = value;
    saveTweaks(tweaks);
    refresh();
  }

  function refresh() {
    for (const [name, row] of rows) {
      row.setValue(tweaks[name] ?? base()[name]);
      row.resetBtn.hidden = !(name in tweaks);
    }
    const changed = Object.entries(tweaks);
    const mode = darkMode.matches ? '深色模式' : '淺色模式';
    output.textContent = changed.length
      ? `/* 調整面板的改動（${mode}） */\n:root {\n${changed
          .map(([name, value]) => `  ${name}: ${value}; /* 原本 ${base()[name]} */`)
          .join('\n')}\n}`
      : '還沒有改動';
    copyBtn.disabled = changed.length === 0;
    resetAllBtn.disabled = changed.length === 0;
    if (toggleBtn) toggleBtn.textContent = changed.length ? `調整面板（${changed.length}）` : '調整面板';
  }

  function makeRow(name) {
    const kind = kindOf(base()[name]);
    const label = el('label', { className: 'tweak-label', title: name }, [
      LABELS[name] ?? name,
      el('code', { textContent: name }),
    ]);
    const resetBtn = el('button', { type: 'button', className: 'tweak-reset', textContent: '↺', title: '還原' });
    resetBtn.addEventListener('click', () => update(name, base()[name]));
    let controls;
    let setValue;

    if (kind.type === 'color') {
      const picker = el('input', { type: 'color' });
      const text = el('input', { type: 'text', className: 'tweak-hex', spellcheck: false });
      picker.addEventListener('input', () => update(name, picker.value));
      text.addEventListener('change', () => {
        const v = text.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(v)) update(name, v.toLowerCase());
        else refresh();
      });
      controls = [picker, text];
      setValue = (v) => {
        picker.value = v;
        if (document.activeElement !== text) text.value = v;
      };
    } else if (kind.type === 'length') {
      const range = el('input', { type: 'range', ...rangeFor(name, base()[name], kind.unit) });
      const number = el('input', { type: 'number', className: 'tweak-number', step: range.step });
      const unit = el('span', { className: 'tweak-unit', textContent: kind.unit });
      range.addEventListener('input', () => update(name, `${range.value}${kind.unit}`));
      number.addEventListener('input', () => {
        if (number.value !== '') update(name, `${Number(number.value)}${kind.unit}`);
      });
      controls = [range, number, unit];
      setValue = (v) => {
        const n = parseFloat(v);
        range.value = n;
        if (document.activeElement !== number) number.value = n;
      };
    } else {
      const text = el('input', { type: 'text', className: 'tweak-text', spellcheck: false });
      text.addEventListener('change', () => update(name, text.value.trim() || base()[name]));
      controls = [text];
      setValue = (v) => {
        if (document.activeElement !== text) text.value = v;
      };
    }

    rows.set(name, { setValue, resetBtn });
    return el('div', { className: `tweak-row is-${kind.type}` }, [
      label,
      el('div', { className: 'tweak-controls' }, [...controls, resetBtn]),
    ]);
  }

  const names = Object.keys(light);
  const used = new Set();
  const sections = GROUPS.map((group) => {
    const groupNames = names.filter((name) => !used.has(name) && group.test(name));
    groupNames.forEach((name) => used.add(name));
    return el('section', {}, [el('h2', { textContent: group.title }), ...groupNames.map(makeRow)]);
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.textContent);
      copyBtn.textContent = '已複製';
    } catch {
      copyBtn.textContent = '複製失敗，請手動選取';
    }
    setTimeout(() => (copyBtn.textContent = '複製改動'), 1500);
  });
  resetAllBtn.addEventListener('click', () => {
    tweaks = {};
    saveTweaks(tweaks);
    refresh();
  });

  const panel = el('aside', { className: 'tweak-panel', id: 'tweak-panel' }, [
    el('div', { className: 'tweak-head' }, [
      el('strong', { textContent: '調整面板' }),
      el('div', { className: 'tweak-actions' }, [copyBtn, resetAllBtn]),
    ]),
    el('p', {
      className: 'hint',
      textContent: '改動會即時套用到所有預覽畫面（包括另開的分頁），重新整理也會保留。調到滿意後按「複製改動」貼給 Claude 寫回 style.css。',
    }),
    output,
    ...sections,
  ]);
  document.body.append(panel);

  // 面板開關，記住上次的狀態
  const setOpen = (open) => {
    panel.hidden = !open;
    document.body.classList.toggle('has-tweak-panel', open);
    try {
      localStorage.setItem('tweak-panel-open', open ? '1' : '0');
    } catch {}
  };
  let open = false;
  try {
    open = localStorage.getItem('tweak-panel-open') === '1';
  } catch {}
  setOpen(open);
  toggleBtn?.addEventListener('click', () => setOpen(panel.hidden));

  darkMode.addEventListener('change', refresh);
  // 另一個總覽頁（手機版／電腦版）改了，這裡也同步
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    tweaks = loadTweaks();
    refresh();
  });
  refresh();
}
