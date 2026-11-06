   
                                                    
  
                                                   
                                             
                                                             
  
      
                                                  
                              
                                            
   

import {
  getLaunchReadyFeatureLauncherItems,
  type FeatureLauncherCatalogItem,
} from "./feature-launcher-catalog";
import { sampleConnectors, triggerLabels, type ConnectorDefinition } from "./connectors";
import { defaultAISkillPacks, type AISkillPack } from "./ai-skills";

export type CapabilityKind = "feature" | "connector" | "skill";

export type CapabilityEntry = {
  /** 안정 id — 예: cap.feature.feature-mail / cap.connector.gmail / cap.skill.folder_organizer */
  id: string;
  kind: CapabilityKind;
  label: string;
  /** 모델 프롬프트용 한 줄 설명 (≤ ~90자) */
  oneLineDesc: string;
  /** 의도 매칭 힌트 (키워드/트리거 라벨) */
  triggerHints: string[];
  /** 실행 진입점 (page.tsx HomeAction 문자열). 없으면 connectorId/skillId 로 해석 */
  homeAction?: string;
  /** 커넥터 항목의 대상 커넥터 */
  connectorId?: string;
  /** 스킬 항목의 대상 스킬 */
  skillId?: string;
  /** 동률일 때 정렬 가중치 (커넥터 recommendScore 등) */
  weight: number;
};

/** 커넥터 카테고리 → 대표 진입 HomeAction. 매핑이 없는 카테고리는 connectorId 딥링크로 해석. */
const connectorCategoryHomeAction: Record<string, string> = {
  mail: "mail_connection",
  calendar: "calendar_connection",
  messenger: "messenger_connectors",
  ai: "ai_settings",
};

function clampDesc(value: string, max = 90): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function featureEntry(item: FeatureLauncherCatalogItem): CapabilityEntry {
  return {
    id: `cap.feature.${item.id}`,
    kind: "feature",
    label: item.userLabel,
    oneLineDesc: clampDesc(item.nextUserChoice || item.evidenceSummary || item.userLabel),
    triggerHints: [item.userLabel, item.runtimeProofLabel].filter(Boolean),
    homeAction: item.homeAction,
    weight: 50,
  };
}

function connectorEntry(connector: ConnectorDefinition): CapabilityEntry {
  return {
    id: `cap.connector.${connector.id}`,
    kind: "connector",
    label: connector.label,
    oneLineDesc: clampDesc(connector.shortDescription),
    triggerHints: [
      connector.label,
      ...connector.triggers.map((trigger) => triggerLabels[trigger] ?? trigger),
    ],
    homeAction: connectorCategoryHomeAction[connector.category],
    connectorId: connector.id,
    weight: connector.recommendScore,
  };
}

function skillEntry(skill: AISkillPack): CapabilityEntry {
  return {
    id: `cap.skill.${skill.id}`,
    kind: "skill",
    label: skill.crewKitLabel ?? skill.title,
    oneLineDesc: clampDesc(skill.summary),
    triggerHints: [...(skill.triggerKeywords ?? []), skill.title],
    skillId: skill.id,
    weight: 40,
  };
}

let cachedRegistry: CapabilityEntry[] | null = null;

/** 모델/라우터가 고를 수 있는 전체 역량 목록 (메모이즈) */
export function getCapabilityRegistry(): CapabilityEntry[] {
  if (cachedRegistry) return cachedRegistry;
  const entries: CapabilityEntry[] = [
    ...getLaunchReadyFeatureLauncherItems().map(featureEntry),
    ...sampleConnectors.map(connectorEntry),
    ...defaultAISkillPacks.map(skillEntry),
  ];
  // id 중복 방지(소스 카탈로그 간 충돌은 설계상 없지만 안전망)
  const seen = new Set<string>();
  cachedRegistry = entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  return cachedRegistry;
}

export function findCapabilityEntry(id: string): CapabilityEntry | null {
  const normalized = String(id ?? "").trim();
  if (!normalized) return null;
  return getCapabilityRegistry().find((entry) => entry.id === normalized) ?? null;
}

