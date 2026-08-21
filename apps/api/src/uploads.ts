import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(currentDir, "..", "uploads");

interface ResizeSpec {
  width: number;
  height: number;
  fit: "cover" | "inside";
}

// Runs an uploaded image buffer through sharp before it ever touches disk.
// This is the actual validation (sharp throws on anything that isn't a
// real image, regardless of what extension/Content-Type the client sent)
// and it strips EXIF metadata + normalizes everything to WebP, so what's
// stored is never the attacker-controlled original bytes.
export async function saveProcessedImage(buffer: Buffer, spec: ResizeSpec): Promise<string> {
  const resized = sharp(buffer)
    .resize(spec.width, spec.height, {
      fit: spec.fit,
      // "inside" (the background image spec) is a max-size cap, not a
      // target to fill — a small source image should stay small, not get
      // blown up and blurry. "cover" (avatar/header) crops to an exact
      // box, where filling it is the point, so enlargement is fine there.
      withoutEnlargement: spec.fit === "inside",
    })
    .webp();
  const output = await resized.toBuffer();

  await mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `${randomUUID()}.webp`;
  await writeFile(path.join(UPLOADS_DIR, filename), output);

  return `/uploads/${filename}`;
}

// Writes an already-validated buffer as-is — no re-encoding pipeline
// exists for this (unlike saveProcessedImage), so the caller must have
// already confirmed the buffer's real type via magic-byte sniffing
// (see routes/posts.ts's POST /posts/media, the only caller). `ext`
// comes from that detection, not from any client-supplied filename.
export async function saveValidatedFile(buffer: Buffer, ext: string): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  await writeFile(path.join(UPLOADS_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

export { UPLOADS_DIR };
