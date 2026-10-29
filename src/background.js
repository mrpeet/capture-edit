import { api } from './lib/api.js';
import { putClip } from './lib/clipstore.js';

const editorUrl = (query = '') => api.runtime.getURL(`editor/editor.html${query}`);

api.action.onClicked.addListener(() => api.tabs.create({ url: editorUrl() }));

async function handleClip({ dataUrl, title }) {
  const blob = await (await fetch(dataUrl)).blob();
  const id = await putClip(blob, title);
  await api.tabs.create({ url: editorUrl(`?clip=${id}`) });
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'clip') {
    handleClip(msg).then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ ok: false, error: String(e?.message || e) }),
    );
    return true; // Antwort kommt asynchron
  }
  if (msg?.type === 'open-editor') {
    api.tabs.create({ url: editorUrl() });
    sendResponse({ ok: true });
  }
});
