import sanitizeHtml from "sanitize-html";

// Defense-in-depth for MySpace-style profile customization: the real
// containment is that this HTML only ever gets rendered inside a
// sandbox="" iframe (see components/CustomProfileFrame.tsx on the web
// side), which blocks script execution outright regardless of what's in
// the markup. Sanitizing at write time means the *stored* value is clean
// too, in case anything else ever reads this field.
const ALLOWED_TAGS = [
  "div", "span", "p", "br", "hr",
  "a", "img",
  "b", "i", "u", "strong", "em", "small", "sub", "sup",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "td", "th",
  "blockquote", "pre", "code",
  // old-school MySpace nostalgia — harmless without script execution
  "marquee", "center", "font",
];

export function sanitizeProfileHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      "*": ["style", "class", "id", "align"],
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      font: ["color", "face", "size"],
      marquee: ["behavior", "direction", "scrollamount"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
  });
}
