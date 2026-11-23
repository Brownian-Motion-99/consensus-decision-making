// 彩紙爆發（Confetti Burst）：結算畫面進來時，文字彈性放大的同時，從畫面下方噴出一大把紙片，
// 紙片受重力沿拋物線落下、旋轉，尾段淡出。只噴一次。
// GSAP 和 Physics2DPlugin 由 index.html 用一般 script 載入（window.gsap、window.Physics2DPlugin）。

const COUNT = 90;
const GRAVITY = 1100; // px/s²，小一點紙片才會飄得久一點
const DURATION = 2.6; // 每片紙從噴出到落下消失的秒數
const SPREAD = 38; // 噴出角度偏離正上方的最大度數

const random = (min, max) => min + Math.random() * (max - min);

/**
 * 文字（textEl）彈性放大，同時在 layer 裡噴出紙片。
 * delay：等幾秒才開始（接在別的轉場後面時用；等的時候文字先藏起來，紙片還在畫面外）。
 * 回傳可以 revert() 的物件（離開畫面時用來清掉還沒落完的紙片）；系統設定減少動態時回傳 null。
 */
export function playConfetti(textEl, layer, { delay = 0 } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const { gsap, Physics2DPlugin } = window;
  gsap.registerPlugin(Physics2DPlugin);

  // 紙片的顏色取自網站的主題色
  const style = getComputedStyle(document.documentElement);
  const colors = ['--color-primary', '--color-frame', '--color-primary-text', '--color-match'].map((name) =>
    style.getPropertyValue(name).trim(),
  );

  // 噴出的初速：讓最快的紙片大約飛到畫面 85% 的高度（v² = 2 × g × h）
  const maxVelocity = Math.sqrt(2 * GRAVITY * innerHeight * 0.85);
  const originX = innerWidth / 2;
  const originY = innerHeight;

  const pieces = Array.from({ length: COUNT }, () => {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = `${random(7, 13)}px`;
    piece.style.height = `${random(5, 10)}px`;
    if (Math.random() < 0.3) piece.style.borderRadius = '50%';
    piece.style.left = `${originX}px`;
    piece.style.top = `${originY}px`;
    return piece;
  });
  layer.append(...pieces);

  const timeline = gsap.timeline({ delay, onComplete: cleanup });
  gsap.set(textEl, { opacity: 0 });
  timeline.fromTo(textEl, { scale: 0.5 }, { scale: 1, duration: 1.4, ease: 'elastic.out(1, 0.5)', clearProps: 'transform' }, 0);
  timeline.to(textEl, { opacity: 1, duration: 0.25, clearProps: 'opacity' }, 0);
  for (const piece of pieces) {
    const duration = DURATION * random(0.85, 1.1);
    timeline.to(piece, {
      duration,
      ease: 'none',
      physics2D: {
        velocity: maxVelocity * random(0.45, 1),
        angle: -90 + random(-SPREAD, SPREAD), // 0 度朝右，負的往上
        gravity: GRAVITY,
      },
    }, 0);
    timeline.to(piece, { rotation: random(-900, 900), rotationX: random(-720, 720), duration, ease: 'none' }, 0);
    timeline.to(piece, { opacity: 0, duration: duration * 0.45, ease: 'power1.in' }, duration * 0.55); // 尾段淡出，這時紙片還在畫面的下半部
  }

  function cleanup() {
    for (const piece of pieces) piece.remove();
  }
  return {
    revert() {
      timeline.revert();
      cleanup();
    },
  };
}
