// 連線中的多語輪播：輪流顯示不同語言的「連線中」。
// 舊的詞往上模糊淡出，新的詞從下方模糊淡入；每個詞長度不同，包住文字的容器寬度用 GSAP 平滑縮放到新詞的寬度，
// 後面跟著的小圓點才會順著移動，不會瞬間跳動。GSAP 由 index.html 用一般 script 載入（window.gsap）。

const WORDS = ['Connecting', '連線中', '接続中', 'Connexion', 'Conectando', '연결 중', 'Connessione'];
const INTERVAL = 1.6; // 每隔幾秒換一個詞
const TRAVEL = 0.4; // 淡出淡入時上下移動的距離，單位是字級
const BLUR = 0.15; // 模糊程度，單位是字級

/** 在 root 裡讓文字輪播。所在的畫面隱藏時自動停下，再顯示時從第一個詞重新開始。 */
export function createGreeting(root) {
  const { gsap } = window;
  const box = root.querySelector('.greeting-box');
  const measure = root.querySelector('.greeting-measure');
  const screen = root.closest('[data-screen]');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;
  let current = null;
  let timeline = null;
  let timer = null;
  let running = false;

  // 用隱藏的量測元素（字級、字重和顯示的文字一樣）量出詞的寬度
  function widthOf(word) {
    measure.textContent = word;
    return measure.getBoundingClientRect().width;
  }

  function addWord(text) {
    const el = document.createElement('span');
    el.className = 'greeting-word';
    el.textContent = text;
    box.append(el);
    return el;
  }

  function next() {
    timer = gsap.delayedCall(INTERVAL, next);
    index = (index + 1) % WORDS.length;
    const old = current;
    const word = addWord(WORDS[index]);
    current = word;
    const width = widthOf(WORDS[index]);
    timeline?.progress(1); // 上一輪還沒做完（切換比間隔長）就直接收尾

    if (reduceMotion.matches) {
      old.remove();
      gsap.set(box, { width });
      return;
    }
    const size = parseFloat(getComputedStyle(root).fontSize);
    timeline = gsap.timeline({ onComplete: () => old.remove() });
    timeline
      .to(old, { opacity: 0, y: -TRAVEL * size, filter: `blur(${BLUR * size}px)`, duration: 0.5, ease: 'power2.in' }, 0)
      .fromTo(
        word,
        { opacity: 0, y: TRAVEL * size, filter: `blur(${BLUR * size}px)` },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.6, ease: 'power2.out' },
        0.15,
      )
      .to(box, { width, duration: 0.7, ease: 'power3.inOut' }, 0);
  }

  function start() {
    index = 0;
    box.replaceChildren();
    current = addWord(WORDS[0]);
    gsap.set(box, { width: widthOf(WORDS[0]) });
    timer = gsap.delayedCall(INTERVAL, next);
  }

  function stop() {
    timer?.kill();
    timeline?.kill();
    timer = timeline = null;
  }

  function update() {
    const active = !screen?.hidden;
    if (active && !running) start();
    if (!active && running) stop();
    running = active;
  }

  // 轉場開始時（splash.js）停住，不要在飛出去的途中換字；正在播的切換會自己播完
  root.addEventListener('greeting:pause', () => timer?.kill());

  // 視窗大小改變時字級跟著變（字級用 vw），停著的時候重量一次寬度
  window.addEventListener('resize', () => {
    if (running && !timeline?.isActive()) gsap.set(box, { width: widthOf(WORDS[index]) });
  });
  if (screen) new MutationObserver(update).observe(screen, { attributes: true, attributeFilter: ['hidden'] });
  update();
}
