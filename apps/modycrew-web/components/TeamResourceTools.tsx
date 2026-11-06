"use client";

/**
 * 우리 회사 · 공유 자료 화면의 작은 도구 두 개.
 *
 *  - SafeLinkText: 자료 본문 속 http(s) 링크를 누를 수 있게 하되, 새 창으로 바로 열지 않는다.
 *    "이 링크를 브라우저에서 열까요?"를 보여 주고 확인하면 앱의 안전한 열기 경로로 연다.
 *  - DriveLinkComposer: 설치 앱에서 드라이브 파일을 골라 링크와 한 줄 설명을 공유 자료로 남긴다.
 *    올라갈 제목·본문을 그대로 보여 주고 확인받은 뒤에만 저장한다. 드라이브 권한은 바꾸지 않는다.
 */

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { GoogleDriveFileSummary } from "@/lib/desktop-bridge";
import { copyLink, isDesktopApp, listDriveFilesForSharing } from "@/lib/desktop-links";
import { buildTeamSharePreview, driveLinkShareText, splitShareLinks, TEAM_SHARE_HEADING } from "@/lib/team-share.mjs";
import styles from "./TeamResourceTools.module.css";
import { openWorkBrowserPane } from '@/lib/work-browser';

export function SafeLinkText({ text }: { text: string }) {
  const parts = useMemo(() => splitShareLinks(text), [text]);
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState("");
  const [opening, setOpening] = useState(false);
  const desktop = isDesktopApp();
  const hasLinks = parts.some((part) => part.kind === "link");

  async function open(href: string) {
    setOpening(true);
    try {
      openWorkBrowserPane(href);
      setPending('');setNotice('사이드 패널에서 링크를 열었습니다.');
    } catch {
      setNotice("링크를 열지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      <p>
        {hasLinks
          ? parts.map((part, index) => (part.kind === "text"
            ? <Fragment key={index}>{part.value}</Fragment>
            : <button key={index} type="button" className={styles.link} title={part.href} data-resource-link={part.href} onClick={() => { setPending(part.href); setNotice(""); }}>{part.value}</button>))
          : text}
      </p>
      {pending ? (
        <div className={styles.linkConfirm} role="group" aria-label="링크 열기 확인">
          <p>이 링크를 브라우저에서 열까요?</p>
          <code>{pending}</code>
          <div className={styles.row}>
            {desktop ? <button type="button" className={styles.toolPrimary} disabled={opening} onClick={() => void open(pending)}>{opening ? "여는 중…" : "옆에서 브라우저 열기"}</button> : null}
            <button type="button" onClick={() => void copyLink(pending).then((ok) => setNotice(ok ? "링크를 복사했어요. 브라우저 주소창에 붙여 넣어 주세요." : "복사하지 못했어요. 링크를 직접 선택해 복사해 주세요."))}>링크 복사</button>
            <button type="button" onClick={() => { setPending(""); setNotice(""); }}>닫기</button>
          </div>
          {notice ? <p className={styles.toolHint} role="status">{notice}</p> : null}
        </div>
      ) : notice ? <p className={styles.toolHint} role="status">{notice}</p> : null}
    </>
  );
}

type DriveState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "blocked"; message: string; connectLink: boolean }
  | { kind: "ready"; files: GoogleDriveFileSummary[] };

function driveBlockedMessage(status: string, errorCode: string | undefined, fallback: string) {
  if (status === "google_drive_not_connected" || errorCode === "google_drive_not_connected") return { message: "구글 드라이브가 아직 연결되지 않았어요. 먼저 드라이브를 연결해 주세요.", connectLink: true };
  if (errorCode === "google_drive_reconnect_required") return { message: "드라이브 연결이 만료됐어요. 드라이브를 다시 연결해 주세요.", connectLink: true };
  if (status === "google_drive_client_required") return { message: "이 앱에는 드라이브 연결 설정이 아직 없어요. 관리자에게 문의해 주세요.", connectLink: false };
  if (errorCode === "google_drive_permission_denied") return { message: "드라이브 권한이 부족해 목록을 볼 수 없어요. 드라이브를 다시 연결해 주세요.", connectLink: true };
  return { message: fallback || "드라이브 파일 목록을 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.", connectLink: false };
}

function modifiedLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

/**
 * @param onSave 올라갈 제목·본문(미리보기와 같은 값)을 저장한다. 성공하면 true.
 */
export function DriveLinkComposer({ disabled, destinationLabel, onSave }: { disabled?: boolean; /** 어디로 올라가는지(예: '우리 회사 · 영업팀'). 미리보기에 그대로 보여 준다. */ destinationLabel?: string; onSave: (input: { title: string; text: string }) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [drive, setDrive] = useState<DriveState>({ kind: "idle" });
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<GoogleDriveFileSummary | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isDesktopApp()), []);

  const preview = useMemo(() => (picked ? buildTeamSharePreview({ title: picked.name, text: driveLinkShareText(picked, note) }) : null), [picked, note]);

  async function load(query = search) {
    setDrive({ kind: "loading" });
    try {
      const status = await listDriveFilesForSharing({ kind: "status" });
      if (status.status !== "google_drive_connected") {
        setDrive({ kind: "blocked", ...driveBlockedMessage(status.status, status.errorCode, status.userMessage) });
        return;
      }
      const result = await listDriveFilesForSharing({ kind: "list_recent_files", query: query.trim(), pageSize: 30 });
      if (result.status !== "google_drive_files_loaded") {
        setDrive({ kind: "blocked", ...driveBlockedMessage(result.status, result.errorCode, result.userMessage) });
        return;
      }
      setDrive({ kind: "ready", files: (result.files ?? []).filter((file) => file.webViewLink) });
    } catch {
      setDrive({ kind: "blocked", message: "드라이브 파일 목록을 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.", connectLink: false });
    }
  }

  function close() {
    setOpen(false); setPicked(null); setNote(""); setSearch(""); setDrive({ kind: "idle" });
  }

  async function save() {
    if (!preview?.ready || saving) return;
    setSaving(true);
    try {
      if (await onSave({ title: preview.title, text: preview.text })) close();
    } finally {
      setSaving(false);
    }
  }

  if (!desktop) return null;
  if (!open) {
    return (
      <div className={styles.drive}>
        <button type="button" disabled={disabled} onClick={() => { setOpen(true); void load(""); }} data-drive-link-open>드라이브 파일 연결</button>
        <p className={styles.toolHint}>구글 드라이브 파일의 링크를 팀 자료로 걸어 둘 수 있어요.</p>
      </div>
    );
  }

  return (
    <section className={styles.drive} aria-label="드라이브 파일 연결" data-drive-link-composer="open">
      <h4>드라이브 파일 연결</h4>
      {!picked ? (
        <>
          <form className={styles.row} onSubmit={(event) => { event.preventDefault(); void load(); }}>
            <label className={styles.grow}>파일 이름으로 찾기<input type="search" value={search} maxLength={80} onChange={(event) => setSearch(event.target.value)} placeholder="예: 견적 기준" /></label>
            <button type="submit" disabled={drive.kind === "loading"}>찾기</button>
          </form>
          {drive.kind === "loading" ? <p className={styles.toolHint} role="status">드라이브 파일을 불러오는 중…</p> : null}
          {drive.kind === "blocked" ? <p className={styles.warn} role="status">{drive.message}{drive.connectLink ? <> <Link href="/receipts">드라이브 연결하러 가기</Link></> : null}</p> : null}
          {drive.kind === "ready" ? (
            drive.files.length ? (
              <ul className={styles.files} aria-label="최근 드라이브 파일">
                {drive.files.map((file) => (
                  <li key={file.id}><button type="button" onClick={() => setPicked(file)}><strong>{file.name}</strong><small>{modifiedLabel(file.modifiedTime) ? `${modifiedLabel(file.modifiedTime)} 수정` : ""}</small></button></li>
                ))}
              </ul>
            ) : <p className={styles.toolHint}>조건에 맞는 파일이 없어요. 다른 이름으로 찾아 주세요.</p>
          ) : null}
          <div className={styles.row}><button type="button" onClick={close}>닫기</button></div>
        </>
      ) : (
        <>
          <label>팀에 남길 설명 (선택)<textarea value={note} maxLength={2000} rows={3} onChange={(event) => setNote(event.target.value)} placeholder="예: 9월 견적 기준표, 새 단가 반영본" /></label>
          {preview ? (
            <div className={styles.preview} data-share-preview="exact">
              <p className={styles.previewHeading}>{TEAM_SHARE_HEADING}</p>
              {destinationLabel ? <p className={styles.previewHeading} data-share-destination="team">올라갈 곳: {destinationLabel}</p> : null}
              <strong>{preview.title}</strong>
              <pre>{preview.text}</pre>
            </div>
          ) : null}
          <p className={styles.toolHint}>파일 내용은 올리지 않고 링크만 남겨요. 드라이브 공유 권한은 바뀌지 않으니, 파일을 볼 권한이 없는 팀원은 링크를 열어도 볼 수 없어요.</p>
          <div className={styles.row}>
            <button type="button" className={styles.toolPrimary} disabled={disabled || saving || !preview?.ready} onClick={() => void save()}>{saving ? "올리는 중…" : "이대로 팀에 올리기"}</button>
            <button type="button" disabled={saving} onClick={() => setPicked(null)}>다른 파일 고르기</button>
            <button type="button" disabled={saving} onClick={close}>취소</button>
          </div>
        </>
      )}
    </section>
  );
}
