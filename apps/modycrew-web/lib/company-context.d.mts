export function buildCompanyPrompt(input: { companyId: string; teamId: string; prompt: string; messages?: Array<{authorName?: string; kind?: string; requestText?: string; text: string}>; resources?: Array<{title: string; kind?: string; text: string}> }): string;
export function companyQueryTerms(prompt: string): string[];
export function isCompanyHostOnline(host: {enabled: boolean; heartbeatAtEpochMs: number} | null, now?: number): boolean;
export function canProcessCompanyRequest(request: {hostUid: string; hostDeviceId: string; status: string; leaseExpiresAtEpochMs: number}, host: {uid: string; deviceId: string; enabled: boolean} | null, deviceId: string, now?: number): boolean;
