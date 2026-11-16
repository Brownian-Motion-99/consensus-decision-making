// 手寫白板：固定解析度的 canvas，用 pointer events 畫線（手指、觸控筆、滑鼠都可以），輸出 PNG data URL。
// 白板分兩層：底下是打字的文字，上面是手寫筆畫。改文字時只重畫文字層，筆畫會保留。

export function createBoard(
  canvas,
  {
    lineWidth = 8,
    color = '#111111',
    background = '#ffffff',
    fontFamily = 'sans-serif',
    onChange = () => {}, // 內容變動時呼叫，參數是白板是否為空
  } = {},
) {
  const ctx = canvas.getContext('2d');
  // 手寫筆畫存在離屏 canvas（透明底），重畫時疊到文字上面
  const ink = document.createElement('canvas');
  ink.width = canvas.width;
  ink.height = canvas.height;
  const inkCtx = ink.getContext('2d');

  let activePointer = null; // 只追蹤一根手指，避免多指同時畫亂掉
  let last = null;
  let hasInk = false;
  let text = '';
  let wasEmpty = true;

  // 空白／有內容切換時才通知，畫線時不會每一筆都觸發
  function notify() {
    const empty = !hasInk && !text;
    if (empty === wasEmpty) return;
    wasEmpty = empty;
    onChange(empty);
  }

  // ---- 合成 ----

  function redraw() {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (text) drawText();
    ctx.drawImage(ink, 0, 0);
  }

  /** 把文字置中畫在主畫布上，字會自動縮放和換行來塞滿白板。 */
  function drawText() {
    const padding = 32;
    const maxWidth = canvas.width - padding * 2;
    const maxHeight = canvas.height - padding * 2;
    const chars = [...text];

    // 中文沒有空白可以斷行，所以逐字換行
    const wrap = () => {
      const lines = [''];
      for (const ch of chars) {
        const line = lines.at(-1) + ch;
        if (ctx.measureText(line).width > maxWidth && lines.at(-1)) lines.push(ch);
        else lines[lines.length - 1] = line;
      }
      return lines;
    };

    let size = 160;
    let lines;
    for (; size > 20; size -= 4) {
      ctx.font = `bold ${size}px ${fontFamily}`;
      lines = wrap();
      if (lines.length * size * 1.2 <= maxHeight) break;
    }

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lineHeight = size * 1.2;
    const top = canvas.height / 2 - (lineHeight * (lines.length - 1)) / 2;
    lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, top + i * lineHeight));
  }

  // ---- 手寫 ----

  // 螢幕座標轉成 canvas 內部座標（canvas 顯示大小會隨螢幕縮放）
  function toCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  // 同一筆同時畫在主畫布和筆畫層：主畫布即時顯示，筆畫層留著給之後重畫
  function forBoth(fn) {
    fn(ctx);
    fn(inkCtx);
  }

  function strokeTo(p) {
    forBoth((c) => {
      c.beginPath();
      c.moveTo(last.x, last.y);
      c.lineTo(p.x, p.y);
      c.stroke();
    });
    last = p;
  }

  // iOS Safari 不一定遵守 touch-action，直接擋掉 touch 的預設行為（捲動、縮放、長按選取）
  for (const type of ['touchstart', 'touchmove', 'touchend']) {
    canvas.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (activePointer !== null || e.button !== 0) return;
    e.preventDefault();
    activePointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    window.getSelection()?.removeAllRanges();
    last = toCanvasPoint(e);
    forBoth((c) => {
      c.strokeStyle = color;
      c.fillStyle = color;
      c.lineWidth = lineWidth;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      // 只點一下也要留下一個點
      c.beginPath();
      c.arc(last.x, last.y, lineWidth / 2, 0, Math.PI * 2);
      c.fill();
    });
    hasInk = true;
    notify();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer) return;
    e.preventDefault();
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events) strokeTo(toCanvasPoint(ev));
  });

  const end = (e) => {
    if (e.pointerId === activePointer) activePointer = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // ---- 對外介面 ----

  /** 清掉文字和筆畫。 */
  function clear() {
    inkCtx.clearRect(0, 0, ink.width, ink.height);
    hasInk = false;
    text = '';
    redraw();
    notify();
  }

  /** 更新文字層，手寫筆畫保留。 */
  function setText(value) {
    const next = value.trim();
    if (next === text) return;
    text = next;
    redraw();
    notify();
  }

  redraw();

  return {
    clear,
    setText,
    isEmpty: () => !hasInk && !text,
    toDataURL: () => canvas.toDataURL('image/png'),
  };
}
