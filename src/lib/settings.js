import { api } from './api.js';

const KEY = 'captureedit.settings';

export const DEFAULTS = {
  // Ziele: { id, type, name, ...Felder des Typs } – siehe lib/targets.js
  targets: [],
  prefs: { target: 5, stretch: 'tempo', fadeIn: 5, fadeOut: 30, volume: 100, normalize: false, format: 'mp3' },
};

export const newId = () => Math.random().toString(36).slice(2, 10);

// Frühere Version: ein Token und eine Server-ID direkt in den Einstellungen -> wird zum ersten Discord-Ziel.
export function migrate(raw) {
  const s = { ...structuredClone(DEFAULTS), ...raw, prefs: { ...DEFAULTS.prefs, ...raw?.prefs } };
  if (!Array.isArray(raw?.targets)) {
    s.targets = raw?.token || raw?.guildId
      ? [{ id: 'discord-1', type: 'discord', name: 'Discord', token: raw.token ?? '', guildId: raw.guildId ?? '' }]
      : [];
  }
  delete s.token;
  delete s.guildId;
  return s;
}

const store = api?.storage?.local;

export async function loadSettings() {
  try {
    const raw = store ? (await store.get(KEY))[KEY] : JSON.parse(localStorage.getItem(KEY) || 'null');
    return migrate(raw);
  } catch {
    return migrate(null);
  }
}

export async function saveSettings(settings) {
  if (store) await store.set({ [KEY]: settings });
  else localStorage.setItem(KEY, JSON.stringify(settings));
}
