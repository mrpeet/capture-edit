import { frames, resampleRate } from './clip.js';

const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

const toInt16 = (s) => {
  const v = Math.max(-1, Math.min(1, s));
  return v < 0 ? v * 0x8000 : v * 0x7fff;
};

export function encodeWav(clip) {
  const nch = Math.min(2, clip.channels.length);
  const len = frames(clip);
  const dataSize = len * nch * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nch, true);
  v.setUint32(24, clip.sampleRate, true);
  v.setUint32(28, clip.sampleRate * nch * 2, true);
  v.setUint16(32, nch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nch; c++) {
      v.setInt16(o, toInt16(clip.channels[c][i]), true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Braucht das klassisch geladene vendor/lame.min.js (globales `lamejs`).
export function encodeMp3(clip, kbps = 128) {
  const lame = globalThis.lamejs;
  if (!lame) throw new Error('MP3-Encoder (lamejs) nicht geladen');
  if (!MP3_RATES.includes(clip.sampleRate)) clip = resampleRate(clip, 44100);
  const nch = Math.min(2, clip.channels.length);
  const enc = new lame.Mp3Encoder(nch, clip.sampleRate, kbps);
  const pcm = (ch) => Int16Array.from(ch, toInt16);
  const left = pcm(clip.channels[0]);
  const right = nch === 2 ? pcm(clip.channels[1]) : null;
  const parts = [];
  const block = 1152 * 10;
  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block);
    const chunk = right ? enc.encodeBuffer(l, right.subarray(i, i + block)) : enc.encodeBuffer(l);
    if (chunk.length) parts.push(chunk);
  }
  const end = enc.flush();
  if (end.length) parts.push(end);
  return new Blob(parts, { type: 'audio/mpeg' });
}
