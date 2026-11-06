export type BackgroundPreferences = { openAtLogin: boolean; keepAwake: boolean; taskNotifications: boolean | null };
export type BackgroundStatus = {
  status: string;
  state?: "starting" | "ready" | "attention" | "sleeping" | "stopped";
  checkedAt?: string;
  startedAt?: string;
  lastResumedAt?: string;
  keepAwakeActive?: boolean;
  canOpenAtLogin?: boolean;
  preferences?: BackgroundPreferences;
  workers?: { id: string; label: string; state: string; checkedAt: string; lastSuccessAt: string }[];
  summary?: { running: number; queued: number; retrying: number; waiting: number; approvals: number; paused: number; completedToday: number; enabledRules: number; connections: number; connectionErrors: number; nextRunAt: string };
  userMessage?: string;
};

export async function readBackgroundService(patch?: Partial<BackgroundPreferences>): Promise<BackgroundStatus> {
  const host = window as unknown as { modyCrewDesktopBridge?: { backgroundService?: (payload: object) => Promise<BackgroundStatus> } };
  const invoke = host.modyCrewDesktopBridge?.backgroundService;
  if (typeof invoke !== "function") return { status: "desktop_required" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke(patch ? { kind: "configure", ...patch } : { kind: "status" }),
      new Promise<BackgroundStatus>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 8000); }),
    ]);
  } finally { clearTimeout(timer); }
}
