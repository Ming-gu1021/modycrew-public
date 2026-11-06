export type ModyMessengerCommandStatus =
  | "live_polling_ready"
  | "webhook_endpoint_required"
  | "workspace_app_required"
  | "policy_review_required"
  | "business_review_required"
  | "local_bridge_research";

export type ModyMessengerCommandReadinessItem = {
  id: string;
  name: string;
  priority: "p0" | "p1" | "research";
  status: ModyMessengerCommandStatus;
  userCanSendCommandNow: boolean;
  inboundCommandMode: "polling" | "webhook" | "workspace_command" | "business_api" | "local_bridge";
  testCommand?: string;
  setupRequired: string[];
  evidence: string[];
  safetyBoundary: string;
  canExecuteExternalActionFromCommand: false;
};

export type ModyMessengerCommandReadinessSummary = {
  total: number;
  liveReadyCount: number;
  setupRequiredCount: number;
  policyOrBusinessReviewCount: number;
  userCommandReadyProviderIds: string[];
  blockedExecutionBoundary: "external_actions_require_app_final_confirmation";
};

export class ModyMessengerCommandReadinessMatrix {
  list(): ModyMessengerCommandReadinessItem[] {
    return messengerCommandReadinessItems.map((item) => ({ ...item, setupRequired: [...item.setupRequired], evidence: [...item.evidence] }));
  }

  summarize(): ModyMessengerCommandReadinessSummary {
    const items = this.list();
    return {
      total: items.length,
      liveReadyCount: items.filter((item) => item.userCanSendCommandNow).length,
      setupRequiredCount: items.filter((item) => (
        item.status === "webhook_endpoint_required" ||
        item.status === "workspace_app_required"
      )).length,
      policyOrBusinessReviewCount: items.filter((item) => (
        item.status === "policy_review_required" ||
        item.status === "business_review_required" ||
        item.status === "local_bridge_research"
      )).length,
      userCommandReadyProviderIds: items.filter((item) => item.userCanSendCommandNow).map((item) => item.id),
      blockedExecutionBoundary: "external_actions_require_app_final_confirmation",
    };
  }
}

