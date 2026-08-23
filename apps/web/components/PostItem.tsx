"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  votePost,
  boostPost,
  unboostPost,
  saveEventToCalendar,
  removeEventFromCalendar,
  bookmarkPost,
  unbookmarkPost,
  adminDeletePost,
  updatePost,
  deletePost,
  uploadPostMedia,
  getMe,
  setReaction,
  removeReaction,
  getCustomEmoji,
  votePoll,
  ApiError,
  API_URL,
  type Post,
  type VoteValue,
  type ReactionSummary,
  type CustomEmoji,
  type Poll,
} from "../lib/api";

// A small, fixed picker set — not exhaustive, just the common ones.
// Custom emoji (fetched lazily when the picker opens) round it out.
const COMMON_EMOJI = [
  "👍", "❤️", "😂", "😮", "😢", "😡", "🎉", "🔥",
  "👏", "🙏", "😍", "🤔", "😭", "💯", "👀", "🚀",
  "✨", "😅", "🥳", "😴", "🤯", "👌", "🙌", "💀",
];
import { VoteButtons } from "./VoteButtons";
import { Avatar } from "./Avatar";
import { GroupTagPreview } from "./GroupTagPreview";
import { PostComments } from "./PostComments";
import { LinkifiedText } from "./LinkifiedText";
import { ReportButton } from "./ReportButton";
import { useConfirm } from "./ConfirmDialog";
import { BoostIcon, BookmarkIcon, CommentIcon, EditIcon, TrashIcon, FlagIcon } from "./icons";
import { timeAgoLong } from "../lib/timeAgo";

// A remote actor's avatar/header is already an absolute URL (federated
// via icon/image on their Actor object) — only a local upload's relative
// /uploads/... path needs our own API origin prefixed.
function assetUrl(path: string) {
  return /^https?:\/\//.test(path) ? path : `${API_URL}${path}`;
}

