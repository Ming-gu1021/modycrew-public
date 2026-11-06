"use client";

/**
 * [팀에 공유] — 보고서·문서·메일·회사 운영 결과를 '우리 회사'의 팀 공유 자료로 올린다.
 *
 * 약속:
 *  - 회사 소속이 없으면 버튼 자체가 보이지 않는다.
 *  - 올리기 전에 "이 내용이 팀 공유 자료로 올라갑니다" 아래에 올라갈 제목·본문·알림 한 줄을
 *    그대로 보여 주고, [이대로 팀에 올리기]를 눌러야만 올린다. 자동으로 올리는 일은 없다.
 *  - 메일처럼 남이 쓴 글은 제목과 앞부분만 기본으로 담고, 더 넣는 것은 미리보기를 본 뒤 고른다.
 *
 * 화면에 버튼이 여러 개 있어도 소속 회사 목록은 한 번만 구독한다(아래 공유 저장소).
 */

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { onAuthSession, type ModyAuthSession } from "@/lib/firebase-client";
import { shareToTeam, subscribeCompanyMemberships, subscribeCompanyTeams } from "@/lib/company-client";
import type { CompanyMembership, CompanyTeam } from "@/lib/company-types";
import { navigateInternalPath } from "@/lib/safe-navigation";
import {
  buildTeamSharePreview, chooseShareCompany, describeShareRedactions, readLastShareTarget, rememberShareTarget,
  shareableTeams, TEAM_SHARE_HEADING, TEAM_SHARE_TITLE_MAX, type TeamShareContent,
} from "@/lib/team-share.mjs";
import styles from "./ShareToTeamButton.module.css";

type MembershipSnapshot = { session: ModyAuthSession | null; memberships: CompanyMembership[]; loaded: boolean };

const EMPTY_SNAPSHOT: MembershipSnapshot = { session: null, memberships: [], loaded: false };
let membershipSnapshot = EMPTY_SNAPSHOT;
const membershipListeners = new Set<() => void>();
let membershipConsumers = 0;
let membershipGeneration = 0;
let stopAuthWatch: (() => void) | undefined;
let stopMembershipWatch: (() => void) | undefined;

function publishMemberships(next: MembershipSnapshot) {
  membershipSnapshot = next;
  membershipListeners.forEach((listener) => listener());
}

function startMembershipWatch() {
  const generation = ++membershipGeneration;
  let authTick = 0;
  const live = (tick: number) => generation === membershipGeneration && tick === authTick;
  void onAuthSession((session) => {
    if (generation !== membershipGeneration) return;
    const tick = ++authTick;
    stopMembershipWatch?.();
    stopMembershipWatch = undefined;
    if (!session) {
      publishMemberships({ session: null, memberships: [], loaded: true });
      return;
    }
    publishMemberships({ session, memberships: [], loaded: false });
    const settleEmpty = () => { if (live(tick)) publishMemberships({ session, memberships: [], loaded: true }); };
    void subscribeCompanyMemberships(session, (rows) => {
      if (live(tick)) publishMemberships({ session, memberships: rows.filter((row) => row.status === "active"), loaded: true });
    }, settleEmpty)
      .then((stop) => { if (live(tick)) stopMembershipWatch = stop; else stop(); })
      .catch(settleEmpty);
  })
    .then((stop) => { if (generation === membershipGeneration) stopAuthWatch = stop; else stop(); })
    .catch(() => { if (generation === membershipGeneration) publishMemberships({ session: null, memberships: [], loaded: true }); });
}

function stopMembershipWatchAll() {
  membershipGeneration += 1;
  stopMembershipWatch?.();
  stopAuthWatch?.();
  stopMembershipWatch = undefined;
  stopAuthWatch = undefined;
  membershipSnapshot = EMPTY_SNAPSHOT;
}

