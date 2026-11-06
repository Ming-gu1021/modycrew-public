"use client";

import { useEffect, useState } from "react";
import {
  createDesktopBridge,
  type JevMailClassificationLastRun,
  type JevMailClassificationMode,
  type JevMailClassificationStatus,
} from "@/lib/desktop-bridge";
import styles from "./AccountCard.module.css";

const modeOptions: Array<{
  value: JevMailClassificationMode;
  label: string;
  description: string;
}> = [
  {
    value: "off",
    label: "사용 안 함",
    description: "Jev에 실제 메일을 보내지 않습니다.",
  },
  {
    value: "shadow",
    label: "비교 기록",
    description: "기존 분류와 비교만 하고 받은편지함의 행동은 바꾸지 않습니다.",
  },
  {
    value: "assist",
    label: "분류 보조",
    description:
      "급한 메일을 승인함 위로 올리고 맡을 AI 직원을 제안합니다. 기존 분류와 판단이 다르면 확인 필요로 올리며, 승인과 원문은 그대로 유지합니다. 메일을 보내지는 않습니다.",
  },
];

function normalizeMode(value: unknown): JevMailClassificationMode {
  return value === "shadow" || value === "assist" || value === "off" ? value : "off";
}

function modeLabel(mode: JevMailClassificationMode): string {
  return modeOptions.find((option) => option.value === mode)?.label ?? modeOptions[0].label;
}

