// Mirrors the Prisma FamilyRelationType enum (apps/api/prisma/schema.prisma)
// — small duplicated constant, same pattern used elsewhere in this project.
export const FAMILY_RELATION_TYPES = [
  "partner",
  "spouse",
  "parent",
  "child",
  "sibling",
  "other",
] as const;

export type FamilyRelationType = (typeof FAMILY_RELATION_TYPES)[number];

export const FAMILY_RELATION_LABELS: Record<FamilyRelationType, string> = {
  partner: "Partner",
  spouse: "Spouse",
  parent: "Parent",
  child: "Child",
  sibling: "Sibling",
  other: "Family member",
};
