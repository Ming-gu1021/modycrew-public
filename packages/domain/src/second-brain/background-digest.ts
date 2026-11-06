/**
 * 배경 정리 — "내가 없는 동안" 브리핑을 만들기 위한 판단 로직.
 *
 * 여기에는 IO 가 없다. 언제 돌릴지, 무엇이 달라졌는지, 실패하면 얼마나 물러설지만
 * 정한다. 실제 모델 호출과 파일 쓰기는 데스크톱 쪽이 한다.
 *
 * 설계 근거(docs/122-prime-agent-adoption-map.md):
 * - **집행 전 선점**: 돌리기로 정하는 순간 다음 시각을 `지금` 기준으로 민다.
 *   그래야 노트북이 사흘 꺼져 있어도 밀린 것이 한 번으로 합쳐진다.
 * - **변화 0이면 모델을 부르지 않는다**: prime-agent 의 심장박동은 매번 모델을 깨워
 *   전체를 다시 판단한다. 우리는 메일이라 그러면 안 된다 — 새 메일이 없으면
 *   호출 자체를 건너뛴다. 돈이 들고, 사용자는 그 돈을 우리에게 맡긴 적이 없다.
 * - **연속 실패에는 물러선다**: IMAP 이 죽어 있으면 5분마다 실패하는 모델 호출이
 *   영원히 돈다. 실패가 쌓일수록 간격을 늘리고, 한계를 넘기면 스스로 멈춘다.
 */

/** 배경 정리를 돌릴지 말지의 결론. 사유는 화면에 그대로 보여줄 수 있는 문장이다. */
export type ModyBackgroundDigestDecision =
  | { run: true; reason: "new_material"; koreanReason: string; claimedAt: string; nextEligibleAt: string }
  | {
      run: false;
      reason:
        | "disabled"
        | "no_change"
        | "too_soon"
        | "daily_cap_reached"
        | "backing_off"
        | "paused_after_failures";
      koreanReason: string;
      nextEligibleAt: string;
    };

export type ModyBackgroundDigestSettings = {
  /** 기본은 꺼짐. 배경에서 AI 를 쓰는 것은 사용자가 켜야 시작한다. */
  enabled: boolean;
  /** 하루에 몇 번까지. 0 이면 돌지 않는다. */
  maxRunsPerDay: number;
  /** 두 번 사이 최소 간격(분). */
  minIntervalMinutes: number;
  /** 연속 실패가 이 수를 넘으면 스스로 멈추고 사용자에게 알린다. */
  pauseAfterConsecutiveFailures: number;
};

export const modyBackgroundDigestDefaults: ModyBackgroundDigestSettings = {
  enabled: false,
  maxRunsPerDay: 6,
  minIntervalMinutes: 30,
  pauseAfterConsecutiveFailures: 4,
};

export type ModyBackgroundDigestState = {
  /** 마지막으로 **돌린** 시각(성공·실패 무관). */
  lastRunAt: string;
  /** 이 시각 전에는 돌리지 않는다. 선점과 물러섬이 모두 이 값을 민다. */
  nextEligibleAt: string;
  /** 하루 한도를 세는 날짜 열쇠(현지 기준 YYYY-MM-DD). */
  dayKey: string;
  runsOnDayKey: number;
  consecutiveFailures: number;
  /** 마지막으로 정리한 재료의 지문. 이게 같으면 볼 것이 없다는 뜻이다. */
  lastMaterialFingerprint: string;
};

export const modyBackgroundDigestInitialState: ModyBackgroundDigestState = {
  lastRunAt: "",
  nextEligibleAt: "",
  dayKey: "",
  runsOnDayKey: 0,
  consecutiveFailures: 0,
  lastMaterialFingerprint: "",
};

/**
 * 정리할 재료. 개수와 지문만 다룬다 — 본문은 여기까지 오지 않는다
 * (도메인은 사용자 메일 본문을 알 필요가 없다).
 */
export type ModyBackgroundDigestMaterial = {
  /** 지난 정리 이후 새로 들어온 업무 카드 수. */
  newWorkItemCount: number;
  /** 사용자의 결정을 기다리는 항목 수. */
  pendingApprovalCount: number;
  /** 새로 학습된 자료 수. */
  newLearnedDocumentCount: number;
  /**
   * 위 재료를 식별하는 지문. 같은 지문이면 같은 재료라는 뜻이므로 다시 정리하지 않는다.
   * 개수만으로는 부족하다 — 하나가 들어오고 하나가 나가면 개수는 그대로다.
   */
  fingerprint: string;
};

export type ModyBackgroundDigestOutcome = "done" | "failed";

function toDayKey(nowIso: string): string {
  return nowIso.slice(0, 10);
}

function addMinutes(nowIso: string, minutes: number): string {
  return new Date(new Date(nowIso).getTime() + minutes * 60_000).toISOString();
}

function hasMaterial(material: ModyBackgroundDigestMaterial): boolean {
  return (
    material.newWorkItemCount > 0 ||
    material.pendingApprovalCount > 0 ||
    material.newLearnedDocumentCount > 0
  );
}

