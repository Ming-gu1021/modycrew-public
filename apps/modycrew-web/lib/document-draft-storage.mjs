const prefix = 'modycrew-document-draft-v2:';
const limit = 2_000_000;
const formats = ['docx', 'pptx', 'xlsx', 'pdf', 'hwpx', 'hwp'];
const isText = (v) => typeof v === 'string';
const isList = (v) => Array.isArray(v) && v.every(isText);
const isFields = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isText);

export function documentDraftKey(account, root) {
  if (!isText(account) || !account || !isText(root) || !root) throw new Error('초안을 보관할 계정과 저장소를 확인하지 못했습니다.');
  return prefix + encodeURIComponent(JSON.stringify([account, root]));
}

export function normalizeDocumentDraft(value) {
  if (!value || typeof value !== 'object') throw new Error('저장한 초안의 형식을 읽을 수 없습니다.');
  const draft = {};
  for (const key of ['title', 'source', 'company', 'author', 'period', 'templateId', 'companyTemplateId', 'from', 'to', 'query']) {
    if (value[key] !== undefined && !isText(value[key])) throw new Error('저장한 초안의 글을 읽을 수 없습니다.');
    draft[key] = value[key] ?? (key === 'templateId' ? 'general' : '');
  }
  for (const key of ['sources', 'companySourceIds', 'appliedHandoffs']) {
    if (value[key] !== undefined && !isList(value[key])) throw new Error('저장한 초안의 자료 목록을 읽을 수 없습니다.');
    draft[key] = value[key] ?? [];
  }
  for (const key of ['mapping', 'fields']) {
    if (value[key] !== undefined && !isFields(value[key])) throw new Error('저장한 양식의 값을 읽을 수 없습니다.');
    draft[key] = value[key] ?? {};
  }
  draft.format = formats.includes(value.format) ? value.format : 'docx';
  draft.spec = value.spec ?? null;
  if (draft.spec) {
    const spec = draft.spec;
    if (!['title', 'templateId', 'company', 'author', 'period'].every(key => isText(spec[key])) || !isList(spec.sources) || !isList(spec.notes) || !Array.isArray(spec.sections) || !spec.sections.every(section =>
      section && isText(section.heading) && isList(section.paragraphs) && (!section.table || isList(section.table.columns) && Array.isArray(section.table.rows) && section.table.rows.every(row => isList(row) && row.length === section.table.columns.length)))) {
      throw new Error('저장한 초안의 본문이나 표를 읽을 수 없습니다. 기존 내용은 보존했습니다.');
    }
  }
  draft.workLink = value.workLink && isText(value.workLink.threadId) && isText(value.workLink.root) ? { threadId: value.workLink.threadId, root: value.workLink.root } : null;
  draft.dirty = Boolean(value.dirty);
  if (JSON.stringify(draft).length > limit) throw new Error('초안이 자동 보관 용량을 초과했습니다. 자료를 나누거나 파일로 저장해 주세요.');
  return draft;
}

export function readDocumentDraft(storage, key) {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  if (raw.length > limit + 1000) throw new Error('보관한 초안의 크기를 확인할 수 없습니다. 기존 내용은 보존했습니다.');
  const envelope = JSON.parse(raw);
  if (envelope.version !== 2) throw new Error('이 버전에서 읽을 수 없는 초안입니다. 기존 내용은 보존했습니다.');
  return normalizeDocumentDraft(envelope.draft);
}

export function saveDocumentDraft(storage, key, value) {
  const draft = normalizeDocumentDraft(value);
  // setItem is atomic: quota/permission failures leave the previous draft intact.
  storage.setItem(key, JSON.stringify({ version: 2, savedAt: Date.now(), draft }));
}
