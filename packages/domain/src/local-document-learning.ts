export type ModyDocumentLearningFileKind =
  | "excel"
  | "spreadsheet"
  | "word"
  | "presentation"
  | "pdf"
  | "hwp"
  | "image"
  | "video"
  | "design"
  | "email"
  | "archive"
  | "text"
  | "report"
  | "folder"
  | "other";

export type ModyDocumentLearningCategory =
  | "monthly_report"
  | "settlement_sheet"
  | "customer_inquiry"
  | "schedule_rule"
  | "tax_material"
  | "contract"
  | "form_template"
  | "general_document";

export type ModyDocumentLearningSourceFile = {
  id?: string;
  absolutePath: string;
  fileName?: string;
  selected?: boolean;
  sizeBytes?: number;
  modifiedAt?: string;
  /** SHA-256 of the original bytes, supplied only by a trusted verifier. */
  contentSha256?: string;
  sourceKind?: string;
};

export type ModyDocumentLearningInput = {
  sessionId?: string;
  workspaceId?: string;
  localStorageRoot: string;
  selectedKinds?: readonly ModyDocumentLearningFileKind[];
  files: readonly ModyDocumentLearningSourceFile[];
  createdAt?: string;
};

export type ModyDocumentLearningFilePlan = {
  id: string;
  fileName: string;
  absolutePath: string;
  contentSha256?: string;
  extension: string;
  kind: ModyDocumentLearningFileKind;
  sourceKind?: string;
  category: ModyDocumentLearningCategory;
  periodLabel: string;
  dateKey?: string;
  targetFolder: string;
  tags: string[];
  confidence: number;
  status: "ready_to_index" | "unsupported_pending_parser" | "needs_review";
};

export type ModyDocumentLearningMaterialType =
  | "business_file"
  | "general_reference"
  | "video_material"
  | "editing_asset"
  | "mail_system_export"
  | "mail_reference"
  | "document_material"
  | "cloud_sheet"
  | "template_file";

export type ModyDocumentLearningCompletionState =
  | "final_reference"
  | "working_draft"
  | "template_source"
  | "raw_capture"
  | "mail_archive"
  | "review_needed"
  | "unknown";

export type ModyDocumentLearningRetrievalRole =
  | "primary_reference"
  | "format_template"
  | "evidence_source"
  | "draft_context"
  | "asset_context"
  | "mail_context"
  | "fallback_context";

export type ModyDocumentLearningInternalFileMemory = {
  fileId: string;
  fileName: string;
  kind: ModyDocumentLearningFileKind;
  category: ModyDocumentLearningCategory;
  materialType: ModyDocumentLearningMaterialType;
  completionState: ModyDocumentLearningCompletionState;
  retrievalRole: ModyDocumentLearningRetrievalRole;
  referencePriority: number;
  reuseFor: string[];
  avoidFor: string[];
  promptHints: string[];
  evidenceSignals: string[];
};

export type ModyDocumentLearningReferenceSet = {
  id: string;
  label: string;
  category: ModyDocumentLearningCategory;
  periodLabel: string;
  primaryFileIds: string[];
  supportingFileIds: string[];
  templateFileIds: string[];
  draftFileIds: string[];
};

export type ModyDocumentLearningOperationalMemory = {
  id: string;
  visibility: "internal_only";
  basis: "metadata_pattern_and_extracted_signal";
  memoryMode: "reference_routing_rules";
  fileMemories: ModyDocumentLearningInternalFileMemory[];
  referenceSets: ModyDocumentLearningReferenceSet[];
  promptPolicy: {
    beforeAnswer: string[];
    whenUserAsksFor: string[];
    doNot: string[];
  };
  summary: {
    primaryReferences: number;
    templates: number;
    drafts: number;
    reviewNeeded: number;
    mailReferences: number;
    assetReferences: number;
  };
};

export type ModyDocumentLearningGroup = {
  id: string;
  label: string;
  periodLabel: string;
  category: ModyDocumentLearningCategory;
  targetFolder: string;
  fileIds: string[];
};

export type ModyDocumentStyleProfile = {
  id: string;
  name: string;
  basis: "filename_and_folder_pattern";
  reportCadence: "monthly" | "daily" | "mixed";
  namingPattern: string;
  outputGuidance: string[];
};

