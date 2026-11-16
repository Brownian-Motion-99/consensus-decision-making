import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integratedLoudness } from '../public/loudness.js';

const RATE = 48000;

function sine({ freq = 997, amplitude = 1, seconds = 1, rate = RATE } = {}) {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

const near = (actual, expected, tolerance = 0.1) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} 不在 ${expected} ± ${tolerance} 內`);

test('響度：單聲道 0 dBFS 的 1 kHz 正弦波是 -3.01 LUFS（BS.1770 的校準點）', () => {
  near(integratedLoudness([sine()], RATE), -3.01);
});

test('響度：兩個相同的聲道比單聲道大 3 dB', () => {
  const s = sine();
  near(integratedLoudness([s, s], RATE), 0);
});

test('響度：振幅變成十分之一就小 20 dB，跟取樣率無關', () => {
  near(integratedLoudness([sine({ amplitude: 0.1, rate: 44100 })], 44100), -23.01);
  near(integratedLoudness([sine({ amplitude: 0.1, rate: 24000 })], 24000), -23.01);
});

test('響度：比 400ms 還短的音效也量得出來', () => {
  near(integratedLoudness([sine({ seconds: 0.2 })], RATE), -3.01, 0.2);
});

test('響度：全靜音是 -Infinity', () => {
  assert.equal(integratedLoudness([new Float32Array(RATE)], RATE), -Infinity);
});

test('響度：安靜的段落不會把整體拉低（gating）', () => {
  const loud = sine({ seconds: 2 });
  const withSilence = new Float32Array(loud.length * 2);
  withSilence.set(loud);
  // 沒有 gating 的話，一半是靜音會掉 3 dB（-6.0）；有 gating 只剩交界的區塊有影響（ffmpeg 也是約 -0.3 dB）
  near(integratedLoudness([withSilence], RATE), -3.35, 0.1);
});
