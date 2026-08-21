import { z } from "zod";

// Closed vocabulary for Actor.relationshipStatus — a free self-description,
// no confirmation needed (unlike tagging a specific person via FamilyLink,
// see routes/family.ts).
export const RELATIONSHIP_STATUSES = [
  "single",
  "in_a_relationship",
  "engaged",
  "married",
  "its_complicated",
  "separated",
  "divorced",
  "widowed",
] as const;

export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const relationshipStatusSchema = z.enum(RELATIONSHIP_STATUSES);
