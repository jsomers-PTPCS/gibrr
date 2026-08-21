import sanitizeHtml from "sanitize-html";

// Community descriptions are the one text field in this app that's
// actually rendered as HTML on the page (not inside a sandboxed iframe
// the way profile customHtml is — see sanitizeProfileHtml.ts's own
// comment on that containment model). Sanitization here is the *only*
// containment, so this allowlist is deliberately narrower than that
// one: no style/class/img/marquee/font, nothing that could carry a
// tracking pixel or CSS-based attack — just the structural/text-level
// tags a real bio (a local group's own, or a remote Lemmy/Mastodon
// group's real summary) actually needs.
const ALLOWED_TAGS = [
  "p", "br", "hr",
  "a",
  "strong", "em", "b", "i", "code", "pre",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote",
];

export function sanitizeDescriptionHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    // target/rel have to be allowlisted too, not just href — otherwise
    // sanitize-html's attribute filter (which runs after transformTags
    // below) strips the very attributes the transform just added.
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
    // Every link renders on our own domain, never inside a sandbox —
    // force target/rel the same way a real link-out anywhere else in
    // this app would need, rather than trusting whatever the source
    // markup set (or didn't).
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "nofollow noopener" }),
    },
  });
}

// A quick, deliberately imperfect check for "does this already look
// like markup" — real HTML (a remote actor's summary) always has at
// least one tag; plain text typed into a local textarea never does
// (a bare "<3" or "5 < 10" would false-positive here, but sanitizeHtml
// downstream just discards whatever it doesn't recognize as a real
// tag, so a false positive costs nothing worse than an unnecessary
// sanitize pass).
function looksLikeHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}

// Converts genuinely plain text (typed into a local textarea, no
// markup) into the same blank-line-paragraph / single-newline-<br>
// shape federation/activities.ts's toHtmlContent already produces for
// outgoing posts — so a local group's own description, once rendered,
// looks the same as a remote one's.
function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter((block) => block.trim().length > 0)
    .map((block) => `<p>${block}</p>`)
    .join("");
}

// The single entry point routes/communities.ts uses for every incoming
// description, local or remote: real markup gets sanitized down to a
// safe subset and kept as real HTML; plain text gets promoted to HTML
// first so it renders with the same paragraph structure. Either way,
// what's stored is safe to render directly.
export function toDescriptionHtml(text: string): string {
  return sanitizeDescriptionHtml(looksLikeHtml(text) ? text : plainTextToHtml(text));
}
