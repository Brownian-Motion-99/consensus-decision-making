// 送出答案的轉場：作答中 → 答案已送出（同一個畫面裡的內容切換）。
// 兩邊都有的元件（進度、題目、畫布、主持人的按鈕）用 FLIP 技巧平移：先量舊位置，換完內容再量新位置，
// 從舊位置滑到新位置；只有作答中有的（打字框、清除／送出按鈕）留一份複製品在原地淡出；
// 只有已送出才有的（「你的答案」標籤、作答進度）用同樣的時間和緩動柔和浮上來。GSAP 由 index.html 載入（window.gsap）。

const DURATION = 0.7; // 平移和上浮共用，兩邊的速度才會一致
const EASE = 'power2.inOut';
const RISE = 24; // 上浮前往下偏移的 px
const FADE_OUT = 0.25; // 原地淡出的秒數

const visible = (el) => el.getClientRects().length > 0;

/**
 * 換內容之前呼叫：記下兩邊共有元件的舊位置，並把只有作答中才有的元件複製一份留在原地。
 * shared 是 [{ from, to }]：from 是舊畫面的元素（用來量舊位置），to 是新畫面的元素（會被平移）。
 * exiting 是只有作答中才有的元素。系統設定減少動態時回傳 null，呼叫的人就直接換內容。
 */
export function captureSubmit({ shared, exiting }) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  return {
    shared: shared.filter(({ from }) => visible(from)).map(({ from, to }) => ({ el: to, first: from.getBoundingClientRect() })),
    ghosts: exiting.filter(visible).map((el) => {
      const rect = el.getBoundingClientRect();
      const ghost = el.cloneNode(true);
      ghost.removeAttribute('id');
      for (const node of ghost.querySelectorAll('[id]')) node.removeAttribute('id');
      // cloneNode 不會複製使用者輸入到一半的值
      const inputs = el.querySelectorAll('input');
      ghost.querySelectorAll('input').forEach((input, i) => { input.value = inputs[i].value; });
      Object.assign(ghost.style, {
        position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
        margin: '0', pointerEvents: 'none', zIndex: '5',
      });
      ghost.setAttribute('aria-hidden', 'true');
      return ghost;
    }),
  };
}

/** 換完內容之後呼叫：播放平移、淡出、上浮。entering 是只有已送出才有的元素。回傳可以 revert() 的物件。 */
export function playSubmit(captured, { entering }) {
  const { gsap } = window;
  const ghosts = captured.ghosts;
  document.body.append(...ghosts);

  const timeline = gsap.timeline({ onComplete: cleanup });
  timeline.to(ghosts, { opacity: 0, duration: FADE_OUT, ease: 'power1.out' }, 0);
  for (const { el, first } of captured.shared) {
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue; // 沒有移動（例如畫面很長，不會重新置中）就不用動
    timeline.fromTo(el, { x: dx, y: dy }, { x: 0, y: 0, duration: DURATION, ease: EASE, clearProps: 'transform' }, 0);
  }
  const rising = entering.filter(visible);
  timeline.fromTo(
    rising,
    { y: RISE, opacity: 0 },
    { y: 0, opacity: 1, duration: DURATION, ease: EASE, stagger: 0.1, clearProps: 'transform,opacity' },
    0.15,
  );

  function cleanup() {
    for (const ghost of ghosts) ghost.remove();
  }
  return {
    revert() {
      timeline.revert();
      cleanup();
    },
  };
}
