import { duration, frames, fromAudioBuffer, toAudioBuffer, slice, cut, applyFades, applyGain, normalize } from '../lib/clip.js';
import { stretchToLength } from '../lib/timestretch.js';
import { MAX_SECONDS } from '../lib/discord.js';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { takeClip } from '../lib/clipstore.js';
import { Waveform } from './waveform.js';
import { initSend } from './send.js';
import { hydrateIcons, setBtn } from './icons.js';
import { $, secs, cleanName } from './util.js';

const DISCORD_SAFE_SEC = 5.1; // MP3-Encoder hängt etwas Rand an, Discord erlaubt 5,2 s
const PREF_IDS = ['target', 'fadeIn', 'fadeOut', 'volume', 'normalize', 'format'];
const STRETCH_HELP = {
  tempo: 'Schneller abspielen, die Tonhöhe bleibt gleich.',
  speed: 'Wie ein Band: schneller und dabei höher.',
  off: 'Die Länge bleibt, wie sie ist.',
};

const state = {
  clip: null,
  history: [],
  future: [],
  src: null,
  raf: 0,
  mode: null, // 'source' | 'preview'
  loop: false,
  pausedAt: null,
  lastT: 0,
  settings: null,
};
let audioCtx = null;
const bufCache = new WeakMap();
let send = null;

const wave = new Waveform($('wave'), {
  onSelection: () => {
    state.pausedAt = null;
    update();
  },
  onCursor: () => {
    state.pausedAt = null;
    if (state.mode === 'source') playSource(wave.cursor);
    else wave.setPlayhead(null);
    update();
  },
  onView,
});

function setStatus(text, show = true) {
  const el = $('status');
  el.textContent = text;
  el.hidden = !show || !text;
}

const getStretch = () => document.querySelector('input[name=stretch]:checked').value;
const setStretch = (v) => {
  const r = document.querySelector(`input[name=stretch][value="${v}"]`);
  if (r) r.checked = true;
};

function num(id, def, min, max) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
}

// ---------- Clip laden ----------

function loadClip(clip, name) {
  stopAudio();
  state.clip = clip;
  state.history = [];
  state.future = [];
  state.pausedAt = null;
  $('empty').hidden = true;
  $('work').hidden = false;
  $('name').value = cleanName(name);
  $('clipname').textContent = name || '';
  wave.cursor = 0;
  wave.setClip(clip);
  setStatus('', false);
  update();
}

async function loadBlob(blob, name) {
  setStatus('Lade …');
  try {
    audioCtx ??= new AudioContext();
    const audio = await audioCtx.decodeAudioData(await blob.arrayBuffer());
    loadClip(fromAudioBuffer(audio), name);
  } catch (e) {
    $('empty').hidden = !!state.clip;
    setStatus(`Datei konnte nicht gelesen werden (${e.message || e})`);
  }
}

// ---------- Bearbeiten ----------

function commit(next) {
  state.history.push(state.clip);
  state.future = [];
  state.clip = next;
  state.pausedAt = null;
  wave.setClip(next, true);
  update();
}

function doCut() {
  const s = wave.sel;
  if (!s || s[1] - s[0] < 0.01) return;
  const next = cut(state.clip, s[0], s[1]);
  if (frames(next) < 1) return setStatus('Es würde nichts übrig bleiben.');
  wave.cursor = s[0];
  commit(next);
}

function doCrop() {
  const s = wave.sel;
  if (!s || s[1] - s[0] < 0.01) return;
  commit(slice(state.clip, s[0], s[1]));
  wave.setView(0, wave.dur);
}

function undo() {
  if (!state.history.length) return;
  state.future.push(state.clip);
  state.clip = state.history.pop();
  state.pausedAt = null;
  wave.setClip(state.clip, true);
  update();
}

function redo() {
  if (!state.future.length) return;
  state.history.push(state.clip);
  state.clip = state.future.pop();
  state.pausedAt = null;
  wave.setClip(state.clip, true);
  update();
}

// ---------- Ergebnis ----------

function resultInfo() {
  const sel = wave.sel;
  const src = sel ? sel[1] - sel[0] : duration(state.clip);
  const target = num('target', 5, 0.1, 60);
  const mode = getStretch();
  const stretched = mode !== 'off' && src > target + 0.005;
  return { src, outLen: stretched ? target : src, factor: stretched ? src / target : 1, stretched, mode };
}

function renderResult() {
  const sel = wave.sel;
  let c = sel ? slice(state.clip, sel[0], sel[1]) : state.clip;
  const info = resultInfo();
  if (info.stretched) c = stretchToLength(c, info.outLen, info.mode);
  c = applyFades(c, num('fadeIn', 0, 0, 2000) / 1000, num('fadeOut', 0, 0, 2000) / 1000);
  if ($('normalize').checked) c = normalize(c);
  return applyGain(c, num('volume', 100, 1, 400) / 100);
}

