// Mirrors the role/privacy vocab enforced in apps/api/src/routes/communities.ts
// — small duplicated constant, same pattern used for every other closed
// vocabulary in this project.
export const GROUP_ROLES = ["owner", "admin", "moderator", "member"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export const GROUP_ROLE_LABELS: Record<GroupRole, string> = {
  owner: "Owner",
  admin: "Host",
  moderator: "Anchor",
  member: "Member",
};

export const GROUP_PRIVACY_LEVELS = ["public", "private", "secret"] as const;
export type GroupPrivacy = (typeof GROUP_PRIVACY_LEVELS)[number];

export const GROUP_PRIVACY_LABELS: Record<GroupPrivacy, string> = {
  public: "Public",
  private: "Private",
  secret: "Secret",
};

export const GROUP_PRIVACY_DESCRIPTIONS: Record<GroupPrivacy, string> = {
  public: "Anyone can see this circle and join instantly.",
  private: "Visible in listings — joining requires approval from a host or anchor.",
  secret: "Hidden from listings and search — only reachable with a direct link, still requires approval.",
};
