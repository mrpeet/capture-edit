// Übergabe von Aufnahmen: Hintergrundskript legt ab, Editor holt ab (IndexedDB der Extension).
const DB = 'captureedit';
const STORE = 'clips';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req?.result);
    };
    t.onerror = t.onabort = () => {
      db.close();
      reject(t.error);
    };
  });
}

export async function putClip(blob, title = '') {
  const id = crypto.randomUUID();
  await tx('readwrite', (s) => {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    s.openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) return;
      if (cur.value.created < cutoff) cur.delete();
      cur.continue();
    };
    return s.put({ id, blob, title, created: Date.now() });
  });
  return id;
}

export async function takeClip(id) {
  const rec = await tx('readonly', (s) => s.get(id));
  if (rec) await tx('readwrite', (s) => s.delete(id));
  return rec;
}
