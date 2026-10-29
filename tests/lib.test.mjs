import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { duration, slice, cut, applyFades, normalize, peak, resampleRate } from '../src/lib/clip.js';
import { stretchTempo, stretchSpeed } from '../src/lib/timestretch.js';
import { encodeWav, encodeMp3 } from '../src/lib/encode.js';
import { uploadSound, slotStatus, whoAmI, cleanToken, DiscordError } from '../src/lib/discord.js';
import { migrate } from '../src/lib/settings.js';
import { TYPES, cleanSubfolder } from '../src/lib/targets.js';

const SR = 44100;

function sine(freq, sec, amp = 0.8, channels = 1) {
  const n = Math.round(sec * SR);
  const make = () => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));
  return { sampleRate: SR, channels: Array.from({ length: channels }, make) };
}

// Frequenz über Nulldurchgänge (aufsteigend) schätzen, Rand ignorieren.
function estimateFreq(clip) {
  const ch = clip.channels[0];
  const from = Math.round(clip.sampleRate * 0.1);
  const to = ch.length - from;
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (ch[i - 1] < 0 && ch[i] >= 0) crossings++;
  return crossings / ((to - from) / clip.sampleRate);
}

test('slice, cut und Dauer', () => {
  const c = sine(440, 3);
  assert.ok(Math.abs(duration(slice(c, 1, 2)) - 1) < 1e-4);
  assert.ok(Math.abs(duration(cut(c, 1, 2)) - 2) < 1e-4);
});

test('Fades setzen Rand auf 0, Mitte bleibt', () => {
  const c = { sampleRate: SR, channels: [new Float32Array(SR).fill(1)] };
  const f = applyFades(c, 0.1, 0.1);
  assert.equal(f.channels[0][0], 0);
  assert.equal(f.channels[0][SR - 1], 0);
  assert.equal(f.channels[0][SR / 2], 1);
});

test('normalize bringt Spitze auf 0,97', () => {
  const n = normalize(sine(440, 1, 0.2));
  assert.ok(Math.abs(peak(n) - 0.97) < 1e-3);
});

test('Tempo-Stretch: Länge stimmt, Tonhöhe bleibt, Pegel bleibt', () => {
  const out = stretchTempo(sine(440, 3), 2);
  assert.equal(out.channels[0].length, 2 * SR);
  assert.ok(Math.abs(estimateFreq(out) - 440) < 12, `Frequenz ${estimateFreq(out)}`);
  assert.ok(peak(out) > 0.6 && peak(out) < 1.05, `Spitze ${peak(out)}`);
  // Mitte darf nicht einbrechen (Fenster-Überlappung)
  const mid = out.channels[0].subarray(SR * 0.9, SR * 1.1);
  assert.ok(mid.reduce((m, s) => Math.max(m, Math.abs(s)), 0) > 0.6);
});

test('Tempo-Stretch erhält Stereo', () => {
  const out = stretchTempo(sine(300, 2, 0.8, 2), 1.5);
  assert.equal(out.channels.length, 2);
  assert.equal(out.channels[1].length, Math.round(1.5 * SR));
});

test('Speed-Stretch ändert Tonhöhe mit dem Faktor', () => {
  const out = stretchSpeed(sine(440, 3), 2);
  assert.equal(out.channels[0].length, 2 * SR);
  assert.ok(Math.abs(estimateFreq(out) - 660) < 15, `Frequenz ${estimateFreq(out)}`);
});

test('resampleRate behält die Dauer', () => {
  const r = resampleRate(sine(440, 1), 22050);
  assert.equal(r.sampleRate, 22050);
  assert.ok(Math.abs(duration(r) - 1) < 1e-3);
});

test('WAV: Header und Größe', async () => {
  const blob = encodeWav(sine(440, 1, 0.5, 2));
  const buf = new Uint8Array(await blob.arrayBuffer());
  assert.equal(String.fromCharCode(...buf.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...buf.slice(8, 12)), 'WAVE');
  assert.equal(buf.length, 44 + SR * 2 * 2);
});

test('MP3: 5 s Stereo bleiben weit unter 512 KB', async () => {
  vm.runInThisContext(readFileSync(new URL('../src/vendor/lame.min.js', import.meta.url), 'utf8'));
  const blob = encodeMp3(sine(440, 5, 0.5, 2), 128);
  assert.equal(blob.type, 'audio/mpeg');
  assert.ok(blob.size > 40000 && blob.size < 120000, `Größe ${blob.size}`);
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  assert.ok(head[0] === 0xff && (head[1] & 0xe0) === 0xe0, 'MP3-Frame-Header');
});

