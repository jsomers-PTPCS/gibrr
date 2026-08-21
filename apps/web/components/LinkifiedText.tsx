"use client";

import Link from "next/link";
import { Fragment } from "react";

// Display-only mirror of apps/api/src/federation/textEntities.ts's
// token shapes — this doesn't need to match byte-for-byte with what the
// server actually extracted/federated, it just needs to make #tags and
// @mentions in already-rendered text look and behave like real links.
const TOKEN_PATTERN = /(?<=^|[\s(])(#\w+|@\w+(?:@[a-zA-Z0-9.-]+(?::[0-9]+)?)?)/g;

// Renders plain post/comment body text with #hashtag and @mention tokens
// turned into real links, and newlines preserved as line breaks (the
// body is plain text, not HTML, so nothing else does this for free).
// Remote mentions (@user@domain) render as bold text, not a link — this
// app has no remote-actor profile page to send them to, a disclosed
// gap, not a bug.
export function LinkifiedText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {lineIndex > 0 && <br />}
          {line.split(TOKEN_PATTERN).map((part, partIndex) => {
            if (part.startsWith("#")) {
              return (
                <Link key={partIndex} href={`/tag/${encodeURIComponent(part.slice(1).toLowerCase())}`}>
                  {part}
                </Link>
              );
            }
            if (part.startsWith("@")) {
              const isRemote = part.slice(1).includes("@");
              if (isRemote) {
                return (
                  <span key={partIndex} style={{ fontWeight: 600 }}>
                    {part}
                  </span>
                );
              }
              return (
                <Link key={partIndex} href={`/u/${encodeURIComponent(part.slice(1))}`} style={{ fontWeight: 600 }}>
                  {part}
                </Link>
              );
            }
            return <Fragment key={partIndex}>{part}</Fragment>;
          })}
        </Fragment>
      ))}
    </>
  );
}
