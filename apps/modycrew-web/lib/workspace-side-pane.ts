export const WORKSPACE_PANE_OPEN = 'modycrew:side-pane-open';
export const WORKSPACE_PANE_STATE = 'modycrew:side-pane-state';
export const WORKSPACE_PANE_CLOSE = 'modycrew:side-pane-close';
export function closeWorkspacePane() { window.dispatchEvent(new Event(WORKSPACE_PANE_CLOSE)); }
export type WorkspaceFileTarget = { path?: string; companyId?: string; teamId?: string; resourceId?: string; revision?: number };
export type LocalFilePreview = { name: string; path: string; kind: 'text' | 'image'; text?: string; dataUrl?: string; size: number; extension: string; truncated?: boolean };
export function openWorkspaceFiles(target: WorkspaceFileTarget = {}) {
  window.dispatchEvent(new CustomEvent(WORKSPACE_PANE_OPEN, { detail: { tab: 'files', ...target } }));
}
declare global { interface Window { modyCrewFiles?: { request: (payload: { kind: 'pick' | 'preview' | 'open-original' | 'save-shared'; path?: string; name?: string; base64?: string }) => Promise<{ status: string; file?: LocalFilePreview; path?: string }> } } }
