/**
 * 직원 → 크루 스킬 직무·팀 판정. 기본 전문가 판정과 통합 전 직무 id 별칭은 도메인 정본(getBuiltinExpert)을 그대로 쓴다.
 * 채팅 도구 모듈(crew-skills.ts)은 도메인을 직접 불러오지 않도록 이 판정만 따로 둔다.
 */
import { getBuiltinExpert } from "../../../packages/domain/dist/builtin-experts.js";

const knownTemplateIds = new Set(["operations", "mail", "desktop", "marketing", "development", "finance", "legal", "personal", "custom"]);

/** 크루 스킬을 보는 직무 id. 기본 비서는 모든 크루 스킬을 본다. 모르는 직원은 "". */
export function crewSkillRoleIdForTeammate(teammate: { id?: string; builtinExpertId?: string } | null | undefined): string {
  if (!teammate) return "";
  if (teammate.id === "teammate-personal-operator") return "personal-operator";
  return getBuiltinExpert(teammate)?.id ?? "";
}

/** 팀(템플릿) id — 기본 전문가는 정본의 팀, 템플릿으로 만든 직원은 저장 id(teammate-<팀>-<시각>)에서 읽는다. */
export function crewSkillTemplateIdForTeammate(teammate: { id?: string; builtinExpertId?: string; templateId?: string } | null | undefined): string {
  if (!teammate) return "";
  const expert = getBuiltinExpert(teammate);
  if (expert) return expert.templateId;
  if (typeof teammate.templateId === "string" && knownTemplateIds.has(teammate.templateId)) return teammate.templateId;
  const parsed = /^teammate-([a-z]+)-\d+$/u.exec(String(teammate.id ?? ""))?.[1] ?? "";
  return knownTemplateIds.has(parsed) ? parsed : "";
}

