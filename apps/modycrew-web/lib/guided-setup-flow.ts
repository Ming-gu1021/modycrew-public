"use client";

/**
 * 대화형 안내 흐름(메일 연동 · 직원 만들기) 상태 머신.
 *
 * 원칙: 한 번에 질문 하나, 주소는 안내 카드에서, 비밀 값은 채팅이 아니라 설정 창으로.
 * page.tsx 는 상태 보관·메시지 커밋·패널 열기만 하고, 단계 판단과 문구는 여기서 만든다.
 */

export type GuidedMailStep = "provider" | "address" | "connect";
export type GuidedSetupTopic = "mail" | "ai" | "messenger" | "document" | "teammate";
export type GuidedTeammateStep = "role" | "style" | "name" | "confirm";

export type GuidedFlowState =
  | {
      /** 무엇부터 설정할지 고르는 허브. 고른 뒤에는 각 흐름으로 넘긴다. */
      kind: "setup_hub";
      step: "choose";
    }
  | {
      kind: "mail_connect";
      step: GuidedMailStep;
      connectorId?: string;
      address?: string;
    }
  | {
      kind: "teammate_create";
      step: GuidedTeammateStep;
      role?: string;
      templateId?: string;
      styleLabel?: string;
      styleInstructions?: string[];
      name?: string;
    };

export type GuidedFlowMessage = {
  text: string;
  /** 버튼을 누르면 이 문구가 사용자의 채팅 입력으로 제출된다. */
  quickReplies?: string[];
  workflow?: {
    label: string;
    detail: string;
    items?: string[];
    status: "ready" | "safe" | "blocked";
    mailAddressEntry?: {
      contract: "guided_mail_address_entry_v1";
      emailLabel: string;
      emailPlaceholder: string;
      emailHint: string;
      webmailLabel: string;
      webmailPlaceholder: string;
      webmailHint: string;
      submitLabel: string;
    };
  };
};

export type GuidedTeammateCreationPlan = {
  templateId: string;
  name: string;
  roleTitle: string;
  teamLabel: string;
  brief: string;
  instructions: string[];
};

export type GuidedFlowStepResult = {
  /** null 이면 흐름 종료(완료 또는 취소). */
  state: GuidedFlowState | null;
  message: GuidedFlowMessage;
  /** 설정 화면에서 이 커넥터의 연결 창을 열어야 한다. */
  openMailConnectorId?: string;
  /** 연결 창의 메일 주소 칸에 미리 채울 값. */
  prefillAddress?: string;
  /** 회사 메일의 웹 로그인 주소를 별도 선택값으로 미리 채울 값. */
  prefillWebmailUrl?: string;
  /** 확인이 끝나 직원을 생성해야 한다. */
  createTeammate?: GuidedTeammateCreationPlan;
  /** 비밀값 입력처럼 채팅으로 끝낼 수 없는 단계는 해당 설정 화면을 연다.
      (원칙: 비밀 값은 채팅이 아니라 설정 창으로) */
  openPanel?: { panel: "connect" | "learn" | "messengers" | "control"; singleSetting?: string };
  /** 직원 현황 등에 표시할 짧은 진행 설명. */
  eventDetail: string;
};

type MailProviderChoice = {
  id: string;
  label: string;
  method: "oauth" | "imap";
};

export const guidedMailProviderChoices: MailProviderChoice[] = [
  { id: "gmail", label: "Gmail", method: "oauth" },
  { id: "naver-mail", label: "네이버 메일", method: "imap" },
  { id: "daum-kakao-mail", label: "Daum·카카오 메일", method: "imap" },
  { id: "outlook", label: "Outlook", method: "oauth" },
  { id: "company-mail", label: "회사·기타 메일", method: "imap" },
];

const CANCEL_PATTERN = /(그만|취소|안\s*할래|나중에|중단|멈춰|스톱|stop|됐어요?$|괜찮아요?$)/iu;
const DONE_PATTERN = /(연결\s*했|눌렀|완료|성공|됐어|했어요|끝났)/iu;
const STUCK_PATTERN = /(안\s*돼|안돼|실패|에러|오류|막혔|모르겠|어려워|잘\s*안)/iu;
const APP_PASSWORD_QUESTION_PATTERN = /(앱\s*비밀번호|애플리케이션\s*비밀번호|2단계|이중\s*인증|비밀번호가?\s*뭐)/iu;

export function isGuidedFlowCancel(text: string) {
  return CANCEL_PATTERN.test(text.trim());
}

