   
                                                  
                                                                      
                                             
  
                                                                           
   
import type { CrewCharacterId } from "./crew-character-catalog";

export type CrewFaceCrop = { width: number; left: number; top: number };

export const crewFaceCrops: Readonly<Record<CrewCharacterId, CrewFaceCrop>> = Object.freeze({
  "crew-mail": { width: 140.3, left: -19.7, top: 0.6 },
  "crew-doc": { width: 177.7, left: -34.8, top: 0.3 },
  "crew-file": { width: 148.7, left: -23.2, top: 0.3 },
  "crew-approval": { width: 164.8, left: -30, top: 0.3 },
  "crew-man-03": { width: 307.2, left: -103.6, top: -7.6 },
  "crew-man-04": { width: 307.2, left: -106.4, top: -7.6 },
  "crew-man-05": { width: 307.2, left: -100.4, top: -8.4 },
  "crew-man-06": { width: 307.2, left: -102, top: -8 },
  "crew-man-07": { width: 307.2, left: -94.4, top: -7.6 },
  "crew-man-08": { width: 307.2, left: -102.8, top: -8.4 },
  "crew-man-09": { width: 307.2, left: -100.8, top: -8 },
  "crew-man-10": { width: 307.2, left: -104, top: -9.2 },
  "crew-woman-03": { width: 307.2, left: -98.4, top: -7.6 },
  "crew-woman-04": { width: 307.2, left: -101.2, top: -7.6 },
  "crew-woman-05": { width: 307.2, left: -106.8, top: -7.6 },
  "crew-woman-06": { width: 307.2, left: -103.2, top: -7.6 },
  "crew-woman-07": { width: 307.2, left: -104.4, top: -7.6 },
  "crew-woman-08": { width: 307.2, left: -104, top: -7.6 },
  "crew-woman-09": { width: 307.2, left: -105.2, top: -7.6 },
  "crew-woman-10": { width: 307.2, left: -106.8, top: -8.4 },
});

export function crewFaceCrop(id: string | null | undefined): CrewFaceCrop | undefined {
  return id && Object.prototype.hasOwnProperty.call(crewFaceCrops, id) ? crewFaceCrops[id as CrewCharacterId] : undefined;
}
