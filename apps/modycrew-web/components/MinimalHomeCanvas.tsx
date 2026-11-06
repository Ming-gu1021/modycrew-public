"use client";

import { useId, useRef } from "react";
import type { ClipboardEventHandler, FormEventHandler, ReactNode, Ref } from "react";

import type { AIAlternativeChoice } from "@/lib/home-journey-rules";
import AIAlternativeChooser from "./AIAlternativeChooser";
import BufferedTextarea from "./BufferedTextarea";
import BackgroundWorkStatus from "./BackgroundWorkStatus";
import { ComposerAddMenu } from "./ComposerAddMenu";
import ModelPicker, { type ModelChoice } from "./ModelPicker";
import styles from "./MinimalHomeCanvas.module.css";

type MinimalHomeCanvasProps = {
  /**
   * full: 대화 전 첫 화면(사무실 장면 + 입력칸).
   * compact: 오른쪽 패널을 띄웠을 때 가운데가 비지 않도록 보여주는 작은 홈.
   *   사무실 장면·입력칸 없이 빠른 시작 칩과 '업무 이어가기'만 둔다(입력은 아래 기본 입력칸).
   */
  variant?: "full" | "compact";
  office?: ReactNode;
  value: string;
  connected: boolean;
  mailConnected: boolean;
  disabled?: boolean;
  todayCount: number;
  runningCount: number;
  approvalCount: number;
  onValueChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  inputRef?: Ref<HTMLTextAreaElement>;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
                                                     
  onAddFiles?: () => void;
  /** 폴더/드라이브를 골라 안의 자료를 첨부한다. 넷 다 있으면 대화 화면과 같은 '+' 메뉴를 그린다. */
  onAddFolders?: () => void;
  onAddSkills?: () => void;
  onAddConnections?: () => void;
  /** 창 위로 파일을 끌고 들어온 상태. 입력칸을 놓을 자리로 표시한다. */
  dropActive?: boolean;
  attachments?: { id: string; fileName: string }[];
  onRemoveAttachment?: (id: string) => void;
  recentConversations?: { id: string; title: string; updatedLabel: string }[];
  workSummary?: ReactNode;
  assistant?: ReactNode;
  onOpenConversation?: (id: string) => void;
  /** 칩을 눌렀을 때. id 를 함께 주어 호출부가 준비 화면을 열지 대화를 보낼지 정한다. */
  onQuickAction: (prompt: string, id: QuickActionId) => void;
  /** 지금 답할 수 있는·붙일 수 있는 모델 전부. 비어 있으면 고르는 줄을 감춘다. */
  modelChoices?: ModelChoice[];
  /** 지금 답하고 있는 모델 id */
  activeModelId?: string;
  activeModelProvider?: string;
  modelSaving?: boolean;
  modelRefreshing?: boolean;
  onRefreshModels?: () => void;
  notice?: string;
  onDismissNotice?: () => void;
  /** 내 PC 안의 모델을 찾는 중인가 */
  scanningLocalModels?: boolean;
  onSelectModel?: (choice: ModelChoice) => void;
  onSetUpModel?: (choice: ModelChoice) => void;
  onConnect: () => void;
  onConnectMail: () => void;
  onOpenApproval: () => void;
  onOpenSettings: () => void;
  /**
   * 오늘·진행·승인 숫자를 눌렀을 때 갈 곳. 넘기지 않으면 숫자는 그냥 글자로 남는다.
   * 갈 곳이 없는데 누를 수 있게 만드는 것이 이 앱을 망가뜨린 패턴이라,
   * 핸들러가 있을 때만 버튼이 된다.
   */
  onOpenWorkView?: (view: "today" | "running" | "approval") => void;
  /**
   * 고른 업무의 준비 내용. 있으면 첫 화면 안에 준비 카드가 뜬다.
   *
   * 예전에는 이 준비 화면을 보려면 홈이 통째로 옛 화면으로 바뀌었다. 화면이
   * 갑자기 달라지면 사용자가 같은 앱인지 알기 어려워, 준비 내용만 이 화면 안에서
   * 보여준다.
   */
  prep?: MinimalHomePrep | null;
  onPrepStart?: () => void;
  onPrepResolve?: () => void;
  onPrepDismiss?: () => void;
     
                           
    
                                                  
                                                
                                          
     
  connections?: MinimalHomeConnection[];
  onConnectionClick?: (id: string) => void;
  /**
   * GPT 말고 다른 AI 로 연결하는 선택지. 있으면 'GPT 계정 연결' 옆에 '다른 AI로 연결'이 생긴다.
   * 이 PC 에 로그인된 구독 계정(recommended)이 있으면 그것을 첫 버튼으로 권한다.
   */
  aiAlternatives?: AIAlternativeChoice[];
  onChooseAIAlternative?: (id: string) => void;
};