function update() {
  for (const input of document.querySelectorAll('input[data-out]')) $(input.dataset.out).textContent = input.value + input.dataset.unit;
  $('stretchHelp').textContent = STRETCH_HELP[getStretch()];
  if (!state.clip) return;

  const sel = wave.sel;
  const info = resultInfo();
  $('rTotal').textContent = secs(duration(state.clip));
  $('rSel').textContent = sel ? `${secs(sel[0])} – ${secs(sel[1])} · ${secs(sel[1] - sel[0])}` : 'ganzer Clip';
  $('rOut').textContent = secs(info.outLen);
  $('sendLen').textContent = secs(info.outLen);

  const badge = $('badge');
  if (info.outLen <= DISCORD_SAFE_SEC) [badge.className, badge.textContent] = ['badge ok', 'passt fürs Soundboard'];
  else if (info.outLen <= MAX_SECONDS) [badge.className, badge.textContent] = ['badge warn', 'knapp'];
  else [badge.className, badge.textContent] = ['badge bad', 'zu lang fürs Soundboard (max. 5,2 s)'];

  const note = $('stretchNote');
  note.hidden = !info.stretched;
  if (info.stretched) {
    const how = info.mode === 'tempo' ? 'Tempo' : 'Speed';
    note.textContent = `Stretch ×${info.factor.toFixed(2).replace('.', ',')} (${how})` + (info.factor > 1.8 ? ' – stark, klingt evtl. verzerrt' : '');
  }

  const hasSel = !!sel && sel[1] - sel[0] >= 0.01;
  $('cut').disabled = !hasSel;
  $('crop').disabled = !hasSel;
  $('undo').disabled = !state.history.length;
  $('redo').disabled = !state.future.length;
}

// ---------- Wiedergabe ----------

function stopAudio() {
  if (state.src) {
    state.src.onended = null;
    try { state.src.stop(); } catch { /* schon beendet */ }
  }
  state.src = null;
  state.mode = null;
  cancelAnimationFrame(state.raf);
  wave.setPlayhead(null);
  setBtn($('play'), 'play');
  $('play').setAttribute('aria-label', 'Abspielen');
  setBtn($('preview'), 'play', 'Ergebnis anhören');
}

function startPlayback(clip, offset, end, { loop = false, loopStart = offset, loopEnd = end, head = true } = {}) {
  stopAudio();
  audioCtx ??= new AudioContext();
  audioCtx.resume();
  let buf = bufCache.get(clip);
  if (!buf) bufCache.set(clip, (buf = toAudioBuffer(audioCtx, clip)));
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  if (loop) {
    src.loop = true;
    src.loopStart = loopStart;
    src.loopEnd = loopEnd;
    src.start(0, offset);
  } else {
    src.start(0, offset, end - offset);
  }
  const t0 = audioCtx.currentTime;
  state.src = src;
  state.mode = head ? 'source' : 'preview';
  state.lastT = offset;
  if (head) {
    setBtn($('play'), 'pause');
    $('play').setAttribute('aria-label', 'Pause');
  } else {
    setBtn($('preview'), 'stop', 'Stopp');
  }
  src.onended = () => {
    if (state.src === src) {
      state.pausedAt = null;
      stopAudio();
    }
  };
  const frame = () => {
    if (state.src !== src) return;
    let t = offset + (audioCtx.currentTime - t0);
    if (loop && t >= loopEnd) t = loopStart + ((t - loopStart) % (loopEnd - loopStart));
    state.lastT = t;
    if (head) wave.setPlayhead(t);
    state.raf = requestAnimationFrame(frame);
  };
  frame();
}

function range() {
  const sel = wave.sel;
  if (sel && sel[1] - sel[0] >= 0.01) return { a: sel[0], b: sel[1], hasSel: true };
  return { a: 0, b: duration(state.clip), hasSel: false };
}

function playSource(from) {
  if (!state.clip) return;
  const { a, b, hasSel } = range();
  let start = from;
  if (start == null) {
    const p = state.pausedAt;
    if (p != null && p >= a && p < b - 0.02) start = p;
    else if (hasSel) start = a;
    else start = wave.cursor >= b - 0.01 ? 0 : wave.cursor;
  }
  start = Math.min(Math.max(start, a), b - 0.01);
  startPlayback(state.clip, start, b, { loop: state.loop, loopStart: a, loopEnd: b });
}

function pause() {
  const t = state.lastT;
  stopAudio();
  state.pausedAt = t;
  wave.setPlayhead(t);
}

