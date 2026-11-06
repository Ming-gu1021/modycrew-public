import { type CSSProperties } from "react";

import {
  type CrewCharacterId,
  type CrewCharacterPoseAsset,
  getCrewCharacter,
  getDefaultCrewCharacterIdForRole,
  resolveCrewCharacterAsset,
} from "@/lib/crew-character-catalog";
import styles from "./CrewAvatar.module.css";

export type CrewAvatarRole = "mail" | "doc" | "approval" | "file";
export type CrewAvatarSize = "scene" | "compact" | "card";
export type CrewAvatarActivity = "idle" | "working" | "moving" | "waiting";

export interface CrewAvatarProps {
  role: CrewAvatarRole;
  size?: CrewAvatarSize;
  activity?: CrewAvatarActivity;
  avatarId?: CrewCharacterId | string | null;
  figure?: string;
  decorative?: boolean;
  label?: string;
  className?: string;
}

const roleLabels: Record<CrewAvatarRole, string> = {
  mail: "메일 담당 직원",
  doc: "문서 담당 직원",
  approval: "승인 담당 직원",
  file: "자료 담당 직원",
};

const activityLabels: Record<CrewAvatarActivity, string> = {
  idle: "대기",
  working: "업무 중",
  moving: "정리 중",
  waiting: "확인 대기",
};

const roleAssets: Record<CrewAvatarRole, string> = {
  mail: "/office-crew/crew-mail-v2.webp",
  doc: "/office-crew/crew-doc-v2.webp",
  file: "/office-crew/crew-file-v2.webp",
  approval: "/office-crew/crew-approval-v2.webp",
};

const roleWorkingAssets: Record<CrewAvatarRole, string> = {
  mail: "/office-crew/crew-mail-working-v2.webp",
  doc: "/office-crew/crew-doc-working-v2.webp",
  file: "/office-crew/crew-file-working-v2.webp",
  approval: "/office-crew/crew-approval-working-v2.webp",
};

function portraitStyle(asset: CrewCharacterPoseAsset | undefined): CSSProperties | undefined {
  if (!asset) return undefined;
  return {
    "--crew-avatar-image-height": `${asset.crop.imageHeightMultiplier * 100}%`,
    "--crew-avatar-image-translate-y": asset.crop.translateY,
    objectPosition: asset.crop.objectPosition,
  } as CSSProperties;
}

export default function CrewAvatar({
  role,
  size = "scene",
  activity = "idle",
  avatarId,
  figure,
  decorative = true,
  label,
  className,
}: CrewAvatarProps) {
  const overrideMark = figure?.trim();
  const character = getCrewCharacter(avatarId) ?? getCrewCharacter(getDefaultCrewCharacterIdForRole(role));
  const accessibleLabel = label || (character ? `${character.label} · ${roleLabels[role]}` : roleLabels[role]);
  const classes = [styles.avatar, className].filter(Boolean).join(" ");
  const idleAsset = resolveCrewCharacterAsset(character, "idle");
  const workingAsset = resolveCrewCharacterAsset(character, "working");
  const asset = idleAsset?.src ?? roleAssets[role];
  const workingAssetSrc = workingAsset?.src ?? roleWorkingAssets[role];
  const assetKind = character?.asset.kind ?? "standalone";

  return (
    <span
      className={classes}
      data-role={role}
      data-size={size}
      data-activity={activity}
      data-crew-asset="editorial-2_5d-v2"
      data-crew-asset-kind={assetKind}
      data-crew-avatar-id={character?.id ?? ""}
      data-crew-asset-src={asset}
      data-crew-working-src={workingAssetSrc}
      data-crew-fit="contained_bottom_anchored"
      data-crew-crop={assetKind === "diptych" ? "diptych_vertical_crop" : "standalone"}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : `${accessibleLabel} · ${activityLabels[activity]}`}
    >
      <span className={styles.portraitFrame} data-crew-portrait-frame="true" aria-hidden="true">
        <img
          className={`${styles.portrait} ${styles.portraitIdle}`}
          data-crew-portrait="true"
          data-crew-layer="idle"
          data-crew-asset-kind={assetKind}
          src={asset}
          style={portraitStyle(idleAsset)}
          alt=""
          draggable={false}
          decoding="async"
        />
        <img
          className={`${styles.portrait} ${styles.portraitWorking}`}
          data-crew-portrait="true"
          data-crew-layer="working"
          data-crew-asset-kind={assetKind}
          src={workingAssetSrc}
          style={portraitStyle(workingAsset)}
          alt=""
          draggable={false}
          decoding="async"
        />
        <span className={styles.workCue} data-crew-work-cue={role}>
          <i />
          <i />
          <i />
        </span>
      </span>
      {overrideMark ? (
        <span className={styles.overrideMark} aria-hidden="true">
          {overrideMark}
        </span>
      ) : null}
    </span>
  );
}
