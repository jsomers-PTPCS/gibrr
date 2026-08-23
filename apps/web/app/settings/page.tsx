"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getTheme, setTheme, type Theme } from "../../lib/theme";
import {
  getMe,
  getProfile,
  updateProfile,
  uploadProfileImage,
  getExportLink,
  regenerateExportLink,
  getBlockedActors,
  unblockActor,
  resendVerification,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  ApiError,
  API_URL,
  type Me,
  type Profile,
  type BlockedActorSummary,
} from "../../lib/api";
import { PictureChooser } from "../../components/PictureChooser";
import { ColorSwatchPicker } from "../../components/ColorSwatchPicker";
import { EditProfileTab } from "../../components/EditProfileTab";
import { AdminTab } from "../../components/AdminTab";
import { FONT_PRESETS, FONT_PRESET_LABELS, type FontPresetKey } from "../../lib/fontPresets";
import {
  HEADER_PRESETS,
  BACKGROUND_PRESETS,
  AVATAR_PRESETS,
  type HeaderPresetKey,
  type BackgroundPresetKey,
  type AvatarPresetKey,
} from "../../lib/imagePresets";

function assetUrl(path: string) {
  return /^https?:\/\//.test(path) ? path : `${API_URL}${path}`;
}

const DEFAULT_COLOR = "#170f26";
const DEFAULT_TEXT_COLOR = "#f3eefc";

