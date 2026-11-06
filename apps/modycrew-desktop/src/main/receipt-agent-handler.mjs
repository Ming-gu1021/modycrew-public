import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const receiptGrantTtlMs = 30 * 60 * 1000;
const receiptGrantLimit = 48;
const maxReceiptFiles = 12;
const maxReceiptBytes = 12 * 1024 * 1024;
const supportedReceiptExtensions = new Set(["jpg", "jpeg", "png"]);
const receiptSelectionGrants = new Map();

/**
 * 영수증 전용 처리기입니다. 원본 파일은 읽기 전용으로 스테이징 사본을 만들고,
 * 생성 문서는 별도 결과 폴더에만 기록합니다.
 */
export async function handleReceiptAgentMessage(event, payload = {}, options = {}) {
  try {
    assertTrustedReceiptSender(event, options);
    const kind = String(payload.kind ?? payload.action ?? "");

    if (kind === "import_receipt_files") {
      return await importReceiptFiles(event, payload, options);
    }
    if (kind === "analyze_receipts") {
      return await analyzeReceipts(event, payload, options);
    }
    if (kind === "regenerate_receipt") {
      return await regenerateReceipt(event, payload, options);
    }
    if (kind === "list_receipts") {
      return await listReceipts(options);
    }
    if (kind === "open_receipt") {
      return await openReceiptArtifact(payload, options);
    }

    return receiptResult("unsupported_action", "지원하지 않는 영수증 업무 요청입니다.");
  } catch (error) {
    return receiptResult(
      "receipt_agent_failed",
      "영수증 업무를 처리하지 못했습니다. 원본 사진과 기존 문서는 바꾸지 않았습니다.",
      { errorCode: receiptErrorCode(error) },
    );
  }
}

export async function resolveReceiptArtifactForDrive(artifactId, options = {}) {
  const normalizedId = safeId(artifactId);
  if (!normalizedId) {
    throw new Error("receipt_artifact_required");
  }

  const ledger = await readReceiptLedger(options);
  const artifact = ledger.artifacts.find((item) => item.id === normalizedId);
  if (!artifact) {
    throw new Error("receipt_artifact_not_found");
  }

  const outputRoot = getReceiptOutputRoot(options);
  const candidatePaths = [artifact.documentPath, artifact.sourceCopyPath]
    .filter(Boolean)
    .map((value) => path.resolve(String(value)));
  if (!candidatePaths.length || candidatePaths.some((value) => !isWithinRoot(value, outputRoot))) {
    throw new Error("receipt_artifact_path_invalid");
  }

  const files = [];
  for (const filePath of candidatePaths) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) continue;
    files.push({
      path: filePath,
      name: path.basename(filePath),
      sizeBytes: stat.size,
      mimeType: mimeTypeForExtension(path.extname(filePath).slice(1)),
    });
  }
  if (!files.some((item) => /\.docx$/iu.test(item.name))) {
    throw new Error("receipt_document_missing");
  }

  return {
    artifactId: artifact.id,
    fileName: artifact.fileName,
    merchantName: artifact.receipt?.merchantName || "미분류",
    purchaseDate: artifact.receipt?.purchaseDate || "",
    receipt: artifact.receipt ?? {},
    folderSegments: receiptDriveFolderSegments(artifact),
    files,
  };
}

function assertTrustedReceiptSender(event, options) {
  if (options.trustedFileSelection === true) return;
  const sender = event?.sender;
  const senderFrame = event?.senderFrame;
  if (!sender || !senderFrame || !Number.isInteger(sender.id)) {
    throw new Error("receipt_untrusted_sender");
  }
  if (sender.mainFrame && senderFrame !== sender.mainFrame) {
    throw new Error("receipt_nested_frame_blocked");
  }
  const senderUrl = String(senderFrame.url || sender.getURL?.() || "");
  if (
    !senderUrl.startsWith("modycrew://") &&
    !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/iu.test(senderUrl)
  ) {
    throw new Error("receipt_sender_origin_blocked");
  }
}

