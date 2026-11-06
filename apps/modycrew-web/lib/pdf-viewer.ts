export type PdfViewerAction = 'status' | 'install' | 'import' | 'open' | 'remove';
export type PdfViewerState = {
  status: string;
  userMessage: string;
  version?: string;
  downloadBytes?: number;
  license?: string;
  externalMutation: false;
};

export async function requestPdfViewer(action: PdfViewerAction): Promise<PdfViewerState> {
  // Reuse the existing, sender-checked document IPC; no arbitrary channel or URL is exposed.
  const bridge = typeof window !== 'undefined' ? window.modyCrewDesktopBridge : undefined;
  if (!bridge?.documentProduction) return { status: 'desktop_required', userMessage: 'PDF 편집 기능은 ModyCrew 설치 앱에 기본 포함되어 있습니다.', externalMutation: false };
  return await bridge.documentProduction({ kind: `pdf_viewer_${action}` }) as PdfViewerState;
}
