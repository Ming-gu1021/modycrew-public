"use client";

/**
 * 필요한 스킬을 구해 새 AI 직원을 만드는 화면(AI 직원 화면 안).
 * 흐름: 요청 → 필요한 능력 → 스킬 조달(① 우리 웹사이트 → ② 이 PC → ③ 공개 후보 → ④ 새로 만들기) → 필요한 설정 → 직원 정보 → 만들기.
 * 스킬 저장·가져오기·적용은 내용을 화면에서 확인한 뒤 데스크톱 확인 창에서 한 번 더 승인해야 진행된다.
 * 판단 규칙은 lib/employee-builder.ts(순수 함수)에 있고, 이 컴포넌트는 상태와 버튼만 다룬다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AITeammate } from "@/lib/ai-teammates";
import CrewCharacterPicker from "@/components/CrewCharacterPicker";
import { crewCharacterIds, getCrewCharacter } from "@/lib/crew-character-catalog";
import { crewSkills } from "@/lib/crew-skills";
import { crewFirstTaskPath, loadCrewConnectionState, rememberCrewFirstTask, type CrewConnectionState } from "@/lib/crew-hiring";
import { navigateInternalPath } from "@/lib/safe-navigation";
import {
  analyzeEmployeeRequest,
  analyzeEmployeeRequestWithAI,
  buildEmployeeInstructions,
  buildEmployeePlan,
  buildInstructionSkillDraft,
  buildSkillDraftRefinePrompt,
  chooseEmployeeAvatar,
  crewAvatarTraits,
  employeeSkills,
  emptyEmployeeSkillSources,
  generateEmployeeBuilderText,
  getEmployeeCapability,
  hireEmployeeFromDraft,
  libraryDeployStatus,
  loadEmployeeSkillSources,
  parseSkillDraftOutput,
  skillSourceLabels,
  summarizeAvatarRoster,
  type CapabilityProcurement,
  type EmployeeDraft,
  type EmployeePlan,
  type EmployeeSettingState,
  type EmployeeSkillSources,
  type LibrarySkillInfo,
  type SkillOption,
} from "@/lib/employee-builder";
import styles from "./EmployeeBuilder.module.css";

type Notice = { tone: "info" | "success" | "error"; text: string };
type ReviewFile = { path: string; bytes: number; content: string };
type ReviewPreview = { name: string; description: string; version: string; license: string; sha256: string; problems: string[]; warnings: string[]; files: ReviewFile[] };
type ReviewState =
  | { kind: "template"; templateId: string; label: string; preview: ReviewPreview; confirmed: boolean }
  | { kind: "draft"; origin: "app_draft" | "ai_draft"; capabilityId: string; name: string; label: string; content: string; checked: ReviewPreview | null; confirmed: boolean }
  | { kind: "github" | "folder"; token: string; label: string; source: { url?: string; commit?: string; license?: string; folder?: string }; preview: ReviewPreview; confirmed: boolean };
type VoiceEngines = {
  message: string;
  tts: { ok: boolean; voices: Array<{ name: string; culture: string; gender: string }>; koreanVoices: string[]; error?: string };
  stt: { ok: boolean; ready: boolean; missing: string[]; engines: Array<{ engine: string; whisperCli?: string; model?: string; modelBytes?: number; vadModel?: string; ffmpeg?: string }>; error?: string };
};
type UpdateItem = { name: string; label: string; status: string; statusLabel: string; currentVersion: string; latestVersion: string; localModified: boolean; note: string; action: string; releaseTag?: string; releaseUrl?: string };
type CompareState = { name: string; fromVersion: string; toVersion: string; toSha256: string; localModified: boolean; unpreservable: string[]; changes: Array<{ path: string; change: string; before?: string; after?: string }> };

const examples = ["목소리 TTS 전용 직원", "내 목소리 받아쓰기 담당", "인스타 콘텐츠 담당", "번역 담당", "회계 정리 담당", "영상 편집 담당", "고객 문의 응대 담당", "자료조사 담당"];
const toneChoices = ["또박또박하고 차분한 안내 말투", "친근하고 다정한 말투", "격식 있고 정중한 말투", "밝고 활기찬 말투", "짧고 핵심만 말하는 말투"];
const originSourceLabel: Record<string, string> = { app_template: "새로 만듦 · 앱 템플릿", app_draft: "새로 만듦 · 기본 지침", ai_draft: "새로 만듦 · AI 초안", github: "깃허브에서 가져옴", user_folder: "내 폴더에서 가져옴", website: "우리 웹사이트", app_bundled: "모디크루 앱에 포함", this_pc: "이 PC 스킬" };

export type EmployeeBuilderProps = {
  initialRequest?: string;
  initialTab?: "build" | "library";
  focusSkill?: string;
  usedAvatarIds: readonly string[];
  experts: ReadonlyArray<{ id: string; name: string; roleTitle: string }>;
  onClose: () => void;
  onHired: (teammate: AITeammate) => void;
};

function portraitSrc(avatarId: string): string {
  return getCrewCharacter(avatarId)?.asset.idle.src ?? "/office-crew/crew-doc-v2.webp";
}

function formatBytes(value: number | undefined): string {
  if (!value) return "";
  return value >= 1024 * 1024 ? (value / 1024 / 1024).toFixed(1) + "MB" : Math.round(value / 1024) + "KB";
}

function firstTaskFor(draft: EmployeeDraft): string {
  if (draft.capabilityIds.includes("voice_tts")) return "이 문장을 음성 파일로 만들어 줘: 안녕하세요, 모디크루 " + draft.name + "입니다.";
  if (draft.capabilityIds.includes("voice_stt")) return "녹음 파일을 받아써 줘. 파일은 선택 창에서 고를게.";
  const capability = getEmployeeCapability(draft.capabilityIds[0]);
  return (capability?.label ?? draft.roleTitle) + " 첫 업무를 시작해 줘. 먼저 필요한 자료와 기준을 물어봐 줘.";
}

function settingStatus(setting: EmployeeSettingState, checks: { connections: CrewConnectionState | null; runtimes: Array<{ label: string; loggedIn: boolean }> | null; engines: VoiceEngines | null }): { state: "ready" | "missing" | "unknown"; label: string } {
  if (setting.kind === "ai_chat") {
    const ai = checks.connections?.ai;
    return ai === "connected" ? { state: "ready", label: "연결됨" } : ai === "missing" ? { state: "missing", label: "연결 안 됨" } : { state: "unknown", label: "확인 전" };
  }
  if (setting.kind === "runtime_login") {
    if (!checks.runtimes) return { state: "unknown", label: "확인 전" };
    const ready = checks.runtimes.filter((runtime) => runtime.loggedIn).map((runtime) => runtime.label);
    return ready.length ? { state: "ready", label: ready.join("·") + " 로그인" } : { state: "missing", label: "로그인 필요" };
  }
  if (setting.kind === "tts_engine") {
    if (!checks.engines) return { state: "unknown", label: "확인 전" };
    return checks.engines.tts.koreanVoices.length ? { state: "ready", label: "한국어 음성 " + checks.engines.tts.koreanVoices.length + "개" } : { state: "missing", label: "한국어 음성 없음" };
  }
  if (setting.kind === "stt_engine") {
    if (!checks.engines) return { state: "unknown", label: "확인 전" };
    return checks.engines.stt.ready ? { state: "ready", label: "로컬 엔진 준비됨" } : { state: "missing", label: "엔진 준비 필요" };
  }
  if (setting.kind === "connection" && setting.id.startsWith("mail")) {
    const mail = checks.connections?.mail;
    return mail === "connected" ? { state: "ready", label: "연결됨" } : mail === "missing" ? { state: "missing", label: "연결 안 됨" } : { state: "unknown", label: "확인 전" };
  }
  return { state: "unknown", label: setting.required ? "확인 필요" : "선택" };
}

export default function EmployeeBuilder({ initialRequest = "", initialTab = "build", focusSkill = "", usedAvatarIds, experts, onClose, onHired }: EmployeeBuilderProps) {
  const [tab, setTab] = useState<"build" | "library">(initialTab);
  const [request, setRequest] = useState(initialRequest);
  const [useAI, setUseAI] = useState(true);
  const [sources, setSources] = useState<EmployeeSkillSources>(() => emptyEmployeeSkillSources());
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [plan, setPlan] = useState<EmployeePlan | null>(null);
  const [draft, setDraft] = useState<EmployeeDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [githubUrl, setGithubUrl] = useState("");
  const [engines, setEngines] = useState<VoiceEngines | null>(null);
  const [sample, setSample] = useState<{ text: string; durationSeconds?: number; bytes?: number; voice?: string } | null>(null);
  const [connections, setConnections] = useState<CrewConnectionState | null>(null);
  const [runtimes, setRuntimes] = useState<Array<{ label: string; loggedIn: boolean }> | null>(null);
  const [hired, setHired] = useState<AITeammate | null>(null);
  const [updates, setUpdates] = useState<UpdateItem[]>([]);
  const [compare, setCompare] = useState<CompareState | null>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const library = sources.library.skills;

  const say = useCallback((tone: Notice["tone"], text: string) => setNotice({ tone, text }), []);

  const refreshSources = useCallback(async (force = false) => {
    const next = await loadEmployeeSkillSources({ force });
    setSources(next);
    setSourcesLoaded(true);
    return next;
  }, []);

  useEffect(() => { void refreshSources(); }, [refreshSources]);
  useEffect(() => { if (review) reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [review]);

  /** 저장·설치 뒤 출처가 바뀌면 같은 분석으로 계획을 다시 세우되, 사용자가 고친 이름·말투·외형·엔진은 그대로 둔다. */
  const replan = useCallback((nextSources: EmployeeSkillSources, current: EmployeePlan) => {
    const fresh = buildEmployeePlan(current.analysis, nextSources, { usedAvatarIds, availableAvatarIds: crewCharacterIds });
    setPlan(fresh);
    setDraft((previous) => {
      if (!previous) return fresh.draft;
      const merged: EmployeeDraft = {
        ...fresh.draft,
        name: previous.name, roleTitle: previous.roleTitle, brief: previous.brief, tone: previous.tone, avatarId: previous.avatarId, avatarReason: previous.avatarReason,
        engines: previous.engines,
        settings: fresh.draft.settings.map((setting) => ({ ...setting, selectedOption: previous.settings.find((item) => item.id === setting.id)?.selectedOption ?? setting.selectedOption })),
      };
      return { ...merged, instructions: buildEmployeeInstructions(merged) };
    });
  }, [usedAvatarIds]);

  async function analyze(text = request) {
    const value = text.trim();
    if (!value) { say("error", "어떤 직원이 필요한지 한 줄로 적어 주세요."); return; }
    setBusy("analyze");
    setNotice(null);
    setHired(null);
    setReview(null);
    try {
      const current = sourcesLoaded ? sources : await refreshSources();
      const analysis = useAI && current.aiAvailable ? await analyzeEmployeeRequestWithAI(value) : analyzeEmployeeRequest(value);
      const nextPlan = buildEmployeePlan(analysis, current, { usedAvatarIds, availableAvatarIds: crewCharacterIds });
      setPlan(nextPlan);
      setDraft(nextPlan.draft);
      if (analysis.aiNote) say("info", analysis.aiNote);
      window.requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (error) {
      say("error", "필요한 능력을 정리하지 못했습니다: " + String((error as Error)?.message ?? error));
    } finally {
      setBusy(null);
    }
  }

  function updateDraft(changes: Partial<EmployeeDraft>) {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...changes };
      return { ...next, instructions: buildEmployeeInstructions(next) };
    });
  }

  async function afterSkillSaved(result: { status: string; userMessage: string }) {
    const ok = ["saved", "updated", "already_saved"].includes(result.status);
    say(ok ? "success" : result.status === "declined" ? "info" : "error", result.userMessage);
    if (!ok) return;
    setReview(null);
    const next = await refreshSources(true);
    if (plan) replan(next, plan);
  }

  // ── 스킬 조달 동작 ──
  async function openTemplate(option: SkillOption) {
    if (!option.templateId) return;
    setBusy("template");
    const result = await employeeSkills({ kind: "template", id: option.templateId });
    setBusy(null);
    if (result.status !== "template") { say("error", result.userMessage); return; }
    const template = result.template as ReviewPreview & { label: string };
    setReview({ kind: "template", templateId: option.templateId, label: template.label ?? option.label, preview: template, confirmed: false });
  }

  function openDraft(option: SkillOption, procurement: CapabilityProcurement) {
    const draftSkill = buildInstructionSkillDraft(procurement.capability.definition, plan?.request ?? request);
    setReview({ kind: "draft", origin: "app_draft", capabilityId: procurement.capability.id, name: draftSkill.name, label: draftSkill.label, content: draftSkill.content, checked: null, confirmed: false });
  }

  async function openAIDraft(option: SkillOption, procurement: CapabilityProcurement) {
    const base = buildInstructionSkillDraft(procurement.capability.definition, plan?.request ?? request);
    setBusy("ai_draft");
    const output = await generateEmployeeBuilderText(buildSkillDraftRefinePrompt(base, plan?.request ?? request), 90_000);
    setBusy(null);
    const content = output ? parseSkillDraftOutput(output, base.name) : null;
    if (!content) { say("info", "AI 초안을 받지 못해 기본 지침 초안을 보여 드려요."); }
    setReview({ kind: "draft", origin: content ? "ai_draft" : "app_draft", capabilityId: procurement.capability.id, name: base.name, label: base.label, content: content ?? base.content, checked: null, confirmed: false });
  }

  async function checkDraft() {
    if (!review || review.kind !== "draft") return;
    setBusy("check_draft");
    const result = await employeeSkills({ kind: "validate_draft", name: review.name, content: review.content });
    setBusy(null);
    if (result.status === "unavailable") { say("info", result.userMessage); return; }
    const checked = result.draft as ReviewPreview | undefined;
    setReview({ ...review, checked: checked ?? null, confirmed: false });
    say(result.status === "draft_ok" ? "success" : "error", result.userMessage);
  }

  async function saveReview() {
    if (!review || !review.confirmed) return;
    setBusy("save_review");
    let result: { status: string; userMessage: string };
    if (review.kind === "template") result = await employeeSkills({ kind: "save_template", templateId: review.templateId, reviewedSha256: review.preview.sha256 });
    else if (review.kind === "draft") result = review.checked ? await employeeSkills({ kind: "save_draft", name: review.name, content: review.content, reviewedSha256: review.checked.sha256, origin: review.origin, capabilityId: review.capabilityId, label: review.label }) : { status: "review_required", userMessage: "먼저 '초안 검사'를 눌러 주세요." };
    else result = await employeeSkills({ kind: review.kind === "github" ? "import_github" : "import_folder", token: review.token, reviewedSha256: review.preview.sha256, label: review.label });
    setBusy(null);
    await afterSkillSaved(result);
  }

  async function previewGithub(urlOverride?: string) {
    const url = (urlOverride ?? githubUrl).trim();
    if (urlOverride) setGithubUrl(urlOverride);
    if (!url) { say("error", "깃허브 스킬 폴더 주소를 넣어 주세요."); return; }
    setBusy("github");
    const result = await employeeSkills({ kind: "preview_github", url });
    setBusy(null);
    if (result.status !== "preview") { say(result.status === "unavailable" ? "info" : "error", result.userMessage); return; }
    const source = result.source as { url: string; commit: string; license: string };
    const preview = result.preview as ReviewPreview;
    setReview({ kind: "github", token: String(result.token), label: preview.name, source, preview, confirmed: false });
  }

  async function previewFolder() {
    setBusy("folder");
    const result = await employeeSkills({ kind: "preview_folder" });
    setBusy(null);
    if (result.status !== "preview") { say(result.status === "declined" || result.status === "unavailable" ? "info" : "error", result.userMessage); return; }
    const source = result.source as { folder: string };
    const preview = result.preview as ReviewPreview;
    setReview({ kind: "folder", token: String(result.token), label: preview.name, source, preview, confirmed: false });
  }

  async function installExtension(option: SkillOption) {
    setBusy("install:" + option.name);
    const result = await crewSkills({ kind: "install", name: option.name });
    setBusy(null);
    say(result.status === "installed" ? "success" : result.status === "declined" ? "info" : "error", result.userMessage);
    if (result.status === "installed" && plan) replan(await refreshSources(true), plan);
  }

  // ── 설정 확인 ──
  async function checkSettings() {
    setBusy("settings");
    const [connectionState, runtimeState, engineState] = await Promise.allSettled([
      loadCrewConnectionState({ force: true }),
      crewSkills({ kind: "status" }),
      draft?.capabilityIds.some((id) => id === "voice_tts" || id === "voice_stt") ? employeeSkills({ kind: "voice_engines" }) : Promise.resolve(null),
    ]);
    setBusy(null);
    if (connectionState.status === "fulfilled") setConnections(connectionState.value);
    if (runtimeState.status === "fulfilled" && Array.isArray(runtimeState.value.runtimes)) setRuntimes(runtimeState.value.runtimes.map((runtime) => ({ label: runtime.label, loggedIn: runtime.loggedIn })));
    if (engineState.status === "fulfilled" && engineState.value) {
      const value = engineState.value;
      if (value.status === "voice_engines") setEngines({ message: value.userMessage, tts: value.tts as VoiceEngines["tts"], stt: value.stt as VoiceEngines["stt"] });
      else say("info", value.userMessage);
    }
  }

  async function makeSample() {
    setBusy("sample");
    const result = await employeeSkills({ kind: "voice_sample" });
    setBusy(null);
    const data = result.sample as { durationSeconds?: number; bytes?: number; voice?: string } | undefined;
    if (result.status === "sample_ready") setSample({ text: result.userMessage, ...data });
    say(result.status === "sample_ready" ? "success" : result.status === "unavailable" ? "info" : "error", result.userMessage);
  }

  async function openSamples() {
    const result = await employeeSkills({ kind: "open_run", target: "samples" });
    if (result.status !== "opened") say("error", result.userMessage);
  }

  async function checkSupertonic() {
    setBusy("supertonic");
    const result = await employeeSkills({ kind: "supertonic_check" });
    setBusy(null);
    say(result.status === "supertonic_ready" ? "success" : "info", result.userMessage);
  }

  function goTo(route?: string, goal?: string) {
    if (!route) return;
    try { navigateInternalPath(route + (goal ? "&goal=" + encodeURIComponent(goal.slice(0, 60)) : "")); }
    catch { say("error", "연결 화면을 열지 못했습니다. 왼쪽 메뉴의 연결에서 다시 시도해 주세요."); }
  }

  // ── 직원 만들기 ──
  async function hire() {
    if (!draft) return;
    if (!draft.name.trim()) { say("error", "직원 이름을 적어 주세요."); return; }
    setBusy("hire");
    try {
      const done = await hireEmployeeFromDraft(draft);
      setHired(done.teammate);
      onHired(done.teammate);
      const pending = draft.skills.filter((skill) => skill.pending).length;
      say("success", draft.name + " 님을 팀에 만들었어요." + (pending ? " 아직 저장하지 않은 스킬 " + pending + "개는 빼고 만들었어요. 저장한 뒤 직원 설정에서 더할 수 있어요." : ""));
    } catch (error) {
      say("error", "직원을 저장하지 못했습니다: " + String((error as Error)?.message ?? error));
    } finally {
      setBusy(null);
    }
  }

  function assignFirstTask() {
    if (!hired || !draft) return;
    rememberCrewFirstTask(hired.id, firstTaskFor(draft));
    try { navigateInternalPath(crewFirstTaskPath(hired.id)); } catch { say("error", "대화 화면으로 이동하지 못했습니다."); }
  }

  // ── 내 스킬 보관함 ──
  async function checkUpdates(force: boolean) {
    setBusy("check_updates");
    const result = await employeeSkills({ kind: "library_check", force });
    setBusy(null);
    if (result.status !== "checked") { say(result.status === "unavailable" ? "info" : "error", result.userMessage); return; }
    setUpdates((result.items as UpdateItem[]) ?? []);
    const notes = (result.notifications as Array<{ text: string }>) ?? [];
    say("info", notes.length ? notes.map((item) => item.text).join(" ") : result.userMessage);
    await refreshSources();
  }

  async function compareSkill(name: string) {
    setBusy("compare:" + name);
    const result = await employeeSkills({ kind: "library_compare", name });
    setBusy(null);
    if (result.status !== "compare") { say("error", result.userMessage); return; }
    setCompare({ name, fromVersion: String(result.fromVersion ?? ""), toVersion: String(result.toVersion ?? ""), toSha256: String(result.toSha256 ?? ""), localModified: Boolean(result.localModified), unpreservable: (result.unpreservable as string[]) ?? [], changes: (result.changes as CompareState["changes"]) ?? [] });
  }

  /** 적용·되돌리기 뒤 그 스킬의 최신 상태를 다시 묻는다(원격은 데스크톱이 6시간 캐시를 쓰므로 대개 다시 받지 않는다). 이전 확인 결과를 그대로 두면 이미 적용한 '새 버전 적용' 버튼이 남는다. */
  async function refreshUpdateItem(name: string) {
    if (!updates.some((item) => item.name === name)) return;
    const result = await employeeSkills({ kind: "library_check", names: [name] });
    const fresh = result.status === "checked" ? ((result.items as UpdateItem[]) ?? []).find((item) => item.name === name) : undefined;
    setUpdates((current) => (fresh ? current.map((item) => (item.name === name ? fresh : item)) : current.filter((item) => item.name !== name)));
  }

  async function applySkill(name: string, overwriteLocal: boolean) {
    setBusy("apply:" + name);
    const result = await employeeSkills({ kind: "library_apply", name, expectedSha256: compare?.name === name ? compare.toSha256 : "", toVersion: compare?.name === name ? compare.toVersion : "", overwriteLocal });
    setBusy(null);
    say(result.status === "updated" || result.status === "up_to_date" ? "success" : result.status === "declined" || result.status === "needs_review" ? "info" : "error", result.userMessage);
    if (result.status === "updated") setCompare(null);
    await refreshUpdateItem(name);
    await refreshSources(true);
  }

  async function libraryAction(kind: "library_rollback" | "library_adopt_local" | "library_redeploy" | "library_publish_candidate", name: string, extra: Record<string, unknown> = {}) {
    setBusy(kind + ":" + name);
    const result = await employeeSkills({ kind, name, ...extra });
    setBusy(null);
    say(["rolled_back", "adopted", "deployed", "publish_candidate", "publish_candidate_off"].includes(result.status) ? "success" : result.status === "declined" || result.status === "needs_review" ? "info" : "error", result.userMessage);
    if (kind !== "library_publish_candidate") {
      if (compare?.name === name) setCompare(null);
      await refreshUpdateItem(name);
    }
    await refreshSources(true);
  }

  const roster = useMemo(() => summarizeAvatarRoster(usedAvatarIds, crewCharacterIds), [usedAvatarIds]);
  const avatarAlternatives = useMemo(() => {
    if (!draft) return [];
    const primary = getEmployeeCapability(draft.capabilityIds[0]);
    return chooseEmployeeAvatar({ styles: primary?.avatarStyles ?? ["practical"], usedAvatarIds, availableIds: crewCharacterIds, seed: plan?.request }).alternatives;
  }, [draft, plan?.request, usedAvatarIds]);
  const checks = { connections, runtimes, engines };
  const libraryCount = library.length;

  const workPackLabels: Record<string, string> = { inquiry_response: "문의 응대", schedule_coordination: "일정 조율", report_cleanup: "보고서 정리", inventory_reorder: "재고 발주", tax_contract_archive: "세금·계약 자료 정리" };
  const viaLabels: Record<SkillOption["via"], string> = { app_tool: "앱이 직접 실행 · 어느 AI든 같은 결과", crew_skill: "크루 스킬 실행기(실행 전 확인 창)", instructions: "지침을 읽고 따름", none: "참고" };
  const stepStateLabels: Record<string, string> = { found: "찾음", none: "없음", unavailable: "확인 못 함", offered: "만들 수 있음" };
  const originLabels: Record<string, string> = { rules: "규칙 사전", ai: "AI 분석", "rules+ai": "AI·규칙 모두" };

  function selectEngine(settingId: string, optionId: string, label: string) {
    if (!draft) return;
    const settings = draft.settings.map((setting) => (setting.id === settingId ? { ...setting, selectedOption: optionId } : setting));
    const engines = { ...draft.engines, ...(settingId === "tts_engine" ? { tts: label } : settingId === "stt_engine" ? { stt: label } : {}) };
    updateDraft({ settings, engines });
  }

  function pickAvatar(id: string) {
    updateDraft({ avatarId: id, avatarReason: "직접 고른 외형 · " + (usedAvatarIds.includes(id) ? "다른 직원과 같은 외형" : "아직 안 쓴 외형") + (crewAvatarTraits[id] ? " · " + crewAvatarTraits[id].look : "") });
  }

  function renderOption(option: SkillOption, procurement: CapabilityProcurement) {
    return (
      <li key={option.key} className={styles.option} data-status={option.status}>
        <div className={styles.optionHead}>
          <span className={styles.badge} data-source={option.source}>{skillSourceLabels[option.source]}</span>
          <strong>{option.label}</strong>
          {option.name !== option.label ? <code>{option.name}</code> : null}
          <span className={styles.status} data-status={option.status}>{option.statusLabel}</span>
        </div>
        {option.detail ? <p className={styles.optionDetail}>{option.detail}</p> : null}
        <div className={styles.optionActions}>
          {option.status === "installable" ? <button type="button" className={styles.secondary} onClick={() => void installExtension(option)} disabled={busy === "install:" + option.name}>확장 추가(확인 창)</button> : null}
          {option.source === "template" && option.status === "create" ? <button type="button" className={styles.secondary} onClick={() => void openTemplate(option)} disabled={busy === "template"}>내용 확인하고 만들기</button> : null}
          {option.source === "app_draft" ? <button type="button" className={styles.secondary} onClick={() => openDraft(option, procurement)}>초안 보고 만들기</button> : null}
          {option.source === "ai_draft" ? <button type="button" className={styles.secondary} onClick={() => void openAIDraft(option, procurement)} disabled={busy === "ai_draft"}>{busy === "ai_draft" ? "AI가 다듬는 중" : "AI로 초안 다듬기"}</button> : null}
          {option.source === "candidate" && option.url?.startsWith("https://github.com/") ? <button type="button" className={styles.secondary} onClick={() => void previewGithub(option.url)} disabled={busy === "github"}>가져오기 전 미리보기</button> : null}
          {option.url ? <a className={styles.link} href={option.url} target="_blank" rel="noreferrer noopener">원문 보기</a> : null}
        </div>
      </li>
    );
  }

  function renderProcurement(procurement: CapabilityProcurement) {
    const doers = procurement.existingExpertIds.map((id) => experts.find((expert) => expert.id === id)).filter((expert): expert is { id: string; name: string; roleTitle: string } => Boolean(expert));
    return (
      <article key={procurement.capability.id + procurement.capability.label} className={styles.capability} aria-label={procurement.capability.label + " 스킬 구하기"}>
        <header className={styles.capabilityHead}>
          <strong>{procurement.capability.label}</strong>
          <span className={styles.badge} data-tone="muted">{originLabels[procurement.capability.origin] ?? procurement.capability.origin}</span>
          <span className={styles.meta}>{procurement.capability.reason}</span>
        </header>
        {doers.length ? <p className={styles.meta}>기본 직원 {doers.map((expert) => expert.name + "(" + expert.roleTitle + ")").join(", ")}도 이 일을 해요. 새 직원과 같은 스킬을 함께 쓸 수 있어요.</p> : null}
        <ol className={styles.stepList}>
          {procurement.steps.map((step) => (
            <li key={step.order} className={styles.sourceStep} data-state={step.state}>
              <div className={styles.stepHead}>
                <strong>{step.title}</strong>
                <span className={styles.stateBadge} data-state={step.state}>{stepStateLabels[step.state]}</span>
              </div>
              <p className={styles.meta}>{step.note}</p>
              {step.options.length ? <ul className={styles.options}>{step.options.map((option) => renderOption(option, procurement))}</ul> : null}
            </li>
          ))}
        </ol>
        <p className={styles.chosen}>
          고른 스킬: {procurement.chosen.length
            ? procurement.chosen.map((option) => option.label + " · " + skillSourceLabels[option.source]).join(", ")
            : procurement.recommendedCreation ? "아직 없어요 — " + procurement.recommendedCreation.statusLabel + "(내용 확인 뒤 저장)" : "없음"}
        </p>
      </article>
    );
  }

  const canConfirm = review ? (review.kind === "draft" ? Boolean(review.checked && !review.checked.problems.length) : !review.preview.problems.length) : false;
  const reviewPreview = review ? (review.kind === "draft" ? review.checked : review.preview) : null;
  const reviewPanel = review ? (
    <div ref={reviewRef} className={styles.review} role="region" aria-label="저장 전 내용 확인">
      <h4>{review.kind === "template" ? "앱 템플릿: " : review.kind === "draft" ? (review.origin === "ai_draft" ? "AI 초안: " : "기본 지침 초안: ") : review.kind === "github" ? "깃허브 스킬: " : "내 폴더 스킬: "}{review.label}</h4>
      <p className={styles.meta}>
        {review.kind === "github" ? "출처 " + (review.source.url ?? "") + " · 커밋 " + (review.source.commit ?? "").slice(0, 7) + " · 라이선스 " + (review.source.license || "확인 못 함") : review.kind === "folder" ? "출처 " + (review.source.folder ?? "") : review.kind === "template" ? "모디크루 앱 템플릿 " + review.preview.version + " · 실제 처리는 앱이 스크립트로 실행" : "SKILL.md 지침만(스크립트 없음) · 직접 고칠 수 있어요"}
      </p>
      {reviewPreview?.problems.length ? <ul className={styles.problems}>{reviewPreview.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
      {reviewPreview?.warnings.length ? <ul className={styles.warnings}>{reviewPreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      {review.kind === "draft" ? (
        <>
          <label className={styles.field}>
            <span>SKILL.md 초안(고쳐도 됩니다)</span>
            <textarea className={styles.code} value={review.content} rows={16} spellCheck={false} onChange={(event) => setReview({ ...review, content: event.target.value, checked: null, confirmed: false })} />
          </label>
          <div className={styles.row}><button type="button" className={styles.secondary} onClick={() => void checkDraft()} disabled={busy === "check_draft"}>{busy === "check_draft" ? "검사하는 중" : "초안 검사"}</button>{review.checked ? <span className={styles.meta}>검사 통과 뒤에만 저장할 수 있어요.</span> : <span className={styles.meta}>고친 뒤에는 다시 검사해 주세요.</span>}</div>
        </>
      ) : (
        <ul className={styles.files}>
          {review.preview.files.map((file) => (
            <li key={file.path}>
              <details open={file.path === "SKILL.md"}>
                <summary><code>{file.path}</code> <span className={styles.meta}>{formatBytes(file.bytes) || file.bytes + "B"}</span></summary>
                <pre className={styles.pre}>{file.content}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
      <label className={styles.check}>
        <input type="checkbox" checked={review.confirmed} disabled={!canConfirm} onChange={(event) => setReview({ ...review, confirmed: event.target.checked } as ReviewState)} />
        <span>내용을 확인했습니다. 저장하면 내 스킬 보관함에 버전으로 남기고 공용 스킬 폴더(Codex·Claude·Gemini CLI 가 함께 읽는 곳)에 둡니다. 데스크톱 확인 창이 한 번 더 뜹니다.</span>
      </label>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => void saveReview()} disabled={!review.confirmed || busy === "save_review"}>{busy === "save_review" ? "저장하는 중" : "확인한 내용으로 저장"}</button>
        <button type="button" className={styles.secondary} onClick={() => setReview(null)}>닫기</button>
      </div>
    </div>
  ) : null;

  const importBox = (
    <details className={styles.importBox}>
      <summary>사용자가 준 스킬 가져오기(깃허브 주소·내 폴더)</summary>
      <p className={styles.meta}>미리보기에서 SKILL.md·스크립트·라이선스를 먼저 보여 드리고, 확인한 뒤에만 보관해요. 설치하거나 실행하지 않아요.</p>
      <div className={styles.importRow}>
        <label className={styles.field}>
          <span>깃허브 스킬 폴더 주소</span>
          <input value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} placeholder="https://github.com/소유자/저장소/tree/main/skills/이름" />
        </label>
        <button type="button" className={styles.secondary} onClick={() => void previewGithub()} disabled={busy === "github"}>{busy === "github" ? "받는 중" : "미리보기"}</button>
        <button type="button" className={styles.secondary} onClick={() => void previewFolder()} disabled={busy === "folder"}>내 폴더에서 고르기</button>
      </div>
    </details>
  );

  useEffect(() => {
    if (tab !== "library" || !focusSkill) return;
    document.getElementById("employee-skill-" + focusSkill)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [tab, focusSkill, library.length]);

  const buildPanel = (
    <div className={styles.panel} role="tabpanel" id="employee-builder-panel-build" aria-labelledby="employee-builder-tab-build">
      <section className={styles.step} aria-labelledby="employee-builder-step-1">
        <h3 id="employee-builder-step-1"><b>1</b>어떤 직원이 필요한가요?</h3>
        <label className={styles.field}>
          <span>만들 직원 설명</span>
          <textarea value={request} rows={2} maxLength={600} placeholder="예: 목소리 TTS 전용 직원 만들어줘 · 회의 녹음 받아쓰기 담당 · 회계 정리 담당" onChange={(event) => setRequest(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void analyze(); }} />
        </label>
        <div className={styles.examples} role="group" aria-label="예시 요청">
          {examples.map((example) => (
            <button key={example} type="button" onClick={() => { setRequest(example + " 만들어줘"); void analyze(example + " 만들어줘"); }}>{example}</button>
          ))}
        </div>
        <div className={styles.row}>
          {sources.aiAvailable ? (
            <label className={styles.check}><input type="checkbox" checked={useAI} onChange={(event) => setUseAI(event.target.checked)} /><span>연결된 AI로도 분석하기(실패하면 규칙 사전)</span></label>
          ) : <span className={styles.meta}>AI 연결이 없으면 모디크루 규칙 사전으로 정리해요.</span>}
          <button type="button" className={styles.primary} onClick={() => void analyze()} disabled={busy === "analyze"}>{busy === "analyze" ? "정리하는 중" : "필요한 능력 찾기"}</button>
        </div>
      </section>

      {plan && draft ? (
        <div ref={resultRef} className={styles.result}>
          <section className={styles.step} aria-labelledby="employee-builder-step-2">
            <h3 id="employee-builder-step-2"><b>2</b>필요한 능력과 스킬 구하기</h3>
            <p className={styles.meta}>
              판단: {plan.analysis.analyzedBy === "rules" ? "규칙 사전" : plan.analysis.analyzedBy === "ai" ? "AI 분석" : "AI 분석 + 규칙 사전"}
              {" · "}순서: 우리 웹사이트 → 이 PC → 공개 후보(검토) → 새로 만들기
            </p>
            {plan.procurements.map((procurement) => renderProcurement(procurement))}
            {reviewPanel}
            {importBox}
          </section>

          <section className={styles.step} aria-labelledby="employee-builder-step-3">
            <div className={styles.stepTitleRow}>
              <h3 id="employee-builder-step-3"><b>3</b>필요한 설정</h3>
              <button type="button" className={styles.secondary} onClick={() => void checkSettings()} disabled={busy === "settings"}>{busy === "settings" ? "확인하는 중" : "설정 상태 확인"}</button>
            </div>
            <ul className={styles.settings}>
              {draft.settings.map((setting) => {
                const status = settingStatus(setting, checks);
                return (
                  <li key={setting.id} className={styles.setting}>
                    <div className={styles.optionHead}>
                      <strong>{setting.label}</strong>
                      <span className={styles.badge} data-tone={setting.required ? "warn" : "muted"}>{setting.required ? "필수" : "선택"}</span>
                      <span className={styles.status} data-state={status.state}>{status.label}</span>
                    </div>
                    <p className={styles.meta}>{setting.detail}</p>
                    {setting.options ? (
                      <fieldset className={styles.engines}>
                        <legend className={styles.visuallyHidden}>{setting.label} 고르기</legend>
                        {setting.options.map((option) => (
                          <label key={option.id} className={styles.engine} data-disabled={option.implemented ? undefined : "true"}>
                            <input type="radio" name={"employee-builder-" + setting.id} value={option.id} checked={setting.selectedOption === option.id} disabled={!option.implemented} onChange={() => selectEngine(setting.id, option.id, option.label)} />
                            <span>
                              <strong>{option.label}</strong>
                              <span>{option.detail}</span>
                              <span className={styles.engineFacts}>{option.install === "none" ? "설치 없음" : "설치·다운로드는 승인 뒤"} · {option.external ? "외부 전송 있음" : "PC 안에서 처리"}{option.implemented ? "" : " · 이번 스킬 버전은 아직 실행하지 않음"}</span>
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    ) : null}
                    <div className={styles.optionActions}>
                      {setting.kind === "tts_engine" ? (
                        <>
                          <button type="button" className={styles.secondary} onClick={() => void checkSettings()}>이 PC 음성 확인</button>
                          <button type="button" className={styles.secondary} onClick={() => void makeSample()} disabled={busy === "sample"}>{busy === "sample" ? "만드는 중" : "시험 음성 만들기"}</button>
                          {sample ? <button type="button" className={styles.secondary} onClick={() => void openSamples()}>시험 음성 폴더 열기</button> : null}
                          <button type="button" className={styles.secondary} onClick={() => void checkSupertonic()} disabled={busy === "supertonic"}>Supertonic 폴더 확인</button>
                        </>
                      ) : null}
                      {setting.kind === "stt_engine" ? <button type="button" className={styles.secondary} onClick={() => void checkSettings()}>받아쓰기 엔진 확인</button> : null}
                      {setting.route ? <button type="button" className={styles.secondary} onClick={() => goTo(setting.route, draft.roleTitle + " 설정")}>{setting.kind === "vault" ? "보관함 열기" : "연결 화면 열기"}</button> : null}
                    </div>
                    {setting.kind === "tts_engine" && engines ? <p className={styles.meta}>이 PC 음성: {engines.tts.voices.map((voice) => voice.name + "(" + voice.culture + ")").join(", ") || "없음"}{sample ? " · " + sample.text : ""}</p> : null}
                    {setting.kind === "stt_engine" && engines ? (
                      <p className={styles.meta}>
                        {engines.stt.ready
                          ? "whisper.cpp 준비됨 · 모델 " + String(engines.stt.engines[0]?.model ?? "").split(/[\\/]/u).pop() + " (" + formatBytes(engines.stt.engines[0]?.modelBytes) + ")" + (engines.stt.engines[0]?.vadModel ? " · 무음 감지 모델 있음" : "") + (engines.stt.engines[0]?.ffmpeg ? " · ffmpeg 있음" : " · ffmpeg 없음(wav·mp3·flac·ogg 만)")
                          : "준비 필요: " + (engines.stt.missing.join(", ") || engines.stt.error || "엔진") + " — 설치·모델 내려받기는 크기를 확인하고 승인한 뒤에만 해요."}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className={styles.step} aria-labelledby="employee-builder-step-4">
            <h3 id="employee-builder-step-4"><b>4</b>직원 정보</h3>
            <div className={styles.employeeGrid}>
              <div className={styles.avatarBox}>
                <img className={styles.portrait} src={portraitSrc(draft.avatarId)} alt={(getCrewCharacter(draft.avatarId)?.label ?? "직원") + " 외형"} />
                <p className={styles.avatarReason}>{draft.avatarReason}</p>
                <p className={styles.meta}>외형 {roster.total}종 중 {roster.used}종을 이미 써요 · 아직 안 쓴 외형 {roster.unused.length}종(여 {roster.unusedByGender.female}·남 {roster.unusedByGender.male})</p>
                <div className={styles.altRow} role="group" aria-label="다른 외형 추천">
                  {avatarAlternatives.map((id) => (
                    <button key={id} type="button" aria-pressed={draft.avatarId === id} onClick={() => pickAvatar(id)} title={(crewAvatarTraits[id]?.look ?? id) + (usedAvatarIds.includes(id) ? " · 다른 직원과 같음" : " · 아직 안 씀")}>
                      <img src={portraitSrc(id)} alt={(getCrewCharacter(id)?.label ?? id) + (usedAvatarIds.includes(id) ? " (다른 직원이 쓰는 외형)" : " (아직 안 쓴 외형)")} />
                    </button>
                  ))}
                </div>
                <details className={styles.pickerDetails}>
                  <summary>전체 외형에서 고르기</summary>
                  <CrewCharacterPicker value={draft.avatarId} onChange={(id) => pickAvatar(id)} roleHint={draft.roleTitle} />
                </details>
              </div>
              <div className={styles.fields}>
                <label className={styles.field}><span>이름</span><input value={draft.name} maxLength={32} onChange={(event) => updateDraft({ name: event.target.value })} /></label>
                <label className={styles.field}><span>역할</span><input value={draft.roleTitle} maxLength={48} onChange={(event) => updateDraft({ roleTitle: event.target.value })} /></label>
                <label className={styles.field}>
                  <span>말투</span>
                  <select value={toneChoices.includes(draft.tone) ? draft.tone : "__custom"} onChange={(event) => updateDraft({ tone: event.target.value === "__custom" ? draft.tone + " " : event.target.value })}>
                    {toneChoices.map((tone) => <option key={tone} value={tone}>{tone}</option>)}
                    <option value="__custom">직접 쓰기</option>
                  </select>
                </label>
                {!toneChoices.includes(draft.tone) ? <label className={styles.field}><span>말투 직접 쓰기</span><input value={draft.tone} maxLength={60} onChange={(event) => updateDraft({ tone: event.target.value })} /></label> : null}
                <label className={styles.field}><span>맡는 일</span><textarea value={draft.brief} maxLength={180} rows={3} onChange={(event) => updateDraft({ brief: event.target.value })} /></label>
              </div>
            </div>
            <div className={styles.skillsBox}>
              <h4>쓸 수 있는 스킬</h4>
              {draft.skills.length ? (
                <ul>
                  {draft.skills.map((skill) => (
                    <li key={skill.name} data-pending={skill.pending ? "true" : undefined}>
                      <span className={styles.badge} data-source={skill.source}>{skillSourceLabels[skill.source]}</span>
                      <strong>{skill.label}</strong>
                      <code>{skill.name}</code>
                      <span className={styles.status} data-status={skill.pending ? "create" : "ready"}>{skill.pending ? "저장 전 — 위 2단계에서 내용을 확인하고 저장" : viaLabels[skill.via]}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className={styles.meta}>아직 고른 스킬이 없어요. 위 2단계에서 스킬을 만들거나 가져와 주세요.</p>}
              {draft.workPackIds.length ? <p className={styles.meta}>함께 맡는 업무 종류: {draft.workPackIds.map((id) => workPackLabels[id] ?? id).join(", ")}</p> : null}
              <details className={styles.instructions}>
                <summary>이 직원의 업무 지침 미리보기({draft.instructions.length}줄)</summary>
                <ol>{draft.instructions.map((line) => <li key={line}>{line}</li>)}</ol>
              </details>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => void hire()} disabled={busy === "hire" || Boolean(hired)}>{busy === "hire" ? "만드는 중" : hired ? "만들었어요" : "이 직원 만들기"}</button>
              {draft.skills.some((skill) => skill.pending) ? <span className={styles.meta}>저장 전 스킬은 빼고 만들어요. 스킬을 먼저 저장하면 함께 넣어요.</span> : null}
            </div>
            {hired ? (
              <div className={styles.done} role="status">
                <img src={portraitSrc(hired.avatarId)} alt="" />
                <div>
                  <strong>{hired.name} 님이 팀에 합류했어요</strong>
                  <span>{hired.roleTitle} · 스킬 {hired.skillIds.length}개 · 내 스킬 보관함에 쓰는 직원으로 기록했어요</span>
                </div>
                <button type="button" className={styles.primary} onClick={assignFirstTask}>첫 업무 맡기기</button>
                <button type="button" className={styles.secondary} onClick={() => { setPlan(null); setDraft(null); setHired(null); setReview(null); setRequest(""); }}>다른 직원 만들기</button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );

  const candidates = library.filter((skill) => skill.publishCandidate).length;
  const libraryPanel = (
    <div className={styles.panel} role="tabpanel" id="employee-builder-panel-library" aria-labelledby="employee-builder-tab-library">
      <div className={styles.stepTitleRow}>
        <p className={styles.meta}>내가 만들었거나 가져온 스킬을 버전별로 보관해요. 한 스킬을 여러 직원이 함께 쓸 수 있고, 직접 고친 스킬은 덮어쓰지 않아요.</p>
        <button type="button" className={styles.primary} onClick={() => void checkUpdates(true)} disabled={busy === "check_updates"}>{busy === "check_updates" ? "확인하는 중" : "최신 버전 확인"}</button>
      </div>
      {importBox}
      {reviewPanel}
      {compare ? (
        <div className={styles.review} role="region" aria-label="새 버전 비교">
          <h4>{compare.name}: {compare.fromVersion} → {compare.toVersion}</h4>
          {compare.localModified ? <p className={styles.warnText}>직접 고친 내용이 있어요. '내 수정본 보관 후 적용'을 고르면 고친 내용을 먼저 새 버전으로 남긴 뒤 바꿔요.</p> : null}
          {compare.unpreservable.length ? <p className={styles.warnText}>스킬 폴더에 보관함에 옮겨 담을 수 없는 항목이 있어 자동으로 바꾸지 않아요: {compare.unpreservable.join(", ")}. 그 항목을 스킬 폴더 밖으로 옮긴 뒤 다시 비교해 주세요.</p> : null}
          <ul className={styles.files}>
            {compare.changes.map((change) => (
              <li key={change.path + change.change}>
                <details>
                  <summary><span className={styles.status} data-status={change.change === "removed" ? "app_update_needed" : "create"}>{change.change === "added" ? "추가" : change.change === "removed" ? "삭제" : "바뀜"}</span> <code>{change.path}</code></summary>
                  <div className={styles.diff}>
                    <pre className={styles.pre} aria-label="지금 내용">{change.before ?? ""}</pre>
                    <pre className={styles.pre} aria-label="새 내용">{change.after ?? ""}</pre>
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => void applySkill(compare.name, compare.localModified)} disabled={busy === "apply:" + compare.name || compare.unpreservable.length > 0}>{compare.localModified ? "내 수정본 보관 후 적용" : "이 버전으로 적용"}</button>
            <button type="button" className={styles.secondary} onClick={() => setCompare(null)}>닫기</button>
          </div>
        </div>
      ) : null}
      {!library.length ? (
        <p className={styles.empty}>{sources.library.state === "unavailable" ? sources.library.note : "아직 보관한 스킬이 없어요. '새 직원 만들기'에서 스킬을 만들거나 가져오면 여기에 쌓여요."}</p>
      ) : (
        <ul className={styles.libraryList}>
          {library.map((skill: LibrarySkillInfo) => {
            const update = updates.find((item) => item.name === skill.name);
            const users = (skill.usedBy ?? []).map((item) => item.name || item.teammateId);
            const stored = skill.storage === "stored";
            const deploy = libraryDeployStatus(skill);
            const unpreservable = skill.local?.unpreservable ?? [];
            return (
              <li key={skill.name} id={"employee-skill-" + skill.name} className={styles.libraryItem} data-focus={focusSkill === skill.name ? "true" : undefined}>
                <div className={styles.optionHead}>
                  <strong>{skill.label}</strong>
                  <code>{skill.name}</code>
                  <span className={styles.badge} data-origin={skill.origin.kind}>{originSourceLabel[skill.origin.kind] ?? skill.originLabel}</span>
                  {skill.active?.version ? <span className={styles.meta}>v{skill.active.version}</span> : null}
                  {skill.publishCandidate ? <span className={styles.badge} data-tone="accent">게시 후보</span> : null}
                </div>
                {skill.description ? <p className={styles.optionDetail}>{skill.description}</p> : null}
                <dl className={styles.facts}>
                  <div><dt>쓰는 직원</dt><dd>{users.length ? users.join(", ") : "아직 없음"}</dd></div>
                  <div><dt>상태</dt><dd>{update?.statusLabel ?? skill.latestLabel ?? "아직 확인 안 함"}{skill.local?.localModified ? " · 직접 고친 내용 있음" : ""}{update?.note ? " · " + update.note : ""}</dd></div>
                  {deploy.note ? <div><dt>공용 폴더</dt><dd>{deploy.note}</dd></div> : null}
                  {unpreservable.length ? <div><dt>주의</dt><dd>보관함에 옮겨 담을 수 없는 항목: {unpreservable.join(", ")} — 덮어쓰지 않아요.</dd></div> : null}
                  {update?.releaseUrl ? <div><dt>깃허브 릴리스</dt><dd><a className={styles.link} href={update.releaseUrl} target="_blank" rel="noreferrer noopener">{update.releaseTag}</a></dd></div> : null}
                  {stored ? <div><dt>보관 버전</dt><dd>{(skill.versions ?? []).map((entry) => entry.version).join(" → ") || "-"}</dd></div> : <div><dt>관리</dt><dd>파일은 원래 위치에서 관리(출처·쓰는 직원만 기록)</dd></div>}
                  {skill.origin.url ? <div><dt>출처</dt><dd><a className={styles.link} href={skill.origin.url} target="_blank" rel="noreferrer noopener">{skill.origin.url}</a>{skill.origin.ref ? " · 커밋 " + skill.origin.ref.slice(0, 7) : ""}</dd></div> : null}
                </dl>
                {stored ? (
                  <div className={styles.optionActions}>
                    {update && (update.action === "apply" || update.action === "compare") ? <button type="button" className={styles.secondary} onClick={() => void compareSkill(skill.name)} disabled={busy === "compare:" + skill.name}>새 버전과 비교</button> : null}
                    {update?.action === "apply" ? <button type="button" className={styles.primary} onClick={() => void applySkill(skill.name, false)} disabled={busy === "apply:" + skill.name}>새 버전 적용</button> : null}
                    {skill.local?.localModified && !unpreservable.length ? <button type="button" className={styles.secondary} onClick={() => void libraryAction("library_adopt_local", skill.name)}>내 수정본 보관</button> : null}
                    {deploy.canRedeploy ? <button type="button" className={styles.secondary} onClick={() => void libraryAction("library_redeploy", skill.name)} disabled={busy === "library_redeploy:" + skill.name}>공용 폴더에 다시 넣기</button> : null}
                    {(skill.versions?.length ?? 0) > 1 ? <button type="button" className={styles.secondary} onClick={() => void libraryAction("library_rollback", skill.name)}>이전 버전으로 되돌리기</button> : null}
                    <button type="button" className={styles.secondary} onClick={() => void libraryAction("library_publish_candidate", skill.name, { flag: !skill.publishCandidate })}>{skill.publishCandidate ? "게시 후보에서 빼기" : "웹사이트 게시 후보로 모으기"}</button>
                  </div>
                ) : null}
                {skill.history?.length ? (
                  <details className={styles.history}>
                    <summary>변경 이력 {skill.history.length}건</summary>
                    <ol>{[...skill.history].reverse().map((entry, index) => <li key={entry.at + index}>{entry.at.slice(0, 16).replace("T", " ")} · {entry.action}{entry.version ? " · " + entry.version : ""}{entry.note ? " · " + entry.note : ""}</li>)}</ol>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.meta}>웹사이트 게시 후보 {candidates}개 — 게시는 검토·실제 실행 검증·승인 뒤 따로 진행해요.</p>
    </div>
  );

  return (
    <section className={styles.builder} aria-labelledby="employee-builder-title">
      <header className={styles.header}>
        <div>
          <h2 id="employee-builder-title">필요한 스킬로 새 직원 만들기</h2>
          <p className={styles.lead}>만들고 싶은 직원을 적으면 필요한 능력을 정리하고, 우리 웹사이트 → 이 PC → 공개 후보 → 새로 만들기 순서로 스킬을 구해 직원을 만들어요. 스킬마다 어디서 가져왔는지 보여 드려요.</p>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="직원 만들기 닫기">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </header>
      <div className={styles.tabs} role="tablist" aria-label="직원 만들기 메뉴">
        <button type="button" role="tab" id="employee-builder-tab-build" aria-controls="employee-builder-panel-build" aria-selected={tab === "build"} onClick={() => setTab("build")}>새 직원 만들기</button>
        <button type="button" role="tab" id="employee-builder-tab-library" aria-controls="employee-builder-panel-library" aria-selected={tab === "library"} onClick={() => setTab("library")}>내 스킬 보관함{libraryCount ? " " + libraryCount : ""}</button>
      </div>
      {notice ? <p className={styles.notice} data-tone={notice.tone} role="status">{notice.text}</p> : null}
      {sourcesLoaded && !sources.desktop ? <p className={styles.previewNote}>지금은 미리보기 화면이라 웹사이트·이 PC 확인과 스킬 저장은 설치된 모디크루 앱에서 할 수 있어요. 직원 계획은 그대로 만들어 볼 수 있어요.</p> : null}
      {tab === "build" ? buildPanel : libraryPanel}
    </section>
  );
}

