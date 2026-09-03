/**
 * Settings, defaults and presets.
 *
 * Every length here is in *page units* — the artwork's own coordinate space,
 * independent of how many device pixels it eventually lands on. Rasterisation
 * scale is a separate, non-preset knob (fit-to-well for the preview, a
 * multiplier for export), so one settings object describes the same composition
 * whether it renders at 1600px or 6400px. That separation is what makes export
 * a re-render rather than an upscale of the preview.
 */

export type TokenMode = "word" | "character";
export type LayoutMode = "baseline" | "loose" | "stacked" | "scatter";
export type PaperShape = "rectangle" | "rough-rectangle" | "torn";
export type Background = "board" | "white" | "black" | "transparent";

export interface Settings {
  tokenMode: TokenMode;
  layout: LayoutMode;

  // Typography variation. All 0..1 — how far each token may drift from the
  // phrase's base treatment, never absolute values.
  fontVariation: number;
  sizeVariation: number;
  weightVariation: number;
  trackingVariation: number;
  uppercaseChance: number;
  italicChance: number;

  // Paper.
  paperShape: PaperShape;
  paperAge: number;
  paperGrain: number;
  edgeRoughness: number;
  paddingX: number;
  paddingY: number;
  paddingVariation: number;

  // Ink.
  inkBleed: number;
  inkDistress: number;
  inkFade: number;
  ghosting: number;

  // The faint printing the word was cut out of.
  backgroundPrint: number;

  // Composition.
  rotation: number; // degrees, max deviation
  positionJitter: number;
  overlap: number;
  fill: number; // how much of the page the composition occupies

  // Global finishing pass.
  photocopy: number;
  background: Background;
  /** Corner rounding, as a fraction of the page's shorter side. 0 is square. */
  cornerRadius: number;
}

export const DEFAULTS: Settings = {
  tokenMode: "word",
  layout: "loose",

  fontVariation: 0.75,
  sizeVariation: 0.3,
  weightVariation: 0.45,
  trackingVariation: 0.2,
  uppercaseChance: 0.2,
  italicChance: 0.08,

  paperShape: "rough-rectangle",
  paperAge: 0.2,
  paperGrain: 0.25,
  edgeRoughness: 0.25,
  paddingX: 14,
  paddingY: 8,
  paddingVariation: 0.25,

  inkBleed: 0.1,
  inkDistress: 0.15,
  inkFade: 0.05,
  ghosting: 0.05,

  backgroundPrint: 0.35,

  rotation: 5,
  positionJitter: 0.2,
  overlap: 0.05,
  fill: 0.82,

  photocopy: 0,
  background: "board",
  cornerRadius: 0,
};

export type PresetName =
  | "Clean Editorial"
  | "Daily News"
  | "Cut & Paste"
  | "Punk Xerox"
  | "Archive";

/**
 * Presets are merged over DEFAULTS, never over the current state — so picking
 * one twice, or hopping between two, always lands on the same composition
 * whatever you were looking at when you clicked.
 */
