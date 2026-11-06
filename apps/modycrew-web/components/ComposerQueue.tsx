"use client";

import WorkspaceIcon from "./WorkspaceIcon";
import styles from "./ComposerQueue.module.css";

type QueuedRequest = { id: string; text: string; delivery?: "queued" | "live" };

export default function ComposerQueue({ requests, onCancel }: { requests: QueuedRequest[]; onCancel: (id: string) => void }) {
  if (!requests.length) return null;
  const liveCount = requests.filter(request => request.delivery === "live").length;
  const label = liveCount ? `반영 ${liveCount}${requests.length > liveCount ? ` · 대기 ${requests.length - liveCount}` : ""}` : `대기 ${requests.length}`;
  return <details className={styles.queue} aria-label="답변 대기실" data-composer-queue>
    <summary aria-label={`${label}, 요청 펼치기·접기`}>
      <WorkspaceIcon name="chevron" size={13} className={styles.chevron} />
      <span className={styles.count} aria-live="polite">{label}</span>
      <span className={styles.preview}>{requests[0].text.trim() || "첨부 요청"}</span>
      {requests.length === 1 && <button type="button" aria-label="대기 요청 취소" onClick={event => { event.preventDefault(); event.stopPropagation(); onCancel(requests[0].id); }}>취소</button>}
    </summary>
    <ol>
      {requests.map((request, index) => <li key={request.id}>
        <span className={styles.order}>{request.delivery === "live" ? "반영 중" : `${index + 1}`}</span>
        <p>{request.text.trim() || "첨부 요청"}</p>
        {requests.length > 1 && <button type="button" aria-label={`${index + 1}번째 대기 요청 취소`} onClick={() => onCancel(request.id)}>취소</button>}
      </li>)}
    </ol>
  </details>;
}
