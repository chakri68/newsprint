/**
 * Where the scraps go.
 *
 * The cheap tier: it moves finished clippings around and never looks inside
 * them, which is why the layout sliders are the responsive ones.
 *
 * Everything flows into rows, left to right, top to bottom — even "scatter".
 * That is a deliberate limit. The spec's free placement with a collision retry
 * loop can put token 5 above and left of token 2, and at that point the phrase
 * is a word search. Reading order is not a constraint on the chaos; it is the
 * thing the chaos has to survive. Row-flow gives it for free, and it also makes
 * collision handling mostly unnecessary: pieces within a row are spaced by
 * construction, so `overlap` becomes a dial rather than a search.
 *
 * The row count is derived from the page's aspect ratio, so a 16:9 canvas gets
 * a long shallow composition and an A4 portrait gets a stacked one, without
 * either being configured.
 */

import type { ClippingPlan } from "./clipping";
import type { Rng } from "./prng";
import { jitter, range, stream } from "./prng";
import type { Settings } from "./settings";

export interface Placement {
  plan: ClippingPlan;
  /** Centre of the piece, page units. */
  x: number;
  y: number;
  rotation: number; // radians
  scale: number;
  z: number;
}

export interface Composition {
  placements: Placement[];
  /** Bounds actually occupied, page units. */
  width: number;
  height: number;
  /**
   * The uniform scale the fit pass applied. The renderer needs it to rasterise
   * each scrap at the size it will actually be drawn, rather than guessing.
   */
  fit: number;
}

interface ModeShape {
  /**
   * Target span aspect, as a multiple of the page's own. >1 wants a long
   * shallow composition, <1 a tall stacked one.
   */
  aspectBias: number;
  rotationScale: number;
  jitterScale: number;
  scaleVariation: number;
}

const MODES: Record<Settings["layout"], ModeShape> = {
  // One mostly-horizontal line, glued down carefully.
  baseline: { aspectBias: 2.1, rotationScale: 0.45, jitterScale: 0.35, scaleVariation: 0 },
  // The default: a line, but assembled by hand.
  loose: { aspectBias: 1.3, rotationScale: 1, jitterScale: 1, scaleVariation: 0.04 },
  // Deliberately multi-row, words allowed to crowd each other.
  stacked: { aspectBias: 0.55, rotationScale: 1.1, jitterScale: 1.15, scaleVariation: 0.08 },
  // Editorial chaos — big rotations and offsets, reading order still intact.
  scatter: { aspectBias: 0.85, rotationScale: 2.1, jitterScale: 2.4, scaleVariation: 0.16 },
};

/** Axis-aligned extent of a w×h box rotated by `angle`. */
function rotatedExtent(w: number, h: number, angle: number): { w: number; h: number } {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return { w: w * c + h * s, h: w * s + h * c };
}

