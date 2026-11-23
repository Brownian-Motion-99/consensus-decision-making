// 照片堆展開（Stack to Grid）：公開答案時，所有答案卡先散亂地疊在中央（各自歪斜不同角度），
// 再一張接一張平滑地飛到網格的位置並轉正。網格本身是 CSS grid，這裡只用 transform 把每張卡先搬到中央，
// 展開就是把 transform 歸零（等於 FLIP 技巧，不需要 Flip 外掛）。GSAP 由 index.html 載入（window.gsap）。
// 不做收回：展開之後就維持網格。

const DURATION = 0.7;
const STAGGER = 0.04;
const MAX_TILT = 14; // 度
const MAX_JITTER = 10; // px，每張偏離正中央的量

const random = (min, max) => min + Math.random() * (max - min);

/**
 * 把 listEl 裡的卡片搬成一疊。回傳 { spread({ delay }), revert() }；系統設定減少動態或沒有卡片時回傳 null。
 * 一疊會自己展開（呼叫 spread），也可以點一下立刻展開。
 */
export function stackAnswers(listEl) {
  const items = [...listEl.children];
  if (items.length === 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const { gsap } = window;

  const box = listEl.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  items.forEach((li, i) => {
    const rect = li.getBoundingClientRect();
    const tilt = (Math.random() < 0.5 ? -1 : 1) * random(3, MAX_TILT);
    gsap.set(li, {
      x: cx - (rect.left + rect.width / 2) + random(-MAX_JITTER, MAX_JITTER),
      y: cy - (rect.top + rect.height / 2) + random(-MAX_JITTER, MAX_JITTER),
      rotation: tilt,
      zIndex: items.length - i, // 第一張在最上面，最先飛出去
    });
  });
  listEl.classList.add('is-stacked');

  let timer = null;
  let tween = null;
  let done = false;

  function go() {
    done = true;
    listEl.classList.remove('is-stacked');
    listEl.removeEventListener('click', onTap);
    tween = gsap.to(items, {
      x: 0,
      y: 0,
      rotation: 0,
      duration: DURATION,
      ease: 'power2.inOut',
      stagger: STAGGER,
      clearProps: 'transform,zIndex',
    });
  }
  function spread({ delay = 0 } = {}) {
    if (done) return;
    timer?.kill();
    timer = gsap.delayedCall(delay, go);
  }
  function onTap() {
    spread();
  }
  listEl.addEventListener('click', onTap);

  return {
    spread,
    revert() {
      timer?.kill();
      tween?.kill();
      listEl.removeEventListener('click', onTap);
      listEl.classList.remove('is-stacked');
      gsap.set(items, { clearProps: 'transform,zIndex' });
    },
  };
}
