"use client";

import type { AITeammateTeam } from "@/lib/ai-teammates";

// 팀원의 실시간 상태 — 사무실 형상화에서 자리 위/아바타에 표시합니다.
// 아바타 자체는 크루 캐릭터(lib/crew-character-catalog.ts)의 idle/working 일러스트를 사용합니다.
export type TeammateSceneStatus = "working" | "approval" | "idle" | "done" | "failed" | "unknown" | "offline";

// 팀별 자리(데스크) 강조색 — 사무실 형상화의 존/네임플레이트에 사용.
const teamAccentColor: Record<AITeammateTeam, string> = {
  personal: "#2563eb",
  operations: "#4f46e5",
  mail: "#0d9488",
  desktop: "#0891b2",
  marketing: "#d97706",
  development: "#3b5bdb",
  finance: "#16a34a",
  legal: "#64748b",
  custom: "#e11d48",
};

export function teamAccent(team: AITeammateTeam): string {
  return teamAccentColor[team] ?? teamAccentColor.personal;
}

export const sceneStatusMeta: Record<
  TeammateSceneStatus,
  { label: string; tone: "primary" | "safe" | "warning" | "muted"; caption: string }
> = {
  working: { label: "일하는 중", tone: "primary", caption: "지금 업무를 진행하고 있어요" },
  approval: { label: "승인 대기", tone: "warning", caption: "확인이 필요한 일이 있어요" },
  failed: { label: "실패", tone: "warning", caption: "실패한 업무를 확인해 주세요" },
  unknown: { label: "상태 확인 필요", tone: "warning", caption: "현재 실행 상태를 확인할 수 없어요" },
  done: { label: "결과 준비", tone: "safe", caption: "마친 결과를 확인할 수 있어요" },
  idle: { label: "대기 중", tone: "muted", caption: "새 업무를 기다리고 있어요" },
  offline: { label: "쉬는 중", tone: "muted", caption: "지금은 쉬고 있어요" },
};
