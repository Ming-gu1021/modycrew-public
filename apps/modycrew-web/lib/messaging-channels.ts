"use client";

export type MessengerChannelKind = "telegram" | "slack" | "discord" | "imessage" | "kakao" | "app";

export type MessengerConnectionMode = "built_in" | "bot_token" | "oauth" | "webhook" | "local_bridge" | "policy_review";

export type MessengerCredentialField = {
  label: string;
  purpose: string;
  secret?: boolean;
};

export type MessengerChannel = {
  id: string;
  kind: MessengerChannelKind;
  label: string;
  connectorId?: string;
  status: "built_in" | "recommended" | "connectable" | "limited";
  setupMode: MessengerConnectionMode;
  summary: string;
  setupHint: string;
  officialSetupSteps: string[];
  fallbackRoutes: string[];
  credentialFields: MessengerCredentialField[];
  liveCheckLabel: string;
  routingTarget: string;
  officeSignal: string;
  secretStorageHint: string;
  commandExamples: string[];
  safetyBoundary: string;
};

export type MessengerConnectionState = "built_in" | "connected" | "needs_setup" | "limited" | "error";

export type MessengerConnectorStatusLike = {
  connectorId: string;
  status: string;
  lastCheckedAt?: string;
  channelTargetId?: string;
  userMessage?: string;
  permissions?: {
    messengerReport?: boolean;
  };
  recovery?: {
    kind?: string;
    label?: string;
    detail?: string;
  };
};

export type MessengerConnectionSummary = {
  id: string;
  connectorId: string;
  label: string;
  state: MessengerConnectionState;
  statusLabel: string;
  detail: string;
  targetLabel: string;
  checkedAt?: string;
};

export type MessengerConversationPlaybookCard = {
  channelId: string;
  label: string;
  modeLabel: string;
  stateLabel: string;
  guideLine: string;
  steps: Array<{
    label: string;
    detail: string;
  }>;
  safeFallback: string;
  secretRule: string;
  finalRoute: string;
};

const activeStorageKey = "modycrew-active-messenger-channels-v1";

