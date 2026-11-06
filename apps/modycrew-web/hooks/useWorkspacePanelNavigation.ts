"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";

export type WorkspacePanelId =
  | "none"
  | "learn"
  | "connect"
  | "messengers"
  | "office"
  | "control"
  | "workers"
  | "skills"
  | "mail";

export type WorkspacePanelHistoryMode = "push" | "replace" | "none";

export type WorkspacePanelLocation = {
  panel: WorkspacePanelId;
  full: boolean;
  workerTab: string;
  singleSetting: string;
  url: URL;
};

type OpenWorkspacePanelOptions = {
  panel: Exclude<WorkspacePanelId, "none">;
  full?: boolean;
  href?: string;
  historyMode?: WorkspacePanelHistoryMode;
  detail?: string;
};

type CloseWorkspacePanelOptions = {
  detail?: string;
  historyMode?: WorkspacePanelHistoryMode;
};

type UseWorkspacePanelNavigationOptions = {
  panel: WorkspacePanelId;
  full: boolean;
  setPanel: Dispatch<SetStateAction<WorkspacePanelId>>;
  setFull: Dispatch<SetStateAction<boolean>>;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  setWorkerCompanionMode: Dispatch<SetStateAction<boolean>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setStatusOpen: Dispatch<SetStateAction<boolean>>;
  setOperationDetail: Dispatch<SetStateAction<string>>;
  onLocationChange?: (location: WorkspacePanelLocation) => void;
};

const panelIds = new Set<Exclude<WorkspacePanelId, "none">>([
  "learn",
  "connect",
  "messengers",
  "office",
  "control",
  "workers",
  "skills",
  "mail",
]);

const panelQueryKeys = [
  "panel",
  "view",
  "workspaceMode",
  "workerTab",
  "singleSetting",
  "workerCompanion",
  "companionDisplay",
  "companionSize",
  "companionPosition",
  "companionMotion",
  "companionAvatar",
] as const;

function relativeHref(url: URL) {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readWorkspacePanelNavigation(url: URL): WorkspacePanelLocation {
  const rawPanel = url.searchParams.get("panel");
  const pathPanel = url.pathname === "/connect"
    ? "connect"
    : url.pathname === "/learn"
      ? "learn"
      : url.pathname === "/office"
        ? "office"
        : "none";
  const panel = rawPanel && panelIds.has(rawPanel as Exclude<WorkspacePanelId, "none">)
    ? (rawPanel as Exclude<WorkspacePanelId, "none">)
    : pathPanel;
  return {
    panel,
    full:
      pathPanel !== "none" ||
      url.searchParams.get("view") === "full" ||
      url.searchParams.get("workspaceMode") === "full",
    workerTab: url.searchParams.get("workerTab")?.trim() ?? "",
    singleSetting: url.searchParams.get("singleSetting")?.trim() ?? "",
    url,
  };
}

export function clearWorkspacePanelHref(href: string) {
  const url = new URL(href, "http://modycrew.local");
  for (const key of panelQueryKeys) url.searchParams.delete(key);
  if (url.pathname === "/connect" || url.pathname === "/learn" || url.pathname === "/office") {
    url.pathname = "/";
  }
  return relativeHref(url);
}
export function makeWorkspacePanelHrefFromLocation(
  href: string,
  panel: Exclude<WorkspacePanelId, "none">,
  full: boolean,
  options: { workerTab?: string | null; singleSetting?: string | null } = {},
) {
  const url = new URL(href, "http://modycrew.local");
  const dedicatedPath = panel === "office" ? "/office" : panel === "learn" ? "/learn" : panel === "connect" || panel === "messengers" ? "/connect" : "/";
  url.pathname = full ? dedicatedPath : "/";
  if (full && dedicatedPath !== "/") url.searchParams.delete("panel");
  else url.searchParams.set("panel", panel);
  if (full) url.searchParams.set("view", "full");
  else url.searchParams.delete("view");
  url.searchParams.delete("workspaceMode");

  if (options.workerTab !== undefined) {
    if (options.workerTab) url.searchParams.set("workerTab", options.workerTab);
    else url.searchParams.delete("workerTab");
  }
  if (options.singleSetting !== undefined) {
    if (options.singleSetting) url.searchParams.set("singleSetting", options.singleSetting);
    else url.searchParams.delete("singleSetting");
  }
  return relativeHref(url);
}

export function useWorkspacePanelNavigation({
  panel,
  full,
  setPanel,
  setFull,
  setCollapsed,
  setWorkerCompanionMode,
  setSettingsOpen,
  setStatusOpen,
  setOperationDetail,
  onLocationChange,
}: UseWorkspacePanelNavigationOptions) {
  const onLocationChangeRef = useRef(onLocationChange);

  useEffect(() => {
    onLocationChangeRef.current = onLocationChange;
  }, [onLocationChange]);

  const writeHref = useCallback((href: string, historyMode: WorkspacePanelHistoryMode) => {
    if (historyMode === "none" || typeof window === "undefined") return;
    const nextUrl = new URL(href, window.location.toString());
    const nextHref = relativeHref(nextUrl);
    const currentHref = relativeHref(new URL(window.location.toString()));
    if (nextHref === currentHref) return;
    if (historyMode === "replace") window.history.replaceState(window.history.state, "", nextHref);
    else window.history.pushState(window.history.state, "", nextHref);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  const clearLocation = useCallback((historyMode: WorkspacePanelHistoryMode = "replace") => {
    if (historyMode === "none" || typeof window === "undefined") return;
    writeHref(clearWorkspacePanelHref(window.location.toString()), historyMode);
  }, [writeHref]);

  const openPanel = useCallback((options: OpenWorkspacePanelOptions) => {
    setSettingsOpen(false);
    setCollapsed(false);
    setPanel(options.panel);
    setFull(Boolean(options.full));
    setStatusOpen(false);
    if (options.href) writeHref(options.href, options.historyMode ?? "push");
    if (options.detail) setOperationDetail(options.detail);
  }, [setCollapsed, setFull, setOperationDetail, setPanel, setSettingsOpen, setStatusOpen, writeHref]);

  const closePanel = useCallback((options: CloseWorkspacePanelOptions = {}) => {
    setSettingsOpen(false);
    setWorkerCompanionMode(false);
    setPanel("none");
    setCollapsed(false);
    setFull(false);
    clearLocation(options.historyMode ?? "replace");
    if (options.detail) setOperationDetail(options.detail);
  }, [clearLocation, setCollapsed, setFull, setOperationDetail, setPanel, setSettingsOpen, setWorkerCompanionMode]);

  const collapseToSide = useCallback((href?: string, detail?: string) => {
    setCollapsed(false);
    setFull(false);
    if (href) writeHref(href, "replace");
    if (detail) setOperationDetail(detail);
  }, [setCollapsed, setFull, setOperationDetail, writeHref]);

  useEffect(() => {
    setCollapsed(false);
    if (panel !== "none") setStatusOpen(false);
  }, [panel, setCollapsed, setStatusOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = () => {
      const location = readWorkspacePanelNavigation(new URL(window.location.toString()));
      setSettingsOpen(false);
      setCollapsed(false);
      setPanel(location.panel);
      setFull(location.panel === "none" ? false : location.full);
      if (location.panel === "none") setWorkerCompanionMode(false);
      else setStatusOpen(false);
      onLocationChangeRef.current?.(location);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setCollapsed, setFull, setPanel, setSettingsOpen, setStatusOpen, setWorkerCompanionMode]);

  return {
    panel,
    full,
    openPanel,
    closePanel,
    collapseToSide,
    clearLocation,
    writeHref,
  };
}
