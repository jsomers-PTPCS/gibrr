import type { FontPresetKey } from "./fontPresets";
import type { HeaderPresetKey, BackgroundPresetKey, AvatarPresetKey } from "./imagePresets";
import type { AboutFieldKey } from "./aboutFields";
import type { RelationshipStatus } from "./relationshipStatus";
import type { FamilyRelationType } from "./familyRelationTypes";
import type { GroupPrivacy, GroupRole } from "./groupRoles";
import type { FediverseDirectoryLink } from "./fediverseDirectories";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// "calendarEvents"/"familyMembers"/"friendsList"/"immichPhotos" aren't
// About-section Actor columns (see lib/aboutFields.ts), but they ride in
// the same visibility map.
type VisibilityKey =
  | AboutFieldKey
  | "calendarEvents"
  | "familyMembers"
  | "friendsList"
  | "immichPhotos";

export interface ActorSummary {
  username: string;
  domain: string;
  displayName: string | null;
}

export interface Me {
  actor: ActorSummary & {
    id: string;
    avatarImageUrl: string | null;
    avatarPreset: AvatarPresetKey | null;
  };
  email: string;
  isAdmin: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

export interface Community {
  id: string;
  title: string;
  description: string | null;
  privacy: GroupPrivacy;
  memberCount: number;
  actor: ActorSummary & { id: string };
}

export interface GroupMembership {
  role: GroupRole;
  state: "pending" | "accepted";
}

export interface GroupDetail extends Community {
  viewerMembership: GroupMembership | null;
}

export interface GroupMembersResponse {
  members: { role: GroupRole; actor: ActorSummary & { id: string } }[];
  pending: (ActorSummary & { id: string })[];
}

export type VoteValue = 1 | -1;

// A reaction's `emoji` is either a raw unicode character/sequence or
// ":shortcode:" referencing a CustomEmoji (see lib/customEmoji-adjacent
// rendering in PostItem.tsx).
export interface ReactionSummary {
  emoji: string;
  count: number;
}

export interface Post {
  id: string;
  // Null for federated timeline content — an incoming Note has no title
  // (Mastodon-style microblogging, not this app's own community posts).
  // Local post creation still always sets one.
  title: string | null;
  url: string | null;
  body: string | null;
  createdAt: string;
  author: ActorSummary & { avatarImageUrl: string | null; avatarPreset: AvatarPresetKey | null };
  // Null for the same reason as title — federated timeline content
  // (the follow-graph branch of GET /feed) doesn't belong to any
  // community.
  community: { title: string; actor: { username: string } } | null;
  visibility: PostVisibility;
  score: number;
  myVote: VoteValue | null;
  commentCount: number;
  eventStart: string | null;
  eventEnd: string | null;
  eventLocation: string | null;
  savedToCalendar: boolean;
  imageUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  location: string | null;
  // Has the viewer boosted this post (ActivityPub Announce).
  boosted: boolean;
  // Set only on a GET /feed entry via its follow-graph/boost branch —
  // who boosted this into your timeline, as opposed to who authored it.
  // Null for a plain community post (never "boosted into" that view).
  boostedBy: ActorSummary | null;
  // Whether the viewer is this post's real author — computed server-side
  // (routes/posts.ts) rather than shipped as a raw id to compare. Always
  // false for cached federated content — nobody local authored it.
  canEdit: boolean;
  // Null until an actual edit (PATCH, or an incoming federated Update) —
  // not Prisma's automatic @updatedAt, so this is a reliable "was it
  // edited" check, not a near-equal-to-createdAt timestamp.
  updatedAt: string | null;
  // Lowercase, extracted from body server-side (federation/textEntities.ts
  // on the API side) — used for #tag linkification and /tag/[name].
  hashtags: string[];
  // AP's `summary` field, despite the name — the warning text shown
  // before body/media are revealed. Null means no CW.
  contentWarning: string | null;
  reactions: ReactionSummary[];
  myReaction: string | null;
  poll: Poll | null;
  // Private, never federated — a plain "save for later" (Misskey/Mastodon
  // call this a bookmark), see routes/posts.ts's /posts/:id/bookmark.
  bookmarked: boolean;
  // The real ActivityPub object IRI — set only for federated content
  // (arrived via inbox, resolved from a pasted URL, or Explore-cached),
  // null for anything authored locally. Rides along on every Post
  // response; used here just to decide whether to show the section below.
  remoteId: string | null;
  // The origin server's own real like/share counts, fetched live — only
  // present on the GET /posts/:id response (routes/posts.ts), never on a
  // feed/list entry (too expensive per-item there). Null fields mean the
  // origin didn't report that number; the whole value is null for a local
  // post or when the live fetch fails.
  remoteEngagement?: { likes: number | null; shares: number | null } | null;
}

export interface PollOptionResult {
  id: string;
  text: string;
  count: number;
}

export interface Poll {
  options: PollOptionResult[];
  multiple: boolean;
  expiresAt: string | null;
  myOptionIds: string[];
}

export interface Comment {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  author: ActorSummary;
  score: number;
  myVote: VoteValue | null;
}

interface FeedResponse {
  posts: Post[];
  nextCursor: string | null;
}

export interface ProfileComment extends Comment {
  post: { id: string; title: string };
}

export interface Profile {
  actor: ActorSummary & {
    id: string;
    summary: string | null;
    createdAt: string;
    pronouns: string | null;
    location: string | null;
    website: string | null;
    bookwyrmHandle: string | null;
    customCss: string | null;
    customHtml: string | null;
    backgroundColor: string | null;
    backgroundImageUrl: string | null;
    headerColor: string | null;
    headerImageUrl: string | null;
    avatarImageUrl: string | null;
    introBoxColor: string | null;
    contentBoxColor: string | null;
    fontFamily: FontPresetKey | null;
    fontColor: string | null;
    headerPreset: HeaderPresetKey | null;
    backgroundPreset: BackgroundPresetKey | null;
    avatarPreset: AvatarPresetKey | null;
    workplace: string | null;
    hometown: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    languages: string[];
    education: string | null;
    interests: string[];
    customFacts: { label: string; value: string }[] | null;
    relationshipStatus: RelationshipStatus | null;
    aboutVisibility: Partial<Record<VisibilityKey, boolean>> | null;
  };
  counts: { followers: number; following: number };
  posts: Post[];
  nextCursor: string | null;
  comments: ProfileComment[];
  // The viewer's own private sticky note about this profile — never
  // visible to anyone else, including the profile's owner. null if the
  // viewer hasn't written one (or isn't logged in).
  memo: string | null;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderActorId: string;
  body: string;
  createdAt: string;
  sender: ActorSummary;
}

export interface ConversationSummary {
  id: string;
  otherActor: (ActorSummary & { id: string }) | null;
  lastMessage: ChatMessage | null;
  unreadCount: number;
  updatedAt: string;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function getMe() {
  return apiFetch<Me>("/auth/me");
}

export function register(input: { username: string; email: string; password: string }) {
  return apiFetch<Me>("/auth/register", { method: "POST", body: JSON.stringify(input) });
}

// A 2FA-enabled account's password check succeeds but doesn't establish
// a session yet — the response is a challenge to finish via
// verifyTwoFactorChallenge, not a Me. Every other account gets a Me
// back immediately, same as before 2FA existed.
export type LoginResult = Me | { requiresTwoFactor: true; challengeId: string };

export function login(input: { emailOrUsername: string; password: string }) {
  return apiFetch<LoginResult>("/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export function verifyTwoFactorChallenge(challengeId: string, token: string) {
  return apiFetch<Me>("/auth/2fa/challenge", {
    method: "POST",
    body: JSON.stringify({ challengeId, token }),
  });
}

export function logout() {
  return apiFetch<void>("/auth/logout", { method: "POST" });
}

// Enrollment: setup generates a secret + QR code (not yet enforced),
// enable proves a real code from it and turns enforcement on, disable
// re-checks the password and turns it back off. See routes/auth.ts.
export function setupTwoFactor() {
  return apiFetch<{ secret: string; qrCodeDataUrl: string }>("/auth/2fa/setup", { method: "POST" });
}

export function enableTwoFactor(token: string) {
  return apiFetch<{ enabled: true; backupCodes: string[] }>("/auth/2fa/enable", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function disableTwoFactor(password: string) {
  return apiFetch<void>("/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password }) });
}

export function verifyEmail(token: string) {
  return apiFetch<void>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
}

export function resendVerification() {
  return apiFetch<void>("/auth/resend-verification", { method: "POST" });
}

export function forgotPassword(email: string) {
  return apiFetch<{ ok: true }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
}

export function resetPassword(token: string, password: string) {
  return apiFetch<void>("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
}

// First-run setup — registers the instance's first (admin) account.
// Only succeeds while zero LocalUser rows exist; the backend 409s after
// that. See routes/setup.ts.
export function getSetupStatus() {
  return apiFetch<{ needsSetup: boolean }>("/setup/status");
}

export function completeSetup(input: { username: string; email: string; password: string }) {
  return apiFetch<Me>("/setup", { method: "POST", body: JSON.stringify(input) });
}

// The one timeline — community-visible posts merged with follow-graph
// content (federated timeline posts and boosts from people the viewer
// follows) when logged in. See routes/posts.ts's GET /feed.
// scope: "federated" shows every federated post this instance has ever
// cached (from anyone's follows, a relay subscription, or a resolved
// URL) instead of just the viewer's own follow graph — see
// routes/posts.ts's GET /feed for why this is a separate scope, not the
// default.
export function getFeed(
  cursor?: string,
  scope?: "federated",
  filters?: { domain?: string; q?: string },
) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (scope) params.set("scope", scope);
  if (filters?.domain) params.set("domain", filters.domain);
  if (filters?.q) params.set("q", filters.q);
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<FeedResponse>(`/feed${query}`);
}

// Populates the Federated tab's domain filter dropdown — ignored
// (server-side) outside federated scope, so there's no equivalent for
// Home.
export function getFederatedDomains() {
  return apiFetch<string[]>("/feed/federated-domains");
}

// Local hashtag browse — app/tag/[name]/page.tsx.
export function getTagPosts(tag: string, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<FeedResponse>(`/tags/${encodeURIComponent(tag)}${query}`);
}

export function getCommunities() {
  return apiFetch<Community[]>("/communities");
}

export function createCommunity(input: {
  name: string;
  title: string;
  description?: string;
  privacy?: GroupPrivacy;
}) {
  return apiFetch<Community>("/communities", { method: "POST", body: JSON.stringify(input) });
}

export function getCommunity(name: string) {
  return apiFetch<GroupDetail>(`/communities/name/${encodeURIComponent(name)}`);
}

export function getCommunityMembers(communityId: string) {
  return apiFetch<GroupMembersResponse>(`/communities/${encodeURIComponent(communityId)}/members`);
}

export function getCommunityPosts(communityId: string) {
  return apiFetch<Post[]>(`/communities/${encodeURIComponent(communityId)}/posts`);
}

export function approveGroupMember(communityId: string, username: string) {
  return apiFetch<{ approved: true }>(
    `/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(username)}/approve`,
    { method: "POST" },
  );
}

export function removeGroupMember(communityId: string, username: string) {
  return apiFetch<void>(
    `/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
}

export function changeGroupMemberRole(communityId: string, username: string, role: GroupRole) {
  return apiFetch<{ role: GroupRole }>(
    `/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(username)}/role`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
}

export function updateCommunity(
  communityId: string,
  input: { title?: string; description?: string; privacy?: GroupPrivacy },
) {
  return apiFetch<Community>(`/communities/${encodeURIComponent(communityId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteCommunity(communityId: string) {
  return apiFetch<void>(`/communities/${encodeURIComponent(communityId)}`, { method: "DELETE" });
}

// communityId omitted -> a "personal note" governed by `visibility`
// instead of a community's own privacy tier (forced to "public"
// server-side whenever communityId is set, regardless of what's sent).
export type PostVisibility = "public" | "followers" | "specified" | "local_only";

export function createPost(input: {
  communityId?: string;
  visibility?: PostVisibility;
  // Only meaningful when visibility === "specified" — handles without
  // a leading "@" ("user" or "user@domain").
  specifiedHandles?: string[];
  title: string;
  url?: string;
  body?: string;
  contentWarning?: string;
  eventStart?: string;
  eventEnd?: string;
  eventLocation?: string;
  imageUrl?: string;
  videoUrl?: string;
  location?: string;
  // A poll — federated as an ActivityPub Question, not a Note. 2-8
  // options; pollExpiresAt omitted means it never expires.
  pollOptions?: string[];
  pollMultiple?: boolean;
  pollExpiresAt?: string;
}) {
  return apiFetch<Post>("/posts", { method: "POST", body: JSON.stringify(input) });
}

export function getPost(id: string) {
  return apiFetch<Post>(`/posts/${encodeURIComponent(id)}`);
}

// Votes (or, for a single-select poll, replaces an existing vote — same
// "one choice slot" rule as setReaction below).
export function votePoll(postId: string, optionIds: string[]) {
  return apiFetch<{ poll: Poll }>(`/posts/${encodeURIComponent(postId)}/poll-votes`, {
    method: "POST",
    body: JSON.stringify({ optionIds }),
  });
}

// Author-only edit — 403s server-side for anyone else. An omitted field
// is left alone; an explicit null clears it (url/body/contentWarning/
// imageUrl/videoUrl/location only — title can't be cleared, same as
// creation). Federates as an ActivityPub Update to the author's
// followers (and to anyone newly @mentioned in the edit).
export function updatePost(
  id: string,
  input: {
    title?: string;
    url?: string | null;
    body?: string | null;
    contentWarning?: string | null;
    imageUrl?: string | null;
    videoUrl?: string | null;
    location?: string | null;
  },
) {
  return apiFetch<Post>(`/posts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

// Author-only delete — 403s server-side for anyone else. Federates as an
// ActivityPub Delete to the author's followers.
export function deletePost(id: string) {
  return apiFetch<void>(`/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// Uploads a photo or video to attach to a post — call this first, then
// pass the returned url as imageUrl/videoUrl to createPost(). Mirrors
// uploadProfileImage's shape (multipart, not a JSON apiFetch call).
export async function uploadPostMedia(file: File): Promise<{ url: string; type: "image" | "video" }> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_URL}/posts/media`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  return res.json() as Promise<{ url: string; type: "image" | "video" }>;
}

export function votePost(id: string, value: VoteValue) {
  return apiFetch<{ score: number; myVote: VoteValue | null }>(
    `/posts/${encodeURIComponent(id)}/vote`,
    { method: "POST", body: JSON.stringify({ value }) },
  );
}

// One reaction slot per person per post — setting a new emoji replaces
// any existing one rather than adding a second (see routes/posts.ts's
// PUT /posts/:id/reactions comment for why).
export function setReaction(postId: string, emoji: string) {
  return apiFetch<{ reactions: ReactionSummary[]; myReaction: string | null }>(
    `/posts/${encodeURIComponent(postId)}/reactions`,
    { method: "PUT", body: JSON.stringify({ emoji }) },
  );
}

export function removeReaction(postId: string) {
  return apiFetch<{ reactions: ReactionSummary[]; myReaction: string | null }>(
    `/posts/${encodeURIComponent(postId)}/reactions`,
    { method: "DELETE" },
  );
}

// Instance-wide custom emoji (routes/customEmoji.ts) — usable in
// reactions alongside built-in unicode ones.
export interface CustomEmoji {
  id: string;
  shortcode: string;
  imageUrl: string;
}

export function getCustomEmoji() {
  return apiFetch<CustomEmoji[]>("/custom-emoji");
}

export async function addCustomEmoji(shortcode: string, image: File): Promise<CustomEmoji> {
  const formData = new FormData();
  formData.append("shortcode", shortcode);
  formData.append("image", image);

  const res = await fetch(`${API_URL}/custom-emoji`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  return res.json() as Promise<CustomEmoji>;
}

export function removeCustomEmoji(id: string) {
  return apiFetch<void>(`/custom-emoji/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// Reshare — delivered to your followers as a real ActivityPub Announce.
export function boostPost(id: string) {
  return apiFetch<{ boosted: true }>(`/posts/${encodeURIComponent(id)}/boost`, { method: "POST" });
}

export function unboostPost(id: string) {
  return apiFetch<void>(`/posts/${encodeURIComponent(id)}/boost`, { method: "DELETE" });
}

// A plain, private "save for later" — never federated, see
// routes/posts.ts's POST/DELETE /posts/:id/bookmark.
export function bookmarkPost(id: string) {
  return apiFetch<{ bookmarked: true }>(`/posts/${encodeURIComponent(id)}/bookmark`, { method: "POST" });
}

export function unbookmarkPost(id: string) {
  return apiFetch<void>(`/posts/${encodeURIComponent(id)}/bookmark`, { method: "DELETE" });
}

// The viewer's own bookmarked posts — app/bookmarks/page.tsx. No
// pagination, same simplicity precedent as getCommunityPosts/the main
// feed's first-page-only pages.
export function getBookmarks() {
  return apiFetch<{ posts: Post[] }>("/bookmarks");
}

// A saved keyword/author filter (Misskey's "antenna") — a private,
// never-federated lens on posts already visible on this instance. See
// routes/antennas.ts.
export interface Antenna {
  id: string;
  name: string;
  keywords: string[];
  watchedActors: ActorSummary[];
  createdAt: string;
}

export function getAntennas() {
  return apiFetch<Antenna[]>("/antennas");
}

export function createAntenna(input: { name: string; keywords?: string[]; watchedHandles?: string[] }) {
  return apiFetch<Antenna>("/antennas", { method: "POST", body: JSON.stringify(input) });
}

export function updateAntenna(
  id: string,
  input: { name?: string; keywords?: string[]; watchedHandles?: string[] },
) {
  return apiFetch<Antenna>(`/antennas/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteAntenna(id: string) {
  return apiFetch<void>(`/antennas/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getAntennaPosts(id: string) {
  return apiFetch<{ antenna: Antenna; posts: Post[] }>(`/antennas/${encodeURIComponent(id)}/posts`);
}

export function getComments(postId: string) {
  return apiFetch<Comment[]>(`/posts/${encodeURIComponent(postId)}/comments`);
}

export function createComment(postId: string, input: { body: string; parentId?: string }) {
  return apiFetch<Comment>(`/posts/${encodeURIComponent(postId)}/comments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function voteComment(id: string, value: VoteValue) {
  return apiFetch<{ score: number; myVote: VoteValue | null }>(
    `/comments/${encodeURIComponent(id)}/vote`,
    { method: "POST", body: JSON.stringify({ value }) },
  );
}

export function getProfile(username: string, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<Profile>(`/profile/${encodeURIComponent(username)}${query}`);
}

// A private sticky note about this profile, visible only to whoever
// wrote it — Misskey's "memo." Never federated, see the ProfileMemo
// model's own comment.
export function setProfileMemo(username: string, body: string) {
  return apiFetch<{ memo: string }>(`/profile/${encodeURIComponent(username)}/memo`, {
    method: "PUT",
    body: JSON.stringify({ body }),
  });
}

export function deleteProfileMemo(username: string) {
  return apiFetch<void>(`/profile/${encodeURIComponent(username)}/memo`, { method: "DELETE" });
}

export interface BookwyrmActivityItem {
  id: string;
  contentHtml: string;
  bookTitle: string | null;
  bookCoverUrl: string;
  publishedAt: string;
}

export function getBookwyrmActivity(username: string) {
  return apiFetch<{ items: BookwyrmActivityItem[] }>(`/profile/${encodeURIComponent(username)}/bookwyrm`);
}

export function updateProfile(input: {
  displayName?: string;
  summary?: string;
  pronouns?: string;
  location?: string;
  website?: string;
  bookwyrmHandle?: string;
  customCss?: string;
  customHtml?: string;
  backgroundColor?: string;
  headerColor?: string;
  introBoxColor?: string;
  contentBoxColor?: string;
  fontFamily?: FontPresetKey;
  fontColor?: string;
  headerPreset?: HeaderPresetKey;
  backgroundPreset?: BackgroundPresetKey;
  avatarPreset?: AvatarPresetKey;
  workplace?: string;
  hometown?: string;
  dateOfBirth?: string;
  gender?: string;
  languages?: string[];
  education?: string;
  interests?: string[];
  customFacts?: { label: string; value: string }[];
  relationshipStatus?: RelationshipStatus;
  aboutVisibility?: Partial<Record<VisibilityKey, boolean>>;
}) {
  return apiFetch<Me>("/profile", { method: "PATCH", body: JSON.stringify(input) });
}

export async function uploadProfileImage(
  type: "avatar" | "header" | "background",
  file: File,
): Promise<Me> {
  const formData = new FormData();
  formData.append("type", type);
  formData.append("image", file);

  const res = await fetch(`${API_URL}/profile/image`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  return res.json() as Promise<Me>;
}

// handle is a bare username (assumed local) or a full user@domain
// fediverse handle — a remote target gets discovered/cached the same
// way a remote follow/block target does. Federates: sending into the
// resulting conversation delivers a real ActivityPub DM when the other
// participant is remote (routes/conversations.ts).
export function startConversation(handle: string) {
  return apiFetch<{ id: string; otherActor: ActorSummary & { id: string } }>("/conversations", {
    method: "POST",
    body: JSON.stringify({ handle }),
  });
}

export function getConversations() {
  return apiFetch<ConversationSummary[]>("/conversations");
}

export function getMessages(conversationId: string) {
  return apiFetch<ChatMessage[]>(`/conversations/${encodeURIComponent(conversationId)}/messages`);
}

export function sendMessage(conversationId: string, body: string) {
  return apiFetch<ChatMessage>(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export interface AboutMatch {
  field: AboutFieldKey;
  value: string;
}

export interface SearchResults {
  posts: Post[];
  actors: (ActorSummary & { id: string; aboutMatches: AboutMatch[] })[];
  groups: Community[];
}

export function search(q: string) {
  return apiFetch<SearchResults>(`/search?q=${encodeURIComponent(q)}`);
}

// Remote-group discovery/joining — the group-level counterpart to
// getFollowPreview/followHandle. lookupRemoteGroup is read-only (mirrors
// GET /follows/preview); joinRemoteGroup actually creates a pending
// CommunityMembership and delivers a Follow to the group's inbox.
export interface RemoteGroupPreview {
  username: string;
  domain: string;
  title: string;
  description: string | null;
  // Which ActivityPub app the remote domain runs (e.g. "Mastodon",
  // "Friendica"), read from its NodeInfo document — null if that
  // instance doesn't expose one or it couldn't be reached.
  software: string | null;
}

export function lookupRemoteGroup(handle: string) {
  return apiFetch<RemoteGroupPreview>(`/communities/lookup-remote?handle=${encodeURIComponent(handle)}`);
}

export function joinRemoteGroup(handle: string) {
  return apiFetch<{ state: "pending"; communityId: string }>("/communities/join-remote", {
    method: "POST",
    body: JSON.stringify({ handle }),
  });
}

// "Paste a post URL to view/reply/like it" — resolves and caches it
// (idempotently — the same URL always lands on the same local post id),
// unlike lookupRemoteGroup this isn't a separate preview step since
// there's nothing to commit to beyond viewing a cached copy. Returns the
// local post id; the caller navigates to /posts/[id].
export function resolvePostByUrl(url: string) {
  return apiFetch<{ id: string }>(`/posts/resolve?url=${encodeURIComponent(url)}`);
}

export interface CalendarStatus {
  connected: boolean;
  provider?: "caldav" | "ical";
  serverUrl?: string;
  calendarPath?: string | null;
}

export interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  location: string | null;
  postId?: string;
}

export function connectCalendar(input: {
  serverUrl: string;
  username: string;
  appPassword: string;
  calendarPath?: string;
}) {
  return apiFetch<{ connected: true }>("/calendar/connect", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCalendarStatus() {
  return apiFetch<CalendarStatus>("/calendar/status");
}

export function connectIcalUrl(icalUrl: string) {
  return apiFetch<{ connected: true }>("/calendar/connect/ical", {
    method: "POST",
    body: JSON.stringify({ icalUrl }),
  });
}

export function disconnectCalendar() {
  return apiFetch<void>("/calendar/connection", { method: "DELETE" });
}

export function getUpcomingEvents(username: string) {
  return apiFetch<CalendarEvent[]>(`/calendar/events/${encodeURIComponent(username)}`);
}

export function saveEventToCalendar(postId: string) {
  return apiFetch<{ saved: true }>(`/calendar/save/${encodeURIComponent(postId)}`, {
    method: "POST",
  });
}

export function removeEventFromCalendar(postId: string) {
  return apiFetch<void>(`/calendar/save/${encodeURIComponent(postId)}`, { method: "DELETE" });
}

export function getExportLink() {
  return apiFetch<{ url: string | null }>("/calendar/export-token");
}

export function regenerateExportLink() {
  return apiFetch<{ url: string | null }>("/calendar/export-token", { method: "POST" });
}

export type FriendStatus = "self" | "none" | "pending_sent" | "pending_received" | "friends";

export function sendFriendRequest(username: string) {
  return apiFetch<{ requested: true }>(`/friends/request/${encodeURIComponent(username)}`, {
    method: "POST",
  });
}

export function acceptFriendRequest(username: string) {
  return apiFetch<{ accepted: true }>(`/friends/accept/${encodeURIComponent(username)}`, {
    method: "POST",
  });
}

export function removeFriendship(username: string) {
  return apiFetch<void>(`/friends/${encodeURIComponent(username)}`, { method: "DELETE" });
}

export function getFriends(username: string) {
  return apiFetch<(ActorSummary & { id: string; bookwyrmHandle: string | null })[]>(
    `/friends/${encodeURIComponent(username)}`,
  );
}

export function getFriendStatus(username: string) {
  return apiFetch<{ status: FriendStatus }>(`/friends/status/${encodeURIComponent(username)}`);
}

export function getFriendRequests() {
  return apiFetch<(ActorSummary & { id: string })[]>("/friends/requests");
}

export function getSentFriendRequests() {
  return apiFetch<(ActorSummary & { id: string })[]>("/friends/requests/sent");
}

// Fediverse follow graph — separate from Friendship (mutual, local-feel)
// and CommunityMembership: one-directional, works across instances. A
// remote actor has no profile page in this app yet, so these summaries
// are rendered as plain rows, not links — see FollowPanel.tsx.
export interface FollowSummary {
  id: string;
  username: string;
  domain: string;
  displayName: string | null;
  avatarImageUrl: string | null;
  avatarPreset: AvatarPresetKey | null;
  state: "pending" | "accepted";
}

export type FollowStatus = "self" | "none" | "pending" | "accepted";

export function getFollowStatus(username: string) {
  return apiFetch<{ status: FollowStatus }>(`/follows/status/${encodeURIComponent(username)}`);
}

// A live lookup of a handle typed into the follow box — not a fuzzy
// "search suggestions" index (no server has one for the whole fediverse;
// this only resolves a complete, real address, local or remote).
export interface FollowPreview {
  id: string | null;
  username: string;
  domain: string;
  displayName: string | null;
  avatarImageUrl: string | null;
  avatarPreset: AvatarPresetKey | null;
  // Null for a local actor (use /u/{username} instead) — set for a
  // remote one to their real AP object IRI, which real fediverse
  // software also answers as an HTML profile page for a plain browser
  // request (no Accept: activity+json), same as Post.remoteId already
  // doubles as a "view original" link. The only way to actually browse
  // a remote person's posts, since there's no in-app profile page for one.
  url: string | null;
}

export function getFollowPreview(handle: string) {
  return apiFetch<FollowPreview>(`/follows/preview?handle=${encodeURIComponent(handle)}`);
}

// Same preview, but for a pasted profile URL instead of a handle — no
// webfinger round trip, the URL itself is fetched directly (content
// negotiation), same as resolvePostByUrl does for a post URL.
export function getFollowPreviewByUrl(url: string) {
  return apiFetch<FollowPreview>(`/follows/preview?url=${encodeURIComponent(url)}`);
}

export function followHandle(handle: string) {
  return apiFetch<{ state: "pending" | "accepted" }>("/follows", {
    method: "POST",
    body: JSON.stringify({ handle }),
  });
}

export function followUrl(url: string) {
  return apiFetch<{ state: "pending" | "accepted" }>("/follows", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function unfollow(actorId: string) {
  return apiFetch<void>(`/follows/${encodeURIComponent(actorId)}`, { method: "DELETE" });
}

export function getFollowGraph(username: string) {
  return apiFetch<{ following: FollowSummary[]; followers: FollowSummary[] }>(
    `/follows/${encodeURIComponent(username)}`,
  );
}

// Block a local or remote actor by fediverse handle, same discovery
// shape as followHandle. Removes any existing follow relationship in
// either direction server-side.
export function blockHandle(handle: string) {
  return apiFetch<{ blocked: true }>("/blocks", { method: "POST", body: JSON.stringify({ handle }) });
}

export function unblockActor(actorId: string) {
  return apiFetch<void>(`/blocks/${encodeURIComponent(actorId)}`, { method: "DELETE" });
}

export interface BlockedActorSummary {
  id: string;
  username: string;
  domain: string;
  displayName: string | null;
  avatarImageUrl: string | null;
  avatarPreset: AvatarPresetKey | null;
}

// The viewer's own block list — app/settings/page.tsx.
export function getBlockedActors() {
  return apiFetch<BlockedActorSummary[]>("/blocks");
}

export function joinCommunity(communityId: string) {
  return apiFetch<{ state: "pending" | "accepted" }>(
    `/communities/${encodeURIComponent(communityId)}/join`,
    { method: "POST" },
  );
}

// Leaving is just removing your own membership — same endpoint used to
// remove someone else or deny a pending request (routes/communities.ts).
export function leaveCommunity(communityId: string, username: string) {
  return removeGroupMember(communityId, username);
}

export function getCommunityMemberships(username: string) {
  return apiFetch<Community[]>(`/communities/member/${encodeURIComponent(username)}`);
}

export interface FamilyLinkRequest {
  id: string;
  relationType: FamilyRelationType;
  actor: ActorSummary & { id: string };
}

export interface FamilyMember {
  id: string;
  person: ActorSummary & { id: string };
  relationType: FamilyRelationType;
}

export function createFamilyLink(relativeUsername: string, relationType: FamilyRelationType) {
  return apiFetch<{ id: string; state: "pending" }>("/family/link", {
    method: "POST",
    body: JSON.stringify({ relativeUsername, relationType }),
  });
}

export function confirmFamilyLink(linkId: string) {
  return apiFetch<{ accepted: true }>(`/family/confirm/${encodeURIComponent(linkId)}`, {
    method: "POST",
  });
}

export function removeFamilyLink(linkId: string) {
  return apiFetch<void>(`/family/${encodeURIComponent(linkId)}`, { method: "DELETE" });
}

export function getFamilyRequests() {
  return apiFetch<FamilyLinkRequest[]>("/family/requests");
}

export function getSentFamilyRequests() {
  return apiFetch<FamilyLinkRequest[]>("/family/requests/sent");
}

export function getFamilyLinks(username: string) {
  return apiFetch<FamilyMember[]>(`/family/${encodeURIComponent(username)}`);
}

export type Visibility = "public" | "private";

export interface AlbumSummary {
  id: string;
  title: string;
  description: string | null;
  visibility: Visibility;
  createdAt: string;
  coverUrl: string | null;
  photoCount: number;
}

export interface Photo {
  id: string;
  imageUrl: string;
  thumbnailUrl: string;
  caption: string | null;
  visibility: Visibility | null;
}

export interface AlbumDetail {
  id: string;
  title: string;
  description: string | null;
  visibility: Visibility;
  photos: Photo[];
}

export interface ImmichAlbum {
  id: string;
  title: string;
  assetCount: number;
  thumbnailAssetId: string | null;
}

export function createAlbum(input: { title: string; description?: string; visibility: Visibility }) {
  return apiFetch<AlbumSummary>("/albums", { method: "POST", body: JSON.stringify(input) });
}

export function getAlbums(username: string) {
  return apiFetch<AlbumSummary[]>(`/albums/${encodeURIComponent(username)}`);
}

export function getAlbum(username: string, albumId: string) {
  return apiFetch<AlbumDetail>(
    `/albums/${encodeURIComponent(username)}/${encodeURIComponent(albumId)}`,
  );
}

export function updateAlbum(
  albumId: string,
  input: { title?: string; description?: string; visibility?: Visibility },
) {
  return apiFetch<AlbumSummary>(`/albums/${encodeURIComponent(albumId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteAlbum(albumId: string) {
  return apiFetch<void>(`/albums/${encodeURIComponent(albumId)}`, { method: "DELETE" });
}

export async function uploadPhoto(
  albumId: string,
  file: File,
  options?: { caption?: string; visibility?: Visibility },
): Promise<Photo> {
  const formData = new FormData();
  formData.append("image", file);
  if (options?.caption) formData.append("caption", options.caption);
  if (options?.visibility) formData.append("visibility", options.visibility);

  const res = await fetch(`${API_URL}/albums/${encodeURIComponent(albumId)}/photos`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  return res.json() as Promise<Photo>;
}

export function updatePhoto(photoId: string, input: { caption?: string; visibility?: Visibility | null }) {
  return apiFetch<Photo>(`/photos/${encodeURIComponent(photoId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deletePhoto(photoId: string) {
  return apiFetch<void>(`/photos/${encodeURIComponent(photoId)}`, { method: "DELETE" });
}

export function connectImmich(input: { serverUrl: string; apiKey: string }) {
  return apiFetch<{ connected: true }>("/photos/immich/connect", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getImmichStatus() {
  return apiFetch<{ connected: boolean; serverUrl?: string }>("/photos/immich/status");
}

export function disconnectImmich() {
  return apiFetch<void>("/photos/immich/connection", { method: "DELETE" });
}

export function getImmichAlbums(username: string) {
  return apiFetch<ImmichAlbum[]>(`/photos/immich/${encodeURIComponent(username)}`);
}

// Not a fetch wrapper — used directly as an <img src>, same as assetUrl()
// for native uploads. The API key never reaches the browser; this just
// points at our own proxy route.
export function immichAssetUrl(
  username: string,
  assetId: string,
  variant: "thumbnail" | "original" = "thumbnail",
) {
  return `${API_URL}/photos/immich/${encodeURIComponent(username)}/asset/${encodeURIComponent(assetId)}?variant=${variant}`;
}

// Instance-admin moderation — separate from the per-community
// owner/admin/moderator/member roles. Community deletion reuses the
// existing deleteCommunity() above; the backend now accepts either the
// owner or an admin there, so no new function is needed for it.
export interface AdminUserSummary {
  id: string;
  email: string;
  isAdmin: boolean;
  suspended: boolean;
  createdAt: string;
  actor: ActorSummary & { id: string };
}

export function getAdminUsers() {
  return apiFetch<AdminUserSummary[]>("/admin/users");
}

export function suspendUser(localUserId: string) {
  return apiFetch<void>(`/admin/users/${encodeURIComponent(localUserId)}/suspend`, { method: "POST" });
}

export function unsuspendUser(localUserId: string) {
  return apiFetch<void>(`/admin/users/${encodeURIComponent(localUserId)}/unsuspend`, { method: "POST" });
}

// Permanent removal — everything the account touched, not just a
// suspended flag. See deletion.ts's deleteActor.
export function deleteAdminUser(localUserId: string) {
  return apiFetch<void>(`/admin/users/${encodeURIComponent(localUserId)}`, { method: "DELETE" });
}

export function adminDeletePost(postId: string) {
  return apiFetch<void>(`/admin/posts/${encodeURIComponent(postId)}`, { method: "DELETE" });
}

export function adminDeleteComment(commentId: string) {
  return apiFetch<void>(`/admin/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
}

// Files a report against a post/comment/actor — routes/reports.ts.
// Delivers a real ActivityPub Flag when the target is remote.
export function fileReport(input: { targetType: "post" | "comment" | "actor"; targetId: string; reason: string }) {
  return apiFetch<{ reported: true }>("/reports", { method: "POST", body: JSON.stringify(input) });
}

// GET /admin/server-health — the Host dashboard's at-a-glance operational
// panel (routes/admin.ts). Every numeric field can be null on its own if
// that one sub-check failed (e.g. `du`/`df` unavailable) without taking
// down the rest of the panel.
export interface ServerHealth {
  active: boolean;
  uptimeSeconds: number;
  // Null only if the heartbeat row genuinely doesn't exist yet (a request
  // that races the very first startup write) — in practice always set.
  // A gap since the last heartbeat past heartbeat.ts's own threshold is
  // what advances this; a routine deploy restart does not, unlike
  // uptimeSeconds (which resets on every restart, planned or not).
  lastDowntimeAt: string | null;
  database: { connected: boolean; sizeBytes: number | null };
  uploads: { sizeBytes: number | null };
  usedByInstanceBytes: number | null;
  disk: { totalBytes: number; usedBytes: number; availableBytes: number } | null;
}

export function getServerHealth() {
  return apiFetch<ServerHealth>("/admin/server-health");
}

export interface AdminReport {
  id: string;
  reason: string;
  status: "open" | "resolved";
  createdAt: string;
  reporter: ActorSummary & { id: string };
  target: ActorSummary & { id: string };
  post: { id: string; title: string | null; body: string | null } | null;
  comment: { id: string; body: string } | null;
}

export function getAdminReports() {
  return apiFetch<AdminReport[]>("/admin/reports");
}

export function resolveAdminReport(reportId: string) {
  return apiFetch<void>(`/admin/reports/${encodeURIComponent(reportId)}/resolve`, { method: "POST" });
}

// Relay subscriptions — routes/admin.ts. A relay is followed by this
// instance's own system actor, not any one person; once accepted, it
// starts pushing Announce activities for public posts from all its
// subscribers, visible under GET /feed's federated scope.
export interface AdminRelay {
  actorId: string;
  username: string;
  domain: string;
  state: "pending" | "accepted";
  createdAt: string;
}

export function getAdminRelays() {
  return apiFetch<AdminRelay[]>("/admin/relays");
}

export function addAdminRelay(actorUrl: string) {
  return apiFetch<{ state: "pending" | "accepted" }>("/admin/relays", {
    method: "POST",
    body: JSON.stringify({ actorUrl }),
  });
}

// Instant lookup of real, live relay servers to subscribe to — sourced
// server-side from Fediverse Observer's public directory
// (federation/relayDirectory.ts), not this instance's own data.
export interface RelayDirectoryEntry {
  domain: string;
  name: string | null;
  softwareName: string;
  actorUrl: string;
}

export function getRelayDirectory(q: string) {
  return apiFetch<RelayDirectoryEntry[]>(`/admin/relay-directory?q=${encodeURIComponent(q)}`);
}

export function removeAdminRelay(actorId: string) {
  return apiFetch<void>(`/admin/relays/${encodeURIComponent(actorId)}`, { method: "DELETE" });
}

// Instance-level moderation's real lever — defederating a whole remote
// server, not just one Actor (blockHandle/getBlockedActors above are
// per-user). See routes/inbox.ts, federation/remoteActor.ts, and
// federation/deliver.ts for the enforcement points this drives; it
// doesn't retroactively purge already-cached content from that domain.
export interface DomainBlock {
  id: string;
  domain: string;
  reason: string | null;
  createdAt: string;
}

export function getDomainBlocks() {
  return apiFetch<DomainBlock[]>("/admin/domain-blocks");
}

export function addDomainBlock(domain: string, reason?: string) {
  return apiFetch<DomainBlock>("/admin/domain-blocks", {
    method: "POST",
    body: JSON.stringify({ domain, reason }),
  });
}

export function removeDomainBlock(domain: string) {
  return apiFetch<void>(`/admin/domain-blocks/${encodeURIComponent(domain)}`, { method: "DELETE" });
}

// Host-curated list of remote servers regular users can browse
// trending/public content from (see routes/explore.ts) — not
// ActivityPub federation, a live read of each server's own
// Mastodon-API-compatible REST endpoint.
export interface ExploreServer {
  id: string;
  domain: string;
  name: string | null;
  createdAt: string;
  // True once Connect via OAuth has completed for this server — for
  // servers whose public timeline needed a logged-in user, not just a
  // publicly reachable one. Never the token itself, see
  // routes/admin.ts's EXPLORE_SERVER_SELECT.
  connected: boolean;
}

export function getAdminExploreServers() {
  return apiFetch<ExploreServer[]>("/admin/explore-servers");
}

export function addAdminExploreServer(domain: string, name?: string) {
  return apiFetch<ExploreServer>("/admin/explore-servers", {
    method: "POST",
    body: JSON.stringify({ domain, name }),
  });
}

export function removeAdminExploreServer(domain: string) {
  return apiFetch<void>(`/admin/explore-servers/${encodeURIComponent(domain)}`, { method: "DELETE" });
}

// Starts the OAuth2 Authorization Code flow against a server whose
// public timeline requires a logged-in user (e.g. Pixelfed 0.12+).
// Navigate the browser to the returned authorizeUrl (a full-page
// redirect, not a fetch) so the admin can log into that server and
// authorize Gibrr; it redirects back to /admin once done.
export function startExploreServerOAuth(domain: string, name?: string) {
  return apiFetch<{ authorizeUrl: string }>(`/admin/explore-servers/${encodeURIComponent(domain)}/oauth/start`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function getExploreServers() {
  return apiFetch<(ExploreServer & { subscribed: boolean })[]>("/explore/servers");
}

// Subscribing opts a server's trending timeline into background
// polling (federation/exploreSweep.ts) — from then on its posts merge
// into the viewer's own GET /feed, same as a boost from someone you
// follow. Unlike just visiting Explore (a live, uncached read), this
// is what makes it "yours" going forward.
export function subscribeToExploreServer(domain: string) {
  return apiFetch<{ subscribed: true }>(`/explore/${encodeURIComponent(domain)}/subscribe`, {
    method: "POST",
  });
}

export function unsubscribeFromExploreServer(domain: string) {
  return apiFetch<void>(`/explore/${encodeURIComponent(domain)}/subscribe`, { method: "DELETE" });
}

export interface ExploreStatus {
  url: string;
  author: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  contentText: string;
  createdAt: string;
}

export function getExploreTimeline(domain: string) {
  return apiFetch<ExploreStatus[]>(`/explore/${encodeURIComponent(domain)}/timeline`);
}

// A live, aggregated video feed across every Host-curated server
// detected as Loops software — app/loops/page.tsx's TikTok-style
// scrollable view. Each item is a real, already-resolved Post (full
// vote/boost/bookmark state included), not a raw preview like
// getExploreTimeline.
export function getLoopsFeed() {
  return apiFetch<{ posts: Post[] }>("/explore/loops/feed");
}

// Fediverse discovery links — routes/directoryLinks.ts. Public read
// (no auth); add/remove require admin.
export function getDirectoryLinks() {
  return apiFetch<FediverseDirectoryLink[]>("/directory-links");
}

export function addDirectoryLink(input: {
  name: string;
  url: string;
  description: string;
  category: "people" | "servers" | "developer";
}) {
  return apiFetch<FediverseDirectoryLink>("/directory-links", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function removeDirectoryLink(id: string) {
  return apiFetch<void>(`/directory-links/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export { ApiError };
