"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  getCommunities,
  createCommunity,
  createPost,
  uploadPostMedia,
  ApiError,
  type Community,
  type PostVisibility,
} from "../lib/api";
import { GROUP_PRIVACY_LEVELS, GROUP_PRIVACY_LABELS, type GroupPrivacy } from "../lib/groupRoles";

const POST_VISIBILITY_LABELS: Record<PostVisibility, string> = {
  public: "Public",
  followers: "Listeners only",
  specified: "Specified people",
  local_only: "Local only (this room, never federated)",
};

// Shared by the inline "what's on your mind" composer on the feed and the
// standalone /submit page — same form, different container/callbacks.
// `title` is controlled by the parent so the feed's "what's on your mind"
// box and this form's own title field are the same input, not two that
// merely start in sync.
export function PostComposer({
  title,
  onTitleChange,
  onPosted,
  onCancel,
}: {
  title: string;
  onTitleChange: (value: string) => void;
  onPosted: () => void;
  onCancel?: () => void;
}) {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityId, setCommunityId] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("public");
  const [specifiedHandlesText, setSpecifiedHandlesText] = useState("");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const [contentWarning, setContentWarning] = useState("");
  const [showContentWarning, setShowContentWarning] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [postLocation, setPostLocation] = useState("");
  const [isEvent, setIsEvent] = useState(false);
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [isPoll, setIsPoll] = useState(false);
  const [pollOptionsText, setPollOptionsText] = useState(["", ""]);
  const [pollMultiple, setPollMultiple] = useState(false);
  const [pollExpiry, setPollExpiry] = useState<"1h" | "1d" | "1w" | "none">("1d");

  const [newCommunityName, setNewCommunityName] = useState("");
  const [newCommunityTitle, setNewCommunityTitle] = useState("");
  const [newCommunityPrivacy, setNewCommunityPrivacy] = useState<GroupPrivacy>("public");

  useEffect(() => {
    getCommunities().then(setCommunities);
  }, []);

  async function handleCreateCommunity(e: FormEvent) {
    e.preventDefault();
    const community = await createCommunity({
      name: newCommunityName,
      title: newCommunityTitle,
      privacy: newCommunityPrivacy,
    });
    setCommunities((prev) => [community, ...prev]);
    setCommunityId(community.id);
    setNewCommunityName("");
    setNewCommunityTitle("");
    setNewCommunityPrivacy("public");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (isEvent && !eventStart) {
      setError("set a start date/time for the event, or uncheck \"this is an event\"");
      return;
    }
    if (!communityId && visibility === "specified" && !specifiedHandlesText.trim()) {
      setError("list at least one handle for a specified-people Gib");
      return;
    }
    const trimmedOptions = pollOptionsText.map((t) => t.trim()).filter(Boolean);
    if (isPoll && trimmedOptions.length < 2) {
      setError("a poll needs at least 2 options");
      return;
    }
    setSubmitting(true);
    try {
      let imageUrl: string | undefined;
      let videoUrl: string | undefined;
      if (mediaFile) {
        const uploaded = await uploadPostMedia(mediaFile);
        if (uploaded.type === "image") imageUrl = uploaded.url;
        else videoUrl = uploaded.url;
      }

      const pollExpiresAt =
        pollExpiry === "none"
          ? undefined
          : new Date(
              Date.now() +
                (pollExpiry === "1h" ? 1 : pollExpiry === "1d" ? 24 : 24 * 7) * 60 * 60 * 1000,
            ).toISOString();

      await createPost({
        communityId: communityId || undefined,
        visibility: communityId ? undefined : visibility,
        specifiedHandles:
          !communityId && visibility === "specified"
            ? specifiedHandlesText.trim().split(/\s+/).map((h) => h.replace(/^@/, ""))
            : undefined,
        title,
        url: url || undefined,
        body: body || undefined,
        contentWarning: showContentWarning && contentWarning ? contentWarning : undefined,
        eventStart: isEvent && eventStart ? new Date(eventStart).toISOString() : undefined,
        eventEnd: isEvent && eventEnd ? new Date(eventEnd).toISOString() : undefined,
        eventLocation: isEvent && eventLocation ? eventLocation : undefined,
        imageUrl,
        videoUrl,
        location: postLocation || undefined,
        pollOptions: isPoll ? trimmedOptions : undefined,
        pollMultiple: isPoll ? pollMultiple : undefined,
        pollExpiresAt: isPoll ? pollExpiresAt : undefined,
      });
      onTitleChange("");
      setUrl("");
      setBody("");
      setContentWarning("");
      setShowContentWarning(false);
      setMediaFile(null);
      setPostLocation("");
      setIsEvent(false);
      setEventStart("");
      setEventEnd("");
      setEventLocation("");
      setVisibility("public");
      setSpecifiedHandlesText("");
      setIsPoll(false);
      setPollOptionsText(["", ""]);
      setPollMultiple(false);
      setPollExpiry("1d");
      onPosted();
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : "failed to create Gib");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {communities.length === 0 && (
        <section style={{ marginBottom: "1rem" }}>
          <p className="text-dim">No circles exist yet — create the first one.</p>
          <form onSubmit={handleCreateCommunity}>
            <label className="field">
              Name (used in URLs)
              <input
                className="input"
                value={newCommunityName}
                onChange={(e) => setNewCommunityName(e.target.value)}
                required
              />
            </label>
            <label className="field">
              Title
              <input
                className="input"
                value={newCommunityTitle}
                onChange={(e) => setNewCommunityTitle(e.target.value)}
                required
              />
            </label>
            <label className="field">
              Privacy
              <select
                className="input"
                value={newCommunityPrivacy}
                onChange={(e) => setNewCommunityPrivacy(e.target.value as GroupPrivacy)}
              >
                {GROUP_PRIVACY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {GROUP_PRIVACY_LABELS[level]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-primary">
              Create circle
            </button>
          </form>
        </section>
      )}

      <form onSubmit={handleSubmit}>
        <label className="field">
          Title
          <textarea
            className="input"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            rows={1}
            style={{ resize: "none", overflow: "hidden" }}
            required
          />
        </label>
        <label className="field">
          Text (optional)
          <textarea
            className="input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
          />
        </label>
        <label className="field">
          URL (optional)
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="field">
          Photo or video (optional)
          <input
            type="file"
            accept="image/*,video/*"
            className="input"
            onChange={(e) => setMediaFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {!communityId && (
          <label className="field">
            Visibility
            <select
              className="input"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as PostVisibility)}
            >
              {(Object.keys(POST_VISIBILITY_LABELS) as PostVisibility[]).map((level) => (
                <option key={level} value={level}>
                  {POST_VISIBILITY_LABELS[level]}
                </option>
              ))}
            </select>
          </label>
        )}
        {!communityId && visibility === "specified" && (
          <label className="field">
            Who can see this (handles, space-separated)
            <input
              className="input"
              value={specifiedHandlesText}
              onChange={(e) => setSpecifiedHandlesText(e.target.value)}
              placeholder="alice bob@example.social"
            />
          </label>
        )}
        <label className="field">
          📍 Location (optional)
          <input
            className="input"
            value={postLocation}
            onChange={(e) => setPostLocation(e.target.value)}
            placeholder="Carowinds"
          />
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.5rem 0" }}>
          <input
            type="checkbox"
            checked={showContentWarning}
            onChange={(e) => setShowContentWarning(e.target.checked)}
          />
          ⚠️ Add a content warning
        </label>
        {showContentWarning && (
          <label className="field">
            Warning text (shown before the Gib — e.g. "spoilers")
            <input
              className="input"
              value={contentWarning}
              onChange={(e) => setContentWarning(e.target.value)}
            />
          </label>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.5rem 0" }}>
          <input type="checkbox" checked={isEvent} onChange={(e) => setIsEvent(e.target.checked)} />
          📅 This is an event
        </label>
        {isEvent && (
          <>
            <label className="field">
              Date &amp; time
              <input
                type="datetime-local"
                className="input"
                value={eventStart}
                onChange={(e) => setEventStart(e.target.value)}
                required
              />
            </label>
            <label className="field">
              Ends (optional)
              <input
                type="datetime-local"
                className="input"
                value={eventEnd}
                onChange={(e) => setEventEnd(e.target.value)}
              />
            </label>
            <label className="field">
              Location (optional)
              <input
                className="input"
                value={eventLocation}
                onChange={(e) => setEventLocation(e.target.value)}
              />
            </label>
          </>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.5rem 0" }}>
          <input type="checkbox" checked={isPoll} onChange={(e) => setIsPoll(e.target.checked)} />
          📊 Add a poll
        </label>
        {isPoll && (
          <>
            {pollOptionsText.map((text, i) => (
              <label key={i} className="field">
                {`Option ${i + 1}`}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    value={text}
                    onChange={(e) =>
                      setPollOptionsText((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))
                    }
                    maxLength={200}
                  />
                  {pollOptionsText.length > 2 && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setPollOptionsText((prev) => prev.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </label>
            ))}
            {pollOptionsText.length < 8 && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPollOptionsText((prev) => [...prev, ""])}
                style={{ marginBottom: "0.5rem" }}
              >
                + Add option
              </button>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.5rem 0" }}>
              <input
                type="checkbox"
                checked={pollMultiple}
                onChange={(e) => setPollMultiple(e.target.checked)}
              />
              Allow choosing multiple options
            </label>
            <label className="field">
              Poll ends
              <select
                className="input"
                value={pollExpiry}
                onChange={(e) => setPollExpiry(e.target.value as typeof pollExpiry)}
              >
                <option value="1h">In 1 hour</option>
                <option value="1d">In 1 day</option>
                <option value="1w">In 1 week</option>
                <option value="none">Never</option>
              </select>
            </label>
          </>
        )}

        <label className="field">
          Circle
          <select
            className="input"
            value={communityId}
            onChange={(e) => setCommunityId(e.target.value)}
          >
            <option value="">Personal note (no circle)</option>
            {communities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.actor.username}
                {c.privacy !== "public" ? ` (${c.privacy})` : ""}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="submit" disabled={submitting} className="btn btn-accent">
            {submitting ? "Gibbing…" : "Gib"}
          </button>
          {onCancel && (
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  );
}