export const PRESETS: Record<PresetName, Partial<Settings>> = {
  // Restrained. Reads as a designed page rather than as a ransom note.
  "Clean Editorial": {
    layout: "baseline",
    fontVariation: 0.25,
    sizeVariation: 0.12,
    weightVariation: 0.2,
    uppercaseChance: 0.1,
    italicChance: 0.04,
    paperShape: "rectangle",
    paperAge: 0.1,
    paperGrain: 0.15,
    edgeRoughness: 0,
    inkBleed: 0.05,
    inkDistress: 0.04,
    inkFade: 0.02,
    ghosting: 0,
    backgroundPrint: 0.18,
    rotation: 1.2,
    positionJitter: 0.06,
    overlap: 0,
    photocopy: 0,
  },
  // The reference look. Aged stock, real background print, gentle tearing.
  "Daily News": {
    layout: "loose",
    fontVariation: 0.6,
    sizeVariation: 0.26,
    weightVariation: 0.4,
    paperShape: "rough-rectangle",
    paperAge: 0.45,
    paperGrain: 0.32,
    edgeRoughness: 0.3,
    inkBleed: 0.14,
    inkDistress: 0.16,
    inkFade: 0.1,
    ghosting: 0.08,
    backgroundPrint: 0.5,
    rotation: 4,
    positionJitter: 0.18,
    overlap: 0.04,
    photocopy: 0.08,
  },
  // Assembled by hand, in a hurry.
  "Cut & Paste": {
    layout: "stacked",
    fontVariation: 1,
    sizeVariation: 0.5,
    weightVariation: 0.7,
    trackingVariation: 0.35,
    uppercaseChance: 0.4,
    italicChance: 0.15,
    paperShape: "rough-rectangle",
    paperAge: 0.3,
    edgeRoughness: 0.45,
    paddingVariation: 0.5,
    inkDistress: 0.2,
    backgroundPrint: 0.4,
    rotation: 9,
    positionJitter: 0.35,
    overlap: 0.12,
    photocopy: 0.05,
  },
  // Third-generation photocopy of something that was already a photocopy.
  "Punk Xerox": {
    layout: "scatter",
    fontVariation: 1,
    sizeVariation: 0.6,
    weightVariation: 0.8,
    trackingVariation: 0.4,
    uppercaseChance: 0.65,
    italicChance: 0.12,
    paperShape: "torn",
    paperAge: 0.25,
    paperGrain: 0.5,
    edgeRoughness: 0.75,
    paddingVariation: 0.6,
    inkBleed: 0.3,
    inkDistress: 0.45,
    inkFade: 0.18,
    ghosting: 0.3,
    backgroundPrint: 0.55,
    rotation: 14,
    positionJitter: 0.5,
    overlap: 0.2,
    photocopy: 0.7,
  },
  // Filed, forgotten, faded.
  Archive: {
    layout: "baseline",
    fontVariation: 0.45,
    sizeVariation: 0.18,
    weightVariation: 0.25,
    uppercaseChance: 0.12,
    italicChance: 0.2,
    paperShape: "rough-rectangle",
    paperAge: 0.8,
    paperGrain: 0.35,
    edgeRoughness: 0.2,
    inkBleed: 0.08,
    inkDistress: 0.28,
    inkFade: 0.35,
    ghosting: 0.1,
    backgroundPrint: 0.3,
    rotation: 2.5,
    positionJitter: 0.12,
    overlap: 0,
    photocopy: 0.12,
  },
};

/**
 * Settings whose change invalidates the cached per-token clippings.
 *
 * Everything *not* in here only moves finished scraps around the page, which is
 * the cheap pass — so dragging rotation or overlap never re-renders paper,
 * ink or type. Anything touching what a scrap *is* rather than where it sits
 * belongs in this set. (`fill` stays out on purpose: it scales at composite
 * time, so the clippings are still valid.)
 */
export const CLIPPING_KEYS: ReadonlySet<keyof Settings> = new Set<keyof Settings>([
  "tokenMode",
  "fontVariation",
  "sizeVariation",
  "weightVariation",
  "trackingVariation",
  "uppercaseChance",
  "italicChance",
  "paperShape",
  "paperAge",
  "paperGrain",
  "edgeRoughness",
  "paddingX",
  "paddingY",
  "paddingVariation",
  "inkBleed",
  "inkDistress",
  "inkFade",
  "ghosting",
  "backgroundPrint",
]);

export interface PageSize {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const PAGE_SIZES: PageSize[] = [
  { id: "landscape-3-2", label: "3:2 landscape", width: 1620, height: 1080 },
  { id: "square", label: "square", width: 1400, height: 1400 },
  { id: "poster-4-5", label: "4:5 poster", width: 1200, height: 1500 },
  { id: "wide-16-9", label: "16:9", width: 1760, height: 990 },
  { id: "a4-portrait", label: "A4 portrait", width: 1240, height: 1754 },
  { id: "a4-landscape", label: "A4 landscape", width: 1754, height: 1240 },
];
