"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

// Renders a group's description — sanitized server-side to a narrow
// safe subset (see api's descriptionHtml.ts) before it's ever stored,
// so this is the one spot in the app that dangerouslySetInnerHTML is
// actually safe to use directly: there's no client-side sanitizer here
// because there doesn't need to be one, the value was never trusted
// from the browser in the first place.
//
// collapsedHeight (px), when set, clamps the rendered content to that
// height with a "Show more"/"Show less" toggle instead of a scrollbar —
// only shown at all if the content actually overflows that height, so
// a short bio never grows a pointless toggle.
export function RenderedDescription({
  html,
  style,
  collapsedHeight,
}: {
  html: string;
  style?: CSSProperties;
  collapsedHeight?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsedHeight || !contentRef.current) return;
    setOverflowing(contentRef.current.scrollHeight > collapsedHeight + 1);
  }, [collapsedHeight, html]);

  if (!collapsedHeight) {
    return <div className="rendered-description" style={style} dangerouslySetInnerHTML={{ __html: html }} />;
  }

  return (
    <div style={style}>
      <div
        ref={contentRef}
        className="rendered-description"
        style={{ maxHeight: expanded ? undefined : collapsedHeight, overflow: "hidden" }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {overflowing && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setExpanded((e) => !e)}
          style={{ padding: "0.1rem 0.5rem", fontSize: "0.8rem", marginTop: "0.25rem" }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
