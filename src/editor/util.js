export const $ = (id) => document.getElementById(id);
export const secs = (s) => `${s.toFixed(2).replace('.', ',')} s`;
export const kb = (n) => `${Math.round(n / 1024)} KB`;
export const tick = () => new Promise((r) => setTimeout(r, 20));

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function cleanName(raw) {
  const n = (raw || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 32);
  return n.length >= 2 ? n : 'clip';
}
