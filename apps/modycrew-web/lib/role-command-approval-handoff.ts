import type { WorkItem } from "@/lib/types";
import { retainAuthoritativeMailCard } from "./mail-dispatch-ui.mjs";

export const ROLE_COMMAND_APPROVAL_HANDOFF_PROOF = "role_quick_command_ai_answer_to_office_approval_candidate";
export const roleCommandApprovalHandoffStorageKey = "modycrew-role-command-approval-handoff-items-v1";
export const roleCommandOfficeLearnedDraftFocusStorageKey = "modycrew-office-learned-draft-focus-v1";

export type RoleCommandApprovalHandoffInput = {
  teammateName: string;
  roleTitle: string;
  requestedWorkSummary: string;
  candidateLabel: string;
  pipelineLabel: string;
  connectionGateLabel: string;
  approvalGateLabel: string;
  evidencePath: string;
  traceId: string;
  aiAnswerSummary: string;
  receivedAt?: string;
};

function compactText(value: string | undefined, fallback: string, maxLength = 420) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function classifyRoleCommandCandidate(input: RoleCommandApprovalHandoffInput) {
  const joined = `${input.candidateLabel} ${input.pipelineLabel} ${input.requestedWorkSummary}`;
  const primarySurface = `${input.candidateLabel} ${input.requestedWorkSummary}`;
  if (
    /일정|캘린더|회의|미팅|예약|방문|시간|날짜|스케줄|calendar|schedule|meeting/iu.test(primarySurface) &&
    !/메일|문의|답장|mail|inquiry|reply/iu.test(primarySurface)
  ) {
    return {
      idPrefix: "role-schedule",
      title: "역할 명령 승인 후보: 일정 후보",
      source: "calendar" as const,
      sourceLabel: "역할 명령 · 일정 후보",
      toneLabel: "일정 등록 승인 후보",
      preview: "캘린더 가능 시간과 참석자 확인 뒤 일정 후보만 만들며 등록, 초대, 공유는 승인 전까지 실행하지 않습니다.",
      labels: ["역할 명령", "일정 후보", "승인 전 등록 잠금"],
      intentLabel: "schedule",
      riskLabel: "medium" as const,
      riskId: "role-command-schedule-approval-risk",
      riskLabelText: "일정 등록 전 승인",
      riskReason: "일정 등록과 초대 발송은 외부 변경으로 이어질 수 있어 시간, 참석자, 장소, 안내 문구를 사용자가 승인해야 합니다.",
    };
  }
  if (/메일|문의|답장|mail|inquiry|reply/iu.test(joined)) {
    return {
      idPrefix: "role-mail-reply",
      title: "역할 명령 승인 후보: 메일/문의 답장",
      source: "email" as const,
      sourceLabel: "역할 명령 · 메일/문의 답장 후보",
      toneLabel: "메일 답장 승인 후보",
      preview: "AI 답변으로 업무 방향을 잡았지만 메일 원문, 수신자, 제목, 본문, 첨부 확인 전까지 실제 발송하지 않습니다.",
      labels: ["역할 명령", "메일/문의 답장 후보", "승인 전 발송 잠금"],
      intentLabel: "mail_or_inquiry",
      riskLabel: "high" as const,
      riskId: "role-command-mail-reply-approval-risk",
      riskLabelText: "메일 발송 전 최종 확인",
      riskReason: "메일/문의 답장은 외부 발송으로 이어질 수 있어 원문, 수신자, 본문, 첨부, 일정 영향을 사용자가 승인해야 합니다.",
    };
  }
  if (/폴더|정리/u.test(joined)) {
    return {
      idPrefix: "role-folder-tidy",
      title: "역할 명령 승인 후보: 폴더 정리",
      source: "local_file" as const,
      sourceLabel: "역할 명령 · 폴더 정리 후보",
      toneLabel: "폴더 정리 승인 후보",
      localFileName: "선택 폴더 정리 후보",
      extension: "folder",
      sizeLabel: "범위 확인 필요",
      scopeKind: "folder" as const,
      preview: "선택한 폴더 범위와 제외/충돌 기준을 확인하기 전까지 파일 이동, 이름 변경, 삭제를 실행하지 않습니다.",
      labels: ["역할 명령", "폴더 정리 후보", "승인 전 잠금"],
      intentLabel: "folder_tidy",
      riskLabel: "medium" as const,
      riskId: "role-command-folder-tidy-approval-risk",
      riskLabelText: "파일 이동/삭제 전 승인",
      riskReason: "폴더 정리는 파일 이동, 이름 변경, 삭제로 이어질 수 있어 사용자가 승인함에서 범위와 적용 문구를 확인해야 합니다.",
    };
  }
  return {
    idPrefix: "role-document-draft",
    title: "역할 명령 승인 후보: 문서/보고서 초안",
    source: "local_file" as const,
    sourceLabel: "역할 명령 · 문서 초안 후보",
    toneLabel: "문서 초안 승인 후보",
    localFileName: "선택 자료 문서 초안 후보",
    extension: "draft",
    sizeLabel: "자료 선택 필요",
    scopeKind: "file" as const,
    preview: "사용자가 고른 자료와 양식만 확인한 뒤 초안 후보를 만들며 저장, 공유, 제출은 승인 전까지 실행하지 않습니다.",
    labels: ["역할 명령", "문서/보고서 초안", "승인 전 잠금"],
    intentLabel: "document_draft",
    riskLabel: "medium" as const,
    riskId: "role-command-document-draft-approval-risk",
    riskLabelText: "자료/초안 승인 전 잠금",
    riskReason: "문서 초안은 선택 자료와 양식 확인 뒤에만 만들고 저장, 공유, 제출은 승인함 확인 전까지 실행하지 않습니다.",
  };
}

