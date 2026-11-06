export type CompanyClock = {
  expectOwnWrite(key: string, localMs: number): void;
  observeOwnWrite(key: string, serverMs: number): boolean;
  observeArrival(serverMs: number, receivedLocalMs?: number): void;
  offsetMs(): number;
  serverNow(): number;
  toServer(localMs: number): number;
  skewMs(): number | null;
  hasPreciseSample(): boolean;
  reset(): void;
};
export function createCompanyClock(options?: { now?: () => number; maxSamples?: number; sampleTtlMs?: number; pendingTtlMs?: number; maxPending?: number; settleMs?: number }): CompanyClock;
export const companyClock: CompanyClock;
export const COMPANY_CLOCK_SKEW_NOTICE_MS: number;
export function clockSkewNotice(skewMs: number | null | undefined, threshold?: number): string;
