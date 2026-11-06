export type ModyMailRecipientListRow = Record<string, unknown>;

export type ModyMailRecipientListReviewStatus =
  | "review_required"
  | "needs_columns"
  | "empty";

export type ModyMailRecipientListReview = {
  status: ModyMailRecipientListReviewStatus;
  sourceLabel: string;
  sourceType: "csv" | "tsv" | "xlsx" | "manual" | string;
  rowCount: number;
  candidateCount: number;
  validRecipientCount: number;
  readyForSampleCount: number;
  personalizationReviewCount: number;
  excludedCount: number;
  duplicateCount: number;
  missingAddressCount: number;
  missingPersonalizationCount: number;
  detectedColumns: {
    addressColumn?: string;
    nameColumn?: string;
    groupColumn?: string;
    excludeColumn?: string;
    personalizationColumns: string[];
  };
  targetGroups: Array<{
    label: string;
    count: number;
  }>;
  recommendedTargetGroups: Array<{
    label: string;
    count: number;
    reason: string;
  }>;
  recipientDecisionMatrix: {
    send: Array<{
      label: string;
      count: number;
      reason: string;
    }>;
    hold: Array<{
      label: string;
      count: number;
      reason: string;
    }>;
    exclude: Array<{
      label: string;
      count: number;
      reason: string;
    }>;
  };
  exclusionRuleSummary: string[];
  exclusionReasonBreakdown: Array<{
    label: string;
    count: number;
    reason: string;
  }>;
  groupSamplePreviews: Array<{
    groupLabel: string;
    validCount: number;
    sampleCount: number;
    readySampleCount: number;
    reviewSampleCount: number;
    personalizationKeys: string[];
    missingPersonalizationKeys: string[];
    riskLabels: string[];
  }>;
  personalizationGapSummary: string[];
  recipientDecisionSummary: string;
  nextReviewFocus: string;
  samplePreviews: Array<{
    id: string;
    groupLabel: string;
    personalizationKeys: string[];
    missingPersonalizationKeys: string[];
    riskLabels: string[];
    status: "ready_for_sample" | "needs_review";
  }>;
  dryRunSummary: {
    wouldSendCount: number;
    wouldExcludeCount: number;
    readyForSampleCount: number;
    personalizationReviewCount: number;
    sampleSize: number;
    blockedReason: string;
  };
  checklist: string[];
  approvalGate: string;
  privacyBoundary: string;
};

