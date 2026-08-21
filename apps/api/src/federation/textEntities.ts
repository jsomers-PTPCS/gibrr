// Pure text parsing — no I/O, no Prisma. Shared by outgoing
// (federation/activities.ts builds the AP `tag` array from these) and
// incoming (routes/inbox.ts parses hashtags straight from a federated
// post's own plain-text body, not trusting the sender's `tag` array
// structure — one code path for local and federated content either
// way) hashtag/mention handling, and by the frontend's #foo/@user
// linkification.

// Boundary check (start of string, whitespace, or an opening paren)
// keeps a URL fragment like "...page#section" or a mid-word "foo#bar"
// from being mistaken for a hashtag.
const HASHTAG_PATTERN = /(?<=^|[\s(])#(\w+)/g;
const MENTION_PATTERN = /(?<=^|[\s(])@(\w+)(?:@([a-zA-Z0-9.-]+(?::[0-9]+)?))?/g;

// Lowercase-normalized so "#Foo" and "#foo" are the same tag everywhere
// they're stored/queried (Post.hashtags, GET /tags/:name).
export function extractHashtagTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const match of text.matchAll(HASHTAG_PATTERN)) {
    tokens.add(match[1].toLowerCase());
  }
  return [...tokens];
}

export interface MentionToken {
  username: string;
  // null = a bare @user, meaning "resolve against this instance's own
  // domain" — the convention every fediverse client follows.
  domain: string | null;
}

export function extractMentionTokens(text: string): MentionToken[] {
  const seen = new Set<string>();
  const tokens: MentionToken[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const username = match[1];
    const domain = match[2] ?? null;
    const key = `${username}@${domain ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push({ username, domain });
  }
  return tokens;
}
