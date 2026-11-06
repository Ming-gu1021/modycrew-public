/**
 * 새로 들어온 메일 카드에 '먼저 볼 순서'와 '담당 AI 직원'을 붙인다.
 *
 * - 우선순위(priority)와 업무 종류(workCategory)는 도메인 메일 플래너가 이미 정해 둔다
 *   (Jev를 켰으면 Jev 긴급도·회신 확률·업무 종류를 함께 보고, 아니면 규칙만).
 * - 담당은 기존 에이전트 조직 배정(routeWorkRequest, 능력 태그 → 성공 이력 → 메인 비서)을
 *   그대로 쓴다. 여기서 새 배정 규칙을 만들지 않는다. 확실하지 않으면 메인 비서가 맡는다.
 * - 이 모듈은 카드에 표시할 값과 답장 초안 말투용 역할 문장만 만든다. 메일을 보내거나
 *   일정을 등록하거나 외부로 아무것도 내보내지 않는다(주소·본문도 다루지 않는다).
 */

export const MAIL_CARD_MASTER_TEAMMATE_ID = "teammate-personal-operator";

const priorityRank = Object.freeze({ urgent: 0, normal: 1, low: 2 });
const maxRoutedCandidatesPerRun = 24;

function cleanText(value, maxLength) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function safeTeammateId(value) {
  const id = cleanText(value, 120);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id) ? id : "";
}

/** 앱 프로필(local-memory load_app_profile)에서 담당 후보 목록만 꺼낸다. */
export function normalizeMailRoutingRoster(profile) {
  const masterId = safeTeammateId(profile?.appSettings?.mainControllerId) || MAIL_CARD_MASTER_TEAMMATE_ID;
  const teammates = Array.isArray(profile?.teammates) ? profile.teammates : [];
  const members = [];
  const seen = new Set();
  for (const teammate of teammates) {
    const id = safeTeammateId(teammate?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    members.push({
      id,
      name: cleanText(teammate.name, 60),
      roleTitle: cleanText(teammate.roleTitle, 80),
      brief: cleanText(teammate.brief, 240),
    });
  }
  const master = members.find((member) => member.id === masterId);
  return {
    masterId,
    masterName: master?.name || cleanText(profile?.appSettings?.mainControllerName, 60) || "업무 비서",
    masterRoleTitle: master?.roleTitle || "",
    members: members.filter((member) => member.id !== masterId),
  };
}

export function mailCandidatePriorityRank(candidate) {
  return priorityRank[candidate?.priority?.level] ?? priorityRank.normal;
}

/** 급한 메일부터(같은 등급이면 원래 순서). 배경 AI 초안이 급한 메일부터 쓰이게 한다. */
export function sortMailCandidatesByPriority(candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) =>
      mailCandidatePriorityRank(left.candidate) - mailCandidatePriorityRank(right.candidate) || left.index - right.index)
    .map(({ candidate }) => candidate);
}

function masterAssignee(roster, why) {
  return {
    teammateId: roster.masterId,
    name: roster.masterName,
    roleTitle: roster.masterRoleTitle,
    source: "default",
    reason: cleanText(`${why} ${roster.masterName}에게 맡겼어요.`, 200),
  };
}

/**
 * 한 메일 후보의 담당을 고른다. routeWorkRequest 는 에이전트 조직 배정(주입)이고,
 * 없거나 실패하거나 맞는 직원이 없으면 메인 비서에게 맡긴다.
 */
export async function chooseMailCandidateAssignee(candidate, roster, dependencies = {}) {
  const category = candidate?.workCategory;
  const keywords = Array.isArray(category?.routingKeywords) ? category.routingKeywords.map((word) => cleanText(word, 24)).filter(Boolean) : [];
  if (!roster.members.length) {
    return masterAssignee(roster, "따로 맡길 AI 직원이 아직 없어");
  }
  if (!keywords.length || category?.id === "other" || typeof dependencies.routeWorkRequest !== "function") {
    return masterAssignee(roster, "딱 맞는 담당이 없어");
  }
  // 업무 어휘만 넘긴다('메일' 같은 낱말은 메일 담당에게 늘 한 점을 더 주므로 넣지 않는다).
  // 메일 제목·본문·주소는 넘기지 않는다.
  const requestText = cleanText(`${keywords.join(" ")} ${cleanText(category.label, 24)}`, 200);
  const cache = dependencies.cache instanceof Map ? dependencies.cache : null;
  let routed = cache?.get(requestText);
  if (!routed) {
    routed = Promise.resolve()
      .then(() => dependencies.routeWorkRequest({
        requestText,
        allowedTeammateIds: roster.members.map((member) => member.id),
      }))
      .catch(() => null);
    cache?.set(requestText, routed);
  }
  const result = await routed;
  const routing = result?.routing;
  const primaryId = safeTeammateId(routing?.primary?.teammateId);
  const member = primaryId ? roster.members.find((item) => item.id === primaryId) : null;
  if (result?.status !== "agent_org_work_routed" || routing?.method === "master-fallback" || !member) {
    return masterAssignee(roster, `${cleanText(category.label, 24)} 메일을 맡을 직원이 따로 없어`);
  }
  const who = member.roleTitle ? `${member.name || "AI 직원"}(${member.roleTitle})` : member.name || "AI 직원";
  const why = category.source === "jev"
    ? `Jev가 ${cleanText(category.label, 24)} 메일로 봐서`
    : `${cleanText(category.label, 24)} 메일이라`;
  return {
    teammateId: member.id,
    name: member.name || member.roleTitle || "AI 직원",
    roleTitle: member.roleTitle,
    source: category.source === "jev" ? "jev" : "rule",
    reason: cleanText(`${why} ${who}에게 맡겼어요.`, 200),
    brief: member.brief,
  };
}

