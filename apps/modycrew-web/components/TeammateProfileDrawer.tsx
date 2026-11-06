"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AITeammate, AITeammateTeam, AITeammateTemplate } from "@/lib/ai-teammates";
import { defaultAITeammateId, getBuiltinExpert, normalizeAITeammates } from "@/lib/ai-teammates";
import { sceneStatusMeta, teamAccent, type TeammateSceneStatus } from "@/lib/teammate-appearance";
import {
  CREW_CHARACTERS,
  crewCharacterRoleAffinityLabels,
  getCrewCharacter,
  getCrewCharacterRoleAffinity,
  type CrewCharacterId,
} from "@/lib/crew-character-catalog";
import CrewAvatar, { type CrewAvatarActivity, type CrewAvatarRole } from "@/components/CrewAvatar";
import { CrewSkillsPanel } from "@/components/CrewSkillsPanel";
import { defaultAISkillPacks } from "@/lib/ai-skills";
import {
  crewConnectionRoute,
  crewConnectionShortLabels,
  crewConnectionStatusLabels,
  crewFirstTaskPath,
  loadCrewConnectionState,
  rememberCrewFirstTask,
  resolveRoleFirstTasks,
  teammateRoleCapability,
  unknownCrewConnectionState,
  type CrewConnectionId,
  type CrewConnectionState,
} from "@/lib/crew-hiring";
import { navigateInternalPath } from "@/lib/safe-navigation";
import { useDrawerMotion } from "@/hooks/useDrawerMotion";
import styles from "./TeammateProfileDrawer.module.css";

const skillTitleById = new Map(defaultAISkillPacks.map((pack) => [pack.id, pack.title]));

// 성격 프리셋 — 누르면 해당 문장이 성향(instructions)에 추가/제거된다.
// 뭘 적을지 모르는 사용자도 칩 몇 개로 성격을 만들 수 있게 하는 장치.
const personaPresetGroups: Array<{
  group: string;
  options: Array<{ id: string; label: string; line: string }>;
}> = [
  {
    group: "말투",
    options: [
      { id: "tone-formal", label: "정중한 존댓말", line: "말투는 항상 정중한 존댓말로 답합니다." },
      { id: "tone-friendly", label: "친근하고 편하게", line: "말투는 친근하고 편안하게, 딱딱하지 않게 답합니다." },
      { id: "tone-brief", label: "짧은 보고체", line: "군더더기 없이 짧은 보고체로 답합니다." },
    ],
  },
  {
    group: "일 처리 방식",
    options: [
      { id: "work-check", label: "실행 전 확인 먼저", line: "실행 전에 확인 질문을 먼저 하고 신중하게 진행합니다." },
      { id: "work-fast", label: "초안부터 빠르게", line: "완벽보다 속도 — 초안을 빨리 만들어 보여주고 다듬습니다." },
      { id: "work-data", label: "근거·숫자 중심", line: "판단할 때는 근거와 숫자를 함께 제시합니다." },
    ],
  },
  {
    group: "보고 스타일",
    options: [
      { id: "report-summary", label: "결론부터 요점만", line: "보고할 때 결론부터 말하고 요점만 정리합니다." },
      { id: "report-detail", label: "과정까지 자세히", line: "보고할 때 진행 과정과 이유까지 자세히 설명합니다." },
    ],
  },
  {
    group: "태도",
    options: [
      { id: "att-double", label: "꼼꼼한 더블체크", line: "결과를 내기 전 스스로 한 번 더 검토합니다." },
      { id: "att-idea", label: "아이디어 적극 제안", line: "요청 밖이라도 도움이 될 아이디어를 적극 제안합니다." },
    ],
  },
];

// 필드 길이 제한은 lib/ai-teammates.ts 의 sanitizeAITeammate 와 맞춥니다.
const limits = { name: 32, teamLabel: 28, roleTitle: 48, channelName: 42, brief: 180, instruction: 160 } as const;

type DrawerTab = "profile" | "look" | "traits" | "settings";

type TeammateProfileDrawerProps = {
  open: boolean;
  teammate: AITeammate | null;
  isNew: boolean;
  status: TeammateSceneStatus;
  currentTask: string;
  workCount: number;
  isMain: boolean;
  templates: AITeammateTemplate[];
  onPickTemplate?: (templateId: AITeammateTeam) => void;
  onClose: () => void;
  onSave: (teammate: AITeammate) => void;
  savePending?: boolean;
  saveError?: string;
  onRemove?: (teammateId: string) => void;
  onDelegate?: (teammate: AITeammate) => void;
  resultContent?: ReactNode;
};

