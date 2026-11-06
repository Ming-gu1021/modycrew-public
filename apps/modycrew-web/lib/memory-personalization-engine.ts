"use client";

import type { LocalMemoryWorkPattern, LocalMemoryWorkLearningSourceKind } from "./desktop-bridge";

export type MemoryPersonalizationKind =
  | "tone"
  | "reply_format"
  | "approval_habit"
  | "connection_recovery"
  | "repeat_pattern";

export type MemoryPersonalizationUserAction =
  | "apply_this_request"
  | "save_next_time"
  | "dismiss_this_request"
  | "manage_update_delete";

export type MemoryPersonalizationPersistencePolicy = {
  autoApply: false;
  autoSave: false;
  requestOnlyAllowed: true;
  saveRequiresUserAction: true;
  updateDeleteRequiresManager: true;
  deleteScope: "ledger_only_no_originals";
  dismissScope: "none_saved_record_kept";
  conflictResolution: "user_selects_one_no_auto_apply";
};

export const MEMORY_PERSONALIZATION_PERSISTENCE_POLICY: MemoryPersonalizationPersistencePolicy = {
  autoApply: false,
  autoSave: false,
  requestOnlyAllowed: true,
  saveRequiresUserAction: true,
  updateDeleteRequiresManager: true,
  deleteScope: "ledger_only_no_originals",
  dismissScope: "none_saved_record_kept",
  conflictResolution: "user_selects_one_no_auto_apply",
};

export type MemoryPersonalizationSuggestion = {
  id: string;
  kind: MemoryPersonalizationKind;
  sourceKind: LocalMemoryWorkLearningSourceKind;
  sourceLabel: string;
  summary: string;
  signals: string[];
  question: string;
  applyPlan: string;
  conflictCandidates: LocalMemoryWorkPattern[];
  shouldPauseForUserChoice: boolean;
  userActions: MemoryPersonalizationUserAction[];
  persistencePolicy: MemoryPersonalizationPersistencePolicy;
  conflictResolutionLabel: string;
  storageScopeLabel: string;
  deleteScopeLabel: string;
};

export function createMemoryPersonalizationSuggestion(input: {
  text: string;
  workPatterns: LocalMemoryWorkPattern[];
  teammateId?: string;
}): MemoryPersonalizationSuggestion | null {
  const text = input.text.replace(/\s+/gu, " ").trim();
  if (!text) return null;
  const kind = inferMemoryPersonalizationKind(text);
  if (!kind) return null;

  const sourceKind = sourceKindForPersonalization(kind);
  const sourceLabel = sourceLabelForPersonalization(kind);
  const summary = summaryForPersonalization(kind, text);
  const signals = signalsForPersonalization(kind, text);
  const conflictCandidates = findMemoryPersonalizationConflicts(kind, sourceKind, input.workPatterns, summary);

  return {
    id: `memory-personalization-${kind}-${Date.now()}`,
    kind,
    sourceKind,
    sourceLabel,
    summary,
    signals,
    question: `다음부터 ${sourceLabel}${sourceLabel.endsWith("기준") ? "으로" : " 기준으로"} 기억할까요?`,
    applyPlan: "자동으로 실행하지 않고, 이번 요청에만 넣거나 사용자가 저장 버튼을 눌렀을 때만 기억합니다.",
    conflictCandidates,
    shouldPauseForUserChoice: true,
    userActions: ["apply_this_request", "save_next_time", "dismiss_this_request", "manage_update_delete"],
    persistencePolicy: MEMORY_PERSONALIZATION_PERSISTENCE_POLICY,
    conflictResolutionLabel: conflictCandidates.length
      ? "충돌 후보를 자동 선택하지 않고 사용자가 이번 요청에 넣을 기준을 고릅니다."
      : "충돌 후보가 없어도 자동 저장하지 않고 사용자가 저장 버튼을 눌렀을 때만 기억합니다.",
    storageScopeLabel: "저장하면 지난 업무 기억 장부만 갱신합니다.",
    deleteScopeLabel: "삭제/수정 관리는 원본 파일, 외부 계정, 과거 대화, 승인 기록을 바꾸지 않습니다.",
  };
}