async function importReceiptFiles(event, payload, options) {
  const supplied = Array.isArray(payload.files) ? payload.files.slice(0, maxReceiptFiles) : [];
  if (!supplied.length) {
    return receiptResult("receipt_files_required", "영수증 사진을 먼저 선택해 주세요.", { files: [] });
  }

  const now = Date.now();
  const grantId = `receipt-${crypto.randomUUID()}`;
  const stagingDir = path.join(getReceiptStagingRoot(options), grantId);
  await fs.mkdir(stagingDir, { recursive: true });

  const files = [];
  for (let index = 0; index < supplied.length; index += 1) {
    const imported = await stageReceiptFile(supplied[index], index, stagingDir);
    if (imported) files.push(imported);
  }
  if (!files.length) {
    return receiptResult(
      "receipt_images_required",
      "JPG 또는 PNG 영수증 사진만 올릴 수 있습니다. 원본은 변경하지 않았습니다.",
      { files: [] },
    );
  }

  pruneReceiptSelectionGrants();
  receiptSelectionGrants.set(grantId, {
    senderId: event?.sender?.id ?? null,
    expiresAt: now + receiptGrantTtlMs,
    stagingDir,
    files,
  });
  while (receiptSelectionGrants.size > receiptGrantLimit) {
    const firstKey = receiptSelectionGrants.keys().next().value;
    if (!firstKey) break;
    receiptSelectionGrants.delete(firstKey);
  }

  return receiptResult("receipt_files_staged", "영수증 사진을 준비했습니다. AI가 내용을 읽어 초안을 만들 수 있습니다.", {
    grantId,
    expiresAt: new Date(now + receiptGrantTtlMs).toISOString(),
    files: files.map(publicReceiptFile),
  });
}

async function stageReceiptFile(input, index, stagingDir) {
  const fileName = safeFileName(input?.fileName ?? input?.name ?? `영수증-${index + 1}.jpg`);
  const extension = normalizedExtension(fileName, input?.mimeType ?? input?.type);
  if (!supportedReceiptExtensions.has(extension)) return null;

  const targetPath = path.join(stagingDir, `${String(index + 1).padStart(2, "0")}-${fileName}`);
  const base64 = String(input?.dataBase64 ?? "").trim();
  if (base64) {
    const data = decodeReceiptBase64(base64);
    if (!data) return null;
    if (!data.length || data.length > maxReceiptBytes) return null;
    await fs.writeFile(targetPath, data, { flag: "wx" });
  } else {
    const sourcePath = String(input?.absolutePath ?? input?.path ?? "").trim();
    if (!sourcePath) return null;
    const sourceStat = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile() || sourceStat.size <= 0 || sourceStat.size > maxReceiptBytes) return null;
    await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  }

  const targetStat = await fs.stat(targetPath).catch(() => null);
  const imageData = await fs.readFile(targetPath).catch(() => null);
  if (!targetStat?.isFile() || targetStat.size <= 0 || targetStat.size > maxReceiptBytes || !matchesReceiptImageSignature(imageData, extension)) {
    await fs.rm(targetPath, { force: true }).catch(() => undefined);
    return null;
  }
  return {
    id: `receipt-file-${crypto.randomUUID()}`,
    fileName,
    stagingPath: targetPath,
    extension,
    mimeType: mimeTypeForExtension(extension),
    sizeBytes: targetStat.size,
  };
}

function decodeReceiptBase64(value) {
  const normalized = String(value ?? "").replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 !== 0) return null;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(normalized)) return null;
  const data = Buffer.from(normalized, "base64");
  return data.length && data.toString("base64") === normalized ? data : null;
}

function matchesReceiptImageSignature(data, extension) {
  if (!Buffer.isBuffer(data)) return false;
  if (extension === "png") {
    return data.length >= 8 &&
      data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
      data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a;
  }
  return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}
