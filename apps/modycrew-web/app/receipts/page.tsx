"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";

import styles from "./page.module.css";

type ReceiptFile = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type ReceiptData = {
  merchantName: string;
  businessNumber: string;
  purchaseDate: string;
  purchaseTime: string;
  totalAmount: number;
  supplyAmount: number;
  vatAmount: number;
  currency: string;
  paymentMethod: string;
  category: string;
  notes: string;
  warnings: string[];
  confidence: "high" | "medium" | "low";
  reviewStatus: "needs_review" | "confirmed";
};

type ReceiptDraft = {
  id: string;
  revisionOf?: string;
  createdAt: string;
  fileName: string;
  folderLabel: string;
  receipt: ReceiptData;
  template: ReceiptTemplate;
  driveFolderSegments: string[];
};

type ReceiptTemplate = {
  documentTitle: string;
  companyName?: string;
  additionalFields: Array<{ label: string; value: string }>;
};

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
  sizeBytes: number;
  webViewLink: string;
};

type DriveOperation = {
  file?: DriveFile;
  targetFolders?: string[];
  action?: "move" | "blocked" | "skipped";
  reason?: string;
};

type DriveUploadPreview = {
  status: string;
  userMessage: string;
  targetFolders?: string[];
  approvalId?: string;
  approvalExpiresAt?: string;
};

type DriveOrganizationPreview = {
  status: string;
  userMessage: string;
  operations?: DriveOperation[];
  approvalId?: string;
  approvalExpiresAt?: string;
};

type ReceiptRuntime = {
  importFiles: (files: File[]) => Promise<{ status: string; userMessage: string; grantId?: string; files?: ReceiptFile[] }>;
  analyze: (payload: { grantId: string; fileIds: string[]; instruction: string; template: ReceiptTemplate; provider: "openai" | "gemini"; receiptImageConsent: boolean }) => Promise<{ status: string; userMessage: string; drafts?: ReceiptDraft[] }>;
  regenerate: (payload: { artifactId: string; receipt: ReceiptData; template: ReceiptTemplate }) => Promise<{ status: string; userMessage: string; draft?: ReceiptDraft }>;
  list: () => Promise<{ status: string; userMessage: string; drafts?: ReceiptDraft[] }>;
  open: (artifactId: string) => Promise<{ status: string; userMessage: string }>;
  driveStatus: () => Promise<{ status: string; userMessage: string; connected?: boolean }>;
  connectDrive: () => Promise<{ status: string; userMessage: string; connected?: boolean }>;
  previewUpload: (payload: { artifactId: string }) => Promise<DriveUploadPreview>;
  upload: (payload: { artifactId: string; approvalId: string; confirmationText: string }) => Promise<{ status: string; userMessage: string; externalMutation?: boolean }>;
  listDriveFiles: (payload?: { parentId?: string; driveId?: string; pageSize?: number }) => Promise<{ status: string; userMessage: string; files?: DriveFile[] }>;
  /** 고른 Drive 파일을 로컬로 받아 학습에 넣을 수 있게 한다. Drive 원본은 바꾸지 않는다. */
  downloadDriveForLearning: (payload: { fileIds: string[]; driveId?: string }) => Promise<{
    status: string;
    userMessage: string;
    files?: Array<{ absolutePath: string; fileName: string; sizeBytes?: number; modifiedAt?: string; sourceKind?: string }>;
    skipped?: Array<{ name?: string; reason?: string }>;
    folder?: string;
  }>;
  previewOrganization: (payload: { fileIds: string[] }) => Promise<DriveOrganizationPreview>;
  applyOrganization: (payload: { fileIds: string[]; approvalId: string; confirmationText: string }) => Promise<{ status: string; userMessage: string; externalMutation?: boolean }>;
};

declare global {
  interface Window {
    modyCrewReceiptAgent?: ReceiptRuntime;
  }
}

const emptyTemplate: ReceiptTemplate = {
  documentTitle: "영수증 업무 처리서",
  companyName: "",
  additionalFields: [],
};

