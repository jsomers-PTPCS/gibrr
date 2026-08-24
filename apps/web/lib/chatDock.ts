// The chat dock (components/ChatDock.tsx) is mounted once, globally, in
// the root layout — but things like a profile page's "Message" button
// need to command it open to a specific conversation from anywhere in the
// tree. A plain window event is simpler than threading a React context
// through the (server-component) root layout for a single call site.
export interface OpenChatDetail {
  conversationId: string;
  otherActor: { username: string; displayName: string | null };
}

const OPEN_EVENT = "gibrr:open-chat";

export function openChatDock(detail: OpenChatDetail) {
  window.dispatchEvent(new CustomEvent<OpenChatDetail>(OPEN_EVENT, { detail }));
}

export function onOpenChatDock(handler: (detail: OpenChatDetail) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<OpenChatDetail>).detail);
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}

// Same idea, but for the bottom tab bar's Messenger icon
// (BottomTabBar.tsx) — tapping it opens the list, tapping it again
// closes the dock back up, the same as tapping a nav tab you're already
// on elsewhere in the app.
const TOGGLE_LIST_EVENT = "gibrr:toggle-chat-list";

export function toggleChatDockList() {
  window.dispatchEvent(new Event(TOGGLE_LIST_EVENT));
}

export function onToggleChatDockList(handler: () => void): () => void {
  window.addEventListener(TOGGLE_LIST_EVENT, handler);
  return () => window.removeEventListener(TOGGLE_LIST_EVENT, handler);
}

// A "Share via Whisper" action (e.g. the Loops share menu) needs to open
// the dock to its conversation list with the shared link ready to send —
// but which conversation isn't known yet, so this can't just reuse
// openChatDock above (that's for a conversation already picked). The
// dock stashes `text` and drops it into the draft the moment a thread is
// actually opened, whether that's an existing conversation or one just
// started via the "Whisper to user or user@domain" box.
const SHARE_EVENT = "gibrr:share-to-chat";

export function shareToChatDock(text: string) {
  window.dispatchEvent(new CustomEvent<string>(SHARE_EVENT, { detail: text }));
}

export function onShareToChatDock(handler: (text: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener(SHARE_EVENT, listener);
  return () => window.removeEventListener(SHARE_EVENT, listener);
}
