import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { toPublicActor, localDomain, isLocalActor, actorIri } from "../federation/localActor.js";
import { discoverActor, upsertRemoteActor } from "../federation/remoteActor.js";
import { deliverActivity } from "../federation/deliver.js";
import { createNoteFromMessage, createActivity, messageObjectIri } from "../federation/activities.js";
import { requireAuth } from "../auth/session.js";

export const conversationsRouter = Router();

const senderSelect = { username: true, domain: true, displayName: true } as const;

// A bare username (assumed local, same convention @mentions/handles use
// everywhere else in this app) or a full user@domain fediverse handle.
const handleSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_]+(@[a-zA-Z0-9.-]+(:[0-9]+)?)?$/, "expected a username or the form user@domain");

const startConversationSchema = z.object({ handle: handleSchema });

// POST /conversations -> find-or-create a 1:1 conversation with a local
// or remote user (same webfinger-discovery shape as POST /follows/
// POST /blocks). A remote target must be a Person — DMs are
// person-to-person, not addressed to a group.
conversationsRouter.post("/conversations", requireAuth, async (req, res) => {
  const parsed = startConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const [username, domain] = parsed.data.handle.includes("@")
    ? parsed.data.handle.split("@")
    : [parsed.data.handle, localDomain()];

  let target = await prisma.actor.findFirst({ where: { username, domain } });
  if (!target && domain !== localDomain()) {
    const remote = await discoverActor(parsed.data.handle, req.actor!);
    if (!remote) return res.status(404).json({ error: "could not resolve that handle" });
    if (remote.type !== "Person") {
      return res.status(400).json({ error: "that handle is a group, not a person" });
    }
    target = await upsertRemoteActor(remote);
  }
  if (!target) return res.status(404).json({ error: "user not found" });
  if (target.id === req.actor!.id) {
    return res.status(400).json({ error: "cannot start a conversation with yourself" });
  }

  const existing = await prisma.conversation.findFirst({
    where: {
      participants: { some: { actorId: req.actor!.id } },
      AND: { participants: { some: { actorId: target.id } } },
    },
    include: { participants: true },
  });

  const conversation =
    existing && existing.participants.length === 2
      ? existing
      : await prisma.$transaction(async (tx) => {
          const conv = await tx.conversation.create({ data: {} });
          await tx.conversationParticipant.createMany({
            data: [
              { conversationId: conv.id, actorId: req.actor!.id },
              { conversationId: conv.id, actorId: target.id },
            ],
          });
          return conv;
        });

  res.json({ id: conversation.id, otherActor: toPublicActor(target) });
});

// GET /conversations -> the caller's conversations, most recent first,
// each with the other participant, last message, and unread count.
conversationsRouter.get("/conversations", requireAuth, async (req, res) => {
  const myParticipations = await prisma.conversationParticipant.findMany({
    where: { actorId: req.actor!.id },
    include: {
      conversation: {
        include: {
          participants: { include: { actor: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  const conversations = await Promise.all(
    myParticipations.map(async (participation) => {
      const { conversation } = participation;
      const other = conversation.participants.find((p) => p.actorId !== req.actor!.id)?.actor;
      const lastMessage = conversation.messages[0] ?? null;
      const unreadCount = await prisma.message.count({
        where: {
          conversationId: conversation.id,
          senderActorId: { not: req.actor!.id },
          createdAt: { gt: participation.lastReadAt ?? new Date(0) },
        },
      });

      return {
        id: conversation.id,
        otherActor: other ? toPublicActor(other) : null,
        lastMessage,
        unreadCount,
        updatedAt: lastMessage?.createdAt ?? conversation.createdAt,
      };
    }),
  );

  conversations.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  res.json(conversations);
});

// GET /conversations/:id/messages -> most recent 50 messages, oldest
// first. Opening the thread marks it read (updates lastReadAt) — the same
// behavior real Messenger has, with no separate "mark read" endpoint.
conversationsRouter.get("/conversations/:id/messages", requireAuth, async (req, res) => {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_actorId: { conversationId: req.params.id, actorId: req.actor!.id } },
  });
  if (!participant) return res.status(403).json({ error: "not a participant" });

  const recent = await prisma.message.findMany({
    where: { conversationId: req.params.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { sender: { select: senderSelect } },
  });

  await prisma.conversationParticipant.update({
    where: { id: participant.id },
    data: { lastReadAt: new Date() },
  });

  res.json(recent.reverse());
});

const sendMessageSchema = z.object({ body: z.string().min(1).max(5000) });

conversationsRouter.post("/conversations/:id/messages", requireAuth, async (req, res) => {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_actorId: { conversationId: req.params.id, actorId: req.actor!.id } },
  });
  if (!participant) return res.status(403).json({ error: "not a participant" });

  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  // The previous message in this thread, if any — chained via inReplyTo
  // on the delivered Note purely for a receiving client's own display
  // (federation/activities.ts's createNoteFromMessage); this app's own
  // conversation routing (routes/inbox.ts) never depends on it.
  const previousMessage = await prisma.message.findFirst({
    where: { conversationId: req.params.id },
    orderBy: { createdAt: "desc" },
  });

  const message = await prisma.message.create({
    data: {
      conversationId: req.params.id,
      senderActorId: req.actor!.id,
      body: parsed.data.body,
    },
    include: { sender: { select: senderSelect } },
  });

  const recipient = await prisma.conversationParticipant.findFirst({
    where: { conversationId: req.params.id, actorId: { not: req.actor!.id } },
    include: { actor: true },
  });
  if (recipient && !isLocalActor(recipient.actor)) {
    const note = createNoteFromMessage(
      message,
      req.actor!,
      actorIri(recipient.actor),
      previousMessage ? messageObjectIri(previousMessage) : undefined,
    );
    void deliverActivity(req.actor!, recipient.actor.inboxUrl, createActivity(note, req.actor!));
  }

  res.status(201).json(message);
});