export function createRoleCommandApprovalWorkItem(input: RoleCommandApprovalHandoffInput): WorkItem {
  const receivedAt = input.receivedAt || new Date().toISOString();
  const profile = classifyRoleCommandCandidate(input);
  const traceId = compactText(input.traceId, `role-command-${Date.parse(receivedAt) || Date.now()}`, 160);
  const requestSummary = compactText(input.requestedWorkSummary, "역할에게 맡긴 업무 요청", 360);
  const aiAnswerSummary = compactText(input.aiAnswerSummary, "실제 AI 답변 완료 뒤 승인 후보로 연결됐습니다.", 520);
  const candidateLabel = compactText(input.candidateLabel, "업무 후보 -> 오피스 승인함", 220);
  const pipelineLabel = compactText(input.pipelineLabel, "ConversationEngine -> WorkAutomationEngine -> ApprovalEngine", 360);
  const connectionGateLabel = compactText(input.connectionGateLabel, "사용자가 선택한 자료와 연결만 사용", 260);
  const approvalGateLabel = compactText(input.approvalGateLabel, "approval_before_external_mutation", 200);
  const isMailCandidate = profile.source === "email";
  const isScheduleCandidate = profile.source === "calendar";
  const roleIntentLabels = [
    "role_quick_command",
    ROLE_COMMAND_APPROVAL_HANDOFF_PROOF,
    input.evidencePath,
    profile.intentLabel,
  ].filter(Boolean);

  return {
    id: `${profile.idPrefix}-${traceId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 90)}`,
    title: profile.title,
    source: profile.source,
    sourceLabel: profile.sourceLabel,
    senderLabel: compactText(input.teammateName, "AI 역할", 120),
    body: [
      requestSummary,
      `AI 답변 요약: ${aiAnswerSummary}`,
      `후보: ${candidateLabel}`,
      `파이프라인: ${pipelineLabel}`,
      `연결/자료 경계: ${connectionGateLabel}`,
      `승인 경계: ${approvalGateLabel}`,
    ].join("\n"),
    summary: `${compactText(input.roleTitle, "AI 역할", 120)}이 실제 AI 답변 후 만든 승인 후보입니다. 오피스 승인함에서 확인 전까지 외부 실행은 잠겨 있습니다.`,
    status: "approval_pending",
    riskLabel: profile.riskLabel,
    riskSignals: [
      {
        id: profile.riskId,
        label: profile.riskLabelText,
        riskLabel: profile.riskLabel,
        reason: profile.riskReason,
      },
    ],
    receivedAt,
    sourceEvidence: {
      providerId: isMailCandidate ? ROLE_COMMAND_APPROVAL_HANDOFF_PROOF : "document_learning",
      connectorId: isMailCandidate ? "company-mail" : undefined,
      mailboxLabel: isMailCandidate ? "역할 명령 메일 후보" : "역할 명령 승인 후보",
      messageSubject: requestSummary,
      senderPreview: compactText(input.teammateName, "AI 역할", 120),
      replyToLabel: isMailCandidate ? "수신자 확인 필요" : undefined,
      draftPreview: aiAnswerSummary,
      calendarCandidateText: isScheduleCandidate ? aiAnswerSummary : undefined,
      calendarTimeRangeLabel: isScheduleCandidate ? "사용자 확인 필요" : undefined,
      calendarAttendeeLabels: isScheduleCandidate ? ["참석자 확인 필요"] : undefined,
      calendarLocationLabel: isScheduleCandidate ? "장소 확인 필요" : undefined,
      calendarReminderLabel: isScheduleCandidate ? "알림 확인 필요" : undefined,
      calendarConflictLabel: isScheduleCandidate ? "가능 시간 확인 후 등록" : undefined,
      scheduleWindowLabel: isScheduleCandidate ? connectionGateLabel : undefined,
      detectedIntentLabels: roleIntentLabels,
      approvalCandidateLabels: profile.labels,
      mailWorkReview: isMailCandidate
        ? {
            proof: ROLE_COMMAND_APPROVAL_HANDOFF_PROOF,
            originalSummary: "역할 명령은 통과했지만 실제 메일 원문은 승인함에서 확인해야 합니다.",
            draftSummary: aiAnswerSummary,
            replyMethodLabel: "답장 후보를 메일 직원 작업함에서 수정한 뒤 마지막 확인",
            sendDecisionReason: "실제 AI 답변 뒤 메일/문의 답장 후보로 분류됐지만 최종 승인 전까지 발송하지 않습니다.",
            editFocusLabel: "원문, 수신자, 제목, 본문, 첨부, 일정 영향",
            attachmentSummary: "첨부/링크는 원문 확인 뒤 결정",
            finalApprovalBoundary: "메일 직원 작업함 결정과 오피스 마지막 확인 전까지 외부 발송 없음",
            privacyBoundary: "메일 비밀번호, OAuth 토큰, 원문 전문은 로컬 저장/표시하지 않습니다.",
          }
        : undefined,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    },
    draft: {
      id: `${profile.idPrefix}-draft-${traceId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 90)}`,
      toneLabel: profile.toneLabel,
      body: aiAnswerSummary,
      operationKind: isMailCandidate ? "draft_reply" : isScheduleCandidate ? "draft_calendar_event" : "stage_approval",
      requiresApprovalBeforeSend: true,
    },
    ...(isMailCandidate
      ? {
          finalAction: {
            kind: "send_email" as const,
            label: "메일 답장 최종 확인",
            requiresFinalUserPresence: true,
            readiness: "adapter_not_connected" as const,
            blockedReason: "메일 원문, 수신자, 제목, 본문, 첨부, 일정 영향을 확인하기 전까지 실제 발송하지 않습니다.",
            checklist: [
              "원문 메일/문의 내용 확인",
              "수신자, 참조, 숨은참조 확인",
              "제목과 본문 수정 확인",
              "첨부/링크/개인정보 확인",
              "일정 등록이나 후속 작업 영향 확인",
              "오피스 마지막 확인에서 사용자 승인",
            ],
            mailSendApprovalGate: {
              policy: "work_queue_approve_only" as const,
              requiredDecision: "approve" as const,
              decision: "hold" as const,
              requiredFinalRoute: "included" as const,
              finalRoute: "held" as const,
              sourceContract: "role_command_ai_answer_to_mailops_workqueue",
              revisedDraft: aiAnswerSummary,
              reviewNote: "실제 AI 답변 기반 메일/문의 후보입니다. 메일 직원 작업함에서 수정/승인 전까지 발송하지 않습니다.",
              decisionReasonSummary: "역할 명령과 AI 답변은 통과했지만 메일 원문과 수신자 확인 전까지 보류합니다.",
              sendCheckSummary: "수신자, 제목, 본문, 첨부, 일정 영향을 마지막 확인에서 재점검",
              draftBodySource: "approval_preview" as const,
              externalMutationBeforeGate: false as const,
            },
          },
        }
      : isScheduleCandidate
        ? {
            finalAction: {
              kind: "create_calendar_event" as const,
              label: "일정 등록 최종 확인",
              requiresFinalUserPresence: true,
              readiness: "adapter_not_connected" as const,
              blockedReason: "가능 시간, 참석자, 장소, 안내 문구를 확인하기 전까지 캘린더 등록이나 초대 발송을 실행하지 않습니다.",
              checklist: [
                "가능 시간과 충돌 여부 확인",
                "참석자와 초대 대상 확인",
                "제목, 장소, 설명 문구 확인",
                "알림과 공개 범위 확인",
                "오피스 마지막 확인에서 사용자 승인",
              ],
            },
            schedules: [
              {
                id: `${profile.idPrefix}-candidate-${traceId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 90)}`,
                label: "사용자 확인 후 일정 후보",
                startsAt: receivedAt,
                endsAt: receivedAt,
                conflictNote: "캘린더 가능 시간 확인 전까지 등록하지 않습니다.",
              },
            ],
            scheduleConfirmation: {
              kind: "date_confirmation" as const,
              sourceWorkItemId: `${profile.idPrefix}-${traceId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 90)}`,
              sourceTitle: profile.title,
              sourceText: requestSummary,
              reason: "역할 명령 일정 후보는 시간과 참석자 확인 뒤 승인해야 합니다.",
              question: "이 시간과 참석자로 일정 등록 후보를 승인할까요?",
            },
          }
      : {
          localFile: {
            path: "role-command://selected-user-material",
            name: profile.localFileName,
            folder: "역할 명령",
            extension: profile.extension,
            sizeLabel: profile.sizeLabel,
            modifiedAt: receivedAt,
            extractedTextStatus: "pending" as const,
            preview: profile.preview,
            scopeKind: profile.scopeKind,
            selectionMode: "user_selected_file_or_folder" as const,
            folderScopePolicy: "selected_scope_only",
            childCountLabel: profile.sizeLabel,
          },
        }),
  };
}

