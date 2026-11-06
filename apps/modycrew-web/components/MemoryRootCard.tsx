"use client";

import { useEffect, useState } from "react";
import { createDesktopBridge, type LocalMemoryStatusResult } from "@/lib/desktop-bridge";
import styles from "./AccountCard.module.css";

export function MemoryRootCard() {
  const [status, setStatus] = useState<LocalMemoryStatusResult | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const bridge = createDesktopBridge();
    setIsDesktop(bridge.isAvailable);
    void bridge
      .getLocalMemoryStatus()
      .then((result) => {
        setStatus(result);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "기억 위치 상태를 확인하지 못했습니다.");
      });
  }, []);

  const chooseMemoryRoot = async () => {
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable) {
      setMessage("기억 위치 선택은 설치 앱에서만 가능합니다. 브라우저에서는 경로를 저장하지 않습니다.");
      return;
    }

    setBusy(true);
    setMessage("기억 저장 폴더를 선택하는 중입니다.");
    try {
      const result = await bridge.chooseLocalMemoryRoot();
      setStatus(result);
      setMessage(result.root ? "" : "기억 저장 위치 선택을 취소했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "기억 저장 위치를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={styles.card}
      aria-label="기억 위치 설정"
      data-memory-root-card="local_memory_root_only"
      data-memory-root-state={status?.root ? "ready" : "missing"}
      data-memory-root-desktop={isDesktop ? "true" : "false"}
    >
      <header className={styles.head}>
        <h2>업무 방식 저장 위치</h2>
      </header>

      <button type="button" className={styles.primary} onClick={chooseMemoryRoot} disabled={busy}>
        {busy ? "선택 중..." : status?.root ? "기억 위치 바꾸기" : "기억 위치 선택"}
      </button>

      <details className={styles.advancedBox} data-memory-root-detail-default="closed">
        <summary>저장 위치와 범위</summary>
        <section className={styles.syncSummary} aria-label="기억 위치 현재 상태">
          <div>
            <span>현재 위치</span>
            <strong>{status?.root ? "설정됨" : "선택 필요"}</strong>
            <small>{status?.root || "설치 앱에서 폴더 선택"}</small>
          </div>
          <div>
            <span>실행 위치</span>
            <strong>{isDesktop ? "설치 앱" : "브라우저"}</strong>
            <small>{isDesktop ? "폴더 선택 가능" : "선택은 설치 앱에서"}</small>
          </div>
        </section>

        <ul className={styles.syncScopeList} aria-label="기억 위치 설정 범위">
          <li>
            <strong>저장</strong>
            <span>업무 방식, 팀원 기억, 결정 기록</span>
          </li>
          <li>
            <strong>제외</strong>
            <span>메일 원문, 비밀번호, 연결 보안값</span>
          </li>
        </ul>

        <section className={styles.syncSnapshot} aria-label="기억 저장 항목">
          <dl>
            <div>
              <dt>AI 팀원</dt>
              <dd>역할별 업무 방식</dd>
            </div>
            <div>
              <dt>다음부터</dt>
              <dd>사용자가 저장한 처리 기준</dd>
            </div>
            <div>
              <dt>결정 기록</dt>
              <dd>승인, 보류, 수정 요청</dd>
            </div>
          </dl>
          <p>경로 원문은 필요한 설정 화면에서만 보여주고, 채팅 답변에는 그대로 노출하지 않습니다.</p>
        </section>
      </details>

      {message ? <p className={styles.status}>{message}</p> : null}
    </article>
  );
}