export const defaultMessengerChannels: MessengerChannel[] = [
  {
    id: "app-main-control",
    kind: "app",
    label: "앱 메인 컨트롤",
    status: "built_in",
    setupMode: "built_in",
    summary: "ModyCrew 안에서 기본으로 열리는 메인 지휘 채널입니다.",
    setupHint: "추가 연결 없이 바로 사용합니다. 다른 팀원 채널에 일을 나눠 맡기는 기준 채널입니다.",
    officialSetupSteps: ["앱 로그인 후 기본 대화로 자동 생성", "AI 팀원 탭에서 팀원 추가", "메인 컨트롤에서 역할별 AI 팀원에게 업무 위임"],
    fallbackRoutes: ["외부 메신저가 없어도 앱 내부 채널로 승인/수정 의사를 기록", "오피스에서 AI 팀원별 작업 상태 확인"],
    credentialFields: [],
    liveCheckLabel: "앱 내부 채널 생성 확인",
    routingTarget: "메인 컨트롤 -> 역할별 AI 팀원",
    officeSignal: "오피스에는 담당 AI 팀원, 진행률, 승인 대기가 바로 표시됩니다.",
    secretStorageHint: "추가 보안 입력값 없음",
    commandExamples: ["오늘 업무 정리", "운영 담당에게 문의 분류 맡겨", "승인 대기 보여줘"],
    safetyBoundary: "앱 안 명령은 기록되지만 외부 발송, 일정 등록, 파일 변경은 승인 전 실행하지 않습니다.",
  },
  {
    id: "telegram-bot",
    kind: "telegram",
    label: "Telegram Bot",
    connectorId: "telegram-bot",
    status: "connectable",
    setupMode: "bot_token",
    summary: "가장 빠르게 붙일 수 있는 개인 승인/보고 채널입니다.",
    setupHint: "BotFather에서 봇을 만들고 인증값과 대화 ID를 보관함에 저장합니다.",
    officialSetupSteps: ["Telegram에서 BotFather 열기", "/newbot으로 봇 인증값 발급", "봇에게 메시지를 한 번 보내고 대화 ID 확인", "인증값과 대화 ID를 외부 계정 보관함에 저장"],
    fallbackRoutes: ["대화 ID를 모르면 명령 수신만 먼저 켜고 승인 알림은 나중에 추가", "회사 정책상 봇이 막히면 앱 메인 컨트롤 채널로 승인 요청 유지"],
    credentialFields: [
      { label: "봇 인증값", purpose: "BotFather가 발급한 봇 인증값", secret: true },
      { label: "대화 ID", purpose: "승인/보고를 받을 개인 대화 또는 채널 ID" },
    ],
    liveCheckLabel: "getMe + 테스트 메시지 전송",
    routingTarget: "Telegram -> 메신저 결정 인박스 -> 담당 AI 팀원",
    officeSignal: "승인 요청, 보류, 수정 요청이 오피스 결정 카드로 들어옵니다.",
    secretStorageHint: "봇 인증값과 대화 ID는 채팅이 아니라 외부 계정 보관함에 저장",
    commandExamples: ["/오늘업무", "/승인대기", "수정 더 정중하게"],
    safetyBoundary: "Telegram 승인은 의사 기록이며 실제 외부 실행은 앱의 마지막 확인을 거칩니다.",
  },
  {
    id: "slack-app",
    kind: "slack",
    label: "Slack",
    connectorId: "slack-app",
    status: "connectable",
    setupMode: "oauth",
    summary: "회사 워크스페이스 채널에서 업무 보고와 승인 요청을 받을 수 있습니다.",
    setupHint: "Slack App을 워크스페이스에 설치하고 테스트 채널부터 연결합니다.",
    officialSetupSteps: ["Slack App 생성 또는 설치 승인 요청", "명령과 봇 권한 확인", "테스트 채널에 앱 초대", "접속 인증값과 서명 키를 보관함에 저장"],
    fallbackRoutes: ["관리자 승인이 막히면 테스트 채널 대신 앱 내부 메인 컨트롤로 승인 요청", "보고 전용 연결만 허용되면 실행은 앱에서 재확인"],
    credentialFields: [
      { label: "Slack 앱 인증값", purpose: "Slack 앱이 채널에 쓰고 읽는 권한", secret: true },
      { label: "서명 키", purpose: "Slack 요청 검증", secret: true },
      { label: "업무 채널 ID", purpose: "처음 테스트할 업무 채널" },
    ],
    liveCheckLabel: "연결 점검 + 테스트 채널 메시지",
    routingTarget: "Slack 채널 -> 메신저 결정 인박스 -> 팀별 AI 팀원",
    officeSignal: "회사 채널 명령은 담당 팀원 작업 큐와 승인 카드로 분리됩니다.",
    secretStorageHint: "접속 인증값과 서명 키는 외부 계정 보관함 또는 OS 보안 저장소 참조로만 보관",
    commandExamples: ["/mody today", "/mody approvals", "이 답장 초안 다시 써줘"],
    safetyBoundary: "회사 채널 권한은 최소 범위로 시작하고 관리자 정책을 먼저 확인합니다.",
  },
  {
    id: "discord-app",
    kind: "discord",
    label: "Discord",
    connectorId: "discord-app",
    status: "connectable",
    setupMode: "bot_token",
    summary: "서버별 채널에서 slash 명령과 업무 알림을 받을 수 있습니다.",
    setupHint: "Discord 개발자 화면에서 봇 인증값을 만들고 서버에 초대합니다.",
    officialSetupSteps: ["Discord 개발자 화면에서 앱 생성", "봇 인증값 발급", "명령과 권한 확인", "서버 초대 링크로 테스트 채널에 추가"],
    fallbackRoutes: ["서버 초대 권한이 없으면 앱 내부 채널에서 먼저 사용", "봇 인증값이 막히면 브라우저/앱 위치 기반 내 PC 작업 도우미 후보로만 보관"],
    credentialFields: [
      { label: "봇 인증값", purpose: "Discord 봇 인증값", secret: true },
      { label: "서버 ID", purpose: "연결할 서버" },
      { label: "업무 채널 ID", purpose: "업무 명령을 받을 채널" },
    ],
    liveCheckLabel: "봇 인증값 검증 + 명령 준비",
    routingTarget: "Discord 서버 -> 메신저 결정 인박스 -> 담당 채널",
    officeSignal: "서버별 명령은 채널 이름과 함께 오피스 승인함에 묶입니다.",
    secretStorageHint: "봇 인증값과 서버/채널 ID는 외부 계정 보관함에 저장",
    commandExamples: ["/mody today", "/mody search 계약서", "보류"],
    safetyBoundary: "서버 명령은 앱 내부 승인함으로 연결하고 위험 작업은 앱에서 재확인합니다.",
  },
  {
    id: "kakao-channel",
    kind: "kakao",
    label: "Kakao 채널",
    connectorId: "kakao-channel",
    status: "limited",
    setupMode: "policy_review",
    summary: "비즈니스 채널 정책이 허용되는 범위에서 문의와 보고를 연결합니다.",
    setupHint: "비즈니스 인증과 공식 연결 범위를 먼저 확인합니다. 정책 확인 전 자동 발송은 켜지 않습니다.",
    officialSetupSteps: ["Kakao Developers 또는 카카오톡 채널 관리자 권한 확인", "비즈니스 인증/권한 심사 필요 여부 확인", "테스트 채널로 문의 수신부터 연결", "발송 권한은 승인 정책과 함께 별도 확인"],
    fallbackRoutes: ["공식 연결이 막히면 외부 계정 보관함에 사이트/앱 위치를 저장하고 수동 확인 루트로 진행", "개인 카카오톡 DM 자동화는 기본 제공하지 않고 앱 승인 카드로 대체"],
    credentialFields: [
      { label: "개발자 앱 키", purpose: "공식 연결이 허용될 때 쓰는 앱 키", secret: true },
      { label: "채널 주소", purpose: "관리자 화면 또는 문의 채널 위치" },
      { label: "승인 기준", purpose: "자동 발송 가능 여부와 승인 기준" },
    ],
    liveCheckLabel: "권한 범위 확인 + 읽기 전용 테스트",
    routingTarget: "Kakao 후보 -> 문의 인박스 -> 초안/승인 카드",
    officeSignal: "정책 확인 전에는 읽기, 분류, 초안 상태로만 표시됩니다.",
    secretStorageHint: "앱 키, 채널 인증값, 관리자 로그인 정보는 채팅에 쓰지 않고 보관함에 저장",
    commandExamples: ["문의 분류", "답장 초안", "승인 대기"],
    safetyBoundary: "친구 관계, 업종 정책, 발송 조건을 확인하기 전에는 읽기/초안 중심으로만 씁니다.",
  },
  {
    id: "kakaotalk-local-app",
    kind: "kakao",
    label: "KakaoTalk 앱/웹",
    connectorId: "kakaotalk-local-app",
    status: "limited",
    setupMode: "local_bridge",
    summary: "공식 연결이 막히는 카카오톡 업무 대화를 사이트 링크, 앱 위치, 계정 보관함, 내 PC 작업 도우미 읽기 후보로 이어갑니다.",
    setupHint: "카카오톡 PC 앱 또는 웹 관리자 화면 위치를 보관함에 저장하고, 먼저 읽기/확인 후보만 오피스 승인함으로 보냅니다.",
    officialSetupSteps: [
      "공식 Kakao 채널 연결 가능 여부를 먼저 확인",
      "막히면 카카오톡 PC 앱 위치 또는 관리자 사이트 링크를 보관함에 저장",
      "업무 대화 범위와 읽기 허용 채널을 사용자가 직접 지정",
      "내 PC 작업 도우미는 읽기/초안 후보까지만 열고 전송은 앱의 마지막 확인으로 고정",
    ],
    fallbackRoutes: [
      "외부 계정 보관함에 사이트 링크, 아이디 참조, 앱 위치 저장",
      "내 PC 읽기 모드로 열린 대화와 최근 알림만 확인",
      "전송이 필요한 경우 오피스 승인 카드에서 문구를 확인한 뒤 수동 또는 앱의 마지막 확인으로 진행",
    ],
    credentialFields: [
      { label: "카카오톡 앱 위치", purpose: "PC 카카오톡 실행 파일 또는 바로가기 위치" },
      { label: "관리자 로그인 주소", purpose: "채널 관리자 또는 웹 로그인 주소" },
      { label: "보관함 계정 이름", purpose: "보관함에 저장된 계정 식별자" },
    ],
    liveCheckLabel: "앱 위치/사이트 링크 저장 + 읽기 전용 내 PC 작업 도우미 후보 생성",
    routingTarget: "KakaoTalk 앱/웹 -> 내 PC 작업 도우미 읽기 후보 -> 오피스 승인 카드",
    officeSignal: "카카오톡은 정책 확인 전 읽기 후보, 답장 초안, 승인 대기 상태로만 오피스에 표시됩니다.",
    secretStorageHint: "카카오 계정 비밀번호는 채팅에 쓰지 않고 외부 계정 보관함에 암호화 참조로 저장",
    commandExamples: ["카카오 문의 요약", "답장 초안", "이 대화는 보류"],
    safetyBoundary: "개인/업무 대화 자동 전송은 기본 비활성입니다. 앱 위치 기반 확인은 읽기와 초안 생성까지만 사용합니다.",
  },
  {
    id: "imessage-local",
    kind: "imessage",
    label: "iMessage / Messages",
    connectorId: "imessage-local-macos-bridge",
    status: "limited",
    setupMode: "local_bridge",
    summary: "macOS 권한이 있을 때 이 PC에서 읽기 후보를 검토할 수 있는 채널입니다.",
    setupHint: "Windows 기본 배포에서는 준비 항목으로만 보이고, macOS 메시지 권한이 있는 환경에서 별도 연결합니다.",
    officialSetupSteps: ["macOS Messages 앱 접근 권한 확인", "이 PC에서 읽기/알림 범위만 먼저 허용", "개인 메시지 변경 작업은 앱의 마지막 확인으로 고정"],
    fallbackRoutes: ["Windows에서는 앱 내부 메인 컨트롤 채널로 대체", "Apple Messages for Business가 필요한 경우 별도 비즈니스 연결 후보로 보관"],
    credentialFields: [
      { label: "이 PC 연결 위치", purpose: "macOS에서만 허용되는 로컬 연결 위치" },
      { label: "허용할 대화", purpose: "읽기/알림을 허용할 대화 범위" },
    ],
    liveCheckLabel: "로컬 권한 확인 + 읽기 전용 이벤트",
    routingTarget: "메시지 앱 -> 앱 내부 승인 카드",
    officeSignal: "Windows에서는 준비 항목으로만 보이고 앱 메인 컨트롤로 대체됩니다.",
    secretStorageHint: "개인 메시지 원문과 계정 비밀번호는 업무 방식 기억이나 프로필에 저장하지 않음",
    commandExamples: ["오늘 업무", "승인 대기", "앱 열기"],
    safetyBoundary: "개인 메시지 앱은 현장 권한과 사용자 확인을 전제로 하고 원격 자동 실행을 기본으로 두지 않습니다.",
  },
];

