type RequestLike = { status: string; createdAtEpochMs?: number };
export const COMPANY_STUCK_REQUEST_MS: number;
export const COMPANY_STUCK_MESSAGE: string;
export const COMPANY_STALE_REQUEST_MS: number;
export const COMPANY_STALE_MESSAGE: string;
export function companyHostWatchMode(membership: { role?: string } | null | undefined): "watch" | "check";
export function isThisCompanyHost(host: { enabled?: boolean; uid?: string; deviceId?: string } | null | undefined, uid: string, deviceId: string): boolean;
export function staleCompanyRequestMessage(request: RequestLike | null | undefined, serverNow: number): string;
export function stuckCompanyRequestMessage(request: RequestLike | null | undefined, failure: { count: number; first: number } | null | undefined, serverNow: number, localNow: number): string;