async function analyzeReceipts(event, payload, options) {
  const grant = resolveReceiptSelectionGrant(event, payload.grantId);
  if (!grant) {
    return receiptResult(
      "receipt_selection_expired",
      "사진 선택 시간이 지났습니다. 영수증 사진을 다시 올려 주세요.",
      { drafts: [] },
    );
  }
  const requestedIds = new Set(
    (Array.isArray(payload.fileIds) ? payload.fileIds : grant.files.map((file) => file.id))
      .map(safeId)
      .filter(Boolean),
  );
  const files = grant.files.filter((file) => requestedIds.has(file.id));
  if (!files.length) {
    return receiptResult("receipt_files_required", "분석할 영수증 사진을 선택해 주세요.", { drafts: [] });
  }

  try {
  const template = normalizeReceiptTemplate(payload.template);
  const drafts = [];
  for (const file of files) {
    const analysis = await analyzeReceiptImage(file, payload, options);
    if (analysis.status !== "receipt_analysis_ready") {
      return receiptResult(analysis.status, analysis.userMessage, {
        drafts,
        connectionRequired: analysis.connectionRequired === true,
      });
    }
    const artifact = await createReceiptArtifact({ file, receipt: analysis.receipt, template }, options);
    drafts.push(publicReceiptArtifact(artifact));
  }

  return receiptResult(
    "receipt_drafts_created",
    `${drafts.length}건의 영수증 업무 초안을 만들었습니다. 금액과 날짜를 확인한 뒤 Drive 저장을 진행할 수 있습니다.`,
    { drafts },
  );
  } finally {
    await discardReceiptSelectionGrant(payload.grantId, grant);
  }
}

async function analyzeReceiptImage(file, payload, options) {
  const imageData = await fs.readFile(file.stagingPath);
  if (!imageData.length || imageData.length > maxReceiptBytes) {
    return {
      status: "receipt_image_unavailable",
      userMessage: "영수증 사진을 안전하게 읽지 못했습니다. 다시 올려 주세요.",
    };
  }
  if (typeof options.generateReceiptVision !== "function") {
    return {
      status: "receipt_vision_connection_required",
      userMessage: "영수증 사진을 읽을 AI 연결이 아직 준비되지 않았습니다. AI 연결을 확인한 뒤 다시 시도해 주세요.",
      connectionRequired: true,
    };
  }

  const result = await options.generateReceiptVision({
    prompt: buildReceiptVisionPrompt(payload.instruction, file.fileName),
    provider: payload.provider,
    receiptImageConsent: payload.receiptImageConsent === true,
    images: [{
      fileName: file.fileName,
      mimeType: file.mimeType,
      dataBase64: imageData.toString("base64"),
    }],
  });
  const output = String(result?.outputText ?? result?.text ?? "");
  if (!isVisionResultReady(result) || !output) {
    return {
      status: "receipt_vision_failed",
      userMessage: String(result?.userMessage ?? "영수증 사진에서 필요한 정보를 읽지 못했습니다. 사진을 다시 찍거나 AI 연결을 확인해 주세요."),
      connectionRequired: result?.status === "ai_connection_required",
    };
  }

  const parsed = parseReceiptJson(output);
  if (!parsed) {
    return {
      status: "receipt_data_review_required",
      userMessage: "AI가 영수증 항목을 확인 가능한 형식으로 돌려주지 못했습니다. 사진을 다시 올려 주세요.",
    };
  }
  return {
    status: "receipt_analysis_ready",
    receipt: normalizeReceipt(parsed),
  };
}

