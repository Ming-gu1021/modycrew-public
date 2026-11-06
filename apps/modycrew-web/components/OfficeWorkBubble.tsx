"use client";

import { useEffect, useRef } from "react";
import type { OfficeRoomWorker } from "./OfficeRoom";
import styles from "./OfficeWorkBubble.module.css";

type Props = {
  id: string;
  anchorId: string;
  worker: OfficeRoomWorker;
  statusLabel: string;
  onOpenChange: (open: boolean) => void;
  onSelect?: (id: string) => void;
};

export default function OfficeWorkBubble({ id, anchorId, worker, statusLabel, onOpenChange, onSelect }: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const openChange = useRef(onOpenChange);
  openChange.current = onOpenChange;
  const task = worker.task?.trim() || ({
    working: "맡은 업무를 처리하고 있어요.", moving: "작업 내용을 정리하고 있어요.",
    waiting: "진행하려면 확인이 필요해요.", done: "완료한 결과를 확인해 주세요.",
    failed: "업무가 실패했어요. 기록을 확인해 주세요.", unknown: "현재 실행 상태를 확인해 주세요.",
    idle: "지금은 맡은 업무가 없어요.", offline: "지금은 쉬고 있어요.",
  }[worker.status]);

  useEffect(() => {
    const popup = popupRef.current;
    const anchor = document.getElementById(anchorId);
    if (!popup || !anchor) return;
    let frame = 0;
    const position = () => {
      if (!popup.matches(":popover-open")) return;
      const target = anchor.getBoundingClientRect();
      // Root CSS zoom and browser pinch zoom have separate coordinate systems.
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const viewport = window.visualViewport;
      const viewLeft = viewport?.offsetLeft ?? 0;
      const viewTop = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const margin = 12;
      popup.style.setProperty("--bubble-available-width", `${Math.max(1, width - margin * 2) / zoom}px`);
      popup.style.setProperty("--bubble-available-height", `${Math.max(1, height - margin * 2) / zoom}px`);
      const box = popup.getBoundingClientRect();
      const center = target.left + target.width / 2;
      const left = Math.max(viewLeft + margin, Math.min(center - box.width / 2, viewLeft + width - box.width - margin));
      const above = target.top - box.height - 10 >= viewTop + margin;
      const top = Math.max(viewTop + margin, Math.min(above ? target.top - box.height - 10 : target.bottom + 10, viewTop + height - box.height - margin));
      popup.style.left = `${left / zoom}px`;
      popup.style.top = `${top / zoom}px`;
      popup.style.setProperty("--bubble-arrow-x", `${Math.max(18, Math.min((center - left) / zoom, box.width / zoom - 18))}px`);
      popup.dataset.side = above ? "above" : "below";
      popup.dataset.positioned = "true";
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); };
    const toggle = () => {
      const open = popup.matches(":popover-open");
      openChange.current(open);
      if (open) schedule();
      else delete popup.dataset.positioned;
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(popup);
    observer.observe(anchor);
    popup.addEventListener("toggle", toggle);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      popup.removeEventListener("toggle", toggle);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [anchorId]);

  return <div ref={popupRef} id={id} popover="auto" role="dialog" aria-label={`${worker.name}의 현재 업무`} className={styles.bubble} data-office-work-bubble={worker.id}>
    <header className={styles.heading}>
      <div><strong>{worker.name}</strong><span data-state={worker.status}>{statusLabel}</span></div>
      <button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="업무 말풍선 닫기"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
    </header>
    <p className={styles.task} role="region" aria-live="polite" aria-label="업무 내용" tabIndex={0}>{task}</p>
    <footer className={styles.footer}>
      {worker.roleLabel ? <span>{worker.roleLabel}</span> : null}
      {onSelect ? <button type="button" onClick={() => { popupRef.current?.hidePopover(); onSelect(worker.id); }}>업무 열기<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg></button> : null}
    </footer>
  </div>;
}
