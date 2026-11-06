"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import { defaultOfficeAppearance, officeBackgrounds, useOfficeAppearance, type OfficeBackgroundId } from "@/lib/office-appearance";
import styles from "./DisplayPreferences.module.css";
import "./display-preferences.css";

const storageKey = "modycrew-display-preferences-v1";
const changeEvent = "modycrew-display-preferences-change";
const scales = [90, 100, 115, 130] as const;
const roomWidths = { compact: 640, standard: 820, large: 1040 } as const;
const homeRoomWidths = { compact: 560, standard: 720, large: 920 } as const;
type Preferences = { scale: number; motion: boolean; roomSize: keyof typeof roomWidths };
const defaults: Preferences = { scale: 90, motion: true, roomSize: "standard" };
type PreferencesSnapshot = Preferences & { saveFailed: boolean };
const defaultSnapshot: PreferencesSnapshot = { ...defaults, saveFailed: false };
let cached: PreferencesSnapshot | undefined;
let lastPersistedRaw: string | null | undefined;
let preservePendingOnFirstRead = false;

function getSnapshot(): PreferencesSnapshot {
  if (typeof window === "undefined") return defaultSnapshot;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (preservePendingOnFirstRead && cached) {
      lastPersistedRaw = raw;
      preservePendingOnFirstRead = false;
      return cached;
    }
    if (!cached || raw !== lastPersistedRaw) {
      lastPersistedRaw = raw;
      try {
        const value = JSON.parse(raw || "null");
        cached = { scale: scales.includes(value?.scale) ? value.scale : 90, motion: value?.motion !== false, roomSize: Object.hasOwn(roomWidths, value?.roomSize ?? "") ? value.roomSize : "standard", saveFailed: false };
      } catch { cached = defaultSnapshot; }
    }
  } catch { cached ??= defaultSnapshot; }
  return cached!;
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey && event.key !== null) return;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(changeEvent, onChange);
  };
}

export function useDisplayPreferences() {
  const value = useSyncExternalStore(subscribe, getSnapshot, () => defaultSnapshot);
  const update = (patch: Partial<Preferences>) => {
    const { scale, motion, roomSize } = getSnapshot();
    const next: Preferences = { scale, motion, roomSize, ...patch };
    let saved = true;
    try {
      const raw = JSON.stringify(next);
      window.localStorage.setItem(storageKey, raw);
      lastPersistedRaw = raw;
      preservePendingOnFirstRead = false;
    } catch {
      saved = false;
      preservePendingOnFirstRead = lastPersistedRaw === undefined;
    }
    cached = { ...next, saveFailed: !saved };
    window.dispatchEvent(new Event(changeEvent));
    return saved;
  };
  return { ...value, update };
}

export function useDisplayPreferencesController() {
  const { scale, roomSize } = useDisplayPreferences();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.uiScale = String(scale);
    root.style.setProperty("--mc-ui-scale", String(scale / 100));
    root.style.setProperty("--mc-office-room-width", `${roomWidths[roomSize]}px`);
    root.style.setProperty("--mc-home-office-width", `${homeRoomWidths[roomSize]}px`);
    // CSS zoom changes the layout's available pixels; viewport-height units do not.
    const resize = () => root.style.setProperty("--mc-scaled-viewport-height", `${window.innerHeight / (scale / 100)}px`);
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [scale, roomSize]);
}

export default function DisplayPreferences() {
  const { scale, motion, roomSize, saveFailed, update } = useDisplayPreferences();
  const { background, saveFailed: backgroundSaveFailed, updateBackground } = useOfficeAppearance();
  const descriptionId = useId();
  const change = (patch: Partial<Preferences>) => update(patch);
  const changeBackground = (next: OfficeBackgroundId) => updateBackground(next);
  const reset = () => {
    change(defaults);
    changeBackground(defaultOfficeAppearance.background);
  };
  const retrySave = () => {
    change({ scale, motion, roomSize });
    changeBackground(background);
  };
  const selectedBackground = officeBackgrounds.find(option => option.id === background)!;
  return (
    <section className={styles.settings} aria-label="화면 설정">
      <div className={styles.heading}><strong>화면과 사무실</strong><button type="button" aria-label="화면 설정 초기화" onClick={reset}>기본값으로</button></div>
      <label className={styles.row}>
        <span>화면 크기<small id={`${descriptionId}-scale`}>글자와 버튼을 함께 조절해요.</small></span>
        <select aria-label="화면 크기" aria-describedby={`${descriptionId}-scale`} value={scale} onChange={(event) => change({ scale: Number(event.target.value) })}>
          <option value={90}>작게 · 기본 (90%)</option>
          <option value={100}>보통 (100%)</option>
          <option value={115}>크게 (115%)</option>
          <option value={130}>아주 크게 (130%)</option>
        </select>
      </label>
      <label className={styles.row}>
        <span>사무실 크기<small id={`${descriptionId}-room`}>사무실 영역의 너비를 조절해요.</small></span>
        <select aria-label="사무실 크기" aria-describedby={`${descriptionId}-room`} value={roomSize} onChange={event => change({ roomSize: event.target.value as Preferences["roomSize"] })}>
          <option value="compact">아담하게</option><option value="standard">기본</option><option value="large">넓게</option>
        </select>
      </label>
      <label className={styles.row}>
        <span>캐릭터 움직임<small id={`${descriptionId}-motion`}>사무실에서 크루가 움직여요.</small></span>
        <input type="checkbox" role="switch" aria-label="캐릭터 움직임" aria-describedby={`${descriptionId}-motion`} checked={motion} onChange={(event) => change({ motion: event.target.checked })} />
      </label>
      <fieldset className={styles.backgrounds} role="radiogroup" aria-labelledby={`${descriptionId}-background-title`} aria-describedby={`${descriptionId}-background`}>
        <legend id={`${descriptionId}-background-title`}>오피스 배경</legend>
        <p id={`${descriptionId}-background`} className={styles.hint}>홈과 사무실에 함께 적용돼요.</p>
        <div className={styles.backgroundGrid}>
          {officeBackgrounds.map(option => (
            <label key={option.id} className={styles.backgroundOption} data-selected={background === option.id} title={option.description}>
              {/* Local illustrations also work in the packaged desktop app. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={option.src} width={180} height={90} alt="" loading="lazy" decoding="async" />
              <span className={styles.backgroundCaption}>
                <span>{option.label}</span>
                <input type="radio" name={`${descriptionId}-office-background`} aria-label={option.label} value={option.id} checked={background === option.id} onChange={() => changeBackground(option.id)} />
              </span>
            </label>
          ))}
        </div>
        <p className={styles.hint}>{selectedBackground.description}</p>
      </fieldset>
      <p className={styles.hint}>크루별 크기와 위치는 사무실의 ‘자리 배치’에서 바꿔요.</p>
      {saveFailed || backgroundSaveFailed ? <div className={styles.saveNotice} role="status"><p className={styles.hint}>현재 창에는 적용했지만 저장하지 못했어요.</p><button type="button" onClick={retrySave}>다시 저장</button></div> : <p className={styles.hint}>변경하면 바로 적용되고 이 기기에 저장돼요.</p>}
    </section>
  );
}
