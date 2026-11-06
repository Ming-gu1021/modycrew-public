export type CrewCharacterGender = "male" | "female";
export type CrewCharacterRoleAffinity = "mail" | "doc" | "approval" | "file";
export type CrewCharacterActivity = "idle" | "working";
export type CrewCharacterAssetKind = "standalone" | "diptych";

export type CrewCharacterCrop = {
  /** Source-image coordinates, normalized from 0 to 1. */
  frameTop: 0 | 0.5;
  frameHeight: 0.5 | 1;
  /** CSS multiplier for an image rendered inside a fixed portrait viewport. */
  imageHeightMultiplier: 1 | 2;
  /** Moves a diptych's lower pose into the portrait viewport. */
  translateY: "0%" | "-50%";
  objectPosition: "center bottom";
};

export type CrewCharacterPoseAsset = {
  src: string;
  crop: CrewCharacterCrop;
};

export type CrewCharacterAsset =
  | {
      kind: "standalone";
      idle: CrewCharacterPoseAsset;
      working: CrewCharacterPoseAsset;
    }
  | {
      kind: "diptych";
      source: string;
      idle: CrewCharacterPoseAsset;
      working: CrewCharacterPoseAsset;
    };

export const crewCharacterIds = [
  "crew-mail",
  "crew-doc",
  "crew-file",
  "crew-approval",
  "crew-man-03",
  "crew-man-04",
  "crew-man-05",
  "crew-man-06",
  "crew-man-07",
  "crew-man-08",
  "crew-man-09",
  "crew-man-10",
  "crew-woman-03",
  "crew-woman-04",
  "crew-woman-05",
  "crew-woman-06",
  "crew-woman-07",
  "crew-woman-08",
  "crew-woman-09",
  "crew-woman-10",
] as const;

export type CrewCharacterId = (typeof crewCharacterIds)[number];

export type CrewCharacter = {
  id: CrewCharacterId;
  label: string;
  gender: CrewCharacterGender;
  roleAffinity: CrewCharacterRoleAffinity;
  asset: CrewCharacterAsset;
};

export const crewCharacterRoleAffinityLabels: Record<CrewCharacterRoleAffinity, string> = {
  mail: "메일·일정",
  doc: "문서·자료",
  approval: "검토·승인",
  file: "파일·정리",
};

const fullPortraitCrop: CrewCharacterCrop = {
  frameTop: 0,
  frameHeight: 1,
  imageHeightMultiplier: 1,
  translateY: "0%",
  objectPosition: "center bottom",
};


function standaloneAsset(idleSrc: string, workingSrc: string): CrewCharacterAsset {
  return {
    kind: "standalone",
    idle: { src: idleSrc, crop: fullPortraitCrop },
    working: { src: workingSrc, crop: fullPortraitCrop },
  };
}


/**
 * A single source of truth for the selectable crew roster.
 * Every character uses separate idle/working assets so each pose stays fully visible
 * in compact windows and carries a real alpha channel for light/dark themes.
 */
