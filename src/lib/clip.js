// Ein Clip ist { sampleRate, channels: Float32Array[] }. Alle Funktionen liefern neue Clips.

export const frames = (c) => c.channels[0].length;
export const duration = (c) => frames(c) / c.sampleRate;

const idx = (c, t) => Math.max(0, Math.min(frames(c), Math.round(t * c.sampleRate)));

export function fromAudioBuffer(buf) {
  const channels = [];
  for (let i = 0; i < buf.numberOfChannels; i++) channels.push(buf.getChannelData(i).slice());
  return { sampleRate: buf.sampleRate, channels };
}

export function toAudioBuffer(ctx, clip) {
  const buf = ctx.createBuffer(clip.channels.length, frames(clip), clip.sampleRate);
  clip.channels.forEach((ch, i) => buf.copyToChannel(ch, i));
  return buf;
}

export function slice(c, startSec, endSec) {
  const i = idx(c, startSec);
  const j = idx(c, endSec);
  return { sampleRate: c.sampleRate, channels: c.channels.map((ch) => ch.slice(i, Math.max(i, j))) };
}

export function cut(c, startSec, endSec) {
  const i = idx(c, startSec);
  const j = Math.max(i, idx(c, endSec));
  const channels = c.channels.map((ch) => {
    const out = new Float32Array(ch.length - (j - i));
    out.set(ch.subarray(0, i));
    out.set(ch.subarray(j), i);
    return out;
  });
  return { sampleRate: c.sampleRate, channels };
}

export function applyFades(c, fadeInSec, fadeOutSec) {
  const len = frames(c);
  let nIn = Math.round(fadeInSec * c.sampleRate);
  let nOut = Math.round(fadeOutSec * c.sampleRate);
  if (nIn + nOut > len) {
    const k = len / (nIn + nOut);
    nIn = Math.floor(nIn * k);
    nOut = Math.floor(nOut * k);
  }
  const channels = c.channels.map((ch) => {
    const out = ch.slice();
    for (let i = 0; i < nIn; i++) out[i] *= i / nIn;
    for (let i = 0; i < nOut; i++) out[len - 1 - i] *= i / nOut;
    return out;
  });
  return { sampleRate: c.sampleRate, channels };
}

export function applyGain(c, gain) {
  if (gain === 1) return c;
  return { sampleRate: c.sampleRate, channels: c.channels.map((ch) => ch.map((s) => s * gain)) };
}

export function peak(c) {
  let p = 0;
  for (const ch of c.channels) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]));
  return p;
}

export function normalize(c, target = 0.97) {
  const p = peak(c);
  return p < 1e-6 ? c : applyGain(c, target / p);
}

// Lineares Resampling auf eine andere Abtastrate (Dauer bleibt gleich).
export function resampleRate(c, newRate) {
  if (newRate === c.sampleRate) return c;
  const outLen = Math.max(1, Math.round((frames(c) * newRate) / c.sampleRate));
  return { sampleRate: newRate, channels: c.channels.map((ch) => interpolate(ch, outLen)) };
}

// Zieht ch linear auf outLen Samples; die Dauer in Samples ändert sich, nicht die Abtastrate.
export function interpolate(ch, outLen) {
  const out = new Float32Array(outLen);
  const ratio = ch.length / outLen;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const f = pos - j;
    out[i] = ch[j] * (1 - f) + (ch[Math.min(j + 1, ch.length - 1)] * f);
  }
  return out;
}