export type ModyDocumentLearningPlan = {
  sessionId: string;
  workspaceId: string;
  createdAt: string;
  localStorageRoot: string;
  localIndexRoot: string;
  databaseUsed: false;
  rawFileContentStoredInAppDatabase: false;
  indexMode: "local_metadata_and_extracted_text";
  filePlans: ModyDocumentLearningFilePlan[];
  groups: ModyDocumentLearningGroup[];
  styleProfile: ModyDocumentStyleProfile;
  operationalMemory: ModyDocumentLearningOperationalMemory;
  summary: {
    selectedFiles: number;
    readyToIndex: number;
    needsReview: number;
    unsupportedPendingParser: number;
    monthlyGroups: number;
  };
  nextActions: string[];
};

export class ModyLocalDocumentLearningPlanner {
  createPlan(input: ModyDocumentLearningInput): ModyDocumentLearningPlan {
    if (!input.localStorageRoot.trim()) {
      throw new Error("자료 학습에는 localStorageRoot가 필요합니다.");
    }

    const selectedKindSet = new Set(input.selectedKinds ?? []);
    const selectedFiles = input.files
      .filter((file) => file.selected !== false)
      .map((file, index) => createFilePlan(file, input.localStorageRoot, selectedKindSet, index + 1));
    const filteredFiles = selectedKindSet.size > 0
      ? selectedFiles.filter((file) => selectedKindSet.has(file.kind) || selectedKindSet.has("report") && file.category === "monthly_report")
      : selectedFiles;
    const groups = createGroups(filteredFiles);
    const styleProfile = createStyleProfile(filteredFiles);
    const operationalMemory = createOperationalMemory(filteredFiles);

    return {
      sessionId: input.sessionId ?? `document_learning_${compactDate(input.createdAt ?? new Date().toISOString())}`,
      workspaceId: input.workspaceId ?? "default_workspace",
      createdAt: input.createdAt ?? new Date().toISOString(),
      localStorageRoot: normalizeRoot(input.localStorageRoot),
      localIndexRoot: joinPath(input.localStorageRoot, "ModyCrew_Local_Index"),
      databaseUsed: false,
      rawFileContentStoredInAppDatabase: false,
      indexMode: "local_metadata_and_extracted_text",
      filePlans: filteredFiles,
      groups,
      styleProfile,
      operationalMemory,
      summary: {
        selectedFiles: filteredFiles.length,
        readyToIndex: filteredFiles.filter((file) => file.status === "ready_to_index").length,
        needsReview: filteredFiles.filter((file) => file.status === "needs_review").length,
        unsupportedPendingParser: filteredFiles.filter((file) => file.status === "unsupported_pending_parser").length,
        monthlyGroups: groups.filter((group) => group.periodLabel !== "미분류").length,
      },
      nextActions: [
        "파일명과 폴더명으로 월별/날짜별 1차 분류를 확정합니다.",
        "지원되는 형식은 로컬 텍스트/표 추출 어댑터로 keyword_mvp 인덱스를 만듭니다.",
        "보고서 양식과 파일명 패턴으로 사용자 업무 스타일 프로필을 갱신합니다.",
        "외부 발송, 일정 등록, 파일 공유는 승인함을 통과할 때까지 실행하지 않습니다.",
      ],
    };
  }
}

