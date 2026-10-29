// Sende-Ziele. Neuer Typ = ein Eintrag in TYPES (Felder fürs Formular, validate, send, optional probe/status/check).
// send(cfg, job) bekommt job = { blob, res, name, emoji, format, filename } und liefert einen Erfolgstext.
import { api } from './api.js';
import { duration } from './clip.js';
import { slotStatus, uploadSound, whoAmI, cleanToken, MAX_SECONDS, MAX_BYTES } from './discord.js';

const DISCORD_ORIGINS = { origins: ['https://discord.com/*'] };
const DOWNLOADS = { permissions: ['downloads'] };

async function hasAccess(perm) {
  try {
    return await api.permissions.contains(perm);
  } catch {
    return true; // z. B. Entwicklungsserver ohne Extension-API
  }
}

async function ensureAccess(perm) {
  if (await hasAccess(perm)) return true;
  try {
    return await api.permissions.request(perm);
  } catch {
    return false;
  }
}

export function cleanSubfolder(raw = '') {
  return raw
    .split(/[\\/]+/)
    .map((p) => p.trim().replace(/[<>:"|?*\u0000-\u001f]/g, '_'))
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
}

export function anchorDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function slotText(s) {
  if (s.count === null) return `Server „${s.guildName}“ erreichbar, aber die Soundboard-Liste nicht (${s.problem}). Der Upload kann trotzdem klappen.`;
  const full = s.count >= s.limit ? ' – voll' : '';
  return `${s.count} von ${s.limit} Plätzen belegt (Level ${s.tier}, geschätzt)${full}`;
}

const secs = (s) => `${s.toFixed(2).replace('.', ',')} s`;
const kb = (n) => `${Math.round(n / 1024)} KB`;

export const TYPES = {
  download: {
    label: 'Datei speichern',
    icon: 'download',
    format: 'user',
    fields: [],
    summary: () => 'MP3 oder WAV',
    async send(_cfg, job) {
      anchorDownload(job.blob, job.filename);
      return `Gespeichert: ${job.filename}`;
    },
  },

  discord: {
    label: 'Discord-Soundboard',
    icon: 'discord',
    format: 'mp3',
    fields: [
      { key: 'name', label: 'Anzeigename', placeholder: 'z. B. Freunde-Server' },
      { key: 'token', label: 'Bot-Token', secret: true, placeholder: 'langer Text aus Bot → Token' },
      { key: 'guildId', label: 'Server-ID', placeholder: 'nur Ziffern', numeric: true },
    ],
    guide: `<ol>
      <li><b>Token:</b> discord.com/developers/applications → deine App → <i>Bot</i> → <i>Reset Token</i> → sofort kopieren. Es gilt immer nur der neueste.</li>
      <li><b>Server-ID:</b> In Discord den Entwicklermodus einschalten (Einstellungen → Erweitert), dann Rechtsklick auf den Server → <i>Server-ID kopieren</i>.</li>
      <li><b>Bot einladen:</b> OAuth2 → URL Generator → Scope <i>bot</i> + Berechtigung <i>Create Expressions</i> → Link öffnen. Für mehrere Server den Bot einfach auf jeden einladen und hier je Server ein Ziel anlegen.</li>
    </ol>`,
    normalize: (c) => ({ ...c, name: (c.name ?? '').trim(), token: cleanToken(c.token ?? ''), guildId: (c.guildId ?? '').trim() }),
    validate(c) {
      if (!c.name) return 'Bitte einen Anzeigenamen eintragen.';
      if (c.token.length < 30) return 'Der Bot-Token fehlt oder ist zu kurz.';
      if (!/^\d{15,25}$/.test(c.guildId)) return 'Die Server-ID besteht nur aus Ziffern (15–25 Stück).';
      return null;
    },
    summary: (c) => (c.guildId ? `Server …${c.guildId.slice(-4)}` : 'nicht eingerichtet'),
    check(_c, job) {
      if (job.name.length < 2 || job.name.length > 32) throw new Error('Der Name braucht 2–32 Zeichen.');
      const len = duration(job.res);
      if (len > MAX_SECONDS) throw new Error(`Ergebnis ist ${secs(len)} lang – Discord erlaubt max. 5,2 s.`);
      if (job.blob.size > MAX_BYTES) throw new Error(`MP3 hat ${kb(job.blob.size)} – Discord erlaubt max. 512 KB.`);
    },
    async probe(c) {
      if (!(await ensureAccess(DISCORD_ORIGINS))) throw new Error('Zugriff auf discord.com wurde nicht erlaubt.');
      const me = await whoAmI(c.token);
      try {
        return `Verbunden als „${me.username}“. ${slotText(await slotStatus(c.token, c.guildId))}`;
      } catch (e) {
        throw new Error(`Token ist gültig (Bot „${me.username}“), aber: ${e.message}`);
      }
    },
    async status(c) {
      const problem = this.validate(this.normalize(c));
      if (problem) return problem;
      if (!(await hasAccess(DISCORD_ORIGINS))) return 'Zugriff auf discord.com fehlt – wird beim Senden erfragt';
      return slotText(await slotStatus(c.token, c.guildId));
    },
    async send(c, job) {
      if (!(await ensureAccess(DISCORD_ORIGINS))) throw new Error('Zugriff auf discord.com wurde nicht erlaubt.');
      await uploadSound(c.token, c.guildId, { name: job.name, blob: job.blob, emojiName: job.emoji || null });
      return `„${job.name}“ ist im Soundboard von ${c.name}`;
    },
  },

  folder: {
    label: 'Ordner',
    icon: 'folder',
    format: 'user',
    fields: [
      { key: 'name', label: 'Anzeigename', placeholder: 'z. B. Sample-Sammlung' },
      { key: 'subfolder', label: 'Unterordner im Download-Ordner', placeholder: 'Soundboard/Memes', help: 'Browser dürfen nur in den Download-Ordner schreiben. Der Unterordner wird bei Bedarf angelegt.' },
    ],
    normalize: (c) => ({ ...c, name: (c.name ?? '').trim(), subfolder: cleanSubfolder(c.subfolder ?? '') }),
    validate: (c) => (c.name ? null : 'Bitte einen Anzeigenamen eintragen.'),
    summary: (c) => `Downloads/${c.subfolder ?? ''}`,
    async send(c, job) {
      const sub = cleanSubfolder(c.subfolder);
      if (!api?.downloads) {
        anchorDownload(job.blob, job.filename);
        return `Gespeichert: ${job.filename}`;
      }
      if (!(await ensureAccess(DOWNLOADS))) throw new Error('Berechtigung „Downloads“ wurde nicht erlaubt.');
      const url = URL.createObjectURL(job.blob);
      try {
        await api.downloads.download({ url, filename: sub ? `${sub}/${job.filename}` : job.filename, conflictAction: 'uniquify', saveAs: false });
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      return `Gespeichert in Downloads/${sub ? `${sub}/` : ''}${job.filename}`;
    },
  },

  // Platzhalter: hier kommt später die Übertragung zum PocketSampler hin.
  device: {
    label: 'Gerät',
    icon: 'cpu',
    soon: true,
    format: 'user',
    fields: [],
    summary: () => 'kommt später',
  },
};

export const ADDABLE = ['discord', 'folder', 'device'];
export const BUILTIN = [{ id: '__download', type: 'download', name: 'Herunterladen' }];
export const PLACEHOLDERS = [{ id: '__device', type: 'device', name: 'PocketSampler' }];
