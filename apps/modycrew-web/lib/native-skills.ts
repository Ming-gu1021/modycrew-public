export type NativeSkill = { id: string; name: string; description: string; source: string; mode: "instructions" | "requires_tools"; requirements: string[]; modifiedAt: string; compatibility?: string };
export type NativeSkillRun = { id: string; name: string; status: string; outputText?: string; outputPath?: string; startedAt: string; userMessage?: string };
export type NativeSkillsResult = { status: string; userMessage: string; skills?: NativeSkill[]; records?: NativeSkillRun[]; run?: NativeSkillRun; warnings?: string[]; outputText?: string };
export type NativeSkillScope = { workspaceRoot: string; threadId: string };
export async function nativeSkills(payload: Record<string, unknown>): Promise<NativeSkillsResult> {
  const native = (window as unknown as { modyCrewDesktopBridge?: { nativeSkills?: (payload: Record<string, unknown>) => Promise<NativeSkillsResult> } }).modyCrewDesktopBridge;
  if (!native?.nativeSkills) return { status: "unavailable", userMessage: "스킬 호출은 최신 모디크루 설치 앱에서 사용할 수 있습니다." };
  return native.nativeSkills(payload);
}
export function parseNativeSkillCommand(value: string) {
  const match = value.trim().match(/^\/스킬\s+(?:"([^"]+)"|(\S+))\s+([\s\S]+)$/);
  return match ? { skillId: match[1] || match[2], request: match[3].trim() } : null;
}