export function readActiveMessengerChannelIds() {
  if (typeof window === "undefined") return ["app-main-control"];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(activeStorageKey) ?? "[]");
    return normalizeActiveMessengerChannelIds(parsed);
  } catch {
    return ["app-main-control"];
  }
}

export function saveActiveMessengerChannelIds(channelIds: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(activeStorageKey, JSON.stringify(normalizeActiveMessengerChannelIds(channelIds)));
}

export function normalizeMessengerChannels(value: unknown): MessengerChannel[] {
  if (!Array.isArray(value)) return defaultMessengerChannels;
  const byId = new Map(defaultMessengerChannels.map((channel) => [channel.id, channel]));
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const channel = item as Partial<MessengerChannel>;
    const id = sanitizeId(channel.id);
    if (!id) continue;
    byId.set(id, {
      id,
      kind: sanitizeKind(channel.kind),
      label: sanitizeText(channel.label, id, 60),
      connectorId: channel.connectorId ? sanitizeId(channel.connectorId) : undefined,
      status: sanitizeStatus(channel.status),
      setupMode: sanitizeSetupMode(channel.setupMode),
      summary: sanitizeText(channel.summary, "사용자 메신저 채널입니다.", 180),
      setupHint: sanitizeText(channel.setupHint, "연결 설정에서 필요한 값을 확인합니다.", 220),
      officialSetupSteps: sanitizeTextList(channel.officialSetupSteps, 8, 140),
      fallbackRoutes: sanitizeTextList(channel.fallbackRoutes, 6, 160),
      credentialFields: sanitizeCredentialFields(channel.credentialFields),
      liveCheckLabel: sanitizeText(channel.liveCheckLabel, "연결 테스트", 100),
      routingTarget: sanitizeText(channel.routingTarget, "메신저 -> 앱 승인함", 140),
      officeSignal: sanitizeText(channel.officeSignal, "오피스에서 작업 상태와 승인 대기를 표시합니다.", 160),
      secretStorageHint: sanitizeText(channel.secretStorageHint, "보안 입력값은 채팅이 아니라 보관함에 저장합니다.", 180),
      commandExamples: Array.isArray(channel.commandExamples)
        ? channel.commandExamples.map((line) => sanitizeText(line, "", 80)).filter(Boolean).slice(0, 8)
        : [],
      safetyBoundary: sanitizeText(channel.safetyBoundary, "외부 실행은 앱에서 최종 확인합니다.", 220),
    });
  }
  return [...byId.values()];
}