function createFilePlan(
  file: ModyDocumentLearningSourceFile,
  localStorageRoot: string,
  selectedKinds: Set<ModyDocumentLearningFileKind>,
  sequence: number,
): ModyDocumentLearningFilePlan {
  const fileName = file.fileName?.trim() || basename(file.absolutePath);
  const extension = extensionOf(fileName);
  const kind = classifyKind(extension, fileName);
  const category = classifyCategory(fileName, kind);
  const period = extractPeriod(fileName);
  const targetFolder = joinPath(localStorageRoot, "ModyCrew_Local_Index", period.periodLabel, category);
  const tags = createTags(fileName, kind, category, period.periodLabel);
  const supported = isSupportedForLocalExtraction(kind, extension);
  const wantedButNeedsReview = selectedKinds.size > 0 && !selectedKinds.has(kind) && !(selectedKinds.has("report") && category === "monthly_report");

  return {
    id: file.id ?? `learning_file_${sequence}`,
    fileName,
    absolutePath: file.absolutePath,
    ...(file.contentSha256 ? { contentSha256: file.contentSha256 } : {}),
    extension,
    kind,
    ...(file.sourceKind ? { sourceKind: file.sourceKind } : {}),
    category,
    periodLabel: period.periodLabel,
    ...(period.dateKey ? { dateKey: period.dateKey } : {}),
    targetFolder,
    tags,
    confidence: scoreConfidence(fileName, kind, category, period.periodLabel),
    status: wantedButNeedsReview
      ? "needs_review"
      : supported
        ? "ready_to_index"
        : "unsupported_pending_parser",
  };
}

function classifyKind(extension: string, fileName: string): ModyDocumentLearningFileKind {
  if (["xlsx", "xlsm", "xls"].includes(extension)) return "excel";
  if (["csv", "tsv", "ods"].includes(extension)) return "spreadsheet";
  if (["docx", "doc"].includes(extension)) return "word";
  if (["ppt", "pptx", "key"].includes(extension)) return "presentation";
  if (extension === "pdf") return "pdf";
  if (["hwp", "hwpx"].includes(extension)) return "hwp";
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) return "image";
  if (["mp4", "mov", "mkv", "avi", "webm", "m4v"].includes(extension)) return "video";
  if (["psd", "ai", "fig", "sketch", "xd", "prproj", "aep", "indd"].includes(extension)) return "design";
  if (["eml", "msg", "mbox"].includes(extension)) return "email";
  if (["zip", "7z", "rar"].includes(extension)) return "archive";
  if (["txt", "md"].includes(extension)) return "text";
  if (/보고서|리포트|report/iu.test(fileName)) return "report";
  return "other";
}

function classifyCategory(fileName: string, kind: ModyDocumentLearningFileKind): ModyDocumentLearningCategory {
  const text = fileName.toLocaleLowerCase("ko-KR");
  if (/월별|월간|보고서|리포트|report/.test(text)) return "monthly_report";
  if (/세무|세금계산서|전자세금|현금영수증|홈택스|부가세|원천세|국세청|사업자|증빙|tax|invoice|receipt/.test(text)) return "tax_material";
  if (/계약|계약서|견적|발주|날인|서명|contract|quote/.test(text)) return "contract";
  if (/정산|매출|입금|미수|거래처|settlement|sales/.test(text)) return "settlement_sheet";
  if (/문의|상담|예약|고객|inquiry|lead/.test(text)) return "customer_inquiry";
  if (/일정|운영\s*규칙|휴무|근무|calendar|schedule/.test(text)) return "schedule_rule";
  if (/양식|서식|template|form/.test(text)) return "form_template";
  if (kind === "email") return "customer_inquiry";
  if (kind === "excel" || kind === "spreadsheet") return "settlement_sheet";
  return "general_document";
}

