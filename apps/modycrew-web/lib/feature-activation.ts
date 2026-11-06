"use client";

const STORAGE_KEY = "modycrew.featureActivation.v1";
const defaultActiveFeatureIds = new Set<ModyFeatureId>(["desktop_control"]);

export type ModyFeatureId =
  | "work_intake"
  | "connector_recommendations"
  | "automation_monitoring"
  | "document_learning"
  | "remote_desktop_relay"
  | "desktop_control"
  | "approval_execution";

export type ModyFeatureActivationStatus = "available" | "active" | "paused";

export type ModyFeatureDefinition = {
  id: ModyFeatureId;
  title: string;
  description: string;
  activationLabel: string;
  pauseLabel: string;
  safetyBoundary: string;
  intentKeywords: string[];
};

export type ModyFeatureActivationRecord = {
  id: ModyFeatureId;
  status: ModyFeatureActivationStatus;
  activatedAt?: string;
  pausedAt?: string;
  lastIntent?: string;
};

export const featureCatalog: ModyFeatureDefinition[] = [
  {
    id: "work_intake",
    title: "업무 처리",
    description: "사용자가 입력한 일을 읽고 답장 초안, 확인 질문, 승인 후보를 만듭니다.",
    activationLabel: "업무 처리 켜기",
    pauseLabel: "업무 처리 끄기",
    safetyBoundary: "외부 발송이나 일정 등록은 승인 전 실행하지 않습니다.",
    intentKeywords: ["처리", "초안", "답장", "정리", "업무", "문의"],
  },
  {
    id: "connector_recommendations",
    title: "연결 추천",
    description: "사용자가 말한 목표에 필요한 메일, 캘린더, 메신저, 파일 연결을 제안합니다.",
    activationLabel: "연결 추천 켜기",
    pauseLabel: "연결 추천 끄기",
    safetyBoundary: "연결 전에는 자격증명 원문을 저장하지 않습니다.",
    intentKeywords: ["연결", "메일", "캘린더", "텔레그램", "슬랙", "도구"],
  },
  {
    id: "automation_monitoring",
    title: "자동 감시",
    description: "사용자가 켠 규칙만 수동 또는 주기적으로 확인해 새 업무를 만듭니다.",
    activationLabel: "자동 감시 켜기",
    pauseLabel: "자동 감시 끄기",
    safetyBoundary: "꺼진 반복 업무는 실행하지 않고, 켜진 반복 업무도 승인 경계를 우회하지 않습니다.",
    intentKeywords: ["자동화", "감시", "매일", "주기", "트리거", "알아서"],
  },
  {
    id: "document_learning",
    title: "자료 학습",
    description: "사용자가 지정한 파일이나 폴더를 업무 지식으로 정리합니다.",
    activationLabel: "자료 학습 켜기",
    pauseLabel: "자료 학습 끄기",
    safetyBoundary: "사용자가 지정하지 않은 로컬 폴더는 읽지 않습니다.",
    intentKeywords: ["문서", "자료", "pdf", "엑셀", "파일", "보고서"],
  },
  {
    id: "remote_desktop_relay",
    title: "다른 PC 맡기기",
    description: "같은 계정의 켜진 데스크톱 앱에 노트북에서 업무를 맡깁니다.",
    activationLabel: "PC 릴레이 켜기",
    pauseLabel: "PC 릴레이 끄기",
    safetyBoundary: "같은 계정 안에서만 요청하고 비밀값 원문은 relay에 저장하지 않습니다.",
    intentKeywords: ["노트북", "데스크톱", "pc", "원격", "다른 컴퓨터", "맡겨"],
  },
  {
    id: "desktop_control",
    title: "컴퓨터 조작",
    description: "설치된 데스크톱 앱에서 창 확인, URL 준비, 파일 열기 요청을 안전 모드로 보냅니다.",
    activationLabel: "컴퓨터 조작 켜기",
    pauseLabel: "컴퓨터 조작 끄기",
    safetyBoundary: "클릭, 입력, 파일 쓰기 같은 변경 작업은 최종 사용자 확인 전 차단합니다.",
    intentKeywords: ["컴퓨터", "조작", "화면", "창", "클릭", "입력", "브라우저", "앱"],
  },
  {
    id: "approval_execution",
    title: "승인 실행",
    description: "발송, 일정 등록, 파일 공유 같은 변경 작업을 승인 후 실행합니다.",
    activationLabel: "승인 실행 켜기",
    pauseLabel: "승인 실행 끄기",
    safetyBoundary: "고위험 업무는 승인 기록이 있어도 정책상 차단될 수 있습니다.",
    intentKeywords: ["승인", "발송", "등록", "공유", "실행", "보내"],
  },
];

