import { prisma } from "../db.js";
import { createLocalActor, localDomain } from "../federation/localActor.js";

async function main() {
  const domain = localDomain();
  const username = "testuser";

  const existing = await prisma.actor.findUnique({
    where: { username_domain: { username, domain } },
  });
  if (existing) {
    console.log(`actor ${username}@${domain} already exists (${existing.id})`);
    return;
  }

  const actor = await prisma.$transaction((tx) =>
    createLocalActor(tx, {
      username,
      type: "Person",
      displayName: "Test User",
      summary: "A local test actor for verifying the federation skeleton.",
    }),
  );

  console.log(`created actor ${actor.username}@${actor.domain} (${actor.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
