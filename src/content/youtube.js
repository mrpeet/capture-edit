// Content-Script (klassisch, kein Modul): kleines Panel auf YouTube, das den Ton des <video> aufnimmt.
(() => {
  if (window.__captureEditLoaded) return;
  window.__captureEditLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;
  let session = null;

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:64px;right:12px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      .pill { display:flex; align-items:center; gap:6px; padding:5px 8px; border-radius:18px;
        background:rgba(20,22,26,.92); color:#e6e8ec; font:12px/1.2 system-ui,sans-serif;
        box-shadow:0 2px 10px rgba(0,0,0,.45); }
      button, select { font:inherit; color:inherit; background:#2a2e37; border:1px solid #444b59;
        border-radius:12px; padding:3px 9px; cursor:pointer; }
      button:hover { border-color:#60a5fa; }
      button.rec { background:#b91c1c; border-color:#b91c1c; color:#fff; }
      button.x { border:0; background:none; padding:0 3px; color:#9aa1ad; }
      .msg { max-width:210px; color:#fbbf24; }
      .msg:empty { display:none; }
    </style>
    <div class="pill">
      <button id="rec" class="rec">● Clip aufnehmen</button>
      <select id="max" title="Automatisch stoppen nach">
        <option value="15">15 s</option><option value="30">30 s</option>
        <option value="60" selected>60 s</option><option value="120">120 s</option>
      </select>
      <button id="open" title="Editor öffnen">Editor</button>
      <span id="msg" class="msg"></span>
      <button id="close" class="x" title="Ausblenden bis zum Neuladen">×</button>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = (id) => root.getElementById(id);
  const say = (text) => ($('msg').textContent = text);
  const clock = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const pickVideo = () => document.querySelector('video.html5-main-video') || document.querySelector('video');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function cleanTitle() {
    return document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube( Music)?$/, '').trim();
  }

  async function start() {
    const video = pickVideo();
    if (!video) return say('Kein Video auf dieser Seite gefunden.');
    if (video.paused) await video.play().catch(() => {});

    let stream;
    try {
      stream = (video.captureStream || video.mozCaptureStream).call(video);
    } catch (e) {
      return say(`Aufnahme nicht möglich: ${e.message}`);
    }
    let tracks = stream.getAudioTracks();
    if (!tracks.length) {
      await sleep(600);
      tracks = stream.getAudioTracks();
    }
    if (!tracks.length) return say('Keine Audiospur gefunden (Werbung oder geschützter Inhalt?).');

    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => finish(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));

    const maxMs = Number($('max').value) * 1000;
    const began = performance.now();
    const timer = setInterval(() => {
      const ms = performance.now() - began;
      $('rec').textContent = `■ Stopp ${clock(ms)}`;
      if (ms >= maxMs) stop();
    }, 200);
    const onEnded = () => stop();
    video.addEventListener('ended', onEnded);

    session = { recorder, timer, video, onEnded };
    recorder.start();
    say('');
    $('rec').textContent = '■ Stopp 00:00';
  }

  function stop() {
    if (!session) return;
    const { recorder, timer, video, onEnded } = session;
    clearInterval(timer);
    video.removeEventListener('ended', onEnded);
    session = null;
    $('rec').textContent = '● Clip aufnehmen';
    if (recorder.state !== 'inactive') recorder.stop();
  }

  function toDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  async function finish(blob) {
    if (!blob.size) return say('Es wurde nichts aufgenommen.');
    say('Sende an Editor …');
    try {
      const reply = await api.runtime.sendMessage({ type: 'clip', dataUrl: await toDataUrl(blob), title: cleanTitle() });
      say(reply?.ok === false ? `Fehler: ${reply.error}` : '');
    } catch {
      say('Erweiterung wurde neu geladen – bitte die Seite neu laden.');
    }
  }

  $('rec').addEventListener('click', () => (session ? stop() : start()));
  $('open').addEventListener('click', () => api.runtime.sendMessage({ type: 'open-editor' }).catch(() => say('Seite neu laden.')));
  $('close').addEventListener('click', () => {
    stop();
    host.remove();
  });
})();
