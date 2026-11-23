// 頁面轉場簾幕（Curtain Page Transition）：三片直條狀的簾幕從上方依序落下蓋住整個畫面，
// 蓋滿時在背後換成新畫面，接著簾幕依序往下收走，新畫面的內容由上到下淡入上浮。整段約 1.4 秒。
// GSAP 由 index.html 用一般 script 載入（window.gsap）。

import { fadeUp } from './fade-up.js';

const DROP = 0.45; // 每片簾幕落下、收走各花幾秒
const STAGGER = 0.08; // 簾幕之間的間隔，秒

/**
 * 播放轉場。curtain 是放三片簾幕的容器；swap() 在簾幕蓋滿時呼叫，要把畫面換成新的並回傳新畫面的元素。
 * 回傳可以 revert() 的物件（轉場途中又要換畫面時用來取消）；系統設定減少動態時直接換畫面，回傳 null。
 */
export function playCurtain(curtain, swap) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    swap();
    return null;
  }
  const { gsap } = window;
  const strips = [...curtain.children];
  let content = null;

  const finish = () => {
    curtain.hidden = true;
    gsap.set(strips, { clearProps: 'all' });
  };

  curtain.hidden = false;
  const timeline = gsap.timeline({ onComplete: finish });
  timeline
    .fromTo(strips, { yPercent: -101 }, { yPercent: 0, duration: DROP, ease: 'power3.inOut', stagger: STAGGER })
    .call(() => {
      const section = swap();
      // 簾幕開始收的時候，內容稍等一下再浮上來
      content = section && fadeUp(section, { delay: 0.15, duration: 0.5, stagger: 0.07 });
    })
    .to(strips, { yPercent: 101, duration: DROP, ease: 'power3.inOut', stagger: STAGGER });

  return {
    revert() {
      timeline.kill();
      content?.revert();
      finish();
    },
  };
}
