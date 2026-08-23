"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getMe,
  getProfile,
  startConversation,
  logout,
  getUpcomingEvents,
  uploadProfileImage,
  ApiError,
  API_URL,
  type Me,
  type Profile,
  type CalendarEvent,
} from "../../../lib/api";
import { ProfileMemoBox } from "../../../components/ProfileMemoBox";
import { RenderedDescription } from "../../../components/RenderedDescription";
import { PostItem } from "../../../components/PostItem";
import { Avatar } from "../../../components/Avatar";
import { EventsCalendar } from "../../../components/EventsCalendar";
import { FriendButton } from "../../../components/FriendButton";
import { FollowButton } from "../../../components/FollowButton";
import { BlockButton } from "../../../components/BlockButton";
import { ReportButton } from "../../../components/ReportButton";
import { RelationshipsTab } from "../../../components/RelationshipsTab";
import { PhotosTab } from "../../../components/PhotosTab";
import { BookwyrmTab } from "../../../components/BookwyrmTab";
import { KeepsTab } from "../../../components/KeepsTab";
import { FONT_PRESETS } from "../../../lib/fontPresets";
import { HEADER_PRESETS, BACKGROUND_PRESETS, AVATAR_PRESETS } from "../../../lib/imagePresets";
import { ABOUT_FIELD_LABELS, CALENDAR_VISIBILITY_LABEL } from "../../../lib/aboutFields";
import { RELATIONSHIP_STATUS_LABELS } from "../../../lib/relationshipStatus";
import { getTheme } from "../../../lib/theme";
import { boxStyle, readableTextColor, THEME_SURFACE_COLORS } from "../../../lib/contrast";
import { openChatDock } from "../../../lib/chatDock";

