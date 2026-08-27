"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  getMe,
  getConversations,
  getMessages,
  sendMessage,
  startConversation,
  ApiError,
  type Me,
  type ChatMessage,
  type ConversationSummary,
} from "../lib/api";
import { Avatar } from "./Avatar";
import { MessageIcon } from "./MessageIcon";
import { timeAgo } from "../lib/timeAgo";
import { onOpenChatDock, onToggleChatDockList, onShareToChatDock } from "../lib/chatDock";
import { getChatDockSide, onChatDockSideChange, type ChatDockSide } from "../lib/chatDockPrefs";

const LIST_POLL_MS = 10000;
const THREAD_POLL_MS = 3000;

type View = "collapsed" | "list" | "thread";

// A persistent Messenger-style dock, mounted once in the root layout —
// replaces the old /messages and /messages/[id] full pages entirely.
// Conversations and an open thread both live in a small fixed panel in
// the corner instead of navigating away from whatever the user was doing.
export function ChatDock() {
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<View>("collapsed");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeOtherName, setActiveOtherName] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | "loading">("loading");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [newHandle, setNewHandle] = useState("");
  const [startingConversation, setStartingConversation] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Set by shareToChatDock (lib/chatDock.ts) while waiting for the user
  // to pick/start a conversation to share into — dropped into `draft`
  // the moment one opens, then cleared so it doesn't leak into the next
  // unrelated thread.
  const [pendingShare, setPendingShare] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // The full-height, two-column right-or-left sidebar (Settings' "Chat
  // position") — an alternative top-level layout to the small floating
  // panel above, not a third `View` state, since it shows the
  // conversation list and an open thread at once rather than switching
  // between them.
  const [expanded, setExpanded] = useState(false);
  const [chatDockSide, setChatDockSide] = useState<ChatDockSide>("right");

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    setChatDockSide(getChatDockSide());
    return onChatDockSideChange(setChatDockSide);
  }, []);

  // The conversation list drives the unread badge, so it's polled
  // whenever a user is logged in — not just while the dock is open.
  useEffect(() => {
    if (!me) return;
    function refresh() {
      getConversations().then(setConversations).catch(() => {});
    }
    refresh();
    const interval = setInterval(refresh, LIST_POLL_MS);
    return () => clearInterval(interval);
  }, [me]);

  useEffect(() => {
    if ((view !== "thread" && !expanded) || !activeId) return;
    function refresh() {
      getMessages(activeId!).then(setMessages).catch(() => {});
    }
    refresh();
    const interval = setInterval(refresh, THREAD_POLL_MS);
    return () => clearInterval(interval);
  }, [view, expanded, activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    return onOpenChatDock(({ conversationId, otherActor }) => {
      setActiveId(conversationId);
      setActiveOtherName(otherActor.displayName ?? otherActor.username);
      setMessages("loading");
      setView("thread");
    });
  }, []);

  // BottomTabBar.tsx's Messenger icon (mobile) — opens the list on the
  // first tap, closes the whole dock (from list or an open thread) on a
  // second tap, same as tapping a nav tab you're already on.
  useEffect(() => {
    return onToggleChatDockList(() => {
      setView((v) => (v === "collapsed" ? "list" : "collapsed"));
    });
  }, []);

  useEffect(() => {
    return onShareToChatDock((text) => {
      setPendingShare(text);
      setView("list");
    });
  }, []);

  // Shared by the popup list's rows and the expanded layout's contacts
  // column — the only difference between them is that the popup also
  // switches `view` to show the thread in place of the list, which is
  // meaningless while `expanded` already shows both at once.
  function selectConversation(c: ConversationSummary) {
    const name = c.otherActor?.displayName ?? c.otherActor?.username ?? "Unknown";
    setActiveId(c.id);
    setActiveOtherName(name);
    setMessages("loading");
    if (!expanded) setView("thread");
    if (pendingShare) {
      setDraft(pendingShare);
      setPendingShare(null);
    }
  }

  function handleExpand() {
    if (!activeId && conversations.length > 0) selectConversation(conversations[0]);
    setExpanded(true);
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !activeId) return;
    setSending(true);
    try {
      await sendMessage(activeId, draft);
      setDraft("");
      setMessages(await getMessages(activeId));
      getConversations().then(setConversations).catch(() => {});
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) window.location.href = "/login";
    } finally {
      setSending(false);
    }
  }

  async function handleStartConversation(e: FormEvent) {
    e.preventDefault();
    if (!newHandle.trim()) return;
    setStartingConversation(true);
    setStartError(null);
    try {
      const conversation = await startConversation(newHandle.trim());
      setNewHandle("");
      setActiveId(conversation.id);
      setActiveOtherName(conversation.otherActor.displayName ?? conversation.otherActor.username);
      setMessages("loading");
      setView("thread");
      if (pendingShare) {
        setDraft(pendingShare);
        setPendingShare(null);
      }
      getConversations().then(setConversations).catch(() => {});
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      setStartError("couldn't find that user");
    } finally {
      setStartingConversation(false);
    }
  }

  if (!me) return null;

  const unreadTotal = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  // Shared by the popup panel's thread view and the expanded layout's
  // thread column — identical bubble markup either way.
  function renderMessageBubbles() {
    if (messages === "loading") return <p className="text-dim">Loading…</p>;
    return messages.map((m) => {
      const isMine = m.senderActorId === me!.actor.id;
      return (
        <div key={m.id} className={`chat-bubble ${isMine ? "chat-bubble-mine" : "chat-bubble-theirs"}`}>
          {m.body}
          <div className="text-faint" style={{ fontSize: "0.7rem", marginTop: "0.2rem" }}>
            {timeAgo(m.createdAt)}
          </div>
        </div>
      );
    });
  }

  if (expanded) {
    const contactsColumn = (
      <div className="chat-dock-expanded-contacts">
        <div className="chat-dock-header" style={{ justifyContent: "center" }}>
          <button
            className="chat-dock-close"
            onClick={() => {
              setExpanded(false);
              setView("collapsed");
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="chat-dock-body" style={{ padding: "0.5rem 0" }}>
          {conversations.map((c) => {
            const name = c.otherActor?.displayName ?? c.otherActor?.username ?? "Unknown";
            return (
              <button
                key={c.id}
                className={`chat-dock-conversation chat-dock-expanded-contact${
                  activeId === c.id ? " chat-dock-expanded-contact-active" : ""
                }`}
                onClick={() => selectConversation(c)}
                title={name}
              >
                <Avatar name={name} size={36} />
                {c.unreadCount > 0 && (
                  <span className="chat-dock-badge">{c.unreadCount > 9 ? "9+" : c.unreadCount}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );

    const threadColumn = (
      <div className="chat-dock-expanded-thread">
        <div className="chat-dock-header">
          {activeOtherName ? (
            <>
              <Avatar name={activeOtherName} size={24} />
              <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeOtherName}
              </strong>
            </>
          ) : (
            <strong>Whispers</strong>
          )}
          <button
            className="chat-dock-back"
            onClick={() => {
              setExpanded(false);
              setView(activeId ? "thread" : "list");
            }}
            aria-label="Collapse"
            title="Collapse"
            style={{ marginLeft: "auto" }}
          >
            ⤡
          </button>
        </div>
        <div className="chat-dock-body chat-dock-thread">
          {activeId ? (
            renderMessageBubbles()
          ) : (
            <p className="text-dim">Pick someone from the list to see your whispers.</p>
          )}
          <div ref={bottomRef} />
        </div>
        {activeId && (
          <form onSubmit={handleSend} className="chat-dock-footer">
            <input
              className="input"
              style={{ flex: 1, minWidth: 0 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a whisper…"
            />
            <button
              type="submit"
              className="btn btn-accent"
              disabled={sending}
              style={{ padding: "0.5rem 0.75rem", flexShrink: 0 }}
            >
              Send
            </button>
          </form>
        )}
      </div>
    );

    return (
      <div className={`chat-dock-expanded chat-dock-expanded-${chatDockSide}`}>
        {chatDockSide === "right" ? (
          <>
            {threadColumn}
            {contactsColumn}
          </>
        ) : (
          <>
            {contactsColumn}
            {threadColumn}
          </>
        )}
      </div>
    );
  }

  if (view === "collapsed") {
    return (
      <button
        className="chat-dock-launcher"
        onClick={() => setView("list")}
        aria-label={unreadTotal > 0 ? `Messages, ${unreadTotal} unread` : "Messages"}
      >
        <MessageIcon size={22} />
        {unreadTotal > 0 && <span className="chat-dock-badge">{unreadTotal > 9 ? "9+" : unreadTotal}</span>}
      </button>
    );
  }

  return (
    <div className="chat-dock-panel">
      {view === "list" ? (
        <>
          <div className="chat-dock-header">
            <strong>Whispers</strong>
            <button
              className="chat-dock-back"
              onClick={handleExpand}
              aria-label="Expand"
              title="Expand"
              style={{ marginLeft: "auto" }}
            >
              ⤢
            </button>
            <button
              className="chat-dock-close"
              onClick={() => {
                setView("collapsed");
                setPendingShare(null);
              }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          {pendingShare && (
            <p className="text-faint" style={{ margin: "0 0.25rem 0.5rem", fontSize: "0.85rem" }}>
              Pick or start a conversation to share that link into.
            </p>
          )}
          <form
            onSubmit={handleStartConversation}
            style={{ display: "flex", gap: "0.4rem", padding: "0 0.25rem 0.5rem" }}
          >
            <input
              className="input"
              style={{ flex: 1, minWidth: 0, fontSize: "0.85rem" }}
              value={newHandle}
              onChange={(e) => setNewHandle(e.target.value)}
              placeholder="Whisper to user or user@domain"
            />
            <button
              type="submit"
              className="btn btn-ghost"
              disabled={startingConversation}
              style={{ padding: "0.3rem 0.6rem", fontSize: "0.85rem", flexShrink: 0 }}
            >
              {startingConversation ? "…" : "Go"}
            </button>
          </form>
          {startError && (
            <p className="error-text" style={{ padding: "0 0.25rem", margin: "0 0 0.5rem" }}>
              {startError}
            </p>
          )}
          <div className="chat-dock-body">
            {conversations.length === 0 ? (
              <p className="text-dim" style={{ padding: "0 0.25rem" }}>
                No whispers yet. Visit someone&apos;s profile and click Whisper, or whisper a handle above.
              </p>
            ) : (
              conversations.map((c) => {
                const name = c.otherActor?.displayName ?? c.otherActor?.username ?? "Unknown";
                const isMine = c.lastMessage?.senderActorId === me.actor.id;
                return (
                  <button
                    key={c.id}
                    className="conversation-row chat-dock-conversation"
                    onClick={() => selectConversation(c)}
                  >
                    <Avatar name={name} size={40} />
                    <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                        <strong>{name}</strong>
                        {c.lastMessage && (
                          <span className="text-faint">{timeAgo(c.lastMessage.createdAt)}</span>
                        )}
                      </div>
                      <p
                        className="text-faint"
                        style={{
                          margin: "0.15rem 0 0",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontWeight: c.unreadCount > 0 ? 700 : 400,
                          color: c.unreadCount > 0 ? "var(--text)" : undefined,
                        }}
                      >
                        {c.lastMessage ? `${isMine ? "You: " : ""}${c.lastMessage.body}` : "No whispers yet"}
                      </p>
                    </div>
                    {c.unreadCount > 0 && <span className="pill">{c.unreadCount}</span>}
                  </button>
                );
              })
            )}
          </div>
        </>
      ) : (
        <>
          <div className="chat-dock-header">
            <button className="chat-dock-back" onClick={() => setView("list")} aria-label="Back to whispers">
              ←
            </button>
            {activeOtherName && (
              <>
                <Avatar name={activeOtherName} size={24} />
                <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {activeOtherName}
                </strong>
              </>
            )}
            <button
              className="chat-dock-back"
              onClick={handleExpand}
              aria-label="Expand"
              title="Expand"
              style={{ marginLeft: "auto" }}
            >
              ⤢
            </button>
            <button className="chat-dock-close" onClick={() => setView("collapsed")} aria-label="Close">
              ×
            </button>
          </div>
          <div className="chat-dock-body chat-dock-thread">
            {renderMessageBubbles()}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={handleSend} className="chat-dock-footer">
            <input
              className="input"
              style={{ flex: 1, minWidth: 0 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a whisper…"
            />
            <button
              type="submit"
              className="btn btn-accent"
              disabled={sending}
              style={{ padding: "0.5rem 0.75rem", flexShrink: 0 }}
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}