export function isRoleCommandApprovalWorkItem(item: WorkItem | null | undefined): boolean {
  return item?.sourceEvidence?.detectedIntentLabels?.includes(ROLE_COMMAND_APPROVAL_HANDOFF_PROOF) === true;
}

export function readRoleCommandApprovalWorkItems(): WorkItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(roleCommandApprovalHandoffStorageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is WorkItem =>
      Boolean(item && typeof item.id === "string" && isRoleCommandApprovalWorkItem(item as WorkItem)),
    );
  } catch {
    return [];
  }
}

export function upsertRoleCommandApprovalWorkItem(input: RoleCommandApprovalHandoffInput): WorkItem {
  const nextItem = createRoleCommandApprovalWorkItem(input);
  if (typeof window === "undefined") return nextItem;
  const current = readRoleCommandApprovalWorkItems().filter((item) => item.id !== nextItem.id);
  window.localStorage.setItem(roleCommandApprovalHandoffStorageKey, JSON.stringify([nextItem, ...current].slice(0, 8)));
  window.localStorage.setItem(
    roleCommandOfficeLearnedDraftFocusStorageKey,
    JSON.stringify({
      workItemId: nextItem.id,
      draftCount: 1,
      sourceLabel: nextItem.sourceLabel,
      nextUserChoice: "오피스 승인함에서 실행하기, 고쳐달라고 하기, 보류하기 중 하나를 고릅니다.",
      createdAt: Date.now(),
    }),
  );
  return nextItem;
}

export function mergeRoleCommandApprovalWorkItems(items: WorkItem[], roleCommandItems: WorkItem[]): WorkItem[] {
  const merged = [...items];
  for (const item of roleCommandItems) {
    const index = merged.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) { if (!retainAuthoritativeMailCard(merged[index]!)) merged[index] = item; }
    else merged.unshift(item);
  }
  return merged;
}