export default function SettingsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"account" | "profile" | "host">("account");

  // Lets a `?tab=profile`/`?tab=host` link (the profile page's "Edit
  // profile" button, the Nav dropdown's "Host" link) land directly on
  // that tab — same window-read pattern as the profile page's own
  // `?tab=bookwyrm` deep link, for the same reason: no
  // useSearchParams/Suspense boundary needed for one query param read
  // on mount.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "profile" || requested === "host") setTab(requested);
  }, []);

  const [theme, setThemeState] = useState<Theme>("dark");

  const [me, setMe] = useState<Me | null | "loading">("loading");
  const [profile, setProfile] = useState<Profile | "loading" | "error">("loading");

  const [backgroundColor, setBackgroundColor] = useState("");
  const [headerColor, setHeaderColor] = useState("");
  const [introBoxColor, setIntroBoxColor] = useState("");
  const [contentBoxColor, setContentBoxColor] = useState("");
  const [fontFamily, setFontFamily] = useState<FontPresetKey | "">("");
  const [fontColor, setFontColor] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // See app/g/[name]/page.tsx's identical savedSettingsSnapshot — same
  // "Saved" reverts to "Save" the moment any tracked field diverges
  // from what was last actually persisted.
  const [savedAppearanceSnapshot, setSavedAppearanceSnapshot] = useState<string | null>(null);
  const currentAppearanceSnapshot = JSON.stringify({
    backgroundColor,
    headerColor,
    introBoxColor,
    contentBoxColor,
    fontFamily,
    fontColor,
  });

  const [exportUrl, setExportUrl] = useState<string | null | "loading">("loading");
  const [exportBusy, setExportBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [blockedActors, setBlockedActors] = useState<BlockedActorSummary[] | "loading">("loading");
  const [unblockBusyId, setUnblockBusyId] = useState<string | null>(null);

  const [resendBusy, setResendBusy] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  // Two-factor enrollment is a short-lived wizard, not persisted state
  // — "setup" (QR code showing, not yet enforced) -> enter a code to
  // enable -> backup codes shown exactly once -> done. Disabling only
  // needs a password prompt, no wizard.
  const [twoFactorStep, setTwoFactorStep] = useState<
    "idle" | "setup" | "backup-codes" | "disable"
  >("idle");
  const [twoFactorSecret, setTwoFactorSecret] = useState("");
  const [twoFactorQr, setTwoFactorQr] = useState("");
  const [twoFactorToken, setTwoFactorToken] = useState("");
  const [twoFactorBackupCodes, setTwoFactorBackupCodes] = useState<string[]>([]);
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);

  async function handleResendVerification() {
    setResendBusy(true);
    try {
      await resendVerification();
      setResendSent(true);
    } finally {
      setResendBusy(false);
    }
  }

  useEffect(() => {
    setThemeState(getTheme());
    getMe()
      .then((m) => {
        setMe(m);
        if (!m) return;
        getProfile(m.actor.username)
          .then((p) => {
            setProfile(p);
            setBackgroundColor(p.actor.backgroundColor ?? "");
            setHeaderColor(p.actor.headerColor ?? "");
            setIntroBoxColor(p.actor.introBoxColor ?? "");
            setContentBoxColor(p.actor.contentBoxColor ?? "");
            setFontFamily(p.actor.fontFamily ?? "");
            setFontColor(p.actor.fontColor ?? "");
          })
          .catch(() => setProfile("error"));
        getExportLink()
          .then((r) => setExportUrl(r.url))
          .catch(() => setExportUrl(null));
        getBlockedActors()
          .then(setBlockedActors)
          .catch(() => setBlockedActors([]));
      })
      .catch(() => setMe(null));
  }, []);

  async function handleUnblock(actor: BlockedActorSummary) {
    setUnblockBusyId(actor.id);
    try {
      await unblockActor(actor.id);
      setBlockedActors((prev) => (Array.isArray(prev) ? prev.filter((a) => a.id !== actor.id) : prev));
    } finally {
      setUnblockBusyId(null);
    }
  }

  async function handleStartTwoFactorSetup() {
    setTwoFactorError(null);
    setTwoFactorBusy(true);
    try {
      const { secret, qrCodeDataUrl } = await setupTwoFactor();
      setTwoFactorSecret(secret);
      setTwoFactorQr(qrCodeDataUrl);
      setTwoFactorToken("");
      setTwoFactorStep("setup");
    } catch {
      setTwoFactorError("could not start two-factor setup");
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function handleEnableTwoFactor(e: FormEvent) {
    e.preventDefault();
    setTwoFactorError(null);
    setTwoFactorBusy(true);
    try {
      const { backupCodes } = await enableTwoFactor(twoFactorToken.trim());
      setTwoFactorBackupCodes(backupCodes);
      setTwoFactorStep("backup-codes");
      setMe((prev) => (prev && prev !== "loading" ? { ...prev, twoFactorEnabled: true } : prev));
    } catch {
      setTwoFactorError("invalid code — check your authenticator app and try again");
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function handleDisableTwoFactor(e: FormEvent) {
    e.preventDefault();
    setTwoFactorError(null);
    setTwoFactorBusy(true);
    try {
      await disableTwoFactor(twoFactorPassword);
      setTwoFactorPassword("");
      setTwoFactorStep("idle");
      setMe((prev) => (prev && prev !== "loading" ? { ...prev, twoFactorEnabled: false } : prev));
    } catch {
      setTwoFactorError("incorrect password");
    } finally {
      setTwoFactorBusy(false);
    }
  }

  useEffect(() => {
    if (me === "loading") return;
    if (!me) router.replace("/login");
  }, [me, router]);

  function choose(next: Theme) {
    setTheme(next);
    setThemeState(next);
  }

  async function handleGenerateExportLink() {
    setExportBusy(true);
    try {
      const { url } = await regenerateExportLink();
      setExportUrl(url);
      setCopied(false);
    } finally {
      setExportBusy(false);
    }
  }

  async function handleCopyExportLink() {
    if (!exportUrl || exportUrl === "loading") return;
    await navigator.clipboard.writeText(exportUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function refreshProfile() {
    if (me && me !== "loading") {
      return getProfile(me.actor.username).then(setProfile);
    }
    return Promise.resolve();
  }

  async function handleSaveAppearance(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await updateProfile({
        backgroundColor: backgroundColor || undefined,
        headerColor: headerColor || undefined,
        introBoxColor: introBoxColor || undefined,
        contentBoxColor: contentBoxColor || undefined,
        fontFamily: fontFamily || undefined,
        fontColor: fontColor || undefined,
      });
      setSavedAppearanceSnapshot(currentAppearanceSnapshot);
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : "failed to save appearance");
    } finally {
      setSaving(false);
    }
  }

  function handleImageUpload(type: "avatar" | "header" | "background") {
    return async (file: File) => {
      setUploading(type);
      setError(null);
      try {
        await uploadProfileImage(type, file);
        await refreshProfile();
      } catch (err) {
        setError(err instanceof ApiError ? "upload failed — not a valid image?" : "upload failed");
      } finally {
        setUploading(null);
      }
    };
  }

  async function selectHeaderPreset(key: HeaderPresetKey) {
    setError(null);
    try {
      await updateProfile({ headerPreset: key });
      await refreshProfile();
    } catch {
      setError("failed to update header");
    }
  }

  async function selectBackgroundPreset(key: BackgroundPresetKey) {
    setError(null);
    try {
      await updateProfile({ backgroundPreset: key });
      await refreshProfile();
    } catch {
      setError("failed to update background");
    }
  }

  async function selectAvatarPreset(key: AvatarPresetKey) {
    setError(null);
    try {
      await updateProfile({ avatarPreset: key });
      await refreshProfile();
    } catch {
      setError("failed to update profile photo");
    }
  }

  return (
    <main className={tab === "host" ? "page-wide" : "page"}>
      <h1>Settings</h1>

      <nav className="tabs">
        <button className={tab === "account" ? "active" : undefined} onClick={() => setTab("account")}>
          Account
        </button>
        <button className={tab === "profile" ? "active" : undefined} onClick={() => setTab("profile")}>
          Edit profile
        </button>
        {typeof me === "object" && me?.isAdmin && (
          <button className={tab === "host" ? "active" : undefined} onClick={() => setTab("host")}>
            Host
          </button>
        )}
      </nav>

      {tab === "profile" && typeof me === "object" && me && <EditProfileTab username={me.actor.username} />}
      {tab === "host" && <AdminTab />}

      {tab === "account" && (
      <>
      {typeof me === "object" && me && !me.emailVerified && (
        <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
          <p style={{ margin: 0 }}>
            {resendSent
              ? "Verification email sent — check your inbox."
              : "Your email address isn't verified yet."}
          </p>
          {!resendSent && (
            <button className="btn btn-ghost" disabled={resendBusy} onClick={handleResendVerification}>
              {resendBusy ? "…" : "Resend verification email"}
            </button>
          )}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Theme</h2>
        <p className="text-dim" style={{ marginTop: 0 }}>
          Choose how Gibrr looks on this device.
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            className={`btn ${theme === "dark" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => choose("dark")}
          >
            Dark
          </button>
          <button
            className={`btn ${theme === "light" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => choose("light")}
          >
            Light
          </button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Export your calendar</h2>
        <p className="text-faint" style={{ marginTop: 0 }}>
          Get a link you can subscribe to from Google Calendar, Outlook, Apple Calendar, or any
          other app — it stays in sync with the events you've added to your own Gibrr calendar.
        </p>

        {exportUrl === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : (
          <div>
            {exportUrl && (
              <>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input className="input" readOnly value={exportUrl} style={{ flex: 1 }} />
                  <button type="button" className="btn btn-ghost" onClick={handleCopyExportLink}>
                    {copied ? "Copied!" : "Copy link"}
                  </button>
                </div>
                <p className="text-faint" style={{ margin: "0.4rem 0" }}>
                  Treat this link like a password — anyone who has it can read your saved events.
                </p>
              </>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={exportBusy}
              onClick={handleGenerateExportLink}
            >
              {exportBusy ? "Generating…" : exportUrl ? "Regenerate link" : "Generate export link"}
            </button>
            {exportUrl && (
              <p className="text-faint" style={{ margin: "0.4rem 0 0" }}>
                Regenerating replaces this link — the old one stops working right away.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Two-factor authentication</h2>
        <p className="text-faint" style={{ marginTop: 0 }}>
          Require a code from an authenticator app (or a one-time backup code) in addition to your
          password when logging in.
        </p>

        {twoFactorStep === "idle" && me !== "loading" && me && (
          <>
            {me.twoFactorEnabled ? (
              <>
                <p style={{ margin: "0.5rem 0" }}>✓ Enabled</p>
                <button className="btn btn-ghost" onClick={() => setTwoFactorStep("disable")}>
                  Disable
                </button>
              </>
            ) : (
              <button className="btn btn-primary" disabled={twoFactorBusy} onClick={handleStartTwoFactorSetup}>
                {twoFactorBusy ? "…" : "Enable two-factor authentication"}
              </button>
            )}
            {twoFactorError && <p className="error-text">{twoFactorError}</p>}
          </>
        )}

        {twoFactorStep === "setup" && (
          <form onSubmit={handleEnableTwoFactor} style={{ display: "grid", gap: "0.6rem" }}>
            <p>Scan this with your authenticator app (Google Authenticator, Aegis, 1Password, etc.):</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={twoFactorQr} alt="Two-factor QR code" style={{ width: 200, height: 200 }} />
            <p className="text-faint" style={{ margin: 0 }}>
              Or enter this key manually: <code>{twoFactorSecret}</code>
            </p>
            <label className="field">
              Code from your app
              <input
                className="input"
                value={twoFactorToken}
                onChange={(e) => setTwoFactorToken(e.target.value)}
                autoFocus
                required
              />
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="submit" className="btn btn-primary" disabled={twoFactorBusy || !twoFactorToken.trim()}>
                {twoFactorBusy ? "…" : "Confirm and enable"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setTwoFactorStep("idle")}>
                Cancel
              </button>
            </div>
            {twoFactorError && <p className="error-text">{twoFactorError}</p>}
          </form>
        )}

        {twoFactorStep === "backup-codes" && (
          <div style={{ display: "grid", gap: "0.6rem" }}>
            <p style={{ margin: 0 }}>
              ✓ Two-factor authentication is enabled. Save these backup codes somewhere safe — each
              works once, and this is the only time they'll be shown.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.3rem",
                fontFamily: "monospace",
                background: "var(--surface-hover)",
                padding: "0.75rem",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {twoFactorBackupCodes.map((code) => (
                <span key={code}>{code}</span>
              ))}
            </div>
            <button className="btn btn-primary" style={{ justifySelf: "start" }} onClick={() => setTwoFactorStep("idle")}>
              Done
            </button>
          </div>
        )}

        {twoFactorStep === "disable" && (
          <form onSubmit={handleDisableTwoFactor} style={{ display: "grid", gap: "0.6rem" }}>
            <label className="field">
              Confirm your password to disable two-factor authentication
              <input
                className="input"
                type="password"
                value={twoFactorPassword}
                onChange={(e) => setTwoFactorPassword(e.target.value)}
                autoFocus
                required
              />
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="submit" className="btn btn-primary" disabled={twoFactorBusy || !twoFactorPassword}>
                {twoFactorBusy ? "…" : "Disable"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setTwoFactorStep("idle");
                  setTwoFactorPassword("");
                  setTwoFactorError(null);
                }}
              >
                Cancel
              </button>
            </div>
            {twoFactorError && <p className="error-text">{twoFactorError}</p>}
          </form>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Blocked accounts</h2>
        <p className="text-faint" style={{ marginTop: 0 }}>
          Blocking removes any follow relationship and hides their posts from your feed and search.
        </p>
        {blockedActors === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : blockedActors.length === 0 ? (
          <p className="text-dim">You haven&apos;t blocked anyone.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {blockedActors.map((actor) => (
              <div
                key={actor.id}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}
              >
                <span>
                  {actor.displayName ?? actor.username} <span className="text-faint">@{actor.username}@{actor.domain}</span>
                </span>
                <button
                  className="btn btn-ghost"
                  disabled={unblockBusyId === actor.id}
                  onClick={() => handleUnblock(actor)}
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {profile !== "loading" && profile !== "error" && (
        <form onSubmit={handleSaveAppearance}>
          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Appearance</h2>
            <p className="text-faint" style={{ marginTop: 0 }}>
              Customize your profile's fonts, colors, and images. If a combination would be hard to
              read, we'll automatically swap in black or white text in that spot — for every visitor,
              in both light and dark mode.
            </p>

            <label className="field">
              Font
              <select
                className="input"
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value as FontPresetKey | "")}
              >
                <option value="">System Sans (default)</option>
                {(Object.keys(FONT_PRESETS) as FontPresetKey[]).map((key) => (
                  <option key={key} value={key}>
                    {FONT_PRESET_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>

            <div className="field">
              <span>Font color</span>
              <div style={{ marginTop: "0.35rem" }}>
                <ColorSwatchPicker value={fontColor} fallback={DEFAULT_TEXT_COLOR} onChange={setFontColor} />
              </div>
            </div>

            <div className="field">
              <span>Page background color</span>
              <div style={{ marginTop: "0.35rem" }}>
                <ColorSwatchPicker
                  value={backgroundColor}
                  fallback={DEFAULT_COLOR}
                  onChange={setBackgroundColor}
                />
              </div>
            </div>

            <div className="field">
              <span>Header color</span>
              <div style={{ marginTop: "0.35rem" }}>
                <ColorSwatchPicker value={headerColor} fallback={DEFAULT_COLOR} onChange={setHeaderColor} />
              </div>
            </div>

            <div className="field">
              <span>Intro box color</span>
              <div style={{ marginTop: "0.35rem" }}>
                <ColorSwatchPicker
                  value={introBoxColor}
                  fallback={DEFAULT_COLOR}
                  onChange={setIntroBoxColor}
                />
              </div>
            </div>

            <div className="field">
              <span>Gib/chatter box color</span>
              <div style={{ marginTop: "0.35rem" }}>
                <ColorSwatchPicker
                  value={contentBoxColor}
                  fallback={DEFAULT_COLOR}
                  onChange={setContentBoxColor}
                />
              </div>
            </div>

            <div className="field">
              <span>Profile photo</span>
              <p className="text-faint" style={{ margin: "0.15rem 0 0.4rem" }}>
                Pick a default, or choose file to upload your own (cropped to 400×400).
              </p>
              <PictureChooser
                presets={AVATAR_PRESETS}
                selectedPreset={profile.actor.avatarPreset}
                hasCustomImage={Boolean(profile.actor.avatarImageUrl)}
                currentImageUrl={
                  profile.actor.avatarImageUrl ? assetUrl(profile.actor.avatarImageUrl) : undefined
                }
                onSelectPreset={selectAvatarPreset}
                onUploadFile={handleImageUpload("avatar")}
                uploading={uploading === "avatar"}
                round
              />
            </div>

            <div className="field">
              <span>Header banner</span>
              <p className="text-faint" style={{ margin: "0.15rem 0 0.4rem" }}>
                Pick a default, or choose file to upload your own (cropped to 1200×300).
              </p>
              <PictureChooser
                presets={HEADER_PRESETS}
                selectedPreset={profile.actor.headerPreset}
                hasCustomImage={Boolean(profile.actor.headerImageUrl)}
                currentImageUrl={
                  profile.actor.headerImageUrl ? assetUrl(profile.actor.headerImageUrl) : undefined
                }
                onSelectPreset={selectHeaderPreset}
                onUploadFile={handleImageUpload("header")}
                uploading={uploading === "header"}
                tileWidth={96}
                tileHeight={48}
              />
            </div>

            <div className="field">
              <span>Page background</span>
              <p className="text-faint" style={{ margin: "0.15rem 0 0.4rem" }}>
                Pick a default, or choose file to upload your own (fit within 1920×1920, not cropped).
              </p>
              <PictureChooser
                presets={BACKGROUND_PRESETS}
                selectedPreset={profile.actor.backgroundPreset}
                hasCustomImage={Boolean(profile.actor.backgroundImageUrl)}
                currentImageUrl={
                  profile.actor.backgroundImageUrl ? assetUrl(profile.actor.backgroundImageUrl) : undefined
                }
                onSelectPreset={selectBackgroundPreset}
                onUploadFile={handleImageUpload("background")}
                uploading={uploading === "background"}
              />
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button type="submit" className="btn btn-accent" disabled={saving}>
                {saving
                  ? "Saving…"
                  : savedAppearanceSnapshot === currentAppearanceSnapshot
                    ? "Saved"
                    : "Save"}
              </button>
            </div>
            {error && <p className="error-text">{error}</p>}
          </div>
        </form>
      )}
      </>
      )}
    </main>
  );
}
