"use client";

const STORAGE_KEY = "modycrew.finalExecutionSettings.v1";

export const FINAL_LIVE_EXECUTION_PHRASE = "실제 발송 책임 확인";

export type FinalExecutionSettings = {
  liveProviderExecutionEnabled: boolean;
  enabledAt?: string;
  disabledAt?: string;
  acknowledgedPhrase?: string;
  acknowledgedRisks: string[];
  rollbackGuide: string;
};

export function readFinalExecutionSettings(): FinalExecutionSettings {
  if (typeof window === "undefined") return initialSettings();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialSettings();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return initialSettings();
    return sanitizeSettings(parsed as Partial<FinalExecutionSettings>);
  } catch {
    return initialSettings();
  }
}

export function enableFinalLiveExecution(phrase: string): FinalExecutionSettings {
  const acknowledgedPhrase = cleanPhrase(phrase);
  const settings: FinalExecutionSettings = {
    liveProviderExecutionEnabled: acknowledgedPhrase === FINAL_LIVE_EXECUTION_PHRASE,
    enabledAt: new Date().toISOString(),
    acknowledgedPhrase,
    acknowledgedRisks: [
      "외부 메일이나 일정이 실제 연결 서비스로 전송될 수 있음",
      "잘못된 수신자, 제목, 본문은 사용자가 최종 확인해야 함",
      "계약, 세무, 공공기관, 결제 업무는 별도 정책으로 계속 차단될 수 있음",
    ],
    rollbackGuide: "문제가 있으면 즉시 고급 실제 실행을 끄고 연결된 메일/캘린더에서 처리 상태를 확인하세요.",
  };
  writeSettings(settings);
  return settings;
}

export function disableFinalLiveExecution(): FinalExecutionSettings {
  const current = readFinalExecutionSettings();
  const settings: FinalExecutionSettings = {
    ...current,
    liveProviderExecutionEnabled: false,
    disabledAt: new Date().toISOString(),
  };
  writeSettings(settings);
  return settings;
}

function initialSettings(): FinalExecutionSettings {
  return {
    liveProviderExecutionEnabled: false,
    acknowledgedRisks: [],
    rollbackGuide: "고급 실제 실행은 기본 잠금입니다. 테스트 발송과 실행 전 검토를 먼저 확인하세요.",
  };
}

function sanitizeSettings(input: Partial<FinalExecutionSettings>): FinalExecutionSettings {
  return {
    liveProviderExecutionEnabled: input.liveProviderExecutionEnabled === true,
    enabledAt: cleanOptional(input.enabledAt),
    disabledAt: cleanOptional(input.disabledAt),
    acknowledgedPhrase: cleanOptional(input.acknowledgedPhrase),
    acknowledgedRisks: Array.isArray(input.acknowledgedRisks)
      ? input.acknowledgedRisks.map(cleanPhrase).filter(Boolean).slice(0, 6)
      : [],
    rollbackGuide: cleanOptional(input.rollbackGuide) ?? initialSettings().rollbackGuide,
  };
}

function writeSettings(settings: FinalExecutionSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function cleanOptional(value: unknown): string | undefined {
  const text = cleanPhrase(value);
  return text || undefined;
}

function cleanPhrase(value: unknown): string {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}
