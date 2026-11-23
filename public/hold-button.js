// 長按確認（Hold to Confirm）：按住不放，按鈕從左往右等速變色、按鈕微微縮小；
// 填滿前放開（或游標移出）就快速退回、不執行；填滿後按鈕輕微彈一下、執行 onConfirm。可避免誤觸。
// 這裡只負責計時和切換 class，動畫是 style.css 的 transition。滑鼠、觸控和鍵盤（按住空白鍵或 Enter）都可以。

const RESET_AFTER = 2000; // 確認之後過幾毫秒還在原地，就把按鈕還原（例如 server 拒絕了這個操作）

/**
 * @param {HTMLButtonElement} button 裡面要有 .hold-fill（長按時蓋過去的那一層）
 * @param {object} opts
 * @param {number} opts.duration 要按多久，毫秒
 * @param {() => void} opts.onConfirm 按滿時執行
 * @param {() => void} [opts.onReset] 確認後還原按鈕時呼叫，讓外面把文字換回來
 */
export function initHoldButton(button, { duration, onConfirm, onReset }) {
  button.style.setProperty('--hold-duration', `${duration}ms`);
  let timer = null;
  let resetTimer = null;

  function start() {
    if (timer !== null || button.disabled || button.classList.contains('is-confirmed')) return;
    button.classList.add('is-holding');
    timer = setTimeout(confirm, duration);
  }

  function cancel() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    button.classList.remove('is-holding');
  }

  function confirm() {
    timer = null;
    if (button.disabled) return cancel();
    button.classList.remove('is-holding');
    button.classList.add('is-confirmed');
    onConfirm();
    resetTimer = setTimeout(reset, RESET_AFTER);
  }

  function reset() {
    clearTimeout(resetTimer);
    button.classList.remove('is-confirmed');
    onReset?.();
  }

  button.addEventListener('pointerdown', (e) => {
    if (e.button === 0) start();
  });
  button.addEventListener('pointerup', cancel);
  button.addEventListener('pointercancel', cancel);
  button.addEventListener('pointerleave', cancel);
  // 觸控時手指會一直算在按鈕上，滑出按鈕範圍也要取消
  button.addEventListener('pointermove', (e) => {
    const rect = button.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) cancel();
  });
  // 手機長按會跳出選單，擋掉
  button.addEventListener('contextmenu', (e) => e.preventDefault());
  button.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      start();
    }
  });
  button.addEventListener('keyup', cancel);
  button.addEventListener('blur', cancel);
}
