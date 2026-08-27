import sanitizeHtml from "sanitize-html";
import { decodeHTML } from "entities";

// Gibrr has no rich-text authoring or rendering anywhere — an incoming
// federated Note's `content` is HTML (per the AP convention this app's
// own createNoteFromPost/createNoteFromComment already follow), so it's
// flattened to plain text on the way in rather than building a safe HTML
// renderer for arbitrary remote markup. Reuses the sanitize-html
// dependency already in this repo (federation/sanitizeProfileHtml.ts)
// with an empty tag allowlist — everything is stripped except the text.
//
// sanitize-html only ever produces safe *HTML* — with entities like
// "&amp;amp;" left encoded, since that's still valid HTML — so its
// output alone is not the plain text this function promises callers
// (routes/inbox.ts, routes/starterPacks.ts) and they store verbatim as
// a plain-text DB column. decodeHTML() is the step that actually turns
// "&amp;amp;" back into a literal "&amp;" before it's saved; skipping it
// is what previously made every "&" in federated content round-trip
// back to the browser as the literal text "&amp;amp;".
export function toPlainText(html: string): string {
  // Stripping tags outright (sanitize-html's default) would squash
  // "<p>one</p><p>two</p>" into "onetwo" — turn block breaks into real
  // newlines first, matching the \n\n-paragraph / \n-line shape this
  // app's own toHtmlContent (above) already produces going the other way.
  // Headers/blockquotes/list items get the same paragraph-level break —
  // without it, a Lemmy-style community description (real markup: <h1>
  // Rules</h1><blockquote>...) runs every section together with no
  // visible separation once tags are stripped.
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|blockquote|li)>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n");

  const stripped = decodeHTML(sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} }));

  return stripped
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