export function normalizeActiveMessengerChannelIds(value: unknown): string[] {
  const validIds = new Set(defaultMessengerChannels.map((channel) => channel.id));
  const source = Array.isArray(value) ? value : [];
  const active = source.map((id) => sanitizeId(id)).filter((id) => validIds.has(id)).slice(0, 12);
  return active.includes("app-main-control") ? active : ["app-main-control", ...active];
}

export function buildMessengerPromptContext(channels: MessengerChannel[], activeChannelIds: string[]) {
  const active = channels.filter((channel) => activeChannelIds.includes(channel.id));
  if (!active.length) return "";
  // 채널당 한 줄(이름: 요약 + 안전 경계)만 주입합니다. 연결 방식/필요 값/공식 설정
  // 단계 같은 설정 세부는 설정 안내 UI가 담당하며, 채팅 프롬프트에 모두 넣으면
  // 모델이 설정 절차를 통째로 나열하는 원인이 됩니다.
  return [
    "[활성 메신저/채널]",
    ...active.map(
      (channel) => `- ${channel.label}: ${channel.summary} (안전 경계: ${channel.safetyBoundary})`,
    ),
  ].join("\n");
}

export function buildMessengerConversationPlaybook(
  channels: MessengerChannel[],
  channelIds: string[] = ["app-main-control", "telegram-bot", "slack-app", "discord-app", "kakaotalk-local-app", "imessage-local"],
): MessengerConversationPlaybookCard[] {
  const channelIdSet = new Set(channelIds);
  return channels
    .filter((channel) => channelIdSet.has(channel.id))
    .map((channel) => {
      const credentialLabels = channel.credentialFields.map((field) => `${field.label}${field.secret ? " 보안" : ""}`);
      const firstOfficialStep = channel.officialSetupSteps[0] ?? channel.setupHint;
      const secondOfficialStep = channel.officialSetupSteps[1] ?? channel.liveCheckLabel;
      const fallback = channel.fallbackRoutes[0] ?? "앱 메인 컨트롤과 오피스 승인함으로 이어가기";
      return {
        channelId: channel.id,
        label: channel.label,
        modeLabel: labelMessengerSetupMode(channel.setupMode),
        stateLabel: channel.status === "built_in" ? "기본 사용" : channel.status === "limited" ? "정책 확인" : "연결 가능",
        guideLine:
          channel.status === "built_in"
            ? "외부 메신저를 붙이지 않아도 이 채널에서 승인 대화가 바로 시작됩니다."
            : `${channel.label} 연결은 대화 안에서 필요한 값, 저장 위치, 실패 시 다음 방법을 순서대로 안내합니다.`,
        steps: [
          {
            label: "어디서 시작",
            detail: firstOfficialStep,
          },
          {
            label: "무엇을 저장",
            detail: credentialLabels.length ? credentialLabels.join(" · ") : "추가 보안 입력값 없이 앱 내부 채널로 사용",
          },
          {
            label: "실제 점검",
            detail: channel.liveCheckLabel || secondOfficialStep,
          },
          {
            label: "오피스 라우팅",
            detail: channel.routingTarget,
          },
        ],
        safeFallback: fallback,
        secretRule: channel.secretStorageHint,
        finalRoute: channel.safetyBoundary,
      };
    });
}