test('Discord: Upload-Request und Slot-Abfrage', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (init.method === 'POST') return json(200, { name: 'x' });
    if (url.endsWith('/soundboard-sounds')) return json(200, { items: [{}, {}, {}] });
    return json(200, { name: 'Testserver', premium_tier: 1 });
  };
  await uploadSound('TOKEN', '123', { name: 'boom', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }), volume: 0.5, emojiName: '🔥' });
  const post = calls[0];
  assert.equal(post.url, 'https://discord.com/api/v10/guilds/123/soundboard-sounds');
  assert.equal(post.init.headers.Authorization, 'Bot TOKEN');
  const body = JSON.parse(post.init.body);
  assert.equal(body.name, 'boom');
  assert.equal(body.volume, 0.5);
  assert.equal(body.emoji_name, '🔥');
  assert.equal(body.sound, 'data:audio/mpeg;base64,AQID');

  assert.deepEqual(await slotStatus('TOKEN', '123'), { guildName: 'Testserver', tier: 1, count: 3, limit: 24, problem: null });
});

test('Discord: Token bereinigen', () => {
  assert.equal(cleanToken('  abc.def.ghi \n'), 'abc.def.ghi');
  assert.equal(cleanToken('"abc.def.ghi"'), 'abc.def.ghi');
  assert.equal(cleanToken('Bot abc.def.ghi'), 'abc.def.ghi');
});

test('Discord: whoAmI und Fehlertexte für Token/Server/Netz', async () => {
  globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => ({ username: 'MeinBot', url }) });
  assert.equal((await whoAmI('T')).username, 'MeinBot');

  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: '401: Unauthorized' }) });
  await assert.rejects(() => whoAmI('T'), /Token ungültig.*Reset Token/);

  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ code: 50001, message: 'Missing Access' }) });
  await assert.rejects(() => slotStatus('T', '1'), /Bot sieht diesen Server nicht/);

  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(() => whoAmI('T'), /Keine Verbindung zu discord\.com/);
});

test('Discord: Liste fällt aus, Server bleibt erreichbar', async () => {
  globalThis.fetch = async (url) =>
    url.endsWith('/soundboard-sounds')
      ? { ok: false, status: 403, json: async () => ({ code: 40333, message: 'internal network error' }) }
      : { ok: true, status: 200, json: async () => ({ name: 'Testserver', premium_tier: 0 }) };
  const s = await slotStatus('T', '123456789012345678');
  assert.equal(s.count, null);
  assert.match(s.problem, /Discord-Netzwerkfehler.*GET \/guilds\/….*soundboard-sounds/);
});

test('Manifeste verweisen auf vorhandene, gültige Regeldatei', () => {
  for (const name of ['chrome', 'firefox']) {
    const m = JSON.parse(readFileSync(new URL(`../manifests/${name}.json`, import.meta.url), 'utf8'));
    assert.ok(m.permissions.includes('declarativeNetRequestWithHostAccess'));
    for (const r of m.declarative_net_request.rule_resources) {
      const rules = JSON.parse(readFileSync(new URL(`../src/${r.path}`, import.meta.url), 'utf8'));
      assert.equal(rules[0].action.type, 'modifyHeaders');
    }
  }
});

test('Einstellungen: altes Format wird zum Discord-Ziel', () => {
  const s = migrate({ token: 'T'.repeat(40), guildId: '123456789012345678', prefs: { target: 4 } });
  assert.equal(s.targets.length, 1);
  assert.deepEqual([s.targets[0].type, s.targets[0].token.length, s.targets[0].guildId], ['discord', 40, '123456789012345678']);
  assert.equal(s.token, undefined);
  assert.equal(s.prefs.target, 4);
  assert.equal(s.prefs.fadeOut, 30); // Standardwerte bleiben

  assert.deepEqual(migrate(null).targets, []);
  const neu = { targets: [{ id: 'a', type: 'folder', name: 'x' }] };
  assert.deepEqual(migrate(neu).targets, neu.targets);
});

test('Ziele: Unterordner bereinigen, Discord prüfen', () => {
  assert.equal(cleanSubfolder('..\\Sound//Memes<>/'), 'Sound/Memes__');
  assert.equal(cleanSubfolder('  /  '), '');
  const d = TYPES.discord;
  const ok = d.normalize({ name: ' A ', token: 'Bot ' + 'T'.repeat(40), guildId: ' 123456789012345678 ' });
  assert.equal(d.validate(ok), null);
  assert.equal(ok.token, 'T'.repeat(40));
  assert.match(d.validate({ ...ok, guildId: 'abc' }), /Server-ID/);
  assert.match(d.validate({ ...ok, token: 'kurz' }), /Token/);
  assert.match(d.validate({ ...ok, name: '' }), /Anzeigename/);
  assert.throws(() => d.check({}, { name: 'a', res: sine(440, 1), blob: new Blob([]) }), /2–32/);
  assert.throws(() => d.check({}, { name: 'okay', res: sine(440, 6), blob: new Blob([]) }), /5,2 s/);
  assert.ok(TYPES.device.soon);
});

test('Discord: Fehlertexte', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ message: 'Missing Permissions' }) });
  await assert.rejects(() => slotStatus('T', '1'), (e) => e instanceof DiscordError && /Create Expressions/.test(e.message));
});
