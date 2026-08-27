// Client-only preference (no server column exists for it — see
// lib/theme.ts's dark/light toggle and lib/mediaPrefs.ts's sensitive-
// media setting for the same localStorage-only precedent) controlling
// which edge of the screen the expanded chat dock (ChatDock.tsx) docks
// to. Unlike those two, ChatDock is a single global instance mounted
// once in the root layout and never remounted by navigation, so a
// plain get/set pair wouldn't reach it once it's already open — the
// change event below lets it react immediately instead of only on the
// next full page load.
export type ChatDockSide = "left" | "right";

const CHAT_DOCK_SIDE_KEY = "gibrr-chat-dock-side";
const CHANGE_EVENT = "gibrr:chat-dock-side-changed";

export function getChatDockSide(): ChatDockSide {
  if (typeof localStorage === "undefined") return "right";
  return localStorage.getItem(CHAT_DOCK_SIDE_KEY) === "left" ? "left" : "right";
}

export function setChatDockSide(value: ChatDockSide) {
  localStorage.setItem(CHAT_DOCK_SIDE_KEY, value);
  window.dispatchEvent(new CustomEvent<ChatDockSide>(CHANGE_EVENT, { detail: value }));
}

export function onChatDockSideChange(handler: (side: ChatDockSide) => void): () => void {
  function listener(e: Event) {
    handler((e as CustomEvent<ChatDockSide>).detail);
  }
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
