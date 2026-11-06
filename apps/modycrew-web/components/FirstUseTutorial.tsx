"use client";

import { useEffect, useRef, useState } from "react";
import { FIRST_USE_TUTORIAL_EVENT, FIRST_USE_TUTORIAL_KEY, openFirstUseTutorial, recordTutorialVisit, reserveFirstTutorial } from "@/lib/first-use-tutorial";
import styles from "./FirstUseTutorial.module.css";

const steps = [
  { tag: "일 맡기기", title: "하고 싶은 일을 채팅으로 말해 주세요", description: "역할부터 고르지 않아도 됩니다. 원하는 결과와 필요한 자료를 알려 주세요.", example: "이번 주 회의 메모를 업무·담당자·기한으로 정리해줘.", tip: "처음에는 작은 업무 하나부터 시작해 보세요." },
  { tag: "필요한 연결", title: "쓸 AI와 업무 도구만 연결하세요", description: "설정에서 AI를 연결하고, 메일이나 캘린더는 필요할 때 추가하세요. 연결이나 권한이 필요한 작업은 먼저 준비해야 합니다.", example: "설정 → AI 연결 설정\n채팅의 모델 선택 · 사이드의 AI 사용량", tip: "제공자가 알려주지 않는 잔여 사용량은 확인할 수 없다고 표시합니다." },
  { tag: "결과 확인", title: "진행 상태와 결과를 확인하세요", description: "답변 아래의 저장 기능으로 결과를 보관하세요. 메일 발송이나 일정 등록처럼 중요한 작업은 내용과 대상을 확인하고 승인하세요.", example: "요청 → 진행 확인 → 결과 검토 → 저장", tip: "설치된 스킬은 채팅의 스킬 메뉴에서 찾아볼 수 있습니다. 추가 도구가 필요한 스킬은 별도로 표시합니다." },
  { tag: "이어 하기", title: "여러 업무도 이어서 할 수 있어요", description: "프로젝트와 대화 목록에서 하던 일을 다시 여세요. 마스터크루에서는 예약 업무와 실행 상태를 확인할 수 있습니다.", example: "프로젝트·대화 목록 → 하던 일 이어가기\n마스터크루 → 예약·실행 상태 확인", tip: "PC가 꺼져도 실행되는지는 각 기능의 실행 조건을 확인하세요." },
];

export default function FirstUseTutorial({ autoStart = false }: { autoStart?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const automatic = useRef(false);
  const [step, setStep] = useState(0);
  const [storageNotice, setStorageNotice] = useState(false);

  useEffect(() => {
    const show = (isAutomatic: boolean) => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.open) return;
      if (isAutomatic && (document.querySelector("dialog[open]") || !reserveFirstTutorial())) return;
      automatic.current = isAutomatic;
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setStep(0);
      setStorageNotice(!isAutomatic && !recordTutorialVisit("opened"));
      dialog.showModal();
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
    };
    const manual = () => show(false);
    const otherWindow = (event: StorageEvent) => {
      if (event.key === FIRST_USE_TUTORIAL_KEY && event.newValue && automatic.current) dialogRef.current?.close();
    };
    window.addEventListener(FIRST_USE_TUTORIAL_EVENT, manual);
    window.addEventListener("storage", otherWindow);
    const frame = autoStart ? requestAnimationFrame(() => show(true)) : null;
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener(FIRST_USE_TUTORIAL_EVENT, manual);
      window.removeEventListener("storage", otherWindow);
      dialogRef.current?.close();
    };
  }, [autoStart]);

  useEffect(() => {
    if (dialogRef.current?.open) headingRef.current?.focus({ preventScroll: true });
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [step]);

  function dismiss(outcome: "skipped" | "completed") {
    recordTutorialVisit(outcome);
    dialogRef.current?.close();
  }
  const current = steps[step];
  return <dialog ref={dialogRef} className={styles.dialog} aria-label="처음 사용 안내" aria-describedby="first-use-description"
    onCancel={event => { event.preventDefault(); dismiss("skipped"); }}
    onClose={() => { if (previousFocus.current?.isConnected) previousFocus.current.focus(); }}>
    <header className={styles.header}>
      <span className={styles.eyebrow}>모디크루 시작하기 · 약 1분</span>
      <button type="button" className={styles.close} aria-label="튜토리얼 닫기" onClick={() => dismiss("skipped")}>×</button>
    </header>
    <div ref={bodyRef} className={styles.body}>
    <div className={styles.progress} aria-label={`사용 안내 ${step + 1}/${steps.length}단계`}>
      {steps.map((item, index) => <span key={item.tag} data-active={index <= step} aria-hidden="true" />)}
    </div>
    <p className={styles.step}>{step + 1} / {steps.length} · {current.tag}</p>
    <h2 ref={headingRef} tabIndex={-1}>{current.title}</h2>
    <p id="first-use-description" className={styles.description}>{current.description}</p>
    <div className={styles.example}><span>{step === 0 ? "이렇게 요청해 보세요" : "어디서 볼 수 있나요?"}</span><p>{current.example}</p></div>
    <p className={styles.tip}>{current.tip}</p>
    <p className={styles.note}>닫거나 건너뛰면 다시 자동으로 나타나지 않습니다. 설정에서 언제든 다시 볼 수 있어요.</p>
    {storageNotice && <p className={styles.notice} role="status">이 환경에서는 안내 표시 설정을 저장할 수 없습니다. 자동 안내는 띄우지 않으며, 설정에서 다시 볼 수 있습니다.</p>}
    </div>
    <footer className={styles.footer}>
      <button type="button" className={styles.skip} onClick={() => dismiss("skipped")}>건너뛰기</button>
      <div className={styles.actions}>
        {step > 0 && <button type="button" onClick={() => setStep(value => Math.max(0, value - 1))}>이전</button>}
        <button type="button" className={styles.primary} onClick={() => step === steps.length - 1 ? dismiss("completed") : setStep(value => Math.min(steps.length - 1, value + 1))}>{step === steps.length - 1 ? "안내 마치기" : "다음"}</button>
      </div>
    </footer>
  </dialog>;
}

export function TutorialSettings() {
  return <section className={styles.settings} aria-label="처음 사용 안내 설정">
    <div><strong>처음 사용 안내</strong><p>이 기기에서 처음 한 번만 표시합니다. 안내를 닫아도 나중에 다시 볼 수 있어요.</p></div>
    <button type="button" onClick={openFirstUseTutorial}>튜토리얼 다시 보기</button>
    <FirstUseTutorial />
  </section>;
}
