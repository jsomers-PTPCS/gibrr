import { createDAVClient } from "tsdav";
import ical from "node-ical";

// Thin wrapper around tsdav (CalDAV protocol) + node-ical (iCalendar
// parsing). Both calls here are the actual security boundary described in
// the plan: whatever the remote server sends back, only fields extracted
// from a *successfully parsed* calendar object are ever returned to a
// route handler — never raw response bytes, and never the underlying
// error's message (which could contain fragments of the remote response).

const TIMEOUT_MS = 10_000;
const MAX_EVENTS = 20;
const WINDOW_DAYS = 30;
// Bounds resource use for the plain-URL feed path (no protocol-level
// pagination the way CalDAV has) — a courtesy cap, not a hard security
// wall; the timeout already bounds worst-case duration.
const MAX_ICS_BYTES = 5 * 1024 * 1024;

interface CalDavCredentials {
  serverUrl: string;
  username: string;
  appPassword: string;
  calendarPath?: string;
}

export interface UpcomingEvent {
  summary: string;
  start: string;
  end: string;
  location: string | null;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function extractUpcomingEvents(
  parsed: ReturnType<typeof ical.parseICS>,
  now: Date,
  future: Date,
): UpcomingEvent[] {
  const events: UpcomingEvent[] = [];
  for (const component of Object.values(parsed)) {
    if (component.type !== "VEVENT") continue;
    if (!component.start || !component.end) continue;
    const start = new Date(component.start as unknown as string | number | Date);
    // CalDAV's timeRange query already bounds this server-side; the plain
    // URL-feed path has no such protocol-level filtering, so this upper
    // bound has to be enforced here or a feed with far-future events (e.g.
    // a public holiday calendar) would return months of noise instead of
    // the intended WINDOW_DAYS window.
    if (start < now || start > future) continue;
    events.push({
      summary: component.summary ? String(component.summary) : "(untitled event)",
      start: start.toISOString(),
      end: new Date(component.end as unknown as string | number | Date).toISOString(),
      location: component.location ? String(component.location) : null,
    });
  }
  return events;
}

async function connect({ serverUrl, username, appPassword }: CalDavCredentials) {
  return createDAVClient({
    serverUrl,
    credentials: { username, password: appPassword },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

// Logs in and lists calendars — throws (generically) if the server is
// unreachable or the credentials are rejected. Called at connect time so
// bad credentials fail immediately instead of silently saving.
export async function testConnection(creds: CalDavCredentials): Promise<void> {
  try {
    const client = await withTimeout(connect(creds), TIMEOUT_MS);
    const calendars = await withTimeout(client.fetchCalendars(), TIMEOUT_MS);
    if (calendars.length === 0) {
      throw new Error("no calendars found");
    }
  } catch {
    throw new Error("could not connect to calendar server — check the URL, username, and password");
  }
}

export async function fetchUpcomingEvents(creds: CalDavCredentials): Promise<UpcomingEvent[]> {
  try {
    const client = await withTimeout(connect(creds), TIMEOUT_MS);
    const calendars = await withTimeout(client.fetchCalendars(), TIMEOUT_MS);

    const calendar = creds.calendarPath
      ? calendars.find((c) => c.url === creds.calendarPath)
      : calendars[0];
    if (!calendar) throw new Error("calendar not found");

    const now = new Date();
    const future = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const objects = await withTimeout(
      client.fetchCalendarObjects({
        calendar,
        timeRange: { start: now.toISOString(), end: future.toISOString() },
      }),
      TIMEOUT_MS,
    );

    const events: UpcomingEvent[] = [];
    for (const obj of objects) {
      if (!obj.data) continue;
      events.push(...extractUpcomingEvents(ical.parseICS(obj.data), now, future));
    }

    events.sort((a, b) => a.start.localeCompare(b.start));
    return events.slice(0, MAX_EVENTS);
  } catch {
    throw new Error("could not fetch events from calendar server");
  }
}

// --- Plain iCal (.ics) feed URL — zero-setup alternative to CalDAV.
// Works with e.g. Google Calendar's own "Secret address in iCal format",
// or any Outlook/Apple/other public or private .ics link. Same rules as
// the CalDAV path above: raw response text never reaches a route handler,
// only fields extracted from a successfully-parsed feed.

async function fetchIcsText(rawUrl: string): Promise<string> {
  // "webcal://" is just a UI convention meaning "open this in a calendar
  // app" — calendar apps (Apple Calendar, Outlook, and Google's own
  // "Public URL" copy button) commonly hand out links with this scheme,
  // but the resource itself is served over plain HTTP(S) at the same
  // path. Node's fetch() doesn't understand webcal: at all and throws
  // immediately, so normalize it before doing anything else.
  const url = rawUrl.replace(/^webcal:\/\//i, "https://");
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("must be an http(s) or webcal URL");
  }
  const res = await withTimeout(fetch(url), TIMEOUT_MS);
  if (!res.ok) throw new Error("feed request failed");
  const text = await res.text();
  if (text.length > MAX_ICS_BYTES) throw new Error("feed too large");
  return text;
}

// Verified at save time, same as CalDAV's testConnection — a bad or
// unreachable URL fails immediately instead of silently saving something
// that will just fail on every later fetch.
export async function testIcsUrl(url: string): Promise<void> {
  try {
    const text = await fetchIcsText(url);
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("not an iCal feed");
  } catch {
    throw new Error("could not read that URL as an iCal feed — check the link");
  }
}

export async function fetchUpcomingEventsFromIcsUrl(url: string): Promise<UpcomingEvent[]> {
  try {
    const text = await fetchIcsText(url);
    const now = new Date();
    const future = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const events = extractUpcomingEvents(ical.parseICS(text), now, future);
    events.sort((a, b) => a.start.localeCompare(b.start));
    return events.slice(0, MAX_EVENTS);
  } catch {
    throw new Error("could not fetch events from that calendar feed");
  }
}
