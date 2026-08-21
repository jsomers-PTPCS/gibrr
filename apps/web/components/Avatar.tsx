import { API_URL } from "../lib/api";
import { AVATAR_PRESETS, type AvatarPresetKey } from "../lib/imagePresets";

// A remote actor's avatarImageUrl is already an absolute URL (federated
// via icon on their Actor object); only a local upload's relative
// /uploads/... path needs this instance's own API origin prefixed —
// same rule every other image-rendering spot in this app already
// follows (PostItem.tsx, the profile page, etc.).
function assetUrl(path: string) {
  return /^https?:\/\//.test(path) ? path : `${API_URL}${path}`;
}

// Same precedence everywhere an avatar renders: an uploaded image wins
// over a built-in preset, which wins over the plain initial-letter
// placeholder — imageUrl/preset are optional so every existing
// call site that only has a name (no actor row to read them from,
// e.g. a still-loading state) keeps working unchanged.
export function Avatar({
  name,
  size = 32,
  imageUrl,
  preset,
}: {
  name: string;
  size?: number;
  imageUrl?: string | null;
  preset?: AvatarPresetKey | null;
}) {
  if (imageUrl || preset) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl ? assetUrl(imageUrl) : AVATAR_PRESETS[preset!].dataUri}
        alt={name}
        width={size}
        height={size}
        style={{ borderRadius: "50%", objectFit: "cover", display: "block" }}
      />
    );
  }

  const initial = name.charAt(0).toUpperCase();
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden
    >
      {initial}
    </span>
  );
}
