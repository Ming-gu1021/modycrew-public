"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  createMobileMailShareHandoff,
  readPendingMobileMailShareHandoffQueue,
  sanitizeMobileMailShareText,
  writePendingMobileMailShareHandoff,
  type MobileMailShareHandoffRecord,
} from "@/lib/mobile-mail-share-handoff";
import styles from "./page.module.css";

function readShareParams() {
  if (typeof window === "undefined") return null;
  const params = new URL(window.location.toString()).searchParams;
  const fromParam = params.get("from") || params.get("sender");
  const title = sanitizeMobileMailShareText(params.get("title") || params.get("subject") || params.get("name"), 180);
  const text = sanitizeMobileMailShareText(params.get("text") || params.get("body") || params.get("summary"), 3600);
  const url = sanitizeMobileMailShareText(params.get("url") || params.get("link"), 800);
  if (!title && !text && !url) return null;
  return createMobileMailShareHandoff({
    title,
    text,
    url,
    from: fromParam === "mailops-unified" ? "" : fromParam,
    source: "mobile_share_sheet",
  });
}

function readEntrySource() {
  if (typeof window === "undefined") return "direct";
  const params = new URL(window.location.toString()).searchParams;
  if (params.get("from") === "mailops-unified") return "mailops_unified_queue";
  return params.get("entry") || "direct";
}

function buildHomeHref(path: "/" | "/?mobileMailShare=1") {
  if (typeof window === "undefined") return path;
  const currentParams = new URL(window.location.toString()).searchParams;
  const nextParams = new URLSearchParams(path.includes("?") ? path.split("?")[1] : "");
  for (const key of ["preview", "mockRuntime"]) {
    const value = currentParams.get(key);
    if (value) nextParams.set(key, value);
  }
  const query = nextParams.toString();
  return query ? `/?${query}` : "/";
}

function buildMobileMailShareReviewRows(record: MobileMailShareHandoffRecord | null) {
  const text = `${record?.subject ?? ""} ${record?.body ?? ""}`.trim();
  const hasSchedule = /일정|예약|미팅|상담|시간|방문|calendar|schedule/iu.test(text);
  const hasAttachment = /첨부|파일|견적|계약|pdf|xlsx|docx|링크/iu.test(text);
  const hasRisk = /환불|클레임|불만|계약|세금|공공|책임|보상|긴급/iu.test(text);
  return [
    {
      id: "reply_draft",
      label: "답장 후보",
      title: record?.subject || "선택 메일",
      detail: "초안만 만들고 바로 보내지 않음",
      state: "candidate",
    },
    {
      id: "revise",
      label: "수정/확인",
      title: hasAttachment ? "첨부 확인" : hasSchedule ? "일정 표현 확인" : "수신자/톤 확인",
      detail: "앱 안에서 문구와 조건 수정",
      state: "review",
    },
    {
      id: "hold",
      label: "보류",
      title: hasRisk ? "위험 표현 보류" : "불확실하면 멈춤",
      detail: "원문 확인 전 자동 발송 없음",
      state: hasRisk ? "risk" : "hold",
    },
    {
      id: "approve_candidate",
      label: "승인 후보",
      title: "마지막 확인",
      detail: "승인 뒤 앱 최종 확인에서만 전송",
      state: "locked",
    },
  ];
}

function classifyMobileMailShareRecord(record: MobileMailShareHandoffRecord) {
  const text = `${record.subject} ${record.body}`.trim();
  if (/환불|클레임|불만|계약|세금|공공|책임|보상|긴급/iu.test(text)) {
    return {
      state: "risk",
      label: "보류 검토",
      detail: "위험 표현 확인",
    };
  }
  if (/일정|예약|미팅|상담|시간|방문|calendar|schedule/iu.test(text)) {
    return {
      state: "schedule",
      label: "일정 후보",
      detail: "시간 조건 확인",
    };
  }
  if (/첨부|파일|견적|계약|pdf|xlsx|docx|링크/iu.test(text)) {
    return {
      state: "review",
      label: "수정/확인",
      detail: "첨부/링크 확인",
    };
  }
  return {
    state: "reply",
    label: "답장 후보",
    detail: "초안 작성 가능",
  };
}

