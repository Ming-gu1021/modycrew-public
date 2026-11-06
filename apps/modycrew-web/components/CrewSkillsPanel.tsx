"use client";

import { useEffect, useState } from "react";
import { crewSkillsForRole, describeCrewSkillExecution } from "../../../packages/domain/dist/crew-skills.js";
import { crewSkills, crewSkillsBridge, type CrewSkillRuntimeStatus } from "@/lib/crew-skills";
import { crewSkillRoleIdForTeammate } from "@/lib/crew-skill-roles";
import styles from "./CrewSkillsPanel.module.css";

/** 직원 정보 화면: 이 직원이 요청에 맞춰 자동으로 꺼내 쓰는 크루 스킬과 실제 실행기 연결 상태. */
export function CrewSkillsPanel({ teammate }: { teammate: { id: string; builtinExpertId?: string } }) {
  const skills = crewSkillsForRole(crewSkillRoleIdForTeammate(teammate));
  const [runtimes, setRuntimes] = useState<CrewSkillRuntimeStatus[] | null>(null);
  useEffect(() => {
    if (!crewSkillsBridge()) return undefined;
    let alive = true;
    void crewSkills({ kind: "status" })
      .then((result) => { if (alive) setRuntimes(result.runtimes ?? []); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!skills.length) return null;
  return (
    <section className={styles.panel} aria-label="이 직원이 꺼내 쓰는 크루 스킬">
      <h3 className={styles.title}>꺼내 쓰는 크루 스킬</h3>
      <p className={styles.hint}>요청 내용에 맞으면 채팅에서 자동으로 골라 씁니다.</p>
      <ul className={styles.list}>
        {skills.map((skill) => (
          <li key={skill.name} className={styles.item}>
            <strong>{skill.label}</strong>
            <span className={styles.mode}>{describeCrewSkillExecution(skill.execution)}{skill.availability === "optional" ? " · 선택형 확장(플러그인에서 추가)" : ""}</span>
            <p>{skill.description.split(". ")[0]}</p>
          </li>
        ))}
      </ul>
      {runtimes ? (
        <p className={styles.runtimes} role="status">
          실제 실행: {runtimes.length ? runtimes.map((runtime) => runtime.label + (runtime.loggedIn ? " 연결됨" : " 로그인 필요")).join(" · ") : "연결된 실행기 없음"}
        </p>
      ) : null}
    </section>
  );
}

