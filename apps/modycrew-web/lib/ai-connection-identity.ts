import type { AIProviderKeyStatus } from "./desktop-bridge";

/**
 * "연결 신원이 바뀌었나"만 판별하는 서명.
 *
 * 이 값이 바뀌면 앱은 이전에 확인해 둔 실제 답변 영수증을 폐기한다.
 * 그래서 여기에 '연결이 그대로여도 바뀌는 값'이 섞이면, 사용자는 로그인도 했고
 * 답변도 나오는데 "실제 답변을 아직 확인하지 못했어요" 만 반복해서 듣고
 * 일정 등록 같은 실제 업무가 계속 막힌다.
 *
 * 그래서 일부러 제외하는 것:
 *  - updatedAt: 보관함에 쓴 시각일 뿐 신원이 아니다. 모델 저장·토큰 갱신마다 바뀐다.
 *  - keyFingerprint(codex_oauth 한정): 토큰을 갱신하면 refresh 토큰이 회전하므로
 *    같은 계정인데도 지문이 바뀐다. 계정 식별자를 대신 쓴다.
 *
 * API 키 제공자의 keyFingerprint 는 '어떤 키인가' 그 자체라 그대로 둔다
 * (사용자가 키를 바꾸면 확인 상태가 폐기되는 게 맞다).
 */
export function aiProviderStatusesSignature(providers: AIProviderKeyStatus[]): string {
  return (
    providers
      .map((provider) =>
        JSON.stringify({
          provider: provider.provider,
          status: provider.status,
          model: provider.model ?? "",
          hasLocalKey: Boolean(provider.hasLocalKey),
          keyFingerprint: aiConnectionIdentityFingerprint(provider),
          chatContentAllowed: provider.chatContentAllowed === true,
        }),
      )
      .sort()
      .join("|") || "no-providers"
  );
}

function aiConnectionIdentityFingerprint(provider: AIProviderKeyStatus): string {
  if (provider.authMode === "codex_oauth") {
    return `codex-account:${provider.accountId ?? provider.email ?? ""}`;
  }
  return provider.keyFingerprint ?? "";
}
