import { prisma } from "../db.js";
import { generateActorKeyPair } from "../federation/keys.js";

async function main() {
  const domain = process.env.DOMAIN ?? `localhost:${process.env.PORT ?? 4000}`;
  const username = "testuser";

  const existing = await prisma.actor.findUnique({
    where: { username_domain: { username, domain } },
  });
  if (existing) {
    console.log(`actor ${username}@${domain} already exists (${existing.id})`);
    return;
  }

  const { publicKey, privateKey } = generateActorKeyPair();
  const actorUrl = `http://${domain}/users/${username}`;

  const actor = await prisma.actor.create({
    data: {
      username,
      domain,
      displayName: "Test User",
      summary: "A local test actor for verifying the federation skeleton.",
      publicKey,
      privateKey,
      inboxUrl: `${actorUrl}/inbox`,
      outboxUrl: `${actorUrl}/outbox`,
    },
  });

  console.log(`created actor ${actor.username}@${actor.domain} (${actor.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
