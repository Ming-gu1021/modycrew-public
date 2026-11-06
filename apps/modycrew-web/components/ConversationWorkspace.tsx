"use client";

import { Children, Fragment, isValidElement, useRef, type ReactNode } from "react";

import CrewAvatar, { type CrewAvatarRole } from "./CrewAvatar";
import styles from "./ConversationWorkspace.module.css";

export interface ConversationContextProps {
  name: string;
  role: string;
  avatarId?: string;
  status: string;
  detail?: string;
  resultPreview?: string;
  onFocusComposer: () => void;
  onViewResult?: () => void;
  onOpenApproval?: () => void;
  onOpenCrewSettings: () => void;
  expanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
  /** Master crew reads the request and hands it to the matching crew; a specialist handles it directly. */
  assignmentMode?: "auto" | "direct";
  assigneeOptions?: Array<{ id: string; name: string; role: string; master?: boolean }>;
  currentAssigneeId?: string;
  assigneeLocked?: boolean;
  onChangeAssignee?: (teammateId: string) => void;
}

function avatarRole(role: string): CrewAvatarRole {
  if (/메일|mail/i.test(role)) return "mail";
  if (/승인|approval/i.test(role)) return "approval";
  if (/자료|파일|file/i.test(role)) return "file";
  return "doc";
}

function DisclosureChevron() {
  return (
    <svg className={styles.chevron} width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ConversationContext({
  name,
  role,
  avatarId,
  status,
  detail,
  resultPreview,
  onFocusComposer,
  onViewResult,
  onOpenApproval,
  onOpenCrewSettings,
  expanded,
  onExpandedChange,
  assignmentMode,
  assigneeOptions,
  currentAssigneeId,
  assigneeLocked,
  onChangeAssignee,
}: ConversationContextProps) {
  const auto = assignmentMode === "auto";
  return (
    <details
      className={styles.context}
      data-conversation-context="crew-work"
      data-assignment-mode={assignmentMode}
      open={expanded}
      onToggle={(event) => onExpandedChange?.(event.currentTarget.open)}
    >
      <summary className={styles.contextSummary}>
        <CrewAvatar role={avatarRole(role)} avatarId={avatarId} size="compact" className={styles.avatar} />
        <span className={styles.identity}>
          <span className={styles.eyebrow}>{auto ? "담당 · 자동 배정" : "담당 크루"}</span>
          <span className={styles.identityLine}>
            <strong>{name}</strong>
            {status.trim() ? <span className={styles.status}>{status}</span> : null}
          </span>
        </span>
        <DisclosureChevron />
      </summary>
      <div className={styles.contextBody}>
        <p className={styles.role}>{auto ? "요청 내용을 읽고 메일·문서·개발·운영 등 알맞은 크루에게 나눠 맡깁니다. 직접 지정하려면 담당을 바꾸세요." : role.trim() ? `${role} · 이 대화의 일은 ${name}이(가) 직접 처리합니다.` : `이 대화의 일은 ${name}이(가) 직접 처리합니다.`}</p>
        {assigneeOptions && assigneeOptions.length > 1 && onChangeAssignee ? (
          <label className={styles.assigneePicker}>
            <span>담당 바꾸기</span>
            <select
              aria-label="이 대화의 담당 크루"
              value={currentAssigneeId ?? ""}
              disabled={assigneeLocked}
              onChange={(event) => onChangeAssignee(event.target.value)}
            >
              {assigneeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.master ? `${option.name} · 자동 배정` : `${option.name} · ${option.role || "담당 크루"}`}
                </option>
              ))}
            </select>
            {assigneeLocked ? <small>진행 중인 일이 끝나면 바꿀 수 있습니다.</small> : null}
          </label>
        ) : null}
        {detail?.trim() ? <p className={styles.detail}>{detail}</p> : null}
        {resultPreview?.trim() ? (
          <div className={styles.resultPreview}>
            <span className={styles.eyebrow}>최근 결과</span>
            <p>{resultPreview}</p>
          </div>
        ) : null}
        <div className={styles.contextActions}>
          <button className={styles.primaryAction} type="button" onClick={onFocusComposer}>업무 맡기기</button>
          {onViewResult ? <button type="button" onClick={onViewResult}>대화에서 결과 보기</button> : null}
          {onOpenApproval ? <button type="button" onClick={onOpenApproval}>승인 대기 확인</button> : null}
          <button type="button" onClick={onOpenCrewSettings}>크루 설정</button>
        </div>
      </div>
    </details>
  );
}

export interface ConversationDestinationsProps {
  onHome: () => void;
  onMail: () => void;
  onDocument: () => void;
  onCalendar: () => void;
  onConnectMail?: () => void;
  onSettings: () => void;
}

export function ConversationDestinations({
  onHome,
  onMail,
  onDocument,
  onCalendar,
  onConnectMail,
  onSettings,
}: ConversationDestinationsProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const runDestination = (action: () => void) => {
    if (menuRef.current) menuRef.current.open = false;
    action();
  };

  return (
    <nav className={styles.destinations} aria-label="다음에 할 수 있는 일">
      <button type="button" data-chat-destination="home" onClick={() => runDestination(onHome)}>처음 화면</button>
      <details ref={menuRef} className={styles.destinationMenu}>
        <summary>업무 메뉴<DisclosureChevron /></summary>
        <div className={styles.destinationPanel}>
          <button type="button" data-chat-destination="mail" onClick={() => runDestination(onMail)}>메일 점검</button>
          <button type="button" data-chat-destination="document" onClick={() => runDestination(onDocument)}>문서 정리</button>
          <button type="button" data-chat-destination="calendar" onClick={() => runDestination(onCalendar)}>일정 준비</button>
          {onConnectMail ? <button type="button" data-chat-destination="connect-mail" onClick={() => runDestination(onConnectMail)}>메일 연결</button> : null}
          <button type="button" onClick={() => runDestination(onSettings)}>설정</button>
        </div>
      </details>
    </nav>
  );
}

export interface MessageActionDisclosureProps {
  children: ReactNode;
  secondary?: ReactNode;
  primaryCount?: number;
}

function collectActions(children: ReactNode, prefix = "action"): ReactNode[] {
  return Children.toArray(children).flatMap<ReactNode>((child, index) => {
    if (typeof child === "string" && !child.trim()) return [];
    const key = `${prefix}/${isValidElement(child) ? child.key : index}`;
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      return collectActions(child.props.children, key);
    }
    return [<Fragment key={key}>{child}</Fragment>];
  });
}

export function MessageActionDisclosure({ children, secondary, primaryCount = 2 }: MessageActionDisclosureProps) {
  const actions = collectActions(children);
  const visibleCount = Number.isFinite(primaryCount) ? Math.max(0, Math.floor(primaryCount)) : 2;
  const primaryActions = actions.slice(0, visibleCount);
  const additionalActions = [...actions.slice(visibleCount), ...collectActions(secondary, "secondary")];
  if (!primaryActions.length && !additionalActions.length) return null;

  return (
    <div className={styles.messageActions} data-message-actions="progressive">
      {primaryActions.length ? <div className={styles.primaryActions}>{primaryActions}</div> : null}
      {additionalActions.length ? (
        <details className={styles.messageMenu}>
          <summary>답변 메뉴<DisclosureChevron /></summary>
          <div className={styles.additionalActions}>{additionalActions}</div>
        </details>
      ) : null}
    </div>
  );
}