function createOperationalMemory(filePlans: readonly ModyDocumentLearningFilePlan[]): ModyDocumentLearningOperationalMemory {
  const fileMemories = filePlans.map(createInternalFileMemory);
  const referenceSets = createReferenceSets(filePlans, fileMemories);

  return {
    id: `operational_memory_${compactDate(new Date().toISOString())}`,
    visibility: "internal_only",
    basis: "metadata_pattern_and_extracted_signal",
    memoryMode: "reference_routing_rules",
    fileMemories,
    referenceSets,
    promptPolicy: {
      beforeAnswer: [
        "사용자에게 파일 기준을 길게 설명하지 말고, 내부 reference routing으로 먼저 source_of_truth 후보를 고른다.",
        "final_reference와 template_source를 working_draft보다 우선 참고한다.",
        "폴더 자료와 메일/문의 계정 신호가 함께 있으면 답장 톤, 보고서 목차, 정산 확인 항목, 일정 확인 질문을 업무틀 후보로 먼저 만든다.",
        "메일, 일정, 계약, 세무, 공공기관, 외부 공유 작업은 초안 작성까지만 하고 최종 실행은 승인 게이트로 보낸다.",
      ],
      whenUserAsksFor: [
        "보고서/문서 작성 요청은 같은 category와 periodLabel의 primary_reference 또는 format_template를 먼저 찾는다.",
        "메일/문의 답변 요청은 mail_context와 customer_inquiry 자료를 근거로 답장 초안을 만든다.",
        "업무 자동화 또는 업무틀 요청은 같은 폴더와 메일 신호에서 반복 입력, 기본 출력 형식, 승인 전 확인 질문, 금지 실행을 한 묶음으로 제안한다.",
        "동영상/편집 요청은 editing_asset과 video_material을 결과물 기준이 아니라 소스/첨부 맥락으로만 참조한다.",
        "클라우드 시트나 정산표 요청은 cloud_sheet 또는 settlement_sheet를 표 기준 source_of_truth 후보로 우선한다.",
      ],
      doNot: [
        "원본 파일 본문을 앱 클라우드 DB나 외부 채널에 저장하지 않는다.",
        "working_draft, raw_capture, review_needed 파일을 완성 기준으로 단정하지 않는다.",
        "파일명만으로 금액, 수신자, 계약 조건, 세무 신고 내용을 확정하지 않는다.",
      ],
    },
    summary: {
      primaryReferences: fileMemories.filter((file) => file.retrievalRole === "primary_reference").length,
      templates: fileMemories.filter((file) => file.retrievalRole === "format_template").length,
      drafts: fileMemories.filter((file) => file.completionState === "working_draft").length,
      reviewNeeded: fileMemories.filter((file) => file.completionState === "review_needed").length,
      mailReferences: fileMemories.filter((file) => file.retrievalRole === "mail_context").length,
      assetReferences: fileMemories.filter((file) => file.retrievalRole === "asset_context").length,
    },
  };
}

function createInternalFileMemory(file: ModyDocumentLearningFilePlan): ModyDocumentLearningInternalFileMemory {
  const materialType = classifyMaterialType(file);
  const completionState = classifyCompletionState(file);
  const retrievalRole = classifyRetrievalRole(file, materialType, completionState);
  const referencePriority = scoreReferencePriority(file, materialType, completionState, retrievalRole);

  return {
    fileId: file.id,
    fileName: file.fileName,
    kind: file.kind,
    category: file.category,
    materialType,
    completionState,
    retrievalRole,
    referencePriority,
    reuseFor: createReuseTargets(file, materialType, retrievalRole),
    avoidFor: createAvoidTargets(file, completionState, retrievalRole),
    promptHints: createPromptHints(file, materialType, completionState, retrievalRole),
    evidenceSignals: createEvidenceSignals(file, materialType, completionState),
  };
}

function classifyMaterialType(file: ModyDocumentLearningFilePlan): ModyDocumentLearningMaterialType {
  const text = `${file.fileName} ${file.absolutePath} ${file.kind} ${file.category} ${file.sourceKind ?? ""}`.toLocaleLowerCase("ko-KR");
  if (/google\s*sheet|spreadsheet|cloud|drive|sheets|클라우드|공유\s*시트|구글\s*시트|cloud_sheet/.test(text)) return "cloud_sheet";
  // 명시적 파일 형식(영상/디자인 소스)은 폴더 경로나 파일명에 업무 키워드(work/업무 등)가
  // 섞여 있어도 편집 자산으로 봅니다. kind 판정을 키워드 추정보다 먼저 적용해, 예컨대
  // "…\\local-work\\홍보영상.prproj" 같은 경로 때문에 편집 소스가 업무 문서로 오분류되지 않게 합니다.
  if (file.kind === "video") return "video_material";
  if (file.kind === "design") return "editing_asset";
  if (/업무|운영|정산|매출|계약|세무|보고서|회의|프로젝트|work|business|ops/.test(text)) return "business_file";
  if (file.kind === "email" || /메일|mail|inbox|sent|outlook|gmail/.test(text)) return "mail_system_export";
  if (file.category === "customer_inquiry") return "mail_reference";
  if (file.category === "form_template" || /양식|서식|template|form/.test(text)) return "template_file";
  if (["word", "pdf", "hwp", "presentation", "text"].includes(file.kind)) return "document_material";
  return "general_reference";
}