async function regenerateReceipt(event, payload, options) {
  const artifactId = safeId(payload.artifactId);
  const ledger = await readReceiptLedger(options);
  const previous = ledger.artifacts.find((item) => item.id === artifactId);
  if (!previous) {
    return receiptResult("receipt_artifact_not_found", "수정할 영수증 초안을 찾지 못했습니다.");
  }
  const sourcePath = String(previous.sourceCopyPath ?? "");
  if (!sourcePath || !isWithinRoot(sourcePath, getReceiptOutputRoot(options))) {
    return receiptResult("receipt_source_unavailable", "원본 사본을 찾지 못해 수정본을 만들 수 없습니다.");
  }
  const fileStat = await fs.stat(sourcePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return receiptResult("receipt_source_unavailable", "원본 사본을 찾지 못해 수정본을 만들 수 없습니다.");
  }
  const receipt = normalizeReceipt({ ...previous.receipt, ...(payload.receipt ?? {}) });
  const confirmationIssues = receiptConfirmationIssues(receipt);
  if (receipt.reviewStatus === "confirmed" && confirmationIssues.length) return receiptResult("receipt_confirmation_incomplete", "\uD655\uC778 \uC644\uB8CC\\uB85C \\uC800\\uC7A5\\uD558\\uB824\\uBA74 \\uC0AC\\uC6A9 \\uC77C\\uC790, \\uC0AC\\uC6A9\\uCC98, \\uD569\\uACC4 \\uAE08\\uC561\\uC744 \\uD655\\uC778\\uD574 \\uC8FC\\uC138\\uC694.", { confirmationIssues });
  const artifact = await createReceiptArtifact({
    file: {
      id: `receipt-file-${crypto.randomUUID()}`,
      fileName: path.basename(sourcePath),
      stagingPath: sourcePath,
      extension: normalizedExtension(sourcePath),
      mimeType: mimeTypeForExtension(normalizedExtension(sourcePath)),
      sizeBytes: fileStat.size,
    },
    receipt,
    template: normalizeReceiptTemplate(payload.template ?? previous.template),
    revisionOf: previous.id,
  }, options);
  return receiptResult("receipt_revision_created", "수정한 값으로 새 Word 문서를 만들었습니다. 이전 파일은 그대로 보관했습니다.", {
    draft: publicReceiptArtifact(artifact),
  });
}

async function createReceiptArtifact({ file, receipt, template, revisionOf = "" }, options) {
  const id = `receipt-${crypto.randomUUID()}`;
  const outputRoot = getReceiptOutputRoot(options);
  const dateParts = receiptDateParts(receipt.purchaseDate);
  const merchant = safePathSegment(receipt.merchantName || "미분류");
  const outputDir = dateParts.needsReview
    ? path.join(outputRoot, "\uAC80\uD1A0 \uD544\uC694", "\uB0A0\uC9DC \uD655\uC778 \uD544\uC694", merchant)
    : path.join(outputRoot, `${dateParts.year}년`, `${dateParts.month}월`, merchant);
  const sourceDir = path.join(outputDir, "원본 영수증");
  await fs.mkdir(sourceDir, { recursive: true });

  const sourceExtension = normalizedExtension(file.fileName, file.mimeType);
  const sourceName = await uniqueFilePath(sourceDir, `영수증 사진_${dateParts.date}${sourceExtension ? `.${sourceExtension}` : ".jpg"}`);
  await fs.copyFile(file.stagingPath, sourceName);

  const fileName = receiptDocumentFileName(receipt, dateParts);
  const documentPath = await uniqueFilePath(outputDir, fileName);
  await writeReceiptWordDocument(documentPath, {
    receipt,
    template,
    sourcePath: sourceName,
    createdAt: new Date().toISOString(),
  });

  const artifact = {
    id,
    createdAt: new Date().toISOString(),
    revisionOf: safeId(revisionOf),
    fileName: path.basename(documentPath),
    documentPath,
    sourceCopyPath: sourceName,
    outputDir,
    receipt,
    template,
  };
  const ledger = await readReceiptLedger(options);
  ledger.artifacts.unshift(artifact);
  ledger.artifacts = ledger.artifacts.slice(0, 500);
  await writeReceiptLedger(ledger, options);
  return artifact;
}

