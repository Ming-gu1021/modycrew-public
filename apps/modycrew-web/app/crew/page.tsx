"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { normalizeAITeammates, createAITeammateFromTemplate, aiTeammateTemplates, defaultWorkPackIdsForTemplate, type AITeammate } from "@/lib/ai-teammates";
import { TeammateProfileDrawer } from "@/components/TeammateProfileDrawer";
import OfficeRoom from "@/components/OfficeRoom";
import EmployeeBuilder from "@/components/EmployeeBuilder";
import { getOfficeRoomCharacter } from "@/lib/office-room-characters";
import { getCrewCharacterRoleAffinity } from "@/lib/crew-character-catalog";
import { buildBuiltinExpertPrompt } from "../../../../packages/domain/dist/builtin-experts.js";
import {
  buildHiredTeammate,
  consumeCrewFirstTask,
  crewConnectionRoute,
  crewConnectionShortLabels,
  crewConnectionStatusLabels,
  crewFirstTaskPath,
  crewJobCapability,
  crewJobs,
  describeRoleTools,
  findHiredTeammate,
  loadCrewConnectionState,
  loadCrewRoster,
  rememberCrewFirstTask,
  resolveRoleFirstTasks,
  saveCrewRoster,
  unknownCrewConnectionState,
  type CrewConnectionId,
  type CrewConnectionState,
  type CrewJob,
  type CrewJobId,
  type ModyRoleRecipe,
} from "@/lib/crew-hiring";
import type { LocalMemoryAppProfile } from "@/lib/desktop-bridge";
import { navigateInternalPath } from "@/lib/safe-navigation";
import styles from "./crew.module.css";

