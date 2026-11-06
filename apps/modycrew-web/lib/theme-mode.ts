"use client";

import { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";

const storageKey = "modycrew-theme-mode";
const themeChangeEventName = "modycrew:theme-mode";

export function useThemeMode() {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());

  useEffect(() => {
    const saved = readSavedTheme();
    const preferred = getPreferredTheme();
    const next = saved ?? preferred;
    setTheme(next);
    applyTheme(next);
    // 다른 창(AI 오피스 창, 분리 업무창)에서 테마를 바꾸면 이 창에도 즉시 반영한다.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const value = event.newValue === "light" || event.newValue === "dark" ? event.newValue : null;
      if (!value) return;
      setTheme(value);
      applyTheme(value);
    };
    const onThemeChange = (event: Event) => {
      const value = (event as CustomEvent<{ theme?: ThemeMode }>).detail?.theme;
      if (value !== "light" && value !== "dark") return;
      setTheme(value);
      applyTheme(value);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(themeChangeEventName, onThemeChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(themeChangeEventName, onThemeChange);
    };
  }, []);

  const updateTheme = (next: ThemeMode) => {
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Theme persistence is optional; the UI still updates for this session.
    }
    window.dispatchEvent(new CustomEvent(themeChangeEventName, { detail: { theme: next } }));
  };

  return { theme, setTheme: updateTheme };
}

function readSavedTheme(): ThemeMode | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function getPreferredTheme(): ThemeMode {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.modyTheme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function getInitialTheme(): ThemeMode {
  if (typeof document !== "undefined") {
    const current = document.documentElement.dataset.modyTheme ?? document.documentElement.dataset.theme;
    if (current === "light" || current === "dark") return current;
  }
  if (typeof window !== "undefined") {
    return readSavedTheme() ?? getPreferredTheme();
  }
  return "light";
}