/**
 * 모델 프롬프트용 컴팩트 블록 — 항목당 한 줄(id | 라벨 | 설명).
 * 전체 스킬 지침/메신저 설정 덤프를 대체합니다(Phase 5).
 */
export function formatCapabilityRegistryForPrompt(
  entries: CapabilityEntry[] = getCapabilityRegistry(),
): string {
  return entries
    .map((entry) => `${entry.id} | ${entry.label} | ${entry.oneLineDesc}`)
    .join("\n");
}

/**
 * Pass A(경량 분류 호출)용 프롬프트 — 모델이 목록에서 정확히 하나만 고르도록 강제.
 * 구조화 출력에 의존하지 않는 자유텍스트 한 줄 규약입니다.
 */
export function buildCapabilitySelectionPrompt(text: string, recentConversation = ""): string {
  return [
    "당신은 대화 맥락을 이해해 필요한 경우에만 앱 기능을 제안하는 판단자입니다.",
    "반드시 정확히 한 줄만 출력하세요: CAPABILITY=<id>|CONFIDENCE=<0~1 숫자>",
    "사용자가 실제로 작업 실행, 화면 열기, 계정 연결, 자료 읽기 같은 행동을 원할 때만 기능을 고르세요.",
    "단어가 등장했다는 이유만으로 고르지 마세요. 부정, 보류, 비교, 예시, 설명 질문, 다른 작업을 우선하라는 말은 문장 전체와 최근 대화로 판단하세요.",
    "일상 대화, 단순 질문, 설명 요청, 불만, 정정, 또는 확실하지 않으면: CAPABILITY=none|CONFIDENCE=1",
    "설명, 인사, 추가 문장은 절대 출력하지 마세요.",
    recentConversation.trim() ? "\n[최근 대화]\n" + recentConversation.trim() : "",
    "",
    "[기능 목록 — id | 이름 | 설명]",
    formatCapabilityRegistryForPrompt(),
    "",
    "[현재 사용자 메시지]",
    text,
  ].join("\n");
}
export type CapabilitySelection = {
  capabilityId: string | null;
  confidence: number;
};

/**
 * Pass A 응답 파싱 — strict 규약. 규약 밖 출력은 전부 "선택 없음"으로 처리해
 * 모델이 레지스트리 밖 실행을 트리거할 수 없게 합니다.
 */
export function parseCapabilitySelectionLine(outputText: string): CapabilitySelection {
  const match = /CAPABILITY=([A-Za-z0-9._-]+)(?:\s*\|\s*CONFIDENCE=([0-9]*\.?[0-9]+))?/u.exec(
    String(outputText ?? ""),
  );
  if (!match) return { capabilityId: null, confidence: 0 };
  const id = match[1].trim();
  if (!id || id.toLowerCase() === "none") return { capabilityId: null, confidence: 0 };
  if (!findCapabilityEntry(id)) return { capabilityId: null, confidence: 0 };
  // 신뢰도 누락 시: id 를 특정해 답한 것 자체가 결정적 선택이므로 통과 기본값을 줍니다.
  const confidence = match[2] ? Math.max(0, Math.min(1, Number(match[2]))) : 0.7;
  return { capabilityId: id, confidence };
}

/**
 * 키워드 힌트 기반 결정형 후보 선택 — 모델이 없거나 저신뢰일 때의 폴백.
 * 가장 많은 힌트가 매칭된 항목 하나(동률은 weight)를 반환합니다.
 */
export function findCapabilityByHints(text: string): CapabilityEntry | null {
  const lower = String(text ?? "").toLowerCase();
  if (!lower.trim()) return null;
  let best: { entry: CapabilityEntry; score: number } | null = null;
  for (const entry of getCapabilityRegistry()) {
    let score = 0;
    for (const hint of entry.triggerHints) {
      const normalizedHint = hint.toLowerCase().trim();
      if (normalizedHint.length >= 2 && lower.includes(normalizedHint)) {
        score += 3;
      }
    }
    if (score === 0) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && entry.weight > best.entry.weight)
    ) {
      best = { entry, score };
    }
  }
  return best?.entry ?? null;
}
