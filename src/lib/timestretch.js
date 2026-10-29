import { frames, interpolate } from './clip.js';

// Speed: einfaches Resampling, die Tonhöhe ändert sich mit dem Tempo.
export function stretchSpeed(clip, targetSec) {
  const outLen = Math.max(1, Math.round(targetSec * clip.sampleRate));
  return { sampleRate: clip.sampleRate, channels: clip.channels.map((ch) => interpolate(ch, outLen)) };
}

// Tempo: WSOLA, die Tonhöhe bleibt erhalten. Gute Qualität bis etwa Faktor 1,5–2.
export function stretchTempo(clip, targetSec) {
  const sr = clip.sampleRate;
  const len = frames(clip);
  const outLen = Math.max(1, Math.round(targetSec * sr));
  const N = 2 * Math.round(sr * 0.023); // Fenster ca. 46 ms
  if (len < N * 2 || outLen < N) return stretchSpeed(clip, targetSec);

  const H = N / 2;
  const rate = len / outLen;
  const delta = Math.round(sr * 0.012); // Suchbereich ±12 ms

  const mono = new Float32Array(len);
  for (const ch of clip.channels) for (let i = 0; i < len; i++) mono[i] += ch[i] / clip.channels.length;

  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  const out = clip.channels.map(() => new Float32Array(outLen + N));
  let prev = 0;
  let outPos = 0;
  for (let k = 0; outPos < outLen; k++, outPos += H) {
    let pos = 0;
    if (k > 0) {
      const nominal = Math.round(k * H * rate);
      const ref = prev + H; // so würde das vorige Fenster natürlich weitergehen
      let lo = Math.max(0, nominal - delta);
      let hi = Math.min(len - N, nominal + delta);
      if (hi < lo) lo = hi = Math.max(0, Math.min(len - N, nominal));
      let best = -Infinity;
      pos = lo;
      for (let p = lo; p <= hi; p++) {
        let corr = 0;
        let energy = 1e-9;
        for (let i = 0; i < H; i += 2) {
          const a = mono[p + i];
          corr += a * mono[ref + i];
          energy += a * a;
        }
        const score = corr / Math.sqrt(energy);
        if (score > best) {
          best = score;
          pos = p;
        }
      }
    }
    clip.channels.forEach((src, c) => {
      const dst = out[c];
      for (let i = 0; i < N; i++) {
        const w = k === 0 && i < H ? 1 : win[i];
        dst[outPos + i] += src[pos + i] * w;
      }
    });
    prev = pos;
  }
  return { sampleRate: sr, channels: out.map((o) => o.slice(0, outLen)) };
}

export function stretchToLength(clip, targetSec, mode) {
  return mode === 'speed' ? stretchSpeed(clip, targetSec) : stretchTempo(clip, targetSec);
}