async function writeReceiptWordDocument(targetPath, input) {
  const docx = await import("docx");
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    ImageRun,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = docx;
  const receipt = input.receipt;
  const rows = [
    ["문서 구분", input.template.documentTitle || "영수증 업무 처리서"],
    ["처리 상태", receipt.reviewStatus === "confirmed" ? "확인 완료" : "검토 필요"],
    ["사용 일자", receipt.purchaseDate || "확인 필요"],
    ["사용처", receipt.merchantName || "확인 필요"],
    ["사업자등록번호", receipt.businessNumber || "확인 필요"],
    ["결제 수단", receipt.paymentMethod || "확인 필요"],
    ["비용 분류", receipt.category || "확인 필요"],
    ["공급가액", receipt.supplyAmount > 0 ? formatWon(receipt.supplyAmount) : "확인 필요"],
    ["부가세", receipt.vatAmount > 0 ? formatWon(receipt.vatAmount) : "확인 필요"],
    ["합계", receipt.totalAmount > 0 ? formatWon(receipt.totalAmount) : "확인 필요"],
    ["검토 메모", receipt.notes || receipt.warnings.join(" / ") || "확인 필요"],
  ];
  for (const item of input.template.additionalFields) {
    rows.push([item.label, item.value || "확인 필요"]);
  }
  const tableRows = rows.map(([label, value]) =>
    new TableRow({
      children: [
        new TableCell({
          width: { size: 28, type: WidthType.PERCENTAGE },
          shading: { fill: "E8EEF7" },
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
        }),
        new TableCell({
          width: { size: 72, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: String(value) })] })],
        }),
      ],
    }),
  );
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: input.template.documentTitle || "영수증 업무 처리서", bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: `작성일 ${formatKoreanDate(new Date())}`, size: 20 })],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: "B9C5D3" },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: "B9C5D3" },
        left: { style: BorderStyle.SINGLE, size: 4, color: "B9C5D3" },
        right: { style: BorderStyle.SINGLE, size: 4, color: "B9C5D3" },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "D7E0EA" },
        insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "D7E0EA" },
      },
      rows: tableRows,
    }),
    new Paragraph({ text: "" }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, text: "영수증 원본" }),
  ];
  const image = await createReceiptImageRun(ImageRun, input.sourcePath);
  if (image) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [image] }));
  } else {
    children.push(new Paragraph({ text: "영수증 원본은 같은 폴더의 원본 영수증 폴더에 보관했습니다." }));
  }
  children.push(
    new Paragraph({ text: "" }),
    new Paragraph({
      children: [new TextRun({ text: "AI가 읽은 값은 회계 반영 전 반드시 확인해야 합니다.", italics: true, color: "6B7280" })],
    }),
  );
  const document = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(document);
  const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, buffer, { flag: "wx" });
  await fs.rename(tempPath, targetPath);
}

async function createReceiptImageRun(ImageRun, sourcePath) {
  const extension = normalizedExtension(sourcePath);
  if (!supportedReceiptExtensions.has(extension)) return null;
  const data = await fs.readFile(sourcePath);
  if (!data.length) return null;
  return new ImageRun({
    data,
    type: extension === "jpeg" ? "jpg" : extension,
    transformation: { width: 430, height: 560 },
    altText: { title: "영수증 원본", description: "영수증 사진", name: "receipt" },
  });
}

async function listReceipts(options) {
  const ledger = await readReceiptLedger(options);
  return receiptResult("receipt_list_loaded", "저장된 영수증 업무 초안을 불러왔습니다.", {
    drafts: ledger.artifacts.slice(0, 100).map(publicReceiptArtifact),
  });
}

async function openReceiptArtifact(payload, options) {
  const artifact = await resolveReceiptArtifactForDrive(payload.artifactId, options);
  const document = artifact.files.find((item) => /\.docx$/iu.test(item.name));
  const openPath = options.shell?.openPath;
  if (typeof openPath !== "function" || !document) {
    return receiptResult("receipt_open_unavailable", "이 환경에서는 Word 문서를 바로 열 수 없습니다.");
  }
  const error = await openPath.call(options.shell, document.path);
  if (error) {
    return receiptResult("receipt_open_failed", "Word 문서를 열지 못했습니다.");
  }
  return receiptResult("receipt_opened", "Word 문서를 열었습니다.", { artifactId: artifact.artifactId });
}

