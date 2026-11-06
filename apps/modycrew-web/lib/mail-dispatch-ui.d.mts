export function mailDispatchReviewState(status?: string | null): { blockRetry: boolean; clearReview: boolean; label: string };
export function retainAuthoritativeMailCard(item: { finalAction?: {kind?: string; sentAt?: string; readiness?: string}; mailDispatchStatus?: {status?: string} }): boolean;
