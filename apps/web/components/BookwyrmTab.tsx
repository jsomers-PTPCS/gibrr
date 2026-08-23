"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { getBookwyrmActivity, ApiError, type BookwyrmActivityItem } from "../lib/api";

export function BookwyrmTab({
  username,
  displayName,
  contentBoxStyle,
}: {
  username: string;
  displayName: string;
  contentBoxStyle?: CSSProperties;
}) {
  const [items, setItems] = useState<BookwyrmActivityItem[] | "loading" | "forbidden" | "error">(
    "loading",
  );

  useEffect(() => {
    setItems("loading");
    getBookwyrmActivity(username)
      .then((res) => setItems(res.items))
      .catch((err) => {
        setItems(err instanceof ApiError && err.status === 403 ? "forbidden" : "error");
      });
  }, [username]);

  if (items === "loading") return <p className="text-dim">Loading…</p>;
  if (items === "forbidden") {
    return <p className="text-dim">Only {displayName}&apos;s friends can see their BookWyrm activity.</p>;
  }
  if (items === "error") {
    return <p className="error-text">Could not reach that BookWyrm account right now.</p>;
  }
  if (items.length === 0) {
    return <p className="text-dim">No BookWyrm activity to show yet.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {items.map((item) => (
        <div
          key={item.id}
          className="card"
          style={{ ...contentBoxStyle, display: "flex", gap: "0.75rem", alignItems: "flex-start" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.bookCoverUrl}
            alt={item.bookTitle ?? ""}
            style={{ width: 56, height: 84, objectFit: "cover", borderRadius: "var(--radius-sm)", flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ margin: 0 }}
              // BookWyrm's own content HTML, sanitized server-side
              // (federation/bookwyrmActivity.ts) the same way a remote
              // actor's summary is — same rendering approach as
              // RenderedDescription elsewhere in this app.
              dangerouslySetInnerHTML={{ __html: item.contentHtml }}
            />
            <p className="text-faint" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
              <a href={item.id} target="_blank" rel="noreferrer">
                View on BookWyrm ↗
              </a>{" "}
              — {new Date(item.publishedAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