function classifyCompletionState(file: ModyDocumentLearningFilePlan): ModyDocumentLearningCompletionState {
  const text = `${file.fileName} ${file.absolutePath}`.toLocaleLowerCase("ko-KR");
  const name = file.fileName.toLocaleLowerCase("ko-KR");
  if (/최종|완성|완료|확정|final|approved|signed|제출본|발송본/.test(name)) return "final_reference";
  if (/초안|draft|작성중|wip|작업중|미완성|수정중|검토중/.test(name)) return "working_draft";
  if (/양식|서식|template|form|샘플|sample/.test(name) || file.category === "form_template") return "template_source";
  if (/raw|원본|촬영|녹화|캡처|capture|source|소스/.test(text) || file.kind === "video" || file.kind === "design") return "raw_capture";
  if (/메일|mail|inbox|sent|outlook|gmail/.test(text) || file.kind === "email") return "mail_archive";
  if (file.status !== "ready_to_index") return "review_needed";
  return file.confidence >= 0.75 ? "final_reference" : "unknown";
}

function classifyRetrievalRole(
  file: ModyDocumentLearningFilePlan,
  materialType: ModyDocumentLearningMaterialType,
  completionState: ModyDocumentLearningCompletionState,
): ModyDocumentLearningRetrievalRole {
  if (completionState === "template_source" || materialType === "template_file") return "format_template";
  if (materialType === "editing_asset" || materialType === "video_material") return "asset_context";
  if (materialType === "mail_system_export" || materialType === "mail_reference" || completionState === "mail_archive") return "mail_context";
  if (completionState === "working_draft" || completionState === "review_needed") return "draft_context";
  if (completionState === "final_reference" || materialType === "cloud_sheet" || file.category === "settlement_sheet") return "primary_reference";
  if (file.category === "contract" || file.category === "tax_material") return "evidence_source";
  return "fallback_context";
}

function scoreReferencePriority(
  file: ModyDocumentLearningFilePlan,
  materialType: ModyDocumentLearningMaterialType,
  completionState: ModyDocumentLearningCompletionState,
  retrievalRole: ModyDocumentLearningRetrievalRole,
): number {
  let score = file.confidence;
  if (retrievalRole === "primary_reference") score += 0.16;
  if (retrievalRole === "format_template") score += 0.12;
  if (retrievalRole === "evidence_source") score += 0.1;
  if (materialType === "cloud_sheet") score += 0.08;
  if (completionState === "final_reference") score += 0.12;
  if (completionState === "working_draft" || completionState === "raw_capture") score -= 0.16;
  if (completionState === "review_needed") score -= 0.22;
  return Math.max(0.08, Math.min(0.99, Number(score.toFixed(2))));
}

function createReuseTargets(
  file: ModyDocumentLearningFilePlan,
  materialType: ModyDocumentLearningMaterialType,
  retrievalRole: ModyDocumentLearningRetrievalRole,
): string[] {
  const targets = new Set<string>();
  if (retrievalRole === "primary_reference") targets.add("answer_with_business_standard");
  if (retrievalRole === "format_template") targets.add("match_output_format");
  if (retrievalRole === "mail_context") targets.add("draft_mail_or_messenger_reply");
  if (retrievalRole === "asset_context") targets.add("prepare_editing_or_attachment_context");
  if (file.category === "settlement_sheet" || materialType === "cloud_sheet") targets.add("table_review_and_report_basis");
  if (file.category === "monthly_report") targets.add("report_generation_basis");
  if (file.category === "schedule_rule") targets.add("calendar_candidate_basis");
  if (file.category === "contract" || file.category === "tax_material") targets.add("approval_required_evidence_basis");
  return targets.size > 0 ? [...targets] : ["general_context_only"];
}

function createAvoidTargets(
  file: ModyDocumentLearningFilePlan,
  completionState: ModyDocumentLearningCompletionState,
  retrievalRole: ModyDocumentLearningRetrievalRole,
): string[] {
  const avoid = new Set<string>();
  if (completionState !== "final_reference" && retrievalRole !== "format_template") {
    avoid.add("do_not_treat_as_final_business_rule");
  }
  if (retrievalRole === "asset_context") avoid.add("do_not_quote_as_document_content");
  if (file.category === "contract" || file.category === "tax_material") {
    avoid.add("do_not_execute_without_user_approval");
  }
  if (completionState === "review_needed") avoid.add("ask_user_before_using_as_reference");
  return [...avoid];
}