export function TeammateProfileDrawer({
  open,
  teammate,
  isNew,
  status,
  currentTask,
  workCount,
  isMain,
  templates,
  onPickTemplate,
  onClose,
  onSave,
  savePending = false,
  saveError = "",
  onRemove,
  onDelegate,
  resultContent,
}: TeammateProfileDrawerProps) {
  const [draft, setDraft] = useState<AITeammate | null>(teammate);
  const [tab, setTab] = useState<DrawerTab>(isNew ? "settings" : "profile");
  const [instructionsText, setInstructionsText] = useState("");
  const [connectionState, setConnectionState] = useState<CrewConnectionState>(() => ({ ...unknownCrewConnectionState }));
  const { panelRef, shown, closing, requestClose } = useDrawerMotion(open && Boolean(draft), onClose);

  useEffect(() => {
    setDraft(teammate);
    setInstructionsText(teammate ? teammate.instructions.join("\n") : "");
    setTab(isNew ? "settings" : "profile");
  }, [teammate, isNew]);

  // 역할에 필요한 연결(메일·캘린더·드라이브·AI)이 지금 연결됐는지 보여 주려고 열릴 때 한 번 확인한다.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadCrewConnectionState().then((next) => {
      if (!cancelled) setConnectionState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const patch = useCallback((changes: Partial<AITeammate>) => {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }, []);

  // 프리셋 칩 토글 — 성향 텍스트에 해당 문장을 넣거나 뺀다 (텍스트칸과 항상 동기화)
  const togglePresetLine = useCallback((line: string) => {
    setInstructionsText((current) => {
      const lines = current
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
      const next = lines.includes(line) ? lines.filter((item) => item !== line) : [...lines, line];
      return next.join("\n");
    });
  }, []);

  const toggleSkill = useCallback(
    (skillId: string) => {
      setDraft((current) => {
        if (!current) return current;
        const active = current.skillIds.includes(skillId);
        const nextSkillIds = active
          ? current.skillIds.filter((item) => item !== skillId)
          : [...current.skillIds, skillId].slice(0, 16);
        return { ...current, skillIds: nextSkillIds };
      });
    },
    [],
  );

  const handleSave = useCallback(() => {
    if (!draft) return;
    const instructions = instructionsText
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim().slice(0, limits.instruction))
      .filter(Boolean)
      .slice(0, 8);
    const cleaned: AITeammate = {
      ...draft,
      name: (draft.name || "새 크루").slice(0, limits.name),
      teamLabel: (draft.teamLabel || "팀").slice(0, limits.teamLabel),
      roleTitle: (draft.roleTitle || "역할").slice(0, limits.roleTitle),
      channelName: (draft.channelName || "작업 공간").slice(0, limits.channelName),
      brief: (draft.brief || "").slice(0, limits.brief),
      instructions: instructions.length ? instructions : draft.instructions,
      updatedAt: Date.now(),
    };
    onSave(normalizeAITeammates([cleaned]).find(item => item.id === cleaned.id)!);
  }, [draft, instructionsText, onSave]);

  if (!open || !draft) return null;

  const locked = Boolean(getBuiltinExpert(draft));
  const accent = teamAccent(draft.templateId);
  const meta = sceneStatusMeta[status];
  const removable = !isNew && draft.id !== defaultAITeammateId;
  const crewRole: CrewAvatarRole =
    getCrewCharacter(draft.avatarId)?.roleAffinity ??
    getCrewCharacterRoleAffinity(`${draft.templateId} ${draft.roleTitle}`) ??
    "doc";
  const crewActivity: CrewAvatarActivity =
    !isNew && status === "working" ? "working" : !isNew && status === "approval" ? "waiting" : "idle";
  const selectedCharacter = getCrewCharacter(draft.avatarId);
  const visibleInstructions = draft.instructions.map((line) => line.trim()).filter(Boolean);
  // 역할 정본: 실제로 할 수 있는 일·승인받는 일·한계·필요한 연결·첫 업무·업무 레시피.
  const capability = teammateRoleCapability(draft);
  const firstTasks = resolveRoleFirstTasks(capability, connectionState);
  const missingConnections = capability.connections.filter((connection) => connectionState[connection.id] === "missing");
  // 첫 업무는 저장된 직원만 새 대화로 시작할 수 있다. 기본 비서는 대화 첫 화면이 달라 목록으로만 보여 준다.
  const canStartFirstTask = !isNew && draft.id !== defaultAITeammateId;
  const startFirstTask = (prompt: string) => {
    rememberCrewFirstTask(draft.id, prompt);
    try {
      navigateInternalPath(crewFirstTaskPath(draft.id));
    } catch {
      // 이동이 막히면 그대로 둔다. 같은 요청은 대화 첫 화면 예시에서도 보인다.
    }
  };
  const openConnection = (id: CrewConnectionId) => {
    try {
      navigateInternalPath(crewConnectionRoute(id, draft.roleTitle + " 업무에 필요한 연결"));
    } catch {
      // 연결 화면은 왼쪽 메뉴에서도 열 수 있다.
    }
  };

  return (
    <div className={`${styles.overlay} mc-drawer-backdrop`} data-open={shown} role="presentation" onClick={requestClose}>
      <aside
        ref={panelRef}
        className={`${styles.panel} t-panel-slide mc-drawer-motion`}
        data-open={shown}
        data-closing={closing}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "새 크루 추가" : `${draft.name} 크루 프로필`}
        style={{ ["--panel-accent" as string]: accent }}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.close} onClick={requestClose} aria-label="닫기">
          ✕
        </button>

        <header className={styles.hero}>
          <div className={styles.heroAvatar}>
            <CrewAvatar
              role={crewRole}
              avatarId={draft.avatarId}
              activity={crewActivity}
              size="scene"
              decorative={false}
              label={`${draft.name} 캐릭터`}
            />
          </div>
          <div className={styles.heroInfo}>
            <span className={styles.teamBadge}>{draft.teamLabel}</span>
            <h2 className={styles.heroName}>{draft.name}</h2>
            <p className={styles.heroRole}>
              {draft.roleTitle}
              {isMain ? <span className={styles.mainTag}> · 메인 담당</span> : null}
            </p>
            <p className={styles.heroChannel}>{draft.channelName}</p>
            {!isNew ? (
              <span className={styles.heroStatus} data-tone={meta.tone}>
                <i />
                {meta.label} · {meta.caption}
              </span>
            ) : (
              <span className={styles.heroStatus} data-tone="muted">
                <i />
                추가하면 바로 이 사무실 자리에 앉아요
              </span>
            )}
          </div>
        </header>

        {isNew ? (
          <div className={styles.rolePicker} aria-label="역할 고르기">
            <span className={styles.rolePickerLabel}>어떤 일을 맡길까요?</span>
            <div className={styles.roleChips}>
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={styles.roleChip}
                  data-active={template.id === draft.templateId ? "true" : undefined}
                  onClick={() => onPickTemplate?.(template.id)}
                >
                  {template.teamLabel}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <nav className={styles.tabs} aria-label="프로필 보기 방식">
          {(
            [
              ["profile", "프로필"],
              ["look", "외형 꾸미기"],
              ["traits", "성향·업무"],
              ["settings", "기본 설정"],
            ] as Array<[DrawerTab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={styles.tab}
              data-active={tab === id ? "true" : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className={styles.body}>
          {tab === "profile" ? (
            <div className={styles.section}>
              <p className={styles.brief}>{draft.brief || "맡길 일을 아직 정하지 않았어요. 기본 설정에서 적어주세요."}</p>
              <dl className={styles.factGrid}>
                <div>
                  <dt>팀</dt>
                  <dd>{draft.teamLabel}</dd>
                </div>
                <div>
                  <dt>작업 공간</dt>
                  <dd>{draft.channelName}</dd>
                </div>
                <div>
                  <dt>최근 처리</dt>
                  <dd>{workCount}건</dd>
                </div>
                <div>
                  <dt>지금 상태</dt>
                  <dd>{meta.label}</dd>
                </div>
              </dl>
              {!isNew && currentTask.trim() ? (
                <div className={styles.nowDoing}>
                  <span className={styles.nowLabel}>{status === "working" ? "진행 중인 업무" : status === "done" ? "최근 완료 기록" : status === "failed" ? "실패한 업무" : status === "unknown" ? "마지막 업무 기록" : "업무 안내"}</span>
                  <span className={styles.nowValue}>{currentTask}</span>
                </div>
              ) : null}
              {resultContent}
              <div className={styles.personaList}>
                <span className={styles.skillsLabel}>할 수 있는 일</span>
                <ul>
                  {capability.canDo.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className={styles.personaList}>
                <span className={styles.skillsLabel}>항상 승인받는 일</span>
                <ul>
                  {capability.approvalRequired.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className={styles.personaList}>
                <span className={styles.skillsLabel}>하지 않는 일</span>
                <ul>
                  {capability.cannotDo.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className={styles.personaList}>
                <span className={styles.skillsLabel}>필요한 연결</span>
                <ul>
                  {capability.connections.map((connection) => (
                    <li key={connection.id}>
                      {connection.label} · {crewConnectionStatusLabels[connectionState[connection.id]]}
                      {connection.neededFor === "first_task" ? " · 첫 업무에 필요" : ""}
                    </li>
                  ))}
                </ul>
                {missingConnections.length ? (
                  <div className={styles.presetChips}>
                    {missingConnections.map((connection) => (
                      <button key={connection.id} type="button" className={styles.ghostButton} onClick={() => openConnection(connection.id)}>
                        {crewConnectionShortLabels[connection.id]} 연결하기
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className={styles.presetBlock} aria-label="첫 업무">
                <span className={styles.presetTitle}>첫 업무</span>
                <small className={styles.presetHint}>
                  {canStartFirstTask
                    ? "누르면 새 대화가 열리고, 고른 요청이 예시 맨 앞에 보여요. 예시를 누르면 입력칸에 채워져요."
                    : isNew
                      ? "채용을 확정한 뒤 대화에서 이렇게 맡겨 보세요."
                      : "대화창에 이렇게 맡겨 보세요."}
                </small>
                <div className={styles.presetChips}>
                  {firstTasks.map((task) =>
                    canStartFirstTask ? (
                      <button key={task.label} type="button" className={styles.presetChip} onClick={() => startFirstTask(task.prompt)}>
                        {task.prompt}
                      </button>
                    ) : (
                      <span key={task.label} className={styles.skillChip}>
                        {task.prompt}
                      </span>
                    ),
                  )}
                </div>
                {firstTasks.some((task) => task.usedFallback) ? (
                  <small className={styles.presetHint}>필요한 연결이 없어 붙여 넣은 자료로 시작하는 요청으로 바꿨어요.</small>
                ) : null}
              </div>
              {capability.recipes.length ? (
                <div className={styles.skills}>
                  <span className={styles.skillsLabel}>업무 레시피 · 요청에 맞으면 이 형식으로 정리해요</span>
                  <div className={styles.skillChips}>
                    {capability.recipes.map((recipe) => (
                      <span key={recipe.id} className={styles.skillChip} title={recipe.whenToUse}>
                        {recipe.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <CrewSkillsPanel teammate={draft} />
              {draft.skillIds.length ? (
                <div className={styles.skills}>
                  <span className={styles.skillsLabel}>업무 스킬</span>
                  <div className={styles.skillChips}>
                    {draft.skillIds.map((skillId) => (
                      <span key={skillId} className={styles.skillChip}>
                        {skillTitleById.get(skillId) ?? skillId.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {visibleInstructions.length ? (
                <div className={styles.personaList}>
                  <span className={styles.skillsLabel}>{locked ? "업무 절차와 검수 기준" : "일하는 성향"}</span>
                  <ul>
                    {visibleInstructions.map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "look" ? (
            <div className={styles.section}>
              <p className={styles.hint}>
                우리 오피스 캐릭터 중에서 이 크루의 모습을 골라요. 고르면 사무실 자리에 바로 반영됩니다.
              </p>
              {selectedCharacter ? (
                <p className={styles.charSelected}>
                  지금 모습: <b>{selectedCharacter.label}</b> ·{" "}
                  {crewCharacterRoleAffinityLabels[selectedCharacter.roleAffinity]} 분위기
                </p>
              ) : null}
              <div className={styles.charGrid} role="listbox" aria-label="캐릭터 고르기">
                {CREW_CHARACTERS.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    role="option"
                    aria-selected={draft.avatarId === character.id}
                    className={styles.charCell}
                    data-active={draft.avatarId === character.id ? "true" : undefined}
                    onClick={() => patch({ avatarId: character.id as CrewCharacterId })}
                  >
                    <span className={styles.charThumb}>
                      <CrewAvatar
                        role={character.roleAffinity}
                        avatarId={character.id}
                        activity="idle"
                        size="scene"
                        decorative
                      />
                    </span>
                    <b className={styles.charName}>{character.label}</b>
                    <span className={styles.charRole}>
                      {crewCharacterRoleAffinityLabels[character.roleAffinity]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {tab === "traits" ? (
            <div className={styles.section}>
              {locked ? <p className={styles.hint} role="note">기본 전문가의 역할과 업무 지침은 고정되어 있습니다. 다른 지침이 필요하면 새 크루를 직접 만들어 주세요.</p> : null}
              <label className={styles.field}>
                <span>맡길 일 (한 줄 소개)</span>
                <textarea
                  rows={3}
                  maxLength={limits.brief}
                  readOnly={locked}
                  value={draft.brief}
                  onChange={(event) => patch({ brief: event.target.value })}
                  placeholder="예: 받은 메일을 정리하고 답장 초안을 만들어요."
                />
              </label>

              {!locked ? <div className={styles.presetBlock} aria-label="성격 프리셋">
                <span className={styles.presetTitle}>성격 프리셋</span>
                <small className={styles.presetHint}>
                  뭘 적을지 모르겠으면 눌러서 고르세요. 아래 성향 칸에 문장으로 들어가요.
                </small>
                {personaPresetGroups.map((group) => (
                  <div key={group.group} className={styles.presetGroup}>
                    <span className={styles.presetGroupLabel}>{group.group}</span>
                    <div className={styles.presetChips}>
                      {group.options.map((option) => {
                        const active = instructionsText.includes(option.line);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            className={styles.presetChip}
                            data-active={active ? "true" : undefined}
                            aria-pressed={active}
                            onClick={() => togglePresetLine(option.line)}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div> : null}

              <label className={styles.field}>
                <span>{locked ? "전문 업무 지침 · 읽기 전용" : "성향·일하는 방식 (한 줄에 하나씩 · 직접 수정 가능)"}</span>
                <textarea
                  rows={6}
                  readOnly={locked}
                  value={instructionsText}
                  onChange={(event) => setInstructionsText(event.target.value)}
                  placeholder={"예: 급한 일부터 먼저 알려줘요.\n외부 발송은 승인 전에는 하지 않아요."}
                />
                <small>{locked ? "기본 지침은 대화와 학습으로도 변경되지 않습니다." : "최대 8줄까지 저장돼요. 이 크루의 말투와 판단 기준이 됩니다."}</small>
              </label>

              <div className={styles.presetBlock} aria-label="업무 스킬 켜고 끄기">
                <span className={styles.presetTitle}>업무 스킬</span>
                <small className={styles.presetHint}>
                  누르면 이 크루의 강점 표시와 일을 나눌 때의 기준이 바뀌어요. 메일·일상 조회 같은 실제 도구와 승인 범위는 역할에서 정해져요.
                </small>
                <div className={styles.presetChips}>
                  {defaultAISkillPacks.map((pack) => {
                    const active = draft.skillIds.includes(pack.id);
                    return (
                      <button
                        key={pack.id}
                        type="button"
                        className={styles.presetChip}
                        data-active={active ? "true" : undefined}
                        aria-pressed={active}
                        onClick={() => toggleSkill(pack.id)}
                      >
                        {pack.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          {tab === "settings" ? (
            <div className={styles.section}>
              <label className={styles.field}>
                <span>이름</span>
                <input
                  type="text"
                  maxLength={limits.name}
                  value={draft.name}
                  onChange={(event) => patch({ name: event.target.value })}
                  placeholder="예: 지민, 메일 담당자"
                />
              </label>
              <label className={styles.field}>
                <span>역할 이름</span>
                <input
                  type="text"
                  maxLength={limits.roleTitle}
                  readOnly={locked}
                  value={draft.roleTitle}
                  onChange={(event) => patch({ roleTitle: event.target.value })}
                  placeholder="예: 메일·일정 자동화"
                />
              </label>
              <label className={styles.field}>
                <span>팀 / 직업</span>
                <input
                  type="text"
                  maxLength={limits.teamLabel}
                  readOnly={locked}
                  value={draft.teamLabel}
                  onChange={(event) => patch({ teamLabel: event.target.value })}
                  placeholder="예: MailOps"
                />
              </label>
              <label className={styles.field}>
                <span>작업 공간 이름</span>
                <input
                  type="text"
                  maxLength={limits.channelName}
                  readOnly={locked}
                  value={draft.channelName}
                  onChange={(event) => patch({ channelName: event.target.value })}
                  placeholder="예: 메일 업무실"
                />
              </label>
            </div>
          ) : null}
        </div>

        {saveError ? <p className={styles.hint} role="alert">{saveError}</p> : null}
        <footer className={styles.footer}>
          {removable ? (
            <button type="button" className={styles.removeButton} onClick={() => onRemove?.(draft.id)}>
              자리 비우기
            </button>
          ) : (
            <span />
          )}
          <div className={styles.footerActions}>
            {!isNew && onDelegate ? (
              <button type="button" className={styles.ghostButton} onClick={() => onDelegate(draft)}>
                일 맡기러 가기
              </button>
            ) : null}
            <button type="button" className={styles.primaryButton} onClick={handleSave} disabled={savePending}>
              {savePending ? "저장 중" : isNew ? "채용 확정" : "저장"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