export function connectorIdForMessengerChannel(channel: MessengerChannel) {
  return channel.connectorId || channel.id;
}

export function isMessengerConnectorReadyStatus(status?: string) {
  return [
    "telegram_command_inbox_ready",
    "slack_command_inbox_ready",
    "discord_command_inbox_ready",
    "connector_ready",
    "connected",
  ].includes(String(status ?? ""));
}

export function findMessengerConnectorStatus<TStatus extends MessengerConnectorStatusLike>(
  channel: MessengerChannel,
  statuses: TStatus[],
) {
  const connectorId = connectorIdForMessengerChannel(channel);
  return statuses.find((status) => status.connectorId === connectorId);
}

export function describeMessengerConnectionStatus(
  channel: MessengerChannel,
  statusRecord?: MessengerConnectorStatusLike,
): MessengerConnectionSummary {
  const connectorId = connectorIdForMessengerChannel(channel);
  if (channel.status === "built_in") {
    return {
      id: channel.id,
      connectorId,
      label: channel.label,
      state: "built_in",
      statusLabel: "앱 기본",
      detail: "앱 내부 메인 컨트롤 채널로 바로 사용합니다.",
      targetLabel: channel.routingTarget,
    };
  }

  if (!statusRecord) {
    return {
      id: channel.id,
      connectorId,
      label: channel.label,
      state: channel.status === "limited" ? "limited" : "needs_setup",
      statusLabel: channel.status === "limited" ? "정책 확인" : "연결 필요",
      detail: channel.setupHint,
      targetLabel: channel.routingTarget,
    };
  }

  const status = String(statusRecord.status ?? "");
  const failed = /failed|invalid|required|not_connected|blocked|denied|expired/u.test(status);
  const ready = isMessengerConnectorReadyStatus(status);
  const targetLabel = statusRecord.channelTargetId
    ? `대상 ${statusRecord.channelTargetId}`
    : statusRecord.permissions?.messengerReport
      ? "보고/승인 대상 저장됨"
      : channel.routingTarget;

  if (ready) {
    return {
      id: channel.id,
      connectorId,
      label: channel.label,
      state: "connected",
      statusLabel: "연결됨",
      detail: statusRecord.userMessage || `${channel.liveCheckLabel} 완료. 오피스 결정 인박스로 라우팅합니다.`,
      targetLabel,
      checkedAt: statusRecord.lastCheckedAt,
    };
  }

  return {
    id: channel.id,
    connectorId,
    label: channel.label,
    state: failed ? "error" : channel.status === "limited" ? "limited" : "needs_setup",
    statusLabel: failed ? "확인 필요" : channel.status === "limited" ? "정책 확인" : "연결 필요",
    detail: statusRecord.recovery?.detail || statusRecord.userMessage || channel.setupHint,
    targetLabel,
    checkedAt: statusRecord.lastCheckedAt,
  };
}