function buildReceiptVisionPrompt(instruction, fileName) {
  const extra = String(instruction ?? "").trim().slice(0, 1200);
  return [
    "이 이미지는 한국 회사의 영수증 또는 카드전표입니다. 보이는 내용만 구조화해 주세요.",
    "추측하지 말고 읽히지 않는 값은 빈 문자열 또는 null로 남기며 warnings에 이유를 적으세요.",
    "반드시 JSON 하나만 반환하세요. Markdown 코드블록이나 설명 문장은 쓰지 마세요.",
    "스키마: {merchantName,businessNumber,purchaseDate,purchaseTime,totalAmount,supplyAmount,vatAmount,currency,paymentMethod,category,items:[{name,quantity,amount}],notes,warnings,confidence}",
    "purchaseDate는 YYYY-MM-DD, 금액은 숫자, currency는 KRW 같은 ISO 통화 코드, confidence는 high/medium/low입니다.",
    `파일명: ${fileName}`,
    extra ? `사용자 요청: ${extra}` : "",
  ].filter(Boolean).join("\n");
}

function parseReceiptJson(value) {
  const raw = String(value ?? "").trim();
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  if (fenced) candidates.push(fenced.trim());
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(raw.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // 다음 가능한 JSON 조각을 시도합니다.
    }
  }
  return null;
}

function receiptConfirmationIssues(receipt) {
  const issues = [];
  if (!normalizeDate(receipt?.purchaseDate)) issues.push("purchase_date");
  if (!safeText(receipt?.merchantName, 100)) issues.push("merchant_name");
  if (!Number.isFinite(Number(receipt?.totalAmount)) || Number(receipt.totalAmount) <= 0) issues.push("total_amount");
  return issues;
}

function normalizeReceipt(input) {
  const warnings = normalizeTextList(input?.warnings, 8);
  const totalAmount = normalizeAmount(input?.totalAmount);
  const supplyAmount = normalizeAmount(input?.supplyAmount);
  const vatAmount = normalizeAmount(input?.vatAmount);
  if (!totalAmount) warnings.push("합계 금액 확인 필요");
  if (!normalizeDate(input?.purchaseDate)) warnings.push("사용 일자 확인 필요");
  if (!safeText(input?.merchantName, 100)) warnings.push("사용처 확인 필요");
  return {
    merchantName: safeText(input?.merchantName, 100),
    businessNumber: safeText(input?.businessNumber, 32),
    purchaseDate: normalizeDate(input?.purchaseDate),
    purchaseTime: normalizeTime(input?.purchaseTime),
    totalAmount,
    supplyAmount,
    vatAmount,
    currency: /^[A-Z]{3}$/u.test(String(input?.currency ?? "").trim()) ? String(input.currency).trim() : "KRW",
    paymentMethod: safeText(input?.paymentMethod, 60),
    category: safeText(input?.category, 80),
    items: normalizeReceiptItems(input?.items),
    notes: safeText(input?.notes, 500),
    warnings: [...new Set(warnings.map((item) => safeText(item, 160)).filter(Boolean))].slice(0, 10),
    confidence: ["high", "medium", "low"].includes(String(input?.confidence ?? "")) ? String(input.confidence) : "low",
    reviewStatus: input?.reviewStatus === "confirmed" ? "confirmed" : "needs_review",
  };
}

function normalizeReceiptItems(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 30).map((item) => ({
    name: safeText(item?.name, 120),
    quantity: normalizeAmount(item?.quantity),
    amount: normalizeAmount(item?.amount),
  })).filter((item) => item.name || item.amount > 0);
}