export function analyzeMailRecipientListRows(input: {
  rows: ModyMailRecipientListRow[];
  sourceLabel?: string;
  sourceType?: ModyMailRecipientListReview["sourceType"];
  sampleSize?: number;
}): ModyMailRecipientListReview {
  const rows = input.rows.map(normalizeRow).filter((row) => Object.keys(row).length > 0);
  const sourceLabel = cleanLabel(input.sourceLabel || "메일 발송 명단");
  const sourceType = input.sourceType || "manual";
  const headers = unique(rows.flatMap((row) => Object.keys(row)));
  const detectedColumns = detectRecipientColumns(headers);
  const sampleSize = clampNumber(input.sampleSize, 1, 10, 5);

  if (rows.length === 0) {
    return createEmptyReview(sourceLabel, sourceType);
  }

  if (!detectedColumns.addressColumn) {
    return {
      status: "needs_columns",
      sourceLabel,
      sourceType,
      rowCount: rows.length,
      candidateCount: 0,
      validRecipientCount: 0,
      readyForSampleCount: 0,
      personalizationReviewCount: 0,
      excludedCount: 0,
      duplicateCount: 0,
      missingAddressCount: rows.length,
      missingPersonalizationCount: 0,
      detectedColumns,
      targetGroups: [],
      recommendedTargetGroups: [],
      recipientDecisionMatrix: {
        send: [],
        hold: [
          {
            label: "주소 열 지정 필요",
            count: rows.length,
            reason: "이메일/연락처 열을 찾기 전까지 누구에게도 발송하지 않습니다.",
          },
        ],
        exclude: [],
      },
      exclusionRuleSummary: createExclusionRuleSummary({
        detectedColumns,
        excludedCount: 0,
        duplicateCount: 0,
        missingAddressCount: rows.length,
      }),
      exclusionReasonBreakdown: createExclusionReasonBreakdown({
        detectedColumns,
        excludedCount: 0,
        duplicateCount: 0,
        missingAddressCount: rows.length,
      }),
      groupSamplePreviews: [],
      personalizationGapSummary: ["주소 열을 찾은 뒤 개인화 누락 값을 다시 확인합니다."],
      recipientDecisionSummary: "이메일/연락처 열을 찾지 못해 발송 대상 그룹을 추천하지 않았습니다.",
      nextReviewFocus: "주소 열을 지정한 뒤 수신거부/제외/중복 규칙을 다시 확인하세요.",
      samplePreviews: [],
      dryRunSummary: {
        wouldSendCount: 0,
        wouldExcludeCount: rows.length,
        readyForSampleCount: 0,
        personalizationReviewCount: 0,
        sampleSize: 0,
        blockedReason: "이메일/연락처 열을 찾지 못해 발송 대상 후보를 만들지 않았습니다.",
      },
      checklist: baseChecklist(),
      approvalGate: "이메일/연락처 열을 사용자가 지정하기 전까지 명단을 발송 대상으로 쓰지 않습니다.",
      privacyBoundary: privacyBoundary(),
    };
  }

  const seenAddresses = new Set<string>();
  const targetGroupCounts = new Map<string, number>();
  const samplePreviews: ModyMailRecipientListReview["samplePreviews"] = [];
  let validRecipientCount = 0;
  let readyForSampleCount = 0;
  let personalizationReviewCount = 0;
  let excludedCount = 0;
  let duplicateCount = 0;
  let missingAddressCount = 0;
  let missingPersonalizationCount = 0;
  const groupSampleStats = new Map<string, {
    validCount: number;
    sampleCount: number;
    readySampleCount: number;
    reviewSampleCount: number;
    personalizationKeys: Set<string>;
    missingPersonalizationKeys: Set<string>;
    riskLabels: Set<string>;
  }>();

  for (const [index, row] of rows.entries()) {
    const address = normalizeAddress(row[detectedColumns.addressColumn]);
    const excluded = isExcluded(row[detectedColumns.excludeColumn ?? ""]);
    const groupLabel = cleanLabel(String(row[detectedColumns.groupColumn ?? ""] ?? "")) || "기본 대상";
    const missingPersonalizationKeys = detectedColumns.personalizationColumns.filter((column) => isBlankCell(row[column]));
    const riskLabels: string[] = [];

    if (!address) {
      missingAddressCount += 1;
      riskLabels.push("주소 없음");
    }
    if (excluded) {
      excludedCount += 1;
      riskLabels.push("제외 표시");
    }
    if (address && seenAddresses.has(address)) {
      duplicateCount += 1;
      riskLabels.push("중복 주소");
    }
    if (missingPersonalizationKeys.length > 0) {
      missingPersonalizationCount += 1;
      riskLabels.push(`개인화 누락: ${missingPersonalizationKeys.slice(0, 3).join(", ")}`);
    }

    const ready = Boolean(address) && !excluded && !seenAddresses.has(address);
    const sampleStatus = ready && missingPersonalizationKeys.length === 0 ? "ready_for_sample" : "needs_review";
    const sampleRiskLabels = riskLabels.length ? riskLabels : ["원문 주소 비노출"];
    let sampleRecorded = false;
    if (ready) {
      validRecipientCount += 1;
      if (missingPersonalizationKeys.length === 0) {
        readyForSampleCount += 1;
      } else {
        personalizationReviewCount += 1;
      }
      targetGroupCounts.set(groupLabel, (targetGroupCounts.get(groupLabel) ?? 0) + 1);
      if (samplePreviews.length < sampleSize) {
        samplePreviews.push({
          id: `sample-${index + 1}`,
          groupLabel,
          personalizationKeys: detectedColumns.personalizationColumns.slice(0, 6),
          missingPersonalizationKeys: missingPersonalizationKeys.slice(0, 6),
          riskLabels: sampleRiskLabels,
          status: sampleStatus,
        });
        sampleRecorded = true;
      }
    } else if (samplePreviews.length < sampleSize && riskLabels.length > 0) {
      samplePreviews.push({
        id: `sample-${index + 1}`,
        groupLabel,
        personalizationKeys: detectedColumns.personalizationColumns.slice(0, 6),
        missingPersonalizationKeys: missingPersonalizationKeys.slice(0, 6),
        riskLabels,
        status: "needs_review",
      });
      sampleRecorded = true;
    }
    if (ready || riskLabels.length > 0) {
      collectGroupSampleStat(groupSampleStats, {
        groupLabel,
        ready,
        sampleRecorded,
        status: sampleStatus,
        personalizationKeys: detectedColumns.personalizationColumns,
        missingPersonalizationKeys,
        riskLabels: sampleRiskLabels,
      });
    }

    if (address) seenAddresses.add(address);
  }

  const targetGroups = [...targetGroupCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko-KR"))
    .slice(0, 12);
  const recommendedTargetGroups = createRecommendedTargetGroups(targetGroups, detectedColumns);
  const recipientDecisionMatrix = createRecipientDecisionMatrix({
    recommendedTargetGroups,
    detectedColumns,
    excludedCount,
    duplicateCount,
    missingAddressCount,
    missingPersonalizationCount,
    personalizationReviewCount,
  });
  const exclusionRuleSummary = createExclusionRuleSummary({
    detectedColumns,
    excludedCount,
    duplicateCount,
    missingAddressCount,
  });
  const exclusionReasonBreakdown = createExclusionReasonBreakdown({
    detectedColumns,
    excludedCount,
    duplicateCount,
    missingAddressCount,
  });
  const groupSamplePreviews = createGroupSamplePreviews(groupSampleStats);
  const personalizationGapSummary = createPersonalizationGapSummary({
    detectedColumns,
    missingPersonalizationCount,
    groupSamplePreviews,
  });

  return {
    status: "review_required",
    sourceLabel,
    sourceType,
    rowCount: rows.length,
    candidateCount: rows.length,
    validRecipientCount,
    readyForSampleCount,
    personalizationReviewCount,
    excludedCount,
    duplicateCount,
    missingAddressCount,
    missingPersonalizationCount,
    detectedColumns,
    targetGroups,
    recommendedTargetGroups,
    recipientDecisionMatrix,
    exclusionRuleSummary,
    exclusionReasonBreakdown,
    groupSamplePreviews,
    personalizationGapSummary,
    recipientDecisionSummary: createRecipientDecisionSummary({
      validRecipientCount,
      readyForSampleCount,
      personalizationReviewCount,
      targetGroups,
      excludedCount,
      duplicateCount,
      missingAddressCount,
      missingPersonalizationCount,
    }),
    nextReviewFocus: createNextReviewFocus({
      detectedColumns,
      recommendedTargetGroups,
    excludedCount,
    duplicateCount,
    missingAddressCount,
    personalizationReviewCount,
  }),
    samplePreviews,
    dryRunSummary: {
      wouldSendCount: validRecipientCount,
      wouldExcludeCount: excludedCount + duplicateCount + missingAddressCount,
      readyForSampleCount,
      personalizationReviewCount,
      sampleSize: samplePreviews.length,
      blockedReason: "샘플 문안, 제외 대상, 중복 주소를 사용자가 확인하기 전까지 실제 발송하지 않습니다.",
    },
    checklist: baseChecklist(),
    approvalGate: "명단 기반 메일은 전체 주소 목록, 제외 대상, 샘플 문안을 확인한 뒤 최종 승인 전까지 발송하지 않습니다.",
    privacyBoundary: privacyBoundary(),
  };
}

function createEmptyReview(
  sourceLabel: string,
  sourceType: ModyMailRecipientListReview["sourceType"],
): ModyMailRecipientListReview {
  return {
    status: "empty",
    sourceLabel,
    sourceType,
    rowCount: 0,
    candidateCount: 0,
    validRecipientCount: 0,
    readyForSampleCount: 0,
    personalizationReviewCount: 0,
    excludedCount: 0,
    duplicateCount: 0,
    missingAddressCount: 0,
    missingPersonalizationCount: 0,
    detectedColumns: { personalizationColumns: [] },
    targetGroups: [],
    recommendedTargetGroups: [],
    recipientDecisionMatrix: {
      send: [],
      hold: [
        {
          label: "최신 명단 필요",
          count: 0,
          reason: "명단 행이 없어 발송 후보를 만들지 않았습니다.",
        },
      ],
      exclude: [],
    },
    exclusionRuleSummary: ["명단 행이 없어 제외/중복 규칙을 적용하지 않았습니다."],
    exclusionReasonBreakdown: [],
    groupSamplePreviews: [],
    personalizationGapSummary: ["명단 행이 없어 개인화 값을 확인하지 않았습니다."],
    recipientDecisionSummary: "명단 행이 없어 발송 대상 그룹을 추천하지 않았습니다.",
    nextReviewFocus: "최신 명단 파일을 다시 선택한 뒤 주소/제외 열을 확인하세요.",
    samplePreviews: [],
    dryRunSummary: {
      wouldSendCount: 0,
      wouldExcludeCount: 0,
      readyForSampleCount: 0,
      personalizationReviewCount: 0,
      sampleSize: 0,
      blockedReason: "명단 행이 없어 발송 대상 후보를 만들지 않았습니다.",
    },
    checklist: baseChecklist(),
    approvalGate: "명단이 비어 있어 발송 대상으로 쓸 수 없습니다.",
    privacyBoundary: privacyBoundary(),
  };
}

function detectRecipientColumns(headers: string[]): ModyMailRecipientListReview["detectedColumns"] {
  const addressColumn = findHeader(headers, /(email|e-mail|메일|이메일|주소|수신자|연락처)/iu);
  const nameColumn = findHeader(headers, /(name|이름|성명|성함|담당자|수신자명)/iu);
  const groupColumn = findHeader(headers, /(group|segment|분류|그룹|대상|회원구분|고객구분|소속|기관|회사)/iu);
  const excludeColumn = findHeader(headers, /(exclude|opt.?out|unsubscribe|수신거부|제외|발송제외|거부|중지)/iu);
  const personalizationColumns = headers
    .filter((header) =>
      /(name|이름|성명|성함|기관|회사|소속|일정|예약|금액|마감|기한|등급|메모|담당자|custom|개인화)/iu.test(header),
    )
    .filter((header) => header !== addressColumn && header !== excludeColumn)
    .slice(0, 12);

  return {
    ...(addressColumn ? { addressColumn } : {}),
    ...(nameColumn ? { nameColumn } : {}),
    ...(groupColumn ? { groupColumn } : {}),
    ...(excludeColumn ? { excludeColumn } : {}),
    personalizationColumns,
  };
}

function baseChecklist(): string[] {
  return [
    "전체 행 수와 발송 후보 수 확인",
    "추천 대상 그룹과 추천 이유 확인",
    "바로 샘플 가능 후보와 개인화 확인 필요 후보 분리",
    "수신 거부/제외 대상 확인",
    "중복 주소와 주소 누락 확인",
    "샘플 문안의 개인화 값 확인",
    "최종 승인 전 실제 발송 차단",
  ];
}

function createRecommendedTargetGroups(
  targetGroups: ModyMailRecipientListReview["targetGroups"],
  detectedColumns: ModyMailRecipientListReview["detectedColumns"],
): ModyMailRecipientListReview["recommendedTargetGroups"] {
  return targetGroups.slice(0, 5).map((group, index) => ({
    label: group.label,
    count: group.count,
    reason: [
      index === 0 ? "가장 많은 유효 발송 후보가 있는 그룹" : "유효 주소가 확인된 대상 그룹",
      detectedColumns.groupColumn ? `${detectedColumns.groupColumn} 열 기준` : "그룹 열 미지정 상태",
      detectedColumns.personalizationColumns.length > 0
        ? `개인화 열 ${detectedColumns.personalizationColumns.slice(0, 3).join(", ")} 확인 가능`
        : "개인화 열 추가 확인 필요",
    ].join(" · "),
  }));
}

function createRecipientDecisionMatrix(input: {
  recommendedTargetGroups: ModyMailRecipientListReview["recommendedTargetGroups"];
  detectedColumns: ModyMailRecipientListReview["detectedColumns"];
  excludedCount: number;
  duplicateCount: number;
  missingAddressCount: number;
  missingPersonalizationCount: number;
  personalizationReviewCount: number;
}): ModyMailRecipientListReview["recipientDecisionMatrix"] {
  const send = input.recommendedTargetGroups.slice(0, 5).map((group) => ({
    label: group.label,
    count: group.count,
    reason: group.reason,
  }));
  const hold: ModyMailRecipientListReview["recipientDecisionMatrix"]["hold"] = [];
  if (!input.detectedColumns.excludeColumn) {
    hold.push({
      label: "별도 제외 명단 대조 필요",
      count: send.reduce((total, group) => total + group.count, 0),
      reason: "수신거부/제외 열을 찾지 못해 발송 전 별도 제외 명단과 대조해야 합니다.",
    });
  }
  if (input.duplicateCount > 0) {
    hold.push({
      label: "중복 주소 정리",
      count: input.duplicateCount,
      reason: "같은 주소가 여러 번 발견되어 원본 명단에서 한 번만 보낼지 확인해야 합니다.",
    });
  }
  if (input.missingAddressCount > 0) {
    hold.push({
      label: "주소 누락 보류",
      count: input.missingAddressCount,
      reason: "주소가 없는 행은 연락처를 보완하기 전까지 발송 후보에서 제외합니다.",
    });
  }
  if (input.personalizationReviewCount > 0) {
    hold.push({
      label: "개인화 값 확인 필요",
      count: input.personalizationReviewCount,
      reason: "주소는 유효하지만 이름, 회사, 일정 같은 개인화 값이 비어 있어 샘플 문안에서 대체 문구를 확인해야 합니다.",
    });
  }
  const exclude = input.excludedCount > 0
    ? [
        {
          label: "수신거부/제외 표시",
          count: input.excludedCount,
          reason: `${input.detectedColumns.excludeColumn ?? "제외"} 열 기준으로 발송 대상에서 제외합니다.`,
        },
      ]
    : [];

  return { send, hold, exclude };
}

function createExclusionRuleSummary(input: {
  detectedColumns: ModyMailRecipientListReview["detectedColumns"];
  excludedCount: number;
  duplicateCount: number;
  missingAddressCount: number;
}): string[] {
  const rules = [
    input.detectedColumns.excludeColumn
      ? `${input.detectedColumns.excludeColumn} 열의 수신거부/제외 표시 ${input.excludedCount}건 제외`
      : "수신거부/제외 열을 찾지 못했습니다.",
    `중복 주소 ${input.duplicateCount}건 제외`,
    `주소 누락 ${input.missingAddressCount}건 제외`,
  ];
  if (input.detectedColumns.addressColumn) {
    rules.unshift(`${input.detectedColumns.addressColumn} 열을 발송 주소 기준으로 사용`);
  }
  return rules;
}

function createExclusionReasonBreakdown(input: {
  detectedColumns: ModyMailRecipientListReview["detectedColumns"];
  excludedCount: number;
  duplicateCount: number;
  missingAddressCount: number;
}): ModyMailRecipientListReview["exclusionReasonBreakdown"] {
  return [
    input.excludedCount > 0
      ? {
          label: "수신거부/제외 표시",
          count: input.excludedCount,
          reason: `${input.detectedColumns.excludeColumn ?? "제외"} 열 기준으로 발송 대상에서 제외합니다.`,
        }
      : null,
    input.duplicateCount > 0
      ? {
          label: "중복 주소",
          count: input.duplicateCount,
          reason: "같은 주소는 한 번만 보낼지 최종 확인 전까지 보류합니다.",
        }
      : null,
    input.missingAddressCount > 0
      ? {
          label: "주소 누락",
          count: input.missingAddressCount,
          reason: "발송 주소가 없는 행은 주소 보완 전까지 제외합니다.",
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function collectGroupSampleStat(
  stats: Map<string, {
    validCount: number;
    sampleCount: number;
    readySampleCount: number;
    reviewSampleCount: number;
    personalizationKeys: Set<string>;
    missingPersonalizationKeys: Set<string>;
    riskLabels: Set<string>;
  }>,
  input: {
    groupLabel: string;
    ready: boolean;
    sampleRecorded: boolean;
    status: "ready_for_sample" | "needs_review";
    personalizationKeys: string[];
    missingPersonalizationKeys: string[];
    riskLabels: string[];
  },
) {
  const current = stats.get(input.groupLabel) ?? {
    validCount: 0,
    sampleCount: 0,
    readySampleCount: 0,
    reviewSampleCount: 0,
    personalizationKeys: new Set<string>(),
    missingPersonalizationKeys: new Set<string>(),
    riskLabels: new Set<string>(),
  };
  if (input.ready) current.validCount += 1;
  if (input.sampleRecorded) current.sampleCount += 1;
  if (input.status === "ready_for_sample") current.readySampleCount += 1;
  if (input.status === "needs_review") current.reviewSampleCount += 1;
  for (const key of input.personalizationKeys.slice(0, 12)) current.personalizationKeys.add(key);
  for (const key of input.missingPersonalizationKeys.slice(0, 12)) current.missingPersonalizationKeys.add(key);
  for (const label of input.riskLabels.slice(0, 12)) current.riskLabels.add(label);
  stats.set(input.groupLabel, current);
}

function createGroupSamplePreviews(
  stats: Map<string, {
    validCount: number;
    sampleCount: number;
    readySampleCount: number;
    reviewSampleCount: number;
    personalizationKeys: Set<string>;
    missingPersonalizationKeys: Set<string>;
    riskLabels: Set<string>;
  }>,
): ModyMailRecipientListReview["groupSamplePreviews"] {
  return [...stats.entries()]
    .map(([groupLabel, value]) => ({
      groupLabel,
      validCount: value.validCount,
      sampleCount: value.sampleCount,
      readySampleCount: value.readySampleCount,
      reviewSampleCount: value.reviewSampleCount,
      personalizationKeys: [...value.personalizationKeys].slice(0, 8),
      missingPersonalizationKeys: [...value.missingPersonalizationKeys].slice(0, 8),
      riskLabels: [...value.riskLabels].slice(0, 8),
    }))
    .sort((a, b) => b.validCount - a.validCount || b.sampleCount - a.sampleCount || a.groupLabel.localeCompare(b.groupLabel, "ko-KR"))
    .slice(0, 8);
}

function createPersonalizationGapSummary(input: {
  detectedColumns: ModyMailRecipientListReview["detectedColumns"];
  missingPersonalizationCount: number;
  groupSamplePreviews: ModyMailRecipientListReview["groupSamplePreviews"];
}): string[] {
  if (input.detectedColumns.personalizationColumns.length === 0) {
    return ["개인화 열을 찾지 못했습니다. 이름, 회사, 일정, 금액 같은 열을 추가하면 샘플 문안 품질이 올라갑니다."];
  }
  if (input.missingPersonalizationCount === 0) {
    return [`개인화 열 ${input.detectedColumns.personalizationColumns.slice(0, 4).join(", ")} 값이 샘플에서 확인되었습니다.`];
  }
  const missingKeys = [...new Set(input.groupSamplePreviews.flatMap((group) => group.missingPersonalizationKeys))].slice(0, 5);
  return [
    `개인화 값 누락 ${input.missingPersonalizationCount}행을 샘플 문안에서 확인해야 합니다.`,
    missingKeys.length ? `누락 열: ${missingKeys.join(", ")}` : "",
    "누락 값은 빈칸으로 발송하지 않고 대체 문구 또는 보류 처리해야 합니다.",
  ].filter(Boolean);
}

function createRecipientDecisionSummary(input: {
  validRecipientCount: number;
  readyForSampleCount: number;
  personalizationReviewCount: number;
  targetGroups: ModyMailRecipientListReview["targetGroups"];
  excludedCount: number;
  duplicateCount: number;
  missingAddressCount: number;
  missingPersonalizationCount?: number;
}): string {
  const primaryGroup = input.targetGroups[0];
  const groupText = primaryGroup
    ? `${primaryGroup.label} ${primaryGroup.count}건을 우선 추천`
    : "대상 그룹을 자동 추천하지 못함";
  const exceptionCount = input.excludedCount + input.duplicateCount + input.missingAddressCount;
  const personalizationText = input.missingPersonalizationCount
    ? ` 개인화 누락 ${input.missingPersonalizationCount}건도 샘플에서 확인해야 합니다.`
    : "";
  const readinessText = ` 바로 샘플 가능 ${input.readyForSampleCount}건, 개인화 확인 필요 ${input.personalizationReviewCount}건입니다.`;
  return `${groupText}. 전체 발송 후보 ${input.validRecipientCount}건, 제외/중복/누락 ${exceptionCount}건을 최종 확인해야 합니다.${readinessText}${personalizationText}`;
}

function createNextReviewFocus(input: {
  detectedColumns: ModyMailRecipientListReview["detectedColumns"];
  recommendedTargetGroups: ModyMailRecipientListReview["recommendedTargetGroups"];
  excludedCount: number;
  duplicateCount: number;
  missingAddressCount: number;
  personalizationReviewCount: number;
}): string {
  if (input.recommendedTargetGroups.length === 0) {
    return "주소 열과 대상 그룹 열을 지정한 뒤 다시 검토하세요.";
  }
  if (!input.detectedColumns.excludeColumn) {
    return "수신거부/제외 열이 없어 별도 제외 명단과 대조해야 합니다.";
  }
  if (input.duplicateCount > 0 || input.missingAddressCount > 0) {
    return "중복 주소와 주소 누락 행을 원본 명단에서 정리한 뒤 샘플 문안을 확인하세요.";
  }
  if (input.personalizationReviewCount > 0) {
    return "개인화 확인 필요 후보의 대체 문구를 샘플 문안에서 확인한 뒤 dry-run을 진행하세요.";
  }
  return "추천 대상 그룹과 샘플 개인화 값을 확인한 뒤 dry-run을 진행하세요.";
}

function normalizeRow(row: ModyMailRecipientListRow): ModyMailRecipientListRow {
  const normalized: ModyMailRecipientListRow = {};
  for (const [key, value] of Object.entries(row ?? {})) {
    const cleanKey = cleanLabel(key);
    if (!cleanKey) continue;
    normalized[cleanKey] = typeof value === "string" ? value.trim() : value;
  }
  return normalized;
}

function normalizeAddress(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  const match = raw.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu);
  return match?.[0].toLowerCase() ?? "";
}

function isExcluded(value: unknown): boolean {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return /^(1|true|yes|y|제외|수신거부|거부|중지|opt.?out|unsubscribe)$/iu.test(text);
}

function isBlankCell(value: unknown): boolean {
  return String(value ?? "").trim().length === 0;
}

function findHeader(headers: string[], pattern: RegExp): string | undefined {
  return headers.find((header) => pattern.test(header));
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(cleanLabel).filter(Boolean))];
}

function cleanLabel(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function privacyBoundary(): string {
  return "명단 분석은 주소/이름 원문을 반환하지 않고, 그룹/카운트/샘플 번호/검토 규칙만 제공합니다.";
}
