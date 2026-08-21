import { localDomain } from "./federation/localActor.js";

// Hand-rolled RFC 5545 (iCalendar) writer — node-ical (already a
// dependency) only parses, and the output shape here is small/fixed
// enough that a minimal writer is less code and no new dependency,
// consistent with this project's standing preference for hand-rolling
// small protocol surfaces (same call made for ActivityPub itself, and
// for CalDAV/iCal parsing earlier this feature).

export interface ExportableEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  location: string | null;
}

// TEXT value escaping per RFC 5545 §3.3.11 — backslash first, then the
// other reserved characters, or a literal backslash in the input would
// get double-escaped by the later replacements.
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// Folds a "PROP:value" line to (well under) the 75-octet limit in §3.1,
// continuation lines prefixed with a single space. Folds on character
// (not byte) boundaries — conservative vs. the exact octet count, but
// guarantees a multi-byte UTF-8 character is never split mid-sequence,
// which folding strictly by bytes could do.
function foldLine(line: string): string {
  const MAX_CHARS = 73;
  if (line.length <= MAX_CHARS) return line;

  const parts: string[] = [];
  let rest = line;
  while (rest.length > MAX_CHARS) {
    parts.push(rest.slice(0, MAX_CHARS));
    rest = rest.slice(MAX_CHARS);
  }
  parts.push(rest);
  return parts.join("\r\n ");
}

function formatDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildIcsFeed(calendarName: string, events: ExportableEvent[]): string {
  const domain = localDomain();
  const now = formatDate(new Date());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gibrr//Calendar Export//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];

  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id}@${domain}`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${formatDate(event.start)}`);
    lines.push(`DTEND:${formatDate(event.end)}`);
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.location) {
      lines.push(`LOCATION:${escapeText(event.location)}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
