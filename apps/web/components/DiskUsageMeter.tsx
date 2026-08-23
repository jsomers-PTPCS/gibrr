// A horizontal disk-usage meter for the Host dashboard's Server health
// card — the "emphasis" form (see the dataviz skill's choosing-a-form
// guide): the story is "how much THIS instance is using," everything
// else on the disk is context, so this instance's segment carries the
// brand hue and the rest recede to neutral grays rather than treating
// all three as equal categorical peers.
//
// This instance's real share of a typical server's disk is usually tiny
// (kilobytes to megabytes against a multi-hundred-GB disk) — clamped to
// a minimum visual width so it stays a visible sliver rather than
// disappearing at true scale. The exact byte value is always in the
// legend text below regardless of the rendered width, so nothing is
// ever visually overstated in a way the numbers don't back up.
const MIN_SEGMENT_PERCENT = 1.5;

export interface DiskUsageMeterProps {
  totalBytes: number;
  instanceBytes: number;
  usedBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function DiskUsageMeter({ totalBytes, instanceBytes, usedBytes }: DiskUsageMeterProps) {
  if (totalBytes <= 0) return null;

  const otherBytes = Math.max(usedBytes - instanceBytes, 0);
  const freeBytes = Math.max(totalBytes - usedBytes, 0);

  const rawInstancePct = (instanceBytes / totalBytes) * 100;
  const rawOtherPct = (otherBytes / totalBytes) * 100;
  const rawFreePct = 100 - rawInstancePct - rawOtherPct;

  // Only clamp instance-share upward (the segment we want to guarantee
  // stays visible); borrow the difference from "other" first, then
  // "free", so the three always still sum to exactly 100%.
  const instancePct = instanceBytes > 0 ? Math.max(rawInstancePct, MIN_SEGMENT_PERCENT) : 0;
  const borrowed = instancePct - rawInstancePct;
  const otherPct = Math.max(rawOtherPct - borrowed, 0);
  const freePct = Math.max(100 - instancePct - otherPct, 0);
  void rawFreePct;

  const segments = [
    { label: "This instance", bytes: instanceBytes, percent: instancePct, color: "var(--primary)" },
    { label: "Other", bytes: otherBytes, percent: otherPct, color: "var(--border-bright)" },
    { label: "Free", bytes: freeBytes, percent: freePct, color: "var(--border)" },
  ];

  return (
    <div role="img" aria-label={`Disk usage: ${formatBytes(instanceBytes)} used by this instance, ${formatBytes(otherBytes)} used by other data, ${formatBytes(freeBytes)} free, of ${formatBytes(totalBytes)} total.`}>
      <div
        style={{
          display: "flex",
          height: 20,
          borderRadius: 6,
          overflow: "hidden",
          gap: 2,
          background: "var(--surface-hover)",
        }}
      >
        {segments
          .filter((s) => s.percent > 0)
          .map((s) => (
            <div
              key={s.label}
              title={`${s.label}: ${formatBytes(s.bytes)}`}
              tabIndex={0}
              style={{
                width: `${s.percent}%`,
                background: s.color,
                transition: "filter 0.1s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.15)")}
              onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
            />
          ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.5rem" }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem" }}>
            <span
              aria-hidden
              style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: "inline-block" }}
            />
            <span className="text-faint">{s.label}</span>
            <strong>{formatBytes(s.bytes)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
