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
