/**
 * Choosing and measuring a token's typographic treatment.
 *
 * The phrase picks a *base* treatment once — a category bias and a base size —
 * and every token deviates from that by the variation amounts. That ordering is
 * the whole reason a composition reads as one assembled headline instead of
 * nine unrelated words: the deviations share an origin.
 *
 * Sizes are page units. Nothing here knows about device pixels.
 */

import type { Rng } from "./prng";
import { chance, pick, range, weighted } from "./prng";
import type { FontCategory, StudioFont } from "./fonts";
import { FONTS, FONTS_BY_CATEGORY, cssFont, snapWeight } from "./fonts";
import type { Settings } from "./settings";

/** Nominal cap height for the base treatment. The fit pass rescales anyway; what
 *  matters is that padding (in page units) keeps a sane ratio to the type. */
export const BASE_SIZE = 132;

export interface Treatment {
  font: StudioFont;
  weight: number;
  size: number;
  italic: boolean;
  /** Extra advance between glyphs, page units. Negative tightens. */
  tracking: number;
  upper: boolean;
  /** 0..1 — how fully this scrap took the ink. Drives ink alpha, not colour. */
  inkDarkness: number;
}

export interface Metrics {
  text: string;
  width: number;
  height: number;
  /** Distance from the text origin down to the alphabetic baseline. */
  ascent: number;
}

/**
 * Categories a phrase can be built around. Each entry biases which faces show
 * up; the leftover weight is what lets the occasional oddball through, which is
 * what stops every clipping looking like it came from the same page.
 */
const CATEGORY_MIX: FontCategory[] = [
  "news-serif",
  "headline-serif",
  "grotesk",
  "condensed",
  "slab",
  "classified",
  "italic-serif",
  "typewriter",
];

export function chooseBaseCategory(rng: Rng): FontCategory {
  return pick(rng, CATEGORY_MIX);
}

/**
 * One token's treatment.
 *
 * `fontVariation` interpolates between "everything in the base category" and
 * "anything in the pool". At 0 the phrase is one voice; at 1 every scrap is a
 * different press.
 */
export function chooseTreatment(
  rng: Rng,
  settings: Settings,
  baseCategory: FontCategory,
): Treatment {
  const inCategory = FONTS_BY_CATEGORY[baseCategory];
  const pool =
    inCategory.length > 0 && !chance(rng, settings.fontVariation) ? inCategory : FONTS;
  const font = weighted(rng, pool, (f) => f.weight);

  // Size varies multiplicatively so a doubling and a halving are equally likely.
  const sizeSpread = 1 + settings.sizeVariation * 0.75;
  const size = BASE_SIZE * Math.exp(range(rng, -1, 1) * Math.log(sizeSpread));

  // Weight walks from the middle of the face's own range, so a single-weight
  // face is simply never asked for something it does not have.
  const lightest = font.weights[0];
  const heaviest = font.weights[font.weights.length - 1];
  const mid = (lightest + heaviest) / 2;
  const weight = snapWeight(
    font,
    mid + range(rng, -1, 1) * settings.weightVariation * (heaviest - lightest),
  );

  const italic = font.italic && chance(rng, settings.italicChance);
  const upper = font.prefersUpper === true || chance(rng, settings.uppercaseChance);

  const tracking =
    (font.tracking ?? 0) * size + range(rng, -0.02, 0.06) * settings.trackingVariation * size;

  // Never fully faded: a scrap you cannot read is not a clipping, it is a smudge.
  const inkDarkness = 1 - range(rng, 0, settings.inkFade) * 0.75;

  return { font, weight, size, italic, tracking, upper, inkDarkness };
}

let measureCtx: CanvasRenderingContext2D | null = null;

function ctxForMeasuring(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    measureCtx = canvas.getContext("2d")!;
  }
  return measureCtx;
}

export function applyFont(ctx: CanvasRenderingContext2D, t: Treatment): void {
  ctx.font = cssFont(t.font, t.weight, t.size, t.italic);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

export function displayText(token: string, t: Treatment): string {
  return t.upper ? token.toUpperCase() : token;
}

/** True when tracking is loose enough to be worth breaking kerning for. */
export function tracksPerGlyph(t: Treatment): boolean {
  return Math.abs(t.tracking) > 0.15;
}

/**
 * Tight bounds around the actual glyphs.
 *
 * Deliberately `actualBoundingBox*` rather than the font's ascent/descent: the
 * paper is cut around the ink, so a word with no descender should not carry an
 * empty strip of newsprint underneath it. Em-box metrics would give every scrap
 * the same height and the composition would go dead flat.
 */
export function measure(token: string, t: Treatment): Metrics {
  const ctx = ctxForMeasuring();
  applyFont(ctx, t);
  const text = displayText(token, t);

  let width: number;
  if (tracksPerGlyph(t)) {
    const chars = [...text];
    width = 0;
    for (const ch of chars) width += ctx.measureText(ch).width;
    width += t.tracking * Math.max(0, chars.length - 1);
  } else {
    width = ctx.measureText(text).width;
  }

  const m = ctx.measureText(text);
  const ascent = m.actualBoundingBoxAscent || t.size * 0.72;
  const descent = m.actualBoundingBoxDescent || t.size * 0.2;

  return {
    text,
    width: Math.max(1, width),
    height: Math.max(1, ascent + descent),
    ascent,
  };
}

/** Draw the token's text with its tracking, origin at the alphabetic baseline. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  t: Treatment,
  x: number,
  y: number,
): void {
  if (!tracksPerGlyph(t)) {
    ctx.fillText(text, x, y);
    return;
  }
  let cursor = x;
  for (const ch of [...text]) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + t.tracking;
  }
}
