"use client";

import type { FeedSort, FeedRange } from "../lib/api";

const SORT_OPTIONS: { value: FeedSort; label: string }[] = [
  { value: "new", label: "New" },
  { value: "top", label: "Top" },
  { value: "rising", label: "Rising" },
  { value: "active", label: "Most active" },
  { value: "comments", label: "Most comments" },
];

const RANGE_OPTIONS: { value: FeedRange; label: string }[] = [
  { value: "day", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
];

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

interface CircleOption {
  id: string;
  title: string;
}

// Sort/range/server/circle controls shared by Home and Federated — the
// two general-purpose feeds broad enough to need narrowing down (a
// Circle's own page already shows just that circle's posts). `circles`
// is omitted entirely on Federated: federated posts are always
// communityId: null by definition (see routes/posts.ts's own scope
// split), so a circle filter there could only ever produce zero
// results, not a real narrowing.
//
// The server/circle pickers use a plain <details> rather than a
// portaled popover (ShareMenu.tsx's pattern) — no click-outside-to-
// close, just native disclosure behavior, which is a fine tradeoff for
// a checklist this shape and saves the positioning/portal machinery a
// heavier popover needs.
export function FeedFilterBar({
  sort,
  onSortChange,
  range,
  onRangeChange,
  domains,
  selectedDomains,
  onSelectedDomainsChange,
  circles,
  selectedCircleIds,
  onSelectedCircleIdsChange,
}: {
  sort: FeedSort;
  onSortChange: (sort: FeedSort) => void;
  range: FeedRange;
  onRangeChange: (range: FeedRange) => void;
  domains: string[];
  selectedDomains: string[];
  onSelectedDomainsChange: (domains: string[]) => void;
  circles?: CircleOption[];
  selectedCircleIds?: string[];
  onSelectedCircleIdsChange?: (ids: string[]) => void;
}) {
  const hasActiveFilter =
    sort !== "new" || range !== "all" || selectedDomains.length > 0 || (selectedCircleIds?.length ?? 0) > 0;

  return (
    <div
      className="feed-filter-bar"
      style={{
        display: "flex",
        gap: "0.3rem",
        flexWrap: "nowrap",
        alignItems: "center",
        margin: "0 0 1rem",
        overflowX: "auto",
      }}
    >
      <select
        className="input"
        value={sort}
        onChange={(e) => onSortChange(e.target.value as FeedSort)}
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        className="input"
        value={range}
        onChange={(e) => onRangeChange(e.target.value as FeedRange)}
      >
        {RANGE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {domains.length > 0 && (
        <details className="feed-filter-dropdown">
          <summary className="btn btn-ghost">
            Servers{selectedDomains.length > 0 ? ` (${selectedDomains.length})` : ""}
          </summary>
          <div className="feed-filter-dropdown-menu">
            {domains.map((d) => (
              <label key={d}>
                <input
                  type="checkbox"
                  checked={selectedDomains.includes(d)}
                  onChange={() => onSelectedDomainsChange(toggle(selectedDomains, d))}
                />
                {d}
              </label>
            ))}
          </div>
        </details>
      )}

      {circles && circles.length > 0 && onSelectedCircleIdsChange && (
        <details className="feed-filter-dropdown">
          <summary className="btn btn-ghost">
            Circles{(selectedCircleIds?.length ?? 0) > 0 ? ` (${selectedCircleIds!.length})` : ""}
          </summary>
          <div className="feed-filter-dropdown-menu">
            {circles.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={selectedCircleIds?.includes(c.id) ?? false}
                  onChange={() => onSelectedCircleIdsChange(toggle(selectedCircleIds ?? [], c.id))}
                />
                {c.title}
              </label>
            ))}
          </div>
        </details>
      )}

      {hasActiveFilter && (
        <button
          className="btn btn-ghost"
          onClick={() => {
            onSortChange("new");
            onRangeChange("all");
            onSelectedDomainsChange([]);
            onSelectedCircleIdsChange?.([]);
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
