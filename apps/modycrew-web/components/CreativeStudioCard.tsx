"use client";
/**
 * 이미지 스튜디오 카드 — 대화 안에서 '그리는 중인 모습'과 완성된 이미지를 보여 준다.
 *
 * 두 가지로 쓴다.
 * - 진행 카드(threadId 또는 jobIds): 대화 아래에서 그리는 중·연결 중·실패처럼 지금 볼 일이 있는 작업을 보여 준다.
 *   완성된 작업은 기본으로 숨긴다 — 완성된 이미지는 그 답변 말풍선 안(결과 폴더 카드)에 남아야
 *   앱을 다시 열어도 같은 자리에서 보이고, 같은 이미지가 두 번 보이지 않는다(includeCompleted 로 바꿀 수 있다).
 * - 결과 카드(folders): 답변에 적힌 결과 폴더의 이미지를 보여 준다.
 * - 진행 중에는 칸마다 반짝이는 자리 표시를 두고, 완성된 장부터 이미지로 바뀐다(움직임 줄이기 설정을 따른다).
 * - 이미지는 데스크톱이 결과 폴더 안의 파일만 data URL 로 돌려준다. 화면이 임의 경로를 읽지 못한다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CREATIVE_STUDIO_EVENT, creativeStudio, creativeStudioCrewLabel, emitCreativeStudioJob, isCreativeStudioActive,
  type CreativeStudioFile, type CreativeStudioJob,
} from "@/lib/creative-studio";
import styles from "./CreativeStudioCard.module.css";

const statusLabels: Record<string, string> = {
  queued: "준비 중", connecting: "GPT 연결 중", generating: "그리는 중", saving: "저장 중",
  completed: "완성", failed: "만들지 못함", cancelled: "멈춤", needs_connection: "연결 필요",
};

const fileKindLabels: Record<string, string> = {
  web: "웹 페이지", document: "문서", media: "영상·소리", image: "이미지", code: "코드", archive: "압축", file: "파일",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + "KB";
  return (bytes / 1024 / 1024).toFixed(1) + "MB";
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes ? minutes + "분 " + (seconds % 60) + "초" : seconds + "초";
}

function newRequestId(): string {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return typeof cryptoLike?.randomUUID === "function" ? cryptoLike.randomUUID() : "studio-" + Date.now().toString(36);
}

function usePreviews(files: CreativeStudioFile[]) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const key = files.map((file) => file.path).join("|");
  useEffect(() => {
    let alive = true;
    for (const file of files) {
      void creativeStudio({ kind: "preview", path: file.path }).then((result) => {
        if (alive && result.dataUrl) setPreviews((prev) => (prev[file.path] ? prev : { ...prev, [file.path]: result.dataUrl! }));
      });
    }
    return () => { alive = false; };
    // 파일 목록이 바뀔 때만 다시 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return previews;
}

function ImageGrid({ files, count, aspect, active, title, onOpen }: { files: CreativeStudioFile[]; count: number; aspect: string; active: boolean; title: string; onOpen: (path: string) => void }) {
  const previews = usePreviews(files);
  const slots = Math.max(active ? count || 1 : 0, files.length);
  if (!slots) return null;
  return <div className={styles.grid} data-aspect={aspect}>
    {Array.from({ length: slots }, (_, index) => {
      const file = files[index];
      if (file) {
        return <button key={file.path} type="button" className={styles.image} onClick={() => onOpen(file.path)} title={file.name + " 크게 보기"} aria-label={title + " " + (index + 1) + "번째 이미지 크게 보기"}>
          {previews[file.path]
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={previews[file.path]} alt={title + " " + (index + 1)} />
            : <span className={styles.loading}>불러오는 중</span>}
        </button>;
      }
      return <div key={"slot-" + index} className={styles.placeholder} aria-hidden="true"><span>{index === files.length ? "그리는 중" : "순서 대기"}</span></div>;
    })}
  </div>;
}

function JobCard({ job, onRetry }: { job: CreativeStudioJob; onRetry: (job: CreativeStudioJob) => void }) {
  const active = isCreativeStudioActive(job);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  const startedMs = Date.parse(job.startedAt) || now;
  const endMs = active ? now : Date.parse(job.finishedAt || "") || now;
  const elapsed = Math.max(0, Math.round((endMs - startedMs) / 1_000));
  async function open(target: string) {
    setMessage("");
    const result = await creativeStudio({ kind: "open", path: target, jobId: job.id });
    if (result.status !== "opened") setMessage(result.userMessage || "열지 못했습니다.");
  }
  async function cancel() {
    const result = await creativeStudio({ kind: "cancel", jobId: job.id });
    if (result.job) emitCreativeStudioJob(result.job);
  }
  async function connect() {
    const result = await creativeStudio({ kind: "connect" });
    setMessage(result.userMessage || "");
  }
  return <section className={styles.card} data-status={job.status} aria-label={(job.crewLabel || creativeStudioCrewLabel) + " 이미지 작업 · " + job.title}>
    <header>
      <span className={styles.badge}>{job.crewLabel || creativeStudioCrewLabel}</span>
      <strong>{job.title}</strong>
      <span className={styles.status} data-status={job.status}>{(statusLabels[job.status] ?? job.status) + " · " + formatElapsed(elapsed)}</span>
    </header>
    <p className={styles.detail} role="status" aria-live="polite">{job.detail}</p>
    <ImageGrid files={job.files} count={job.count} aspect={job.aspect} active={active} title={job.title} onOpen={(path) => void open(path)} />
    <footer>
      {job.folder ? <span className={styles.folder} title={job.folder}>저장 위치 · {job.folder}</span> : <span className={styles.folder}>저장 위치는 모디크루가 자동으로 만듭니다</span>}
      <div className={styles.actions}>
        {job.folder && <button type="button" onClick={() => void open(job.folder)}>결과 폴더 열기</button>}
        {active && <button type="button" onClick={() => void cancel()}>멈추기</button>}
        {job.status === "needs_connection" && <button type="button" onClick={() => void connect()}>GPT 연결</button>}
        {!active && job.status !== "completed" && <button type="button" onClick={() => onRetry(job)}>다시 만들기</button>}
      </div>
    </footer>
    {message && <p className={styles.message} role="alert">{message}</p>}
  </section>;
}

   
                                                                           
                                                                               
   
function FolderCard({ folder }: { folder: string }) {
  const [files, setFiles] = useState<CreativeStudioFile[] | null>(null);
  const [otherFiles, setOtherFiles] = useState<CreativeStudioFile[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let alive = true;
    void creativeStudio({ kind: "folder", path: folder }).then((result) => {
      if (!alive) return;
      if (result.files) { setFiles(result.files); setOtherFiles(result.otherFiles ?? []); } else { setFiles([]); setMessage(result.userMessage); }
    });
    return () => { alive = false; };
  }, [folder]);
  if (!files) return null;
  if (!files.length && !otherFiles.length) return message ? <p className={styles.message}>{message}</p> : null;
  const parts = folder.split(/[\\/]/u).filter(Boolean);
  const title = parts[parts.length - 1] || "결과";
  const category = parts[parts.length - 2] || "";
  const badge = !category || category === "이미지" ? creativeStudioCrewLabel : "모디크루 " + category + " 결과";
  async function open(target: string) {
    const result = await creativeStudio({ kind: "open", path: target });
    if (result.status !== "opened") setMessage(result.userMessage || "열지 못했습니다.");
  }
  return <section className={styles.card} data-status="completed" aria-label={(category || "이미지") + " 결과 · " + title}>
    <header><span className={styles.badge}>{badge}</span><strong>{title}</strong></header>
    {files.length ? <ImageGrid files={files} count={files.length} aspect="square" active={false} title={title} onOpen={(path) => void open(path)} /> : null}
    {otherFiles.length ? <div className={styles.fileList} role="list" aria-label={title + " 결과 파일"}>
      {otherFiles.map((file) => <div key={file.path} role="listitem" className={styles.fileRow}>
        <span className={styles.fileKind} data-kind={file.kind || "file"}>{fileKindLabels[file.kind || "file"] ?? "파일"}</span>
        <span className={styles.fileName} title={file.path}>{file.name}</span>
        <span className={styles.fileSize}>{formatBytes(file.bytes)}</span>
        <button type="button" onClick={() => void open(file.path)} aria-label={file.name + " 열기"}>열기</button>
      </div>)}
    </div> : null}
    <footer>
      <span className={styles.folder} title={folder}>저장 위치 · {folder}</span>
      <div className={styles.actions}><button type="button" onClick={() => void open(folder)}>결과 폴더 열기</button></div>
    </footer>
    {message && <p className={styles.message} role="alert">{message}</p>}
  </section>;
}

export default function CreativeStudioCard({ threadId = "", jobIds, folders, includeCompleted = false }: { threadId?: string; jobIds?: string[]; folders?: string[]; includeCompleted?: boolean }) {
  const [jobs, setJobs] = useState<Record<string, CreativeStudioJob>>({});
  const wantedKey = (jobIds ?? []).join(",");
  const wanted = useMemo(() => new Set(wantedKey ? wantedKey.split(",") : []), [wantedKey]);
  // 진행 카드로 쓸 때만 작업을 따라간다. 결과 카드(folders 만)로 쓸 때는 작업 목록을 보지 않는다.
  const tracksJobs = Boolean(threadId) || wanted.size > 0;
  const accept = useCallback((job: CreativeStudioJob | undefined) => {
    if (!job?.id || !tracksJobs) return false;
    if (wanted.size) return wanted.has(job.id);
    return job.conversationThreadId === threadId;
  }, [wanted, threadId, tracksJobs]);

  useEffect(() => {
    if (!tracksJobs) return;
    const onEvent = (event: Event) => {
      const job = (event as CustomEvent<{ job?: CreativeStudioJob }>).detail?.job;
      if (job && accept(job)) setJobs((prev) => ({ ...prev, [job.id]: job }));
    };
    window.addEventListener(CREATIVE_STUDIO_EVENT, onEvent);
    return () => window.removeEventListener(CREATIVE_STUDIO_EVENT, onEvent);
  }, [accept, tracksJobs]);

  useEffect(() => {
    if (!tracksJobs) return;
    let alive = true;
    void creativeStudio({ kind: "jobs" }).then((result) => {
      if (!alive || !result.jobs) return;
      setJobs((prev) => {
        const next = { ...prev };
        for (const job of result.jobs ?? []) if (accept(job) && !next[job.id]) next[job.id] = job;
        return next;
      });
    });
    return () => { alive = false; };
  }, [accept, tracksJobs]);

  const activeKey = Object.values(jobs).filter(isCreativeStudioActive).map((job) => job.id).sort().join(",");
  useEffect(() => {
    if (!activeKey) return;
    let alive = true;
    const timer = window.setInterval(() => {
      for (const id of activeKey.split(",")) {
        void creativeStudio({ kind: "job", jobId: id }).then((result) => {
          if (alive && result.job) setJobs((prev) => ({ ...prev, [id]: result.job! }));
        });
      }
    }, 2_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [activeKey]);

  const retry = useCallback(async (job: CreativeStudioJob) => {
    const result = await creativeStudio({
      kind: "generate", request: job.request, title: job.title, count: job.count, aspect: job.aspect,
      clientRequestId: newRequestId(), conversationThreadId: job.conversationThreadId || threadId, teammateId: job.teammateId || "",
    });
    if (result.job) emitCreativeStudioJob(result.job, { threadId });
  }, [threadId]);

  const list = Object.values(jobs)
    .filter((job) => includeCompleted || job.status !== "completed")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const restFolders = [...new Set(folders ?? [])];
  if (!list.length && !restFolders.length) return null;
  return <div className={styles.stack}>
    {list.map((job) => <JobCard key={job.id} job={job} onRetry={(item) => void retry(item)} />)}
    {restFolders.map((folder) => <FolderCard key={folder} folder={folder} />)}
  </div>;
}

