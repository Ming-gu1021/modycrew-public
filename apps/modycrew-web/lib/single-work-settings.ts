export type SingleWorkSettingId =
  | "codex-oauth"
  | "ai"
  | "mail"
  | "mail-calendar"
  | "notification"
  | "notification-assistant"
  | "messenger"
  | "mail-learning"
  | "calendar"
  | "calendar-suggestions"
  | "vault"
  | "external-account-vault"
  | "memory-root"
  | "messenger-channel"
  | "crewkit"
  | "learn-source"
  | "office-queue"
  | "worker-channel"
  | "computer-use"
  | "connector";

export type SingleWorkSettingDefinition = {
  id: SingleWorkSettingId;
  canonicalId: SingleWorkSettingId;
  label: string;
  title: string;
  focusLabel: string;
  connectorIds: string[];
  panel: "connect" | "account" | "office" | "workers" | "skills" | "learn" | "computer-use";
};

const definitions: SingleWorkSettingDefinition[] = [
  {
    id: "codex-oauth",
    canonicalId: "ai",
    label: "AI 답변 연결",
    title: "AI 답변 연결 설정",
    focusLabel: "AI 답변 연결 설정만 전용으로 엽니다",
    connectorIds: [],
    panel: "connect",
  },
  {
    id: "ai",
    canonicalId: "ai",
    label: "AI 연결",
    title: "AI 연결 설정",
    focusLabel: "AI 연결 설정만 전용으로 엽니다",
    connectorIds: [],
    panel: "connect",
  },
  {
    id: "mail",
    canonicalId: "mail-calendar",
    label: "메일 연결",
    title: "메일/캘린더 연결 설정",
    focusLabel: "메일/캘린더 연결 설정만 전용으로 엽니다",
    connectorIds: ["gmail", "outlook", "company-mail", "naver-mail", "daum-kakao-mail", "google-calendar", "outlook-calendar"],
    panel: "connect",
  },
  {
    id: "mail-calendar",
    canonicalId: "mail-calendar",
    label: "메일/캘린더",
    title: "메일/캘린더 연결 설정",
    focusLabel: "메일/캘린더 연결 설정만 전용으로 엽니다",
    connectorIds: ["gmail", "outlook", "company-mail", "naver-mail", "daum-kakao-mail", "google-calendar", "outlook-calendar"],
    panel: "connect",
  },
  {
    id: "notification",
    canonicalId: "notification-assistant",
    label: "업무 알림 비서",
    title: "업무 알림 비서 설정",
    focusLabel: "업무 알림 비서 승인 채널 설정만 전용으로 엽니다",
    connectorIds: ["telegram-bot", "slack-app", "discord-app", "kakaotalk-local-app"],
    panel: "connect",
  },
  {
    id: "notification-assistant",
    canonicalId: "notification-assistant",
    label: "업무 알림 비서",
    title: "업무 알림 비서 설정",
    focusLabel: "업무 알림 비서 승인 채널 설정만 전용으로 엽니다",
    connectorIds: ["telegram-bot", "slack-app", "discord-app", "kakaotalk-local-app"],
    panel: "connect",
  },
  {
    id: "messenger",
    canonicalId: "notification-assistant",
    label: "업무 알림 비서",
    title: "업무 알림 비서 설정",
    focusLabel: "업무 알림 비서 승인 채널 설정만 전용으로 엽니다",
    connectorIds: ["telegram-bot", "slack-app", "discord-app", "kakaotalk-local-app"],
    panel: "connect",
  },
  {
    id: "mail-learning",
    canonicalId: "mail-learning",
    label: "메일함 학습",
    title: "메일함 학습 설정",
    focusLabel: "메일함 학습 준비 설정만 전용으로 엽니다",
    connectorIds: ["gmail", "outlook", "company-mail", "naver-mail", "daum-kakao-mail"],
    panel: "connect",
  },
  {
    id: "calendar",
    canonicalId: "calendar-suggestions",
    label: "일정 추천",
    title: "일정 추천 설정",
    focusLabel: "일정 추천 연결 설정만 전용으로 엽니다",
    connectorIds: ["google-calendar", "outlook-calendar"],
    panel: "connect",
  },
  {
    id: "calendar-suggestions",
    canonicalId: "calendar-suggestions",
    label: "일정 추천",
    title: "일정 추천 설정",
    focusLabel: "일정 추천 연결 설정만 전용으로 엽니다",
    connectorIds: ["google-calendar", "outlook-calendar"],
    panel: "connect",
  },
  {
    id: "vault",
    canonicalId: "vault",
    label: "계정 보관함",
    title: "계정 보관함 설정",
    focusLabel: "계정 보관함 설정만 전용으로 엽니다",
    connectorIds: ["company-mail", "kakaotalk-local-app"],
    panel: "account",
  },
  {
    id: "external-account-vault",
    canonicalId: "vault",
    label: "계정 보관함",
    title: "계정 보관함 설정",
    focusLabel: "계정 보관함 설정만 전용으로 엽니다",
    connectorIds: ["company-mail", "kakaotalk-local-app"],
    panel: "account",
  },
  {
    id: "memory-root",
    canonicalId: "memory-root",
    label: "기억 위치",
    title: "기억 위치 설정",
    focusLabel: "기억 저장 위치 설정만 전용으로 엽니다",
    connectorIds: [],
    panel: "account",
  },
  {
    id: "messenger-channel",
    canonicalId: "messenger-channel",
    label: "메신저 채널",
    title: "메신저 채널 설정",
    focusLabel: "메신저 채널 설정만 전용으로 엽니다",
    connectorIds: ["telegram-bot", "slack-app", "discord-app", "kakaotalk-local-app"],
    panel: "connect",
  },
  {
    id: "crewkit",
    canonicalId: "crewkit",
    label: "업무 도구 추천",
    title: "업무 도구 설정",
    focusLabel: "업무 도구 설정만 전용으로 엽니다",
    connectorIds: [],
    panel: "skills",
  },
  {
    id: "learn-source",
    canonicalId: "learn-source",
    label: "학습 자료",
    title: "학습 자료 설정",
    focusLabel: "학습 자료 연결 설정만 전용으로 엽니다",
    connectorIds: ["local-folder-index", "google-drive", "notion-workspace"],
    panel: "learn",
  },
  {
    id: "office-queue",
    canonicalId: "office-queue",
    label: "오피스 승인함",
    title: "오피스 승인함 설정",
    focusLabel: "오피스 승인함 설정만 전용으로 엽니다",
    connectorIds: [],
    panel: "office",
  },
  {
    id: "worker-channel",
    canonicalId: "worker-channel",
    label: "AI 팀원",
    title: "AI 팀원 설정",
    focusLabel: "AI 팀원 설정만 전용으로 엽니다",
    connectorIds: [],
    panel: "workers",
  },
  {
    id: "computer-use",
    canonicalId: "computer-use",
    label: "내 PC 작업 도우미",
    title: "내 PC 작업 도우미 설정",
    focusLabel: "내 PC 작업 도우미 읽기 후보 설정만 전용으로 엽니다",
    connectorIds: ["computer-use"],
    panel: "computer-use",
  },
  {
    id: "connector",
    canonicalId: "connector",
    label: "선택 연결",
    title: "선택 연결 설정",
    focusLabel: "선택한 연결 설정만 전용으로 엽니다",
    connectorIds: [],
    panel: "connect",
  },
];