export default function MailSharePage() {
  const [record, setRecord] = useState<MobileMailShareHandoffRecord | null>(null);
  const [queue, setQueue] = useState<MobileMailShareHandoffRecord[]>([]);
  const [saved, setSaved] = useState(false);
  const [handoffHref, setHandoffHref] = useState("/?mobileMailShare=1");
  const [homeHref, setHomeHref] = useState("/");
  const [entrySource, setEntrySource] = useState("direct");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const sharedRecord = readShareParams();
    const pending = readPendingMobileMailShareHandoffQueue();
    // Reopening the same pending share must reuse its identity, including a
    // refresh or React's development effect replay. Distinct mail stays queued.
    // The stored queue reads body at 3600 characters; a share can append a URL
    // after that limit. Compare the same normalized body and the separate URL.
    const sharedBody = sharedRecord ? sanitizeMobileMailShareText(sharedRecord.body, 3600) : "";
    const existing = sharedRecord && pending.find((item) =>
      item.subject === sharedRecord.subject && item.body === sharedBody &&
      (item.from || "") === (sharedRecord.from || "") && (item.url || "") === (sharedRecord.url || ""));
    const nextRecord = existing || sharedRecord || pending[0] || null;
    setEntrySource(readEntrySource());
    setRecord(nextRecord);
    const nextSaved = sharedRecord && nextRecord ? writePendingMobileMailShareHandoff(nextRecord) : pending.length > 0;
    setSaved(nextSaved);
    setQueue(readPendingMobileMailShareHandoffQueue());
    setHandoffHref(buildHomeHref("/?mobileMailShare=1"));
    setHomeHref(buildHomeHref("/"));
    setLoaded(true);
  }, []);

  function retrySave() {
    if (!record) return;
    const nextSaved = writePendingMobileMailShareHandoff(record);
    setSaved(nextSaved);
    setQueue(readPendingMobileMailShareHandoffQueue());
  }

  if (!record) return (
    <main className={styles.page} data-mobile-mail-share-route="pwa_get_share_target" data-mobile-mail-share-external-mutation="false">
      <section className={styles.panel} aria-label="휴대폰 선택 메일 수신">
        <header><span>휴대폰 메일</span><h1>선택한 메일을 업무대장으로 넘깁니다</h1></header>
        <p role="status">{loaded ? "공유된 메일이 없습니다. 메일 앱에서 메일을 선택한 뒤 ModyCrew로 공유해 주세요." : "공유된 메일을 확인하고 있습니다."}</p>
        <div className={styles.actions}><Link href={homeHref}>홈으로 가기</Link></div>
      </section>
    </main>
  );

  const bodyLength = record?.body.trim().length ?? 0;
  const queueCount = queue.length || (record ? 1 : 0);

  return (
    <main
      className={styles.page}
      data-mobile-mail-share-route="pwa_get_share_target"
      data-mobile-mail-share-contract="selected_phone_mail_to_workbench_draft_approval_final_confirmation"
      data-mobile-mail-share-entry-source={entrySource}
      data-mobile-mail-share-storage="session_only_clear_after_home_apply"
      data-mobile-mail-share-external-mutation="false"
    >
      <section className={styles.panel} aria-label="휴대폰 선택 메일 수신">
        <header>
          <span>휴대폰 메일</span>
          <h1>선택한 메일을 업무대장으로 넘깁니다</h1>
          <p>답장 초안과 확인 항목만 만들고, 실제 발송은 앱 승인 전까지 잠겨 있습니다.</p>
        </header>
        <dl className={styles.summary}>
          <div>
            <dt>제목</dt>
            <dd>{record?.subject || "제목 없음"}</dd>
          </div>
          <div>
            <dt>본문</dt>
            <dd>{bodyLength ? `${bodyLength}자 수신` : "본문 없음"}</dd>
          </div>
          <div>
            <dt>상태</dt>
            <dd>{saved ? `홈으로 ${queueCount}건 전달 준비` : "이 브라우저에서 임시 저장 불가"}</dd>
          </div>
        </dl>
        {!saved && (
          <div className={styles.reviewRail} role="alert">
            <p>메일을 임시 저장하지 못했습니다. 현재 내용은 이 화면에 남아 있습니다. 다시 저장한 뒤 홈으로 전달해 주세요.</p>
            <div className={styles.actions}>
              <button type="button" onClick={retrySave}>다시 저장</button>
            </div>
          </div>
        )}
        {saved && <section
          className={styles.queueRail}
          aria-label="휴대폰 선택 메일 전달 묶음"
          data-mobile-mail-share-queue="session_selected_mail_batch"
          data-mobile-mail-share-queue-count={queueCount}
          data-mobile-mail-share-queue-contract="multi_selected_phone_mail_to_home_workbench"
          data-mobile-mail-share-queue-external-mutation="false"
          data-mobile-mail-share-decision-actions="reply_draft_revise_hold_approve_candidate_no_external_mutation"
          data-mobile-mail-share-final-confirmation="app_required"
        >
          <header>
            <span>전달 묶음</span>
            <strong>{queueCount}건을 홈 메일 작업대에 올립니다</strong>
          </header>
          <ol>
            {(queue.length ? queue : record ? [record] : []).slice(0, 4).map((item, index) => {
              const classification = classifyMobileMailShareRecord(item);
              return (
                <li
                  key={item.id}
                  data-mobile-mail-share-row="one_line_classified_mail"
                  data-mobile-mail-share-row-state={classification.state}
                  data-mobile-mail-share-row-actions="revise_hold_approve_candidate"
                  data-mobile-mail-share-row-final-confirmation="app_required"
                  data-mobile-mail-share-row-external-mutation="false"
                >
                  <span>A{index + 1}</span>
                  <strong>{item.subject || "제목 없음"}</strong>
                  <small>{classification.label} · {classification.detail} · 전송 잠금</small>
                </li>
              );
            })}
          </ol>
        </section>}
        <section
          className={styles.reviewRail}
          aria-label="휴대폰 메일 승인 후보 한 줄 보기"
          data-mobile-mail-share-review-plan="one_line_reply_edit_hold_approve"
          data-mobile-mail-share-review-contract="phone_selected_mail_summary_to_edit_hold_approve_before_final_send"
          data-mobile-mail-share-decision-contract="phone_shared_mail_reply_edit_hold_approve_to_workbench"
          data-mobile-mail-share-decision-actions="reply_draft_revise_hold_approve_candidate"
          data-mobile-mail-share-final-boundary="app_final_confirmation_before_external_send"
          data-mobile-mail-share-final-confirmation="app_required"
        >
          <header>
            <span>앱에서 볼 순서</span>
            <strong>답장, 수정, 보류, 승인만 한 줄로 정리합니다</strong>
          </header>
          <ol>
            {buildMobileMailShareReviewRows(record).map((row) => (
              <li
                key={row.id}
                data-state={row.state}
                data-mobile-mail-share-decision-action={row.id}
                data-mobile-mail-share-action-external-mutation="false"
                data-mobile-mail-share-action-final-confirmation="app_required"
              >
                <span>{row.label}</span>
                <strong>{row.title}</strong>
                <small>{row.detail}</small>
              </li>
            ))}
          </ol>
          {saved && <div className={styles.decisionActionRail} aria-label="휴대폰 메일 빠른 결정">
            <Link href={handoffHref} data-mobile-mail-share-decision-link="revise">
              수정
            </Link>
            <Link href={handoffHref} data-mobile-mail-share-decision-link="hold">
              보류
            </Link>
            <Link href={handoffHref} data-mobile-mail-share-decision-link="approve_candidate">
              승인 후보
            </Link>
          </div>}
        </section>
        <ol
          className={styles.installGuide}
          aria-label="휴대폰 공유 설정 순서"
          data-mobile-mail-share-install-guide="install_pwa_then_share_mail_then_approve_in_app"
          data-mobile-mail-share-install-external-mutation="false"
        >
          <li>
            <span>1</span>
            <strong>홈 화면에 추가</strong>
          </li>
          <li>
            <span>2</span>
            <strong>메일 앱에서 공유</strong>
          </li>
          <li>
            <span>3</span>
            <strong>앱에서 수정 후 승인</strong>
          </li>
        </ol>
        {saved && <div className={styles.actions}>
          <Link href={handoffHref} data-mobile-mail-share-home-link="true">
            메일 업무에 올리기
          </Link>
          <Link href={homeHref} data-mobile-mail-share-home-fallback="true">
            홈으로 가기
          </Link>
        </div>}
      </section>
    </main>
  );
}
