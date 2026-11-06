"use client";
import { useEffect, useState, type RefObject } from "react";

/** Native top layer, positioned in physical viewport coordinates (including UI zoom). */
export function useAnchoredPopover(trigger: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, side: "above" | "right" = "above") {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const anchor = trigger.current, menu = panel.current;
    if (!anchor || !menu) return;
    let frame = 0;
    function position() {
      if (!menu!.matches(":popover-open")) return;
      const scale = menu!.getBoundingClientRect().width / menu!.offsetWidth || 1;
      const rect = anchor!.getBoundingClientRect();
      const width = window.innerWidth, height = window.innerHeight, gap = 8;
      const above = rect.top - gap * 2, below = height - rect.bottom - gap * 2;
      const available = side === "above" ? Math.max(above, below) : height - gap * 2;
      menu!.style.maxHeight = `${Math.max(60, available) / scale}px`;
      menu!.style.maxWidth = `${(width - gap * 2) / scale}px`;
      const box = menu!.getBoundingClientRect();
      const x = side === "right" && width - rect.right >= box.width + gap * 2 ? rect.right + gap : rect.left;
      const y = side === "above" ? (above >= box.height || above >= below ? rect.top - gap - box.height : rect.bottom + gap) : rect.bottom - box.height;
      menu!.style.left = `${Math.max(gap, Math.min(x, width - gap - box.width)) / scale}px`;
      menu!.style.top = `${Math.max(gap, Math.min(y, height - gap - box.height)) / scale}px`;
      menu!.dataset.positioned = "true";
    }
    function toggle() { const shown = menu!.matches(":popover-open"); setOpen(shown); if (shown) position(); else delete menu!.dataset.positioned; }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); }
    const observer = new ResizeObserver(schedule);
    observer.observe(menu); observer.observe(anchor);
    menu.addEventListener("toggle", toggle);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); menu.removeEventListener("toggle", toggle); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true); };
  }, [trigger, panel, side]);
  return open;
}
