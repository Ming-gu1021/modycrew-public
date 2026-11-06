"use client";
import { useEffect, useState } from "react";
import { workProgressHeadline } from "@/lib/work-elapsed";
import styles from "./ChatWorkProgress.module.css";

/**
 * 대화의 작업 진행 표시. 작업하는 동안 'N분 N초 동안 작업 중'이 1초마다 올라가고, 끝나면 'N분 N초 만에 작업 완료'로 남는다.
 * 시간 글자는 화면 읽기 프로그램이 매초 읽지 않도록 숨기고, 단계가 바뀔 때만 상태를 알린다.
 */
export default function ChatWorkProgress({ phase, detail, complete = false, failed = false, startedAt, finishedAt }: { phase: string; detail: string; complete?: boolean; failed?: boolean; startedAt?: number; finishedAt?: number }) {
  const [events, setEvents] = useState<string[]>([]);
  useEffect(() => { if (detail) setEvents(previous => previous.at(-1) === detail ? previous : [...previous.slice(-19), detail]); }, [detail]);
  // Streaming has no measurable work total. A finished answer is not proof of file work.
  const active = !complete && !failed;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const headline = workProgressHeadline({ active, complete, failed, phase, startedAt, finishedAt, now });
  const spoken = failed ? "확인 필요" : complete ? "작업 완료" : phase === "generating" ? "답변 중" : "처리 중";
  return <section className={styles.progress} aria-label="작업 진행 상황" data-work-progress data-work-elapsed={typeof startedAt === "number" ? "tracked" : "untracked"}>
    <div><span role="status" className={styles.srOnly}>{spoken}</span><span aria-hidden="true" className={styles.dot} data-active={active} /><strong aria-hidden="true" data-work-headline>{headline}</strong>{active || failed ? <span>{detail}</span> : null}</div>
    {events.length > 1 ? <details><summary>작업 기록</summary><ol>{events.map((event, index) => <li key={index}>{event}</li>)}</ol></details> : null}
  </section>;
}
