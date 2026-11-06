"use client";

import { getCrewCharacter } from "@/lib/crew-character-catalog";
import { crewFaceCrop } from "@/lib/crew-character-faces";
import styles from "./CrewChatAvatar.module.css";

/**
 * 대화 말풍선 옆 작은 원형 캐릭터 아이콘. 크루 사무실과 같은 캐릭터를 얼굴 위주로 잘라 보여 준다.
 * 캐릭터를 모르면 예전 모디 표시(✦)를 쓴다. 장식이므로 화면 읽기에서는 숨기고, 이름은 마우스를 올리면 보인다.
 */
export default function CrewChatAvatar({ avatarId, name, working = false, className }: { avatarId?: string | null; name?: string; working?: boolean; className?: string }) {
  const character = getCrewCharacter(avatarId);
  const crop = character ? crewFaceCrop(character.id) : undefined;
  const src = character?.asset.idle.src;
  return (
    <span
      className={[styles.avatar, className].filter(Boolean).join(" ")}
      data-crew-chat-avatar={character && crop && src ? character.id : "brand"}
      data-working={working ? "true" : "false"}
      title={name || undefined}
      aria-hidden="true"
    >
      {character && crop && src
        ? <img src={src} alt="" draggable={false} decoding="async" style={{ width: `${crop.width}%`, left: `${crop.left}%`, top: `${crop.top}%` }} />
        : <span className={styles.mark}>✦</span>}
    </span>
  );
}
