// Firefox liefert `browser` (Promises), Chromium `chrome` (MV3 ebenfalls mit Promises).
export const api = globalThis.browser ?? globalThis.chrome;