function createPromptHints(
  file: ModyDocumentLearningFilePlan,
  materialType: ModyDocumentLearningMaterialType,
  completionState: ModyDocumentLearningCompletionState,
  retrievalRole: ModyDocumentLearningRetrievalRole,
): string[] {
  return [
    `material_type=${materialType}`,
    `completion_state=${completionState}`,
    `retrieval_role=${retrievalRole}`,
    `category=${file.category}`,
    `period=${file.periodLabel}`,
    `status=${file.status}`,
  ];
}

function createEvidenceSignals(
  file: ModyDocumentLearningFilePlan,
  materialType: ModyDocumentLearningMaterialType,
  completionState: ModyDocumentLearningCompletionState,
): string[] {
  const signals = [
    `kind:${file.kind}`,
    `category:${file.category}`,
    `material:${materialType}`,
    `completion:${completionState}`,
  ];
  if (file.periodLabel !== "미분류") signals.push(`period:${file.periodLabel}`);
  if (file.tags.length) signals.push(`tags:${file.tags.slice(0, 5).join(",")}`);
  return signals;
}

function createReferenceSets(
  filePlans: readonly ModyDocumentLearningFilePlan[],
  fileMemories: readonly ModyDocumentLearningInternalFileMemory[],
): ModyDocumentLearningReferenceSet[] {
  const byFileId = new Map(fileMemories.map((memory) => [memory.fileId, memory]));
  return createGroups(filePlans).map((group) => {
    const groupMemories = group.fileIds
      .map((fileId) => byFileId.get(fileId))
      .filter((memory): memory is ModyDocumentLearningInternalFileMemory => Boolean(memory))
      .sort((left, right) => right.referencePriority - left.referencePriority);
    return {
      id: `reference_set_${group.id.replace(/[^0-9a-z가-힣_-]+/giu, "_")}`,
      label: `${group.label} 내부 참고 기준`,
      category: group.category,
      periodLabel: group.periodLabel,
      primaryFileIds: groupMemories
        .filter((memory) => memory.retrievalRole === "primary_reference" || memory.retrievalRole === "evidence_source")
        .map((memory) => memory.fileId),
      supportingFileIds: groupMemories
        .filter((memory) => !["primary_reference", "format_template"].includes(memory.retrievalRole))
        .map((memory) => memory.fileId),
      templateFileIds: groupMemories
        .filter((memory) => memory.retrievalRole === "format_template")
        .map((memory) => memory.fileId),
      draftFileIds: groupMemories
        .filter((memory) => memory.completionState === "working_draft" || memory.completionState === "review_needed")
        .map((memory) => memory.fileId),
    };
  });
}

function extractPeriod(fileName: string): { periodLabel: string; dateKey?: string } {
  const normalized = fileName.replaceAll("_", "-").replaceAll(".", "-");
  const dateMatch = normalized.match(/(20\d{2})[-년\s]*(0?[1-9]|1[0-2])[-월\s]*(0?[1-9]|[12]\d|3[01])?/u);
  const year = dateMatch?.[1];
  const monthValue = dateMatch?.[2];
  if (year && monthValue) {
    const month = monthValue.padStart(2, "0");
    const day = dateMatch[3]?.padStart(2, "0");
    return {
      periodLabel: `${year}-${month}`,
      ...(day ? { dateKey: `${year}-${month}-${day}` } : {}),
    };
  }

  const compactMatch = fileName.match(/(20\d{2})(0[1-9]|1[0-2])/u);
  const compactYear = compactMatch?.[1];
  const compactMonth = compactMatch?.[2];
  if (compactYear && compactMonth) {
    return { periodLabel: `${compactYear}-${compactMonth}` };
  }

  return { periodLabel: "미분류" };
}

