export type OfficeSeat = { x: number; y: number; size: number };
export type OfficeSeatLayout = Record<string, OfficeSeat>;

export const officeLayoutStorageKey = "modycrew-office-seat-layout-v1";
export const officeLayoutChangeEvent = "modycrew-office-seat-layout-change";

const limit = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function normalizeOfficeSeat(value: OfficeSeat, compact = false): OfficeSeat {
  const size = limit(Number.isFinite(value.size) ? value.size : 100, 45, 140);
  const edge = 3 + (compact ? 17 : 11) * size / 100;
  const back = compact ? Math.max(64, 51 * size / 100 + 10) : 64;
  return {
    x: limit(Number.isFinite(value.x) ? value.x : 50, edge, 100 - edge),
    y: limit(Number.isFinite(value.y) ? value.y : 92, back, 94),
    size,
  };
}

export function defaultOfficeSeat(index: number, count: number): OfficeSeat {
  if (count > 3) {
    const row = Math.floor(index / 3);
    const columns = Math.min(3, count - row * 3);
    return { x: 50 + (index % 3 - (columns - 1) / 2) * 27, y: row ? 85 : 64, size: 45 };
  }
  return { x: 50 + (index - (count - 1) / 2) * 23, y: 92, size: 100 };
}

export function sameOfficeSeat(a: OfficeSeat | undefined, b: OfficeSeat | undefined): boolean {
  return a === b || Boolean(a && b && a.x === b.x && a.y === b.y && a.size === b.size);
}

export function sameOfficeLayout(a: OfficeSeatLayout, b: OfficeSeatLayout): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(key => sameOfficeSeat(a[key], b[key]));
}

// Apply only this editor's changes, keeping unrelated edits made in another window.
export function mergeOfficeLayouts(base: OfficeSeatLayout, draft: OfficeSeatLayout, latest: OfficeSeatLayout) {
  const merged = { ...latest };
  const conflicts: string[] = [];
  for (const id of new Set([...Object.keys(base), ...Object.keys(draft)])) {
    if (sameOfficeSeat(base[id], draft[id])) continue;
    if (!sameOfficeSeat(base[id], latest[id]) && !sameOfficeSeat(draft[id], latest[id])) {
      conflicts.push(id);
      continue;
    }
    if (draft[id]) merged[id] = draft[id];
    else delete merged[id];
  }
  return { merged, conflicts };
}

export function alignOfficeSeats(seats: OfficeSeat[], compact = false): OfficeSeat[] {
  if (!seats.length) return [];
  const widths = seats.map(seat => (compact ? 34 : 22) * seat.size / 100);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const gap = seats.length > 1 ? Math.min(4, Math.max(0, (94 - total) / (seats.length - 1))) : 0;
  let cursor = (100 - total - gap * (seats.length - 1)) / 2;
  return seats.map((seat, index) => {
    const next = normalizeOfficeSeat({ ...seat, x: cursor + widths[index] / 2, y: 92 }, compact);
    cursor += widths[index] + gap;
    return next;
  });
}

export function readOfficeSeatLayout(): OfficeSeatLayout {
  try {
    const stored = JSON.parse(localStorage.getItem(officeLayoutStorageKey) || "null");
    if (stored?.version !== 1 || !stored.seats || typeof stored.seats !== "object") return {};
    return Object.fromEntries(Object.entries(stored.seats).filter(([, seat]) =>
      seat && typeof seat === "object" && ["x", "y", "size"].every(key => typeof (seat as Record<string, unknown>)[key] === "number"),
    ).map(([id, seat]) => [id, normalizeOfficeSeat(seat as OfficeSeat)]));
  } catch { return {}; }
}

export function saveOfficeSeatLayout(seats: OfficeSeatLayout): boolean {
  try {
    localStorage.setItem(officeLayoutStorageKey, JSON.stringify({ version: 1, seats }));
    window.dispatchEvent(new Event(officeLayoutChangeEvent));
    return true;
  } catch { return false; }
}

type LayoutCommit = { status: 'saved'; layout: OfficeSeatLayout } | { status: 'conflict' | 'unavailable' | 'failed' };
export async function commitOfficeLayout(base: OfficeSeatLayout, draft: OfficeSeatLayout): Promise<LayoutCommit> {
  // Serialize the whole read/merge/write operation across home and detached windows.
  // Unsupported environments keep the draft instead of risking an unprotected overwrite.
  if (!navigator.locks) return { status: 'unavailable' };
  try {
    return await navigator.locks.request(officeLayoutStorageKey, () => {
      const result = mergeOfficeLayouts(base, draft, readOfficeSeatLayout());
      if (result.conflicts.length) return { status: 'conflict' } as const;
      return saveOfficeSeatLayout(result.merged) ? { status: 'saved', layout: result.merged } as const : { status: 'failed' } as const;
    });
  } catch { return { status: 'failed' }; }
}
