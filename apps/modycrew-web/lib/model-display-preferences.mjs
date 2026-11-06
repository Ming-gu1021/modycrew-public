export const MODEL_DISPLAY_KEY = 'modycrew-model-display-v1';
export const MODEL_DISPLAY_EVENT = 'modycrew-model-display-changed';
export const modelDisplayId = choice => JSON.stringify([choice.provider, choice.id]);
export function readHiddenModels(storage) {
  const raw = storage.getItem(MODEL_DISPLAY_KEY);
  if (raw === null) return [];
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.hidden) || !data.hidden.every(id => typeof id === 'string')) throw new Error('표시 설정을 읽지 못했습니다. 기존 설정은 보존됩니다.');
  return [...new Set(data.hidden)];
}
export function saveHiddenModels(storage, hidden) {
  storage.setItem(MODEL_DISPLAY_KEY, JSON.stringify({ version: 1, hidden: [...new Set(hidden)] }));
}
export function visibleModels(choices, hidden) {
  const excluded = new Set(hidden);
  return choices.filter(choice => choice.ready && choice.id && !excluded.has(modelDisplayId(choice)));
}
