// 柔和上浮（Gentle Fade Up）：一個區塊進場時，各個元素依照由上到下的閱讀順序，
// 從下方約 18px、完全透明的狀態輕輕浮上並淡入。沒有彈跳也沒有縮放。GSAP 由 index.html 用一般 script 載入（window.gsap）。

const DISTANCE = 18; // px
const DURATION = 0.9; // 秒
const STAGGER = 0.14; // 元素之間的間隔，秒

/** 讓 section 裡看得到的直接子元素依序浮上來。回傳 tween，之後可以 revert() 還原；可以調整 delay、duration、stagger；系統設定減少動態時回傳 null。 */
export function fadeUp(section, { delay = 0, duration = DURATION, stagger = STAGGER } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  // 主持人專用、玩家專用的元素用 display:none 藏起來，沒有版面的不用播
  const items = [...section.children].filter((el) => el.getClientRects().length > 0);
  return window.gsap.fromTo(
    items,
    { y: DISTANCE, opacity: 0 },
    { y: 0, opacity: 1, delay, duration, ease: 'power2.out', stagger, clearProps: 'transform,opacity' },
  );
}
