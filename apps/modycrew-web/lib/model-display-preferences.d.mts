export const MODEL_DISPLAY_KEY: string;
export const MODEL_DISPLAY_EVENT: string;
export function modelDisplayId(choice: { provider: string; id: string }): string;
export function readHiddenModels(storage: Pick<Storage, "getItem">): string[];
export function saveHiddenModels(storage: Pick<Storage, "setItem">, hidden: string[]): void;
export function visibleModels<T extends { provider: string; id: string; ready: boolean }>(choices: T[], hidden: string[]): T[];
