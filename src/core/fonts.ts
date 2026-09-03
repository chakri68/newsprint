/**
 * The type pool.
 *
 * Newspaper clippings do not read as newspaper clippings because the fonts are
 * random — they read that way because each scrap came off a *different press*
 * with a different house style. So the pool is a curated vocabulary of
 * categories, and the picker chooses a category first and a face within it
 * second. Unconstrained random fonts look like a font menu; this looks like a
 * pile of newspapers.
 *
 * Loading matters more than it looks. A CSS-declared face only begins
 * downloading when something *uses* it, and drawing to a canvas does not count
 * as use — so without the explicit `document.fonts.load` calls below, every
 * `measureText` would silently return fallback metrics and the whole
 * composition would be laid out for the wrong typeface.
 */

export type FontCategory =
  | "news-serif"
  | "headline-serif"
  | "grotesk"
  | "condensed"
  | "italic-serif"
  | "typewriter"
  | "classified"
  | "slab";

export interface StudioFont {
  id: string;
  family: string;
  /** Full CSS stack — the fallback is what renders if the CDN is unreachable. */
  stack: string;
  weights: number[];
  /** Has a real italic cut. Faux-oblique is worse than no italic. */
  italic: boolean;
  categories: FontCategory[];
  /** Relative likelihood of being picked. Workhorses outweigh novelties. */
  weight: number;
  /** Per-face tracking nudge, em. Display cuts are often set too tight. */
  tracking?: number;
  /** Faces whose lowercase is weak enough that they want setting in caps. */
  prefersUpper?: boolean;
}

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Helvetica, Arial, sans-serif";
const MONO = "'Courier New', monospace";

export const FONTS: StudioFont[] = [
  {
    id: "playfair",
    family: "Playfair Display",
    stack: `'Playfair Display', ${SERIF}`,
    weights: [400, 500, 600, 700, 800, 900],
    italic: true,
    categories: ["news-serif", "headline-serif", "italic-serif"],
    weight: 10,
  },
  {
    id: "baskerville",
    family: "Libre Baskerville",
    stack: `'Libre Baskerville', ${SERIF}`,
    weights: [400, 700],
    italic: true,
    categories: ["news-serif", "italic-serif"],
    weight: 8,
    tracking: -0.01,
  },
  {
    id: "abril",
    family: "Abril Fatface",
    stack: `'Abril Fatface', ${SERIF}`,
    weights: [400],
    italic: false,
    categories: ["headline-serif", "slab"],
    weight: 6,
  },
  {
    id: "bevan",
    family: "Bevan",
    stack: `Bevan, ${SERIF}`,
    weights: [400],
    italic: false,
    categories: ["slab", "headline-serif"],
    weight: 5,
  },
  {
    id: "archivo-black",
    family: "Archivo Black",
    stack: `'Archivo Black', ${SANS}`,
    weights: [400],
    italic: false,
    categories: ["grotesk"],
    weight: 8,
    prefersUpper: true,
  },
  {
    id: "anton",
    family: "Anton",
    stack: `Anton, ${SANS}`,
    weights: [400],
    italic: false,
    categories: ["condensed", "grotesk"],
    weight: 8,
    prefersUpper: true,
    tracking: 0.01,
  },
  {
    id: "oswald",
    family: "Oswald",
    stack: `Oswald, ${SANS}`,
    weights: [200, 300, 400, 500, 600, 700],
    italic: false,
    categories: ["condensed", "classified"],
    weight: 7,
  },
  {
    id: "roboto-condensed",
    family: "Roboto Condensed",
    stack: `'Roboto Condensed', ${SANS}`,
    weights: [300, 400, 500, 600, 700],
    italic: true,
    categories: ["classified", "condensed", "grotesk"],
    weight: 6,
  },
  {
    id: "special-elite",
    family: "Special Elite",
    stack: `'Special Elite', ${MONO}`,
    weights: [400],
    italic: false,
    categories: ["typewriter"],
    weight: 4,
  },
];

export const FONTS_BY_CATEGORY: Record<FontCategory, StudioFont[]> = {
  "news-serif": [],
  "headline-serif": [],
  grotesk: [],
  condensed: [],
  "italic-serif": [],
  typewriter: [],
  classified: [],
  slab: [],
};
for (const font of FONTS) {
  for (const category of font.categories) FONTS_BY_CATEGORY[category].push(font);
}

export function fontById(id: string): StudioFont {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

/** Nearest available weight — the pool is not uniformly variable. */
export function snapWeight(font: StudioFont, wanted: number): number {
  let best = font.weights[0];
  for (const w of font.weights) {
    if (Math.abs(w - wanted) < Math.abs(best - wanted)) best = w;
  }
  return best;
}

/** Canvas `font` shorthand. Order matters: style, weight, size, family. */
export function cssFont(
  font: StudioFont,
  weight: number,
  size: number,
  italic: boolean,
): string {
  return `${italic && font.italic ? "italic " : ""}${weight} ${size}px ${font.stack}`;
}

/**
 * The type pool's stylesheet, requested from here rather than from a <link> in
 * the document head.
 *
 * A render-blocking stylesheet for nine display faces held up first paint by
 * however long the CDN took, which meant the boot screen -- the thing whose
 * entire job is to cover that wait -- could not paint until the wait was over.
 * Injected here it blocks nothing, and `loadFonts` still refuses to resolve
 * until the faces are genuinely usable.
 */
const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Abril+Fatface&family=Anton&family=Archivo+Black" +
  "&family=Bevan&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400" +
  "&family=Oswald:wght@200..700&family=Playfair+Display:ital,wght@0,400..900;1,400..900" +
  "&family=Roboto+Condensed:ital,wght@0,300..700;1,300..700&family=Special+Elite&display=swap";

function ensureStylesheet(): Promise<void> {
  return new Promise((resolve) => {
    if (document.querySelector("link[data-newsprint-fonts]")) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_CSS;
    link.dataset.newsprintFonts = "";
    // Resolve on failure too: an unreachable CDN should cost you the pool and
    // fall back to the local stacks, not hang the app on a black screen.
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
    document.head.appendChild(link);
  });
}

let loaded: Promise<void> | null = null;

export type FontProgress = (done: number, total: number) => void;

/**
 * Force every face in the pool to actually download, then resolve.
 *
 * `document.fonts.ready` alone is not enough: it resolves when *pending* loads
 * settle, and a face nothing has used yet is not pending. Each `load()` below
 * is the thing that makes it pending. Failures are swallowed per-face — one
 * unreachable font should cost you that font, not the whole tool.
 */
export function loadFonts(onProgress?: FontProgress): Promise<void> {
  if (loaded) return loaded;
  loaded = (async () => {
    // The @font-face rules have to exist before `document.fonts.load` can match
    // anything, or it resolves instantly having loaded nothing at all.
    await ensureStylesheet();

    const requests: string[] = [];
    for (const font of FONTS) {
      // The family alone, quoted -- `load` matches on family, so handing it the
      // whole stack just asks the browser to hunt for Georgia as well.
      const family = `"${font.family}"`;
      for (const weight of font.weights) {
        requests.push(`${weight} 64px ${family}`);
        if (font.italic) requests.push(`italic ${weight} 64px ${family}`);
      }
    }

    let done = 0;
    const total = requests.length;
    onProgress?.(0, total);

    await Promise.all(
      requests.map((request) =>
        document.fonts
          .load(request)
          .catch(() => {})
          .then(() => onProgress?.(++done, total)),
      ),
    );
    await document.fonts.ready;
    onProgress?.(total, total);
  })();
  return loaded;
}
