"use client";

import type { AITeammate, AITeammateTeam } from "@/lib/ai-teammates";
import type { OfficeWorkMotion } from "@/lib/office-work-motion";
import type { TeammateSceneStatus } from "@/lib/teammate-appearance";
import { getCrewCharacter, getCrewCharacterRoleAffinity } from "@/lib/crew-character-catalog";
import OfficeRoom from "./OfficeRoom";

export type OfficeSceneMember = {
  teammate: AITeammate;
  status: TeammateSceneStatus;
  workMotion?: OfficeWorkMotion;
  workMotionUntil?: number;
  currentTask: string;
  statusLine?: string;
  lastActivityAt?: number;
  workCount: number;
  stats?: { work: number; skill: number; learned: number };
  isMain: boolean;
};
export type OfficeSceneHireSlot = { templateId: AITeammateTeam; teamLabel: string; roleTitle: string; brief: string };
type OfficeSceneProps = {
  members: OfficeSceneMember[];
  hireSlots: OfficeSceneHireSlot[];
  selectedId?: string;
  saveNotice?: string;
  onSelect: (id: string) => void;
  onHire: (id: AITeammateTeam) => void;
};

export function formatSceneTimeAgo(lastActivityAt: number | undefined, now: number): string {
  if (!lastActivityAt || !Number.isFinite(lastActivityAt)) return "";
  const diff = Math.max(0, now - lastActivityAt);
  if (diff < 60_000) return "방금 전 활동";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전 활동`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전 활동`;
  return "오늘 활동 없음";
}

export function OfficeScene({ members, hireSlots, selectedId, saveNotice, onSelect, onHire }: OfficeSceneProps) {
  return <div aria-label="모디크루 오피스 사무실 보기" data-office-scene="soft_3d_room" data-office-motion="state_driven">
    <OfficeRoom
      workers={members.map(({ teammate, status, workMotion, workMotionUntil, currentTask, statusLine }) => ({
        id: teammate.id,
        name: teammate.name,
        avatarId: teammate.avatarId,
        role: getCrewCharacter(teammate.avatarId)?.roleAffinity ?? getCrewCharacterRoleAffinity(`${teammate.templateId} ${teammate.roleTitle}`) ?? "doc",
        roleLabel: teammate.roleTitle,
        status: status === "approval" ? "waiting" : status,
        workMotion,
        workMotionUntil,
        task: status === "idle" || status === "offline" ? undefined : [...new Set([statusLine, currentTask].filter(Boolean))].join("\n"),
      }))}
      selectedId={selectedId}
      notice={saveNotice}
      onSelect={onSelect}
      addActions={hireSlots.map((slot) => ({ id: slot.templateId, label: slot.roleTitle, onSelect: () => onHire(slot.templateId) }))}
    />
  </div>;
}