function count(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function recentRunLabel(lastRun?: JevMailClassificationLastRun | null): string {
  if (!lastRun) return "아직 없음";
  return `${count(lastRun.evaluated)}건 확인 · 차이 ${count(lastRun.disagreements)}건 · 보조 ${count(lastRun.applied)}건`;
}

function categoryLabel(value: unknown): string {
  if (value === "business_mail") return "업무";
  if (value === "ignored_noise") return "광고·안내";
  return "확인 필요";
}

function testResultLabel(result: JevMailClassificationStatus | null): string {
  if (!result) return "";
  if (result.status !== "evaluated") return result.userMessage || "합성 샘플 연결을 확인하지 못했습니다.";

  const category = categoryLabel(result.category?.choice);
  const confidence = Math.max(0, Math.min(100, Math.round(Number(result.category?.confidence ?? 0) * 100)));
  const needsReply = Math.max(0, Math.min(100, Math.round(Number(result.needsReply ?? 0) * 100)));
  return `합성 샘플 결과: ${category} · 신뢰도 ${confidence}% · 회신 필요 확률 ${needsReply}%`;
}

export function JevMailSettingsCard() {
  const [mode, setMode] = useState<JevMailClassificationMode>("off");
  const [allowContent, setAllowContent] = useState(false);
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<JevMailClassificationStatus | null>(null);
  const [testResult, setTestResult] = useState<JevMailClassificationStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"load" | "save" | "test" | "disconnect" | null>("load");
  const [isDesktop, setIsDesktop] = useState(false);

  const applyStatus = (next: JevMailClassificationStatus) => {
    setStatus((current) => ({
      ...current,
      ...next,
      mode: next.mode ?? current?.mode,
      hasKey: next.hasKey ?? current?.hasKey,
      allowContent: next.allowContent ?? current?.allowContent,
      model: next.model ?? current?.model,
      lastRun: next.lastRun === undefined ? current?.lastRun : next.lastRun,
    }));
    if (next.mode) setMode(normalizeMode(next.mode));
    if (typeof next.allowContent === "boolean") setAllowContent(next.allowContent);
  };

  const loadStatus = async () => {
    const bridge = createDesktopBridge();
    setIsDesktop(bridge.isAvailable);
    setBusy("load");
    try {
      const next = await bridge.getJevMailClassificationStatus();
      applyStatus(next);
      setMessage(next.userMessage ?? "");
    } catch {
      setMessage("Jev 메일 분류 설정을 확인하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    let mounted = true;
    const bridge = createDesktopBridge();
    setIsDesktop(bridge.isAvailable);

    void bridge
      .getJevMailClassificationStatus()
      .then((next) => {
        if (!mounted) return;
        applyStatus(next);
        setMessage(next.userMessage ?? "");
      })
      .catch(() => {
        if (mounted) setMessage("Jev 메일 분류 설정을 확인하지 못했습니다.");
      })
      .finally(() => {
        if (mounted) setBusy(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const storedKey = status?.hasKey === true;
  const storedConsent = status?.allowContent === true;
  const savedMode = normalizeMode(status?.mode);
  const canSaveAutomaticMode = mode === "off" || (allowContent && (storedKey || secret.trim().length > 0));
  const canSave = isDesktop && busy === null && canSaveAutomaticMode;
  const canTest = isDesktop && busy === null && storedKey && storedConsent;

  const handleSave = async () => {
    if (!canSave) return;
    const submittedSecret = secret;
    // 저장 요청이 끝나기 전에도 입력 칸에서는 바로 지운다.
    setSecret("");
    setBusy("save");
    setMessage("");
    setTestResult(null);

    try {
      const next = await createDesktopBridge().saveJevMailClassification({
        secret: submittedSecret,
        mode,
        allowContent,
      });
      applyStatus(next);
      setMessage(next.userMessage ?? "설정 저장 결과를 확인해 주세요.");
    } catch {
      setMessage("Jev 메일 분류 설정을 저장하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    if (!canTest) return;
    setBusy("test");
    setMessage("");
    try {
      const next = await createDesktopBridge().testJevMailClassification();
      setTestResult(next);
      setMessage(next.userMessage ?? "합성 샘플 연결 결과를 확인해 주세요.");
    } catch {
      setMessage("합성 샘플 연결을 확인하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async () => {
    if (!isDesktop || busy !== null) return;
    setSecret("");
    setBusy("disconnect");
    setMessage("");
    setTestResult(null);
    try {
      const next = await createDesktopBridge().disconnectJevMailClassification();
      applyStatus(next);
      setMessage(next.userMessage ?? "Jev 연결 해제 결과를 확인해 주세요.");
    } catch {
      setMessage("Jev 연결을 해제하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className={styles.card} aria-label="Jev 메일 분류 보조" data-jev-mail-settings="typesafe_local_settings">
      <div className={styles.head}>
        <h2>TypeSafe Jev 메일 분류 보조</h2>
        <p className={styles.subtle}>
          채팅 AI와 별도로, 이 PC에 연결한 메일의 분류·먼저 볼 순서·담당 제안만 보조합니다. 꺼 두어도 먼저 볼 순서와 담당
          제안은 기본 규칙으로 계속합니다.
        </p>
      </div>

      <p className={styles.warning}>
        분류 보조는 실험 기능입니다. 결과는 확정 정확도가 아니며, 중요한 업무는 기존 승인 흐름에서 확인합니다.
      </p>

      {!isDesktop ? (
        <p className={styles.warning}>설치된 Windows 앱에서 열어야 이 PC 보관함에 Jev 키와 동의를 저장할 수 있습니다.</p>
      ) : null}

      <div className={styles.form} role="radiogroup" aria-label="Jev 메일 분류 사용 방식">
        {modeOptions.map((option) => (
          <div key={option.value}>
            <label className={styles.checkOption}>
              <input
                type="radio"
                name="jev-mail-classification-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
                disabled={busy !== null}
              />
              <span>{option.label}</span>
            </label>
            <small>{option.description}</small>
          </div>
        ))}
      </div>

      <label className={styles.field}>
        <span>Jev API 키</span>
        <input
          aria-label="Jev API 키"
          name="jevMailSecret"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          disabled={busy !== null}
          placeholder={storedKey ? "새 키를 입력하면 교체합니다" : "이 PC에만 암호화해 저장"}
        />
        <small>입력한 키 원문은 상태 화면에 다시 표시하지 않습니다.</small>
      </label>

      <p className={styles.warning}>
        이 PC에 연결된 메일의 제목과 보안 선필터가 허용한 미리보기만 TypeSafe Jev에 전송될 수 있으며, 별도 API 비용이 발생할 수 있습니다.
      </p>
      <label className={styles.checkOption}>
        <input
          type="checkbox"
          checked={allowContent}
          onChange={(event) => setAllowContent(event.target.checked)}
          disabled={busy !== null}
        />
        <span>메일 전송 동의</span>
      </label>

      <p className={styles.subtle}>
        사용 안 함은 실제 메일 자동 판단을 멈춥니다. 키와 동의가 저장되어 있으면 아래 합성 샘플 연결 확인은 직접 실행할 수 있습니다.
      </p>

      <dl className={styles.meta} aria-label="Jev 메일 분류 현재 상태">
        <div>
          <dt>이 PC 키</dt>
          <dd>{storedKey ? "저장됨" : "저장 안 됨"}</dd>
        </div>
        <div>
          <dt>사용 방식</dt>
          <dd>{modeLabel(savedMode)}</dd>
        </div>
        <div className={styles.metaFull}>
          <dt>현재 PC 최근 한 계정 점검</dt>
          <dd>{recentRunLabel(status?.lastRun)}</dd>
        </div>
        <div className={styles.metaFull}>
          <dt>최근 점검 수치</dt>
          <dd>이 앱을 다시 열면 새로 시작하며, 여러 계정의 누적값이 아닙니다.</dd>
        </div>
      </dl>

      <div className={styles.aiHeroActions} aria-label="Jev 메일 분류 설정 작업">
        <button type="button" className={styles.primary} onClick={() => void handleSave()} disabled={!canSave}>
          {busy === "save" ? "저장 중..." : "이 PC에 저장"}
        </button>
        <button type="button" className={styles.secondary} onClick={() => void handleTest()} disabled={!canTest}>
          {busy === "test" ? "확인 중..." : "합성 샘플 연결 확인"}
        </button>
        <button type="button" className={styles.secondary} onClick={() => void handleDisconnect()} disabled={!isDesktop || busy !== null || !storedKey}>
          {busy === "disconnect" ? "해제 중..." : "Jev 연결 해제"}
        </button>
        <button type="button" className={styles.secondary} onClick={() => void loadStatus()} disabled={busy !== null}>
          {busy === "load" ? "상태 확인 중..." : "상태 새로고침"}
        </button>
      </div>

      {testResult ? (
        <p className={styles.status} role="status" aria-live="polite" data-jev-mail-test-status={testResult.status}>
          {testResultLabel(testResult)}
        </p>
      ) : null}
      {message ? (
        <p className={styles.status} role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </article>
  );
}