export function summarizeMessengerConnections<TStatus extends MessengerConnectorStatusLike>(
  channels: MessengerChannel[],
  statuses: TStatus[],
  activeChannelIds: string[] = [],
) {
  const activeSet = new Set(activeChannelIds);
  return channels
    .map((channel) => describeMessengerConnectionStatus(channel, findMessengerConnectorStatus(channel, statuses)))
    .filter(
      (summary) =>
        summary.state === "connected" ||
        summary.state === "built_in" ||
        activeSet.has(summary.id),
    );
}

export function recommendMessengerChannels(text: string) {
  const lower = text.toLowerCase();
  const mentionsMessengerSurface =
    /(메신저|메세지|메시지|messenger|telegram|텔레그램|slack|슬랙|discord|디스코드|카카오톡|카톡|kakaotalk|imessage|아이메시지|messages|승인\s*채널|알림\s*채널|보고\s*채널|채널\s*연동|앱\s*연동)/u.test(
      lower,
    );
  if (mentionsMessengerSurface && /전체|모든|여러|다양/u.test(lower)) {
    return ["telegram-bot", "slack-app", "discord-app", "kakaotalk-local-app", "imessage-local"];
  }
  if (/telegram|텔레그램|botfather|승인|알림/u.test(lower)) return ["telegram-bot"];
  if (/slack|슬랙|워크스페이스|회사\s*채널/u.test(lower)) return ["slack-app"];
  if (/discord|디스코드|서버/u.test(lower)) return ["discord-app"];
  if (/카카오톡|카톡|kakaotalk|톡/u.test(lower)) return ["kakaotalk-local-app", "kakao-channel"];
  if (/kakao|카카오|채널/u.test(lower)) return ["kakao-channel", "kakaotalk-local-app"];
  if (/imessage|아이메시지|아이메세지|messages/u.test(lower)) return ["imessage-local"];
  if (/메신저|메세지|메시지|보고\s*채널|승인\s*알림|채널\s*연동|앱\s*연동/u.test(lower)) return ["telegram-bot", "slack-app", "discord-app", "kakaotalk-local-app", "imessage-local"];
  return [];
}