function subscribeMembershipStore(listener: () => void) {
  membershipListeners.add(listener);
  membershipConsumers += 1;
  if (membershipConsumers === 1) startMembershipWatch();
  return () => {
    membershipListeners.delete(listener);
    membershipConsumers -= 1;
    if (membershipConsumers === 0) stopMembershipWatchAll();
  };
}

/** 로그인한 계정의 소속 회사(활성). 여러 화면이 같이 써도 구독은 하나다. */
export function useTeamShareMemberships(): MembershipSnapshot {
  return useSyncExternalStore(subscribeMembershipStore, () => membershipSnapshot, () => EMPTY_SNAPSHOT);
}

export type TeamShareSource = "report" | "document" | "mail" | "automation" | "record";

export type ShareToTeamButtonProps = {
  source: TeamShareSource;
  title?: string;
  text?: string;
  /** 남이 쓴 글·긴 자료에서 "더 넣기"를 골랐을 때 쓸 본문. 기본으로는 쓰지 않는다. */
  fullText?: string;
  /** 누르는 순간 내용을 읽어 와야 할 때(최근 문서, 회사 자료). */
  resolveContent?: () => Promise<TeamShareContent | null>;
  label?: string;
  className?: string;
  disabled?: boolean;
};

const sourceHints: Record<TeamShareSource, string> = {
  report: "보고서 글을 그대로 올려요.",
  document: "문서 내용을 글로 옮겨 올려요. 파일 자체는 올리지 않아요.",
  mail: "남이 보낸 메일이라 제목과 앞부분만 담았어요.",
  automation: "회사 운영에서 정리한 결과를 올려요.",
  record: "회사 자료의 앞부분을 올려요. 원본 파일은 올리지 않아요.",
};

function safeStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function shareErrorText(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (/permission-denied|insufficient permissions|permission denied/iu.test(`${code} ${message}`)) return "이 팀에 자료를 올릴 권한이 없어요. 회사 관리자에게 팀 참여를 확인해 주세요.";
  if (/unavailable|network|failed to fetch|offline/iu.test(`${code} ${message}`)) return "회사에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.";
  return message || "올리지 못했어요. 잠시 뒤 다시 눌러 주세요.";
}

export default function ShareToTeamButton(props: ShareToTeamButtonProps) {
  const { session, memberships, loaded } = useTeamShareMemberships();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!loaded || !session || !memberships.length) return null;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={props.className ?? styles.trigger}
        onClick={() => setOpen(true)}
        disabled={props.disabled}
        aria-haspopup="dialog"
        data-share-to-team={props.source}
      >
        {props.label ?? "팀에 공유"}
      </button>
      {open ? (
        <ShareToTeamDialog
          {...props}
          session={session}
          memberships={memberships}
          onClose={() => {
            setOpen(false);
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
        />
      ) : null}
    </>
  );
}

type DialogProps = ShareToTeamButtonProps & { session: ModyAuthSession; memberships: CompanyMembership[]; onClose: () => void };
type Phase = { kind: "idle" } | { kind: "sending" } | { kind: "done"; companyId: string; teamId: string; teamName: string; note: string } | { kind: "error"; message: string };

