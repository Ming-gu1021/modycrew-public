export type CompanyHostIssue = { kind: string; code: string; message: string; at: number };
export function reportCompanyHostIssue(companyId: string, kind: string, error: unknown, at?: number): void;
export function reportCompanyHostOk(companyId: string, kind?: string, at?: number): void;
export function readCompanyHostStatus(companyId: string): CompanyHostIssue | null;
export function subscribeCompanyHostStatus(listener: (companyId: string, status: CompanyHostIssue | null) => void): () => void;
export function clearCompanyHostStatus(): void;
export function describeCompanyHostIssue(status: CompanyHostIssue | null | undefined, skewMs?: number | null): string;
