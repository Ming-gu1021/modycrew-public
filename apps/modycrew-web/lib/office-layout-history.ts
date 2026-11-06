import { normalizeOfficeSeat, sameOfficeLayout, type OfficeSeat, type OfficeSeatLayout } from './office-room-layout';

export type OfficeLayoutHistory = { past: OfficeSeatLayout[]; present: OfficeSeatLayout; future: OfficeSeatLayout[]; gesture: OfficeSeatLayout | null };
type Action = { type: 'load'; layout: OfficeSeatLayout } | { type: 'replace'; layout: OfficeSeatLayout } | { type: 'seat'; id: string; seat: OfficeSeat } | { type: 'begin' } | { type: 'end' } | { type: 'undo' } | { type: 'redo' };
export const createOfficeLayoutHistory = (layout: OfficeSeatLayout = {}): OfficeLayoutHistory => ({ past: [], present: layout, future: [], gesture: null });
const append = (past: OfficeSeatLayout[], layout: OfficeSeatLayout) => [...past.slice(-49), layout];

export function officeLayoutHistory(state: OfficeLayoutHistory, action: Action): OfficeLayoutHistory {
  if (action.type === 'load') return createOfficeLayoutHistory(action.layout);
  if (action.type === 'begin') return state.gesture ? state : { ...state, gesture: state.present };
  if (action.type === 'end') {
    if (!state.gesture) return state;
    return sameOfficeLayout(state.gesture, state.present) ? { ...state, gesture: null } : { ...state, past: append(state.past, state.gesture), future: [], gesture: null };
  }
  if (action.type === 'undo' || action.type === 'redo') {
    const settled = officeLayoutHistory(state, { type: 'end' });
    if (action.type === 'undo') {
      if (!settled.past.length) return settled;
      return { past: settled.past.slice(0, -1), present: settled.past.at(-1)!, future: [settled.present, ...settled.future], gesture: null };
    }
    if (!settled.future.length) return settled;
    return { past: append(settled.past, settled.present), present: settled.future[0], future: settled.future.slice(1), gesture: null };
  }
  const next = action.type === 'seat' ? { ...state.present, [action.id]: action.seat } : action.layout;
  if (sameOfficeLayout(state.present, next)) return state;
  return { ...state, present: next, past: state.gesture ? state.past : append(state.past, state.present), future: state.gesture ? state.future : [] };
}

export const officeDraftKey = 'modycrew-office-seat-draft-v1';
export type OfficeLayoutDraft = { base: OfficeSeatLayout; layout: OfficeSeatLayout; selectedId: string };
export function readOfficeLayoutDraft(): OfficeLayoutDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(officeDraftKey) || 'null');
    if (value?.version !== 1 || typeof value.selectedId !== 'string') return null;
    const parse = (layout: unknown): OfficeSeatLayout => {
      if (!layout || typeof layout !== 'object' || Array.isArray(layout)) throw new Error('invalid draft');
      return Object.fromEntries(Object.entries(layout).map(([id, seat]) => {
        if (!seat || !['x', 'y', 'size'].every(key => Number.isFinite(seat[key]))) throw new Error('invalid seat');
        return [id, normalizeOfficeSeat(seat)];
      }));
    };
    return { base: parse(value.base), layout: parse(value.layout), selectedId: value.selectedId };
  } catch { return null; }
}
