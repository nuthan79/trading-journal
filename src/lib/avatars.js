/**
 * The pictures you can have without uploading one.
 *
 * WHY PRESETS AT ALL. The only way to have a face here was to find a photo and
 * upload it, which at the exact moment of signing up is an errand nobody came
 * to run — so everybody skipped it and every account looked identical. A row
 * of ready-made ones turns a chore into a click.
 *
 * DRAWN, NOT FILES. Each is a few hundred bytes of SVG built from an index, so
 * there is nothing to host, nothing in the storage bucket, no signed URL to
 * expire and nothing for a content policy to block. They also cost no network
 * request at all, which matters on the first screen somebody ever sees.
 *
 * STORED IN avatar_path, AS A SENTINEL. `profiles.avatar_path` normally holds
 * a path inside the avatars bucket; a preset stores "preset:3" instead. One
 * column, so "which picture" always has exactly one answer — a separate
 * avatar_preset column would let an upload and a preset both be set, and then
 * every screen that draws a face has to decide which wins.
 *
 * TWO THINGS VARY, NOT ONE. The first attempt changed only the colour, and
 * changed it within one muted family — ten desaturated greens, tans and
 * blue-greys wearing the identical silhouette, which at 42px is ten copies of
 * the same picture. Hue alone is also the wrong axis to lean on: roughly one
 * man in twelve cannot separate red from green, and a set told apart by colour
 * is a set they cannot tell apart at all. So each one has its own hue AND its
 * own outline, and the outlines still work in greyscale.
 *
 * THE PALETTE IS DELIBERATELY SATURATED, including the reds and greens the
 * rest of the app reserves for losses and gains. That reservation was carried
 * over here by mistake: it applies to numbers in a table, where a colour is
 * asserting something. A face in a circle asserts nothing.
 */

/**
 * Ten hues spread around the wheel, each with a darker tone for hair and
 * accessories. Neighbours are kept far enough apart that two of them never
 * arrive at the same impression — the earlier set had four blues in it.
 */
const PALETTE = [
  { bg: "#E23E57", dark: "#8E1F31" },   // crimson
  { bg: "#F4791F", dark: "#96420A" },   // orange
  { bg: "#F2B705", dark: "#8A6600" },   // amber
  { bg: "#7CB518", dark: "#41610A" },   // lime
  { bg: "#0F9B6C", dark: "#075740" },   // green
  { bg: "#0FA3B1", dark: "#065C65" },   // cyan
  { bg: "#2D7DD2", dark: "#164477" },   // blue
  { bg: "#5B3FD4", dark: "#301F79" },   // indigo
  { bg: "#9B51E0", dark: "#54277D" },   // violet
  { bg: "#D6336C", dark: "#7A1839" },   // magenta
];

/** The face itself, on every variant. Near-white rather than pure, so it sits
 *  on the colour instead of glaring off it. */
const SKIN = "#FDFBF7";

export const PRESET_COUNT = PALETTE.length;

const PREFIX = "preset:";

/** Is this stored value one of ours rather than a path in the bucket? */
export const isPreset = (path) => typeof path === "string" && path.startsWith(PREFIX);

/** Which one, clamped — an out-of-range index from an older build should
 *  degrade to a valid picture rather than to nothing at all. */
export function presetIndex(path) {
  if (!isPreset(path)) return null;
  const n = parseInt(path.slice(PREFIX.length), 10);
  return Number.isFinite(n) ? ((n % PRESET_COUNT) + PRESET_COUNT) % PRESET_COUNT : 0;
}

export const presetPath = (i) => `${PREFIX}${((i % PRESET_COUNT) + PRESET_COUNT) % PRESET_COUNT}`;

/**
 * Narrower than the first attempt, which spread nearly the full width and left
 * the head reading as a small dot on a large blob.
 */
