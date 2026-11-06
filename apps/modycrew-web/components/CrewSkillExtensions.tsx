"use client";

/**
 * 크루 스킬 확장 — 플러그인 화면 안의 확장 센터.
 *
 * - 기본 화면: 내 확인 필요(멈춘 크루 작업)와 추가할 수 있는 선택형 확장만 보인다.
 * - 상세(펼치기): 기본 탑재 스킬의 상태·버전·검증 수준·출처, 참고자료·보류 목록, 실행이 이어지는 범위.
 * - 상태·권한·무결성 판정은 모두 데스크톱 실행기가 공통 카탈로그로 계산한 값이다. 화면은 따로 판정하지 않는다.
 * - 데스크톱 연결이 없는 미리보기에서는 추가 버튼을 보이지 않는다(없는 기능을 연결된 것처럼 보이지 않게).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  crewSkills, crewSkillsBridge, crewSkillWorkspaceRoot,
  type CrewExtensionReferenceView, type CrewSkillAttentionItem, type CrewSkillPackageView, type CrewSkillsResult,
} from "@/lib/crew-skills";
import styles from "./CrewSkillExtensions.module.css";

const lifecycleTone: Record<string, string> = {
  verified: "safe", in_progress: "info", installable: "info", needs_connection: "warn", error: "danger", reference: "muted",
};

function clip(value: string | undefined, max: number): string {
  const text = String(value ?? "").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function CrewSkillExtensions({ query = "" }: { query?: string }) {
  const [available, setAvailable] = useState(false);
  const [data, setData] = useState<CrewSkillsResult | null>(null);
  const [attention, setAttention] = useState<CrewSkillAttentionItem[]>([]);
  const [root, setRoot] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    const result = await crewSkills({ kind: "packages" });
    if (result.status !== "packages") { setLoadError(result.userMessage); return; }
    setLoadError("");
    setData(result);
    const workspaceRoot = await crewSkillWorkspaceRoot();
    setRoot(workspaceRoot);
    if (!workspaceRoot) return;
    const found = await crewSkills({ kind: "attention", workspaceRoot });
    setAttention(found.status === "attention" ? found.items ?? [] : []);
  }, []);

  useEffect(() => {
    if (!crewSkillsBridge()) return;
    setAvailable(true);
    void load().catch(() => setLoadError("크루 스킬 확장 상태를 읽지 못했습니다."));
  }, [load]);

  const act = useCallback(async (kind: "install" | "rollback" | "remove", name: string, label: string) => {
    if (kind === "remove" && !window.confirm(label + " 확장을 뺄까요? 실행 기록과 결과 파일은 그대로 둡니다.")) return;
    setBusy(name + ":" + kind);
    try {
      const result = await crewSkills({ kind, name, ...(kind === "remove" ? { confirmed: true } : {}) });
      setMessage(result.userMessage + (result.missing?.length ? " 필요한 것: " + result.missing.join(", ") : ""));
      await load();
    } catch {
      setMessage("요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setBusy("");
    }
  }, [load]);

  const openItem = useCallback(async (item: CrewSkillAttentionItem, kind: "open" | "resave") => {
    if (!item.runId) return;
    const scope = { workspaceRoot: root, ...(item.threadId ? { threadId: item.threadId } : { teammateId: item.teammateId ?? "" }) };
    const result = await crewSkills({ kind, runId: item.runId, ...scope });
    setMessage(result.userMessage);
    if (kind === "resave") await load();
  }, [load, root]);

  const normalized = query.trim().toLocaleLowerCase();
  const matches = useCallback((...texts: Array<string | undefined>) => !normalized || texts.some((text) => (text ?? "").toLocaleLowerCase().includes(normalized)), [normalized]);
  const skills = useMemo(() => (data?.skills ?? []).filter((skill) => matches(skill.label, skill.description, skill.categoryLabel, skill.name)), [data, matches]);
  const optional = skills.filter((skill) => skill.availability === "optional");
  const core = skills.filter((skill) => skill.availability === "core");
  const references = useMemo(() => (data?.references ?? []).filter((item) => matches(item.label, item.note, item.license)), [data, matches]);
  const referenceGroups = useMemo(() => {
    const groups = new Map<string, CrewExtensionReferenceView[]>();
    for (const item of references) groups.set(item.state, [...(groups.get(item.state) ?? []), item]);
    return [...groups.entries()];
  }, [references]);

  if (!available) return null;
  if (normalized && !skills.length && !references.length && !attention.length) return null;

  const renderSkill = (skill: CrewSkillPackageView, withActions: boolean) => {
    const pkg = skill.package;
    const installed = Boolean(pkg?.installed);
    // 실행 도구: 로그인 실행기(둘 중 하나) · 이 PC에 설치돼 있어야 하는 외부 도구 · MCP 연결을 나눠 실제 연결 상태와 함께 보여 준다.
    const cliIds = skill.requires.cli ?? [];
    const runtimeNames = skill.runtimeTools.filter((tool) => !cliIds.includes(tool));
    const toolLine = [
      runtimeNames.join(" 또는 "),
      ...cliIds.map((id) => id + (skill.cliReady?.[id] ? " 연결됨" : " 설치·연결 필요" + (id === "agent-desktop" ? "(공식 설치: npm install -g agent-desktop)" : ""))),
      ...(skill.requires.mcpServers ?? []).map((id) => id + (skill.mcpReady[id] ? " 연결됨" : " 연결 필요")),
    ].filter(Boolean).join(" · ");
    const platformNames: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };
    const platformLine = skill.platforms.map((platform) => platformNames[platform] ?? platform).join("·");
    return (
      <article key={skill.name} className={styles.card} data-lifecycle={skill.lifecycle}>
        <div className={styles.cardHead}>
          <b className={styles.cardTitle}>{skill.label}</b>
          <span className={styles.badge} data-tone={lifecycleTone[skill.lifecycle] ?? "muted"}>{skill.lifecycleLabel}</span>
        </div>
        <p className={styles.meta}>{skill.categoryLabel} · v{installed && pkg?.activeVersion ? pkg.activeVersion : skill.version} · {skill.executionLabel} · 담당 {skill.owners || "기본 비서"}</p>
        <p className={styles.summary}>{clip(skill.description, 180)}</p>
        <dl className={styles.facts}>
          <dt>권한</dt><dd>{skill.permissionLabels.length ? skill.permissionLabels.join(", ") : "추가 권한 없음"}</dd>
          <dt>실행 도구</dt><dd>{toolLine || "추가 도구 없음"}</dd>
          <dt>지원 환경</dt><dd>{platformLine}{skill.platforms.length < 3 ? " 전용(다른 운영체제는 미검증)" : ""}</dd>
          <dt>입력 → 결과</dt><dd>{skill.io.inputs.join(", ")} → {skill.io.outputs.join(", ")}</dd>
          <dt>검증</dt><dd>{skill.verification.checkedAt} · {skill.verification.note}</dd>
          <dt>출처</dt><dd>{skill.sources.map((source) => source.label + " (" + source.license + (source.reviewedVersion ? ", " + source.reviewedVersion : "") + ")").join(" / ")}</dd>
          {pkg?.integrityProblem ? (<><dt>문제</dt><dd className={styles.problem}>{pkg.integrityProblem}</dd></>) : null}
        </dl>
        {withActions ? (
          <div className={styles.actions}>
            {!installed || pkg?.updateAvailable ? (
              <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => void act("install", skill.name, skill.label)}>
                {busy === skill.name + ":install" ? "확인 중…" : pkg?.updateAvailable ? "업데이트" + (pkg.addedPermissions.length ? " (권한 늘어남)" : "") : "추가"}
              </button>
            ) : null}
            {pkg?.previousVersion ? (
              <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void act("rollback", skill.name, skill.label)}>{pkg.previousVersion}으로 되돌리기</button>
            ) : null}
            {installed ? (
              <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void act("remove", skill.name, skill.label)}>빼기</button>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  };

  return (
    <section className={styles.section} aria-label="크루 스킬 확장">
      <h2 className={styles.title}>크루 스킬 확장</h2>
      <p className={styles.hint}>필요할 때 추가하는 크루 스킬이에요. 필요한 연결과 권한을 먼저 확인하고, 앱에 들어 있는 원본을 무결성 확인 뒤 설치합니다.</p>
      {loadError ? <p className={styles.problem} role="alert">{loadError}</p> : null}

      {attention.length ? (
        <div className={styles.attention} role="region" aria-label="내 확인 필요">
          <h3 className={styles.subTitle}>내 확인 필요 <span className={styles.count}>{attention.length}</span></h3>
          <ul className={styles.attentionList}>
            {attention.map((item) => (
              <li key={item.id} className={styles.attentionItem} data-reason={item.reason}>
                <span className={styles.badge} data-tone={item.reason === "failure" ? "danger" : "warn"}>{item.statusLabel}</span>
                <div className={styles.attentionBody}>
                  <b>{item.title}</b>
                  <span>{item.label} · {item.nextAction}</span>
                  {item.detail ? <span className={styles.detail}>{clip(item.detail, 160)}</span> : null}
                </div>
                {item.reason === "design_review" ? <button type="button" className={styles.secondary} onClick={() => void openItem(item, "open")}>계획 열기</button> : null}
                {item.reason === "save_retry" ? <button type="button" className={styles.secondary} onClick={() => void openItem(item, "resave")}>저장 다시 시도</button> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {optional.length ? <div className={styles.grid}>{optional.map((skill) => renderSkill(skill, true))}</div> : null}

      <button type="button" className={styles.toggle} aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
        {detailsOpen ? "기본 크루 스킬·참고자료 접기" : "기본 크루 스킬 " + core.length + "개 · 참고자료 " + references.length + "개 보기"}
      </button>

      {detailsOpen ? (
        <div className={styles.details}>
          <h3 className={styles.subTitle}>기본 탑재 크루 스킬</h3>
          <div className={styles.grid}>{core.map((skill) => renderSkill(skill, false))}</div>
          <h3 className={styles.subTitle}>참고자료·후보·보류</h3>
          {referenceGroups.map(([state, items]) => (
            <div key={state} className={styles.referenceGroup}>
              <h4 className={styles.groupTitle}>{data?.referenceStateLabels?.[state] ?? state} · {items.length}</h4>
              <ul className={styles.referenceList}>
                {items.map((item) => (
                  <li key={item.id}>
                    <b>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.label}</a> : item.label}</b>
                    <span className={styles.detail}>{item.license} · {item.reviewedVersion}{item.reflectedIn.length ? " · 반영: " + item.reflectedIn.join(", ") : ""}</span>
                    <span>{item.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {data?.persistence ? (
            <>
              <h3 className={styles.subTitle}>작업이 이어지는 범위</h3>
              <ul className={styles.referenceList}>
                {Object.entries(data.persistence).map(([key, value]) => (
                  <li key={key}><b>{value.label}{value.guaranteed ? "" : " (측정 전)"}</b><span>{value.note}</span></li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {message ? <p className={styles.notice} role="status">{message}</p> : null}
    </section>
  );
}
