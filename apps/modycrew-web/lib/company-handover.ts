import type { CompanyAutomationResult, CompanyDepartment, CompanyRecord, CompanyWork } from './company-automation';

export type HandoverPurpose = 'replacement' | 'new_hire' | 'device_move';
export type HandoverStep = { id: string; text: string; done: boolean; completedAt?: string };
export type HandoverCitation = { sourceId: string; name: string; version: number; hash: string; quote: string; startLine: number; endLine: number };
export type HandoverAnswer = {
  id: string; question: string; status: 'answered' | 'needs_confirmation'; answer: string; aiExplanation?: string;
  citations: HandoverCitation[]; nextSteps: string[]; missing: string[]; createdAt: string; handoverRevision?: number;
};
export type HandoverDraft = {
  title: string; departmentId: string; fromPerson: string; toPerson: string; purpose: HandoverPurpose; summary: string;
  sourceIds: string[]; workIds: string[]; steps: { id?: string; text: string }[];
};
export type CompanyHandover = Omit<HandoverDraft, 'steps' | 'workIds'> & {
  id: string; revision: number; steps: HandoverStep[]; status: 'draft' | 'ready' | 'active' | 'completed';
  sourceEvidence: { id: string; name: string; hash: string; version: number }[];
  workSnapshots: (Pick<CompanyWork, 'id' | 'request' | 'status' | 'result' | 'createdAt'> & { capturedAt?: string })[];
  approvedAt?: string; acceptedAt?: string; completedAt?: string; createdAt: string; updatedAt: string;
  history: { action?: string; at?: string; revision?: number; snapshot?: { revision?: number; questions?: HandoverAnswer[] }; [key: string]: unknown }[];
  questions: HandoverAnswer[];
};
export type HandoverState = { version: 1; handovers: CompanyHandover[] };
export type HandoverSuggestion = { summary: string; steps: string[]; missing: string[] };
export type HandoverTransferPreview = {
  token: string; companyName: string; title: string; recordCount: number; recordNames: string[];
  createdAt: string; expiresAt: string; exclusions: string[];
};
export type HandoverResult = CompanyAutomationResult & {
  handoverState?: HandoverState; handover?: CompanyHandover; departments?: CompanyDepartment[];
  works?: CompanyWork[]; answer?: HandoverAnswer; suggestion?: HandoverSuggestion;
  transferPreview?: HandoverTransferPreview; file?: { name: string; path: string; bytes?: number; hash?: string };
  records?: CompanyRecord[];
};

export const handoverPurposeLabels: Record<HandoverPurpose, string> = {
  replacement: '담당자 교체 · 퇴사 인수인계', new_hire: '신입·경력 입사자 업무 적응', device_move: '회사 자료·업무 환경 이전',
};
export const handoverStatusLabels: Record<CompanyHandover['status'], string> = {
  draft: '작성 중', ready: '인수 확인 대기', active: '업무 익히는 중', completed: '인수인계 완료',
};
export const emptyHandoverDraft = (): HandoverDraft => ({
  title: '', departmentId: '', fromPerson: '', toPerson: '', purpose: 'replacement', summary: '', sourceIds: [], workIds: [], steps: [],
});
export function draftFromHandover(handover: CompanyHandover): HandoverDraft {
  return {
    title: handover.title, departmentId: handover.departmentId || '', fromPerson: handover.fromPerson || '',
    toPerson: handover.toPerson || '', purpose: handover.purpose, summary: handover.summary || '',
    sourceIds: [...(handover.sourceIds || [])], workIds: (handover.workSnapshots || []).map((work) => work.id),
    steps: handover.steps.map((step) => ({ id: step.id, text: step.text })),
  };
}