function togglePlay() {
  if (!state.clip) return;
  if (state.mode === 'source') return pause();
  if (state.src) stopAudio();
  playSource();
}

function togglePreview() {
  if (!state.clip) return;
  if (state.mode === 'preview') return stopAudio();
  const res = renderResult();
  startPlayback(res, 0, duration(res), { loop: state.loop, head: false });
}

// ---------- Verdrahtung ----------

function onView([a, b], dur) {
  const sc = $('scroll');
  const span = dur - (b - a);
  sc.disabled = span <= 0.001;
  sc.value = span > 0.001 ? Math.round((a / span) * 1000) : 0;
}

function zoomBy(factor) {
  const [a, b] = wave.view;
  const mid = wave.cursor >= a && wave.cursor <= b ? wave.cursor : (a + b) / 2;
  const w = (b - a) * factor;
  const rel = (mid - a) / (b - a);
  wave.setView(mid - rel * w, mid - rel * w + w);
}

async function persist() {
  await saveSettings(state.settings);
}

let prefTimer = 0;
function savePrefs() {
  const prefs = { stretch: getStretch(), target: num('target', 5, 0.1, 60) };
  for (const id of PREF_IDS) if (id !== 'target') prefs[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
  state.settings.prefs = { ...state.settings.prefs, ...prefs };
  clearTimeout(prefTimer);
  prefTimer = setTimeout(() => persist().catch(() => {}), 400);
}

function applyPrefs(prefs) {
  for (const id of PREF_IDS) {
    if (prefs[id] === undefined) continue;
    if ($(id).type === 'checkbox') $(id).checked = !!prefs[id];
    else $(id).value = prefs[id];
  }
  setStretch(prefs.stretch);
}

$('file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) loadBlob(f, f.name);
  e.target.value = '';
});
addEventListener('dragover', (e) => {
  e.preventDefault();
  $('empty').classList.add('over');
});
addEventListener('dragleave', () => $('empty').classList.remove('over'));
addEventListener('drop', (e) => {
  e.preventDefault();
  $('empty').classList.remove('over');
  const f = e.dataTransfer?.files?.[0];
  if (f) loadBlob(f, f.name);
});

$('play').addEventListener('click', togglePlay);
$('loop').addEventListener('click', () => {
  state.loop = !state.loop;
  $('loop').setAttribute('aria-pressed', String(state.loop));
  if (state.mode === 'source') playSource(state.lastT);
});
$('preview').addEventListener('click', togglePreview);
$('cut').addEventListener('click', doCut);
$('crop').addEventListener('click', doCrop);
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('zoomIn').addEventListener('click', () => zoomBy(0.5));
$('zoomOut').addEventListener('click', () => zoomBy(2));
$('zoomAll').addEventListener('click', () => wave.setView(0, wave.dur));
$('zoomSel').addEventListener('click', () => wave.sel && wave.setView(wave.sel[0], wave.sel[1]));
$('scroll').addEventListener('input', () => {
  const [a, b] = wave.view;
  const start = ($('scroll').value / 1000) * (wave.dur - (b - a));
  wave.setView(start, start + (b - a));
});

for (const btn of document.querySelectorAll('[data-target]')) {
  btn.addEventListener('click', () => {
    $('target').value = btn.dataset.target;
    savePrefs();
    update();
  });
}

for (const el of [...PREF_IDS.map($), ...document.querySelectorAll('input[name=stretch]')]) {
  el.addEventListener('input', () => {
    savePrefs();
    update();
  });
}

addEventListener('keydown', (e) => {
  if (!state.clip || document.querySelector('dialog[open]')) return;
  if (e.target.closest('input:not([type=checkbox]):not([type=range]):not([type=radio]), select, textarea, button')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'Delete') {
    doCut();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  }
});

async function init() {
  hydrateIcons();
  setBtn($('play'), 'play');
  setBtn($('preview'), 'play', 'Ergebnis anhören');
  state.settings = await loadSettings();
  applyPrefs(state.settings.prefs);
  update();

  send = initSend({
    settings: state.settings,
    persist,
    renderResult,
    fields: () => ({ name: $('name').value.trim(), emoji: $('emoji').value.trim(), format: $('format').value }),
  });
  send.refreshAll();

  const id = new URLSearchParams(location.search).get('clip');
  if (id) {
    try {
      const rec = await takeClip(id);
      if (rec) await loadBlob(rec.blob, rec.title);
      else setStatus('Die Aufnahme ist nicht mehr vorhanden.');
    } catch (e) {
      setStatus(`Aufnahme konnte nicht geladen werden (${e.message || e})`);
    }
  }
}

// Handle für die Entwicklerkonsole
globalThis.captureEdit = { state, wave, loadClip, renderResult };

init();
