import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import type { ModyLearnedOutputDraft } from "./document-learned-output-draft.js";

export type ModyLearnedOutputArtifactKind = "markdown" | "word_docx" | "excel_xlsx" | "mail_eml";

export type ModyLearnedOutputArtifact = {
  kind: ModyLearnedOutputArtifactKind;
  path: string;
  label: string;
  userEditable: true;
  approvalRequiredBeforeExternalMutation: true;
};

export type ModyLearnedOutputArtifactManifest = {
  id: string;
  createdAt: string;
  draftId: string;
  outputKind: ModyLearnedOutputDraft["outputKind"];
  title: string;
  outputDir: string;
  artifacts: ModyLearnedOutputArtifact[];
  approvalGateLabel: string;
  approvalRequiredBeforeExternalMutation: true;
  externalMutation: false;
  rawFileContentStoredInAppDatabase: false;
  handoffLabel: string;
  nextUserActions: string[];
};

export type ModyLearnedOutputArtifactInput = {
  draft: ModyLearnedOutputDraft;
  outputDir: string;
  fileBaseName?: string;
};

export async function createLearnedOutputArtifacts(
  input: ModyLearnedOutputArtifactInput,
): Promise<ModyLearnedOutputArtifactManifest> {
  const { draft } = input;
  const outputDir = path.resolve(input.outputDir);
  const fileBaseName = sanitizeFileBaseName(input.fileBaseName ?? `${draft.outputKind}-${draft.id}`);
  await mkdir(outputDir, { recursive: true });

  const artifacts: ModyLearnedOutputArtifact[] = [];
  const markdownPath = path.join(outputDir, `${fileBaseName}.md`);
  await writeFile(markdownPath, draft.markdown, "utf8");
  artifacts.push(createArtifact("markdown", markdownPath, "검토용 Markdown 초안"));

  if (draft.outputKind === "report_draft" || draft.outputKind === "table_review" || draft.outputKind === "calendar_candidate") {
    const docxPath = path.join(outputDir, `${fileBaseName}.docx`);
    await writeWordDocument(draft, docxPath);
    artifacts.push(createArtifact("word_docx", docxPath, "사용자 편집용 Word 초안"));
  }

  if (draft.outputKind === "report_draft" || draft.outputKind === "table_review") {
    const xlsxPath = path.join(outputDir, `${fileBaseName}.xlsx`);
    await writeExcelWorkbook(draft, xlsxPath);
    artifacts.push(createArtifact("excel_xlsx", xlsxPath, "점검표 Excel 초안"));
  }

  if (draft.outputKind === "mail_reply_draft") {
    const emlPath = path.join(outputDir, `${fileBaseName}.eml`);
    await writeFile(emlPath, createMailDraftEml(draft), "utf8");
    artifacts.push(createArtifact("mail_eml", emlPath, "발송 전 메일 초안"));
  }

  const manifest: ModyLearnedOutputArtifactManifest = {
    id: `artifact_manifest_${draft.id}`,
    createdAt: new Date().toISOString(),
    draftId: draft.id,
    outputKind: draft.outputKind,
    title: draft.title,
    outputDir,
    artifacts,
    approvalGateLabel: draft.approvalGateLabel,
    approvalRequiredBeforeExternalMutation: true,
    externalMutation: false,
    rawFileContentStoredInAppDatabase: false,
    handoffLabel: draft.handoffLabel,
    nextUserActions: [...draft.nextUserActions],
  };

  await writeFile(path.join(outputDir, `${fileBaseName}.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function createArtifact(
  kind: ModyLearnedOutputArtifactKind,
  artifactPath: string,
  label: string,
): ModyLearnedOutputArtifact {
  return {
    kind,
    path: artifactPath,
    label,
    userEditable: true,
    approvalRequiredBeforeExternalMutation: true,
  };
}

async function writeWordDocument(draft: ModyLearnedOutputDraft, targetPath: string): Promise<void> {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import("docx");
  const children = markdownToDocxParagraphs(draft.markdown, { HeadingLevel, Paragraph, TextRun });
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: draft.title, bold: true })],
          }),
          ...children,
        ],
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  await writeFile(targetPath, buffer);
}

async function writeExcelWorkbook(draft: ModyLearnedOutputDraft, targetPath: string): Promise<void> {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ModyCrew";
  workbook.created = new Date(draft.createdAt);

  const summary = workbook.addWorksheet("초안 요약");
  summary.columns = [
    { header: "항목", key: "label", width: 28 },
    { header: "내용", key: "value", width: 72 },
  ];
  summary.addRows([
    { label: "제목", value: draft.title },
    { label: "출력 종류", value: draft.outputKind },
    { label: "학습 스타일", value: draft.learnedStyleProfileId },
    { label: "승인 게이트", value: draft.approvalGateLabel },
    { label: "외부 실행", value: "잠김" },
    { label: "원본 본문 DB 저장", value: "안 함" },
  ]);
  summary.getRow(1).font = { bold: true };

  const checklist = workbook.addWorksheet("확인 체크리스트");
  checklist.columns = [
    { header: "확인 항목", key: "item", width: 42 },
    { header: "상태", key: "status", width: 18 },
    { header: "메모", key: "memo", width: 54 },
  ];
  checklist.addRows([
    { item: "숫자/금액/날짜 확인", status: "사용자 확인 필요", memo: "학습 자료 기준 초안입니다." },
    { item: "수신자/공유 대상 확인", status: "사용자 확인 필요", memo: "승인 전 외부 발송 금지" },
    { item: "문체와 회사 양식 확인", status: "검토 대기", memo: draft.learnedStyleGuidance.join(" / ") },
  ]);
  checklist.getRow(1).font = { bold: true };

  await workbook.xlsx.writeFile(targetPath);
}

function createMailDraftEml(draft: ModyLearnedOutputDraft): string {
  const subject = extractMailSubject(draft.markdown) ?? draft.title;
  const body = draft.markdown.replace(/^제목:\s*.+$/m, "").trim();
  return [
    "To: ",
    "Cc: ",
    `Subject: ${subject}`,
    "X-ModyCrew-Approval-Required: true",
    "X-ModyCrew-External-Mutation: false",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
    "",
    "--",
    "ModyCrew 초안입니다. 사용자가 최종 승인하기 전에는 발송하지 않습니다.",
  ].join("\r\n");
}

function extractMailSubject(markdown: string): string | null {
  const match = markdown.match(/^제목:\s*(.+)$/m);
  return match?.[1]?.trim() || null;
}

function markdownToDocxParagraphs(
  markdown: string,
  kit: {
    HeadingLevel: typeof import("docx").HeadingLevel;
    Paragraph: typeof import("docx").Paragraph;
    TextRun: typeof import("docx").TextRun;
  },
): import("docx").Paragraph[] {
  const { HeadingLevel, Paragraph, TextRun } = kit;
  return markdown.split(/\r?\n/).map((line) => {
    if (line.startsWith("## ")) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: line.slice(3), bold: true })],
      });
    }
    if (line.startsWith("# ")) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: line.slice(2), bold: true })],
      });
    }
    if (line.startsWith("- ")) {
      return new Paragraph({ text: line.slice(2), bullet: { level: 0 } });
    }
    return new Paragraph({ children: [new TextRun(line)] });
  });
}

function sanitizeFileBaseName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return sanitized || "modycrew-learned-output";
}