export const messengerCommandReadinessItems: ModyMessengerCommandReadinessItem[] = [
  {
    id: "telegram-bot",
    name: "Telegram Bot",
    priority: "p0",
    status: "live_polling_ready",
    userCanSendCommandNow: true,
    inboundCommandMode: "polling",
    testCommand: "npm run run:telegram-command-inbox -- --verify",
    setupRequired: [
      "BotFather에서 bot token 발급",
      "사용자가 bot에게 먼저 메시지 전송",
      "MODYCREW_TELEGRAM_BOT_TOKEN 또는 앱 OS 보안 저장소에 token 등록",
    ],
    evidence: [
      "ModyTelegramBotLiveConnector.pollCommandUpdates",
      "Telegram Bot API getUpdates",
      "ModyWorkCommandLoop.process",
    ],
    safetyBoundary: "Telegram 명령은 업무 후보와 승인 의사만 기록하며 실제 메일 발송/캘린더 등록은 앱 최종 확인이 필요합니다.",
    canExecuteExternalActionFromCommand: false,
  },
  {
    id: "slack-app",
    name: "Slack App",
    priority: "p0",
    status: "workspace_app_required",
    userCanSendCommandNow: false,
    inboundCommandMode: "workspace_command",
    setupRequired: [
      "Slack app 생성",
      "Slash command Request URL 또는 Socket Mode 설정",
      "signing secret 검증 endpoint",
      "workspace OAuth install",
    ],
    evidence: [
      "Slack slash commands require app request URL",
      "Slack request signature verification required",
      "ModyChannelHub can parse slash command text after adapter ingestion",
    ],
    safetyBoundary: "Slack 명령도 외부 실행을 바로 하지 않고 앱 승인함으로 넘깁니다.",
    canExecuteExternalActionFromCommand: false,
  },
  {
    id: "naver-works-bot",
    name: "NAVER WORKS Bot",
    priority: "p0",
    status: "webhook_endpoint_required",
    userCanSendCommandNow: false,
    inboundCommandMode: "webhook",
    setupRequired: [
      "NAVER WORKS developer app/bot 등록",
      "tenant admin 승인",
      "bot callback URL 연결",
      "customer plan/API 권한 확인",
    ],
    evidence: [
      "NAVER WORKS Bot callback path required",
      "ModyChannelHub can accept normalized workspace messenger messages",
    ],
    safetyBoundary: "NAVER WORKS 명령은 보고와 승인 의사 수신까지만 처리하고 실행은 앱에서 확인합니다.",
    canExecuteExternalActionFromCommand: false,
  },
  {
    id: "discord-app",
    name: "Discord App",
    priority: "p1",
    status: "webhook_endpoint_required",
    userCanSendCommandNow: false,
    inboundCommandMode: "webhook",
    setupRequired: [
      "Discord Developer Portal app 생성",
      "interactions endpoint URL 등록",
      "request signature 검증",
      "server OAuth2 install",
    ],
    evidence: [
      "Discord interactions endpoint receives application command payloads",
      "ModyChannelHub can parse normalized Discord command text",
    ],
    safetyBoundary: "Discord 명령은 커뮤니티/내부 테스트에 적합하지만 업무 실행은 앱 승인 후 진행합니다.",
    canExecuteExternalActionFromCommand: false,
  },
  {
    id: "line-messaging-api",
    name: "LINE Messaging API",
    priority: "p1",
    status: "webhook_endpoint_required",
    userCanSendCommandNow: false,
    inboundCommandMode: "webhook",
    setupRequired: [
      "LINE Official Account 생성",
      "Messaging API channel과 channel access token",
      "Webhook URL 등록",
      "사용자 친구 추가 또는 동의 흐름",
    ],
    evidence: [
      "LINE sends message events to registered webhook URL",
      "ModyChannelHub can ingest normalized business channel messages",
    ],
    safetyBoundary: "LINE 답장/푸시는 공식 계정 정책과 앱 승인 경계를 따라야 합니다.",
    canExecuteExternalActionFromCommand: false,
  },
  {
    id: "kakao-talk-channel",
    name: "KakaoTalk Channel",
    priority: "research",
    status: "policy_review_required",
    userCanSendCommandNow: false,
    inboundCommandMode: "business_api",
    setupRequired: [
      "Kakao Developers app",
      "KakaoTalk Channel 정책 검토",
      "상담톡/비즈메시지 partner path 확인",
      "사용자 동의와 채널 기반 접근으로 제한",
    ],
    evidence: [
      "Do not treat Kakao as universal personal DM automation",
      "Research-only until official policy path is locked",
    ],
    safetyBoundary: "Kakao는 자유 개인 DM 자동화처럼 구현하지 않고 정책 확인 뒤 제한적으로 연결합니다.",
    canExecuteExternalActionFromCommand: false,
  },
  {
    id: "kakao-talk-message-api",
    name: "KakaoTalk Message API",
    priority: "research",
    status: "policy_review_required",
    userCanSendCommandNow: false,
    inboundCommandMode: "business_api",
    setupRequired: [
      "Kakao Login consent",
      "Biz app review",
      "추가 권한 신청",
      "사용자 주도 메시지 범위 확인",
    ],
    evidence: [
      "Limited user-consent API path",
      "Not a general inbound command bot for arbitrary KakaoTalk chats",
    ],
    safetyBoundary: "Kakao Message API는 사용자가 동의한 범위 안에서만 검토합니다.",
    canExecuteExternalActionFromCommand: false,
  },
  {
    id: "microsoft-teams-bot",
    name: "Microsoft Teams Bot",
    priority: "p1",
    status: "workspace_app_required",
    userCanSendCommandNow: false,
    inboundCommandMode: "workspace_command",
    setupRequired: [
      "Azure Bot/App registration",
      "Teams app manifest",
      "tenant admin 또는 사용자 설치",
      "Bot Framework message endpoint",
    ],
    evidence: [
      "Teams command events require Microsoft app setup",
      "ModyChannelHub can normalize workspace messages after adapter",
    ],
    safetyBoundary: "Teams 명령은 tenant 설치 뒤 보고/승인 보조 채널로 사용합니다.",
    canExecuteExternalActionFromCommand: false,
  },
  {
    id: "google-chat-app",
    name: "Google Chat App",
    priority: "p1",
    status: "workspace_app_required",
    userCanSendCommandNow: false,
    inboundCommandMode: "workspace_command",
    setupRequired: [
      "Google Cloud project",
      "Chat API app configuration",
      "Workspace install",
      "slash command 또는 app event handler",
    ],
    evidence: [
      "Google Chat app commands require Workspace app configuration",
      "ModyChannelHub can normalize chat app command text",
    ],
    safetyBoundary: "Google Chat 명령은 Google Workspace 설치 후 앱 승인 경계를 따릅니다.",
    canExecuteExternalActionFromCommand: false,
  },
  {
    id: "whatsapp-business-platform",
    name: "WhatsApp Business Platform",
    priority: "research",
    status: "business_review_required",
    userCanSendCommandNow: false,
    inboundCommandMode: "business_api",
    setupRequired: [
      "Meta Business verification",
      "WhatsApp Business Account",
      "phone number registration",
      "webhook and template/opt-in policy review",
    ],
    evidence: [
      "Meta business messaging path required",
      "Korean MVP priority is lower than Telegram/Slack/NAVER WORKS",
    ],
    safetyBoundary: "WhatsApp은 business messaging 정책과 opt-in 범위를 확인한 뒤 사용합니다.",
    canExecuteExternalActionFromCommand: false,
  },
  {
    id: "instagram-messaging-api",
    name: "Instagram Messaging API",
    priority: "research",
    status: "business_review_required",
    userCanSendCommandNow: false,
    inboundCommandMode: "business_api",
    setupRequired: [
      "Instagram professional account",
      "Facebook Page 연결",
      "Meta app review",
      "webhook subscription",
    ],
    evidence: [
      "Meta review and professional account required",
      "Use for customer DM intake, not core internal command channel first",
    ],
    safetyBoundary: "Instagram DM은 고객 문의 수집 후보이며 업무 실행은 앱 승인 후입니다.",
    canExecuteExternalActionFromCommand: false,
  },
  {
    id: "facebook-messenger-platform",
    name: "Facebook Messenger Platform",
    priority: "research",
    status: "business_review_required",
    userCanSendCommandNow: false,
    inboundCommandMode: "business_api",
    setupRequired: [
      "Facebook Page",
      "Page access token",
      "webhook subscription",
      "Meta app review",
    ],
    evidence: [
      "Facebook Page based Messenger Platform required",
      "Good for customer channel, not first internal command path",
    ],
    safetyBoundary: "Facebook Messenger는 Page 정책과 앱 승인 경계를 따릅니다.",
    canExecuteExternalActionFromCommand: false,
  },
  {
    id: "apple-messages-for-business",
    name: "Apple Messages for Business",
    priority: "research",
    status: "business_review_required",
    userCanSendCommandNow: false,
    inboundCommandMode: "business_api",
    setupRequired: [
      "Apple Messages for Business account",
      "MSP/CSP path",
      "business verification",
      "message routing integration",
    ],
    evidence: [
      "Apple business messaging path, not personal iMessage bot token",
      "Requires approved business account route",
    ],
    safetyBoundary: "Apple Messages는 승인된 business messaging 경로에서만 검토합니다.",
    canExecuteExternalActionFromCommand: false,
  },
  {
    id: "imessage-local-macos-bridge",
    name: "iMessage macOS Local Bridge",
    priority: "research",
    status: "local_bridge_research",
    userCanSendCommandNow: false,
    inboundCommandMode: "local_bridge",
    setupRequired: [
      "사용자 Mac",
      "Messages 앱 접근 권한",
      "macOS Automation permission",
      "현장 사용자 확인",
    ],
    evidence: [
      "No general cloud iMessage bot token path",
      "Local bridge requires OS permission and user presence",
    ],
    safetyBoundary: "iMessage 로컬 브리지는 사용자 컴퓨터 현장 확인과 앱 최종 승인을 요구합니다.",
    canExecuteExternalActionFromCommand: false,
  },
];