// Detail = true on the post detail page (title isn't a link to itself,
// comments are always expanded rather than toggled). boxStyle overrides
// the card background/text color — used on profile pages where the owner
// has set a custom "content box" color (readableTextColor already baked
// in by the caller, so this component doesn't need to know about theme).
export function PostItem({
  post,
  detail = false,
  boxStyle,
}: {
  post: Post;
  detail?: boolean;
  boxStyle?: CSSProperties;
}) {
  const confirm = useConfirm();
  const [{ score, myVote }, setVote] = useState({ score: post.score, myVote: post.myVote });
  const [reactions, setReactions] = useState<ReactionSummary[]>(post.reactions);
  const [myReaction, setMyReaction] = useState(post.myReaction);
  const [reacting, setReacting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customEmoji, setCustomEmoji] = useState<CustomEmoji[] | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [poll, setPoll] = useState<Poll | null>(post.poll);
  const [voting, setVoting] = useState(false);
  const [pendingOptionIds, setPendingOptionIds] = useState<string[]>(post.poll?.myOptionIds ?? []);
  const [boosted, setBoosted] = useState(post.boosted);
  const [boosting, setBoosting] = useState(false);
  const [savedToCalendar, setSavedToCalendar] = useState(post.savedToCalendar);
  const [savingToCalendar, setSavingToCalendar] = useState(false);
  const [bookmarked, setBookmarked] = useState(post.bookmarked);
  const [bookmarking, setBookmarking] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  // The editable content fields, held separately from the rest of `post`
  // so a successful edit can update what's on screen without needing the
  // parent (feed/home page) to re-fetch — same reason score/boosted/
  // savedToCalendar are their own state above.
  const [content, setContent] = useState({
    title: post.title,
    url: post.url,
    body: post.body,
    location: post.location,
    imageUrl: post.imageUrl,
    videoUrl: post.videoUrl,
    audioUrl: post.audioUrl,
    updatedAt: post.updatedAt,
    contentWarning: post.contentWarning,
  });
  // Body/media stay hidden behind the CW until clicked — starts closed
  // whenever a CW is set, on every render of this post (not "sticky open"
  // once revealed within a session), matching how every fediverse client
  // treats content warnings.
  const [cwRevealed, setCwRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editContentWarning, setEditContentWarning] = useState("");
  const [editShowContentWarning, setEditShowContentWarning] = useState(false);
  const [editMediaFile, setEditMediaFile] = useState<File | null>(null);
  const [editRemoveMedia, setEditRemoveMedia] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  useEffect(() => {
    getMe()
      .then((me) => setIsAdmin(me.isAdmin))
      .catch(() => setIsAdmin(false));
    // Fetched unconditionally (not just when the picker opens) since an
    // existing reaction pill might itself be a custom emoji that needs
    // resolving to an image — same "no pagination this milestone"
    // simplicity precedent as the rest of this app.
    getCustomEmoji()
      .then(setCustomEmoji)
      .catch(() => setCustomEmoji([]));
  }, []);

  async function handleAdminDelete() {
    if (!(await confirm("Delete this Gib and all its chatter?"))) return;
    setDeleting(true);
    try {
      await adminDeletePost(post.id);
      setDeleted(true);
    } catch {
      setDeleting(false);
    }
  }

  async function handleDeleteOwn() {
    if (!(await confirm("Delete this Gib?"))) return;
    setDeleting(true);
    try {
      await deletePost(post.id);
      setDeleted(true);
    } catch {
      setDeleting(false);
    }
  }

  function startEditing() {
    setEditTitle(content.title ?? "");
    setEditUrl(content.url ?? "");
    setEditBody(content.body ?? "");
    setEditLocation(content.location ?? "");
    setEditContentWarning(content.contentWarning ?? "");
    setEditShowContentWarning(Boolean(content.contentWarning));
    setEditMediaFile(null);
    setEditRemoveMedia(false);
    setEditError(null);
    setEditing(true);
  }

  async function handleSubmitEdit(e: FormEvent) {
    e.preventDefault();
    setEditError(null);
    setEditSubmitting(true);
    try {
      let imageUrl: string | null | undefined;
      let videoUrl: string | null | undefined;
      if (editMediaFile) {
        const uploaded = await uploadPostMedia(editMediaFile);
        if (uploaded.type === "image") {
          imageUrl = uploaded.url;
          videoUrl = null;
        } else {
          videoUrl = uploaded.url;
          imageUrl = null;
        }
      } else if (editRemoveMedia) {
        imageUrl = null;
        videoUrl = null;
      }

      const updated = await updatePost(post.id, {
        title: editTitle,
        url: editUrl || null,
        body: editBody || null,
        contentWarning: editShowContentWarning && editContentWarning ? editContentWarning : null,
        location: editLocation || null,
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        ...(videoUrl !== undefined ? { videoUrl } : {}),
      });
      setContent({
        title: updated.title,
        url: updated.url,
        body: updated.body,
        location: updated.location,
        imageUrl: updated.imageUrl,
        videoUrl: updated.videoUrl,
        audioUrl: updated.audioUrl,
        updatedAt: updated.updatedAt,
        contentWarning: updated.contentWarning,
      });
      setCwRevealed(false);
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof ApiError ? JSON.stringify(err.body) : "failed to save changes");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleVote(value: VoteValue) {
    try {
      const result = await votePost(post.id, value);
      setVote(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    }
  }

  useEffect(() => {
    if (!pickerOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [pickerOpen]);

  async function handlePickReaction(emoji: string) {
    setReacting(true);
    setPickerOpen(false);
    try {
      const result = await setReaction(post.id, emoji);
      setReactions(result.reactions);
      setMyReaction(result.myReaction);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setReacting(false);
    }
  }

  async function handleRemoveReaction() {
    setReacting(true);
    try {
      const result = await removeReaction(post.id);
      setReactions(result.reactions);
      setMyReaction(result.myReaction);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setReacting(false);
    }
  }

  function handlePillClick(emoji: string) {
    if (reacting) return;
    if (emoji === myReaction) {
      void handleRemoveReaction();
    } else {
      void handlePickReaction(emoji);
    }
  }

  const pollExpired = Boolean(poll?.expiresAt && new Date(poll.expiresAt) < new Date());

  // Single-select votes immediately on click. Multi-select just toggles
  // local checkbox state — handleSubmitPollVotes below sends it.
  async function handleSelectSingleOption(optionId: string) {
    if (voting || pollExpired) return;
    setVoting(true);
    try {
      const result = await votePoll(post.id, [optionId]);
      setPoll(result.poll);
      setPendingOptionIds(result.poll.myOptionIds);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setVoting(false);
    }
  }

  function handleToggleMultiOption(optionId: string) {
    if (pollExpired) return;
    setPendingOptionIds((prev) =>
      prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId],
    );
  }

  async function handleSubmitPollVotes() {
    if (voting || pendingOptionIds.length === 0) return;
    setVoting(true);
    try {
      const result = await votePoll(post.id, pendingOptionIds);
      setPoll(result.poll);
      setPendingOptionIds(result.poll.myOptionIds);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setVoting(false);
    }
  }

  async function handleToggleBoost() {
    setBoosting(true);
    try {
      if (boosted) {
        await unboostPost(post.id);
        setBoosted(false);
      } else {
        await boostPost(post.id);
        setBoosted(true);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setBoosting(false);
    }
  }

  async function handleToggleCalendar() {
    setSavingToCalendar(true);
    try {
      if (savedToCalendar) {
        await removeEventFromCalendar(post.id);
        setSavedToCalendar(false);
      } else {
        await saveEventToCalendar(post.id);
        setSavedToCalendar(true);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setSavingToCalendar(false);
    }
  }

  async function handleToggleBookmark() {
    setBookmarking(true);
    try {
      if (bookmarked) {
        await unbookmarkPost(post.id);
        setBookmarked(false);
      } else {
        await bookmarkPost(post.id);
        setBookmarked(true);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setBookmarking(false);
    }
  }

  const authorLabel = post.author.displayName ?? post.author.username;

  // Renders a reaction's emoji — either a raw unicode character (shown
  // as-is) or ":shortcode:" resolved against the instance's custom
  // emoji list. An unrecognized shortcode (e.g. a remote instance's own
  // custom emoji we haven't cached — see reactActivity's disclosed
  // limitation) falls back to the raw text rather than erroring.
  function renderEmoji(emoji: string) {
    const match = emoji.match(/^:([a-z0-9_]+):$/);
    if (!match) return <span>{emoji}</span>;
    const found = customEmoji?.find((e) => e.shortcode === match[1]);
    if (!found) return <span style={{ fontSize: "0.8rem" }}>{emoji}</span>;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={assetUrl(found.imageUrl)} alt={emoji} style={{ width: 16, height: 16, verticalAlign: "middle" }} />;
  }

  if (deleted) return null;

  return (
    <li
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: "0.5rem", listStyle: "none", ...boxStyle }}
    >
      {post.boostedBy && (
        <Link
          href={`/u/${post.boostedBy.username}`}
          className="text-faint"
          style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.85rem" }}
        >
          🔁 Echoed by {post.boostedBy.displayName ?? post.boostedBy.username}
        </Link>
      )}
      <div style={{ display: "flex", gap: "0.9rem" }}>
      <VoteButtons score={score} myVote={myVote} onVote={handleVote} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <Avatar
            name={authorLabel}
            size={28}
            imageUrl={post.author.avatarImageUrl}
            preset={post.author.avatarPreset}
          />
          <Link href={`/u/${post.author.username}`} style={{ fontWeight: 600, color: boxStyle?.color ?? "var(--text)" }}>
            {authorLabel}
          </Link>
          {post.community && (
            <GroupTagPreview username={post.community.actor.username} title={post.community.actor.username} />
          )}
          {!post.community && post.visibility !== "public" && (
            <span className="pill" title={`Visibility: ${post.visibility}`}>
              {post.visibility === "followers"
                ? "👥 Listeners"
                : post.visibility === "specified"
                  ? "📩 Specified"
                  : "🔒 Local only"}
            </span>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={handleAdminDelete}
              disabled={deleting}
              className="btn btn-ghost"
              style={{ padding: "0.1rem 0.5rem", fontSize: "0.8rem", marginLeft: "auto", color: "var(--danger)" }}
            >
              host delete
            </button>
          )}
        </div>

        <p
          className="text-faint"
          title={new Date(post.createdAt).toLocaleString()}
          style={{ margin: "0.1rem 0 0.3rem", fontSize: "0.8rem" }}
        >
          Posted {timeAgoLong(post.createdAt)}
        </p>

        {content.updatedAt && (
          <p className="text-faint" style={{ margin: "0 0 0.2rem", fontSize: "0.75rem" }}>
            edited
          </p>
        )}

        {editing ? (
          <form onSubmit={handleSubmitEdit} style={{ margin: "0.3rem 0" }}>
            <label className="field">
              Title
              <input
                className="input"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
              />
            </label>
            <label className="field">
              URL (optional)
              <input className="input" value={editUrl} onChange={(e) => setEditUrl(e.target.value)} />
            </label>
            <label className="field">
              Text (optional)
              <textarea
                className="input"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={4}
              />
            </label>
            <label className="field">
              📍 Location (optional)
              <input
                className="input"
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.5rem 0" }}>
              <input
                type="checkbox"
                checked={editShowContentWarning}
                onChange={(e) => setEditShowContentWarning(e.target.checked)}
              />
              ⚠️ Content warning
            </label>
            {editShowContentWarning && (
              <label className="field">
                Warning text
                <input
                  className="input"
                  value={editContentWarning}
                  onChange={(e) => setEditContentWarning(e.target.value)}
                />
              </label>
            )}
            {(content.imageUrl || content.videoUrl) && !editRemoveMedia && !editMediaFile && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setEditRemoveMedia(true)}
                style={{ fontSize: "0.85rem", padding: "0.1rem 0.5rem" }}
              >
                Remove current photo/video
              </button>
            )}
            <label className="field">
              Replace photo or video (optional)
              <input
                type="file"
                accept="image/*,video/*"
                className="input"
                onChange={(e) => {
                  setEditMediaFile(e.target.files?.[0] ?? null);
                  setEditRemoveMedia(false);
                }}
              />
            </label>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
              <button type="submit" disabled={editSubmitting} className="btn btn-accent">
                {editSubmitting ? "Saving…" : "Save"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
            {editError && <p className="error-text">{editError}</p>}
          </form>
        ) : (
          <>
            {(content.title || content.url) && (
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                {content.title &&
                  (detail ? (
                    <h1 style={{ fontSize: "1.4rem", margin: 0 }}>{content.title}</h1>
                  ) : (
                    <Link
                      href={`/posts/${post.id}`}
                      style={{ fontWeight: 700, fontSize: "1.05rem", color: boxStyle?.color ?? "var(--text)" }}
                    >
                      {content.title}
                    </Link>
                  ))}
                {content.url && (
                  <a href={content.url} target="_blank" rel="noreferrer" className="text-faint">
                    {new URL(content.url).hostname} ↗
                  </a>
                )}
              </div>
            )}

            {content.location && (
              <p className="text-faint" style={{ margin: "0.2rem 0 0" }}>
                📍 {content.location}
              </p>
            )}
          </>
        )}

        {post.eventStart && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", margin: "0.3rem 0", flexWrap: "wrap" }}>
            <p className="text-faint" style={{ margin: 0 }}>
              📅{" "}
              {new Date(post.eventStart).toLocaleString(undefined, {
                month: "long",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
              {post.eventLocation ? ` · ${post.eventLocation}` : ""}
            </p>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={savingToCalendar}
              onClick={handleToggleCalendar}
              style={{ padding: "0.15rem 0.6rem", fontSize: "0.8rem" }}
            >
              {savedToCalendar ? "✓ On your calendar — remove" : "Add to calendar"}
            </button>
          </div>
        )}

        {!editing && content.contentWarning && !cwRevealed && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setCwRevealed(true)}
            style={{ margin: "0.4rem 0", textAlign: "left", display: "block", width: "100%" }}
          >
            ⚠️ {content.contentWarning} — click to show
          </button>
        )}

        {!editing && (!content.contentWarning || cwRevealed) && (
          <>
            {content.body && (
              <p style={{ color: boxStyle?.color ?? "var(--text-dim)" }}>
                <LinkifiedText text={content.body} />
              </p>
            )}

            {content.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={assetUrl(content.imageUrl)}
                alt=""
                style={{ maxWidth: "100%", borderRadius: "var(--radius-sm)", display: "block", margin: "0.5rem 0" }}
              />
            )}
            {content.videoUrl && (
              <video
                src={assetUrl(content.videoUrl)}
                controls
                style={{ maxWidth: "100%", borderRadius: "var(--radius-sm)", display: "block", margin: "0.5rem 0" }}
              />
            )}
            {content.audioUrl && (
              <audio
                src={assetUrl(content.audioUrl)}
                controls
                style={{ width: "100%", display: "block", margin: "0.5rem 0" }}
              />
            )}
          </>
        )}

        {poll && (
          <div style={{ margin: "0.5rem 0" }}>
            {poll.options.map((option) => {
              const totalVotes = poll.options.reduce((sum, o) => sum + o.count, 0);
              const pct = totalVotes > 0 ? Math.round((option.count / totalVotes) * 100) : 0;
              const mine = poll.multiple
                ? pendingOptionIds.includes(option.id)
                : poll.myOptionIds.includes(option.id);
              return (
                <label
                  key={option.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    position: "relative",
                    padding: "0.4rem 0.5rem",
                    margin: "0.25rem 0",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    overflow: "hidden",
                    cursor: pollExpired || voting ? "default" : "pointer",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: `${pct}%`,
                      background: "var(--surface-hover)",
                      zIndex: 0,
                    }}
                  />
                  <input
                    type={poll.multiple ? "checkbox" : "radio"}
                    name={`poll-${post.id}`}
                    checked={mine}
                    disabled={pollExpired || voting}
                    onChange={() =>
                      poll.multiple
                        ? handleToggleMultiOption(option.id)
                        : handleSelectSingleOption(option.id)
                    }
                    style={{ position: "relative", zIndex: 1 }}
                  />
                  <span style={{ position: "relative", zIndex: 1, flex: 1 }}>{option.text}</span>
                  <span className="text-faint" style={{ position: "relative", zIndex: 1, fontSize: "0.85rem" }}>
                    {option.count} ({pct}%)
                  </span>
                </label>
              );
            })}
            {poll.multiple && !pollExpired && (
              <button
                type="button"
                className="btn btn-accent"
                disabled={voting || pendingOptionIds.length === 0}
                onClick={handleSubmitPollVotes}
                style={{ marginTop: "0.3rem" }}
              >
                {voting ? "…" : "Vote"}
              </button>
            )}
            <p className="text-faint" style={{ margin: "0.3rem 0 0", fontSize: "0.8rem" }}>
              {pollExpired
                ? "Poll closed"
                : poll.expiresAt
                  ? `Closes ${new Date(poll.expiresAt).toLocaleString()}`
                  : "Poll never closes"}
            </p>
          </div>
        )}

        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap", margin: "0.3rem 0" }}>
          {reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              className="btn btn-ghost"
              disabled={reacting}
              onClick={() => handlePillClick(r.emoji)}
              style={{
                padding: "0.1rem 0.5rem",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
                borderColor: r.emoji === myReaction ? "var(--accent)" : undefined,
              }}
            >
              {renderEmoji(r.emoji)} {r.count}
            </button>
          ))}
          <div ref={pickerRef} style={{ position: "relative" }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setPickerOpen((o) => !o)}
              disabled={reacting}
              style={{ padding: "0.1rem 0.5rem", fontSize: "0.85rem" }}
              title="Add reaction"
            >
              +
            </button>
            {pickerOpen && (
              <div
                className="card"
                style={{
                  position: "absolute",
                  left: 0,
                  top: "calc(100% + 0.4rem)",
                  zIndex: 20,
                  width: 220,
                  padding: "0.5rem",
                  display: "grid",
                  gridTemplateColumns: "repeat(6, 1fr)",
                  gap: "0.25rem",
                }}
              >
                {COMMON_EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handlePickReaction(emoji)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "1.1rem",
                      padding: "0.2rem",
                    }}
                  >
                    {emoji}
                  </button>
                ))}
                {customEmoji?.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => handlePickReaction(`:${e.shortcode}:`)}
                    title={e.shortcode}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: "0.2rem" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={assetUrl(e.imageUrl)} alt={e.shortcode} style={{ width: 18, height: 18 }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.25rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-ghost post-icon-btn"
            onClick={handleToggleBoost}
            disabled={boosting}
            title={boosted ? "Echoed" : "Echo"}
            style={boosted ? { background: "var(--primary-dim)" } : undefined}
          >
            <BoostIcon />
          </button>
          <button
            type="button"
            className="btn btn-ghost post-icon-btn"
            onClick={handleToggleBookmark}
            disabled={bookmarking}
            title={bookmarked ? "Kept" : "Keep"}
            style={bookmarked ? { background: "var(--primary-dim)" } : undefined}
          >
            <BookmarkIcon filled={bookmarked} />
          </button>
          {!detail && (
            <button
              type="button"
              className="btn btn-ghost post-icon-btn"
              onClick={() => setCommentsOpen((o) => !o)}
              title={`${post.commentCount} chatter${post.commentCount === 1 ? "" : "s"}`}
              style={{ width: "auto", gap: "0.3rem", padding: "0.35rem 0.6rem" }}
            >
              <CommentIcon />
              {post.commentCount > 0 && <span style={{ fontSize: "0.85rem" }}>{post.commentCount}</span>}
            </button>
          )}
          {post.canEdit && !editing && (
            <>
              <button
                type="button"
                className="btn btn-ghost post-icon-btn"
                onClick={startEditing}
                title="Edit"
              >
                <EditIcon />
              </button>
              <button
                type="button"
                className="btn btn-ghost post-icon-btn"
                onClick={handleDeleteOwn}
                disabled={deleting}
                title="Delete"
              >
                <TrashIcon />
              </button>
            </>
          )}
          {!post.canEdit && <ReportButton targetType="post" targetId={post.id} label={<FlagIcon />} iconOnly />}
        </div>
        {!detail && commentsOpen && (
          <div style={{ marginTop: "0.75rem" }}>
            <PostComments postId={post.id} />
          </div>
        )}
      </div>
      </div>
    </li>
  );
}