export function readFeatureActivationRecords(): ModyFeatureActivationRecord[] {
  if (typeof window === "undefined") return initialRecords();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialRecords();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return initialRecords();
    const stored = parsed.filter(isFeatureRecord);
    return mergeWithCatalog(stored);
  } catch {
    return initialRecords();
  }
}

export function applyFeatureActivationRecords(
  records: ModyFeatureActivationRecord[],
): ModyFeatureActivationRecord[] {
  const next = mergeWithCatalog(records.filter(isFeatureRecord));
  writeFeatureActivationRecords(next);
  return next;
}

export function activateFeature(
  featureId: ModyFeatureId,
  intent?: string,
): ModyFeatureActivationRecord[] {
  const now = new Date().toISOString();
  const next = readFeatureActivationRecords().map((record) =>
    record.id === featureId
      ? {
          ...record,
          status: "active" as const,
          activatedAt: now,
          pausedAt: undefined,
          lastIntent: sanitizeIntent(intent),
        }
      : record,
  );
  writeFeatureActivationRecords(next);
  return next;
}

export function activateFeatureSet(
  featureIds: readonly ModyFeatureId[],
  intent?: string,
): ModyFeatureActivationRecord[] {
  const now = new Date().toISOString();
  const requested = new Set(featureIds);
  const next = readFeatureActivationRecords().map((record) =>
    requested.has(record.id)
      ? {
          ...record,
          status: "active" as const,
          activatedAt: record.activatedAt ?? now,
          pausedAt: undefined,
          lastIntent: sanitizeIntent(intent),
        }
      : record,
  );
  writeFeatureActivationRecords(next);
  return next;
}

export function pauseFeature(featureId: ModyFeatureId): ModyFeatureActivationRecord[] {
  const now = new Date().toISOString();
  const next = readFeatureActivationRecords().map((record) =>
    record.id === featureId
      ? {
          ...record,
          status: "paused" as const,
          pausedAt: now,
        }
      : record,
  );
  writeFeatureActivationRecords(next);
  return next;
}

export function isFeatureActive(
  records: ModyFeatureActivationRecord[],
  featureId: ModyFeatureId,
): boolean {
  return records.some((record) => record.id === featureId && record.status === "active");
}

export function suggestFeatureActivations(intent: string): ModyFeatureDefinition[] {
  const normalized = intent.toLowerCase();
  if (!normalized.trim()) return [];
  return featureCatalog
    .filter((feature) =>
      feature.intentKeywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
    )
    .slice(0, 3);
}

export function countActiveFeatures(records: ModyFeatureActivationRecord[]): number {
  return records.filter((record) => record.status === "active").length;
}

function initialRecords(): ModyFeatureActivationRecord[] {
  return featureCatalog.map(createDefaultFeatureRecord);
}

function mergeWithCatalog(records: ModyFeatureActivationRecord[]): ModyFeatureActivationRecord[] {
  return featureCatalog.map((feature) => {
    const found = records.find((record) => record.id === feature.id);
    return found ?? createDefaultFeatureRecord(feature);
  });
}

function createDefaultFeatureRecord(feature: ModyFeatureDefinition): ModyFeatureActivationRecord {
  if (defaultActiveFeatureIds.has(feature.id)) {
    return {
      id: feature.id,
      status: "active",
      lastIntent: "앱 설치 시 포함된 읽기·준비 안전 모드",
    };
  }
  return { id: feature.id, status: "available" };
}

function writeFeatureActivationRecords(records: ModyFeatureActivationRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mergeWithCatalog(records)));
}

function isFeatureRecord(value: unknown): value is ModyFeatureActivationRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ModyFeatureActivationRecord>;
  return (
    isFeatureId(record.id) &&
    (record.status === "available" || record.status === "active" || record.status === "paused")
  );
}

function isFeatureId(value: unknown): value is ModyFeatureId {
  return featureCatalog.some((feature) => feature.id === value);
}

function sanitizeIntent(value: unknown): string | undefined {
  const text = String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]")
    .replace(/\b(?:sk|pk|rk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  return text || undefined;
}
