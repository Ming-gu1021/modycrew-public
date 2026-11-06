type RefreshWork = { status: string; masterStatus?: string; tasks?: { status: string }[] };
type RefreshState = { works?: RefreshWork[]; connections?: { enabled?: boolean }[]; rules?: { enabled?: boolean }[] };
export const COMPANY_REFRESH_FAST_MS: number;
export const COMPANY_REFRESH_SLOW_MS: number;
export const COMPANY_REFRESH_KICK_MS: number;
export function companyRefreshInterval(state: RefreshState | null | undefined, options?: { now?: number; kickUntil?: number }): number;
export function companyActKicksRefresh(kind: unknown): boolean;
