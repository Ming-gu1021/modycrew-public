import { auditActorLabels, auditEventLabels, type AuditEvent } from "@/lib/office";
import { formatKoreanClock } from "@/lib/date-format";
import styles from "./AuditTimeline.module.css";

type Props = {
  events: AuditEvent[];
};

function formatTime(iso: string): string {
  return formatKoreanClock(iso);
}

export function AuditTimeline({ events }: Props) {
  const visibleEvents = events.slice(0, 1);
  const hiddenEvents = events.slice(1);
  const renderEvent = (event: AuditEvent) => (
    <li key={event.id} className={`${styles.item} ${styles[`severity_${event.severity}`]}`}>
      <span className={styles.time}>{formatTime(event.at)}</span>
      <div className={styles.body}>
        <div className={styles.itemHead}>
          <span className={styles.actor}>{auditActorLabels[event.actor]}</span>
          <strong>{auditEventLabels[event.event] ?? event.event}</strong>
        </div>
        <p>{event.detail}</p>
      </div>
    </li>
  );

  return (
    <aside className={styles.panel} aria-label="감사 로그 타임라인" data-audit-visible-count={visibleEvents.length} data-audit-hidden-count={hiddenEvents.length}>
      <header className={styles.head}>
        <h2>최근 활동</h2>
      </header>
      {events.length === 0 ? (
        <p className={styles.empty}>아직 기록된 실제 활동이 없습니다.</p>
      ) : (
        <>
          <ul className={styles.list} role="list" aria-label="최근 감사 활동">{visibleEvents.map(renderEvent)}</ul>
          {hiddenEvents.length ? (
            <details className={styles.moreEvents} aria-label="지난 감사 기록 더 보기">
              <summary>기록 더 보기 <strong>{hiddenEvents.length}개</strong></summary>
              <ul className={styles.list} role="list" aria-label="지난 감사 활동">{hiddenEvents.map(renderEvent)}</ul>
            </details>
          ) : null}
        </>
      )}
    </aside>
  );
}
