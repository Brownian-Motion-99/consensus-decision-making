// 音效：用 Web Audio API 播放。手機瀏覽器要求使用者操作過才能出聲，
// 所以在第一次點擊或按鍵時解鎖，之後就算是別人觸發的事件（例如主持人判定）也能播放。

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const ctx = AudioCtx ? new AudioCtx() : null;
const sounds = new Map(); // name -> { buffer, gain }
const playing = new Map(); // name -> Set<AudioBufferSourceNode>，用來中途停止
// 每個音效的峰值都調到這個大小（約 -1 dBFS），讓最大音量一致
const TARGET_PEAK = 0.89;
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown'];

/** 預先下載並解碼音效。失敗時只是沒有聲音，不影響遊戲。 */
export function loadSounds(files) {
  if (!ctx) return;
  for (const [name, url] of Object.entries(files)) {
    fetch(url)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => sounds.set(name, { buffer, gain: TARGET_PEAK / peakOf(buffer) }))
      .catch((err) => console.warn(`音效 ${name} 載入失敗`, err));
  }

  const unlock = () => {
    if (ctx.state === 'suspended') ctx.resume();
    // 舊版 iOS 要在使用者操作中真的播一段聲音才算解鎖
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22050);
    source.connect(ctx.destination);
    source.start(0);
    if (ctx.state === 'running') {
      for (const type of UNLOCK_EVENTS) document.removeEventListener(type, unlock, true);
    }
  };
  for (const type of UNLOCK_EVENTS) document.addEventListener(type, unlock, true);
}

/** 所有聲道中取樣絕對值的最大值。 */
function peakOf(buffer) {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return peak || 1; // 全靜音的檔案不調整
}

export function playSound(name) {
  const sound = sounds.get(name);
  if (!ctx || !sound || ctx.state !== 'running') return;
  const source = ctx.createBufferSource();
  source.buffer = sound.buffer;
  const gain = ctx.createGain();
  gain.gain.value = sound.gain;
  source.connect(gain).connect(ctx.destination);

  if (!playing.has(name)) playing.set(name, new Set());
  playing.get(name).add(source);
  source.onended = () => playing.get(name).delete(source);
  source.start(0);
}

/** 停止某個音效所有正在播放的實例。 */
export function stopSound(name) {
  for (const source of playing.get(name) ?? []) source.stop();
  playing.get(name)?.clear();
}