function inferMemoryPersonalizationKind(text: string): MemoryPersonalizationKind | null {
  const lower = text.toLowerCase();
  const explicitMemory = /다음부터|앞으로|항상|기억해|기억해줘|저장해|저장해줘/u.test(lower);
  if (!explicitMemory) return null;
  if (/답장|회신|메일|문의/u.test(lower) && /형식|양식|템플릿|서명|제목|첫\s*문장|마무리/u.test(lower)) return "reply_format";
  if (/말투|톤|정중|친근|짧게|간단히|격식|존댓말|반말/u.test(lower)) return "tone";
  if (/승인|확인|묻고|물어|보류|실행\s*전|최종/u.test(lower)) return "approval_habit";
  if (/연결|로그인|계정|권한|복구|실패|막히/u.test(lower)) return "connection_recovery";
  if (/반복|매일|매주|매월|요일|자동화|정기/u.test(lower)) return "repeat_pattern";
  return "tone";
}

function sourceKindForPersonalization(kind: MemoryPersonalizationKind): LocalMemoryWorkLearningSourceKind {
  if (kind === "reply_format" || kind === "approval_habit") return "mailops";
  if (kind === "connection_recovery") return "connector_recovery";
  if (kind === "repeat_pattern") return "general";
  return "general";
}

function sourceLabelForPersonalization(kind: MemoryPersonalizationKind) {
  if (kind === "tone") return "말투 기준";
  if (kind === "reply_format") return "답장 형식";
  if (kind === "approval_habit") return "승인 습관";
  if (kind === "connection_recovery") return "연결 복구 방식";
  return "반복 업무 패턴";
}

function summaryForPersonalization(kind: MemoryPersonalizationKind, text: string) {
  const compact = text.replace(/\s+/gu, " ").slice(0, 120);
  if (kind === "tone") return `답변 말투 기준: ${compact}`;
  if (kind === "reply_format") return `메일/문의 답장 형식 기준: ${compact}`;
  if (kind === "approval_habit") return `승인 전 확인 기준: ${compact}`;
  if (kind === "connection_recovery") return `연결 실패 시 복구 기준: ${compact}`;
  return `반복 업무 제안 기준: ${compact}`;
}

function signalsForPersonalization(kind: MemoryPersonalizationKind, text: string) {
  const signals = [
    `사용자 직접 요청: ${text.replace(/\s+/gu, " ").slice(0, 120)}`,
    "자동 실행하지 않고 다음 유사 요청에서 제안으로 먼저 보여줌",
  ];
  if (kind === "approval_habit") signals.push("외부 발송, 일정 등록, 파일 변경은 최종 확인 전까지 실행하지 않음");
  if (kind === "reply_format") signals.push("답장 초안은 사용자가 승인하거나 수정하기 전 발송하지 않음");
  if (kind === "repeat_pattern") signals.push("반복 업무는 저장만으로 실행하지 않고 사용자가 켠 뒤에만 점검");
  if (kind === "connection_recovery") signals.push("막히면 이유, 해결 버튼, 다시 이어가기 순서로 안내");
  return signals;
}

function findMemoryPersonalizationConflicts(
  kind: MemoryPersonalizationKind,
  sourceKind: LocalMemoryWorkLearningSourceKind,
  workPatterns: LocalMemoryWorkPattern[],
  summary: string,
) {
  const label = sourceLabelForPersonalization(kind);
  const terms = extractConflictTerms(summary);
  return workPatterns
    .filter((pattern) => {
      const haystack = [pattern.sourceLabel, pattern.summary, ...(pattern.signals ?? [])].join(" ");
      if (pattern.sourceKind === sourceKind && new RegExp(label, "u").test(haystack)) return true;
      const overlap = terms.filter((term) => haystack.includes(term)).length;
      return pattern.sourceKind === sourceKind && overlap >= 2;
    })
    .slice(0, 3);
}

function extractConflictTerms(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !/^(다음부터|앞으로|항상|기억|저장|기준|사용자)$/u.test(item))
    .slice(0, 12);
}
