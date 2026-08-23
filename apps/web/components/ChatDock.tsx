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
import { onOpenChatDock, onOpenChatDockList } from "../lib/chatDock";

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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
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
    if (view !== "thread" || !activeId) return;
    function refresh() {
      getMessages(activeId!).then(setMessages).catch(() => {});
    }
    refresh();
    const interval = setInterval(refresh, THREAD_POLL_MS);
    return () => clearInterval(interval);
  }, [view, activeId]);

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

  // Nav.tsx's bottom tab bar Messenger icon (mobile) — no specific
  // conversation, just open the list the way the corner launcher does.
  useEffect(() => {
    return onOpenChatDockList(() => setView("list"));
  }, []);

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
            <button className="chat-dock-close" onClick={() => setView("collapsed")} aria-label="Close">
              ×
            </button>
          </div>
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
                    onClick={() => {
                      setActiveId(c.id);
                      setActiveOtherName(name);
                      setMessages("loading");
                      setView("thread");
                    }}
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
              className="chat-dock-close"
              onClick={() => setView("collapsed")}
              aria-label="Close"
              style={{ marginLeft: "auto" }}
            >
              ×
            </button>
          </div>
          <div className="chat-dock-body chat-dock-thread">
            {messages === "loading" ? (
              <p className="text-dim">Loading…</p>
            ) : (
              messages.map((m) => {
                const isMine = m.senderActorId === me.actor.id;
                return (
                  <div key={m.id} className={`chat-bubble ${isMine ? "chat-bubble-mine" : "chat-bubble-theirs"}`}>
                    {m.body}
                    <div className="text-faint" style={{ fontSize: "0.7rem", marginTop: "0.2rem" }}>
                      {timeAgo(m.createdAt)}
                    </div>
                  </div>
                );
              })
            )}
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
