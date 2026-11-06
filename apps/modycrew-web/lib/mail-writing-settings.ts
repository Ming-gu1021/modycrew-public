import type { MailWritingAccountMode, MailWritingDefaultMode, MailWritingProfile } from "@/lib/desktop-bridge";

/** 명함 양식 칸. 비운 칸은 서명에 넣지 않는다. */
export type BusinessCardFields = { name: string; title: string; company: string; phone: string; email: string; extra: string };
export const emptyBusinessCard: BusinessCardFields = { name: "", title: "", company: "", phone: "", email: "", extra: "" };

/** 명함 칸을 메일 서명 블록으로: '이름 | 직함', 회사, 전화, 이메일, 주소·웹사이트 순서로 한 줄씩. */
export function buildCardSignature(card: BusinessCardFields): string {
  const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
  return [
    [clean(card.name), clean(card.title)].filter(Boolean).join(" | "),
    clean(card.company),
    clean(card.phone),
    clean(card.email),
    clean(card.extra),
  ].filter(Boolean).join("\n");
}

/** 고른 대상(빈 값 = 모든 계정 기본값)의 화면 값. 계정에 따로 정한 것이 없으면 '기본 설정 따르기'. */
export function mailWritingFormFor(profile: MailWritingProfile | null, target: string): { mode: MailWritingDefaultMode | MailWritingAccountMode; signature: string; tone: string } {
  if (!target) {
    const defaults = profile?.defaults;
    return { mode: defaults?.signatureMode ?? "name", signature: defaults?.signature ?? "", tone: defaults?.tone ?? "" };
  }
  const account = profile?.accounts[target];
  return account ? { mode: account.signatureMode, signature: account.signature, tone: account.tone } : { mode: "inherit", signature: "", tone: "" };
}
