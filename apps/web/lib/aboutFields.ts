// Mirrors apps/api/src/federation/aboutFields.ts's key list — kept as a
// small duplicated constant rather than a shared package, same call made
// for font/image presets earlier in this project.
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

export const ABOUT_FIELD_LABELS: Record<AboutFieldKey, string> = {
  workplace: "Workplace",
  hometown: "Hometown",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  languages: "Languages",
  education: "Education",
  interests: "Hobbies & interests",
  customFacts: "More about you",
  relationshipStatus: "Relationship status",
};

// Not Actor columns (they gate live queries against other tables, not
// stored profile data — see routes/calendar.ts, routes/friends.ts,
// routes/family.ts), so these are kept out of ABOUT_FIELD_KEYS. Their
// visibility flags still ride in the same aboutVisibility map, under
// these labels, for the same "hidden until you opt in" UX.
export const CALENDAR_VISIBILITY_LABEL = "Upcoming events";
export const FRIENDS_LIST_VISIBILITY_LABEL = "Friends list";
export const FAMILY_MEMBERS_VISIBILITY_LABEL = "Family members";
// Native albums/photos have their own per-row visibility instead — this
// only gates the Immich pass-through (one flag for the whole connection).
export const IMMICH_VISIBILITY_LABEL = "Photos from Immich";
