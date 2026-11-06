/**
 * AI 오피스 (B 화면) 타입.
 *
 * 6개 데스크가 실제 작업 흐름과 연결되어 "AI 팀원들이 지금 무엇을 처리하고 있는지"
 * 를 시각화합니다. 장식이 아니라 실제 상태.
 *
 * docs/10 (디자인 시스템), docs/31 (UI/UX 플레이북) 의 Virtual Office View 기준.
 */

export type DeskId =
  | "inbox"
  | "calendar"
  | "document"
  | "approval"
  | "guard"
  | "ops";

export type DeskCardStatus =
  | "analyzing"
  | "draft_ready"
  | "approval_pending"
  | "blocked"
  | "completed"
  | "failed";

export type DeskCard = {
  id: string;
  title: string;
  status: DeskCardStatus;
  triggerSource: string;
  ageMinutes: number;
  /** 다음에 어떤 데스크로 흘러가는지 (오피스 보드 화살표용) */
  nextDesk?: DeskId;
};

export type Desk = {
  id: DeskId;
  label: string;
  shortLabel: string;
  description: string;
  cards: DeskCard[];
  busy: number;
  done: number;
  failed: number;
};

export type AuditEvent = {
  id: string;
  at: string;
  actor: "system" | "agent" | "user" | "tool" | "channel";
  event: string;
  detail: string;
  severity: "info" | "warning" | "danger";
};

export const deskLabels: Record<DeskId, { label: string; short: string; description: string }> = {
  inbox: {
    label: "받은업무 데스크",
    short: "받은업무",
    description: "메일·문의·예약 분류와 첫 요약",
  },
  calendar: {
    label: "일정 데스크",
    short: "일정",
    description: "캘린더 가능 시간 + 일정 후보",
  },
  document: {
    label: "자료 데스크",
    short: "자료",
    description: "로컬 파일 학습 + 보고서·PPT·이미지 생성",
  },
  approval: {
    label: "승인 데스크",
    short: "승인",
    description: "사용자 검토 대기 + 외부 발송 직전",
  },
  guard: {
    label: "보안 데스크",
    short: "보안",
    description: "개인정보·세무·계약·공공기관 위험 검토",
  },
  ops: {
    label: "운영 데스크",
    short: "운영",
    description: "연결 상태 + 재시도 + 감사 로그",
  },
};

export const auditActorLabels: Record<AuditEvent["actor"], string> = {
  system: "시스템",
  agent: "AI 팀원",
  user: "사용자",
  tool: "연결 도구",
  channel: "업무 채널",
};

export const auditEventLabels: Record<string, string> = {
  approval_decided: "승인 완료",
  tool_blocked: "자동 실행 차단",
  tool_completed: "작업 완료",
  tool_failed: "재시도 후 복구",
  approval_required: "승인 대기 등록",
  channel_decision_recorded: "메신저 결정 기록",
  channel_intent_parsed: "문의 내용 파악",
  document_ingested: "자료 학습 완료",
};