// 안내가 반복될 때 사용자가 "매크로 그만", "같은 말만 한다", "딴 얘기 하자"처럼
// 흐름 자체에서 벗어나려는 신호. isGuidedFlowCancel(정중한 종료)과 달리, 이 신호는
// 흐름을 즉시 해제하고 이번 메시지를 일반 대화(실제 AI)로 넘기는 데 쓴다.
// 흐름의 정상 답변(제공자명·주소·"연결했어요"·"앱 비밀번호가 뭐예요") 및 "그만할래요"와
// 겹치지 않도록 봇 행동을 겨냥한 표현만 좁게 잡는다.
const ESCAPE_PATTERN =
  /(매크로|메크로|템플릿|봇\s*처럼|봇\s*같|앵무새|같은\s*(말|답|소리|얘기)\s*만|같은\s*(말|답)\s*(반복|뿐)|무한\s*(루프|반복)|계속\s*같은|자꾸\s*같은|딴\s*(얘기|소리)|다른\s*(얘기|질문)\s*(해|하자|할래|좀)|그만\s*(물어|좀\s*해))/iu;

export function isGuidedFlowEscape(text: string) {
  return ESCAPE_PATTERN.test(text.trim());
}

export function inferGuidedMailProviderChoice(text: string): MailProviderChoice | null {
  const lower = text.toLowerCase();
  if (/gmail|지메일|구글\s*메일/u.test(lower)) return guidedMailProviderChoices[0];
  if (/naver|네이버/u.test(lower)) return guidedMailProviderChoices[1];
  if (/daum|다음\s*메일|kakao|카카오|한메일|hanmail/u.test(lower)) return guidedMailProviderChoices[2];
  if (/outlook|아웃룩|hotmail|핫메일|office\s*365|마이크로소프트/u.test(lower)) return guidedMailProviderChoices[3];
  if (/회사|기타|직접|사내|그\s*외|다른\s*메일|imap/u.test(lower)) return guidedMailProviderChoices[4];
  return null;
}

export function extractEmailAddress(text: string): string | null {
  const match = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u);
  return match ? match[0] : null;
}

export function normalizeGuidedMailAddress(value: string): string | null {
  const trimmed = value.trim();
  const address = extractEmailAddress(trimmed);
  return address && address.length === trimmed.length ? address : null;
}

export function normalizeGuidedWebmailUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !parsed.hostname.includes(".")) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function guidedMailConnectorIdForAddress(address: string): string {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  if (domain === "naver.com") return "naver-mail";
  if (domain === "daum.net" || domain === "hanmail.net" || domain === "kakao.com") return "daum-kakao-mail";
  if (domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com") return "outlook";
  return "company-mail";
}

function providerById(connectorId: string | undefined): MailProviderChoice | null {
  return guidedMailProviderChoices.find((choice) => choice.id === connectorId) ?? null;
}

function providerQuestionMessage(): GuidedFlowMessage {
  return {
    text: "좋아요, 메일 연결을 시작할게요.\n어떤 메일을 쓰시나요? 아래에서 골라 주세요.",
    quickReplies: guidedMailProviderChoices.map((choice) => choice.label),
    workflow: {
      label: "메일 연결 1/3 · 메일 고르기",
      detail: "고른 메일 하나만 순서대로 진행합니다.",
      items: ["1. 메일 고르기", "2. 주소 알려주기", "3. 연결 창에서 확인"],
      status: "ready",
    },
  };
}

function oauthConnectMessage(provider: MailProviderChoice): GuidedFlowMessage {
  return {
    text: [
      `${provider.label} 연결 창을 오른쪽에 열어뒀어요.`,
      "창의 [계정 동의 창 열기] 버튼을 누르면 동의 화면이 열려요. 동의 한 번이면 끝나고, 서버나 포트는 몰라도 됩니다.",
      "연결이 확인되면 제가 여기로 알려드릴게요.",
    ].join("\n"),
    quickReplies: ["연결했어요", "잘 안 돼요", "그만할래요"],
    workflow: {
      label: `메일 연결 · ${provider.label}`,
      detail: "동의 연결 한 번으로 끝나는 방식입니다.",
      items: ["연결 창에서 [연결하기] 누르기", "동의 화면에서 허용"],
      status: "ready",
    },
  };
}

function addressQuestionMessage(provider: MailProviderChoice): GuidedFlowMessage {
  return {
    text: [
      `${provider.label}로 진행할게요.`,
      "아래 카드의 '내 이메일 주소'에 실제로 메일을 받는 주소를 넣고 [주소 확인]을 누르세요.",
      "웹메일 사이트 주소는 선택 항목이에요. 이메일 칸에는 넣지 않습니다.",
    ].join("\n"),
    workflow: {
      label: "메일 연결 2/3 · 주소 확인",
      detail: "이메일 주소와 웹메일 접속 주소를 구분해 받고, 메일 서버는 자동으로 찾습니다.",
      status: "ready",
      mailAddressEntry: {
        contract: "guided_mail_address_entry_v1",
        emailLabel: "내 이메일 주소",
        emailPlaceholder: "name@company.ac.kr",
        emailHint: "메일을 실제로 받는 내 주소예요. 웹사이트 주소가 아닙니다.",
        webmailLabel: "웹메일 접속 주소 (선택)",
        webmailPlaceholder: "https://portal.company.ac.kr/...",
        webmailHint: "Chrome에서 메일을 볼 때 여는 포털 주소예요. 몰라도 비워두면 됩니다.",
        submitLabel: "주소 확인",
      },
    },
  };
}

function passwordPanelMessage(provider: MailProviderChoice, address: string): GuidedFlowMessage {
  return {
    text: [
      `${address} 확인했어요. 보안 연결 창에 주소를 미리 채워뒀습니다.`,
      "이제 딱 하나만 하면 돼요: 연결 창의 '메일 연결 비밀번호' 칸에 앱 비밀번호를 입력하고 [연결하기]를 누르세요.",
      "보안을 위해 비밀번호는 채팅에 쓰지 말고 연결 창에만 입력해 주세요.",
    ].join("\n"),
    quickReplies: ["앱 비밀번호가 뭐예요?", "연결했어요", "잘 안 돼요"],
    workflow: {
      label: "메일 연결 3/3 · 비밀번호 입력",
      detail: `${provider.label}에서 가능한 서버 기본값을 먼저 찾았습니다. 틀리면 고급 설정에서 바꿀 수 있습니다.`,
      items: ["연결 창 비밀번호 칸에 앱 비밀번호 입력", "[연결하기] 누르기", "완료되면 채팅에서 알림"],
      status: "ready",
    },
  };
}

function appPasswordGuideText(connectorId: string | undefined): string {
  if (connectorId === "naver-mail") {
    return [
      "앱 비밀번호는 메일 서비스가 외부 앱 연결용으로 따로 만들어 주는 비밀번호예요.",
      "네이버: 네이버 홈 → 내정보 → 보안설정 → 2단계 인증을 켠 뒤 '애플리케이션 비밀번호 관리'에서 새로 만들어요.",
      "그리고 네이버 메일 → 환경설정 → POP3/IMAP 설정에서 IMAP 사용을 켜 주세요.",
      "만든 비밀번호를 연결 창의 비밀번호 칸에 붙여넣고 [연결하기]를 누르면 됩니다.",
    ].join("\n");
  }
  if (connectorId === "daum-kakao-mail") {
    return [
      "앱 비밀번호는 메일 서비스가 외부 앱 연결용으로 따로 만들어 주는 비밀번호예요.",
      "카카오계정 → 계정 보안 → 2단계 인증을 켠 뒤 '앱 비밀번호'를 만들어요.",
      "Daum 메일이라면 메일 환경설정에서 IMAP 사용도 켜 주세요.",
      "만든 비밀번호를 연결 창의 비밀번호 칸에 붙여넣고 [연결하기]를 누르면 됩니다.",
    ].join("\n");
  }
  return [
    "앱 비밀번호는 메일 서비스가 외부 앱 연결용으로 따로 만들어 주는 비밀번호예요.",
    "회사 메일은 보통 메일 비밀번호를 그대로 쓰면 되고, 안 되면 관리자에게 IMAP 사용 여부와 앱 비밀번호를 물어보세요.",
    "값을 연결 창의 비밀번호 칸에 입력하고 [연결하기]를 누르면 됩니다.",
  ].join("\n");
}

function mailStuckMessage(state: Extract<GuidedFlowState, { kind: "mail_connect" }>): GuidedFlowMessage {
  return {
    text: [
      "괜찮아요, 하나씩 확인해 볼게요. 가장 흔한 원인은 이 세 가지예요.",
      "1. 일반 로그인 비밀번호를 넣은 경우 → 앱 비밀번호를 새로 만들어 넣어 보세요.",
      "2. 메일 설정에서 IMAP 사용이 꺼져 있는 경우 → 메일 환경설정에서 켜 주세요.",
      "3. 그래도 안 되면 연결 창 아래 '자세한 안내'에 단계별 화면 안내가 있어요.",
    ].join("\n"),
    quickReplies: ["앱 비밀번호가 뭐예요?", "다시 해볼게요", "그만할래요"],
    workflow: {
      label: "메일 연결 · 문제 해결",
      detail: state.address ? `${state.address} 연결을 다시 시도합니다.` : "연결을 다시 시도합니다.",
      items: ["앱 비밀번호 확인", "IMAP 사용 켜기", "연결 창에서 다시 [연결하기]"],
      status: "blocked",
    },
  };
}

function mailCancelledResult(): GuidedFlowStepResult {
  return {
    state: null,
    message: {
      text: "알겠어요, 메일 연결은 여기서 멈출게요. 다시 하고 싶으면 \"메일 연결해줘\"라고 말해 주세요.",
    },
    eventDetail: "메일 연결 안내를 사용자가 중단했습니다.",
  };
}

export function startGuidedMailFlow(inferredConnectorId?: string | null): GuidedFlowStepResult {
  const provider = providerById(inferredConnectorId ?? undefined);
  if (provider && provider.method === "oauth") {
    return {
      state: { kind: "mail_connect", step: "connect", connectorId: provider.id },
      message: oauthConnectMessage(provider),
      openMailConnectorId: provider.id,
      eventDetail: `${provider.label} 동의 연결 안내`,
    };
  }
  if (provider) {
    return {
      state: { kind: "mail_connect", step: "address", connectorId: provider.id },
      message: addressQuestionMessage(provider),
      eventDetail: `${provider.label} 주소 확인 대기`,
    };
  }
  return {
    state: { kind: "mail_connect", step: "provider" },
    message: providerQuestionMessage(),
    eventDetail: "메일 종류 선택 대기",
  };
}

export function advanceGuidedMailFlow(
  state: Extract<GuidedFlowState, { kind: "mail_connect" }>,
  answerText: string,
  context: { connectorReady: boolean },
): GuidedFlowStepResult {
  const text = answerText.trim();
  if (isGuidedFlowCancel(text)) return mailCancelledResult();

  if (state.step === "provider") {
    const provider = inferGuidedMailProviderChoice(text) ?? (extractEmailAddress(text) ? providerById(guidedMailConnectorIdForAddress(extractEmailAddress(text)!)) : null);
    if (!provider) {
      return {
        state,
        message: {
          text: "아래 버튼에서 쓰시는 메일을 골라 주세요. 목록에 없으면 '회사·기타 메일'을 누르면 됩니다.",
          quickReplies: guidedMailProviderChoices.map((choice) => choice.label),
        },
        eventDetail: "메일 종류 선택 대기",
      };
    }
    // 주소까지 한 번에 적었으면 주소 단계를 건너뛴다.
    const addressInAnswer = extractEmailAddress(text);
    if (provider.method === "oauth") {
      return {
        state: { kind: "mail_connect", step: "connect", connectorId: provider.id },
        message: oauthConnectMessage(provider),
        openMailConnectorId: provider.id,
        eventDetail: `${provider.label} 동의 연결 안내`,
      };
    }
    if (addressInAnswer) {
      return {
        state: { kind: "mail_connect", step: "connect", connectorId: provider.id, address: addressInAnswer },
        message: passwordPanelMessage(provider, addressInAnswer),
        openMailConnectorId: provider.id,
        prefillAddress: addressInAnswer,
        eventDetail: `${provider.label} 비밀번호 입력 대기`,
      };
    }
    return {
      state: { kind: "mail_connect", step: "address", connectorId: provider.id },
      message: addressQuestionMessage(provider),
      eventDetail: `${provider.label} 주소 확인 대기`,
    };
  }

  if (state.step === "address") {
    const address = extractEmailAddress(text);
    if (!address) {
      return {
        state,
        message: {
          text: "메일 주소 형식이 아니에요. hong@naver.com 처럼 @ 가 들어간 주소로 알려주세요.",
        },
        eventDetail: "메일 주소 확인 대기",
      };
    }
    const domainConnectorId = guidedMailConnectorIdForAddress(address);
    const domainProvider = providerById(domainConnectorId);
    if (domainProvider && domainProvider.method === "oauth") {
      return {
        state: { kind: "mail_connect", step: "connect", connectorId: domainProvider.id, address },
        message: {
          ...oauthConnectMessage(domainProvider),
          text: [
            `${address}는 ${domainProvider.label} 계정이네요. 이 방식이 더 쉬워요.`,
            oauthConnectMessage(domainProvider).text,
          ].join("\n"),
        },
        openMailConnectorId: domainProvider.id,
        eventDetail: `${domainProvider.label} 동의 연결 안내`,
      };
    }
    const connectorId = domainConnectorId === "company-mail" && state.connectorId ? state.connectorId : domainConnectorId;
    const provider = providerById(connectorId) ?? guidedMailProviderChoices[4];
    return {
      state: { kind: "mail_connect", step: "connect", connectorId: provider.id, address },
      message: passwordPanelMessage(provider, address),
      openMailConnectorId: provider.id,
      prefillAddress: address,
      eventDetail: `${provider.label} 비밀번호 입력 대기`,
    };
  }

  // state.step === "connect"
  if (APP_PASSWORD_QUESTION_PATTERN.test(text) && !DONE_PATTERN.test(text)) {
    return {
      state,
      message: {
        text: appPasswordGuideText(state.connectorId),
        quickReplies: ["연결했어요", "잘 안 돼요"],
      },
      eventDetail: "앱 비밀번호 안내",
    };
  }
  if (DONE_PATTERN.test(text)) {
    if (context.connectorReady) {
      return {
        state: null,
        message: {
          text: [
            "메일 연결이 확인됐어요. 이제 메일 읽기와 답장 초안 준비를 맡길 수 있어요.",
            "발송은 항상 승인함에서 마지막 확인을 거친 뒤에만 나갑니다.",
          ].join("\n"),
          workflow: {
            label: "메일 연결 완료",
            detail: "읽기 전용 점검부터 시작하는 걸 추천해요.",
            items: ["메일 점검으로 받은 메일 분류", "답장 초안은 승인함에서 확인"],
            status: "safe",
          },
        },
        eventDetail: "메일 연결 완료",
      };
    }
    return {
      state,
      message: {
        text: [
          "아직 연결이 확인되지 않았어요.",
          "연결 창에서 [연결하기] 버튼을 눌렀는지 확인해 주세요. 눌렀는데도 안 되면 '잘 안 돼요'를 눌러 주세요.",
        ].join("\n"),
        quickReplies: ["잘 안 돼요", "다시 해볼게요"],
      },
      eventDetail: "메일 연결 확인 대기",
    };
  }
  if (STUCK_PATTERN.test(text)) {
    return {
      state,
      message: mailStuckMessage(state),
      eventDetail: "메일 연결 문제 해결 안내",
    };
  }
  if (/다시/u.test(text)) {
    const provider = providerById(state.connectorId) ?? guidedMailProviderChoices[4];
    return {
      state,
      message: state.address
        ? passwordPanelMessage(provider, state.address)
        : oauthConnectMessage(provider),
      openMailConnectorId: provider.id,
      prefillAddress: state.address,
      eventDetail: "메일 연결 재시도 안내",
    };
  }
  return {
    state,
    message: {
      text: "지금은 메일 연결을 진행 중이에요. 연결 창에서 [연결하기]를 누른 뒤 '연결했어요'라고 알려주세요. 멈추고 싶으면 '그만할래요'라고 하면 됩니다.",
      quickReplies: ["연결했어요", "잘 안 돼요", "그만할래요"],
    },
    eventDetail: "메일 연결 확인 대기",
  };
}

export function guidedMailSuccessMessage(connectorLabel: string): GuidedFlowMessage {
  return {
    text: [
      `${connectorLabel} 연결이 확인됐어요. 설정은 여기까지예요.`,
      "최근 메일 50건을 읽기 전용으로 훑어 말투, 업무 우선순위, 광고 제외, 승인 습관을 정리하고 맞춤 메일 담당자에 반영하기 시작했어요.",
      "새 메일 알림은 사용자가 Windows 알림을 켠 경우에만 표시하고, 답장·일정·파일 작업은 항상 승인함의 마지막 확인 전까지 실행하지 않습니다.",
    ].join("\n"),
    workflow: {
      label: "메일 연결 완료 · 맞춤 학습 시작",
      detail: "비밀번호와 메일 원문을 저장하지 않고 안전한 업무 라벨만 담당자 기준으로 반영합니다.",
      items: ["최근 50건 읽기 전용 학습", "업무 우선·광고 제외 기준 반영", "답장·일정 후보는 승인함에서 확인"],
      status: "safe",
    },
  };
}

/* ------------------------------------------------------------------ */
/* 직원 만들기 흐름                                                     */
/* ------------------------------------------------------------------ */

const TEAMMATE_ROLE_CHOICES: Array<{ label: string; templateId: string; roleTitle: string }> = [
  { label: "메일 답장·정리", templateId: "mail", roleTitle: "메일 담당" },
  { label: "문서·자료 정리", templateId: "operations", roleTitle: "문서 정리 담당" },
  { label: "일정 관리", templateId: "mail", roleTitle: "일정 관리 담당" },
  { label: "경리·정산", templateId: "finance", roleTitle: "정산 담당" },
];

const TEAMMATE_STYLE_CHOICES: Array<{ label: string; instructions: string[] }> = [
  { label: "차분하고 정중하게", instructions: ["차분하고 정중한 말투로 대화합니다", "확신이 없으면 먼저 확인 질문을 합니다"] },
  { label: "상황에 맞춰 명확하게", instructions: ["질문의 복잡도와 사용자가 원하는 분량에 맞춰 답합니다", "간단한 확인은 짧게, 설명·비교·문제 해결은 필요한 근거와 단계까지 충분히 전달합니다"] },
  { label: "친근하고 편하게", instructions: ["친근하고 편안한 말투로 대화합니다", "어려운 용어 대신 쉬운 말을 씁니다"] },
  { label: "꼼꼼하게 확인 위주로", instructions: ["실행 전 확인 사항을 목록으로 정리합니다", "애매한 부분은 반드시 되물어 확인합니다"] },
];

const TEAMMATE_CREATION_INTENT_PATTERN =
  /(직원|팀원|에이전트|비서)\s*(을|를|도|이나|좀|하나|한\s*명)?\s*(새로\s*|더\s*)?(만들|추가|생성|채용|뽑)|(새|신입)\s*(직원|팀원)/u;

const TEAMMATE_EXPLICIT_FIELD_PATTERN =
  /(이름은|이름:|역할은|역할:|성향은|성격은|말투는|팀은|팀:|맡길\s*일은|업무는|["“][^"”]{2,24}["”])/u;

/** 세부 정보 없이 "직원 만들어줘"처럼 말했을 때만 대화형 흐름을 시작한다. */
export function shouldStartGuidedTeammateFlow(text: string): boolean {
  return TEAMMATE_CREATION_INTENT_PATTERN.test(text) && !TEAMMATE_EXPLICIT_FIELD_PATTERN.test(text);
}

export function inferGuidedTeammateTemplateId(roleText: string): { templateId: string; roleTitle: string } {
  const lower = roleText.toLowerCase();
  const preset = TEAMMATE_ROLE_CHOICES.find((choice) => choice.label === roleText.trim());
  if (preset) return { templateId: preset.templateId, roleTitle: preset.roleTitle };
  if (/메일|이메일|답장|gmail|outlook|mail/u.test(lower)) return { templateId: "mail", roleTitle: "메일 담당" };
  if (/일정|캘린더|미팅|예약/u.test(lower)) return { templateId: "mail", roleTitle: "일정 관리 담당" };
  if (/문서|자료|보고서|정리|요약/u.test(lower)) return { templateId: "operations", roleTitle: "문서 정리 담당" };
  if (/경리|정산|세금|비용|회계|매출/u.test(lower)) return { templateId: "finance", roleTitle: "정산 담당" };
  if (/계약|법무|약관/u.test(lower)) return { templateId: "legal", roleTitle: "계약 검토 담당" };
  if (/파일|폴더|바탕|pc|컴퓨터/u.test(lower)) return { templateId: "desktop", roleTitle: "내 PC 정리 담당" };
  return { templateId: "custom", roleTitle: roleText.replace(/\s+/g, " ").trim().slice(0, 24) || "맞춤 담당" };
}

function teammateRoleQuestionMessage(): GuidedFlowMessage {
  return {
    text: ["좋아요. 복잡한 설정표 대신 제가 하나씩 제안하면서 맞춰드릴게요.", "처음이라면 '메일 답장·정리'를 추천해요. 자주 반복되는 일을 먼저 맡기기 좋습니다.", "추천안을 누르거나, 맡기고 싶은 일을 한 문장으로 말씀해 주세요."].join("\n"),
    quickReplies: [...TEAMMATE_ROLE_CHOICES.map((choice) => choice.label), "그만할래요"],
    workflow: {
      label: "직원 만들기 1/3 · 맡길 일",
      detail: "추천안을 고르거나 평소 하던 일을 말하면 역할을 먼저 정리해 드려요.",
      items: ["1. 맡길 일", "2. 말투·스타일", "3. 이름 정하고 완료"],
      status: "ready",
    },
  };
}

function teammateStyleQuestionMessage(roleTitle: string): GuidedFlowMessage {
  const recommendedStyle = /메일|일정/u.test(roleTitle) ? "차분하고 정중하게" : /정산|계약/u.test(roleTitle) ? "꼼꼼하게 확인 위주로" : "상황에 맞춰 명확하게";
  return {
    text: [`${roleTitle}으로 정리했어요.`, `이 역할에는 '${recommendedStyle}'를 추천해요. 그대로 쓰거나 다른 스타일을 골라 주세요.`].join("\n"),
    quickReplies: [recommendedStyle, ...TEAMMATE_STYLE_CHOICES.filter((choice) => choice.label !== recommendedStyle).map((choice) => choice.label)],
    workflow: {
      label: "직원 만들기 2/3 · 말투·스타일",
      detail: "버튼으로 고르거나 원하는 스타일을 직접 적어도 돼요.",
      items: ["말투 선택", "직접 적어도 반영됩니다"],
      status: "ready",
    },
  };
}

function teammateNameQuestionMessage(templateId?: string): GuidedFlowMessage {
  const recommendedName = suggestTeammateNameForTemplate(templateId);
  return {
    text: `마지막으로 이름은 '${recommendedName}'를 추천해요. 그대로 쓰거나 원하는 이름을 적어 주세요.`,
    quickReplies: [`${recommendedName}로 할게`, "다른 이름 직접 입력"],
    workflow: {
      label: "직원 만들기 3/3 · 이름",
      detail: "추천 이름을 고르거나 원하는 이름을 직접 적으면 마지막 확인으로 넘어갑니다.",
      items: ["이름 입력 또는 자동 추천"],
      status: "ready",
    },
  };
}

const AUTO_NAME_BY_TEMPLATE: Record<string, string> = {
  mail: "메일리",
  operations: "정리요",
  finance: "셈이",
  legal: "검토리",
  desktop: "데스키",
  custom: "모디",
};

export function suggestTeammateNameForTemplate(templateId: string | undefined): string {
  return AUTO_NAME_BY_TEMPLATE[templateId ?? "custom"] ?? "모디";
}

function styleInstructionsForAnswer(text: string): { label: string; instructions: string[] } {
  const preset = TEAMMATE_STYLE_CHOICES.find((choice) => choice.label === text.trim());
  if (preset) return preset;
  const custom = text
    .split(/\n|[.;]/u)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => (line.length > 80 ? `${line.slice(0, 80)}` : line));
  return {
    label: text.replace(/\s+/g, " ").trim().slice(0, 40),
    instructions: custom.length ? custom : ["사용자가 정한 기준을 우선합니다"],
  };
}

function teammateConfirmMessage(state: Extract<GuidedFlowState, { kind: "teammate_create" }>): GuidedFlowMessage {
  return {
    text: "이렇게 만들면 될까요?",
    quickReplies: ["이대로 만들기", "역할 다시 정하기", "그만할래요"],
    workflow: {
      label: "직원 만들기 · 확인",
      detail: "만들기를 누르면 바로 대화를 시작하고 첫 업무를 맡길 수 있어요.",
      items: [
        `이름: ${state.name}`,
        `맡는 일: ${state.role}`,
        `말투·스타일: ${state.styleLabel}`,
      ],
      status: "ready",
    },
  };
}

function teammateCancelledResult(): GuidedFlowStepResult {
  return {
    state: null,
    message: {
      text: "알겠어요, 직원 만들기는 멈출게요. 언제든 \"직원 만들어줘\"라고 하면 다시 시작할 수 있어요.",
    },
    eventDetail: "직원 만들기 안내를 사용자가 중단했습니다.",
  };
}

export function startGuidedTeammateFlow(): GuidedFlowStepResult {
  return {
    state: { kind: "teammate_create", step: "role" },
    message: teammateRoleQuestionMessage(),
    eventDetail: "직원 만들기 · 맡길 일 대기",
  };
}

export function advanceGuidedTeammateFlow(
  state: Extract<GuidedFlowState, { kind: "teammate_create" }>,
  answerText: string,
): GuidedFlowStepResult {
  const text = answerText.trim();
  if (isGuidedFlowCancel(text)) return teammateCancelledResult();

  if (state.step === "role") {
    if (text.length < 2) {
      return {
        state,
        message: {
          text: "맡길 일을 버튼으로 고르거나 한 문장으로 적어 주세요. 예: \"거래처 문의 메일에 답장 초안 만들기\"",
          quickReplies: TEAMMATE_ROLE_CHOICES.map((choice) => choice.label),
        },
        eventDetail: "직원 만들기 · 맡길 일 대기",
      };
    }
    const { templateId, roleTitle } = inferGuidedTeammateTemplateId(text);
    return {
      state: { ...state, step: "style", role: text.replace(/\s+/g, " ").slice(0, 120), templateId },
      message: teammateStyleQuestionMessage(roleTitle),
      eventDetail: "직원 만들기 · 말투 선택 대기",
    };
  }

  if (state.step === "style") {
    const style = styleInstructionsForAnswer(text);
    return {
      state: { ...state, step: "name", styleLabel: style.label, styleInstructions: style.instructions },
      message: teammateNameQuestionMessage(state.templateId),
      eventDetail: "직원 만들기 · 이름 대기",
    };
  }

  if (state.step === "name") {
    if (/다른\s*이름|직접\s*입력|직접\s*적/u.test(text)) {
      return {
        state,
        message: {
          text: "좋아요. 부르고 싶은 이름을 채팅창에 적어 주세요.",
          quickReplies: [`${suggestTeammateNameForTemplate(state.templateId)}로 할게`],
        },
        eventDetail: "직원 만들기 · 이름 직접 입력 대기",
      };
    }
    const wantsAutoName = /알아서|아무거나|추천|자동/u.test(text);
    const recommendedName = suggestTeammateNameForTemplate(state.templateId);
    const name = wantsAutoName
      ? recommendedName
      : text.replace(/로\s*(할게|해줘|하자|할래).*$/u, "").replace(/\s+/g, " ").trim().slice(0, 24) || recommendedName;
    const nextState = { ...state, step: "confirm" as const, name };
    return {
      state: nextState,
      message: teammateConfirmMessage(nextState),
      eventDetail: "직원 만들기 · 확인 대기",
    };
  }

  // state.step === "confirm"
  if (/이대로|만들|응|좋아|네|예|ok|고고/iu.test(text) && !/다시|취소/u.test(text)) {
    const { templateId, roleTitle } = inferGuidedTeammateTemplateId(state.role ?? "");
    const plan: GuidedTeammateCreationPlan = {
      templateId: state.templateId ?? templateId,
      name: state.name ?? suggestTeammateNameForTemplate(state.templateId),
      roleTitle,
      teamLabel: roleTitle,
      brief: `${state.role ?? roleTitle} 업무를 맡는 AI 직원`,
      instructions: [
        `맡은 일: ${state.role ?? roleTitle}`,
        ...(state.styleInstructions ?? []),
      ].slice(0, 6),
    };
    return {
      state: null,
      message: {
        text: "",
      },
      createTeammate: plan,
      eventDetail: `${plan.name} 직원 생성`,
    };
  }
  if (/다시|바꾸|수정/u.test(text)) {
    return {
      state: { kind: "teammate_create", step: "role" },
      message: teammateRoleQuestionMessage(),
      eventDetail: "직원 만들기 · 맡길 일 다시 선택",
    };
  }
  return {
    state,
    message: teammateConfirmMessage(state),
    eventDetail: "직원 만들기 · 확인 대기",
  };
}

                                                                               
                                                  

                                           
                                              
                                  

                                             
                                                
                                                                                  

const SETUP_HUB_INTENT_PATTERN =
  /(설정|셋업|처음|시작.*(도와|해야|뭐)|뭐부터|무엇부터|어떻게.*시작|연결.*(하고 싶|할래|해줘)$)/u;

const SETUP_HUB_CHOICES: Array<{ label: string; topic: GuidedSetupTopic; match: RegExp }> = [
  { label: "메일 연결", topic: "mail", match: /메일|이메일|mail|gmail|아웃룩/iu },
  { label: "AI 연결", topic: "ai", match: /\bai\b|답변|모델|지능|코덱스|codex|지피티|gpt/iu },
  { label: "알림 메신저", topic: "messenger", match: /알림|메신저|텔레그램|슬랙|telegram|slack|카톡/iu },
  { label: "문서 학습", topic: "document", match: /문서|자료|폴더|파일|학습/iu },
  { label: "직원 만들기", topic: "teammate", match: /직원|팀원|담당자|사람/iu },
];

export function shouldStartGuidedSetupHubFlow(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 40) return false;
  return SETUP_HUB_INTENT_PATTERN.test(value);
}

export function inferGuidedSetupTopic(text: string): GuidedSetupTopic | null {
  const value = text.trim();
  const hit = SETUP_HUB_CHOICES.find((choice) => choice.label === value)
    ?? SETUP_HUB_CHOICES.find((choice) => choice.match.test(value));
  return hit ? hit.topic : null;
}

export function startGuidedSetupHubFlow(): GuidedFlowStepResult {
  return {
    state: { kind: "setup_hub", step: "choose" },
    message: {
      text: "무엇부터 할까요? 아래에서 하나 고르면 제가 순서대로 여쭤볼게요.",
      quickReplies: SETUP_HUB_CHOICES.map((choice) => choice.label),
      workflow: {
        label: "설정 안내",
        detail: "한 번에 하나씩만 물어봅니다",
        items: ["고른 항목만 진행합니다", "비밀번호 같은 값은 안전한 설정 창에서 받습니다"],
        status: "ready",
      },
    },
    eventDetail: "설정 항목 선택 대기",
  };
}

/**
 * 허브에서 고른 갈래를 실제 흐름으로 넘긴다.
 * 메일·직원은 기존 상태머신을 그대로 재사용하고, 나머지 셋은 여기서 끝낸다
 * (마지막에 해당 설정 창을 열어주는 형태).
 */
export function advanceGuidedSetupHubFlow(answerText: string): GuidedFlowStepResult {
  const text = answerText.trim();
  if (isGuidedFlowCancel(text)) {
    return {
      state: null,
      message: { text: "설정 안내를 멈췄습니다. 필요할 때 다시 불러 주세요." },
      eventDetail: "설정 안내 취소",
    };
  }

  const topic = inferGuidedSetupTopic(text);
  if (!topic) {
    return {
      state: { kind: "setup_hub", step: "choose" },
      message: {
        text: "아직 못 알아들었어요. 아래 중에서 골라 주세요.",
        quickReplies: SETUP_HUB_CHOICES.map((choice) => choice.label),
      },
      eventDetail: "설정 항목 재선택 대기",
    };
  }

  if (topic === "mail") return startGuidedMailFlow(null);
  if (topic === "teammate") return startGuidedTeammateFlow();

  if (topic === "ai") {
    return {
      state: null,
      message: {
        text: "AI 연결 화면을 열었습니다. 로그인 한 번이면 팀원이 실제로 생각하고 답합니다.",
        workflow: {
          label: "AI 연결",
          detail: "로그인만 하면 끝",
          items: ["계정으로 로그인", "연결되면 이 대화에서 바로 답변이 시작됩니다"],
          status: "ready",
        },
      },
      openPanel: { panel: "connect", singleSetting: "ai" },
      eventDetail: "AI 연결 화면 열기",
    };
  }

  if (topic === "messenger") {
    return {
      state: null,
      message: {
        text: "알림 메신저 연결 화면을 열었습니다. 승인 요청과 결과를 텔레그램·슬랙으로 받을 수 있어요.",
        workflow: {
          label: "알림 메신저",
          detail: "받을 곳 하나만 고르면 됩니다",
          items: ["텔레그램 또는 슬랙 선택", "승인 요청을 그곳으로 보냅니다"],
          status: "ready",
        },
      },
      openPanel: { panel: "messengers", singleSetting: "messenger-channel" },
      eventDetail: "알림 메신저 연결 화면 열기",
    };
  }

  return {
    state: null,
    message: {
      text: "문서 학습 화면을 열었습니다. 읽을 폴더나 파일만 고르면 됩니다 — 원본은 바꾸지 않습니다.",
      workflow: {
        label: "문서 학습",
        detail: "고른 자료만 읽습니다",
        items: ["폴더 또는 파일 선택", "원본은 그대로 두고 요약·근거만 만듭니다"],
        status: "safe",
      },
    },
    openPanel: { panel: "learn", singleSetting: "learn-source" },
    eventDetail: "문서 학습 화면 열기",
  };
}
