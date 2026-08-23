"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  getProfile,
  updateProfile,
  connectCalendar,
  getCalendarStatus,
  disconnectCalendar,
  connectIcalUrl,
  connectImmich,
  getImmichStatus,
  disconnectImmich,
  ApiError,
  type Profile,
  type CalendarStatus,
} from "../lib/api";
import {
  ABOUT_FIELD_LABELS,
  CALENDAR_VISIBILITY_LABEL,
  IMMICH_VISIBILITY_LABEL,
  type AboutFieldKey,
} from "../lib/aboutFields";
import {
  RELATIONSHIP_STATUSES,
  RELATIONSHIP_STATUS_LABELS,
  type RelationshipStatus,
} from "../lib/relationshipStatus";

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

// PATCH /profile now stores summary as HTML — plain text promoted to
// one <p> per blank-line-separated block (federation/descriptionHtml.ts's
// toDescriptionHtml; a local bio is never anything richer than that,
// since this plain textarea is the only way to write one). Reversing
// that — one block of text per <p>, blank line between blocks — is what
// keeps a re-opened edit form showing readable text instead of literal
// "<p>" tags; re-saving without touching it round-trips back to the
// same HTML. Falls back to the raw value for the (rare, pre-migration)
// case where a stored summary somehow isn't real markup at all.
function htmlSummaryToPlainText(html: string): string {
  if (typeof window === "undefined" || !/<[a-z][\s\S]*>/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = Array.from(doc.body.children).map((el) => el.textContent ?? "");
  return blocks.length > 0 ? blocks.join("\n\n") : (doc.body.textContent ?? html);
}

function VisibilityToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.3rem",
        fontSize: "0.8rem",
        color: "var(--text-faint)",
        whiteSpace: "nowrap",
      }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      🌐 Public
    </label>
  );
}

