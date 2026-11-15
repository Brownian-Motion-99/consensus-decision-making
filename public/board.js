// 手寫白板：固定解析度的 canvas，用 pointer events 畫線（手指、觸控筆、滑鼠都可以），輸出 PNG data URL。

export function createBoard(canvas, { lineWidth = 8, color = '#111111', background = '#ffffff' } = {}) {
  const ctx = canvas.getContext('2d');
  let activePointer = null; // 只追蹤一根手指，避免多指同時畫亂掉
  let last = null;
  let hasInk = false;

  function clear() {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    hasInk = false;
  }

  // 螢幕座標轉成 canvas 內部座標（canvas 顯示大小會隨螢幕縮放）
  function toCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  function strokeTo(p) {
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (activePointer !== null || e.button !== 0) return;
    e.preventDefault();
    activePointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    last = toCanvasPoint(e);
    // 只點一下也要留下一個點
    ctx.beginPath();
    ctx.arc(last.x, last.y, lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    hasInk = true;
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

  clear();

  return {
    clear,
    isEmpty: () => !hasInk,
    toDataURL: () => canvas.toDataURL('image/png'),
  };
}
