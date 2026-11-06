import type { DeliverableReceipt, DeliverableScope, GeneratedFile } from './generated-deliverables';

export const RESULT_PANE_OPEN = 'modycrew:result-pane-open';
export const RESULT_PANE_CLEAR = 'modycrew:result-pane-clear';
export type SavedResult = { scope: DeliverableScope; files: GeneratedFile[]; receipt: DeliverableReceipt };
export const resultKey = (scope: DeliverableScope) => JSON.stringify([scope.workspaceRoot, scope.threadId, scope.messageId]);
export function sourceLines(content: string): string[] {
  if (!content) return [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
// Each bundle contains newly created files. These are NOT a Git diff or edits to originals.
export function savedFileSummary(result: SavedResult) {
  if (result.receipt.status !== 'saved') return [];
  return result.files.flatMap(file => {
    const proof = result.receipt.files?.find(item => item.name === file.name);
    return proof ? [{ ...file, bytes: proof.bytes, addedLines: sourceLines(file.content).length }] : [];
  });
}
