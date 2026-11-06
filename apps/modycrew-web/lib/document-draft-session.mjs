import { normalizeDocumentDraft, readDocumentDraft, saveDocumentDraft } from './document-draft-storage.mjs';

const snapshot = value => JSON.parse(JSON.stringify(normalizeDocumentDraft(value)));
const hasContent = value => JSON.stringify({ ...value, appliedHandoffs: [], dirty: false }) !== JSON.stringify({ ...normalizeDocumentDraft({}), appliedHandoffs: [], dirty: false });

// Web Locks serialize windows of the same app. Comparing the observed value also
// prevents a stale editor from silently replacing changes saved in another window.
export function createDocumentDraftSession(storage, key, withLock) {
  let observed, loaded = false, closed = false, queue = Promise.resolve();
  const prefix = `${key}::history:`;
  function load() {
    const raw = storage.getItem(key);
    const draft = readDocumentDraft({ getItem: () => raw }, key);
    observed = raw; loaded = true;
    return draft;
  }
  function enqueue(action) {
    const task = queue.catch(() => {}).then(() => withLock(`modycrew-document:${key}`, () => {
      if (closed) throw new Error('문서 화면을 닫아 보관 요청을 중단했습니다.');
      if (!loaded) throw new Error('보관한 초안을 먼저 확인해야 합니다. 기존 내용은 보존했습니다.');
      return action();
    }));
    queue = task; return task;
  }
  function checkpoint(draft, reason) {
    if (!hasContent(draft)) return;
    const id = globalThis.crypto.randomUUID();
    if (storage.getItem(prefix + id) != null) throw new Error('초안 보관 번호가 겹쳤습니다. 다시 시도해 주세요.');
    storage.setItem(prefix + id, JSON.stringify({ version: 1, id, createdAt: Date.now(), reason, draft }));
  }
  return {
    load,
    save(value, previous, reason = '초안 변경 전') {
      const draft = snapshot(value), before = previous ? snapshot(previous) : null;
      return enqueue(() => {
        if (storage.getItem(key) !== observed) throw new Error('다른 창에서 초안이 변경됐습니다. 현재 편집본을 보관한 뒤 다른 창의 초안을 불러와 주세요.');
        // Opening another window without editing must not invalidate this editor.
        if (observed !== null && JSON.stringify(readDocumentDraft({ getItem: () => observed }, key)) === JSON.stringify(draft)) return;
        if (before && JSON.stringify(before) !== JSON.stringify(draft)) checkpoint(before, reason);
        saveDocumentDraft(storage, key, draft);
        observed = storage.getItem(key);
      });
    },
    reload(value) {
      const draft = snapshot(value);
      return enqueue(() => {
        // Validate the incoming revision before checkpointing/replacing the view.
        readDocumentDraft(storage, key);
        checkpoint(draft, '다른 창의 초안 불러오기 전');
        return load();
      });
    },
    history() {
      const entries = []; let unreadable = 0;
      for (let i = 0; i < storage.length; i++) {
        const itemKey = storage.key(i);
        if (!itemKey?.startsWith(prefix)) continue;
        try {
          const raw = storage.getItem(itemKey);
          if (!raw || raw.length > 2_002_000) throw new Error('size');
          const entry = JSON.parse(raw);
          if (entry.version !== 1 || itemKey !== prefix + entry.id || typeof entry.reason !== 'string' || !Number.isFinite(entry.createdAt)) throw new Error('format');
          entries.push({ ...entry, draft: snapshot(entry.draft) });
        } catch { unreadable++; }
      }
      return { entries: entries.sort((a, b) => b.createdAt - a.createdAt), unreadable };
    },
    close() { closed = true; },
  };
}
