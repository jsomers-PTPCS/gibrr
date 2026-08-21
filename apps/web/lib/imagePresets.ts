// Built-in preset "pictures" for profile header/background/avatar — hand-
// authored SVGs encoded as data URIs, so there's no external asset fetch
// and no upload/storage involved for these (only the "choose file" option
// touches the server). Purely presentational; the server only validates
// the preset *key* (see apps/api/src/federation/imagePresetKeys.ts), it
// never sees this artwork.

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function headerSvg(stops: string): string {
  return svgToDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300" viewBox="0 0 1200 300">
      <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">${stops}</linearGradient></defs>
      <rect width="1200" height="300" fill="url(#g)"/>
    </svg>`,
  );
}

function avatarSvg(stops: string): string {
  return svgToDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <defs><radialGradient id="g" cx="50%" cy="50%" r="65%">${stops}</radialGradient></defs>
      <circle cx="100" cy="100" r="100" fill="url(#g)"/>
    </svg>`,
  );
}

function stars(count: number): string {
  let dots = "";
  for (let i = 0; i < count; i++) {
    const x = (i * 173) % 1920;
    const y = (i * 97) % 1080;
    const r = (i % 3) + 1;
    const opacity = (0.35 + (i % 5) * 0.12).toFixed(2);
    dots += `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity="${opacity}"/>`;
  }
  return dots;
}

export const HEADER_PRESETS = {
  nebula: {
    label: "Nebula",
    dataUri: headerSvg(
      `<stop offset="0%" stop-color="#3b1d63"/><stop offset="50%" stop-color="#9333ea"/><stop offset="100%" stop-color="#ff8a1e"/>`,
    ),
  },
  sunset: {
    label: "Sunset",
    dataUri: headerSvg(
      `<stop offset="0%" stop-color="#ff8a1e"/><stop offset="50%" stop-color="#ef4444"/><stop offset="100%" stop-color="#9333ea"/>`,
    ),
  },
  ocean: {
    label: "Ocean",
    dataUri: headerSvg(
      `<stop offset="0%" stop-color="#0ea5e9"/><stop offset="50%" stop-color="#0891b2"/><stop offset="100%" stop-color="#134e4a"/>`,
    ),
  },
} as const;

export const BACKGROUND_PRESETS = {
  starfield: {
    label: "Starfield",
    dataUri: svgToDataUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <rect width="1920" height="1080" fill="#0a0710"/>
        ${stars(70)}
      </svg>`,
    ),
  },
  aurora: {
    label: "Aurora",
    dataUri: svgToDataUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <filter id="b"><feGaussianBlur stdDeviation="90"/></filter>
          <radialGradient id="p1" cx="30%" cy="30%" r="60%">
            <stop offset="0%" stop-color="#9333ea" stop-opacity="0.85"/>
            <stop offset="100%" stop-color="#9333ea" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="p2" cx="72%" cy="68%" r="55%">
            <stop offset="0%" stop-color="#22c55e" stop-opacity="0.6"/>
            <stop offset="100%" stop-color="#22c55e" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="1920" height="1080" fill="#0a0710"/>
        <rect width="1920" height="1080" fill="url(#p1)" filter="url(#b)"/>
        <rect width="1920" height="1080" fill="url(#p2)" filter="url(#b)"/>
      </svg>`,
    ),
  },
  grid: {
    label: "Grid",
    dataUri: svgToDataUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <pattern id="g" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#2dd4bf" stroke-width="1" opacity="0.35"/>
          </pattern>
        </defs>
        <rect width="1920" height="1080" fill="#0a0710"/>
        <rect width="1920" height="1080" fill="url(#g)"/>
      </svg>`,
    ),
  },
  // The other three presets are all dark-toned — this is the one bright,
  // saturated option in the set.
  sunburst: {
    label: "Sunburst",
    dataUri: svgToDataUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffd166"/>
            <stop offset="45%" stop-color="#ff8a1e"/>
            <stop offset="100%" stop-color="#ff3d81"/>
          </linearGradient>
        </defs>
        <rect width="1920" height="1080" fill="url(#g)"/>
      </svg>`,
    ),
  },
} as const;

export const AVATAR_PRESETS = {
  nova: {
    label: "Nova",
    dataUri: avatarSvg(`<stop offset="0%" stop-color="#ffd166"/><stop offset="100%" stop-color="#ff8a1e"/>`),
  },
  void: {
    label: "Void",
    dataUri: avatarSvg(`<stop offset="0%" stop-color="#4c1d95"/><stop offset="100%" stop-color="#0a0710"/>`),
  },
  aqua: {
    label: "Aqua",
    dataUri: avatarSvg(`<stop offset="0%" stop-color="#5eead4"/><stop offset="100%" stop-color="#0e7490"/>`),
  },
} as const;

export type HeaderPresetKey = keyof typeof HEADER_PRESETS;
export type BackgroundPresetKey = keyof typeof BACKGROUND_PRESETS;
export type AvatarPresetKey = keyof typeof AVATAR_PRESETS;
