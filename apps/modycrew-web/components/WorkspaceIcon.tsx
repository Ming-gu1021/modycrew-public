import type { CSSProperties } from "react";

const paths = {
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M18 6 6 18",
  folder: "M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6M8 13h8M8 17h5",
  code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16",
  edit: "m16 3 5 5M4 16 16 4a2 2 0 0 1 4 4L8 20l-5 1Z",
  pin: "m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v6",
  chevron: "m9 5 7 7-7 7",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  external: "M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5",
  play: "m8 4 12 8-12 8Z",
  check: "m4 12 5 5L20 6",
} as const;

export default function WorkspaceIcon({ name, size = 18, className, style }: { name: keyof typeof paths; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className} style={style}><path d={paths[name]} /></svg>;
}