export type MinimalHomeConnection = {
  id: string;
  /** 사람이 읽는 이름. 예: "AI", "메일" */
  label: string;
  connected: boolean;
  /** 연결됐을 때 무엇에 연결됐는지. 예: "Gmail", "회사 메일" */
  detail?: string;
};

export type QuickActionId =
  | "mail"
  | "document"
  | "calendar"
  | "automation"
  | "connect-mail"
  | "approval"
  | "settings";

/** 준비 카드가 보여줄 내용. page.tsx 의 EasySetupPreviewSignal 에서 뽑아 넘긴다. */
export type MinimalHomePrep = {
  label: string;
  /** 무엇이 만들어지는가 */
  preview: string;
  /** 어디서 확인·승인하는가 */
  approval: string;
  /** 실행 전 안전 기준 */
  safety: string;
  /** 연결이 없어 막혀 있으면 그 이유 */
  blockedReason?: string;
  resolveLabel?: string;
  startLabel?: string;
};

/* 업무 시작(프롬프트)과 홈 탈출로(승인·설정)를 한 줄에 합친다 —
   첫 화면에서 막히지 않고 어디로든 갈 수 있어야 한다. */
type QuickAction = {
  id: QuickActionId;
  label: string;
  prompt?: string;
  action?: "connect_mail" | "open_approval" | "open_settings";
};

const quickActions: QuickAction[] = [
  { id: "mail", label: "메일 점검", prompt: "메일 점검해줘" },
  { id: "document", label: "문서 정리", prompt: "문서 정리해줘" },
  { id: "calendar", label: "일정 준비", prompt: "일정 준비해줘" },
  { id: "automation", label: "자동화 만들기", prompt: "자동화 만들기" },
  // 메일 연결 전에만 노출 — 최소 이동 진입점(칩 → 주소·비밀번호 → 연결 확인).
  { id: "connect-mail", label: "메일 연결", action: "connect_mail" },
  { id: "approval", label: "승인", action: "open_approval" },
  { id: "settings", label: "설정", action: "open_settings" },
];


function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5.5 20 12 4 18.5l2.2-5.1L15 12l-8.8-1.4L4 5.5Z" />
    </svg>
  );
}

function ActionIcon({ id }: { id: QuickAction["id"] }) {
  if (id === "automation") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8a7 7 0 0 0-12-3L4 8m0-5v5h5M5 16a7 7 0 0 0 12 3l3-3m0 5v-5h-5" /></svg>;
  }
  if (id === "mail") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
        <path d="m5 7 7 5 7-5" />
      </svg>
    );
  }
  if (id === "connect-mail") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
        <path d="m5 7 7 5 7-5M12 11v6M9.5 14.5h5" />
      </svg>
    );
  }
  if (id === "document") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3.5h8l4 4v13H6z" />
        <path d="M14 3.5v4h4M9 12h6M9 15.5h6" />
      </svg>
    );
  }
  if (id === "approval") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
        <path d="m7.5 12 3 3 6-6.5" />
      </svg>
    );
  }
  if (id === "settings") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2.1 2.1M15.9 15.9 18 18M18 6l-2.1 2.1M8.1 15.9 6 18" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M7.5 3v4M16.5 3v4M3.5 9h17M8 13h2M12 13h2M16 13h1M8 16h2M12 16h2" />
    </svg>
  );
}

