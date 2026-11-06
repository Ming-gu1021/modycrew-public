import { getDefaultCrewCharacterIdForRole, type CrewCharacterId, type CrewCharacterRoleAffinity } from "./crew-character-catalog";

type RoomCharacter = { atlas: string; column: number; offsetX: number };
const sprite = (group: string, column: number, offsetX = 0): RoomCharacter => ({ atlas: `/office-room/crew-atlas-${group}-v2.png`, column, offsetX });

// Match the selected portrait's wardrobe and identity, independently of the assigned job.
export const officeRoomCharacters = {
  // The core atlas has slightly uneven gutters. Keep neighbouring desks out of each frame.
  "crew-mail": sprite("core", 0, 22), "crew-doc": sprite("core", 1, 22),
  "crew-file": sprite("core", 2, 18), "crew-approval": sprite("core", 3),
  "crew-man-03": sprite("men-a", 0), "crew-man-04": sprite("men-a", 1),
  "crew-man-05": sprite("men-a", 2), "crew-man-06": sprite("men-a", 3),
  "crew-man-07": sprite("men-b", 0), "crew-man-08": sprite("men-b", 1),
  "crew-man-09": sprite("men-b", 2), "crew-man-10": sprite("men-b", 3),
  "crew-woman-03": sprite("women-a", 0), "crew-woman-04": sprite("women-a", 1),
  "crew-woman-05": sprite("women-a", 2), "crew-woman-06": sprite("women-a", 3),
  "crew-woman-07": sprite("women-b", 0), "crew-woman-08": sprite("women-b", 1),
  "crew-woman-09": sprite("women-b", 2), "crew-woman-10": sprite("women-b", 3),
} satisfies Record<CrewCharacterId, RoomCharacter>;

export function getOfficeRoomCharacter(avatarId: string | undefined, role: CrewCharacterRoleAffinity): RoomCharacter {
  const id = avatarId && Object.hasOwn(officeRoomCharacters, avatarId) ? avatarId as CrewCharacterId : getDefaultCrewCharacterIdForRole(role);
  return officeRoomCharacters[id];
}