export default function ReceiptAgentPage() {
  const [grantId, setGrantId] = useState("");
  const [files, setFiles] = useState<ReceiptFile[]>([]);
  const [template, setTemplate] = useState<ReceiptTemplate>(emptyTemplate);
  const [instruction, setInstruction] = useState("");
  const [visionProvider, setVisionProvider] = useState<"openai" | "gemini">("openai");
  const [drafts, setDrafts] = useState<ReceiptDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [status, setStatus] = useState("사진을 올리면 영수증 업무 초안을 만듭니다.");
  const [busy, setBusy] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [selectedDriveFiles, setSelectedDriveFiles] = useState<string[]>([]);

  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0] ?? null,
    [drafts, selectedDraftId],
  );

  useEffect(() => {
    void loadSavedDrafts();
    void refreshDriveStatus();
  }, []);

  async function loadSavedDrafts() {
    const runtime = receiptRuntime();
    if (!runtime) return;
    const result = await runtime.list();
    if (result.drafts?.length) {
      setDrafts(result.drafts);
      setSelectedDraftId(result.drafts[0].id);
    }
  }

  async function refreshDriveStatus() {
    const runtime = receiptRuntime();
    if (!runtime) return;
    const result = await runtime.driveStatus();
    setDriveConnected(result.connected === true);
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!picked.length) return;
    const runtime = requireRuntime();
    if (!runtime) return;
    setBusy(true);
    try {
      const result = await runtime.importFiles(picked);
      setStatus(result.userMessage);
      if (result.grantId) setGrantId(result.grantId);
      setFiles(result.files ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function analyzeReceipts() {
    if (!grantId || !files.length) {
      setStatus("영수증 사진을 먼저 올려 주세요.");
      return;
    }
    const runtime = requireRuntime();
    if (!runtime) return;
    const providerLabel = visionProvider === "gemini" ? "Gemini" : "OpenAI";
    const imageConsent = window.confirm(
      files.length + "\uC7A5\uC758 \uC601\uC218\uC99D \uC0AC\uC9C4\uC744 " + providerLabel + " API\uC5D0 \uC804\uC1A1\uD558\uC5EC \uB0B4\uC6A9\uC744 \uC77D\uC2B5\uB2C8\uB2E4. \uC0AC\uC9C4\uC740 \uC774 \uBD84\uC11D \uC694\uCCAD\uC5D0\uB9CC \uC0AC\uC6A9\uD569\uB2C8\uB2E4. \uACC4\uC18D\uD560\uAE4C\uC694?",
    );
    if (!imageConsent) {
      setStatus("\uC0AC\uC9C4 \uC804\uC1A1 \uB3D9\uC758\uB97C \uCDE8\uC18C\uD588\uC2B5\uB2C8\uB2E4.");
      return;
    }
    setBusy(true);
    try {
      const result = await runtime.analyze({
        grantId,
        fileIds: files.map((file) => file.id),
        instruction,
        template,
        provider: visionProvider,
        receiptImageConsent: true,
      });
      setStatus(result.userMessage);
      if (result.drafts?.length) {
        setDrafts((current) => mergeDrafts(result.drafts ?? [], current));
        setSelectedDraftId(result.drafts[0].id);
      }
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(field: keyof ReceiptData, value: string | number) {
    if (!selectedDraft) return;
    setDrafts((current) => current.map((draft) => draft.id === selectedDraft.id
      ? { ...draft, receipt: { ...draft.receipt, [field]: value } }
      : draft));
  }

  async function regenerateSelectedDraft() {
    if (!selectedDraft) return;
    const runtime = requireRuntime();
    if (!runtime) return;
    setBusy(true);
    try {
      const result = await runtime.regenerate({
        artifactId: selectedDraft.id,
        receipt: { ...selectedDraft.receipt, reviewStatus: "confirmed" },
        template,
      });
      setStatus(result.userMessage);
      if (result.draft) {
        setDrafts((current) => [result.draft!, ...current]);
        setSelectedDraftId(result.draft.id);
      }
    } finally {
      setBusy(false);
    }
  }

  async function openSelectedDraft() {
    if (!selectedDraft) return;
    const runtime = requireRuntime();
    if (!runtime) return;
    const result = await runtime.open(selectedDraft.id);
    setStatus(result.userMessage);
  }

  async function connectDrive() {
    const runtime = requireRuntime();
    if (!runtime) return;
    setBusy(true);
    try {
      const result = await runtime.connectDrive();
      setStatus(result.userMessage);
      setDriveConnected(result.connected === true);
    } finally {
      setBusy(false);
    }
  }

  async function saveToDrive() {
    if (!selectedDraft) return;
    if (selectedDraft.receipt.reviewStatus !== "confirmed") {
      setStatus("\uC0AC\uC6A9 \uC77C\uC790, \uC0AC\uC6A9\uCC98, \uD569\uACC4 \uAE08\uC561\uC744 \uD655\uC778\uD55C \uB4A4 \uD655\uC778\uBCF8\uC744 \uB9CC\uB4E4\uC5B4 \uC8FC\uC138\uC694.");
      return;
    }
    const runtime = requireRuntime();
    if (!runtime) return;
    setBusy(true);
    try {
      const preview = await runtime.previewUpload({ artifactId: selectedDraft.id });
      if (!preview.targetFolders?.length || !preview.approvalId) {
        setStatus(preview.userMessage);
        return;
      }
      const approved = window.confirm(`${preview.targetFolders.join(" / ")}에 Word 문서와 영수증 사진을 저장할까요?`);
      if (!approved) return;
      const result = await runtime.upload({
        artifactId: selectedDraft.id,
        approvalId: String(preview.approvalId ?? ""),
        confirmationText: "\uB4DC\uB77C\uC774\uBE0C\uC5D0 \uC800\uC7A5",
      });
      setStatus(result.userMessage);
    } finally {
      setBusy(false);
    }
  }

  async function loadDriveFiles() {
    const runtime = requireRuntime();
    if (!runtime) return;
    setBusy(true);
    try {
      const result = await runtime.listDriveFiles();
      setStatus(result.userMessage);
      setDriveFiles(result.files ?? []);
      setSelectedDriveFiles([]);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 고른 Drive 파일을 받아 그대로 학습까지 넣는다.
   *
   * 받기만 하고 끝내면 사용자가 그 폴더를 다시 찾아 학습 화면에서 고르는 수고가 남는다.
   * 학습 브리지가 있으면 이어서 분류까지 돌린다.
   */
  async function sendDriveFilesToLearning() {
    if (!selectedDriveFiles.length) {
      setStatus("학습에 넣을 Drive 파일을 먼저 골라 주세요.");
      return;
    }
    const runtime = requireRuntime();
    if (!runtime) return;
    setBusy(true);
    try {
      const result = await runtime.downloadDriveForLearning({ fileIds: selectedDriveFiles });
      const files = result.files ?? [];
      if (!files.length) {
        const reasons = (result.skipped ?? [])
          .map((item) => `${item.name ?? "파일"}: ${item.reason ?? "건너뜀"}`)
          .join(" / ");
        setStatus(reasons ? `${result.userMessage} (${reasons})` : result.userMessage);
        return;
      }
      const learning = window.modyCrewDesktopBridge?.classifyDocumentLearning;
      if (!learning) {
        setStatus(`${result.userMessage} 자료 학습 화면에서 이 폴더를 고르면 바로 학습합니다.`);
        return;
      }
      const classified = await learning({
        files: files.map((file, index) => ({
          id: file.absolutePath || `drive-${index}`,
          absolutePath: file.absolutePath,
          fileName: file.fileName,
          selected: true,
          sourceKind: file.sourceKind ?? "google_drive",
        })),
      });
      const skippedCount = (result.skipped ?? []).length;
      setStatus(
        `Drive 파일 ${files.length}개를 학습에 넣었습니다.` +
          (skippedCount ? ` ${skippedCount}개는 읽을 수 없어 건너뛰었습니다.` : "") +
          " Drive 원본은 그대로입니다." +
          (classified?.userMessage ? ` ${classified.userMessage}` : ""),
      );
    } catch {
      setStatus("Drive 파일을 학습에 넣지 못했습니다. Drive 원본은 그대로입니다.");
    } finally {
      setBusy(false);
    }
  }

  async function organizeDriveFiles() {
    if (!selectedDriveFiles.length) {
      setStatus("정리할 Drive 파일을 선택해 주세요.");
      return;
    }
    const runtime = requireRuntime();
    if (!runtime) return;
    setBusy(true);
    try {
      const preview = await runtime.previewOrganization({ fileIds: selectedDriveFiles });
      if (!preview.status.includes("preview") || !preview.approvalId) {
        setStatus(preview.userMessage);
        return;
      }
      if (preview.operations?.some((operation) => operation.action === "blocked")) {
        setStatus(preview.userMessage);
        return;
      }
      const approved = window.confirm("\uC120\uD0DD\uD55C \uD30C\uC77C\uC744 \uB0A0\uC9DC\uBCC4 \uD3F4\uB354\uB85C \uC774\uB3D9\uD560\uAE4C\uC694? \uC0AD\uC81C\uB098 \uACF5\uC720 \uAD8C\uD55C \uD3B8\uC9D1\uC740 \uD558\uC9C0 \uC54A\uC9C0\uB9CC, \uC774\uB3D9 \uB300\uC0C1 \uD3F4\uB354\uC758 \uAE30\uC874 \uC811\uADFC \uADDC\uCE59\uC740 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
      if (!approved) return;
      const result = await runtime.applyOrganization({
        fileIds: selectedDriveFiles,
        approvalId: String(preview.approvalId ?? ""),
        confirmationText: "\uC120\uD0DD \uD30C\uC77C \uC815\uB9AC",
      });
      setStatus(result.userMessage);
      if (result.externalMutation) await loadDriveFiles();
    } finally {
      setBusy(false);
    }
  }

  function requireRuntime() {
    const runtime = receiptRuntime();
    if (!runtime) setStatus("설치된 ModyCrew 앱에서 영수증 AI를 사용할 수 있습니다.");
    return runtime;
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>영수증 정리</h1>
        </div>
        <p className={styles.status} aria-live="polite">{status}</p>
      </header>

      <section className={styles.workspace} aria-label="영수증 업무 입력">
        <div className={styles.uploadArea}>
          <label className={styles.uploadButton}>
            <input type="file" accept="image/jpeg,image/png" multiple onChange={handleFiles} disabled={busy} />
            영수증 사진 선택
          </label>
          <div className={styles.fileList} aria-label="선택한 영수증 사진">
            {files.length ? files.map((file) => <span key={file.id}>{file.fileName}</span>) : <span>선택한 사진 없음</span>}
          </div>
        </div>

        <div className={styles.templateGrid}>
          <label>
            <span>문서 제목</span>
            <input value={template.documentTitle} onChange={(event) => setTemplate((current) => ({ ...current, documentTitle: event.target.value }))} />
          </label>
          <label>
            <span>회사명</span>
            <input value={template.companyName ?? ""} onChange={(event) => setTemplate((current) => ({ ...current, companyName: event.target.value }))} />
          </label>
          <label>
            <span>{"\uC0AC\uC9C4 \uC804\uC1A1 AI"}</span>
            <select value={visionProvider} onChange={(event) => setVisionProvider(event.target.value === "gemini" ? "gemini" : "openai")} disabled={busy}>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <label className={styles.wideField}>
            <span>처리 요청</span>
            <input value={instruction} placeholder="예: 회의비로 분류" onChange={(event) => setInstruction(event.target.value)} />
          </label>
        </div>

        <div className={styles.actionRow}>
          <button type="button" onClick={analyzeReceipts} disabled={busy || !files.length}>업무 초안 만들기</button>
          <span>{busy ? "처리 중" : ""}</span>
        </div>
      </section>

      <section className={styles.documents} aria-label="생성한 영수증 문서">
        <div className={styles.sectionHeader}>
          <h2>영수증 문서</h2>
          <button type="button" onClick={loadSavedDrafts} disabled={busy}>새로고침</button>
        </div>
        <div className={styles.documentLayout}>
          <nav className={styles.draftList} aria-label="영수증 문서 목록">
            {drafts.length ? drafts.map((draft) => (
              <button key={draft.id} type="button" className={draft.id === selectedDraft?.id ? styles.selectedDraft : ""} onClick={() => setSelectedDraftId(draft.id)}>
                <strong>{draft.receipt.merchantName || "사용처 확인 필요"}</strong>
                <span>{draft.receipt.purchaseDate || "날짜 확인 필요"}</span>
                <small>{draft.fileName}</small>
              </button>
            )) : <p>생성한 문서 없음</p>}
          </nav>

          {selectedDraft ? (
            <div className={styles.reviewPanel}>
              <div className={styles.reviewHeader}>
                <div>
                  <h3>{selectedDraft.fileName}</h3>
                  <p>{selectedDraft.folderLabel}</p>
                </div>
                <div className={styles.reviewActions}>
                  <button type="button" onClick={openSelectedDraft}>Word 열기</button>
                  <button type="button" onClick={regenerateSelectedDraft} disabled={busy}>확인본 만들기</button>
                </div>
              </div>
              <div className={styles.fields}>
                <Field label="사용처" value={selectedDraft.receipt.merchantName} onChange={(value) => updateDraft("merchantName", value)} />
                <Field label="사용 일자" type="date" value={selectedDraft.receipt.purchaseDate} onChange={(value) => updateDraft("purchaseDate", value)} />
                <Field label="합계" type="number" value={String(selectedDraft.receipt.totalAmount || "")} onChange={(value) => updateDraft("totalAmount", Number(value))} />
                <Field label="공급가액" type="number" value={String(selectedDraft.receipt.supplyAmount || "")} onChange={(value) => updateDraft("supplyAmount", Number(value))} />
                <Field label="부가세" type="number" value={String(selectedDraft.receipt.vatAmount || "")} onChange={(value) => updateDraft("vatAmount", Number(value))} />
                <Field label="결제 수단" value={selectedDraft.receipt.paymentMethod} onChange={(value) => updateDraft("paymentMethod", value)} />
                <Field label="비용 분류" value={selectedDraft.receipt.category} onChange={(value) => updateDraft("category", value)} />
                <Field label="사업자등록번호" value={selectedDraft.receipt.businessNumber} onChange={(value) => updateDraft("businessNumber", value)} />
              </div>
              {selectedDraft.receipt.warnings.length ? <p className={styles.warning}>{selectedDraft.receipt.warnings.join(" / ")}</p> : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className={styles.drive} aria-label="Google Drive 저장 및 정리">
        <div className={styles.sectionHeader}>
          <h2>회사 Google Drive</h2>
          <div className={styles.driveActions}>
            <button type="button" onClick={connectDrive} disabled={busy || driveConnected}>{driveConnected ? "연결됨" : "연결"}</button>
            <button type="button" onClick={saveToDrive} disabled={busy || !driveConnected || !selectedDraft}>문서 저장</button>
            <button type="button" onClick={loadDriveFiles} disabled={busy || !driveConnected}>파일 보기</button>
          </div>
        </div>
        {driveFiles.length ? (
          <div className={styles.driveList}>
            {driveFiles.map((file) => (
              <label key={file.id}>
                <input
                  type="checkbox"
                  checked={selectedDriveFiles.includes(file.id)}
                  onChange={(event) => setSelectedDriveFiles((current) => event.target.checked ? [...current, file.id] : current.filter((id) => id !== file.id))}
                />
                <span>{file.name}</span>
                <small>{formatFileDate(file.createdTime)}</small>
              </label>
            ))}
            <button type="button" onClick={sendDriveFilesToLearning} disabled={busy || !selectedDriveFiles.length}>선택 파일 학습에 넣기</button>
            <button type="button" onClick={organizeDriveFiles} disabled={busy || !selectedDriveFiles.length}>선택 파일 날짜별 정리</button>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: "text" | "number" | "date" }) {
  return <label><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function receiptRuntime() {
  if (typeof window === "undefined") return null;
  return window.modyCrewReceiptAgent ?? null;
}

function mergeDrafts(next: ReceiptDraft[], current: ReceiptDraft[]) {
  const ids = new Set(next.map((draft) => draft.id));
  return [...next, ...current.filter((draft) => !ids.has(draft.id))];
}

function formatFileDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 확인 필요";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}