export function labelMessengerSetupMode(mode: MessengerConnectionMode) {
  if (mode === "built_in") return "앱 기본 채널";
  if (mode === "bot_token") return "메신저 승인값";
  if (mode === "oauth") return "계정 동의";
  if (mode === "webhook") return "보고 전용 연결";
  if (mode === "local_bridge") return "이 PC에서 확인";
  return "정책/권한 확인";
}

export function formatMessengerChannelSetup(channel: MessengerChannel) {
  const credentials = channel.credentialFields
    .map((field) => `${field.label}${field.secret ? "(보안)" : ""}: ${field.purpose}`)
    .join(" / ");
  return [
    `${channel.label}는 ${labelMessengerSetupMode(channel.setupMode)} 방식입니다.`,
    `필요한 값: ${credentials || "없음"}`,
    `테스트: ${channel.liveCheckLabel}`,
    `연결 후: ${channel.routingTarget}`,
    channel.officeSignal,
  ].join("\n");
}

function sanitizeId(value: unknown) {
  return String(value ?? "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 80);
}

function sanitizeText(value: unknown, fallback: string, maxLength: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  return text || fallback;
}

function sanitizeTextList(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value.map((line) => sanitizeText(line, "", maxLength)).filter(Boolean).slice(0, maxItems);
}

function sanitizeCredentialFields(value: unknown): MessengerCredentialField[] {
  if (!Array.isArray(value)) return [];
  const fields: MessengerCredentialField[] = [];
  for (const field of value) {
    if (!field || typeof field !== "object") continue;
    const item = field as Partial<MessengerCredentialField>;
    const label = sanitizeText(item.label, "", 60);
    if (!label) continue;
    fields.push({
      label,
      purpose: sanitizeText(item.purpose, "연결에 필요한 값", 120),
      secret: Boolean(item.secret),
    });
    if (fields.length >= 8) break;
  }
  return fields;
}

function sanitizeKind(value: unknown): MessengerChannelKind {
  if (value === "telegram" || value === "slack" || value === "discord" || value === "imessage" || value === "kakao" || value === "app") {
    return value;
  }
  return "app";
}

function sanitizeStatus(value: unknown): MessengerChannel["status"] {
  if (value === "built_in" || value === "recommended" || value === "connectable" || value === "limited") return value;
  return "recommended";
}

function sanitizeSetupMode(value: unknown): MessengerConnectionMode {
  if (
    value === "built_in" ||
    value === "bot_token" ||
    value === "oauth" ||
    value === "webhook" ||
    value === "local_bridge" ||
    value === "policy_review"
  ) {
    return value;
  }
  return "policy_review";
}
