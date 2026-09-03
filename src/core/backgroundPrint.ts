/**
 * The page the word was cut out of.
 *
 * A clipping only reads as a clipping if it is obviously a *fragment* — the
 * scissors went through something, and the something is still faintly there
 * around the edges. Without this layer each scrap looks like a word printed on
 * a card, which is a completely different object.
 *
 * Two registers: real filler words at masthead scale, and pseudo-copy — rows of
 * short bars that read as body text at a size where letterforms would be a lie
 * anyway. Both stay well under the headline in contrast; the moment you can
 * actually read this layer it stops being background and starts competing.
 *
 * The vocabulary is invented. Nothing here reproduces a published article.
 */

import type { Rng } from "./prng";
import { chance, int, pick, range } from "./prng";

const MASTHEAD = [
  "CITY EDITION",
  "DAILY REPORT",
  "VOL. XXVIII",
  "EVENING",
  "ARCHIVE",
  "SPORT",
  "METRO",
  "THE DAILY",
  "LATE FINAL",
  "No. 4417",
  "CLASSIFIED",
  "WEATHER",
  "OBITUARIES",
  "PRICE 15c",
];

export interface PrintOptions {
  width: number;
  height: number;
  /** 0..1 — how present the layer is. */
  intensity: number;
}

export function drawBackgroundPrint(
  ctx: CanvasRenderingContext2D,
  { width, height, intensity }: PrintOptions,
  rng: Rng,
): void {
  if (intensity <= 0.01) return;

  ctx.save();

  // Everything in this layer is ink on paper that has already faded once.
  const ink = (a: number): string => `rgba(38,33,26,${(a * intensity).toFixed(3)})`;

  // ── Pseudo-copy: columns of short bars ──────────────────────────────
  const lineHeight = Math.max(2.6, height / range(rng, 12, 20));
  const columns = int(rng, 1, 3);
  const gutter = width * 0.045;
  const columnWidth = (width - gutter * (columns - 1)) / columns;

  for (let c = 0; c < columns; c++) {
    const x0 = c * (columnWidth + gutter);
    let y = range(rng, -lineHeight, lineHeight);
    while (y < height) {
      // Ragged right edge — set justified copy still breaks short on the last
      // line of every paragraph, and that raggedness is what sells it.
      const w = columnWidth * range(rng, 0.55, 1);
      const barHeight = Math.max(0.8, lineHeight * 0.38);
      ctx.fillStyle = ink(range(rng, 0.1, 0.22));
      ctx.fillRect(x0, y, w, barHeight);
      y += lineHeight;
    }
  }

  // ── Rules ───────────────────────────────────────────────────────────
  if (chance(rng, 0.55)) {
    const y = range(rng, height * 0.1, height * 0.9);
    ctx.fillStyle = ink(0.4);
    ctx.fillRect(0, y, width, Math.max(0.7, height * 0.006));
  }

  // ── Masthead fragments ──────────────────────────────────────────────
  const labels = int(rng, 1, 2);
  for (let i = 0; i < labels; i++) {
    const size = Math.max(5, height * range(rng, 0.1, 0.17));
    ctx.font = `700 ${size}px Oswald, 'Roboto Condensed', Helvetica, sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = ink(range(rng, 0.28, 0.5));
    const text = pick(rng, MASTHEAD);
    const w = ctx.measureText(text).width;
    ctx.fillText(text, range(rng, -w * 0.15, Math.max(0, width - w * 0.85)), range(rng, size, height));
  }

  ctx.restore();
}
