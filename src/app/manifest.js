import { BRAND } from "@/lib/brand";

/**
 * The install manifest, for a home-screen icon on Android and a standalone
 * window on desktop Chrome.
 *
 * `theme_color` is the brass the icon sits on, so the phone's status bar carries
 * the same ground rather than flashing white behind the mark. `background` is
 * paper, because that is what the app opens onto — matching them to what the
 * user actually sees rather than to a spec sheet is what stops the splash
 * flickering.
 */
export default function manifest() {
  return {
    name: `${BRAND.name} — ${BRAND.tagline}`,
    short_name: BRAND.name,
    description: BRAND.blurb,
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#EDF0EE",
    /* Brass, matching the icon's own ground rather than the app's ink. The
       status bar and the home-screen tile then read as one object on launch
       instead of the icon appearing to sit on a different surface. */
    theme_color: "#B8862F",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // `maskable` lets Android crop to its own shape without clipping the
      // mark, because the icon already carries its own generous margin.
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
