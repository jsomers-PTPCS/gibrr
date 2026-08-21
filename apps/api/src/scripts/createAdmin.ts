// Bootstrap the first instance admin when standing up a new server:
//
//   pnpm create-admin <email> <username> <password>
//
// If a LocalUser with that email already exists, promotes it to admin
// (password/username are ignored in that case — pass just the email, or
// any placeholder for the rest). Otherwise creates a brand-new local
// actor + LocalUser the same way POST /auth/register does, with
// isAdmin: true from the start. Safe to run more than once.
import { prisma } from "../db.js";
import { createLocalActor } from "../federation/localActor.js";
import { hashPassword } from "../federation/passwords.js";

async function main() {
  const [email, username, password] = process.argv.slice(2);
  if (!email) {
    console.error("usage: pnpm create-admin <email> <username> <password>");
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.localUser.findUnique({ where: { email }, include: { actor: true } });
  if (existing) {
    if (existing.isAdmin) {
      console.log(`${existing.actor.username} <${email}> is already an admin`);
      return;
    }
    await prisma.localUser.update({ where: { id: existing.id }, data: { isAdmin: true } });
    console.log(`promoted ${existing.actor.username} <${email}> to admin`);
    return;
  }

  if (!username || !password) {
    console.error(`no account with ${email} exists yet — usage: pnpm create-admin <email> <username> <password>`);
    process.exitCode = 1;
    return;
  }

  const existingUsername = await prisma.actor.findFirst({ where: { username } });
  if (existingUsername) {
    console.error(`username "${username}" is already taken`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);
  const localUser = await prisma.$transaction(async (tx) => {
    const actor = await createLocalActor(tx, { username, type: "Person" });
    return tx.localUser.create({
      data: { actorId: actor.id, email, passwordHash, isAdmin: true },
      include: { actor: true },
    });
  });

  console.log(`created admin ${localUser.actor.username}@${localUser.actor.domain} <${email}>`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
