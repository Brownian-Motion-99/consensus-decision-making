// 感知響度（ITU-R BS.1770／EBU R128 的 integrated loudness，單位 LUFS）。
// 純計算、不碰 Web Audio，方便在 node 裡測試。係數公式與 libebur128 相同，任何取樣率都適用。

const BLOCK_SECONDS = 0.4;
const BLOCK_STEP = 0.1; // 75% 重疊
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;

/** 二階 IIR 濾波器（Direct Form I）。 */
function biquad(input, [b0, b1, b2], [a1, a2]) {
  const out = new Float64Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
  }
  return out;
}

/** K-weighting：模擬頭部的高頻提升（high shelf）＋去掉低頻（high pass）。 */
function kWeight(samples, sampleRate) {
  // 第一段：high shelf
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = biquad(
    samples,
    [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  );

  // 第二段：high pass
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  return biquad(shelf, [1, -2, 1], [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]);
}

const toLufs = (power) => -0.691 + 10 * Math.log10(power);

/**
 * @param {Float32Array[]} channels 每個聲道的取樣（左、右…，權重都當作 1）
 * @param {number} sampleRate
 * @returns {number} LUFS；全靜音時是 -Infinity
 */
export function integratedLoudness(channels, sampleRate) {
  const weighted = channels.map((ch) => kWeight(ch, sampleRate));
  const length = weighted[0]?.length ?? 0;
  const blockSize = Math.round(BLOCK_SECONDS * sampleRate);
  const step = Math.round(BLOCK_STEP * sampleRate);

  // 每個 400ms 區塊的能量（各聲道均方值加總）。比一個區塊還短的音效就整段當成一塊
  const blockPower = (start, size) => {
    let sum = 0;
    for (const ch of weighted) {
      let sq = 0;
      for (let i = start; i < start + size; i++) sq += ch[i] * ch[i];
      sum += sq / size;
    }
    return sum;
  };
  const blocks = [];
  if (length < blockSize) {
    if (length > 0) blocks.push(blockPower(0, length));
  } else {
    for (let start = 0; start + blockSize <= length; start += step) blocks.push(blockPower(start, blockSize));
  }

  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const aboveAbsolute = blocks.filter((p) => toLufs(p) > ABSOLUTE_GATE);
  if (aboveAbsolute.length === 0) return -Infinity;
  const relativeGate = toLufs(mean(aboveAbsolute)) + RELATIVE_GATE;
  const gated = aboveAbsolute.filter((p) => toLufs(p) > relativeGate);
  return toLufs(mean(gated));
}
