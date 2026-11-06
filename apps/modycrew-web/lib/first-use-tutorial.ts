// A device preference only. Keep the key stable across app updates and sign-outs.
export const FIRST_USE_TUTORIAL_KEY = "modycrew-first-use-tutorial";
export const FIRST_USE_TUTORIAL_EVENT = "modycrew:open-first-use-tutorial";

export function recordTutorialVisit(outcome: "opened" | "skipped" | "completed"): boolean {
  try {
    const value = JSON.stringify({ outcome, recordedAt: new Date().toISOString() });
    window.localStorage.setItem(FIRST_USE_TUTORIAL_KEY, value);
    return window.localStorage.getItem(FIRST_USE_TUTORIAL_KEY) === value;
  } catch { return false; }
}

export function reserveFirstTutorial(): boolean {
  try {
    // Unknown/older records also mean visited: do not reset a user's dismissal.
    if (window.localStorage.getItem(FIRST_USE_TUTORIAL_KEY) !== null) return false;
    // Record before showing, so closing the app mid-guide does not replay it.
    // If persistence is unavailable, use the manual entry rather than nagging.
    return recordTutorialVisit("opened");
  } catch { return false; }
}

export function openFirstUseTutorial(): void {
  window.dispatchEvent(new Event(FIRST_USE_TUTORIAL_EVENT));
}
