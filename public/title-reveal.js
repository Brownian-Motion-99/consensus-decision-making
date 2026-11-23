// 逐行揭示（Line Reveal）：首頁標題一行一行從各自的遮罩下方帶一點旋轉翻上來，最後一行用強調色，
// 下方一條細線由左往右畫出，停留一下後整段往上收走，只要畫面還在首頁就一直重複。
// GSAP 由 index.html 用一般 script 載入（window.gsap）。

const REVEAL = 0.9; // 每一行翻上來的秒數
const STAGGER = 0.14; // 行與行的間隔
const HOLD = 1.6; // 全部出現後停留的秒數
const EXIT = 0.6; // 整段往上收走的秒數
const REPEAT_DELAY = 0.5; // 收走之後到下一輪開始的空檔

/** 讓 titleEl 裡的 .line-inner 逐行揭示。回傳 { start({ delay }), stop() }。 */
export function createTitleReveal(titleEl) {
  const lines = [...titleEl.querySelectorAll('.line-inner')];
  const underline = titleEl.querySelector('.title-underline');
  let timeline = null;

  /** 開始（或重新開始）循環。delay：第一輪等幾秒才開始，例如等啟動轉場先把首頁浮上來。 */
  function start({ delay = 0 } = {}) {
    stop();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; // 直接顯示完整的標題
    const { gsap } = window;
    timeline = gsap.timeline({ delay, repeat: -1, repeatDelay: REPEAT_DELAY });
    timeline
      .fromTo(
        lines,
        { yPercent: 115, rotate: 6 },
        { yPercent: 0, rotate: 0, duration: REVEAL, ease: 'power3.out', stagger: STAGGER },
      )
      .fromTo(underline, { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power2.inOut' }, '-=0.35')
      .fromTo(titleEl, { y: 0, opacity: 1 }, { y: -70, opacity: 0, duration: EXIT, ease: 'power2.in' }, `+=${HOLD}`);
  }

  /** 停下來，標題回到完整顯示的樣子。 */
  function stop() {
    if (!timeline) return;
    timeline.kill();
    timeline = null;
    window.gsap.set([titleEl, underline, ...lines], { clearProps: 'all' });
  }

  return { start, stop };
}
