const API = 'https://discord.com/api/v10';

export const MAX_SECONDS = 5.2;
export const MAX_BYTES = 512 * 1024;
// Soundboard-Plätze je Boost-Level des Servers (Level 0–3); Schätzwert, der Upload meldet den echten Fehler.
export const SLOT_LIMITS = [8, 24, 36, 48];

export class DiscordError extends Error {
  constructor(status, body, path = '') {
    super(describe(status, body, path));
    this.status = status;
    this.body = body;
  }
}

function describe(status, body, path) {
  const detail = body?.message ? ` (${body.message})` : '';
  const where = path ? ` [${path.replace(/\d{15,}/g, '…')}]` : '';
  if (status === 401) return `Token ungültig${detail} – nach jedem „Reset Token“ gilt nur der neueste`;
  if (body?.code === 50001) return `Bot sieht diesen Server nicht – falsche Server-ID oder Bot nicht eingeladen${detail}${where}`;
  if (body?.code === 40333) return `Discord-Netzwerkfehler${detail}${where}`;
  if (status === 403) return `Bot darf das nicht – braucht "Create Expressions"${detail}${where}`;
  if (status === 404) return `Server nicht gefunden – falsche Server-ID oder Bot nicht auf dem Server${detail}${where}`;
  return `Discord-Fehler ${status}${detail}${where}`;
}

// Entfernt Leerzeichen, Anführungszeichen und ein versehentlich mitkopiertes "Bot ".
export const cleanToken = (raw) => raw.trim().replace(/^["']|["']$/g, '').replace(/^Bot\s+/i, '').trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(token, method, path, body, retry = true) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bot ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Keine Verbindung zu discord.com – Internet oder Browser-Berechtigung prüfen');
  }
  if (res.status === 429 && retry) {
    const j = await res.json().catch(() => ({}));
    await sleep(Math.min((j.retry_after ?? 1) * 1000, 10000));
    return request(token, method, path, body, false);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new DiscordError(res.status, data, `${method} ${path}`);
  return data;
}

export async function blobToDataUri(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'audio/mpeg'};base64,${btoa(bin)}`;
}

// Prüft nur den Token (ohne Server): liefert den Bot-Namen.
export const whoAmI = (token) => request(token, 'GET', '/users/@me');

export async function slotStatus(token, guildId) {
  const [guild, sounds] = await Promise.allSettled([
    request(token, 'GET', `/guilds/${guildId}`),
    request(token, 'GET', `/guilds/${guildId}/soundboard-sounds`),
  ]);
  if (guild.status === 'rejected' && sounds.status === 'rejected') throw guild.reason;
  const info = guild.value ?? {};
  const tier = info.premium_tier ?? 0;
  return {
    guildName: info.name ?? 'Server',
    tier,
    // Die Liste ist nur für die Platzanzeige nötig; fällt sie aus, kann der Upload trotzdem gehen.
    count: sounds.value?.items.length ?? null,
    limit: SLOT_LIMITS[tier] ?? SLOT_LIMITS[0],
    problem: sounds.reason?.message ?? null,
  };
}

export async function uploadSound(token, guildId, { name, blob, volume = 1, emojiName = null }) {
  const body = { name, sound: await blobToDataUri(blob), volume };
  if (emojiName) body.emoji_name = emojiName;
  return request(token, 'POST', `/guilds/${guildId}/soundboard-sounds`, body);
}