export function layout(
  plans: ClippingPlan[],
  pageWidth: number,
  pageHeight: number,
  settings: Settings,
  seed: number,
): Composition {
  if (plans.length === 0) {
    return { placements: [], width: 0, height: 0, fit: 1 };
  }

  // Its own stream, independent of the one the clippings were drawn from — so
  // re-running only this pass is both possible and reproducible.
  const rng: Rng = stream(seed, 0x1a7e);
  const mode = MODES[settings.layout];

  const gapUnit =
    plans.reduce((sum, c) => sum + c.pageHeight, 0) / plans.length;
  const gap = gapUnit * 0.18 * (1 - settings.overlap * 2.4);
  const totalWidth =
    plans.reduce((sum, c) => sum + c.pageWidth, 0) + gap * (plans.length - 1);
  const averageHeight = gapUnit;

  // Extra space where a word boundary was dropped in character mode. Wide
  // enough to read as a gap between words, not as an unlucky kern.
  const wordGap = gapUnit * 0.42;
  const gapBefore = (plan: ClippingPlan, first: boolean): number =>
    first ? 0 : gap + (plan.token.spaceBefore ? wordGap : 0);

  /** Greedy left-to-right fill, wrapping at `targetRowWidth`. */
  const flow = (targetRowWidth: number): ClippingPlan[][] => {
    const out: ClippingPlan[][] = [[]];
    let width = 0;
    for (const plan of plans) {
      const current = out[out.length - 1];
      const forced = plan.token.breakBefore && current.length > 0;
      const overflows =
        current.length > 0 &&
        width + gapBefore(plan, false) + plan.pageWidth > targetRowWidth;
      if (forced || overflows) {
        out.push([]);
        width = 0;
      }
      out[out.length - 1].push(plan);
      width += gapBefore(plan, width === 0) + plan.pageWidth;
    }
    return out;
  };

  /**
   * Unrotated extent of a packing, plus how ragged it is.
   *
   * `badness` is the mean squared shortfall of each row against the widest one,
   * borrowed from the way a typesetter scores a paragraph. Without it the
   * search happily orphans a word: splitting RANSOM as five letters and a
   * lonely M scores better on aspect alone than setting it on one line, and it
   * looks exactly as bad as it sounds.
   */
  const measurePacking = (
    candidate: ClippingPlan[][],
  ): { w: number; h: number; badness: number } => {
    const widths: number[] = [];
    let h = 0;
    for (const line of candidate) {
      let lineWidth = 0;
      let lineHeight = 0;
      for (let i = 0; i < line.length; i++) {
        lineWidth += gapBefore(line[i], i === 0) + line[i].pageWidth;
        lineHeight = Math.max(lineHeight, line[i].pageHeight);
      }
      widths.push(lineWidth);
      h += lineHeight * (1 - settings.overlap * 0.45) + gap * 0.8;
    }
    const w = Math.max(1, ...widths);
    let badness = 0;
    for (const width of widths) badness += ((w - width) / w) ** 2;
    return { w, h: Math.max(1, h), badness: badness / widths.length };
  };

  // ── Choose the packing ──────────────────────────────────────────────
  // Estimating a row count from a closed-form aspect formula reliably missed:
  // greedy wrapping cannot always hit the width it was aimed at, so a long word
  // would push a row short and the composition came out far taller than the
  // page. Packing every candidate and measuring what actually came out is a
  // handful of arithmetic for at most ten tries, and it optimises the thing we
  // actually want rather than a proxy for it.
  const targetAspect = (pageWidth / pageHeight) * mode.aspectBias;
  let lines = flow(totalWidth);
  let bestScore = Infinity;
  for (let rows = 1; rows <= Math.min(plans.length, 10); rows++) {
    const candidate = flow(totalWidth / rows);
    const packing = measurePacking(candidate);
    const score =
      Math.abs(Math.log(packing.w / packing.h / targetAspect)) + packing.badness * 2;
    if (score < bestScore) {
      bestScore = score;
      lines = candidate;
    }
  }

  // ── Place ───────────────────────────────────────────────────────────
  const placements: Placement[] = [];
  const rotationLimit = (settings.rotation * Math.PI) / 180;
  let cursorY = 0;

  for (const line of lines) {
    const angles = line.map(() => jitter(rng, rotationLimit) * mode.rotationScale);
    const scales = line.map(
      () => 1 + jitter(rng, mode.scaleVariation) * (0.4 + settings.positionJitter),
    );

    const extents = line.map((c, i) =>
      rotatedExtent(c.pageWidth * scales[i], c.pageHeight * scales[i], angles[i]),
    );
    const gaps = line.map((plan, i) => gapBefore(plan, i === 0));
    const rowWidth =
      extents.reduce((sum, e) => sum + e.w, 0) + gaps.reduce((sum, g) => sum + g, 0);
    const rowHeight = Math.max(...extents.map((e) => e.h));

    // Rows are centred on each other; a ragged left edge reads as a mistake,
    // a centred stack reads as a composition.
    let cursorX = -rowWidth / 2;
    const jitterUnit = averageHeight * settings.positionJitter * mode.jitterScale;

    for (let i = 0; i < line.length; i++) {
      const plan = line[i];
      const extent = extents[i];
      cursorX += gaps[i];
      const cx = cursorX + extent.w / 2 + jitter(rng, jitterUnit * 0.5);
      const cy = cursorY + rowHeight / 2 + jitter(rng, jitterUnit);

      placements.push({
        plan,
        x: cx,
        y: cy,
        rotation: angles[i],
        scale: scales[i],
        // Mostly the order they were laid down, with the occasional scrap
        // tucked under its neighbour — which is what a real pile does.
        z: plan.token.index + range(rng, -0.45, 0.45) * (settings.overlap > 0 ? 1 : 0),
      });

      cursorX += extent.w;
    }

    cursorY += rowHeight * (1 - settings.overlap * 0.45) + gap * 0.8;
  }

  // ── Fit the page ────────────────────────────────────────────────────
  // Type is sized nominally, so the composition's absolute size is arbitrary
  // until here. One uniform scale to the target box keeps every relative size
  // decision intact while guaranteeing three words and thirty both fill the
  // canvas.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placements) {
    const e = rotatedExtent(
      p.plan.pageWidth * p.scale,
      p.plan.pageHeight * p.scale,
      p.rotation,
    );
    minX = Math.min(minX, p.x - e.w / 2);
    maxX = Math.max(maxX, p.x + e.w / 2);
    minY = Math.min(minY, p.y - e.h / 2);
    maxY = Math.max(maxY, p.y + e.h / 2);
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const fit = Math.min(
    (pageWidth * settings.fill) / spanX,
    (pageHeight * settings.fill) / spanY,
  );

  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  for (const p of placements) {
    p.x = pageWidth / 2 + (p.x - centreX) * fit;
    p.y = pageHeight / 2 + (p.y - centreY) * fit;
    p.scale *= fit;
  }

  placements.sort((a, b) => a.z - b.z);

  return { placements, width: spanX * fit, height: spanY * fit, fit };
}