function normalizeReceiptTemplate(input) {
  const additional = Array.isArray(input?.additionalFields) ? input.additionalFields : [];
  return {
    documentTitle: safeText(input?.documentTitle, 100) || "영수증 업무 처리서",
    companyName: safeText(input?.companyName, 120),
    additionalFields: additional.slice(0, 10).map((field) => ({
      label: safeText(field?.label, 80),
      value: safeText(field?.value, 200),
    })).filter((field) => field.label),
  };
}

function isVisionResultReady(result) {
  return result?.answerReady === true || result?.status === "generate_content_loaded" || result?.status === "receipt_vision_ready";
}

function resolveReceiptSelectionGrant(event, grantId) {
  pruneReceiptSelectionGrants();
  const grant = receiptSelectionGrants.get(String(grantId ?? ""));
  if (!grant || grant.expiresAt < Date.now()) return null;
  if (grant.senderId !== null && grant.senderId !== event?.sender?.id) return null;
  return grant;
}

async function discardReceiptSelectionGrant(grantId, grant) {
  const id = String(grantId ?? "");
  if (receiptSelectionGrants.get(id) === grant) receiptSelectionGrants.delete(id);
  const stagingDir = String(grant?.stagingDir ?? "").trim();
  if (!stagingDir) return;
  await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
}