export const CREW_CHARACTERS = [
  {
    id: "crew-mail",
    label: "하린",
    gender: "female",
    roleAffinity: "mail",
    asset: standaloneAsset("/office-crew/crew-mail-v2.webp", "/office-crew/crew-mail-working-v2.webp"),
  },
  {
    id: "crew-doc",
    label: "도윤",
    gender: "male",
    roleAffinity: "doc",
    asset: standaloneAsset("/office-crew/crew-doc-v2.webp", "/office-crew/crew-doc-working-v2.webp"),
  },
  {
    id: "crew-file",
    label: "서연",
    gender: "female",
    roleAffinity: "file",
    asset: standaloneAsset("/office-crew/crew-file-v2.webp", "/office-crew/crew-file-working-v2.webp"),
  },
  {
    id: "crew-approval",
    label: "민준",
    gender: "male",
    roleAffinity: "approval",
    asset: standaloneAsset("/office-crew/crew-approval-v2.webp", "/office-crew/crew-approval-working-v2.webp"),
  },
  {
    id: "crew-man-03",
    label: "현우",
    gender: "male",
    roleAffinity: "mail",
    asset: standaloneAsset(
      "/office-crew/crew-man-03-idle-portrait-v6.webp",
      "/office-crew/crew-man-03-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-man-04",
    label: "지훈",
    gender: "male",
    roleAffinity: "doc",
    asset: standaloneAsset(
      "/office-crew/crew-man-04-idle-portrait-v6.webp",
      "/office-crew/crew-man-04-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-man-05",
    label: "준서",
    gender: "male",
    roleAffinity: "approval",
    asset: standaloneAsset(
      "/office-crew/crew-man-05-idle-portrait-v6.webp",
      "/office-crew/crew-man-05-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-man-06",
    label: "시우",
    gender: "male",
    roleAffinity: "file",
    asset: standaloneAsset(
      "/office-crew/crew-man-06-idle-portrait-v6.webp",
      "/office-crew/crew-man-06-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-man-07",
    label: "태오",
    gender: "male",
    roleAffinity: "mail",
    asset: standaloneAsset(
      "/office-crew/crew-man-07-idle-portrait-v6.webp",
      "/office-crew/crew-man-07-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-man-08",
    label: "건우",
    gender: "male",
    roleAffinity: "doc",
    asset: standaloneAsset(
      "/office-crew/crew-man-08-idle-portrait-v6.webp",
      "/office-crew/crew-man-08-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-man-09",
    label: "이든",
    gender: "male",
    roleAffinity: "approval",
    asset: standaloneAsset(
      "/office-crew/crew-man-09-idle-portrait-v6.webp",
      "/office-crew/crew-man-09-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-man-10",
    label: "우진",
    gender: "male",
    roleAffinity: "file",
    asset: standaloneAsset(
      "/office-crew/crew-man-10-idle-portrait-v6.webp",
      "/office-crew/crew-man-10-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-woman-03",
    label: "지아",
    gender: "female",
    roleAffinity: "doc",
    asset: standaloneAsset(
      "/office-crew/crew-woman-03-idle-portrait-v6.webp",
      "/office-crew/crew-woman-03-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-woman-04",
    label: "예린",
    gender: "female",
    roleAffinity: "file",
    asset: standaloneAsset(
      "/office-crew/crew-woman-04-idle-portrait-v6.webp",
      "/office-crew/crew-woman-04-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-woman-05",
    label: "다은",
    gender: "female",
    roleAffinity: "mail",
    asset: standaloneAsset(
      "/office-crew/crew-woman-05-idle-portrait-v6.webp",
      "/office-crew/crew-woman-05-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-woman-06",
    label: "수아",
    gender: "female",
    roleAffinity: "approval",
    asset: standaloneAsset(
      "/office-crew/crew-woman-06-idle-portrait-v6.webp",
      "/office-crew/crew-woman-06-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-woman-07",
    label: "유나",
    gender: "female",
    roleAffinity: "doc",
    asset: standaloneAsset(
      "/office-crew/crew-woman-07-idle-portrait-v6.webp",
      "/office-crew/crew-woman-07-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-woman-08",
    label: "채원",
    gender: "female",
    roleAffinity: "file",
    asset: standaloneAsset(
      "/office-crew/crew-woman-08-idle-portrait-v6.webp",
      "/office-crew/crew-woman-08-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-woman-09",
    label: "나린",
    gender: "female",
    roleAffinity: "mail",
    asset: standaloneAsset(
      "/office-crew/crew-woman-09-idle-portrait-v6.webp",
      "/office-crew/crew-woman-09-working-portrait-v6.webp",
    ),
  },
  {
    id: "crew-woman-10",
    label: "민서",
    gender: "female",
    roleAffinity: "approval",
    asset: standaloneAsset(
      "/office-crew/crew-woman-10-idle-portrait-v6.webp",
      "/office-crew/crew-woman-10-working-portrait-v6.webp",
    ),
  },
] as const satisfies readonly CrewCharacter[];

export function isCrewCharacterId(value: unknown): value is CrewCharacterId {
  return typeof value === "string" && (crewCharacterIds as readonly string[]).includes(value);
}

export function getCrewCharacter(value: unknown): CrewCharacter | undefined {
  if (!isCrewCharacterId(value)) return undefined;
  return CREW_CHARACTERS.find((character) => character.id === value);
}

export function resolveCrewCharacterAsset(
  characterOrId: CrewCharacter | CrewCharacterId | string | null | undefined,
  activity: CrewCharacterActivity = "idle",
): CrewCharacterPoseAsset | undefined {
  const character = typeof characterOrId === "object" && characterOrId ? characterOrId : getCrewCharacter(characterOrId);
  return character?.asset[activity];
}

export function getCrewCharacterRoleAffinity(roleHint: string | null | undefined): CrewCharacterRoleAffinity | undefined {
  const value = String(roleHint ?? "").trim().toLocaleLowerCase();
  if (!value) return undefined;
  if (/승인|검토|계약|법무|정산|비용|세무|approval|legal|finance/u.test(value)) return "approval";
  if (/파일|폴더|바탕화면|다운로드|desktop|file|folder|download/u.test(value)) return "file";
  if (/메일|이메일|일정|캘린더|답장|inbox|mail|calendar/u.test(value)) return "mail";
  if (/문서|자료|보고서|요약|운영|콘텐츠|홍보|doc|document|report|operations|marketing/u.test(value)) return "doc";
  return undefined;
}

export function getDefaultCrewCharacterIdForRole(role: string): CrewCharacterId {
  const affinity = getCrewCharacterRoleAffinity(role);
  if (affinity === "mail") return "crew-mail";
  if (affinity === "file") return "crew-file";
  if (affinity === "approval") return "crew-approval";
  return "crew-doc";
}