/**
 * 답장 초안을 쓸 때 참고할 역할 문장. 메인 비서면 넣지 않는다(기존 초안 그대로).
 * 사용자가 직원을 만들 때 적은 역할·소개만 쓰고, 메일 원문은 넣지 않는다.
 */
export function buildAssigneeRoleContext(assignee, roster) {
  if (!assignee || assignee.teammateId === roster?.masterId) return null;
  return {
    teammateId: assignee.teammateId,
    name: cleanText(assignee.name, 60),
    roleTitle: cleanText(assignee.roleTitle, 80),
    brief: cleanText(assignee.brief, 240),
  };
}

/**
 * 보고서의 메일 후보(카드가 될 것)에 담당을 붙인다. 후보 객체를 제자리에서 고친다.
 * 직원 목록을 못 읽거나 배정이 실패해도 자동 점검은 계속 간다 — 그때는 메인 비서가 맡는다.
 */
export async function assignMailCandidatesToTeammates(report, options = {}) {
  const candidates = (report?.candidates ?? []).filter(
    (candidate) => candidate?.sourceKind === "mail" && candidate.shouldCreateWorkItem,
  );
  if (!candidates.length) return { status: "mail_card_assignment_no_candidate", assigned: 0 };
  let profile = null;
  if (typeof options.loadTeammateRoster === "function") {
    try {
      profile = await options.loadTeammateRoster();
    } catch {
      profile = null;
    }
  }
  const roster = normalizeMailRoutingRoster(profile);
  const cache = new Map();
  let routedCount = 0;
  let assigned = 0;
  // 급한 메일부터 배정한다(한 번 점검에서 배정 호출 수를 제한하므로).
  for (const candidate of sortMailCandidatesByPriority(candidates)) {
    let assignee;
    if (routedCount >= maxRoutedCandidatesPerRun) {
      assignee = masterAssignee(roster, "한 번에 들어온 메일이 많아 먼저");
    } else {
      routedCount += 1;
      try {
        assignee = await chooseMailCandidateAssignee(candidate, roster, {
          routeWorkRequest: options.routeWorkRequest,
          cache,
        });
      } catch {
        assignee = masterAssignee(roster, "딱 맞는 담당이 없어");
      }
    }
    const roleContext = buildAssigneeRoleContext(assignee, roster);
    const { brief: _brief, ...publicAssignee } = assignee;
    candidate.assignee = publicAssignee;
    if (roleContext) candidate.assigneeRoleContext = roleContext;
    else delete candidate.assigneeRoleContext;
    assigned += 1;
  }
  return { status: "mail_card_assignment_ready", assigned, rosterSize: roster.members.length };
}

/**
 * 후보 → 카드 필드. 우선순위·업무 종류·담당만 옮긴다(숫자는 이미 반올림된 값, 이유는 한 줄).
 */
export function mailCardTriageFields(candidate) {
  if (!candidate || candidate.sourceKind !== "mail") return {};
  const fields = {};
  const priority = candidate.priority;
  if (priority && Object.hasOwn(priorityRank, priority.level)) {
    fields.priority = priority.level;
    const reason = cleanText(priority.reason, 160);
    if (reason) fields.priorityReason = reason;
    if (priority.source === "jev" || priority.source === "rule") fields.prioritySource = priority.source;
    if (Number.isFinite(priority.jevUrgencyScore)) fields.jevUrgencyScore = Math.round(Math.min(2, Math.max(0, priority.jevUrgencyScore)) * 100) / 100;
    if (Number.isFinite(priority.jevReplyChance)) fields.jevReplyChance = Math.round(Math.min(1, Math.max(0, priority.jevReplyChance)) * 100) / 100;
  }
  const category = candidate.workCategory;
  if (category?.label && category.id !== "other") {
    fields.mailCategory = cleanText(category.label, 24);
    if (category.source === "jev" || category.source === "rule") fields.mailCategorySource = category.source;
  }
  const assignee = candidate.assignee;
  const assigneeId = safeTeammateId(assignee?.teammateId);
  if (assigneeId) {
    fields.assigneeTeammateId = assigneeId;
    fields.assigneeName = cleanText(assignee.name, 60) || "업무 비서";
    const roleTitle = cleanText(assignee.roleTitle, 80);
    if (roleTitle) fields.assigneeRoleTitle = roleTitle;
    if (["jev", "rule", "default"].includes(assignee.source)) fields.assigneeSource = assignee.source;
    const reason = cleanText(assignee.reason, 200);
    if (reason) fields.assigneeReason = reason;
  }
  return fields;
}