function pruneReceiptSelectionGrants() {
  for (const [key, grant] of receiptSelectionGrants.entries()) {
    if (!grant || grant.expiresAt < Date.now()) {
      receiptSelectionGrants.delete(key);
      const stagingDir = String(grant?.stagingDir ?? "").trim();
      if (stagingDir) {
        void fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}

function publicReceiptFile(file) {
  return {
    id: file.id,
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
  };
}

function publicReceiptArtifact(artifact) {
  const receipt = normalizeReceipt(artifact.receipt ?? {});
  return {
    id: artifact.id,
    revisionOf: safeId(artifact.revisionOf),
    createdAt: safeText(artifact.createdAt, 40),
    fileName: safeText(artifact.fileName, 180),
    folderLabel: receiptFolderLabel(artifact),
    receipt,
    template: normalizeReceiptTemplate(artifact.template),
    driveFolderSegments: receiptDriveFolderSegments(artifact),
    externalMutation: false,
  };
}

function receiptDriveFolderSegments(artifact) {
  const parts = receiptDateParts(artifact?.receipt?.purchaseDate);
  if (parts.needsReview) return ["ModyCrew \uC601\uC218\uC99D \uC5C5\uBB34", "\uAC80\uD1A0 \uD544\uC694", "\uB0A0\uC9DC \uD655\uC778 \uD544\uC694", safePathSegment(artifact?.receipt?.merchantName || "\uBBF8\uBD84\uB958")];
  return ["ModyCrew 영수증 업무", `${parts.year}년`, `${parts.month}월`, safePathSegment(artifact?.receipt?.merchantName || "미분류")];
}

function receiptFolderLabel(artifact) {
  const parts = receiptDateParts(artifact?.receipt?.purchaseDate);
  if (parts.needsReview) return "\uAC80\uD1A0 \uD544\uC694 / \uB0A0\uC9DC \uD655\uC778 \uD544\uC694 / " + safePathSegment(artifact?.receipt?.merchantName || "\uBBF8\uBD84\uB958");
  return `${parts.year}년 / ${parts.month}월 / ${safePathSegment(artifact?.receipt?.merchantName || "미분류")}`;
}

function receiptDocumentFileName(receipt, parts) {
  const merchant = safePathSegment(receipt.merchantName || "미분류");
  const amount = receipt.totalAmount > 0 ? `${Math.round(receipt.totalAmount)}원` : "금액확인필요";
  return `${parts.date}_${merchant}_영수증_${amount}.docx`;
}

function receiptDateParts(value) {
  const date = normalizeDate(value);
  if (!date) return { year: "\uAC80\uD1A0 \uD544\uC694", month: "\uB0A0\uC9DC \uD655\uC778 \uD544\uC694", day: "", date: "\uB0A0\uC9DC\uD655\uC778\uD544\uC694", needsReview: true };
  const [year, month, day] = date.split("-");
  return { year, month, day, date };
}

function getReceiptStagingRoot(options) {
  return path.join(getReceiptUserDataRoot(options), "receipt-agent", "staging");
}

function getReceiptLedgerPath(options) {
  return path.join(getReceiptUserDataRoot(options), "receipt-agent", "ledger.json");
}

function getReceiptUserDataRoot(options) {
  const configured = String(options.userDataPath ?? options.app?.getPath?.("userData") ?? "").trim();
  return configured || path.join(os.homedir(), "AppData", "Roaming", "ModyCrew");
}

function getReceiptOutputRoot(options) {
  const configured = String(options.receiptOutputRoot ?? "").trim();
  if (configured) return path.resolve(configured);
  const documents = String(options.documentsPath ?? options.app?.getPath?.("documents") ?? "").trim();
  return path.resolve(documents || path.join(os.homedir(), "Documents"), "ModyCrew", "영수증 업무");
}

async function readReceiptLedger(options) {
  const filePath = getReceiptLedgerPath(options);
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (parsed && Array.isArray(parsed.artifacts)) {
      return { schema: "modycrew.receipt-ledger.v1", artifacts: parsed.artifacts.slice(0, 500) };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      // 손상된 기존 원장은 덮어쓰지 않고 새 원장으로 다시 시작합니다.
    }
  }
  return { schema: "modycrew.receipt-ledger.v1", artifacts: [] };
}

async function writeReceiptLedger(ledger, options) {
  const filePath = getReceiptLedgerPath(options);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await fs.rename(tempPath, filePath);
}

async function uniqueFilePath(directory, desiredName) {
  const extension = path.extname(desiredName);
  const stem = path.basename(desiredName, extension);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(directory, index === 1 ? desiredName : `${stem} (${index})${extension}`);
    if (!(await fs.stat(candidate).catch(() => null))) return candidate;
  }
  throw new Error("receipt_file_name_collision");
}

function isWithinRoot(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizedExtension(fileName, mimeType = "") {
  const extension = path.extname(String(fileName ?? "")).slice(1).toLowerCase();
  if (extension === "jpg" || extension === "jpeg" || extension === "png") return extension;
  const mime = String(mimeType ?? "").toLowerCase();
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  return "";
}

function mimeTypeForExtension(extension) {
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

function safeFileName(value) {
  return safePathSegment(path.basename(String(value ?? ""))) || "영수증.jpg";
}

function safePathSegment(value) {
  return String(value ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80) || "미분류";
}

function safeText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeId(value) {
  const id = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{6,160}$/u.test(id) ? id : "";
}

function normalizeAmount(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  const text = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function normalizeDate(value) {
  const raw = String(value ?? "").trim().replace(/[./]/g, "-");
  const match = raw.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/u);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeTime(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/u);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

function normalizeTextList(value, max) {
  return Array.isArray(value) ? value.slice(0, max).map((item) => String(item ?? "")).filter(Boolean) : [];
}

function formatWon(value) {
  return `${new Intl.NumberFormat("ko-KR").format(Number(value) || 0)}원`;
}

function formatIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatKoreanDate(date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function receiptResult(status, userMessage, extra = {}) {
  return {
    status,
    userMessage,
    externalMutation: false,
    originalFilesMoved: false,
    originalFilesDeleted: false,
    rawSecretMaterialReturned: false,
    ...extra,
  };
}

function receiptErrorCode(error) {
  const message = String(error?.message ?? error ?? "");
  if (/receipt_untrusted_sender|origin|frame/iu.test(message)) return "receipt_access_denied";
  if (/docx|module/i.test(message)) return "receipt_word_renderer_unavailable";
  if (/ENOSPC|EACCES|EPERM/iu.test(message)) return "receipt_storage_unavailable";
  return "receipt_processing_failed";
}
