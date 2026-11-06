/**
 * 대화 말풍선 옆 캐릭터 아이콘: 각 답변을 어느 크루가 했는지 정한다.
 *
 * - 메시지에 말한 크루(speakerTeammateId)가 적혀 있으면 그 크루.
 * - 업무 비서가 전문가에게 넘긴 표식('이 일은 현우에게 맡겨…')은 비서가 한 말이고, 그 뒤 사용자가 다시 말하기 전까지의 답변은 그 전문가가 한 말이다.
 * - 설치 앱이 다른 크루에게 배치해 받은 답변(agentRoutingReceipt)은 배치된 크루가 한 말이다.
 * - 나머지는 대화의 주인(비서 대화면 비서, 크루 채널이면 그 크루)이 한 말이다.
 * 표시용 판단일 뿐 실행 권한과 무관하다.
 */
export type ChatSpeakerTeammate = { id: string; name: string };
export type ChatSpeakerMessage = {
  id: string;
  role: "assistant" | "user";
  speakerTeammateId?: string;
  agentRoutingReceipt?: { targetCrewName?: string } | null;
};

export const expertHandoffMessagePrefix = "assistant-expert-handoff-";

export function resolveChatMessageSpeakers<T extends ChatSpeakerTeammate>(
  messages: readonly ChatSpeakerMessage[],
  owner: T | undefined,
  teammates: readonly T[],
): Map<string, T> {
  const byId = new Map(teammates.map((teammate) => [teammate.id, teammate] as const));
  const byName = (name: unknown) => {
    const clean = String(name ?? "").trim();
    return clean ? teammates.find((teammate) => teammate.name === clean) : undefined;
  };
  const speakers = new Map<string, T>();
  let expert: T | undefined;
  for (const message of messages) {
    if (message.role === "user") { expert = undefined; continue; }
    const explicit = message.speakerTeammateId ? byId.get(message.speakerTeammateId) : undefined;
    if (explicit) { speakers.set(message.id, explicit); continue; }
    const routed = byName(message.agentRoutingReceipt?.targetCrewName);
    if (message.id.startsWith(expertHandoffMessagePrefix)) {
      if (owner) speakers.set(message.id, owner);
      expert = routed;
      continue;
    }
    const speaker = routed ?? expert ?? owner;
    if (speaker) speakers.set(message.id, speaker);
  }
  return speakers;
}

/** 지금 일하는 크루: 마지막 사용자 말 뒤에 비서가 전문가에게 넘겼으면 그 전문가, 아니면 대화의 주인. 진행 표시 옆 아이콘에 쓴다. */
export function resolveCurrentChatSpeaker<T extends ChatSpeakerTeammate>(
  messages: readonly ChatSpeakerMessage[],
  owner: T | undefined,
  teammates: readonly T[],
): T | undefined {
  let current: T | undefined;
  for (const message of messages) {
    if (message.role === "user") { current = undefined; continue; }
    if (message.id.startsWith(expertHandoffMessagePrefix)) {
      const name = String(message.agentRoutingReceipt?.targetCrewName ?? "").trim();
      current = name ? teammates.find((teammate) => teammate.name === name) : undefined;
    }
  }
  return current ?? owner;
}
