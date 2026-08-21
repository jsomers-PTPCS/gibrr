import type { Actor } from "@prisma/client";
import { prisma } from "../db.js";
import { localDomain } from "./localActor.js";
import { discoverActor, upsertRemoteActor } from "./remoteActor.js";
import type { MentionToken } from "./textEntities.js";

// Resolves parsed @mention tokens (textEntities.ts) to real Actor rows —
// direct lookup for a bare @user (assumed local, per every fediverse
// client's convention), discoverActor (the same webfinger lookup
// follows.ts and communities.ts's remote-group join already use) for
// @user@domain. Unresolvable tokens are silently dropped — same
// tolerant-parsing posture as the rest of this app's incoming-activity
// handling: a typo'd or since-deleted handle just doesn't become a real
// mention, it doesn't error the whole post.
export async function resolveMentions(
  tokens: MentionToken[],
  signAs?: Pick<Actor, "username" | "domain" | "privateKey">,
): Promise<Actor[]> {
  const resolved: Actor[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const domain = token.domain ?? localDomain();
    const key = `${token.username}@${domain}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (domain === localDomain()) {
      const actor = await prisma.actor.findUnique({
        where: { username_domain: { username: token.username, domain } },
      });
      if (actor) resolved.push(actor);
      continue;
    }

    const remote = await discoverActor(key, signAs);
    if (remote) resolved.push(await upsertRemoteActor(remote));
  }

  return resolved;
}