function createGroups(filePlans: readonly ModyDocumentLearningFilePlan[]): ModyDocumentLearningGroup[] {
  const groups = new Map<string, ModyDocumentLearningGroup>();

  for (const file of filePlans) {
    const id = `${file.periodLabel}:${file.category}`;
    const group = groups.get(id);
    if (group) {
      group.fileIds.push(file.id);
      continue;
    }

    groups.set(id, {
      id,
      label: `${file.periodLabel} · ${categoryLabel(file.category)}`,
      periodLabel: file.periodLabel,
      category: file.category,
      targetFolder: file.targetFolder,
      fileIds: [file.id],
    });
  }

  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label, "ko-KR"));
}

function createStyleProfile(filePlans: readonly ModyDocumentLearningFilePlan[]): ModyDocumentStyleProfile {
  const hasMonthly = filePlans.some((file) => file.category === "monthly_report" || file.periodLabel !== "미분류");
  const hasDaily = filePlans.some((file) => Boolean(file.dateKey));
  const cadence = hasMonthly && hasDaily ? "mixed" : hasDaily ? "daily" : "monthly";
  const primaryCategory = mostCommon(filePlans.map((file) => file.category)) ?? "general_document";

  return {
    id: `style_${primaryCategory}_${cadence}`,
    name: `${categoryLabel(primaryCategory)} 중심 업무 스타일`,
    basis: "filename_and_folder_pattern",
    reportCadence: cadence,
    namingPattern: hasMonthly ? "YYYY-MM + 업무명 + 자료유형" : "업무명 + 자료유형",
    outputGuidance: [
      "원본 파일명에서 쓰던 월/날짜 표기를 유지합니다.",
      "보고서와 정산표는 월별 폴더 아래 같은 업무명으로 묶습니다.",
      "사용자가 작성하던 양식과 말투는 RAG 출처가 있는 초안에만 반영합니다.",
    ],
  };
}

function createTags(
  fileName: string,
  kind: ModyDocumentLearningFileKind,
  category: ModyDocumentLearningCategory,
  periodLabel: string,
): string[] {
  return Array.from(new Set([
    kind,
    category,
    periodLabel,
    ...fileName
      .replace(/\.[^.]+$/u, "")
      .split(/[\s_\-.()[\]{}]+/u)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2),
  ]));
}

function isSupportedForLocalExtraction(kind: ModyDocumentLearningFileKind, extension: string): boolean {
  if (["text", "excel", "spreadsheet", "word", "pdf"].includes(kind)) return true;
  if (["md", "txt", "csv"].includes(extension)) return true;
  return false;
}

function scoreConfidence(
  fileName: string,
  kind: ModyDocumentLearningFileKind,
  category: ModyDocumentLearningCategory,
  periodLabel: string,
): number {
  let score = 0.45;
  if (kind !== "other") score += 0.18;
  if (category !== "general_document") score += 0.2;
  if (periodLabel !== "미분류") score += 0.12;
  if (/보고서|정산|문의|일정|세무|계약|양식/iu.test(fileName)) score += 0.05;
  return Math.min(0.98, Number(score.toFixed(2)));
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/u).filter(Boolean).at(-1) ?? filePath;
}

function extensionOf(fileName: string): string {
  const match = fileName.match(/\.([^.]+)$/u);
  return match?.[1]?.toLocaleLowerCase("ko-KR") ?? "";
}

function normalizeRoot(root: string): string {
  return root.trim().replace(/[\\/]+$/u, "");
}

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => index === 0 ? normalizeRoot(part) : part.replace(/^[\\/]+|[\\/]+$/gu, ""))
    .filter(Boolean)
    .join("\\");
}

function compactDate(value: string): string {
  return value.replaceAll(/[^0-9]/g, "").slice(0, 14) || "now";
}

function categoryLabel(category: ModyDocumentLearningCategory): string {
  const labels: Record<ModyDocumentLearningCategory, string> = {
    monthly_report: "월별 보고서",
    settlement_sheet: "정산/매출표",
    customer_inquiry: "문의/상담",
    schedule_rule: "일정/운영 규칙",
    tax_material: "세무 자료",
    contract: "계약/견적",
    form_template: "양식/서식",
    general_document: "일반 문서",
  };
  return labels[category];
}

function mostCommon<T extends string>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}
