import { z } from "zod";

// The server only needs to validate that a preset key is one of the known
// values — the actual SVG artwork lives client-side
// (apps/web/lib/imagePresets.ts) since it's just static presentation, not
// data the API needs to know about.
export const headerPresetKeySchema = z.enum(["nebula", "sunset", "ocean"]);
export const backgroundPresetKeySchema = z.enum(["starfield", "aurora", "grid", "sunburst"]);
export const avatarPresetKeySchema = z.enum(["nova", "void", "aqua"]);