function websiteHref(website: string) {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

// A remote actor's avatar/header/background is already an absolute URL
// (federated via icon/image on their Actor object) — only a local
// upload's relative /uploads/... path needs our own API origin prefixed.
function assetUrl(path: string) {
  return /^https?:\/\//.test(path) ? path : `${API_URL}${path}`;
}

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | "loading" | "error">("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<
    "posts" | "comments" | "about" | "calendar" | "relationships" | "photos" | "bookwyrm" | "keeps"
  >("posts");

  // Lets a `?tab=bookwyrm` link (e.g. the BookWyrm badge next to a
  // friend's name on the Relationships tab) land directly on that tab, without
  // pulling in useSearchParams/a Suspense boundary just for this one
  // deep-link — window is only ever touched after mount here.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "bookwyrm") setTab("bookwyrm");
  }, []);
  const [messaging, setMessaging] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[] | "loading" | "hidden" | "unavailable">(
    "hidden",
  );

  // Clicking the avatar/header image itself (own profile only) opens
  // the file picker directly, rather than requiring a trip to the
  // separate edit-profile page for what's otherwise a one-click swap.
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);

  // Mobile-only "⋮" menu (see .tabs/.tab-menu media queries) — the full
  // desktop tab strip doesn't fit a phone's width at any legible size
  // once every optional tab (Keeps, BookWyrm) is in play. Portaled to
  // document.body (see the render below) rather than positioned
  // relative to .tab-menu, because the profile header is an
  // overflow: hidden card (needed for the cover photo's rounded
  // corners) that would otherwise clip the dropdown — so its position
  // is computed from the trigger button's rect instead of plain CSS.
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [tabMenuPos, setTabMenuPos] = useState<{ top: number; right: number; width?: number } | null>(
    null,
  );
  const tabMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const tabMenuDropdownRef = useRef<HTMLDivElement>(null);
  const logoutButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!tabMenuOpen) return;
    // Anchored to the Log out button when it exists (own profile) —
    // underneath it, same width, matching that corner of the header
    // instead of a generic screen-edge inset. A visitor's profile has
    // no Log out button, so it falls back to a fixed inset from the
    // trigger's own row (the trigger sits near the *left* of the
    // header, where the tab strip always started, so anchoring to
    // *its* rect pulled the menu toward the left edge instead).
    const logoutRect = logoutButtonRef.current?.getBoundingClientRect();
    if (logoutRect) {
      setTabMenuPos({
        top: logoutRect.bottom + 4,
        right: window.innerWidth - logoutRect.right,
        width: logoutRect.width,
      });
      return;
    }
    const triggerRect = tabMenuTriggerRef.current?.getBoundingClientRect();
    if (triggerRect) setTabMenuPos({ top: triggerRect.bottom + 4, right: 16 });
  }, [tabMenuOpen]);

  useEffect(() => {
    if (!tabMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        !tabMenuTriggerRef.current?.contains(target) &&
        !tabMenuDropdownRef.current?.contains(target)
      ) {
        setTabMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [tabMenuOpen]);

  function refreshProfile() {
    return getProfile(username)
      .then(setProfile)
      .catch(() => setProfile("error"));
  }

  const [loadingMorePosts, setLoadingMorePosts] = useState(false);

  async function handleLoadMorePosts() {
    if (profile === "loading" || profile === "error" || !profile.nextCursor) return;
    setLoadingMorePosts(true);
    try {
      const res = await getProfile(username, profile.nextCursor);
      // Only posts/nextCursor come from the paginated page — everything
      // else in the response (actor, counts, comments, memo) is just
      // whatever's currently true, not specific to this page of posts,
      // so merging the rest in would silently clobber anything already
      // changed locally (e.g. a just-written memo) with a stale refetch.
      setProfile((prev) =>
        prev !== "loading" && prev !== "error"
          ? { ...prev, posts: [...prev.posts, ...res.posts], nextCursor: res.nextCursor }
          : prev,
      );
    } finally {
      setLoadingMorePosts(false);
    }
  }

  async function handleAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingAvatar(true);
    setImageUploadError(null);
    try {
      await uploadProfileImage("avatar", file);
      await refreshProfile();
    } catch {
      setImageUploadError("upload failed — not a valid image?");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleHeaderFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingHeader(true);
    setImageUploadError(null);
    try {
      await uploadProfileImage("header", file);
      await refreshProfile();
    } catch {
      setImageUploadError("upload failed — not a valid image?");
    } finally {
      setUploadingHeader(false);
    }
  }

  async function handleMessage() {
    setMessaging(true);
    setMessageError(null);
    try {
      const conversation = await startConversation(username);
      openChatDock({ conversationId: conversation.id, otherActor: conversation.otherActor });
      setMessaging(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setMessageError("failed to start whisper");
      setMessaging(false);
    }
  }

  useEffect(() => {
    getProfile(username)
      .then(setProfile)
      .catch(() => setProfile("error"));
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
    setEvents("hidden");
  }, [username]);

  useEffect(() => {
    if (tab !== "calendar" || events !== "hidden") return;
    setEvents("loading");
    getUpcomingEvents(username)
      .then(setEvents)
      .catch(() => setEvents("unavailable"));
  }, [tab, username, events]);

  async function handleLogout() {
    await logout();
    setMe(null);
    window.location.href = "/";
  }

  if (profile === "loading") return <main className="page">Loading…</main>;
  if (profile === "error") return <main className="page">Could not load this profile.</main>;

  const isOwnProfile = me?.actor.username === profile.actor.username;
  const displayLabel = profile.actor.displayName ?? profile.actor.username;

  // Backs both the desktop .tabs strip and the mobile "⋮" dropdown
  // (tab-menu below) so the two can't drift out of sync with each other.
  const tabItems: { key: typeof tab; label: string }[] = [
    { key: "posts", label: "Gibs" },
    { key: "comments", label: "Chatter" },
    { key: "about", label: "About" },
    { key: "calendar", label: "Calendar" },
    { key: "relationships", label: "Relationships" },
    { key: "photos", label: "Photos" },
    ...(isOwnProfile ? [{ key: "keeps" as const, label: "Keeps" }] : []),
    ...(profile.actor.bookwyrmHandle ? [{ key: "bookwyrm" as const, label: "BookWyrm" }] : []),
  ];
  const joined = new Date(profile.actor.createdAt).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const theme = getTheme();

  // Precedence for every image slot: uploaded image > built-in preset >
  // plain color (header/background only) > site default.
  const usingBackgroundImage = Boolean(profile.actor.backgroundImageUrl || profile.actor.backgroundPreset);
  const pageBackgroundStyle = profile.actor.backgroundImageUrl
    ? {
        backgroundImage: `url(${assetUrl(profile.actor.backgroundImageUrl)})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : profile.actor.backgroundPreset
      ? {
          backgroundImage: `url(${BACKGROUND_PRESETS[profile.actor.backgroundPreset].dataUri})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }
      : profile.actor.backgroundColor
        ? { backgroundColor: profile.actor.backgroundColor }
        : {};

  // Text color is computed against whatever's actually behind it, so a
  // custom color choice (or an un-customized theme surface) can never end
  // up unreadable for a given viewer's theme. A background image/preset
  // can't be scored for contrast, so this falls back to the chosen font
  // color (or theme default) with no adjustment — safe in practice because
  // every piece of text on this page lives inside a `.card`, which always
  // paints its own opaque background; nothing ever actually sits directly
  // on the page's background image.
  const pageTextColor = usingBackgroundImage
    ? (profile.actor.fontColor ?? undefined)
    : profile.actor.backgroundColor || profile.actor.fontColor
      ? readableTextColor(profile.actor.backgroundColor ?? THEME_SURFACE_COLORS[theme].page, profile.actor.fontColor)
      : undefined;

  const fontStyle = {
    ...(profile.actor.fontFamily ? { fontFamily: FONT_PRESETS[profile.actor.fontFamily] } : {}),
    ...(pageTextColor ? { color: pageTextColor } : {}),
  };

  const contentBoxStyle = boxStyle(profile.actor.contentBoxColor, "card", theme, profile.actor.fontColor);

  // This wrapping card is never itself user-customizable (its background is
  // always the theme's own --surface), but a global fontColor set to match
  // a *page* background can still be unreadable against it — so it needs
  // the same per-surface check as the intro/content boxes, just always
  // with a null "custom background" input.
  const profileCardStyle = boxStyle(null, "card", theme, profile.actor.fontColor);

  return (
    <div style={{ ...pageBackgroundStyle, minHeight: "100vh" }}>
    <main className="page-wide" style={fontStyle}>
      {/* Cover + name + tabs, full width — like the top block of a Facebook profile */}
      <div className="card" style={{ padding: 0, overflow: "hidden", ...profileCardStyle }}>
        <div className={isOwnProfile ? "profile-image-editable" : undefined}>
          <div
            style={{
              height: 200,
              ...(profile.actor.headerImageUrl
                ? {
                    backgroundImage: `url(${assetUrl(profile.actor.headerImageUrl)})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : profile.actor.headerPreset
                  ? {
                      backgroundImage: `url(${HEADER_PRESETS[profile.actor.headerPreset].dataUri})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : profile.actor.headerColor
                    ? { background: profile.actor.headerColor }
                    : {
                        background:
                          "linear-gradient(120deg, var(--primary-dim) 0%, var(--primary) 55%, var(--accent) 130%)",
                      }),
            }}
          />
          {isOwnProfile && (
            <>
              <button
                type="button"
                className="profile-image-overlay"
                onClick={() => headerInputRef.current?.click()}
                disabled={uploadingHeader}
              >
                {uploadingHeader ? "Uploading…" : "Change cover photo"}
              </button>
              <input
                ref={headerInputRef}
                type="file"
                accept="image/*"
                onChange={handleHeaderFileChange}
                style={{ display: "none" }}
              />
            </>
          )}
        </div>
        <div
          className="profile-header-row"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "1.25rem",
            flexWrap: "wrap",
          }}
        >
          {/* Only the avatar bleeds up into the header (marginTop here,
              not on the row) — the row itself starts right at the header's
              bottom edge, so however many lines the name/handle wrap to on
              a narrow screen, they only ever grow downward and can't climb
              back up over the header. */}
          <div
            className={`profile-avatar-wrap${isOwnProfile ? " profile-image-editable" : ""}`}
            style={{
              border: "5px solid var(--surface)",
              borderRadius: "50%",
              lineHeight: 0,
              marginTop: -56,
              overflow: "hidden",
            }}
          >
            {profile.actor.avatarImageUrl || profile.actor.avatarPreset ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={
                  profile.actor.avatarImageUrl
                    ? assetUrl(profile.actor.avatarImageUrl)
                    : AVATAR_PRESETS[profile.actor.avatarPreset!].dataUri
                }
                alt={displayLabel}
                width={128}
                height={128}
                style={{ width: 128, height: 128, borderRadius: "50%", objectFit: "cover", display: "block" }}
              />
            ) : (
              <Avatar name={displayLabel} size={128} />
            )}
            {isOwnProfile && (
              <>
                <button
                  type="button"
                  className="profile-image-overlay"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  style={{ borderRadius: "50%" }}
                >
                  {uploadingAvatar ? "Uploading…" : "Change photo"}
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileChange}
                  style={{ display: "none" }}
                />
              </>
            )}
          </div>
          {/* Forces a wrap onto a new line on mobile without touching the
              avatar's own box (giving the avatar itself flex-basis: 100%
              stretched its width to the full row while its height stayed
              content-sized, so border-radius: 50% drew an oval instead of
              a circle). Zero-sized, so it's invisible on desktop where it
              doesn't force anything. */}
          <div className="profile-row-break" />
          <div className="profile-name-block" style={{ flex: 1, paddingTop: "0.6rem" }}>
            <h1 style={{ margin: 0, fontSize: "1.7rem" }}>
              {displayLabel}
              {profile.actor.pronouns && (
                <span className="text-faint" style={{ fontWeight: 400, fontSize: "1rem", marginLeft: "0.5rem" }}>
                  ({profile.actor.pronouns})
                </span>
              )}
            </h1>
            <p className="text-faint" style={{ margin: "0.15rem 0 0" }}>
              @{profile.actor.username}@{profile.actor.domain}
            </p>
          </div>
          {isOwnProfile && (
            <div className="profile-owner-actions" style={{ display: "flex", gap: "0.5rem", paddingTop: "0.6rem" }}>
              <Link href="/settings" className="btn btn-ghost">
                Settings
              </Link>
              <button ref={logoutButtonRef} onClick={handleLogout} className="btn btn-ghost">
                Log out
              </button>
            </div>
          )}
          {me && !isOwnProfile && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", paddingTop: "0.6rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <FriendButton username={username} />
                <FollowButton username={username} domain={profile.actor.domain} actorId={profile.actor.id} />
                <BlockButton username={username} domain={profile.actor.domain} actorId={profile.actor.id} />
                <ReportButton targetType="actor" targetId={profile.actor.id} />
              </div>
              <button onClick={handleMessage} disabled={messaging} className="btn btn-accent">
                {messaging ? "…" : "Whisper"}
              </button>
            </div>
          )}
        </div>
        {messageError && (
          <p className="error-text" style={{ padding: "0 1.5rem" }}>
            {messageError}
          </p>
        )}
        {imageUploadError && (
          <p className="error-text" style={{ padding: "0 1.5rem" }}>
            {imageUploadError}
          </p>
        )}

        {me && !isOwnProfile && <ProfileMemoBox username={username} initialMemo={profile.memo} />}

        {/* Desktop tab strip — hidden on mobile in favor of the "⋮" menu
            below (see .tabs/.tab-menu media queries), the same fit
            problem the Circles page tabs had, but worse: up to 8 tabs
            including "Relationships" as a label doesn't fit a phone's
            width at any legible size. */}
        <nav className="tabs profile-tabs">
          {tabItems.map((item) => (
            <button
              key={item.key}
              className={item.key === tab ? "active" : undefined}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Mobile-only equivalent — a compact trigger naming the current
            tab plus a "⋮" button that opens the same list as a dropdown. */}
        <div className="tab-menu">
          <button
            ref={tabMenuTriggerRef}
            type="button"
            className="btn btn-ghost tab-menu-trigger"
            onClick={() => setTabMenuOpen((open) => !open)}
            aria-haspopup="true"
            aria-expanded={tabMenuOpen}
          >
            {tabItems.find((t) => t.key === tab)?.label}
            <span aria-hidden>⋮</span>
          </button>
          {tabMenuOpen &&
            tabMenuPos &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                ref={tabMenuDropdownRef}
                className="card tab-menu-dropdown"
                style={{
                  position: "fixed",
                  top: tabMenuPos.top,
                  right: tabMenuPos.right,
                  ...(tabMenuPos.width ? { width: tabMenuPos.width, minWidth: 0 } : {}),
                }}
              >
                {tabItems.map((item) => (
                  <button
                    key={item.key}
                    className={item.key === tab ? "active" : undefined}
                    onClick={() => {
                      setTab(item.key);
                      setTabMenuOpen(false);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>,
              document.body,
            )}
        </div>
      </div>

      {/* Two-column body: Intro sidebar + content */}
      <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
        <aside style={{ flex: "1 1 280px", maxWidth: 320 }}>
          <div className="card" style={boxStyle(profile.actor.introBoxColor, "card", theme, profile.actor.fontColor)}>
            <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>Intro</h3>
            {profile.actor.summary ? (
              <RenderedDescription html={profile.actor.summary} style={{ margin: 0 }} />
            ) : (
              <p style={{ margin: 0 }}>
                <span className="text-faint">No bio yet.</span>
              </p>
            )}
            <ul className="intro-list">
              {profile.actor.location && <li>📍 {profile.actor.location}</li>}
              {profile.actor.website && (
                <li>
                  🔗{" "}
                  <a href={websiteHref(profile.actor.website)} target="_blank" rel="noreferrer">
                    {profile.actor.website}
                  </a>
                </li>
              )}
              <li>📅 Joined {joined}</li>
              <li>
                👥 <strong>{profile.counts.followers}</strong> listeners ·{" "}
                <strong>{profile.counts.following}</strong> listening to
              </li>
            </ul>
          </div>
        </aside>

        <div style={{ flex: "3 1 400px", minWidth: 0 }}>
          {tab === "posts" &&
            (profile.posts.length === 0 ? (
              <p className="text-dim">No Gibs yet.</p>
            ) : (
              <>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {profile.posts.map((post) => (
                    <PostItem key={post.id} post={post} boxStyle={contentBoxStyle} />
                  ))}
                </ul>
                {profile.nextCursor && (
                  <button
                    className="btn btn-ghost"
                    onClick={handleLoadMorePosts}
                    disabled={loadingMorePosts}
                    style={{ display: "block", margin: "1rem auto" }}
                  >
                    {loadingMorePosts ? "Loading…" : "See more"}
                  </button>
                )}
              </>
            ))}

          {tab === "comments" &&
            (profile.comments.length === 0 ? (
              <p className="text-dim">No chatter yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {profile.comments.map((comment) => (
                  <li key={comment.id} className="card" style={contentBoxStyle}>
                    <p className="text-faint" style={{ margin: "0 0 0.35rem" }}>
                      gabbed on{" "}
                      <Link href={`/posts/${comment.post.id}`}>{comment.post.title}</Link>
                    </p>
                    <p style={{ margin: 0 }}>{comment.body}</p>
                    <p className="text-faint" style={{ margin: "0.35rem 0 0" }}>
                      {comment.score} points
                    </p>
                  </li>
                ))}
              </ul>
            ))}

          {tab === "calendar" && (
            <div className="card" style={contentBoxStyle}>
              <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>{CALENDAR_VISIBILITY_LABEL}</h3>
              {events === "loading" || events === "hidden" ? (
                <p className="text-dim" style={{ margin: 0 }}>
                  Loading…
                </p>
              ) : events === "unavailable" ? (
                <p className="text-dim" style={{ margin: 0 }}>
                  No calendar to show.
                </p>
              ) : events.length === 0 ? (
                <p className="text-dim" style={{ margin: 0 }}>
                  No upcoming events.
                </p>
              ) : (
                <EventsCalendar events={events} />
              )}
            </div>
          )}

          {tab === "relationships" && (
            <RelationshipsTab
              username={username}
              isOwnProfile={isOwnProfile}
              contentBoxStyle={contentBoxStyle}
              relationshipStatus={profile.actor.relationshipStatus}
            />
          )}

          {tab === "photos" && (
            <PhotosTab username={username} isOwnProfile={isOwnProfile} contentBoxStyle={contentBoxStyle} />
          )}

          {tab === "keeps" && isOwnProfile && <KeepsTab contentBoxStyle={contentBoxStyle} />}

          {tab === "bookwyrm" && (
            <BookwyrmTab
              username={username}
              displayName={profile.actor.displayName ?? profile.actor.username}
              contentBoxStyle={contentBoxStyle}
            />
          )}

          {tab === "about" && (
            <div className="card" style={contentBoxStyle}>
              {(() => {
                const a = profile.actor;
                const rows: { label: string; value: string }[] = [];
                if (a.workplace) rows.push({ label: ABOUT_FIELD_LABELS.workplace, value: a.workplace });
                if (a.hometown) rows.push({ label: ABOUT_FIELD_LABELS.hometown, value: a.hometown });
                if (a.dateOfBirth)
                  rows.push({
                    label: ABOUT_FIELD_LABELS.dateOfBirth,
                    value: new Date(a.dateOfBirth).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    }),
                  });
                if (a.gender) rows.push({ label: ABOUT_FIELD_LABELS.gender, value: a.gender });
                if (a.languages.length)
                  rows.push({ label: ABOUT_FIELD_LABELS.languages, value: a.languages.join(", ") });
                if (a.education) rows.push({ label: ABOUT_FIELD_LABELS.education, value: a.education });
                if (a.interests.length)
                  rows.push({ label: ABOUT_FIELD_LABELS.interests, value: a.interests.join(", ") });
                if (a.relationshipStatus)
                  rows.push({
                    label: ABOUT_FIELD_LABELS.relationshipStatus,
                    value: RELATIONSHIP_STATUS_LABELS[a.relationshipStatus],
                  });

                const facts = a.customFacts ?? [];

                if (rows.length === 0 && facts.length === 0) {
                  return <p className="text-dim">Nothing to show here.</p>;
                }

                return (
                  <dl style={{ margin: 0 }}>
                    {rows.map((row) => (
                      <div key={row.label} style={{ marginBottom: "0.85rem" }}>
                        <dt className="text-faint">{row.label}</dt>
                        <dd style={{ margin: "0.15rem 0 0" }}>{row.value}</dd>
                      </div>
                    ))}
                    {facts.map((fact, i) => (
                      <div key={i} style={{ marginBottom: "0.85rem" }}>
                        <dt className="text-faint">{fact.label}</dt>
                        <dd style={{ margin: "0.15rem 0 0" }}>{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </main>
    </div>
  );
}
