/**
 * 첫 화면·채팅에서 "누르면 어디로 가는가"를 정하는 작은 규칙들.
 *
 * page.tsx(7만 줄) 안에 두면 검증할 방법이 없어서, 사용자가 실제로 막혔던
 * 갈림길만 여기로 뽑아 테스트한다(tests/web/home-journey-rules.test.mjs).
 */

export type AIProviderStatusLike = {
  provider?: string;
  isActive?: boolean;
  hasLocalKey?: boolean;
  chatContentAllowed?: boolean;
};

/**
 * GPT(ChatGPT 로그인)가 아닌 AI 가 이미 답할 수 있는가.
 *
 * 이 값이 참이면 GPT 로그인 창을 새로 열 때도 지금까지 확인된 답변 기록을 지우지 않는다.
 * 지우면 크루 위임·첫 업무 버튼이 다시 잠기고, Claude·API 키·내 PC 모델을 쓰는 사용자가
 * 쓰지도 않는 ChatGPT 로그인으로 계속 떠밀린다.
 */
export function hasOtherAnswerCapableAIProvider(providers: readonly AIProviderStatusLike[] = []): boolean {
  return providers.some((provider) => {
    const id = provider.provider ?? "";
    if (!id || id === "codex_oauth") return false;
    if (id === "openai" || id === "gemini" || id === "anthropic") {
      return Boolean(provider.hasLocalKey) && provider.chatContentAllowed === true;
    }
    // 내 PC 모델·구독 계정은 키가 없다. 사용자가 답변 AI 로 고른 경우만 센다.
    return provider.isActive === true;
  });
}

export type SubscriptionRuntimeLike = {
  providerId: string;
  label: string;
  installed: boolean;
  loggedIn: boolean;
};

export type AIAlternativeChoice = {
  /** "subscription:<providerId>" | "api_key" | "local" */
  id: string;
  label: string;
  detail: string;
  /** 지금 바로 쓸 수 있어 가장 먼저 권하는 선택지인가 */
  recommended: boolean;
};

/**
 * 구독 계정(예: 이 PC 에 로그인된 Claude)을 '답변 AI 로 고르는' 길이 설치 앱에 있는가.
 *
 * 예전 설치 앱은 키가 없는 구독 제공자의 모델 저장을 거절해(연결이 필요하다고 돌려보냄) 이 값이
 * false 였다. 이제 데스크톱이 CLI 로그인 상태로 가용성을 판정하고 '계정 기본 모델'을 저장·사용한다
 * (ai-provider-handler providerModelAvailability 의 구독 분기). 그래서 true 다.
 * 되돌려야 할 일이 생기면 false 로 바꾸면 된다(테스트가 두 상태를 모두 본다).
 */
export const SUBSCRIPTION_ANSWER_ACTIVATION_READY = true;

/**
 * GPT 말고 다른 AI 로 연결하는 선택지.
 *
 * 구독을 답변 AI 로 고를 수 있으면(subscriptionAnswersReady) 이 PC 에 이미 로그인된 구독 계정을
 * 맨 앞에 권한다 — 키 발급 없이 바로 쓸 수 있는 길이 가장 쉬운 길이다.
 * 아직 고를 수 없으면 지금 실제로 되는 길(API 키·내 PC 모델)을 앞에 두고, 구독은 뒤에 두되
 * 준비 중이라고 솔직하게 적는다. 어떤 경우에도 되지 않는 것을 권하지 않는다.
 */
export function buildAIAlternativeChoices(
  subscriptions: readonly SubscriptionRuntimeLike[] = [],
  options: { subscriptionAnswersReady?: boolean } = {},
): AIAlternativeChoice[] {
  const subscriptionAnswersReady = options.subscriptionAnswersReady ?? SUBSCRIPTION_ANSWER_ACTIVATION_READY;
  const rank = (runtime: SubscriptionRuntimeLike) => (runtime.loggedIn ? 0 : runtime.installed ? 1 : 2);
  const subscriptionChoices = [...subscriptions]
    .filter((runtime) => runtime.providerId && runtime.label)
    .sort((left, right) => rank(left) - rank(right))
    .map((runtime): AIAlternativeChoice => ({
      id: `subscription:${runtime.providerId}`,
      label: `${runtime.label} 구독 계정`,
      detail: !runtime.installed
        ? `${runtime.label} 앱을 먼저 설치해야 해요`
        : subscriptionAnswersReady
          ? runtime.loggedIn
            ? "이 PC에서 이미 로그인돼 있어요 · API 키 없이 바로 써요"
            : "로그인 창이 열려요 · API 키는 필요 없어요"
          : runtime.loggedIn
            ? "이 PC에 로그인돼 있어요 · 앱 답변에 쓰는 연결은 준비 중이에요"
            : "로그인 창이 열려요 · 앱 답변에 쓰는 연결은 준비 중이에요",
      recommended: subscriptionAnswersReady && runtime.loggedIn,
    }));
  const otherChoices: AIAlternativeChoice[] = [
    { id: "api_key", label: "API 키로 연결", detail: "Claude·Gemini·OpenAI 키를 붙여 넣어요", recommended: false },
    { id: "local", label: "내 PC 모델 찾기", detail: "Ollama나 LM Studio가 켜져 있으면 바로 찾아요", recommended: false },
  ];
  return subscriptionAnswersReady ? [...subscriptionChoices, ...otherChoices] : [...otherChoices, ...subscriptionChoices];
}

/** AI 로그인 완료를 기다리는 최대 시간. 구글 계정 선택·2단계 인증까지 넉넉히 기다린다. */
export const AI_LOGIN_WATCH_MAX_MS = 5 * 60_000;

/**
 * AI 로그인 완료 확인 간격. 처음 30초는 1초마다(대부분 여기서 끝난다),
 * 그 뒤 1분 30초까지는 2초, 그 뒤로는 5초마다 확인해 오래 기다려도 앱을 무겁게 하지 않는다.
 */
export function aiLoginWatchDelayMs(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 1_000;
  if (elapsedMs < 90_000) return 2_000;
  return 5_000;
}

/** 창으로 돌아올 때 AI 연결 상태를 다시 읽을지. 연달아 포커스가 바뀌어도 10초에 한 번만 읽는다. */
export function shouldRefreshAIStatusOnFocus(lastRefreshAt: number, now: number, minGapMs = 10_000): boolean {
  return now - lastRefreshAt >= minGapMs;
}

   
                            
  
                                                  
                                                   
                           
   
export function shouldCloseWorkspacePanelOnSend(input: { panelCoversConversation: boolean; viewportWidth: number }): boolean {
  return input.panelCoversConversation || input.viewportWidth <= 760;
}

/** 상태 조회가 잠깐 실패했을 때 자동으로 한 번만 다시 확인한다. 계속 실패하면 멈춘다. */
export const WORKSPACE_STATUS_RETRY_DELAY_MS = 3_000;
export function shouldRetryWorkspaceStatus(failedAttemptsSoFar: number): boolean {
  return failedAttemptsSoFar < 1;
}

/** 맡긴 일의 진행·승인을 확인하는 곳. 모든 '일 맡기기' 화면이 같은 두 곳을 가리킨다. */
export const DELEGATION_PROGRESS_HREF = "/office?officeView=today";
export const DELEGATION_APPROVAL_HREF = "/office?officeView=approval";
export function delegationReceiptLinks(): Array<{ label: string; href: string }> {
  return [
    { label: "진행 보기", href: DELEGATION_PROGRESS_HREF },
    { label: "승인할 것", href: DELEGATION_APPROVAL_HREF },
  ];
}
