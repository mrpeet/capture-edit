// Senden-Karte (Zielliste) und Ziele-Fenster (anlegen, bearbeiten, löschen, testen).
import { duration } from '../lib/clip.js';
import { encodeMp3, encodeWav } from '../lib/encode.js';
import { newId } from '../lib/settings.js';
import { ADDABLE, BUILTIN, PLACEHOLDERS, TYPES } from '../lib/targets.js';
import { icon, hydrateIcons } from './icons.js';
import { $, cleanName, esc, kb, secs, tick } from './util.js';

// host: { settings, persist, renderResult, fields: () => ({ name, emoji, format }) }
export function initSend(host) {
  const { settings } = host;
  const list = $('targets');
  const dlg = $('targetsDlg');
  const body = $('dlgBody');
  const infos = new Map(); // id -> { text, kind } für die Statuszeile je Ziel
  let editing = null; // id des gerade bearbeiteten Ziels

  const allTargets = () => [...BUILTIN, ...settings.targets, ...PLACEHOLDERS];
  const find = (id) => allTargets().find((t) => t.id === id);

  // ---------- Zielliste ----------

  function rowHtml(t) {
    const type = TYPES[t.type];
    const meta = [type.label, type.summary?.(t)].filter(Boolean).map(esc).join(' · ');
    return `<li class="target ${type.soon ? 'soon' : ''}" data-id="${t.id}">
      <span class="t-ico">${icon(type.icon)}</span>
      <div class="t-main">
        <strong>${esc(t.name)}</strong>
        <span class="t-meta">${meta}</span>
        <span class="t-info"></span>
        <span class="t-result"></span>
      </div>
      <button class="btn primary t-send" ${type.soon ? 'disabled' : ''}>${icon('send')}<span>${type.soon ? 'Bald' : 'Senden'}</span></button>
    </li>`;
  }

  function setInfo(id, text, kind = '', slot = 't-info') {
    infos.set(`${id}:${slot}`, { text, kind });
    const el = list.querySelector(`[data-id="${id}"] .${slot}`);
    if (el) {
      el.textContent = text;
      el.className = `${slot} ${kind}`;
    }
  }

  function renderTargets() {
    list.innerHTML = allTargets().map(rowHtml).join('');
    for (const [key, { text, kind }] of infos) {
      const [id, slot] = key.split(':');
      if (find(id)) setInfo(id, text, kind, slot);
    }
  }

  async function refreshStatus(t) {
    const type = TYPES[t.type];
    if (!type.status) return;
    setInfo(t.id, 'prüfe …');
    try {
      setInfo(t.id, await type.status(t));
    } catch (e) {
      setInfo(t.id, e.message, 'bad');
    }
  }

  async function refreshAll() {
    for (const t of settings.targets) await refreshStatus(t);
  }

  async function sendTo(t, btn) {
    const type = TYPES[t.type];
    btn.disabled = true;
    try {
      const { name, emoji, format: pick } = host.fields();
      const format = type.format === 'mp3' ? 'mp3' : pick;
      setInfo(t.id, 'Berechne …', '', 't-result');
      await tick();
      const res = host.renderResult();
      const blob = format === 'wav' ? encodeWav(res) : encodeMp3(res);
      const job = { blob, res, name, emoji, format, filename: `${cleanName(name)}.${format}` };
      type.check?.(t, job);
      setInfo(t.id, 'Sende …', '', 't-result');
      const msg = await type.send(t, job);
      setInfo(t.id, `${msg} · ${secs(duration(res))} · ${kb(blob.size)}`, 'ok', 't-result');
      if (type.status) refreshStatus(t);
    } catch (e) {
      setInfo(t.id, e.message || String(e), 'bad', 't-result');
      if (type.status) refreshStatus(t);
    } finally {
      btn.disabled = false;
    }
  }

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.t-send');
    const t = btn && find(btn.closest('.target').dataset.id);
    if (t) sendTo(t, btn);
  });

  // ---------- Ziele-Fenster ----------

  function viewList() {
    $('dlgTitle').textContent = 'Ziele';
    const items = settings.targets
      .map((t) => {
        const type = TYPES[t.type];
        return `<li class="tl-item">
          <span class="t-ico">${icon(type.icon)}</span>
          <div class="t-main"><strong>${esc(t.name)}</strong><span class="t-meta">${esc(type.label)} · ${esc(type.summary?.(t) ?? '')}</span></div>
          <button class="icon-btn sm" data-action="edit" data-id="${t.id}" title="Bearbeiten" aria-label="Bearbeiten">${icon('edit')}</button>
          <button class="icon-btn sm danger" data-action="delete" data-id="${t.id}" title="Löschen" aria-label="Löschen">${icon('trash')}</button>
        </li>`;
      })
      .join('');
    body.innerHTML = `
      <p class="muted">Hier legst du fest, wohin Clips gesendet werden können. Du kannst mehrere Discord-Server (auch mit verschiedenen Bots) und Ordner einrichten.</p>
      ${items ? `<ul class="tlist">${items}</ul>` : '<p class="empty">Noch kein eigenes Ziel eingerichtet.</p>'}
      <div class="form-actions"><button class="btn primary" data-action="pick">${icon('plus')}Ziel hinzufügen</button></div>`;
  }

  function viewPick() {
    $('dlgTitle').textContent = 'Ziel hinzufügen';
    const picks = ADDABLE.map((k) => {
      const t = TYPES[k];
      const sub = t.soon ? 'kommt später' : k === 'discord' ? 'Sound direkt ins Soundboard eines Servers laden' : 'Datei in einen Unterordner der Downloads legen';
      return `<button class="btn pick" data-action="new" data-type="${k}" ${t.soon ? 'disabled' : ''}>
        <span class="t-ico">${icon(t.icon)}</span><span><strong>${esc(t.label)}</strong><small>${sub}</small></span></button>`;
    }).join('');
    body.innerHTML = `<div class="picks">${picks}</div>
      <div class="form-actions"><button class="btn" data-action="list">${icon('chevron')}Zurück</button></div>`;
  }

  function viewForm(type, cfg) {
    const t = TYPES[type];
    $('dlgTitle').textContent = `${editing ? 'Bearbeiten' : 'Neu'}: ${t.label}`;
    const fields = t.fields
      .map(
        (f) => `<label class="field">${esc(f.label)}
          <input data-key="${f.key}" type="${f.secret ? 'password' : 'text'}" value="${esc(cfg[f.key] ?? '')}"
            placeholder="${esc(f.placeholder ?? '')}" autocomplete="off" spellcheck="false" ${f.numeric ? 'inputmode="numeric"' : ''} ${f.secret ? 'data-secret="1"' : ''}>
          ${f.help ? `<small class="help">${esc(f.help)}</small>` : ''}
        </label>${f.secret ? '<label class="inline-check"><input type="checkbox" data-action="reveal"> Token anzeigen</label>' : ''}`,
      )
      .join('');
    body.innerHTML = `
      ${fields}
      ${t.guide ? `<details class="guide"><summary>Wo finde ich das?</summary>${t.guide}</details>` : ''}
      <div class="form-actions">
        <button class="btn primary" data-action="save" data-type="${type}">${icon('check')}Speichern</button>
        ${t.probe ? `<button class="btn" data-action="test" data-type="${type}">Verbindung testen</button>` : ''}
        <button class="btn" data-action="list">Abbrechen</button>
      </div>
      <p id="formStatus" class="form-status" role="status"></p>`;
  }

  function readForm(type) {
    const t = TYPES[type];
    const cfg = { ...(editing ? find(editing) : { id: newId(), type }) };
    for (const input of body.querySelectorAll('[data-key]')) cfg[input.dataset.key] = input.value;
    return t.normalize ? t.normalize(cfg) : cfg;
  }

  const formStatus = (text, kind = '') => {
    const el = $('formStatus');
    el.textContent = text;
    el.className = `form-status ${kind}`;
  };

  body.addEventListener('change', (e) => {
    if (e.target.dataset.action !== 'reveal') return;
    for (const input of body.querySelectorAll('[data-secret]')) input.type = e.target.checked ? 'text' : 'password';
  });

  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.dataset.action === 'reveal') return;
    const { action, id, type } = btn.dataset;

    if (action === 'list') {
      editing = null;
      viewList();
    } else if (action === 'pick') {
      editing = null;
      viewPick();
    } else if (action === 'new') {
      editing = null;
      viewForm(type, { name: '' });
    } else if (action === 'edit') {
      editing = id;
      viewForm(find(id).type, find(id));
    } else if (action === 'delete') {
      const t = find(id);
      if (!confirm(`Ziel „${t.name}“ löschen?`)) return;
      settings.targets = settings.targets.filter((x) => x.id !== id);
      infos.delete(`${id}:t-info`);
      infos.delete(`${id}:t-result`);
      await host.persist();
      renderTargets();
      viewList();
    } else if (action === 'test') {
      const cfg = readForm(type);
      const problem = TYPES[type].validate?.(cfg);
      if (problem) return formStatus(problem, 'bad');
      btn.disabled = true;
      formStatus('Prüfe …');
      try {
        formStatus(await TYPES[type].probe(cfg), 'ok');
      } catch (err) {
        formStatus(err.message, 'bad');
      } finally {
        btn.disabled = false;
      }
    } else if (action === 'save') {
      const cfg = readForm(type);
      const problem = TYPES[type].validate?.(cfg);
      if (problem) return formStatus(problem, 'bad');
      const i = settings.targets.findIndex((x) => x.id === cfg.id);
      if (i >= 0) settings.targets[i] = cfg;
      else settings.targets.push(cfg);
      await host.persist();
      editing = null;
      renderTargets();
      viewList();
      refreshStatus(cfg);
    }
  });

  function openDialog(view = 'list') {
    editing = null;
    if (view === 'pick') viewPick();
    else viewList();
    if (!dlg.open) dlg.showModal();
  }

  $('openTargets').addEventListener('click', () => openDialog('list'));
  $('manageTargets').addEventListener('click', () => openDialog('list'));
  $('addTarget').addEventListener('click', () => openDialog('pick'));
  $('dlgClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close(); // Klick auf den Hintergrund
  });

  hydrateIcons(document);
  renderTargets();
  return { renderTargets, refreshAll };
}
