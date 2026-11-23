// 圓形展開轉場（Iris Transition）：一個白色圓從指定的那一點展開，蓋滿整個畫面；蓋滿時在背後換成新畫面，
// 接著從同一點展開一個「透明的洞」，把白色畫面轉入新畫面。洞用 CSS mask（徑向漸層）做，邊緣有一圈柔邊。
// GSAP 由 index.html 用一般 script 載入（window.gsap）。

const COVER = 0.55; // 白色圓展開蓋滿的秒數
const OPEN = 0.65; // 透明的洞展開的秒數
const FEATHER = 40; // 洞邊緣的柔邊寬度，px

/**
 * @param {HTMLElement} iris 白色的全螢幕元素
 * @param {{x: number, y: number}} origin 圓展開的起點，視窗座標
 * @param {{swap: () => void, opened?: () => void}} callbacks
 *   swap：白色蓋滿時呼叫，要把畫面換成新的；opened：洞展開完成時呼叫
 * 回傳可以 revert() 的物件（轉場途中又要換畫面時用來取消）；系統設定減少動態時直接換畫面，回傳 null。
 */
export function playIris(iris, { x, y }, { swap, opened }) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    swap();
    opened?.();
    return null;
  }
  const { gsap } = window;
  // 起點到最遠的角落的距離，圓和洞長到這麼大就一定蓋得滿／開得完
  const maxRadius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const cover = { r: 0 };
  const hole = { r: -FEATHER };

  const setClip = () => { iris.style.clipPath = `circle(${cover.r}px at ${x}px ${y}px)`; };
  const setMask = () => {
    const mask = `radial-gradient(circle at ${x}px ${y}px, transparent ${hole.r}px, #000 ${hole.r + FEATHER}px)`;
    iris.style.webkitMaskImage = mask;
    iris.style.maskImage = mask;
  };
  const finish = () => {
    iris.hidden = true;
    iris.removeAttribute('style');
  };

  setClip();
  iris.hidden = false;
  const timeline = gsap.timeline({ onComplete: () => { finish(); opened?.(); } });
  timeline
    .to(cover, { r: maxRadius, duration: COVER, ease: 'power2.inOut', onUpdate: setClip })
    .call(() => {
      swap();
      iris.style.clipPath = 'none';
      setMask();
    })
    .to(hole, { r: maxRadius, duration: OPEN, ease: 'power2.inOut', onUpdate: setMask });

  return {
    revert() {
      timeline.kill();
      finish();
    },
  };
}
