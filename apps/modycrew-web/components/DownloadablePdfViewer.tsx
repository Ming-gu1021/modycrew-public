"use client";

import { useEffect, useRef, useState } from 'react';
import { requestPdfViewer, type PdfViewerAction, type PdfViewerState } from '@/lib/pdf-viewer';
import styles from './DownloadablePdfViewer.module.css';

/** Keep the import name so existing document routes continue to work. */
export default function DownloadablePdfViewer() {
  const [state, setState] = useState<PdfViewerState | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const alive = useRef(true), pending = useRef(false);
  const run = async (action: PdfViewerAction) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice('');
    try {
      const result = await requestPdfViewer(action);
      if (alive.current) { if (action === 'status') setState(result); setNotice(result.userMessage); }
    } catch { if (alive.current) setNotice('PDF 기능을 준비하지 못했습니다. 다시 확인하거나 최신 모디크루 설치파일로 복구해 주세요.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  useEffect(() => { alive.current = true; void run('status'); return () => { alive.current = false; }; }, []);
  const ready = state?.status === 'installed';
  return <section className={styles.panel} aria-labelledby="pdf-viewer-title">
    <div className={styles.heading}><div><h2 id="pdf-viewer-title">PDF 보기·주석 편집</h2><p>기본 제공 · 추가 다운로드 없음</p></div><span className={styles.platforms}>Windows · macOS · Linux</span></div>
    <p className={styles.description}>문서를 열어 검색·확대·인쇄하고 주석을 더한 뒤 사본으로 저장하세요. 인터넷 연결 없이 사용할 수 있습니다.</p>
    <div className={styles.actions}><button type="button" disabled={busy || !ready} onClick={() => void run('open')}>PDF 열기</button>{!ready && !busy && <button type="button" className={styles.secondary} onClick={() => void run('status')}>다시 확인</button>}</div>
    <p className={styles.status} role="status" aria-live="polite">{busy ? 'PDF 기능 준비 중…' : notice || '기본 기능 확인 중…'}</p>
    <details className={styles.details}><summary>지원 범위</summary><p>PDF.js {state?.version || '6.4.299'} · Apache-2.0 · <a href="https://github.com/mozilla/pdf.js" target="_blank" rel="noopener noreferrer">공식 소스</a></p><p>원본을 보호해 사본으로 저장합니다. 워드처럼 기존 본문을 다시 쓰거나 스캔 문자를 인식하는 OCR은 현재 지원하지 않습니다. PDF는 AI 서버로 보내지 않습니다.</p></details>
  </section>;
}
