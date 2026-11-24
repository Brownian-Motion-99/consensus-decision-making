// 啟動頁轉場（Splash to Home）：連線完成、從連線中進入首頁時，連線中的字（正在輪播的那一個詞和圓點）
// 停住、輕輕呼吸一次，接著從畫面中央加速放大、淡出，像穿過它進入 App；同時底下首頁的內容由上到下依序淡入上浮。
// 首頁的內容等連線中的字完全消失之後才浮上來，不跟它重疊。
// GSAP 由 index.html 用一般 script 載入（window.gsap）。

const BREATH = 0.6; // 呼吸一次的秒數
const ZOOM = 0.8; // 放大飛出去的秒數
/** 連線中的字完全消失所需的秒數：首頁的內容（和標題的逐行揭示）要等這麼久才開始。 */
export const HOME_ENTER_DELAY = BREATH + ZOOM;

/** 播放轉場。connecting 是連線中的畫面，home 是首頁。回傳可以 revert() 的物件；系統設定減少動態時回傳 null。 */
export function playSplash(connecting, home) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    connecting.hidden = true;
    return null;
  }
  const { gsap } = window;
  const text = connecting.querySelector('.greeting');
  // 首頁由上到下的元素：標題區塊，以及表單裡的輸入框和按鈕列
  const items = [...home.children].flatMap((el) => (el.tagName === 'FORM' ? [...el.children] : [el]));

  text.dispatchEvent(new Event('greeting:pause'));
  const finish = () => {
    connecting.hidden = true;
    gsap.set(text, { clearProps: 'all' });
  };

  const timeline = gsap.timeline({ onComplete: finish });
  timeline
    .to(text, { scale: 1.06, duration: BREATH / 2, yoyo: true, repeat: 1, ease: 'sine.inOut' })
    .addLabel('zoom')
    .to(text, { scale: 14, duration: ZOOM, ease: 'power3.in' }, 'zoom')
    .to(text, { opacity: 0, duration: ZOOM * 0.75, ease: 'power2.in' }, `zoom+=${ZOOM * 0.25}`)
    .fromTo(
      items,
      { y: 10, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.5, ease: 'power2.out', stagger: 0.1, clearProps: 'transform,opacity' },
      '>', // 上一段（字飛出去、淡出）結束之後才開始
    );

  return {
    revert() {
      timeline.revert();
      finish();
    },
  };
}
