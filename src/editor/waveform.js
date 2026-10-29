import { duration } from '../lib/clip.js';

const STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60];
const MIN_VIEW = 0.02;
const EDGE_PX = 7;

// Wellenform mit Auswahl (ziehen), Cursor (klicken), Zoom (Mausrad) und Abspiel-Position.
export class Waveform {
  constructor(canvas, { onSelection, onCursor, onView }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.on = { onSelection, onCursor, onView };
    this.clip = null;
    this.sel = null;
    this.cursor = 0;
    this.playhead = null;
    this.view = [0, 1];
    this.drag = null;
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
  }

  get dur() {
    return this.clip ? duration(this.clip) : 0;
  }

  setClip(clip, keepView = false) {
    this.clip = clip;
    this.sel = null;
    this.playhead = null;
    this.cursor = Math.min(this.cursor, this.dur);
    this.view = keepView ? this.clampView(...this.view) : [0, this.dur];
    this.emitView();
    this.draw();
  }

  setSelection(sel) {
    this.sel = sel;
    this.on.onSelection(sel);
    this.draw();
  }

  setCursor(t) {
    this.cursor = t;
    this.draw();
  }

  setPlayhead(t) {
    this.playhead = t;
    this.draw();
  }

  clampView(a, b) {
    const dur = this.dur;
    const width = Math.min(dur, Math.max(MIN_VIEW, b - a));
    const start = Math.max(0, Math.min(dur - width, a));
    return [start, start + width];
  }

  setView(a, b) {
    this.view = this.clampView(a, b);
    this.emitView();
    this.draw();
  }

  emitView() {
    this.on.onView(this.view, this.dur);
  }

  xToT(x) {
    const [a, b] = this.view;
    return Math.max(0, Math.min(this.dur, a + (x / this.canvas.clientWidth) * (b - a)));
  }

  tToX(t) {
    const [a, b] = this.view;
    return ((t - a) / (b - a)) * this.canvas.clientWidth;
  }

  localX(e) {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  }

  hitEdge(x) {
    if (!this.sel) return null;
    if (Math.abs(x - this.tToX(this.sel[0])) <= EDGE_PX) return 0;
    if (Math.abs(x - this.tToX(this.sel[1])) <= EDGE_PX) return 1;
    return null;
  }

  down(e) {
    if (!this.clip) return;
    this.canvas.setPointerCapture(e.pointerId);
    const x = this.localX(e);
    const edge = this.hitEdge(x);
    this.drag = edge !== null ? { edge } : { anchorX: x, anchorT: this.xToT(x), moved: false };
  }

  move(e) {
    if (!this.clip) return;
    const x = this.localX(e);
    if (!this.drag) {
      this.canvas.style.cursor = this.hitEdge(x) !== null ? 'ew-resize' : 'crosshair';
      return;
    }
    const t = this.xToT(x);
    if (this.drag.edge !== undefined) {
      const sel = [...this.sel];
      sel[this.drag.edge] = t;
      if (sel[0] > sel[1]) {
        sel.reverse();
        this.drag.edge = 1 - this.drag.edge;
      }
      this.setSelection(sel);
    } else if (this.drag.moved || Math.abs(x - this.drag.anchorX) > 3) {
      this.drag.moved = true;
      this.setSelection([Math.min(this.drag.anchorT, t), Math.max(this.drag.anchorT, t)]);
    }
  }

  up() {
    const d = this.drag;
    this.drag = null;
    if (d && d.edge === undefined && !d.moved) {
      this.cursor = d.anchorT;
      this.setSelection(null);
      this.on.onCursor(d.anchorT);
    }
  }

  wheel(e) {
    if (!this.clip) return;
    e.preventDefault();
    const [a, b] = this.view;
    const t = this.xToT(this.localX(e));
    const factor = e.deltaY < 0 ? 0.8 : 1.25;
    const width = Math.min(this.dur, Math.max(MIN_VIEW, (b - a) * factor));
    const rel = (t - a) / (b - a);
    this.setView(t - rel * width, t - rel * width + width);
  }

  draw() {
    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(cv);
    const col = (n) => css.getPropertyValue(n).trim();
    g.clearRect(0, 0, w, h);
    if (!this.clip) return;

    const ruler = 18;
    const mid = ruler + (h - ruler) / 2;
    const amp = (h - ruler) / 2 - 4;
    const [v0, v1] = this.view;

    // Lineal
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'top';
    const step = STEPS.find((s) => (s / (v1 - v0)) * w >= 70) ?? 60;
    g.fillStyle = col('--muted');
    g.strokeStyle = col('--grid');
    g.lineWidth = 1;
    for (let t = Math.ceil(v0 / step) * step; t <= v1; t += step) {
      const x = Math.round(this.tToX(t)) + 0.5;
      g.beginPath();
      g.moveTo(x, ruler - 5);
      g.lineTo(x, h);
      g.stroke();
      g.fillText(`${+t.toFixed(3)} s`, x + 3, 2);
    }

    // Auswahl-Hintergrund
    if (this.sel) {
      const x0 = this.tToX(this.sel[0]);
      const x1 = this.tToX(this.sel[1]);
      g.fillStyle = col('--sel');
      g.fillRect(x0, ruler, x1 - x0, h - ruler);
    }

    // Wellenform: je Pixelspalte min/max über alle Kanäle
    const sr = this.clip.sampleRate;
    const total = this.clip.channels[0].length;
    const perPx = ((v1 - v0) * sr) / w;
    const stride = Math.max(1, Math.floor(perPx / 200));
    g.fillStyle = col('--wave');
    for (let x = 0; x < w; x++) {
      const i0 = Math.max(0, Math.floor(v0 * sr + x * perPx));
      const i1 = Math.min(total, Math.max(i0 + 1, Math.floor(v0 * sr + (x + 1) * perPx)));
      let lo = 0;
      let hi = 0;
      for (const ch of this.clip.channels) {
        for (let i = i0; i < i1; i += stride) {
          const s = ch[i];
          if (s < lo) lo = s;
          if (s > hi) hi = s;
        }
      }
      const y0 = mid - Math.min(1, hi) * amp;
      const y1 = mid - Math.max(-1, lo) * amp;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }

    // Auswahl-Kanten
    if (this.sel) {
      g.fillStyle = col('--accent');
      for (const t of this.sel) g.fillRect(Math.round(this.tToX(t)) - 1, ruler, 2, h - ruler);
    }
    // Cursor und Abspielposition
    const line = (t, color) => {
      if (t === null || t < v0 || t > v1) return;
      g.fillStyle = color;
      g.fillRect(Math.round(this.tToX(t)), ruler, 1, h - ruler);
    };
    line(this.cursor, col('--muted'));
    line(this.playhead, col('--play'));
  }
}