const SHOULDERS = `<path d="M32 41c-9 0-16 6-18 15a32 32 0 0 0 36 0c-2-9-9-15-18-15z" fill="${SKIN}"/>`;
const HEAD = `<circle cx="32" cy="25" r="12" fill="${SKIN}"/>`;

/**
 * Ten silhouettes.
 *
 * EACH ONE CHANGES THE OUTLINE, which the first attempt did not — four of them
 * merely added a small dark accent to an identical head, and in greyscale
 * those four were the same picture. So the hair extends past the skull, the
 * cap's brim is wider than the face, the headphone cups sit outside it, and
 * one head is square rather than round. If a variant only reads by its colour
 * it has failed, because colour is exactly what a colour-blind visitor and a
 * greyscale render both take away.
 *
 * Drawn behind the head where the shape should read as depth, in front of it
 * where it should read as worn — order is what makes a hat a hat rather than
 * a stripe.
 */
function figure(i, dark) {
  const dome = `<path d="M32 12a14 14 0 0 0-14 14h28a14 14 0 0 0-14-14z" fill="${dark}"/>`;

  switch (i) {
    case 0:  // bare
      return HEAD + SHOULDERS;
    case 1:  // cropped hair
      return HEAD + dome + SHOULDERS;
    case 2:  // topknot
      return `<circle cx="32" cy="7" r="5.5" fill="${dark}"/>` + HEAD + dome + SHOULDERS;
    case 3:  // long hair — past the jaw, so the outline itself widens
      return `<path d="M14 26a18 18 0 0 1 36 0v18h-9V26a9 9 0 0 0-18 0v18h-9z" fill="${dark}"/>` +
             HEAD + dome + SHOULDERS;
    case 4:  // cap, brim wider than the face
      return HEAD + dome +
             `<rect x="11" y="23.5" width="42" height="4.5" rx="2.25" fill="${dark}"/>` + SHOULDERS;
    case 5:  // glasses
      return HEAD + SHOULDERS +
             `<g fill="none" stroke="${dark}" stroke-width="2.6">` +
             `<circle cx="26" cy="25" r="5"/><circle cx="38" cy="25" r="5"/>` +
             `<path d="M31 25h2"/></g>`;
    // Cubic curves rather than an elliptical arc. The first attempt used
    // `a12 12 0 0 0 24 0` and the sweep flag sent it the wrong way round,
    // producing a path that enclosed nothing — the beard was simply absent,
    // and absent in greyscale too, which is how it was caught.
    case 6:  // beard over the lower face
      return HEAD +
             `<path d="M21 26c0 9 4.5 14 11 14s11-5 11-14z" fill="${dark}"/>` +
             SHOULDERS;
    case 7:  // ponytail, well clear of the head
      return `<circle cx="50" cy="22" r="6.5" fill="${dark}"/>` +
             `<path d="M40 20h8v6h-8z" fill="${dark}"/>` + HEAD + dome + SHOULDERS;
    case 8:  // headphones, cups outside the skull
      return HEAD + SHOULDERS +
             `<path d="M17 25a15 15 0 0 1 30 0" fill="none" stroke="${dark}" stroke-width="3.4"/>` +
             `<rect x="12" y="21" width="7.5" height="13" rx="3.5" fill="${dark}"/>` +
             `<rect x="44.5" y="21" width="7.5" height="13" rx="3.5" fill="${dark}"/>`;
    default: // square head — different in outline before any colour is seen
      return `<rect x="20" y="13" width="24" height="24" rx="3" fill="${SKIN}"/>` + SHOULDERS;
  }
}

/** The picture itself, as a data URI. */
export function presetDataUri(i) {
  const n = ((i % PRESET_COUNT) + PRESET_COUNT) % PRESET_COUNT;
  const { bg, dark } = PALETTE[n];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="32" fill="${bg}"/>` +
    figure(n, dark) +
    `</svg>`;
  // encodeURIComponent rather than base64: shorter for this, and readable in
  // devtools when something is wrong.
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
