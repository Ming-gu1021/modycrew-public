"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Only the top drawer handles keyboard/focus events if surfaces are nested.
const openDrawers: symbol[] = [];
const focusableSelector = 'button, a[href], input, select, textarea, summary, [tabindex], [contenteditable="true"]';

function focusableElements(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) =>
    element.tabIndex >= 0 && !element.matches(":disabled") &&
    !element.closest('[inert], [aria-hidden="true"]') &&
    element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden",
  );
}

/** Keep the content mounted while closing; state changes and focus never wait for entry motion. */
export function useDrawerMotion(active: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLElement>(null);
  const callbackRef = useRef(onClose);
  const closingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);

  useLayoutEffect(() => { callbackRef.current = onClose; }, [onClose]);

  const finishClose = useCallback(() => {
    if (!closingRef.current) return;
    closingRef.current = false;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    callbackRef.current();
  }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    setClosing(true);
    setShown(false);
    const panel = panelRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const value = panel ? getComputedStyle(panel).getPropertyValue("--panel-close-dur").trim() : "0ms";
    const duration = parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);
    if (reduced || !Number.isFinite(duration) || duration <= 0) {
      finishClose();
    } else {
      // Fallback also covers interrupted transitions and background tabs.
      timerRef.current = setTimeout(finishClose, duration + 50);
    }
  }, [finishClose]);

  useLayoutEffect(() => {
    if (!active || !panelRef.current) return;
    const panel = panelRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const token = Symbol("drawer");
    openDrawers.push(token);
    const isTop = () => openDrawers.at(-1) === token;
    closingRef.current = false;
    setClosing(false);
    setShown(false);
    panel.focus({ preventScroll: true });

    const onFocus = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !panel.contains(event.target)) {
        panel.focus({ preventScroll: true });
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (!isTop() || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      } else if (event.key === "Tab") {
        if (closingRef.current) { event.preventDefault(); return; }
        const elements = focusableElements(panel);
        const first = elements[0];
        const last = elements.at(-1);
        if (!first || !last) { event.preventDefault(); panel.focus(); return; }
        const focused = document.activeElement;
        if (event.shiftKey && (focused === first || focused === panel || !panel.contains(focused))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (focused === last || !panel.contains(focused))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      closingRef.current = false;
      const wasTop = isTop();
      const index = openDrawers.indexOf(token);
      if (index >= 0) openDrawers.splice(index, 1);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      if (wasTop && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [active, requestClose]);

  useEffect(() => {
    if (!active) return;
    // Two frames let the browser paint the closed state before CSS retargets it.
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = requestAnimationFrame(() => {
        if (!closingRef.current) setShown(true);
      });
    });
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onPreference = () => { if (preference.matches) finishClose(); };
    preference.addEventListener("change", onPreference);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      preference.removeEventListener("change", onPreference);
    };
  }, [active, finishClose]);

  return { panelRef, shown, closing, requestClose };
}