// Formerly its own app/u/[username]/edit/page.tsx — now the Settings
// page's "Edit profile" tab (app/settings/page.tsx). `username` is
// always the logged-in viewer's own (the parent only ever renders this
// for `me`), so unlike the old page there's no "is this really my own
// profile" gate to check — that ambiguity only existed when this was a
// route anyone could type a different username into.
export function EditProfileTab({ username }: { username: string }) {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | "loading" | "error">("loading");

  const [displayName, setDisplayName] = useState("");
  const [summary, setSummary] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [bookwyrmHandle, setBookwyrmHandle] = useState("");

  const [workplace, setWorkplace] = useState("");
  const [hometown, setHometown] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [languagesText, setLanguagesText] = useState("");
  const [education, setEducation] = useState("");
  const [interestsText, setInterestsText] = useState("");
  const [customFacts, setCustomFacts] = useState<{ label: string; value: string }[]>([]);
  const [relationshipStatus, setRelationshipStatus] = useState<RelationshipStatus | "">("");
  const [aboutVisibility, setAboutVisibility] = useState<Partial<Record<AboutFieldKey, boolean>>>({});
  const [calendarEventsVisible, setCalendarEventsVisible] = useState(false);

  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | "loading">("loading");
  const [calServerUrl, setCalServerUrl] = useState("");
  const [calUsername, setCalUsername] = useState("");
  const [calAppPassword, setCalAppPassword] = useState("");
  const [calIcalUrl, setCalIcalUrl] = useState("");
  const [calConnecting, setCalConnecting] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);

  const [immichPhotosVisible, setImmichPhotosVisible] = useState(false);
  const [immichConnected, setImmichConnected] = useState<boolean | "loading">("loading");
  const [immichServerUrl, setImmichServerUrl] = useState("");
  const [immichApiKey, setImmichApiKey] = useState("");
  const [immichConnecting, setImmichConnecting] = useState(false);
  const [immichError, setImmichError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProfile(username)
      .then((p) => {
        setProfile(p);
        setDisplayName(p.actor.displayName ?? "");
        setSummary(p.actor.summary ? htmlSummaryToPlainText(p.actor.summary) : "");
        setPronouns(p.actor.pronouns ?? "");
        setLocation(p.actor.location ?? "");
        setWebsite(p.actor.website ?? "");
        setBookwyrmHandle(p.actor.bookwyrmHandle ?? "");
        setWorkplace(p.actor.workplace ?? "");
        setHometown(p.actor.hometown ?? "");
        setDateOfBirth(toDateInputValue(p.actor.dateOfBirth));
        setGender(p.actor.gender ?? "");
        setLanguagesText(p.actor.languages.join(", "));
        setEducation(p.actor.education ?? "");
        setInterestsText(p.actor.interests.join(", "));
        setCustomFacts(p.actor.customFacts ?? []);
        setRelationshipStatus(p.actor.relationshipStatus ?? "");
        setAboutVisibility(p.actor.aboutVisibility ?? {});
        setCalendarEventsVisible(
          (p.actor.aboutVisibility as Record<string, boolean> | null)?.calendarEvents ?? false,
        );
        setImmichPhotosVisible(
          (p.actor.aboutVisibility as Record<string, boolean> | null)?.immichPhotos ?? false,
        );
      })
      .catch(() => setProfile("error"));
    getCalendarStatus()
      .then(setCalendarStatus)
      .catch(() => setCalendarStatus({ connected: false }));
    getImmichStatus()
      .then((s) => setImmichConnected(s.connected))
      .catch(() => setImmichConnected(false));
  }, [username]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await updateProfile({
        displayName: displayName || undefined,
        summary: summary || undefined,
        pronouns: pronouns || undefined,
        location: location || undefined,
        website: website || undefined,
        bookwyrmHandle: bookwyrmHandle || undefined,
        workplace: workplace || undefined,
        hometown: hometown || undefined,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth).toISOString() : undefined,
        gender: gender || undefined,
        languages: languagesText
          ? languagesText.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        education: education || undefined,
        interests: interestsText
          ? interestsText.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        customFacts,
        relationshipStatus: relationshipStatus || undefined,
        aboutVisibility: {
          ...aboutVisibility,
          calendarEvents: calendarEventsVisible,
          immichPhotos: immichPhotosVisible,
        },
      });
      router.push(`/u/${username}`);
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : "failed to save profile");
      setSaving(false);
    }
  }

  function addCustomFact() {
    if (customFacts.length >= 10) return;
    setCustomFacts((prev) => [...prev, { label: "", value: "" }]);
  }

  function updateCustomFact(index: number, field: "label" | "value", value: string) {
    setCustomFacts((prev) => prev.map((fact, i) => (i === index ? { ...fact, [field]: value } : fact)));
  }

  function removeCustomFact(index: number) {
    setCustomFacts((prev) => prev.filter((_, i) => i !== index));
  }

  function setFieldVisibility(key: AboutFieldKey, value: boolean) {
    setAboutVisibility((prev) => ({ ...prev, [key]: value }));
  }

  async function handleConnectCalendar() {
    setCalError(null);
    setCalConnecting(true);
    try {
      await connectCalendar({
        serverUrl: calServerUrl,
        username: calUsername,
        appPassword: calAppPassword,
      });
      setCalAppPassword("");
      const status = await getCalendarStatus();
      setCalendarStatus(status);
    } catch (err) {
      setCalError(
        err instanceof ApiError && typeof err.body === "object" && err.body && "error" in err.body
          ? String((err.body as { error: string }).error)
          : "could not connect",
      );
    } finally {
      setCalConnecting(false);
    }
  }

  async function handleConnectIcal() {
    setCalError(null);
    setCalConnecting(true);
    try {
      await connectIcalUrl(calIcalUrl);
      setCalIcalUrl("");
      const status = await getCalendarStatus();
      setCalendarStatus(status);
    } catch (err) {
      setCalError(
        err instanceof ApiError && typeof err.body === "object" && err.body && "error" in err.body
          ? String((err.body as { error: string }).error)
          : "could not connect",
      );
    } finally {
      setCalConnecting(false);
    }
  }

  async function handleDisconnectCalendar() {
    setCalError(null);
    try {
      await disconnectCalendar();
      setCalendarStatus({ connected: false });
    } catch {
      setCalError("failed to disconnect");
    }
  }

  async function handleConnectImmich() {
    setImmichError(null);
    setImmichConnecting(true);
    try {
      await connectImmich({ serverUrl: immichServerUrl, apiKey: immichApiKey });
      setImmichApiKey("");
      setImmichConnected(true);
    } catch (err) {
      setImmichError(
        err instanceof ApiError && typeof err.body === "object" && err.body && "error" in err.body
          ? String((err.body as { error: string }).error)
          : "could not connect",
      );
    } finally {
      setImmichConnecting(false);
    }
  }

  async function handleDisconnectImmich() {
    setImmichError(null);
    try {
      await disconnectImmich();
      setImmichConnected(false);
    } catch {
      setImmichError("failed to disconnect");
    }
  }

  if (profile === "loading") return <p className="text-dim">Loading…</p>;
  if (profile === "error") return <p className="error-text">Could not load this profile.</p>;

  return (
    <>
      <form onSubmit={handleSave}>
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Basic info</h2>
          <label className="field">
            Display name
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label className="field">
            Bio
            <textarea className="input" value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} />
          </label>
          <label className="field">
            Pronouns
            <input
              className="input"
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              placeholder="she/her, he/him, they/them…"
            />
          </label>
          <label className="field">
            Location
            <input
              className="input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="City, country…"
            />
          </label>
          <label className="field">
            Website
            <input
              className="input"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="example.com"
            />
          </label>
          <label className="field">
            BookWyrm account
            <input
              className="input"
              value={bookwyrmHandle}
              onChange={(e) => setBookwyrmHandle(e.target.value)}
              placeholder="you@bookwyrm.social"
            />
            <span className="text-faint" style={{ fontSize: "0.85rem" }}>
              Adds a BookWyrm tab to your profile — visible to you and your friends.
            </span>
          </label>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Appearance</h2>
          <p className="text-faint" style={{ margin: 0 }}>
            Fonts, colors, profile photo, header, and background are on the Account tab.
          </p>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>About</h2>
          <p className="text-faint" style={{ marginTop: 0 }}>
            Each field is private by default — toggle "Public" to let other people see it.
          </p>

          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{ABOUT_FIELD_LABELS.relationshipStatus}</span>
              <VisibilityToggle
                checked={aboutVisibility.relationshipStatus ?? false}
                onChange={(v) => setFieldVisibility("relationshipStatus", v)}
              />
            </div>
            <select
              className="input"
              style={{ marginTop: "0.3rem" }}
              value={relationshipStatus}
              onChange={(e) => setRelationshipStatus(e.target.value as RelationshipStatus | "")}
            >
              <option value="">Prefer not to say</option>
              {RELATIONSHIP_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {RELATIONSHIP_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            <p className="text-faint" style={{ margin: "0.3rem 0 0" }}>
              To tag a specific partner or family member, use the Relationships tab on your
              profile.
            </p>
          </div>

          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{ABOUT_FIELD_LABELS.workplace}</span>
              <VisibilityToggle
                checked={aboutVisibility.workplace ?? false}
                onChange={(v) => setFieldVisibility("workplace", v)}
              />
            </div>
            <input
              className="input"
              style={{ marginTop: "0.3rem" }}
              value={workplace}
              onChange={(e) => setWorkplace(e.target.value)}
            />
          </div>

          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{ABOUT_FIELD_LABELS.hometown}</span>
              <VisibilityToggle
                checked={aboutVisibility.hometown ?? false}
                onChange={(v) => setFieldVisibility("hometown", v)}
              />
            </div>
            <input
              className="input"
              style={{ marginTop: "0.3rem" }}
              value={hometown}
              onChange={(e) => setHometown(e.target.value)}
            />
          </div>

          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{ABOUT_FIELD_LABELS.dateOfBirth}</span>
              <VisibilityToggle
                checked={aboutVisibility.dateOfBirth ?? false}
                onChange={(v) => setFieldVisibility("dateOfBirth", v)}
              />
            </div>
            <input
              type="date"
              className="input"
              style={{ marginTop: "0.3rem" }}
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
            />
          </div>

          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{ABOUT_FIELD_LABELS.gender}</span>
              <VisibilityToggle
                checked={aboutVisibility.gender ?? false}
                onChange={(v) => setFieldVisibility("gender", v)}
              />
            </div>
            <input
              className="input"
              style={{ marginTop: "0.3rem" }}
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            />
          </div>

          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{ABOUT_FIELD_LABELS.languages}</span>
              <VisibilityToggle
                checked={aboutVisibility.languages ?? false}
                onChange={(v) => setFieldVisibility("languages", v)}
              />
            </div>
            <input
              className="input"
              style={{ marginTop: "0.3rem" }}
              value={languagesText}
              onChange={(e) => setLanguagesText(e.target.value)}
              placeholder="English, Spanish, French…"
            />
          </div>

          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{ABOUT_FIELD_LABELS.education}</span>
              <VisibilityToggle
                checked={aboutVisibility.education ?? false}
                onChange={(v) => setFieldVisibility("education", v)}
              />
            </div>
            <input
              className="input"
              style={{ marginTop: "0.3rem" }}
              value={education}
              onChange={(e) => setEducation(e.target.value)}
            />
          </div>

          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{ABOUT_FIELD_LABELS.interests}</span>
              <VisibilityToggle
                checked={aboutVisibility.interests ?? false}
                onChange={(v) => setFieldVisibility("interests", v)}
              />
            </div>
            <input
              className="input"
              style={{ marginTop: "0.3rem" }}
              value={interestsText}
              onChange={(e) => setInterestsText(e.target.value)}
              placeholder="hiking, chess, photography…"
            />
          </div>

          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{ABOUT_FIELD_LABELS.customFacts}</span>
              <VisibilityToggle
                checked={aboutVisibility.customFacts ?? false}
                onChange={(v) => setFieldVisibility("customFacts", v)}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.3rem" }}>
              {customFacts.map((fact, i) => (
                <div key={i} style={{ display: "flex", gap: "0.4rem" }}>
                  <input
                    className="input"
                    placeholder="Label (e.g. Favorite band)"
                    value={fact.label}
                    onChange={(e) => updateCustomFact(i, "label", e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <input
                    className="input"
                    placeholder="Value"
                    value={fact.value}
                    onChange={(e) => updateCustomFact(i, "value", e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="btn btn-ghost" onClick={() => removeCustomFact(i)}>
                    ✕
                  </button>
                </div>
              ))}
              {customFacts.length < 10 && (
                <button type="button" className="btn btn-ghost" onClick={addCustomFact} style={{ alignSelf: "start" }}>
                  + Add fact
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Calendar</h2>
          <p className="text-faint" style={{ marginTop: 0 }}>
            Paste an iCal feed URL, or connect a self-hosted calendar (Nextcloud, Radicale,
            Baïkal, or any CalDAV server) to show upcoming events on your profile.
          </p>

          {calendarStatus === "loading" ? (
            <p className="text-dim">Loading…</p>
          ) : calendarStatus.connected ? (
            <div>
              <p style={{ margin: "0 0 0.5rem" }}>
                {calendarStatus.provider === "ical" ? (
                  <>
                    Connected to <strong>a calendar feed</strong>
                  </>
                ) : (
                  <>
                    Connected to <strong>{calendarStatus.serverUrl}</strong>
                  </>
                )}
              </p>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}
              >
                <span>{CALENDAR_VISIBILITY_LABEL}</span>
                <VisibilityToggle checked={calendarEventsVisible} onChange={setCalendarEventsVisible} />
              </div>
              <button type="button" className="btn btn-ghost" onClick={handleDisconnectCalendar}>
                Disconnect
              </button>
            </div>
          ) : (
            <div>
              <label className="field">
                iCal feed URL
                <input
                  className="input"
                  value={calIcalUrl}
                  onChange={(e) => setCalIcalUrl(e.target.value)}
                  placeholder="https://calendar.google.com/calendar/ical/.../private-.../basic.ics"
                />
              </label>
              <p className="text-faint" style={{ marginTop: "-0.4rem" }}>
                No account setup needed — works with Google Calendar&apos;s own &ldquo;Secret address
                in iCal format&rdquo; (Calendar Settings → Integrate calendar), or any other
                calendar&apos;s public/private .ics link. Treat this URL like a password — anyone
                who has it can read your calendar.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={calConnecting || !calIcalUrl}
                onClick={handleConnectIcal}
              >
                {calConnecting ? "Connecting…" : "Connect feed URL"}
              </button>

              <p className="text-faint" style={{ margin: "1rem 0", textAlign: "center" }}>
                — or —
              </p>

              <label className="field">
                Server URL
                <input
                  className="input"
                  value={calServerUrl}
                  onChange={(e) => setCalServerUrl(e.target.value)}
                  placeholder="https://cloud.example.com/remote.php/dav/calendars/me/personal/"
                />
              </label>
              <label className="field">
                Username
                <input
                  className="input"
                  value={calUsername}
                  onChange={(e) => setCalUsername(e.target.value)}
                />
              </label>
              <label className="field">
                App password
                <input
                  type="password"
                  className="input"
                  value={calAppPassword}
                  onChange={(e) => setCalAppPassword(e.target.value)}
                />
              </label>
              {/* type="button", not "submit" — this whole page is already one
                  <form> (see handleSave); a nested <form> here would be
                  invalid HTML and browsers don't handle that reliably. */}
              <button
                type="button"
                className="btn btn-primary"
                disabled={calConnecting}
                onClick={handleConnectCalendar}
              >
                {calConnecting ? "Connecting…" : "Connect"}
              </button>
              {calError && <p className="error-text">{calError}</p>}
            </div>
          )}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Photos</h2>
          <p className="text-faint" style={{ marginTop: 0 }}>
            Albums you create show up on your profile's Photos tab automatically. You can also
            connect a self-hosted Immich server to show its albums there too.
          </p>

          {immichConnected === "loading" ? (
            <p className="text-dim">Loading…</p>
          ) : immichConnected ? (
            <div>
              <p style={{ margin: "0 0 0.5rem" }}>Connected to Immich.</p>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}
              >
                <span>{IMMICH_VISIBILITY_LABEL}</span>
                <VisibilityToggle checked={immichPhotosVisible} onChange={setImmichPhotosVisible} />
              </div>
              <button type="button" className="btn btn-ghost" onClick={handleDisconnectImmich}>
                Disconnect
              </button>
            </div>
          ) : (
            <div>
              <label className="field">
                Immich server URL
                <input
                  className="input"
                  value={immichServerUrl}
                  onChange={(e) => setImmichServerUrl(e.target.value)}
                  placeholder="https://immich.example.com"
                />
              </label>
              <label className="field">
                API key
                <input
                  type="password"
                  className="input"
                  value={immichApiKey}
                  onChange={(e) => setImmichApiKey(e.target.value)}
                />
              </label>
              {/* type="button", not "submit" — same nested-<form> reason as
                  the Calendar card above. */}
              <button
                type="button"
                className="btn btn-primary"
                disabled={immichConnecting}
                onClick={handleConnectImmich}
              >
                {immichConnecting ? "Connecting…" : "Connect"}
              </button>
              {immichError && <p className="error-text">{immichError}</p>}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="submit" className="btn btn-accent" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => router.push(`/u/${username}`)}>
            Cancel
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>
    </>
  );
}