/**
 * 지금 배경 정리를 돌려도 되는가.
 *
 * `run: true` 를 받은 쪽은 **반드시** 돌려받은 `nextEligibleAt` 을 먼저 저장한 다음
 * 실제 작업을 시작해야 한다. 그래야 도중에 앱이 죽어도 같은 일이 두 번 돌지 않는다.
 */
export function decideBackgroundDigest(input: {
  settings: ModyBackgroundDigestSettings;
  state: ModyBackgroundDigestState;
  material: ModyBackgroundDigestMaterial;
  nowIso: string;
}): ModyBackgroundDigestDecision {
  const { settings, state, material, nowIso } = input;
  const dayKey = toDayKey(nowIso);
  const runsToday = state.dayKey === dayKey ? state.runsOnDayKey : 0;

  if (!settings.enabled || settings.maxRunsPerDay <= 0) {
    return {
      run: false,
      reason: "disabled",
      koreanReason: "배경 정리가 꺼져 있습니다.",
      nextEligibleAt: "",
    };
  }

  if (state.consecutiveFailures >= settings.pauseAfterConsecutiveFailures) {
    return {
      run: false,
      reason: "paused_after_failures",
      koreanReason: `연속으로 ${state.consecutiveFailures}번 실패해서 잠시 멈췄습니다. 연결을 확인한 뒤 다시 켜 주세요.`,
      nextEligibleAt: "",
    };
  }

  if (runsToday >= settings.maxRunsPerDay) {
    return {
      run: false,
      reason: "daily_cap_reached",
      koreanReason: `오늘은 ${settings.maxRunsPerDay}번까지만 정리하도록 되어 있습니다.`,
      nextEligibleAt: state.nextEligibleAt,
    };
  }

  if (state.nextEligibleAt && nowIso < state.nextEligibleAt) {
    return {
      run: false,
      reason: state.consecutiveFailures > 0 ? "backing_off" : "too_soon",
      koreanReason:
        state.consecutiveFailures > 0
          ? "직전 실패 때문에 조금 쉬었다가 다시 확인합니다."
          : "방금 확인했습니다. 잠시 뒤에 다시 봅니다.",
      nextEligibleAt: state.nextEligibleAt,
    };
  }

  // 재료가 없거나, 지난번과 똑같으면 모델을 부르지 않는다. 이 한 줄이
  // "새 메일도 없는데 요금만 나갔다"를 막는다.
  if (!hasMaterial(material) || material.fingerprint === state.lastMaterialFingerprint) {
    return {
      run: false,
      reason: "no_change",
      koreanReason: "새로 정리할 것이 없습니다.",
      nextEligibleAt: addMinutes(nowIso, settings.minIntervalMinutes),
    };
  }

  return {
    run: true,
    reason: "new_material",
    koreanReason: "새로 들어온 것을 정리합니다.",
    claimedAt: nowIso,
    // 집행 **전에** 다음 시각을 지금 기준으로 민다.
    nextEligibleAt: addMinutes(nowIso, settings.minIntervalMinutes),
  };
}

/**
 * 돌리기로 정한 직후 상태. 실제 작업을 시작하기 **전에** 저장한다.
 * 여기서 저장하지 않고 시작하면, 도중에 죽었을 때 같은 재료로 다시 돈다.
 */
export function claimBackgroundDigest(
  state: ModyBackgroundDigestState,
  decision: Extract<ModyBackgroundDigestDecision, { run: true }>,
): ModyBackgroundDigestState {
  const dayKey = toDayKey(decision.claimedAt);
  return {
    ...state,
    lastRunAt: decision.claimedAt,
    nextEligibleAt: decision.nextEligibleAt,
    dayKey,
    runsOnDayKey: (state.dayKey === dayKey ? state.runsOnDayKey : 0) + 1,
  };
}

/**
 * 작업이 끝난 뒤 상태.
 *
 * 성공하면 실패 카운터를 지우고 재료 지문을 기록한다(같은 재료를 다시 정리하지 않도록).
 * 실패하면 카운터를 올리고 간격을 두 배씩 늘린다 — 다만 지문은 **건드리지 않는다**.
 * 실패했는데 지문을 기록하면 그 재료는 영영 정리되지 않는다.
 */
export function recordBackgroundDigestOutcome(input: {
  state: ModyBackgroundDigestState;
  settings: ModyBackgroundDigestSettings;
  outcome: ModyBackgroundDigestOutcome;
  material: ModyBackgroundDigestMaterial;
  nowIso: string;
}): ModyBackgroundDigestState {
  const { state, settings, outcome, material, nowIso } = input;
  if (outcome === "done") {
    return {
      ...state,
      consecutiveFailures: 0,
      lastMaterialFingerprint: material.fingerprint,
    };
  }
  const consecutiveFailures = state.consecutiveFailures + 1;
  const backoffMinutes = settings.minIntervalMinutes * 2 ** Math.min(consecutiveFailures, 5);
  return {
    ...state,
    consecutiveFailures,
    nextEligibleAt: addMinutes(nowIso, backoffMinutes),
  };
}
