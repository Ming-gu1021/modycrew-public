"use client";

import { useSyncExternalStore } from "react";

export const officeBackgrounds = [
  { id: "wood", label: "우드 오피스", description: "따뜻한 나무와 햇살이 있는 사무실이에요.", src: "/office-room/room.png" },
  { id: "garden", label: "가든 오피스", description: "초록 식물과 함께 일하는 사무실이에요.", src: "/office-room/room-garden.png" },
  { id: "studio", label: "스튜디오", description: "밝고 단정한 분위기의 작업실이에요.", src: "/office-room/room-studio.png" },
  { id: "night", label: "나이트 오피스", description: "차분한 저녁 분위기의 사무실이에요.", src: "/office-room/room-night.png" },
] as const;

export type OfficeBackgroundId = (typeof officeBackgrounds)[number]["id"];
export type OfficeAppearance = { background: OfficeBackgroundId };

export const officeAppearanceStorageKey = "modycrew-office-appearance-v1";
export const officeAppearanceChangeEvent = "modycrew-office-appearance-change";
export const defaultOfficeAppearance: OfficeAppearance = { background: "wood" };
type OfficeAppearanceSnapshot = OfficeAppearance & { saveFailed: boolean };
const defaultSnapshot: OfficeAppearanceSnapshot = { ...defaultOfficeAppearance, saveFailed: false };
let cached: OfficeAppearanceSnapshot | undefined;
let lastPersistedRaw: string | null | undefined;
let preservePendingOnFirstRead = false;

export function normalizeOfficeAppearance(value: unknown): OfficeAppearance {
  const candidate = value && typeof value === "object" && "background" in value ? value.background : undefined;
  const choice = officeBackgrounds.find(item => item.id === candidate);
  return choice ? { background: choice.id } : defaultOfficeAppearance;
}

function getSnapshot(): OfficeAppearanceSnapshot {
  if (typeof window === "undefined") return defaultSnapshot;
  try {
    const raw = window.localStorage.getItem(officeAppearanceStorageKey);
    if (preservePendingOnFirstRead && cached) {
      lastPersistedRaw = raw;
      preservePendingOnFirstRead = false;
      return cached;
    }
    if (!cached || raw !== lastPersistedRaw) {
      lastPersistedRaw = raw;
      try { cached = { ...normalizeOfficeAppearance(JSON.parse(raw || "null")), saveFailed: false }; }
      catch { cached = defaultSnapshot; }
    }
  } catch {
    cached ??= defaultSnapshot;
  }
  return cached!;
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== officeAppearanceStorageKey && event.key !== null) return;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(officeAppearanceChangeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(officeAppearanceChangeEvent, onChange);
  };
}

function updateBackground(background: OfficeBackgroundId): boolean {
  getSnapshot();
  const next = normalizeOfficeAppearance({ background });
  let saved = true;
  try {
    const raw = JSON.stringify(next);
    window.localStorage.setItem(officeAppearanceStorageKey, raw);
    lastPersistedRaw = raw;
    preservePendingOnFirstRead = false;
  } catch {
    saved = false;
    preservePendingOnFirstRead = lastPersistedRaw === undefined;
  }
  // The pending value and its retry state must survive settings remounts together.
  cached = { ...next, saveFailed: !saved };
  // Keep the current window in sync even when storage is unavailable.
  window.dispatchEvent(new Event(officeAppearanceChangeEvent));
  return saved;
}

export function useOfficeAppearance() {
  const value = useSyncExternalStore(subscribe, getSnapshot, () => defaultSnapshot);
  return { ...value, updateBackground };
}
