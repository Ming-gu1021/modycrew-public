"use client";
import { useId, useRef, type ReactNode } from "react";
import { useAnchoredPopover } from "@/lib/use-anchored-popover";
import styles from "./ComposerAddMenu.module.css";
import ChatDataBoundaryNotice from "./ChatDataBoundaryNotice";

export function ComposerAddMenu({ disabled, onFiles, onFolders, onSkills, onConnections }: {
  disabled?: boolean; onFiles: () => void; onFolders: () => void; onSkills: () => void; onConnections: () => void;
}) {
  const id = `composer-add-${useId().replace(/:/g, "")}`;
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const open = useAnchoredPopover(trigger, panel, "above");
  const item = (label: string, detail: string, icon: ReactNode, action: () => void) => <button type="button" disabled={disabled} onClick={() => { panel.current?.hidePopover(); action(); }}><span aria-hidden="true">{icon}</span><span><strong>{label}</strong><small>{detail}</small></span></button>;
  return <>
    <button ref={trigger} className={styles.trigger} type="button" popoverTarget={id} aria-label="파일·스킬·연동 추가" title="파일·스킬·연동 추가" aria-haspopup="dialog" aria-expanded={open} disabled={disabled}>+</button>
    <div ref={panel} id={id} className={styles.panel} popover="auto" role="dialog" aria-label="파일·스킬·연동 추가">
      <header>추가</header>
      {item("파일 추가", "이 대화에 파일 첨부", "⌕", onFiles)}
      {item("폴더 추가", "폴더의 자료 선택", "▱", onFolders)}
      <header>스킬 · 연동 기능</header>
      {item("스킬·플러그인 선택", "Claude·Codex 스킬과 실행 결과", "✦", onSkills)}
      {item("연결 관리", "메일·캘린더 등 연결과 필요한 설정", "⊕", onConnections)}
    </div>
  </>;
}

export function ComposerAccessMenu<T extends string>({ modes, value, onChange, children }: {
  modes: Array<{ id: T; label: string; shortLabel: string; detail: string }>; value: T; onChange: (value: T) => void; children?: ReactNode;
}) {
  const id = `composer-access-${useId().replace(/:/g, "")}`;
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const open = useAnchoredPopover(trigger, panel, "above");
  return <>
    <button ref={trigger} type="button" className={styles.accessTrigger} popoverTarget={id} aria-label="권한 기준 설정" aria-haspopup="menu" aria-expanded={open}><span aria-hidden="true">◇</span>{modes.find(mode => mode.id === value)?.shortLabel}</button>
    <div ref={panel} id={id} popover="auto" role="menu" aria-label="AI 작업 권한 기준" className={styles.panel}>
      <header>액세스 설정</header>
      {modes.map(mode => <button key={mode.id} type="button" role="menuitemradio" aria-checked={value === mode.id} onClick={() => { onChange(mode.id); panel.current?.hidePopover(); }}><span aria-hidden="true">{mode.id === value ? "✓" : "◇"}</span><span><strong>{mode.label}</strong><small>{mode.detail}</small></span></button>)}
      <p className={styles.boundary}>외부 발송·삭제·결제는 설정과 관계없이 확인합니다.</p>
      {children}
      <ChatDataBoundaryNotice />
    </div>
  </>;
}