function ShareToTeamDialog({ source, title, text, fullText, resolveContent, session, memberships, onClose }: DialogProps) {
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<TeamShareContent | null>(() => (resolveContent ? null : { title: title ?? "", text: text ?? "", ...(fullText ? { fullText } : {}) }));
  const [loadError, setLoadError] = useState("");
  const lastTarget = useMemo(() => readLastShareTarget(safeStorage(), session.uid), [session.uid]);
  const [companyId, setCompanyId] = useState(() => chooseShareCompany(memberships, lastTarget));
  const [teams, setTeams] = useState<CompanyTeam[] | null>(null);
  const [teamId, setTeamId] = useState("");
  const [editedTitle, setEditedTitle] = useState<string | null>(null);
  const [includeFull, setIncludeFull] = useState(false);
  const [announce, setAnnounce] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const sending = phase.kind === "sending";

  useEffect(() => {
    if (!resolveContent) return;
    let alive = true;
    resolveContent()
      .then((value) => {
        if (!alive) return;
        if (value && value.text.trim()) setContent(value);
        else setLoadError("올릴 내용을 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.");
      })
      .catch(() => { if (alive) setLoadError("올릴 내용을 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요."); });
    return () => { alive = false; };
    // 열릴 때 한 번만 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    let stop: (() => void) | undefined;
    setTeams(null);
    void subscribeCompanyTeams(session, companyId, (rows) => {
      if (!alive) return;
      const usable = shareableTeams(rows, session.uid);
      setTeams(usable);
      setTeamId((current) => {
        if (usable.some((team) => team.id === current)) return current;
        if (lastTarget?.companyId === companyId && usable.some((team) => team.id === lastTarget.teamId)) return lastTarget.teamId;
        return usable[0]?.id ?? "";
      });
    }, (error) => { if (alive) { setTeams([]); setPhase({ kind: "error", message: shareErrorText(error) }); } })
      .then((unsubscribe) => { if (alive) stop = unsubscribe; else unsubscribe(); })
      .catch((error) => { if (alive) { setTeams([]); setPhase({ kind: "error", message: shareErrorText(error) }); } });
    return () => { alive = false; stop?.(); };
  }, [companyId, session, lastTarget]);

  const finished = phase.kind === "done";
  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>("[data-share-autofocus]");
    (first ?? dialogRef.current)?.focus();
  }, [finished]);

  const baseTitle = editedTitle ?? content?.title ?? "";
  const body = includeFull && content?.fullText ? content.fullText : content?.text ?? "";
  const preview = useMemo(() => buildTeamSharePreview({ title: baseTitle, text: body }), [baseTitle, body]);
  const team = teams?.find((item) => item.id === teamId);
  const company = memberships.find((item) => item.companyId === companyId);
  const canSend = Boolean(content && preview.ready && team && !sending && phase.kind !== "done");

  async function confirm() {
    if (!canSend || !team) return;
    const target = { companyId, teamId: team.id, teamName: team.name };
    setPhase({ kind: "sending" });
    try {
      const result = await shareToTeam(session, target.companyId, target.teamId, {
        title: preview.title,
        text: preview.text,
        ...(announce ? { announcement: preview.announcement } : {}),
      });
      rememberShareTarget(safeStorage(), session.uid, { companyId: target.companyId, teamId: target.teamId });
      setPhase({ kind: "done", ...target, note: announce && !result.announced ? "자료는 올렸지만 팀 대화 알림은 보내지 못했어요." : "" });
    } catch (error) {
      setPhase({ kind: "error", message: shareErrorText(error) });
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !sending) {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  const redactionLabel = describeShareRedactions(preview.redactionCategories);
  const fullLabel = source === "mail" ? "메일 미리보기 전체 넣기" : "읽은 본문 전체 넣기";

  const dialog = (
    <div className={styles.scrim} data-share-to-team-dialog="open">
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className={styles.header}>
          <h2 id={headingId}>팀에 공유</h2>
          <button type="button" className={styles.close} onClick={onClose} disabled={sending} aria-label="팀 공유 닫기">닫기</button>
        </header>

        {phase.kind === "done" ? (
          <div className={styles.done} role="status">
            <p><strong>‘{phase.teamName}’의 공유 자료에 올렸어요.</strong></p>
            {phase.note ? <p className={styles.warn}>{phase.note}</p> : null}
            <p className={styles.hint}>팀원과 회사 AI가 이 자료를 참고할 수 있어요. 고치거나 지우는 것은 우리 회사 화면에서 할 수 있어요.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} data-share-autofocus onClick={() => navigateInternalPath(`/company?company=${encodeURIComponent(phase.companyId)}&team=${encodeURIComponent(phase.teamId)}&tab=resources`)}>우리 회사에서 보기</button>
              <button type="button" onClick={onClose}>닫기</button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.fields}>
              {memberships.length > 1 ? (
                <label>회사<select aria-label="공유할 회사" value={companyId} onChange={(event) => { setCompanyId(event.target.value); setTeamId(""); }} disabled={sending} data-share-autofocus>
                  {memberships.map((item) => <option key={item.companyId} value={item.companyId}>{item.companyName}</option>)}
                </select></label>
              ) : null}
              <label>팀<select aria-label="공유할 팀" value={teamId} onChange={(event) => setTeamId(event.target.value)} disabled={sending || !teams?.length} {...(memberships.length > 1 ? {} : { "data-share-autofocus": true })}>
                {teams === null ? <option value="">팀을 불러오는 중…</option> : !teams.length ? <option value="">올릴 수 있는 팀이 없어요</option> : teams.map((item) => <option key={item.id} value={item.id}>{item.name}{item.visibility === "private" ? " · 지정 멤버" : ""}</option>)}
              </select></label>
              <label className={styles.wide}>자료 제목<input value={baseTitle} maxLength={TEAM_SHARE_TITLE_MAX} onChange={(event) => setEditedTitle(event.target.value)} disabled={sending || !content} /></label>
            </div>

            {/* 고르는 것은 미리보기 위에 — 고르면 아래 미리보기가 바로 바뀐다. */}
            <div className={styles.options}>
              {content?.fullText ? (
                <label className={styles.check}><input type="checkbox" checked={includeFull} onChange={(event) => setIncludeFull(event.target.checked)} disabled={sending} />{fullLabel}</label>
              ) : null}
              <label className={styles.check}><input type="checkbox" checked={announce} onChange={(event) => setAnnounce(event.target.checked)} disabled={sending} />팀 대화에 한 줄로 알리기</label>
            </div>

            {!content ? (
              <p className={loadError ? styles.warn : styles.hint} role="status">{loadError || "올릴 내용을 읽고 있어요…"}</p>
            ) : (
              <section className={styles.preview} aria-label="올라갈 내용 미리보기" data-share-preview="exact">
                <p className={styles.previewHeading}>{TEAM_SHARE_HEADING}</p>
                <p className={styles.previewTarget}>{company?.companyName || "우리 회사"} · {team?.name || "팀"} · 공유 자료</p>
                <h3 className={styles.previewTitle} data-share-preview-title>{preview.title || "(제목을 적어 주세요)"}</h3>
                <pre className={styles.previewText} data-share-preview-text tabIndex={0}>{preview.text || "(올릴 내용이 없어요)"}</pre>
                {announce && preview.announcement ? <p className={styles.announce}>팀 대화에도 이 한 줄이 올라가요: <q data-share-preview-announcement>{preview.announcement}</q></p> : null}
              </section>
            )}

            {content ? (
              <ul className={styles.facts}>
                <li>{preview.characters.toLocaleString("ko-KR")}자 · 올린 사람 이름과 시각이 함께 남아요.</li>
                {preview.redactionCount > 0 ? <li>{redactionLabel} {preview.redactionCount}곳은 가리고 올려요.</li> : null}
                {preview.truncated ? <li>20,000자가 넘어서 뒷부분은 빼고 올려요.</li> : null}
                <li>{includeFull && content.fullText ? "고른 대로 전체를 담았어요. 원문과 첨부파일은 올리지 않아요." : sourceHints[source]}</li>
                <li>이 팀 사람은 모두 볼 수 있고, 회사 AI도 답할 때 참고해요.</li>
              </ul>
            ) : null}

            <div className={styles.actions}>
              {phase.kind === "error" ? <p className={`${styles.warn} ${styles.fullRow}`} role="alert">{phase.message}</p> : null}
              <button type="button" className={styles.primary} onClick={() => void confirm()} disabled={!canSend} data-share-confirm>
                {sending ? "올리는 중…" : "이대로 팀에 올리기"}
              </button>
              <button type="button" onClick={onClose} disabled={sending}>취소</button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
