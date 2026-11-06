"use client";

import { type CSSProperties, useState } from "react";
import type { OfficeWorkMotion } from "@/lib/office-work-motion";
import type { CrewCharacterId } from "@/lib/crew-character-catalog";
import OfficeRoom, { type OfficeRoomStatus } from "./OfficeRoom";
import styles from "./VirtualOfficeScene.module.css";

export type VirtualOfficeWorkerRole = "mail" | "doc" | "approval" | "file";
export type VirtualOfficeWorkerStatus = OfficeRoomStatus;
export type VirtualOfficeSceneSizePreset = "compact" | "standard" | "large";
export interface VirtualOfficeWorker {
  id: string;
  name: string;
  role: VirtualOfficeWorkerRole;
  roleLabel?: string;
  status: VirtualOfficeWorkerStatus;
  workMotion?: OfficeWorkMotion;
  workMotionUntil?: number;
  statusLines?: string[];
  queueCount?: number;
  avatarId?: CrewCharacterId | string;
  figure?: string;
}
export interface VirtualOfficeSceneProps {
  workers?: VirtualOfficeWorker[];
  approvalCount?: number;
  onWorkerClick?: (id: string) => void;
  onCommand?: (text: string) => void;
  onCreateWorker?: () => void;
  commandPlaceholder?: string;
  height?: number;
  sizePreset?: VirtualOfficeSceneSizePreset;
  bubbleIntervalMs?: number;
}

export default function VirtualOfficeScene({ workers = [], onWorkerClick, onCommand, onCreateWorker, commandPlaceholder = "크루에게 할 일을 적어 주세요.", height, sizePreset = "standard" }: VirtualOfficeSceneProps) {
  const [command, setCommand] = useState("");
  const roomWidth = height ? Math.max(320, height * 2) : sizePreset === "large" ? 1040 : 820;
  return <div style={{ "--office-room-width": `${roomWidth}px` } as CSSProperties} data-testid="virtual-office-scene" data-scene-size={sizePreset} data-office-scene-total-workers={workers.length} data-office-scene-page-size={3} data-office-scene-page-count={Math.max(1, Math.ceil(workers.length / 3))}>
    <OfficeRoom workers={workers.map((worker) => ({ ...worker, layoutId: worker.id.replace(/^office-scene-/, ""), task: worker.status === "idle" || worker.status === "offline" ? undefined : [...new Set(worker.statusLines?.filter(Boolean))].join("\n") }))} onSelect={onWorkerClick} onAdd={onCreateWorker} />
    {onCommand && workers.length ? <form className={styles.commandBar} onSubmit={(event) => { event.preventDefault(); if (command.trim()) { onCommand(command.trim()); setCommand(""); } }}>
      <input value={command} aria-label="직원에게 지시" placeholder={commandPlaceholder} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }} />
      <button className={styles.commandSend} type="submit" disabled={!command.trim()}>보내기</button>
    </form> : null}
  </div>;
}
