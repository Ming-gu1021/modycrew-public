import { normalizeOfficeSeat, type OfficeSeat, type OfficeSeatLayout } from "./office-room-layout";

export const officeLayoutPresets = [
  { id: "together", label: "나란히", detail: "함께 보는 팀 데스크" },
  { id: "lounge", label: "라운지", detail: "앞뒤로 여유 있게" },
  { id: "focus", label: "집중 모드", detail: "사이 간격을 넉넉하게" },
] as const;
export type OfficeLayoutPreset = (typeof officeLayoutPresets)[number]["id"];

/** Visible seats only. The caller merges this with the existing layout, preserving other rooms/pages. */
export function buildOfficeLayoutPreset(ids: string[], preset: OfficeLayoutPreset, compact = false): OfficeSeatLayout {
  return Object.fromEntries(ids.map((id, index) => {
    const count = ids.length;
    if (compact) return [id, normalizeOfficeSeat({ x: 50, y: 92, size: preset === "focus" ? 85 : 100 }, true)];
    const rows = count > 3;
    const row = rows ? Math.floor(index / 3) : 0;
    const rowCount = rows ? Math.min(3, count - row * 3) : count;
    const column = rows ? index % 3 : index;
    const gap = preset === "focus" ? 31 : preset === "lounge" ? 29 : 26;
    const x = 50 + (column - (rowCount - 1) / 2) * gap;
    const y = rows ? (row ? 94 : 64) : preset === "lounge" ? (column % 2 ? 92 : 74) : preset === "focus" ? 85 : 92;
    return [id, normalizeOfficeSeat({ x, y, size: rows ? 70 : preset === "together" ? 95 : 85 })];
  }));
}

/** Check the whole visible desk/nameplate footprint, including the current canvas aspect ratio. */
export function overlappingOfficeSeats(seats: OfficeSeat[], aspect: number, compact = false): number {
  const bounds = seats.map(seat => {
    const width = (compact ? 34 : 22) * seat.size / 100;
    return { left: seat.x - width / 2, right: seat.x + width / 2, top: seat.y - width * aspect - 4, bottom: seat.y };
  });
  let count = 0;
  for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
    const a = bounds[i], b = bounds[j];
    if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) count++;
  }
  return count;
}
