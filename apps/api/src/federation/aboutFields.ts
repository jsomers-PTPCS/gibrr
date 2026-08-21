import type { Actor } from "@prisma/client";
import { z } from "zod";

// Shared by the visibility-map validator and the redaction helper below,
// so the two can't drift apart.
export const ABOUT_FIELD_KEYS = [
  "workplace",
  "hometown",
  "dateOfBirth",
  "gender",
  "languages",
  "education",
  "interests",
  "customFacts",
  "relationshipStatus",
] as const;

export type AboutFieldKey = (typeof ABOUT_FIELD_KEYS)[number];

// "calendarEvents"/"familyMembers"/"friendsList"/"immichPhotos" aren't
// stored Actor columns — they gate live queries elsewhere
// (routes/calendar.ts, routes/family.ts, routes/friends.ts,
// routes/photos.ts) — so they're valid in the visibility map without
// being part of ABOUT_FIELD_KEYS (which redactAboutFields uses to null
// out actual Actor fields). Native photo albums/photos have their own
// per-row visibility columns instead (see prisma/schema.prisma's Album
// and Photo models) — immichPhotos only gates the Immich pass-through,
// which has no per-row control since those aren't rows in our DB.
export const VISIBILITY_KEYS = [
  ...ABOUT_FIELD_KEYS,
  "calendarEvents",
  "familyMembers",
  "friendsList",
  "immichPhotos",
] as const;

export const aboutVisibilitySchema = z.record(z.enum(VISIBILITY_KEYS), z.boolean());

const ARRAY_FIELDS = new Set<AboutFieldKey>(["languages", "interests"]);

// Redacts About fields a non-owner viewer hasn't been granted access to.
// Default is hidden — a field only survives if aboutVisibility[key] is
// explicitly true. The owner always sees their own full data (for
// editing), so this is a no-op when isOwner is true.
export function redactAboutFields<T extends Pick<Actor, AboutFieldKey | "aboutVisibility">>(
  actor: T,
  isOwner: boolean,
): T {
  if (isOwner) return actor;

  const visibility = (actor.aboutVisibility as Record<string, boolean> | null) ?? {};
  const redacted: T = { ...actor };
  const bag = redacted as unknown as Record<string, unknown>;

  for (const key of ABOUT_FIELD_KEYS) {
    if (visibility[key] !== true) {
      bag[key] = ARRAY_FIELDS.has(key) ? [] : null;
    }
  }

  return redacted;
}