const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));

const singleWorkSettingAliases: Record<string, SingleWorkSettingId> = {
  memory_root: "memory-root",
  "local-memory": "memory-root",
  messenger_channels: "messenger-channel",
  "messenger-channels": "messenger-channel",
  "skill-market": "crewkit",
  "growth-system": "crewkit",
  "learning-source": "learn-source",
  documents: "learn-source",
  "document-learning": "learn-source",
  "approval-queue": "office-queue",
  "work-queue": "office-queue",
  "office-inbox": "office-queue",
  "ai-worker": "worker-channel",
  "team-channel": "worker-channel",
  workers: "worker-channel",
  "desktop-control": "computer-use",
  "computer_use": "computer-use",
};

function canonicalizeSingleWorkSettingInput(value: string | null | undefined): SingleWorkSettingId | "" {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  return singleWorkSettingAliases[raw] ?? (raw as SingleWorkSettingId);
}

export function normalizeSingleWorkSettingId(value: string | null | undefined): SingleWorkSettingId | "" {
  const id = canonicalizeSingleWorkSettingInput(value);
  if (!id) return "";
  return definitionById.has(id) ? definitionById.get(id)!.canonicalId : "";
}

export function getSingleWorkSettingDefinition(value: string | null | undefined): SingleWorkSettingDefinition | null {
  const id = canonicalizeSingleWorkSettingInput(value);
  if (!id) return null;
  const exact = definitionById.get(id);
  if (exact) return exact;
  const normalized = normalizeSingleWorkSettingId(id);
  return normalized ? definitionById.get(normalized as SingleWorkSettingId) ?? null : null;
}

export function connectorIdsForSingleWorkSetting(value: string | null | undefined): string[] {
  return getSingleWorkSettingDefinition(value)?.connectorIds ?? [];
}

export function singleWorkSettingFocusLabel(value: string | null | undefined): string {
  return getSingleWorkSettingDefinition(value)?.focusLabel ?? "";
}

export function isSingleWorkSettingId(value: string | null | undefined): value is SingleWorkSettingId {
  return Boolean(getSingleWorkSettingDefinition(value));
}

export const singleWorkSettingDefinitions = definitions;
