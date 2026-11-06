"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 설치 앱 업데이트 상태를 화면에서 읽는 한 곳.
 * - 메인이 상태를 바꾸면 preload 의 onChange 로 바로 밀어 준다(창이 가려져 있어도 DOM은 최신).
 * - onChange 가 없는 옛 preload 를 위해 60초 폴링(보이는 동안)과 포커스 갱신은 남겨 둔다.
 * 웹(브라우저)에서는 API 가 없으므로 state 가 null 이고 아무것도 그리지 않는다.
 */
export type DesktopUpdateState = {
  status: string;
  currentVersion?: string;
  updateVersion?: string;
  progressPercent?: number;
  userMessage?: string;
  errorMessage?: string;
  isPackaged?: boolean;
  /** 직전 실행 버전과 달라졌을 때(= 업데이트가 적용된 첫 실행) 한 번만 채워진다. */
  updatedFromVersion?: string;
  /** 설치를 요청했는데 다음 실행에도 옛 버전이었던(적용이 확인되지 않은) 버전. 있으면 다음 설치는 설치 창으로 진행한다. */
  installUnconfirmedVersion?: string;
  /** 진행 중인 설치 방식: silent(조용히 설치한 뒤 다시 열기) | visible(설치 창) */
  installMode?: string;
};

export type DesktopUpdateApi = {
  status: () => Promise<DesktopUpdateState>;
  check?: () => Promise<DesktopUpdateState>;
  download?: () => Promise<DesktopUpdateState>;
  installOnQuit?: () => Promise<DesktopUpdateState>;
  installNow?: () => Promise<DesktopUpdateState>;
  ackUpdated?: () => Promise<DesktopUpdateState>;
  onChange?: (listener: (state: DesktopUpdateState) => void) => () => void;
};

const POLL_MS = 60_000;
const ACTIONABLE = new Set(["available", "downloading", "ready", "install_requested"]);

export function desktopUpdateApi(): DesktopUpdateApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { modyCrewDesktopUpdate?: DesktopUpdateApi }).modyCrewDesktopUpdate;
  return api && typeof api.status === "function" ? api : null;
}

/** 사용자가 손댈 수 있는 업데이트(받는 중 포함)가 있는가. */
export function isDesktopUpdateActionable(state: DesktopUpdateState | null | undefined) {
  return Boolean(state && ACTIONABLE.has(state.status) && state.updateVersion);
}

export function clampPercent(value: number | undefined) {
  return Math.max(0, Math.min(100, Math.round(value ?? 0)));
}

// 사이드바 버튼이 떠 있으면 위쪽 띠는 같은 내용을 두 번 보여 주지 않는다.
let railButtonMounts = 0;
const railListeners = new Set<() => void>();
export function registerDesktopUpdateRailButton() {
  railButtonMounts += 1;
  for (const listener of railListeners) listener();
  return () => {
    railButtonMounts = Math.max(0, railButtonMounts - 1);
    for (const listener of railListeners) listener();
  };
}
export function useDesktopUpdateRailButtonMounted() {
  const [mounted, setMounted] = useState(railButtonMounts > 0);
  useEffect(() => {
    const listener = () => setMounted(railButtonMounts > 0);
    railListeners.add(listener);
    listener();
    return () => { railListeners.delete(listener); };
  }, []);
  return mounted;
}

export function useDesktopUpdateState() {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  // 버튼을 누른 결과 안내. 그때의 상태에만 붙여 두어, 메인이 상태를 바꾸면(설치 중 → 다시 준비됨 등) 지난 안내가 남지 않는다.
  const [noticeEntry, setNoticeEntry] = useState<{ text: string; status: string } | null>(null);
  const api = useRef<DesktopUpdateApi | null>(null);
  const stateRef = useRef<DesktopUpdateState | null>(null);
  useEffect(() => { stateRef.current = state; }, [state]);

  const refresh = useCallback(async () => {
    if (!api.current) return;
    try {
      const next = await api.current.status();
      if (next && typeof next.status === "string") setState(next);
    } catch {
      // 상태를 못 읽으면 조용히 다음 갱신을 기다린다.
    }
  }, []);

  useEffect(() => {
    api.current = desktopUpdateApi();
    if (!api.current) return;
    void refresh();
    const unsubscribe = api.current.onChange?.((next) => { if (next && typeof next.status === "string") setState((current) => ({ ...current, ...next })); });
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { unsubscribe?.(); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  // 푸시가 없는 옛 preload 에서는 받는 동안 자주 갱신해 진행률을 보여 준다.
  useEffect(() => {
    if (api.current?.onChange) return;
    if (state?.status !== "downloading" && state?.status !== "checking") return;
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [state?.status, refresh]);

  const installNow = useCallback(async () => {
    if (!api.current || busy) return;
    setBusy(true); setNoticeEntry(null);
    try {
      const result = api.current.installNow ? await api.current.installNow() : await api.current.installOnQuit?.();
      if (result) setState(result);
      // 설치를 시작했으면 메인이 보낸 안내(조용한 설치·설치 창)를 상태 그대로 보여 준다. 시작하지 못했으면 그 이유를 남긴다.
      if (result?.status !== "install_requested") {
        setNoticeEntry({
          text: result?.userMessage || "아직 설치할 준비가 되지 않았습니다. 다운로드가 끝나면 다시 눌러 주세요.",
          status: result?.status ?? stateRef.current?.status ?? "",
        });
      }
    } catch {
      setNoticeEntry({ text: "업데이트를 시작하지 못했습니다. 잠시 후 다시 눌러 주세요.", status: stateRef.current?.status ?? "" });
    } finally { setBusy(false); }
  }, [busy]);

  const download = useCallback(async () => {
    if (!api.current?.download || busy) return;
    setBusy(true); setNoticeEntry(null);
    try { const result = await api.current.download(); if (result) setState(result); }
    catch { setNoticeEntry({ text: "다운로드를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.", status: stateRef.current?.status ?? "" }); }
    finally { setBusy(false); }
  }, [busy]);

  const ackUpdated = useCallback(async () => {
    setState((current) => (current ? { ...current, updatedFromVersion: "" } : current));
    try { await api.current?.ackUpdated?.(); } catch { /* 확인 기록에 실패해도 안내는 닫는다 */ }
  }, []);

  const notice = noticeEntry && state && noticeEntry.status === state.status ? noticeEntry.text : "";
  return { state, busy, notice, refresh, installNow, download, ackUpdated };
}