export default function CrewPage() {
  const [teammates, setTeammates] = useState<AITeammate[]>([]);
  const [profile, setProfile] = useState<LocalMemoryAppProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<CrewJobId | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [justHiredId, setJustHiredId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("전체");
  const [query, setQuery] = useState("");
  const [customDraft, setCustomDraft] = useState<AITeammate | null>(null);
  const [placementRequest, setPlacementRequest] = useState<{ id: string; nonce: number }>();
  const [connectionState, setConnectionState] = useState<CrewConnectionState>(() => ({ ...unknownCrewConnectionState }));
  // 필요한 스킬로 새 직원 만들기(내 스킬 보관함 포함). /crew?builder=1&request=… · /crew?library=1&skill=… 로도 열린다.
  const [builder, setBuilder] = useState<{ request: string; tab: "build" | "library"; skill: string; nonce: number } | null>(null);
  const catalogMatteId = `crew-catalog-${useId().replace(/:/g, "")}`;
  const panelRef = useRef<HTMLElement>(null);
  const customSaveRef = useRef(false);

  const refresh = useCallback(async () => {
    const roster = await loadCrewRoster();
    setTeammates(roster.teammates);
    setProfile(roster.profile);
    setLoading(false);
    return roster;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("builder") !== "1" && params.get("library") !== "1") return;
    setBuilder({ request: (params.get("request") ?? "").slice(0, 600), tab: params.get("library") === "1" ? "library" : "build", skill: (params.get("skill") ?? "").slice(0, 64), nonce: Date.now() });
  }, []);

  // 새 직원 외형은 우리 팀과 기본 전문가가 이미 쓰는 외형과 겹치지 않게 고른다.
  const usedAvatarIds = useMemo(() => [...teammates.map((teammate) => teammate.avatarId), ...crewJobs.map((job) => job.avatarId)], [teammates]);
  const builderExperts = useMemo(() => crewJobs.map((job) => ({ id: job.id, name: job.name, roleTitle: job.roleTitle })), []);

  function openBuilder(tab: "build" | "library") {
    setError("");
    setBuilder({ request: "", tab, skill: "", nonce: Date.now() });
    window.requestAnimationFrame(() => document.getElementById("employee-builder-title")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function closeBuilder() {
    setBuilder(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has("builder") || url.searchParams.has("library")) {
      for (const key of ["builder", "library", "request", "skill"]) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  }

  // 연결 상태는 직무마다 필요한 연결을 보여 줄 때 쓴다. 연결 화면에 다녀오면(창 포커스) 다시 확인한다.
  useEffect(() => {
    let cancelled = false;
    const refreshConnections = (force = false) => {
      void loadCrewConnectionState({ force }).then((next) => {
        if (!cancelled) setConnectionState(next);
      });
    };
    refreshConnections();
    const onFocus = () => refreshConnections(true);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const selectedJob = useMemo(() => crewJobs.find((job) => job.id === selectedJobId) ?? null, [selectedJobId]);
  const selectedHire = selectedJob ? findHiredTeammate(selectedJob, teammates) : undefined;
  const selectedCapability = useMemo(() => (selectedJob ? crewJobCapability(selectedJob) : null), [selectedJob]);
  const selectedFirstTasks = useMemo(
    () => (selectedCapability ? resolveRoleFirstTasks(selectedCapability, connectionState) : []),
    [selectedCapability, connectionState],
  );
  const missingConnections = selectedCapability
    ? selectedCapability.connections.filter((connection) => connectionState[connection.id] === "missing")
    : [];
  const visibleJobs = crewJobs.filter(job => (category === "전체" || job.category === category) &&
    [job.name, job.roleTitle, job.summary, ...job.duties, ...crewJobCapability(job).canDo].join(" ").toLowerCase().includes(query.trim().toLowerCase()));

  function createCustom(job?: CrewJob) {
    setError("");
    const base = job ? buildHiredTeammate(job) : createAITeammateFromTemplate("custom");
    setCustomDraft({ ...base, id: "teammate-custom-" + Date.now(), templateId: "custom",
      builtinExpertId: undefined, promptVersion: undefined, name: job ? "내 " + job.roleTitle : "나의 전문가" });
  }

  function showPlacement(teammateId: string) {
    setSelectedJobId(null);
    setPlacementRequest({ id: teammateId, nonce: Date.now() });
    document.getElementById("crew-team-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function candidateFigure(job: { avatarId?: string; roleTitle: string }): CSSProperties {
    const character = getOfficeRoomCharacter(job.avatarId, getCrewCharacterRoleAffinity(job.roleTitle) ?? "doc");
    return { backgroundImage: `url("${character.atlas}")`, backgroundPosition: `${character.column * (100 / 3) + character.offsetX / (1774 * 3 / 4) * 100}% 0%`, filter: `url(#${catalogMatteId})` };
  }

  async function saveCustom(teammate: AITeammate) {
    if (customSaveRef.current) return;
    customSaveRef.current = true;
    setBusy("custom-save");
    setError("");
    try {
      const latest = await loadCrewRoster();
      const next = normalizeAITeammates([...latest.teammates.filter(item => item.id !== teammate.id), teammate]);
      const saved = await saveCrewRoster(next, latest.profile);
      setTeammates(next); setProfile(saved); setCustomDraft(null); setJustHiredId(teammate.id);
    } catch { setError("전문가를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { customSaveRef.current = false; setBusy(null); }
  }

  useEffect(() => {
    if (!selectedJob) return;
    panelRef.current?.focus({ preventScroll: true });
    revealPanel();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedJobId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedJob]);

  useEffect(() => {
    if (justHiredId) revealPanel();
  }, [justHiredId]);

  // 작은 창에서도 프로필 아래의 고용하기·첫 업무 맡기기 버튼까지 보이도록 내린다.
  function revealPanel() {
    window.requestAnimationFrame(() => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      panelRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
    });
  }

  async function hire(job: CrewJob) {
    setBusy(job.id);
    setError("");
    try {
      const latest = await loadCrewRoster();
      const existing = findHiredTeammate(job, latest.teammates);
      if (existing) {
        setTeammates(latest.teammates);
        setProfile(latest.profile);
        setJustHiredId(existing.id);
        return;
      }
      const teammate = buildHiredTeammate(job);
      const next = normalizeAITeammates([...latest.teammates, teammate]);
      const savedProfile = await saveCrewRoster(next, latest.profile);
      setTeammates(next);
      setProfile(savedProfile ?? latest.profile);
      setJustHiredId(teammate.id);
    } catch {
      setError("직원 정보를 저장하지 못했습니다. 잠시 후 다시 눌러 주세요.");
    } finally {
      setBusy(null);
    }
  }

  function openConnection(id: CrewConnectionId) {
    if (!selectedJob) return;
    try {
      navigateInternalPath(crewConnectionRoute(id, selectedJob.roleTitle + " 첫 업무에 필요한 연결"));
    } catch {
      setError("연결 화면을 열지 못했습니다. 왼쪽 메뉴의 연결에서 다시 시도해 주세요.");
    }
  }

  async function assign(teammate: AITeammate, firstTaskPrompt?: string) {
    setBusy("assign-" + teammate.id);
    setError("");
    try {
      // 고른 첫 업무는 새 대화의 예시 요청 맨 앞에 보인다(누르면 입력칸에 채워짐). 그냥 '일 맡기기'면 지난 선택을 지운다.
      if (firstTaskPrompt) rememberCrewFirstTask(teammate.id, firstTaskPrompt);
      else consumeCrewFirstTask(teammate.id);
      const latest = await loadCrewRoster();
      await saveCrewRoster(latest.teammates, latest.profile ?? profile, teammate.id);
      // '일 맡기기'는 새 일을 맡기는 동작이라 지난 대화 대신 새 대화로 연다.
      navigateInternalPath(crewFirstTaskPath(teammate.id));
    } catch {
      setBusy(null);
      setError("대화 화면으로 이동하지 못했습니다. 잠시 후 다시 눌러 주세요.");
    }
  }

  return (
    <div className={styles.page}>
      <svg width="0" height="0" className={styles.filterDefinitions} aria-hidden="true"><defs><filter id={catalogMatteId} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -5 12 -5 3 0" /></filter></defs></svg>
      <header className={styles.heading}>
        <h1>필요한 분야의 AI 전문가를 팀에 합류시키세요</h1>
        <p className={styles.lead}>전문가마다 할 수 있는 일, 항상 승인받는 일, 첫 업무가 정해져 있습니다. 기본 지침은 고정되고, 직접 만든 전문가의 지침은 수정할 수 있어요.</p>
        <div className={styles.headingActions}>
          <button type="button" className={styles.primary} onClick={() => openBuilder("build")} aria-expanded={builder?.tab === "build"}>필요한 스킬로 새 직원 만들기</button>
          <button type="button" className={styles.secondary} onClick={() => createCustom()}>나만의 전문가 만들기</button>
          <button type="button" className={styles.secondary} onClick={() => openBuilder("library")} aria-expanded={builder?.tab === "library"}>내 스킬 보관함</button>
        </div>
        <ol className={styles.steps} aria-label="고용 순서">
          <li><b>1</b>직무 고르기</li>
          <li><b>2</b>맡을 일·기준 확인</li>
          <li><b>3</b>고용하기</li>
        </ol>
      </header>

      {builder ? (
        <EmployeeBuilder
          key={builder.nonce}
          initialRequest={builder.request}
          initialTab={builder.tab}
          focusSkill={builder.skill}
          usedAvatarIds={usedAvatarIds}
          experts={builderExperts}
          onClose={closeBuilder}
          onHired={(teammate) => { void refresh().then(() => setJustHiredId(teammate.id)); }}
        />
      ) : null}

      <section className={styles.team} aria-labelledby="crew-team-title">
        <div className={styles.sectionHead}>
          <h2 id="crew-team-title">우리 팀과 사무실</h2>
          <span className={styles.meta}>{loading ? "불러오는 중" : teammates.length + "명 합류"}</span>
        </div>
        <div className={styles.teamOffice}><OfficeRoom
          workers={teammates.map(teammate => ({ id: teammate.id, name: teammate.name, avatarId: teammate.avatarId, role: getCrewCharacterRoleAffinity(`${teammate.templateId} ${teammate.roleTitle}`) ?? "doc", roleLabel: teammate.roleTitle, status: "idle" }))}
          placementRequest={placementRequest}
          onSelect={id => setCustomDraft(teammates.find(teammate => teammate.id === id) ?? null)}
          onAdd={() => document.getElementById("crew-candidates-title")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        /></div>
        <ul className={styles.teamList}>
          {teammates.map((teammate) => (
            <li key={teammate.id} className={styles.member} data-new={teammate.id === justHiredId ? "true" : undefined}>
              <span className={styles.memberAvatar} aria-hidden="true"><span className={styles.candidateFigure} style={candidateFigure(teammate)} /></span>
              <span className={styles.memberText}>
                <strong>{teammate.name}</strong>
                <span>{teammate.roleTitle}</span>
              </span>
              <button
                type="button"
                className={styles.memberAction}
                onClick={() => void assign(teammate)}
                disabled={busy === "assign-" + teammate.id}
                aria-label={teammate.name + "에게 일 맡기기"}
              >
                일 맡기기
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className={styles.body} data-open={selectedJob ? "true" : "false"}>
        <section aria-labelledby="crew-candidates-title">
          <div className={styles.sectionHead}>
            <h2 id="crew-candidates-title">전문가 {visibleJobs.length}명</h2>
            <span className={styles.meta}>직무를 누르면 맡는 일과 기준을 볼 수 있어요</span>
          </div>
          <div className={styles.filters}>
            <label>전문가 검색<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="직무나 맡길 일 검색" /></label>
            <div className={styles.categories} aria-label="전문 분야">
              {["전체", ...new Set(crewJobs.map(job => job.category))].map(item => (
                <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>
              ))}
            </div>
          </div>
          {!visibleJobs.length ? <p role="status">검색 결과가 없습니다. 다른 직무나 업무로 찾아보세요.</p> : null}
          <div className={styles.grid}>
            {visibleJobs.map((job) => {
              const hired = findHiredTeammate(job, teammates);
              const selected = job.id === selectedJobId;
              return (
                <button
                  key={job.id}
                  type="button"
                  className={styles.card}
                  data-selected={selected ? "true" : undefined}
                  onClick={() => {
                    setError("");
                    setSelectedJobId(selected ? null : job.id);
                  }}
                  aria-pressed={selected}
                  aria-label={job.name + " " + job.roleTitle + " 프로필 보기"}
                >
                  <span className={styles.portrait} aria-hidden="true">
                    <span className={styles.candidateFigure} style={candidateFigure(job)} />
                  </span>
                  <span className={styles.cardBody}>
                    <span className={styles.role}>{job.roleTitle}</span>
                    <strong className={styles.name}>{job.name}</strong>
                    <span className={styles.summary}>{job.summary}</span>
                    <span className={styles.status} data-state={hired ? "hired" : "open"}>
                      {hired ? "합류 완료" : "채용 가능"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {selectedJob && selectedCapability ? (
          <aside
            ref={panelRef}
            key={selectedJob.id}
            className={styles.profile}
            tabIndex={-1}
            aria-labelledby="crew-profile-title"
          >
            <div className={styles.profileHero} aria-hidden="true">
              <span className={styles.candidateFigure} style={candidateFigure(selectedJob)} />
            </div>
            <button type="button" className={styles.close} onClick={() => setSelectedJobId(null)} aria-label="프로필 닫기">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            <div className={styles.profileBody}>
              <div>
                <span className={styles.role}>{selectedJob.roleTitle}</span>
                <h2 id="crew-profile-title">{selectedJob.name}</h2>
                <p className={styles.profileSummary}>{selectedJob.summary}</p>
              </div>
              <dl className={styles.facts}>
                <div>
                  <dt>맡는 일</dt>
                  <dd>
                    <ul>
                      {selectedJob.duties.map((duty) => <li key={duty}>{duty}</li>)}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt>할 수 있는 일</dt>
                  <dd>
                    <ul>
                      {selectedCapability.canDo.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt>항상 승인받는 일</dt>
                  <dd>
                    <ul>
                      {selectedCapability.approvalRequired.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt>하지 않는 일</dt>
                  <dd>
                    <ul>
                      {selectedCapability.cannotDo.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt>쓰는 도구</dt>
                  <dd>{describeRoleTools(selectedCapability).join(" · ")}</dd>
                </div>
                <div>
                  <dt>필요한 연결</dt>
                  <dd>
                    <ul>
                      {selectedCapability.connections.map((connection) => {
                        const status = connectionState[connection.id];
                        return (
                          <li key={connection.id}>
                            {connection.label}{" "}
                            <span className={styles.status} data-state={status === "connected" ? "hired" : "open"}>
                              {crewConnectionStatusLabels[status]}
                            </span>
                            {connection.neededFor === "first_task" ? " · 첫 업무에 필요" : " · 있으면 더 할 수 있어요"}
                          </li>
                        );
                      })}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt>첫 업무</dt>
                  <dd>
                    <ul>
                      {selectedFirstTasks.map((task) => (
                        <li key={task.label}>
                          {task.prompt}
                          {task.usedFallback && task.requiresConnection ? (
                            <span className={styles.meta}> · {crewConnectionShortLabels[task.requiresConnection]} 연결 전이라 붙여 넣은 자료로 시작해요</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt>준비하면 좋은 자료</dt>
                  <dd>{selectedJob.needs}</dd>
                </div>
                <div>
                  <dt>일하는 기준</dt>
                  <dd>
                    <ul>
                      {selectedJob.rules.map((rule) => <li key={rule}>{rule}</li>)}
                    </ul>
                  </dd>
                </div>
              </dl>
              {missingConnections.map((connection) => (
                <button key={connection.id} type="button" className={styles.secondary} onClick={() => openConnection(connection.id)}>
                  {crewConnectionShortLabels[connection.id]} 연결하기{connection.neededFor === "first_task" ? " · 첫 업무에 필요" : ""}
                </button>
              ))}
              <details className={styles.promptDetails}>
                <summary>업무 레시피 {selectedCapability.recipes.length}개 · 요청에 맞으면 이 형식으로 정리해요</summary>
                <pre>{formatRecipeList(selectedCapability.recipes)}</pre>
              </details>
              <details className={styles.promptDetails}>
                <summary>전문가 업무 지침 보기 · 수정 불가</summary>
                <pre>{buildBuiltinExpertPrompt({ builtinExpertId: selectedJob.id })}</pre>
              </details>
              <button type="button" className={styles.secondary} onClick={() => createCustom(selectedJob)}>이 지침으로 나만의 전문가 만들기</button>
              {selectedHire ? (
                <div className={styles.joined} role="status">
                  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                    <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.14" />
                    <path d="M6 10.4l2.6 2.6L14.2 7.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>
                    <strong>{selectedJob.name} 님이 우리 팀에 합류했어요</strong>
                    <span>필요한 자료와 연결을 확인한 뒤 첫 업무를 맡겨 주세요.</span>
                  </span>
                </div>
              ) : null}
              {error ? <p className={styles.error} role="alert">{error}</p> : null}
            </div>
            <div className={styles.profileActions}>
              {selectedHire ? <button type="button" className={styles.secondary} onClick={() => showPlacement(selectedHire.id)}>사무실에서 자리 정하기</button> : null}
              {selectedHire && selectedFirstTasks.length ? (
                selectedFirstTasks.map((task, index) => (
                  <button
                    key={task.label}
                    type="button"
                    className={index === 0 ? styles.primary : styles.secondary}
                    onClick={() => void assign(selectedHire, task.prompt)}
                    disabled={busy === "assign-" + selectedHire.id}
                  >
                    {index === 0 ? "첫 업무 맡기기 · " + task.label : task.label + "부터 시작"}
                  </button>
                ))
              ) : selectedHire ? (
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => void assign(selectedHire)}
                  disabled={busy === "assign-" + selectedHire.id}
                >
                  첫 업무 맡기기
                </button>
              ) : (
                <button type="button" className={styles.primary} onClick={() => void hire(selectedJob)} disabled={busy === selectedJob.id || loading}>
                  {busy === selectedJob.id ? "합류 준비 중" : "고용하기"}
                </button>
              )}
              <button type="button" className={styles.secondary} onClick={() => setSelectedJobId(null)}>
                {selectedHire ? "다른 직무 보기" : "닫기"}
              </button>
            </div>
          </aside>
        ) : null}
      </div>
      {customDraft ? <TeammateProfileDrawer open teammate={customDraft} isNew={!teammates.some(teammate => teammate.id === customDraft.id)} status="idle" currentTask="" workCount={0} isMain={false}
        templates={aiTeammateTemplates} onClose={() => { if (!customSaveRef.current) setCustomDraft(null); }} savePending={busy === "custom-save"} saveError={error}
        onPickTemplate={teammates.some(teammate => teammate.id === customDraft.id) ? undefined : templateId => {
          const base = createAITeammateFromTemplate(templateId);
          setCustomDraft({ ...base, id: customDraft.id, templateId: "custom", workPackIds: defaultWorkPackIdsForTemplate(templateId) });
        }} onSave={teammate => void saveCustom(teammate)} /> : null}
    </div>
  );
}

/** 업무 레시피 목록(접기 상세 안). 이름·쓰는 때·결과 구성만 보여 준다. */
function formatRecipeList(recipes: readonly ModyRoleRecipe[]): string {
  return recipes
    .map((recipe) => "• " + recipe.label + " — " + recipe.whenToUse + "\n  결과: " + recipe.outputFormat.join(" → "))
    .join("\n\n");
}