export default function MinimalHomeCanvas({
  variant = "full",
  office,
  value,
  connected,
  mailConnected,
  disabled = false,
  todayCount,
  runningCount,
  approvalCount,
  onValueChange,
  onSubmit,
  inputRef,
  onPaste,
  onAddFiles,
  onAddFolders,
  onAddSkills,
  onAddConnections,
  dropActive = false,
  attachments = [],
  onRemoveAttachment,
  recentConversations = [],
  workSummary,
  assistant,
  onOpenConversation,
  onQuickAction,
  onConnect,
  onConnectMail,
  onOpenApproval,
  onOpenSettings,
  onOpenWorkView,
  prep,
  onPrepStart,
  onPrepResolve,
  onPrepDismiss,
  modelChoices,
  activeModelId = "",
  activeModelProvider,
  modelSaving = false,
  modelRefreshing = false,
  onRefreshModels,
  notice,
  onDismissNotice,
  scanningLocalModels = false,
  onSelectModel,
  onSetUpModel,
  connections = [],
  onConnectionClick,
  aiAlternatives = [],
  onChooseAIAlternative,
}: MinimalHomeCanvasProps) {
  const compact = variant === "compact";
  const alternativesPopoverId = `ai-alternatives-${useId().replace(/:/g, "")}`;
  const alternativesPopoverRef = useRef<HTMLDivElement | null>(null);
  const canChooseAlternative = aiAlternatives.length > 0 && Boolean(onChooseAIAlternative);
  const recommendedAlternative = canChooseAlternative ? aiAlternatives.find((choice) => choice.recommended) : undefined;
  // 연결 상태는 긍정문으로 한 줄. AI 가 아직 연결 전이면 바로 아래 연결 안내가 같은 말을 하므로 뺀다.
  const visibleConnections = connections.filter((item) => item.connected || item.id !== "ai" || connected);
  const connectionRow = visibleConnections.length > 0 ? (
    <p className={styles.connections} aria-label="연결 상태" data-home-connections="positive_status_line">
      {visibleConnections.map((item) => {
        const text = item.connected
          ? item.id === "ai"
            ? `${item.label} 연결됨`
            : `${item.label}: ${item.detail ? `${item.detail} ` : ""}연결됨`
          : `${item.label} 연결 전`;
        return onConnectionClick ? (
          <button
            key={item.id}
            type="button"
            onClick={() => onConnectionClick(item.id)}
            disabled={disabled}
            data-connected={item.connected ? "true" : "false"}
            title={item.connected ? `${item.label} 연결 설정 보기` : `${item.label} 연결하기`}
          >
            <i aria-hidden="true" />
            {text}
          </button>
        ) : (
          <span key={item.id} data-connected={item.connected ? "true" : "false"}>
            <i aria-hidden="true" />
            {text}
          </span>
        );
      })}
    </p>
  ) : null;
  const visibleQuickActions = quickActions.filter(
    (action) => action.id !== "connect-mail" || !mailConnected,
  );
  const primaryActions = visibleQuickActions.filter((action) => action.prompt);
  const secondaryActions = visibleQuickActions.filter((action) => action.action);
  const statusEntries = [
    { view: "today" as const, kind: "today", label: "오늘", count: Math.max(todayCount, 0), alert: false },
    { view: "running" as const, kind: "running", label: "진행", count: Math.max(runningCount, 0), alert: false },
    {
      view: "approval" as const,
      kind: "approval",
      label: "승인",
      count: Math.max(approvalCount, 0),
      alert: approvalCount > 0,
    },
  ].filter((entry) => entry.count > 0 && (!workSummary || entry.view === "approval"));

  return (
    <section
      className={styles.home}
      data-minimal-home-canvas={compact ? "compact" : "true"}
      data-variant={variant}
      data-has-office={Boolean(office) && !compact}
      aria-label={compact ? "업무 바로 시작" : "간단 업무 시작 화면"}
    >
      {office && !compact ? <div className={styles.office}>{office}</div> : null}
      <div className={styles.startArea}>
        <header className={styles.intro}>
          <h1>무엇을 도와드릴까요?</h1>
          {/* 작은 홈에는 입력칸이 없어 제목 바로 아래에 둔다. 큰 홈에서는 입력칸을 밀어내지 않게 입력칸 아래에 둔다. */}
          {compact ? connectionRow : null}
        </header>
        {!compact ? <BackgroundWorkStatus compact /> : null}

        {!connected && !compact ? (
          <section
            className={styles.connectionPrompt}
            aria-label="GPT 계정 연결 안내"
            data-gpt-account-before-work="true"
          >
            <p>AI를 연결하면 업무를 시작할 수 있어요.</p>
            <div className={styles.connectionActions}>
              {recommendedAlternative && onChooseAIAlternative ? (
                <button
                  type="button"
                  onClick={() => onChooseAIAlternative(recommendedAlternative.id)}
                  disabled={disabled}
                  data-ai-alternative-primary={recommendedAlternative.id}
                  title={recommendedAlternative.detail}
                >
                  {recommendedAlternative.label}으로 연결
                </button>
              ) : null}
              <button
                type="button"
                onClick={onConnect}
                disabled={disabled}
                data-gpt-primary-action="connect_account"
                data-variant={recommendedAlternative ? "secondary" : undefined}
              >
                GPT 계정 연결
              </button>
              {canChooseAlternative ? (
                <button
                  type="button"
                  popoverTarget={alternativesPopoverId}
                  disabled={disabled}
                  data-variant="secondary"
                  data-ai-alternatives-toggle="home"
                  aria-haspopup="dialog"
                  aria-controls={alternativesPopoverId}
                >
                  다른 AI로 연결
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
        {/* 연결 안내 칸(.connectionPrompt button 규칙) 밖에 두어야 목록 버튼이 파란 기본 버튼으로 칠해지지 않는다. */}
        {!connected && !compact && canChooseAlternative && onChooseAIAlternative ? (
          <div
            id={alternativesPopoverId}
            ref={alternativesPopoverRef}
            popover="auto"
            className={styles.alternativesPopover}
            role="dialog"
            aria-label="다른 AI로 연결"
          >
            <AIAlternativeChooser
              choices={aiAlternatives}
              disabled={disabled}
              intro="ChatGPT 계정이 없어도 괜찮아요. 쓰고 있는 AI로 연결하세요."
              onChoose={(id) => {
                alternativesPopoverRef.current?.hidePopover();
                onChooseAIAlternative(id);
              }}
            />
          </div>
        ) : null}

        {compact ? null : <form className={styles.command} onSubmit={onSubmit} aria-label="첫 업무 입력" data-drag-active={dropActive ? "true" : "false"}>
          {dropActive ? <p className={styles.dropHint} aria-hidden="true">여기에 놓으면 바로 첨부됩니다</p> : null}
          {attachments.length > 0 ? (
            <ul className={styles.attachments} aria-label="첨부 파일">
              {attachments.map((file) => (
                <li key={file.id}>
                  <span>{file.fileName}</span>
                  {onRemoveAttachment ? (
                    <button type="button" onClick={() => onRemoveAttachment(file.id)} disabled={disabled} aria-label={`${file.fileName} 첨부 제거`}>제거</button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <BufferedTextarea
            textareaRef={inputRef}
            value={value}
            onValueChange={onValueChange}
            placeholder="할 일과 원하는 결과를 적어 주세요."
            aria-label="채팅 메시지"
            aria-describedby="home-composer-hint"
            autoComplete="off"
            rows={3}
            onPaste={onPaste}
            canSubmit={(text) => !disabled && Boolean(text.trim() || attachments.length)}
          />
          <div className={styles.commandTools}>
            {onAddFiles && onAddFolders && onAddSkills && onAddConnections ? (
              <ComposerAddMenu disabled={disabled} onFiles={onAddFiles} onFolders={onAddFolders} onSkills={onAddSkills} onConnections={onAddConnections} />
            ) : onAddFiles ? (
              <button type="button" className={styles.addFiles} onClick={onAddFiles} disabled={disabled}>파일 추가</button>
            ) : null}
            {onAddFiles ? <span className={styles.dropTip}>파일을 끌어다 놓아도 돼요</span> : null}
            {modelChoices?.length && onSelectModel && onSetUpModel ? (
              <ModelPicker
                choices={modelChoices}
                activeId={activeModelId}
                activeProvider={activeModelProvider}
                disabled={disabled || modelSaving}
                scanningLocal={scanningLocalModels}
                refreshing={modelRefreshing}
                onRefresh={onRefreshModels}
                onSelect={onSelectModel}
                onSetUp={onSetUpModel}
              />
            ) : null}
            <span id="home-composer-hint" className={styles.inputHint}>Enter로 보내기 · Shift+Enter로 줄바꿈 · 파일은 + 버튼이나 끌어다 놓기로 첨부</span>
            <button className={styles.send} type="submit" disabled={disabled || (!value.trim() && !attachments.length)} aria-label="메시지 보내기" title="보내기 (Enter)">
              <SendIcon />
            </button>
          </div>
        </form>}

        {compact ? null : connectionRow}

        {notice ? <div className={styles.notice} role="status" aria-label="입력 안내"><span>{notice}</span>{onDismissNotice ? <button type="button" onClick={onDismissNotice} aria-label="입력 안내 닫기">닫기</button> : null}</div> : null}

        <nav
          className={styles.quickActions}
          aria-label="빠른 업무 시작"
          data-minimal-home-actions="approval_settings"
        >
          {primaryActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => {
                if (action.prompt) {
                  if (!value.trim() || quickActions.some((item) => item.prompt === value.trim())) {
                    onValueChange(action.prompt);
                  }
                  onQuickAction(action.prompt, action.id);
                }
              }}
              disabled={disabled}
              data-quick-action={action.id}
            >
              <span>
                <ActionIcon id={action.id} />
              </span>
              {action.label}
            </button>
          ))}
          <details className={styles.moreActions}>
            <summary aria-label="추가 메뉴" title="추가 메뉴">···</summary>
            <div className={styles.moreActionsMenu}>
              {secondaryActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={disabled}
                  onClick={(event) => {
                    const menu = event.currentTarget.closest("details");
                    if (menu) menu.open = false;
                    if (action.action === "connect_mail") onConnectMail();
                    else if (action.action === "open_approval") onOpenApproval();
                    else if (action.action === "open_settings") onOpenSettings();
                  }}
                >
                  {action.label}
                  {action.id === "approval" && approvalCount > 0 ? <span>{approvalCount}</span> : null}
                </button>
              ))}
            </div>
          </details>
        </nav>

        {prep ? (
          <section className={styles.prep} aria-label={`${prep.label} 준비`}>
            <header>
              <h3>{prep.label}</h3>
              {onPrepDismiss ? (
                <button type="button" onClick={onPrepDismiss} aria-label="준비 닫기">
                  닫기
                </button>
              ) : null}
            </header>
            {!prep.blockedReason ? <p className={styles.prepSummary}>{prep.preview}</p> : null}
            {prep.blockedReason ? <p className={styles.prepBlocked} role="status">{prep.blockedReason}</p> : null}
            <details className={styles.prepDetails}>
              <summary>상세 보기</summary>
              <dl>
                {prep.blockedReason ? <div><dt>처리 내용</dt><dd>{prep.preview}</dd></div> : null}
                <div><dt>확인하는 곳</dt><dd>{prep.approval}</dd></div>
                <div><dt>실행 전 기준</dt><dd>{prep.safety}</dd></div>
              </dl>
            </details>
            <footer>
              {prep.blockedReason && onPrepResolve ? (
                <button type="button" data-primary="true" onClick={onPrepResolve} disabled={disabled}>
                  {prep.resolveLabel ?? "준비하기"}
                </button>
              ) : onPrepStart ? (
                <button
                  type="button"
                  data-primary="true"
                  onClick={onPrepStart}
                  disabled={disabled || Boolean(prep.blockedReason)}
                >
                  {prep.startLabel ?? "맡기기"}
                </button>
              ) : null}
            </footer>
          </section>
        ) : null}

        {assistant ? <div key="proactive-assistant-slot">{assistant}</div> : null}
        {workSummary ?? (recentConversations.length > 0 && onOpenConversation && !value.trim() && !attachments.length ? (
          <section className={styles.recent} aria-label="최근 대화 이어가기">
            <h2>이어서 할 일</h2>
            <ul>
              {recentConversations.map((conversation) => (
                <li key={conversation.id}>
                  <button type="button" onClick={() => onOpenConversation(conversation.id)} disabled={disabled}>
                    <span>{conversation.title}</span>
                    <small>{conversation.updatedLabel}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null)}
      </div>

      {statusEntries.length > 0 ? <footer className={styles.status} aria-label="오늘 업무 상태">
        {statusEntries.map((entry) =>
          onOpenWorkView ? (
            <button
              key={entry.view}
              type="button"
              onClick={() => onOpenWorkView(entry.view)}
              data-alert={entry.alert ? "true" : "false"}
              aria-label={`${entry.label} 업무 ${entry.count}건 보기`}
            >
              <i data-kind={entry.kind} />
              {entry.label} <strong>{entry.count}</strong>
            </button>
          ) : (
            <span key={entry.view} data-alert={entry.alert ? "true" : "false"}>
              <i data-kind={entry.kind} />
              {entry.label} <strong>{entry.count}</strong>
            </span>
          ),
        )}
      </footer> : null}
    </section>
  );
}
