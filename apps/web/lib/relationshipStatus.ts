// Mirrors apps/api/src/federation/relationshipStatus.ts — small
// duplicated constant, same call made for other closed-vocabulary
// lists in this project (fonts, image presets, About field keys).
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

export const RELATIONSHIP_STATUS_LABELS: Record<RelationshipStatus, string> = {
  single: "Single",
  in_a_relationship: "In a relationship",
  engaged: "Engaged",
  married: "Married",
  its_complicated: "It's complicated",
  separated: "Separated",
  divorced: "Divorced",
  widowed: "Widowed",
};
