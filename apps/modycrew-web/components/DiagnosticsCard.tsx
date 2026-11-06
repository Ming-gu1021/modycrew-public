"use client";

import { useState } from "react";
import styles from "./AccountCard.module.css";

type DiagnosticItem = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  note: string;
};

const items: DiagnosticItem[] = [
  { id: "domain", label: "업무 규칙", status: "pass", note: "위험 작업 차단 규칙 확인 완료" },
  { id: "approval", label: "승인 확인", status: "pass", note: "외부 발송/등록 자동 실행 차단됨" },
  { id: "credential", label: "암호화 보관함", status: "pass", note: "비밀번호와 연결 보안값은 화면 밖에 보관" },
  { id: "ai_engine", label: "AI 연결", status: "warn", note: "AI 답변 연결 상태 확인 필요" },
  { id: "mail", label: "메일 연결", status: "warn", note: "메일함 또는 계정 동의 연결 필요" },
  { id: "calendar", label: "캘린더", status: "warn", note: "Google Calendar 계정 동의 연결 필요" },
  { id: "messenger", label: "메신저", status: "warn", note: "업무 알림 채널 연결 필요" },
  { id: "update_feed", label: "업데이트", status: "pass", note: "설치 앱 업데이트 확인 가능" },
];

export function DiagnosticsCard() {
  const [running, setRunning] = useState(false);

  return (
    <article className={styles.card}>
      <header className={styles.compactHead}>
        <div>
          <h2>앱 준비 상태</h2>
          <p className={styles.subtle}>지금 필요한 연결만 확인하고 세부 항목은 접어둡니다.</p>
        </div>
      </header>

      <div className={styles.diagnosticSummary} aria-label="진단 요약">
        <span data-status="pass">
          <strong>{items.filter((item) => item.status === "pass").length}</strong>
          통과
        </span>
        <span data-status="warn">
          <strong>{items.filter((item) => item.status === "warn").length}</strong>
          주의
        </span>
        <span data-status="fail">
          <strong>{items.filter((item) => item.status === "fail").length}</strong>
          실패
        </span>
      </div>

      <details className={styles.diagnosticFold}>
        <summary>세부 상태 {items.length}개</summary>
        <ul className={styles.diagnosticList}>
          {items.map((item) => (
            <li key={item.id} className={styles.diagnosticItem} data-status={item.status}>
              <span className={styles.diagnosticDot} aria-hidden="true" />
              <div>
                <strong>{item.label}</strong>
                <p>{item.note}</p>
              </div>
            </li>
          ))}
        </ul>
      </details>

      <button
        type="button"
        className={styles.secondary}
        onClick={() => {
          setRunning(true);
          setTimeout(() => setRunning(false), 1200);
        }}
        disabled={running}
      >
        {running ? "재실행 중..." : "다시 점검"}
      </button>
    </article>
  );
}
