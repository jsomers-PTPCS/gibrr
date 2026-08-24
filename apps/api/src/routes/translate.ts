import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/session.js";
import { translateText, getTranslateLanguages, translationConfigured } from "../federation/translate.js";

export const translateRouter = Router();

// GET /translate/languages -> populates the frontend's target-language
// picker, and doubles as "is this feature even set up" (an instance with
// no LIBRETRANSLATE_URL just gets an empty list back, same shape as one
// whose LibreTranslate hasn't finished downloading its models yet — the
// frontend treats both the same way: hide the feature, don't error).
translateRouter.get("/translate/languages", requireAuth, async (_req, res) => {
  if (!translationConfigured()) return res.json([]);
  const languages = await getTranslateLanguages();
  res.json(languages ?? []);
});

const translateSchema = z.object({
  text: z.string().min(1).max(10_000),
  target: z.string().min(2).max(10),
});

// POST /translate { text, target } -> a post's own "Translate this"
// button, not tied to any particular post id — the frontend already has
// the text (a post's body, already rendered), so this just needs
// whatever string was clicked on. Never persisted: translating the same
// text into the same language twice just costs two requests, which is
// fine at this app's scale and keeps this endpoint stateless.
translateRouter.post("/translate", requireAuth, async (req, res) => {
  const parsed = translateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (!translationConfigured()) {
    return res.status(503).json({ error: "translation isn't set up on this instance" });
  }

  const translatedText = await translateText(parsed.data.text, parsed.data.target);
  if (translatedText === null) {
    return res.status(502).json({ error: "translation failed — try again in a moment" });
  }
  res.json({ translatedText });
});
