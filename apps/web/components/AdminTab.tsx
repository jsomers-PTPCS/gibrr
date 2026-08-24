"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  getMe,
  getServerHealth,
  getAdminUsers,
  suspendUser,
  unsuspendUser,
  deleteAdminUser,
  getAdminReports,
  resolveAdminReport,
  getAdminRelays,
  addAdminRelay,
  removeAdminRelay,
  getRelayDirectory,
  getDirectoryLinks,
  addDirectoryLink,
  removeDirectoryLink,
  getCustomEmoji,
  addCustomEmoji,
  removeCustomEmoji,
  getDomainBlocks,
  addDomainBlock,
  removeDomainBlock,
  getAdminExploreServers,
  addAdminExploreServer,
  removeAdminExploreServer,
  startExploreServerOAuth,
  getFediDbSyncStatus,
  setFediDbSyncSettings,
  runFediDbSyncNow,
  API_URL,
  ApiError,
  type Me,
  type ServerHealth,
  type AdminUserSummary,
  type AdminReport,
  type AdminRelay,
  type RelayDirectoryEntry,
  type CustomEmoji,
  type DomainBlock,
  type ExploreServer,
  type FediDbSyncStatus,
} from "../lib/api";
import { Avatar } from "./Avatar";
import { DiskUsageMeter } from "./DiskUsageMeter";
import { dedupeDirectoriesByUrl, type FediverseDirectoryLink } from "../lib/fediverseDirectories";
import { useConfirm } from "./ConfirmDialog";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function secondsSince(isoTimestamp: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000));
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Instance-admin dashboard — separate from any per-community management
// (that lives on the group page itself). Server-side requireAdmin
// (routes/admin.ts) is the actual security boundary; the me.isAdmin check
// here is just UX so a non-admin doesn't see a page full of 403s. Lives
// as the Settings page's "Host" tab (app/settings/page.tsx) rather than
// its own route — still does its own getMe()/redirect rather than
// trusting the parent, so a direct `?tab=host` URL from a non-admin
// still gets kicked out instead of rendering.
export function AdminTab() {
  const router = useRouter();
  const confirm = useConfirm();
  const [me, setMe] = useState<Me | null | "loading">("loading");
  const [serverHealth, setServerHealth] = useState<ServerHealth | "loading" | "error">("loading");
  const [users, setUsers] = useState<AdminUserSummary[] | "loading" | "error">("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reports, setReports] = useState<AdminReport[] | "loading" | "error">("loading");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [relays, setRelays] = useState<AdminRelay[] | "loading" | "error">("loading");
  const [relayUrl, setRelayUrl] = useState("");
  const [addingRelay, setAddingRelay] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [removingRelayId, setRemovingRelayId] = useState<string | null>(null);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [relayDirectory, setRelayDirectory] = useState<RelayDirectoryEntry[] | "loading">([]);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [subscribingDomain, setSubscribingDomain] = useState<string | null>(null);
  const [subscribingAll, setSubscribingAll] = useState(false);
  const [directoryLinks, setDirectoryLinks] = useState<FediverseDirectoryLink[] | "loading" | "error">("loading");
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkDescription, setLinkDescription] = useState("");
  const [linkCategory, setLinkCategory] = useState<"people" | "servers" | "developer">("people");
  const [addingLink, setAddingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [removingLinkId, setRemovingLinkId] = useState<string | null>(null);
  const [customEmoji, setCustomEmoji] = useState<CustomEmoji[] | "loading" | "error">("loading");
  const [emojiShortcode, setEmojiShortcode] = useState("");
  const [emojiFile, setEmojiFile] = useState<File | null>(null);
  const [addingEmoji, setAddingEmoji] = useState(false);
  const [emojiError, setEmojiError] = useState<string | null>(null);
  const [removingEmojiId, setRemovingEmojiId] = useState<string | null>(null);
  const [domainBlocks, setDomainBlocks] = useState<DomainBlock[] | "loading" | "error">("loading");
  const [blockDomain, setBlockDomain] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [addingBlock, setAddingBlock] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [removingBlockDomain, setRemovingBlockDomain] = useState<string | null>(null);
  const [exploreServers, setExploreServers] = useState<ExploreServer[] | "loading" | "error">("loading");
  const [exploreDomain, setExploreDomain] = useState("");
  const [exploreName, setExploreName] = useState("");
  const [addingExploreServer, setAddingExploreServer] = useState(false);
  const [connectingExploreOAuth, setConnectingExploreOAuth] = useState(false);
  const [exploreServerError, setExploreServerError] = useState<string | null>(null);
  const [removingExploreDomain, setRemovingExploreDomain] = useState<string | null>(null);
  const [exploreOauthNotice, setExploreOauthNotice] = useState<{ success: boolean; domain?: string } | null>(null);
  const [fediDbSync, setFediDbSync] = useState<FediDbSyncStatus | "loading" | "error">("loading");
  const [fediDbEnabled, setFediDbEnabled] = useState(false);
  const [fediDbMinUserCount, setFediDbMinUserCount] = useState(10_000);
  const [savingFediDbSync, setSavingFediDbSync] = useState(false);
  const [runningFediDbSync, setRunningFediDbSync] = useState(false);
  const [fediDbSyncError, setFediDbSyncError] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => {
        router.replace("/login");
      });
  }, [router]);

  useEffect(() => {
    if (me === "loading") return;
    if (!me?.isAdmin) {
      router.replace("/");
      return;
    }
    getServerHealth()
      .then(setServerHealth)
      .catch(() => setServerHealth("error"));
    getAdminUsers()
      .then(setUsers)
      .catch(() => setUsers("error"));
    getAdminReports()
      .then(setReports)
      .catch(() => setReports("error"));
    refreshRelays();
    refreshDirectoryLinks();
    refreshCustomEmoji();
    refreshDomainBlocks();
    refreshExploreServers();
    refreshFediDbSync();
  }, [me, router]);

  function refreshDomainBlocks() {
    getDomainBlocks()
      .then(setDomainBlocks)
      .catch(() => setDomainBlocks("error"));
  }

  function refreshExploreServers() {
    getAdminExploreServers()
      .then(setExploreServers)
      .catch(() => setExploreServers("error"));
  }

  function refreshFediDbSync() {
    getFediDbSyncStatus()
      .then((status) => {
        setFediDbSync(status);
        setFediDbEnabled(status.enabled);
        setFediDbMinUserCount(status.minUserCount);
      })
      .catch(() => setFediDbSync("error"));
  }

  async function handleSaveFediDbSync(e: FormEvent) {
    e.preventDefault();
    setSavingFediDbSync(true);
    setFediDbSyncError(null);
    try {
      const status = await setFediDbSyncSettings(fediDbEnabled, fediDbMinUserCount);
      setFediDbSync(status);
    } catch {
      setFediDbSyncError("Could not save those settings.");
    } finally {
      setSavingFediDbSync(false);
    }
  }

  // Saves first (so "Sync now" always reflects whatever's currently
  // typed, not just whatever was last explicitly saved) then triggers
  // an immediate run — fire-and-forget on the API side (202), so this
  // just re-fetches status a moment later rather than waiting for the
  // sync (which can take a while: FediDB has a lot of servers, and
  // every new one gets a live verification probe) to actually finish.
  async function handleRunFediDbSyncNow() {
    setRunningFediDbSync(true);
    setFediDbSyncError(null);
    try {
      await setFediDbSyncSettings(fediDbEnabled, fediDbMinUserCount);
      await runFediDbSyncNow();
    } catch {
      setFediDbSyncError("Could not start a sync.");
    } finally {
      setRunningFediDbSync(false);
    }
  }

  // The API's OAuth callback (routes/admin.ts) redirects here with
  // ?exploreOauth=success|error&domain=... once Connect via OAuth
  // finishes — read via window.location rather than useSearchParams so
  // this page doesn't need a Suspense boundary just for this.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("exploreOauth");
    if (!result) return;
    setExploreOauthNotice({ success: result === "success", domain: params.get("domain") ?? undefined });
    refreshExploreServers();
    router.replace("/settings?tab=host");
  }, [router]);

  function explorAddErrorMessage(err: unknown, fallback = "could not add that server"): string {
    if (!(err instanceof ApiError)) return fallback;
    if (typeof err.body !== "object" || !err.body || !("error" in err.body)) {
      return JSON.stringify(err.body);
    }
    const errorValue = (err.body as { error: unknown }).error;
    // Usually a plain string, but a failed Zod validation (e.g. a
    // domain that doesn't even look like one) comes back as its
    // .flatten() shape instead — an object, which String(...) would
    // otherwise stringify as the useless literal "[object Object]".
    if (typeof errorValue === "string") return errorValue;
    if (typeof errorValue === "object" && errorValue) {
      const fieldErrors = (errorValue as { fieldErrors?: Record<string, string[]> }).fieldErrors;
      const firstFieldError = fieldErrors && Object.values(fieldErrors).flat()[0];
      if (firstFieldError) return firstFieldError;
    }
    return JSON.stringify(errorValue);
  }

  // A bare ASCII domain is all the API accepts, but a server list
  // copied from somewhere (a fediverse directory site, a friend's
  // message) is usually full real links, sometimes to a domain in its
  // native script — strip a leading scheme/path so pasting
  // "https://mastodon.social/" works the same as typing
  // "mastodon.social" directly, and route through URL's own host
  // parsing to punycode-encode anything non-ASCII (confirmed live:
  // "ratatöskr.de" -> "xn--ratatskr-r4a.de", "嘟文.com" ->
  // "xn--j5r817a.com", even an emoji domain) the same way a browser's
  // address bar would — the backend's domain-shape check is ASCII-only,
  // so real internationalized fediverse domains would otherwise fail
  // validation outright instead of just being added under their real
  // wire-format name.
  function normalizeDomainInput(raw: string): string {
    const stripped = raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    if (!stripped) return "";
    try {
      return new URL(`https://${stripped}`).host;
    } catch {
      return stripped;
    }
  }

  // Accepts a comma-separated list so adding a batch of servers doesn't
  // mean submitting the form once per domain — the optional display
  // name only makes sense for a single domain at a time (there's no
  // sensible way to apply one name across several different servers),
  // so it's dropped whenever more than one is given. Domains are added
  // in parallel and independently: one bad domain in the list shouldn't
  // block the rest from succeeding, so failures are collected and shown
  // together rather than aborting on the first one.
  async function handleAddExploreServer(e: FormEvent) {
    e.preventDefault();
    const domains = [...new Set(exploreDomain.split(",").map(normalizeDomainInput).filter(Boolean))];
    if (domains.length === 0) return;
    setAddingExploreServer(true);
    setExploreServerError(null);
    try {
      const results = await Promise.allSettled(
        domains.map((domain) => addAdminExploreServer(domain, domains.length === 1 ? exploreName.trim() || undefined : undefined)),
      );
      const failures = results
        .map((result, i) => (result.status === "rejected" ? `${domains[i]}: ${explorAddErrorMessage(result.reason)}` : null))
        .filter((message): message is string => message !== null);
      if (failures.length > 0) {
        setExploreServerError(failures.join(" · "));
      } else {
        setExploreDomain("");
        setExploreName("");
      }
      refreshExploreServers();
    } finally {
      setAddingExploreServer(false);
    }
  }

  // Full-page navigation to the remote server's own login/consent
  // screen — for servers like Pixelfed whose public timeline requires
  // a logged-in user, not just a publicly reachable one. Redirects back
  // to /admin (handled by the effect above) once the admin authorizes.
  // Inherently single-target (there's one login screen to send the
  // admin to), unlike "Add server" — the button calling this is
  // disabled whenever the domain field holds more than one domain.
  async function connectServerOAuth(domain: string, name?: string) {
    setConnectingExploreOAuth(true);
    setExploreServerError(null);
    try {
      const { authorizeUrl } = await startExploreServerOAuth(domain, name);
      window.location.href = authorizeUrl;
    } catch (err) {
      setExploreServerError(explorAddErrorMessage(err, "could not start that connection"));
      setConnectingExploreOAuth(false);
    }
  }

  function handleConnectExploreServerOAuth() {
    if (exploreDomain.includes(",")) return;
    const domain = normalizeDomainInput(exploreDomain);
    if (!domain) return;
    connectServerOAuth(domain, exploreName.trim() || undefined);
  }

  async function handleRemoveExploreServer(server: ExploreServer) {
    if (!(await confirm(`Remove ${server.name || server.domain} from Explore?`))) return;
    setRemovingExploreDomain(server.domain);
    try {
      await removeAdminExploreServer(server.domain);
      setExploreServers((prev) => (Array.isArray(prev) ? prev.filter((s) => s.domain !== server.domain) : prev));
    } finally {
      setRemovingExploreDomain(null);
    }
  }

  async function handleAddDomainBlock(e: FormEvent) {
    e.preventDefault();
    if (!blockDomain.trim()) return;
    setAddingBlock(true);
    setBlockError(null);
    try {
      await addDomainBlock(blockDomain.trim(), blockReason.trim() || undefined);
      setBlockDomain("");
      setBlockReason("");
      refreshDomainBlocks();
    } catch (err) {
      setBlockError(
        err instanceof ApiError
          ? typeof err.body === "object" && err.body && "error" in err.body
            ? String((err.body as { error: unknown }).error)
            : JSON.stringify(err.body)
          : "could not block that domain",
      );
    } finally {
      setAddingBlock(false);
    }
  }

  async function handleRemoveDomainBlock(block: DomainBlock) {
    if (!(await confirm(`Unblock ${block.domain}? Federation with this domain resumes immediately.`))) return;
    setRemovingBlockDomain(block.domain);
    try {
      await removeDomainBlock(block.domain);
      setDomainBlocks((prev) => (Array.isArray(prev) ? prev.filter((b) => b.domain !== block.domain) : prev));
    } finally {
      setRemovingBlockDomain(null);
    }
  }

  function refreshRelays() {
    getAdminRelays()
      .then(setRelays)
      .catch(() => setRelays("error"));
  }

  function refreshDirectoryLinks() {
    getDirectoryLinks()
      .then(setDirectoryLinks)
      .catch(() => setDirectoryLinks("error"));
  }

  function refreshCustomEmoji() {
    getCustomEmoji()
      .then(setCustomEmoji)
      .catch(() => setCustomEmoji("error"));
  }

  async function handleAddCustomEmoji(e: FormEvent) {
    e.preventDefault();
    if (!emojiShortcode.trim() || !emojiFile) return;
    setAddingEmoji(true);
    setEmojiError(null);
    try {
      await addCustomEmoji(emojiShortcode.trim(), emojiFile);
      setEmojiShortcode("");
      setEmojiFile(null);
      refreshCustomEmoji();
    } catch (err) {
      setEmojiError(err instanceof ApiError ? JSON.stringify(err.body) : "could not add that emoji");
    } finally {
      setAddingEmoji(false);
    }
  }

  async function handleRemoveCustomEmoji(emoji: CustomEmoji) {
    if (!(await confirm(`Delete the :${emoji.shortcode}: emoji? Existing reactions using it will show a broken shortcode.`))) return;
    setRemovingEmojiId(emoji.id);
    try {
      await removeCustomEmoji(emoji.id);
      setCustomEmoji((prev) => (Array.isArray(prev) ? prev.filter((e) => e.id !== emoji.id) : prev));
    } finally {
      setRemovingEmojiId(null);
    }
  }

  async function handleAddDirectoryLink(e: FormEvent) {
    e.preventDefault();
    if (!linkName.trim() || !linkUrl.trim() || !linkDescription.trim()) return;
    setAddingLink(true);
    setLinkError(null);
    try {
      await addDirectoryLink({
        name: linkName.trim(),
        url: linkUrl.trim(),
        description: linkDescription.trim(),
        category: linkCategory,
      });
      setLinkName("");
      setLinkUrl("");
      setLinkDescription("");
      refreshDirectoryLinks();
    } catch (err) {
      setLinkError(
        err instanceof ApiError
          ? typeof err.body === "object" && err.body && "error" in err.body
            ? String((err.body as { error: unknown }).error)
            : JSON.stringify(err.body)
          : "could not add that link",
      );
    } finally {
      setAddingLink(false);
    }
  }

  async function handleRemoveDirectoryLink(link: FediverseDirectoryLink) {
    if (!(await confirm(`Remove the "${link.name}" directory link?`))) return;
    setRemovingLinkId(link.id);
    try {
      await removeDirectoryLink(link.id);
      setDirectoryLinks((prev) => (Array.isArray(prev) ? prev.filter((l) => l.id !== link.id) : prev));
    } finally {
      setRemovingLinkId(null);
    }
  }

  async function handleAddRelay(e: FormEvent) {
    e.preventDefault();
    if (!relayUrl.trim()) return;
    setAddingRelay(true);
    setRelayError(null);
    try {
      await addAdminRelay(relayUrl.trim());
      setRelayUrl("");
      refreshRelays();
    } catch (err) {
      setRelayError(err instanceof ApiError ? JSON.stringify(err.body) : "could not add that relay");
    } finally {
      setAddingRelay(false);
    }
  }

  async function handleRemoveRelay(relay: AdminRelay) {
    if (!(await confirm(`Unsubscribe from ${relay.username}@${relay.domain}?`))) return;
    setRemovingRelayId(relay.actorId);
    try {
      await removeAdminRelay(relay.actorId);
      setRelays((prev) => (Array.isArray(prev) ? prev.filter((r) => r.actorId !== relay.actorId) : prev));
    } finally {
      setRemovingRelayId(null);
    }
  }

  // Live-filters as you type, debounced — backed by a real external
  // directory (federation/relayDirectory.ts), not a fuzzy suggestions
  // index Gibrr itself maintains.
  useEffect(() => {
    if (me === "loading" || !me?.isAdmin) return;
    setRelayDirectory("loading");
    const timer = setTimeout(() => {
      getRelayDirectory(directoryQuery.trim())
        .then(setRelayDirectory)
        .catch(() => setRelayDirectory([]));
    }, 400);
    return () => clearTimeout(timer);
  }, [directoryQuery, me]);

  async function handleSubscribeFromDirectory(entry: RelayDirectoryEntry) {
    setSubscribingDomain(entry.domain);
    setRelayError(null);
    try {
      await addAdminRelay(entry.actorUrl);
      refreshRelays();
    } catch (err) {
      setRelayError(err instanceof ApiError ? JSON.stringify(err.body) : "could not subscribe to that relay");
    } finally {
      setSubscribingDomain(null);
    }
  }

  // Subscribes to every not-yet-subscribed entry currently shown (the
  // directory's own blank-query default, unfiltered, or whatever the
  // search narrowed it to) — best-effort, one relay being unreachable
  // shouldn't stop the rest from going through.
  async function handleSubscribeAllFromDirectory() {
    if (!Array.isArray(relayDirectory)) return;
    const toSubscribe = relayDirectory.filter(
      (entry) => !(Array.isArray(relays) && relays.some((r) => r.domain === entry.domain)),
    );
    if (toSubscribe.length === 0) return;

    setSubscribingAll(true);
    setRelayError(null);
    try {
      const results = await Promise.allSettled(toSubscribe.map((entry) => addAdminRelay(entry.actorUrl)));
      const failures = results.filter((r) => r.status === "rejected").length;
      if (failures > 0) {
        setRelayError(`subscribed to ${results.length - failures} of ${results.length} — ${failures} failed`);
      }
      refreshRelays();
    } finally {
      setSubscribingAll(false);
    }
  }

  async function handleResolveReport(report: AdminReport) {
    setResolvingId(report.id);
    try {
      await resolveAdminReport(report.id);
      setReports((prev) =>
        Array.isArray(prev) ? prev.map((r) => (r.id === report.id ? { ...r, status: "resolved" } : r)) : prev,
      );
    } finally {
      setResolvingId(null);
    }
  }

  async function handleToggleSuspend(user: AdminUserSummary) {
    setBusyId(user.id);
    try {
      if (user.suspended) {
        await unsuspendUser(user.id);
      } else {
        await suspendUser(user.id);
      }
      setUsers((prev) =>
        Array.isArray(prev)
          ? prev.map((u) => (u.id === user.id ? { ...u, suspended: !u.suspended } : u))
          : prev,
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteUser(user: AdminUserSummary) {
    const name = user.actor.displayName ?? user.actor.username;
    const ok = await confirm(
      `Permanently delete @${name}'s account? This removes their posts, comments, messages, and all other data. This can't be undone.`,
    );
    if (!ok) return;
    setBusyId(user.id);
    try {
      await deleteAdminUser(user.id);
      setUsers((prev) => (Array.isArray(prev) ? prev.filter((u) => u.id !== user.id) : prev));
    } finally {
      setBusyId(null);
    }
  }

  if (me === "loading" || !me?.isAdmin) return <p className="text-dim">Loading…</p>;

  return (
    <>
      <p className="text-faint" style={{ marginTop: 0 }}>
        Room-wide account management.
      </p>

      <div className="card">
        {users === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : users === "error" ? (
          <p className="error-text">Could not load users.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {users.map((user) => {
              const name = user.actor.displayName ?? user.actor.username;
              const isSelf = user.email === me.email;
              return (
                <div
                  key={user.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.6rem 0.25rem",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <Avatar name={name} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <strong>{name}</strong>
                      {user.isAdmin && <span className="pill">host</span>}
                      {user.suspended && <span className="pill">suspended</span>}
                    </div>
                    <p className="text-faint" style={{ margin: "0.1rem 0 0" }}>
                      {user.email} · joined {new Date(user.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  {!isSelf && (
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <button
                        className="btn btn-ghost"
                        disabled={busyId === user.id}
                        onClick={() => handleToggleSuspend(user)}
                      >
                        {user.suspended ? "Unsuspend" : "Suspend"}
                      </button>
                      <button
                        className="btn btn-ghost"
                        disabled={busyId === user.id}
                        onClick={() => handleDeleteUser(user)}
                        style={{ color: "var(--danger)" }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <h2 style={{ marginTop: "1.5rem" }}>Server health</h2>
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        {serverHealth === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : serverHealth === "error" ? (
          <p className="error-text">Could not load server health.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {serverHealth.active ? (
                  <span className="pill" style={{ background: "var(--primary)", borderColor: "var(--primary)", color: "#fff" }}>
                    Active
                  </span>
                ) : (
                  <span className="pill" style={{ color: "var(--danger)" }}>
                    Degraded — database unreachable
                  </span>
                )}
                <span className="text-faint">up {formatUptime(serverHealth.uptimeSeconds)}</span>
              </div>
              {serverHealth.lastDowntimeAt && (
                <span className="text-faint">
                  {formatUptime(secondsSince(serverHealth.lastDowntimeAt))} since last downtime
                </span>
              )}
            </div>

            {serverHealth.disk && (
              <DiskUsageMeter
                totalBytes={serverHealth.disk.totalBytes}
                usedBytes={serverHealth.disk.usedBytes}
                instanceBytes={serverHealth.usedByInstanceBytes ?? 0}
              />
            )}

            <p className="text-faint" style={{ margin: 0, fontSize: "0.85rem" }}>
              Database {formatBytes(serverHealth.database.sizeBytes)} · Uploads{" "}
              {formatBytes(serverHealth.uploads.sizeBytes)}
            </p>
          </div>
        )}
      </div>

      <h2 style={{ marginTop: "1.5rem" }}>Flags</h2>
      <p className="text-faint">
        Filed locally, or received as an ActivityPub Flag from another room — same queue either way.
      </p>
      <div className="card">
        {reports === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : reports === "error" ? (
          <p className="error-text">Could not load flags.</p>
        ) : reports.length === 0 ? (
          <p className="text-dim">No flags.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {reports.map((report) => (
              <div
                key={report.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  padding: "0.6rem 0.25rem",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <strong>{report.target.displayName ?? report.target.username}</strong>
                    <span className="pill">{report.status}</span>
                  </div>
                  <p className="text-faint" style={{ margin: "0.1rem 0 0" }}>
                    Flagged by {report.reporter.displayName ?? report.reporter.username}@{report.reporter.domain}
                    {" · "}
                    {new Date(report.createdAt).toLocaleString()}
                  </p>
                  <p style={{ margin: "0.3rem 0 0" }}>{report.reason}</p>
                  {report.post && (
                    <p className="text-faint" style={{ margin: "0.2rem 0 0" }}>
                      Gib: {report.post.title ?? report.post.body?.slice(0, 80) ?? "(no content)"}
                    </p>
                  )}
                  {report.comment && (
                    <p className="text-faint" style={{ margin: "0.2rem 0 0" }}>
                      Chatter: {report.comment.body.slice(0, 80)}
                    </p>
                  )}
                </div>
                {report.status === "open" && (
                  <button
                    className="btn btn-ghost"
                    disabled={resolvingId === report.id}
                    onClick={() => handleResolveReport(report)}
                  >
                    Resolve
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 style={{ marginTop: "1.5rem" }}>Relays</h2>
      <p className="text-faint">
        Subscribe to a relay to see public Gibs from all its other subscribers under the
        Conversations page&apos;s Federated tab — not just from people this room is listening to directly.
      </p>
      <div className="card">
        <p className="text-faint" style={{ marginTop: 0 }}>
          Real, live relay servers (sourced from Fediverse Observer&apos;s public directory) —
          focus the box below for suggestions with no need to type, narrow them by domain, or
          paste an actor URL directly further down.
        </p>
        <div style={{ position: "relative", marginBottom: "0.75rem" }}>
          <input
            className="input"
            style={{ width: "100%" }}
            value={directoryQuery}
            onChange={(e) => {
              setDirectoryQuery(e.target.value);
              setDirectoryOpen(true);
            }}
            onFocus={() => setDirectoryOpen(true)}
            placeholder="Search relay servers by domain…"
          />

          {directoryOpen && (
            <>
              <div
                onClick={() => setDirectoryOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 20 }}
              />
              <div
                className="card"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  marginTop: "0.3rem",
                  zIndex: 21,
                  maxHeight: 320,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.4rem",
                }}
              >
                {Array.isArray(relayDirectory) && relayDirectory.length > 0 && (
                  <button
                    className="btn btn-ghost"
                    disabled={
                      subscribingAll ||
                      relayDirectory.every(
                        (entry) => Array.isArray(relays) && relays.some((r) => r.domain === entry.domain),
                      )
                    }
                    onClick={handleSubscribeAllFromDirectory}
                  >
                    {subscribingAll ? "Subscribing…" : "Subscribe to all shown below"}
                  </button>
                )}
                {relayDirectory === "loading" ? (
                  <p className="text-dim" style={{ margin: 0 }}>
                    Searching…
                  </p>
                ) : relayDirectory.length === 0 ? (
                  <p className="text-dim" style={{ margin: 0 }}>
                    No relay servers found.
                  </p>
                ) : (
                  relayDirectory.map((entry) => {
                    const subscribed =
                      Array.isArray(relays) && relays.some((r) => r.domain === entry.domain);
                    return (
                      <div
                        key={entry.domain}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "0.75rem",
                          padding: "0.3rem 0.5rem",
                          background: "var(--surface-hover)",
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <strong>{entry.domain}</strong>
                          <span className="text-faint" style={{ marginLeft: "0.5rem", fontSize: "0.85rem" }}>
                            {entry.softwareName}
                          </span>
                        </div>
                        {subscribed ? (
                          <span className="text-faint">✓ Subscribed</span>
                        ) : (
                          <button
                            className="btn btn-ghost"
                            disabled={subscribingDomain === entry.domain}
                            onClick={() => handleSubscribeFromDirectory(entry)}
                          >
                            {subscribingDomain === entry.domain ? "…" : "Subscribe"}
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        <form onSubmit={handleAddRelay} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 0 }}
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
            placeholder="https://relay.example/actor"
          />
          <button type="submit" className="btn btn-primary" disabled={addingRelay}>
            {addingRelay ? "…" : "Subscribe"}
          </button>
        </form>
        {relayError && <p className="error-text">{relayError}</p>}

        {relays === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : relays === "error" ? (
          <p className="error-text">Could not load relays.</p>
        ) : relays.length === 0 ? (
          <p className="text-dim">Not subscribed to any relays.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {relays.map((relay) => (
              <div
                key={relay.actorId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  padding: "0.6rem 0.25rem",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div>
                  <strong>
                    {relay.username}@{relay.domain}
                  </strong>
                  <p className="text-faint" style={{ margin: "0.1rem 0 0" }}>
                    {relay.state === "accepted" ? "✓ Subscribed" : "Pending"} · since{" "}
                    {new Date(relay.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  className="btn btn-ghost"
                  disabled={removingRelayId === relay.actorId}
                  onClick={() => handleRemoveRelay(relay)}
                >
                  Unsubscribe
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 style={{ marginTop: "1.5rem" }}>Domain blocks</h2>
      <p className="text-faint">
        Defederate a whole remote server — incoming activities from it are rejected, nothing new is
        discovered from it, and nothing is delivered to it. Doesn't retroactively remove content
        already cached from that domain.
      </p>
      <div className="card">
        <form onSubmit={handleAddDomainBlock} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 0 }}
            value={blockDomain}
            onChange={(e) => setBlockDomain(e.target.value)}
            placeholder="example.social"
          />
          <input
            className="input"
            style={{ flex: 2, minWidth: 0 }}
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
            placeholder="Reason (optional)"
          />
          <button type="submit" className="btn btn-primary" disabled={addingBlock}>
            {addingBlock ? "…" : "Block domain"}
          </button>
        </form>
        {blockError && <p className="error-text">{blockError}</p>}

        {domainBlocks === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : domainBlocks === "error" ? (
          <p className="error-text">Could not load domain blocks.</p>
        ) : domainBlocks.length === 0 ? (
          <p className="text-dim">No domains blocked.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {domainBlocks.map((block) => (
              <div
                key={block.domain}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  padding: "0.6rem 0.25rem",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{block.domain}</strong>
                  {block.reason && (
                    <p className="text-faint" style={{ margin: "0.1rem 0 0" }}>
                      {block.reason}
                    </p>
                  )}
                </div>
                <button
                  className="btn btn-ghost"
                  disabled={removingBlockDomain === block.domain}
                  onClick={() => handleRemoveDomainBlock(block)}
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 style={{ marginTop: "1.5rem", display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
        Explore servers
        {Array.isArray(exploreServers) && (
          <span className="text-faint" style={{ fontSize: "0.9rem", fontWeight: 400 }}>
            {exploreServers.length} server{exploreServers.length === 1 ? "" : "s"}
          </span>
        )}
      </h2>
      <p className="text-faint">
        Servers users can browse trending/public content from under Explore — a live read of each
        server's own real public API, not federation. Mastodon, Pleroma/Akkoma, Misskey, Lemmy,
        PeerTube, Loops, Ghost, and Mobilizon all work with plain &quot;Add server&quot;. Pixelfed and
        Friendica lock their public API behind a login — use &quot;Connect via OAuth&quot; for those
        instead, which sends you to that server to log in and authorize Gibrr. Funkwhale works the
        same way as the rest, but its own strict signature checks mean it needs this instance to be
        reachable from the public internet — it won&apos;t succeed from a local/offline dev setup.
        A few platforms can&apos;t be added at all: Threads and BookWyrm expose no usable public API,
        and Diaspora doesn&apos;t speak ActivityPub.
      </p>
      <div className="card">
        {exploreOauthNotice && (
          <p className={exploreOauthNotice.success ? "text-dim" : "error-text"} style={{ marginTop: 0 }}>
            {exploreOauthNotice.success
              ? `Connected to ${exploreOauthNotice.domain ?? "that server"}.`
              : `Could not connect to ${exploreOauthNotice.domain ?? "that server"} — the authorization didn't complete.`}
          </p>
        )}
        <form
          onSubmit={handleAddExploreServer}
          style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}
        >
          <input
            className="input"
            style={{ flex: 1, minWidth: 0 }}
            value={exploreDomain}
            onChange={(e) => setExploreDomain(e.target.value)}
            placeholder="mastodon.social, pixelfed.social, …"
          />
          <input
            className="input"
            style={{ flex: 2, minWidth: 0 }}
            value={exploreName}
            onChange={(e) => setExploreName(e.target.value)}
            placeholder="Display name (optional, single server only)"
            disabled={exploreDomain.includes(",")}
          />
          <button type="submit" className="btn btn-primary" disabled={addingExploreServer}>
            {addingExploreServer ? "…" : "Add server"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={connectingExploreOAuth || exploreDomain.includes(",")}
            title={exploreDomain.includes(",") ? "OAuth connects one server at a time" : undefined}
            onClick={handleConnectExploreServerOAuth}
          >
            {connectingExploreOAuth ? "…" : "Connect via OAuth"}
          </button>
        </form>
        {exploreServerError && <p className="error-text">{exploreServerError}</p>}

        {exploreServers === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : exploreServers === "error" ? (
          <p className="error-text">Could not load explore servers.</p>
        ) : exploreServers.length === 0 ? (
          <p className="text-dim">No servers added yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {exploreServers.map((server) => (
              <div
                key={server.domain}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  padding: "0.6rem 0.25rem",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <strong>{server.name || server.domain}</strong>
                    {server.connected && <span className="pill">OAuth connected</span>}
                    {server.source === "fedidb" && <span className="pill">via FediDB</span>}
                  </div>
                  {server.name && (
                    <p className="text-faint" style={{ margin: "0.1rem 0 0" }}>
                      {server.domain}
                    </p>
                  )}
                </div>
                <button
                  className="btn btn-ghost"
                  disabled={removingExploreDomain === server.domain}
                  onClick={() => handleRemoveExploreServer(server)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 style={{ marginTop: "1.5rem" }}>FediDB auto-sync</h2>
      <p className="text-faint">
        Automatically add every server{" "}
        <a href="https://fedidb.org" target="_blank" rel="noreferrer">
          FediDB
        </a>{" "}
        knows about with at least this many users — new ones that cross the threshold get picked
        up on the next scheduled sync (every 24h) without you adding them by hand. Each candidate
        still gets the same live verification a manual Add server does, so ones that don&apos;t
        actually work (wrong software, offline) are skipped automatically.
      </p>
      <div className="card">
        {fediDbSync === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : fediDbSync === "error" ? (
          <p className="error-text">Could not load FediDB sync status.</p>
        ) : (
          <form onSubmit={handleSaveFediDbSync} style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={fediDbEnabled}
                onChange={(e) => setFediDbEnabled(e.target.checked)}
              />
              Enabled
            </label>
            <label className="field">
              Minimum user count
              <input
                className="input"
                type="number"
                min={0}
                value={fediDbMinUserCount}
                onChange={(e) => setFediDbMinUserCount(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            {fediDbSync.lastSyncAt && (
              <p className="text-faint" style={{ margin: 0 }}>
                Last synced {new Date(fediDbSync.lastSyncAt).toLocaleString()}
              </p>
            )}
            {fediDbSyncError && <p className="error-text">{fediDbSyncError}</p>}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="submit" className="btn btn-primary" disabled={savingFediDbSync}>
                {savingFediDbSync ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={runningFediDbSync}
                onClick={handleRunFediDbSyncNow}
              >
                {runningFediDbSync ? "Starting…" : "Sync now"}
              </button>
            </div>
          </form>
        )}
      </div>

      <h2 style={{ marginTop: "1.5rem" }}>Fediverse directory links</h2>
      <p className="text-faint">
        External discovery links shown on the Search page (people/servers) and here (developer) —
        there's no crawled index of the fediverse for Gibrr to query itself.
      </p>
      <div className="card">
        <form onSubmit={handleAddDirectoryLink} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 0 }}
              value={linkName}
              onChange={(e) => setLinkName(e.target.value)}
              placeholder="Name"
            />
            <select
              className="input"
              style={{ flexShrink: 0 }}
              value={linkCategory}
              onChange={(e) => setLinkCategory(e.target.value as "people" | "servers" | "developer")}
            >
              <option value="people">People</option>
              <option value="servers">Servers</option>
              <option value="developer">Developer</option>
            </select>
          </div>
          <input
            className="input"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://example.com/"
          />
          <input
            className="input"
            value={linkDescription}
            onChange={(e) => setLinkDescription(e.target.value)}
            placeholder="One-line description"
          />
          <button type="submit" className="btn btn-primary" disabled={addingLink} style={{ alignSelf: "flex-start" }}>
            {addingLink ? "…" : "Add link"}
          </button>
        </form>
        {linkError && <p className="error-text">{linkError}</p>}

        {directoryLinks === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : directoryLinks === "error" ? (
          <p className="error-text">Could not load directory links.</p>
        ) : directoryLinks.length === 0 ? (
          <p className="text-dim">No directory links yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {dedupeDirectoriesByUrl(directoryLinks).map((link) => (
              <div
                key={link.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  padding: "0.6rem 0.25rem",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <a href={link.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                      <strong>{link.name} ↗</strong>
                    </a>
                    <span className="pill">{link.category}</span>
                  </div>
                  <p className="text-faint" style={{ margin: "0.1rem 0 0" }}>
                    {link.description}
                  </p>
                </div>
                <button
                  className="btn btn-ghost"
                  disabled={removingLinkId === link.id}
                  onClick={() => handleRemoveDirectoryLink(link)}
                  style={{ color: "var(--danger)" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 style={{ marginTop: "1.5rem" }}>Custom emoji</h2>
      <p className="text-faint">Usable in the reaction picker on any Gib, alongside built-in unicode emoji.</p>
      <div className="card">
        <form
          onSubmit={handleAddCustomEmoji}
          style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}
        >
          <input
            className="input"
            style={{ flex: 1, minWidth: 0 }}
            value={emojiShortcode}
            onChange={(e) => setEmojiShortcode(e.target.value)}
            placeholder="shortcode (letters, numbers, underscore)"
          />
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setEmojiFile(e.target.files?.[0] ?? null)}
          />
          <button type="submit" className="btn btn-primary" disabled={addingEmoji}>
            {addingEmoji ? "…" : "Add emoji"}
          </button>
        </form>
        {emojiError && <p className="error-text">{emojiError}</p>}

        {customEmoji === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : customEmoji === "error" ? (
          <p className="error-text">Could not load custom emoji.</p>
        ) : customEmoji.length === 0 ? (
          <p className="text-dim">No custom emoji yet.</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {customEmoji.map((emoji) => (
              <div
                key={emoji.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.3rem",
                  padding: "0.5rem",
                  background: "var(--surface-hover)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${API_URL}${emoji.imageUrl}`}
                  alt={emoji.shortcode}
                  style={{ width: 32, height: 32, objectFit: "contain" }}
                />
                <span className="text-faint" style={{ fontSize: "0.75rem" }}>
                  :{emoji.shortcode}:
                </span>
                <button
                  className="btn btn-ghost"
                  disabled={removingEmojiId === emoji.id}
                  onClick={() => handleRemoveCustomEmoji(emoji)}
                  style={{ color: "var(--danger)", padding: "0.1rem 0.4rem", fontSize: "0.8rem" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

    </>
  );
}
