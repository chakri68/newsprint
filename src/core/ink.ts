/**
 * Ink, as opposed to text.
 *
 * Browser text is perfect: uniform density, clean edges, identical every time.
 * Printed text is none of those, and the gap is most of what separates "styled
 * HTML" from "a photograph of a newspaper". So the glyphs are rendered once
 * into their own layer and then damaged: bleed spreads the ink into the paper,
 * erosion takes it away in flecks, uneven inking varies how much the press laid
 * down across the word, and ghosting is the second impression a slipping sheet
 * takes.
 *
 * All damage is drawn as geometry in page units rather than sampled per pixel,
 * so it scales with the export exactly the way the type does. Texture that must
 * hold a fixed apparent size lives in paper.ts; nothing here is texture.
 */

import type { Rng } from "./prng";
import { chance, range } from "./prng";
import type { Settings } from "./settings";

/** Newsprint ink is warm and never actually black. */
const INK = "26,22,19";

export interface InkOptions {
  /** Layer size in device pixels. */
  deviceWidth: number;
  deviceHeight: number;
  /** Device pixels per page unit. */
  scale: number;
  /** Page-unit bounds of the layer, for placing damage. */
  pageWidth: number;
  pageHeight: number;
  settings: Settings;
  /** 0..1, from the token's treatment. */
  darkness: number;
  /** Draws the glyphs in page units. Called with the transform already set. */
  paint: (ctx: CanvasRenderingContext2D) => void;
}

export function makeInkLayer(options: InkOptions, rng: Rng): HTMLCanvasElement {
  const { deviceWidth, deviceHeight, scale, pageWidth, pageHeight, settings, darkness } =
    options;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(deviceWidth));
  canvas.height = Math.max(1, Math.ceil(deviceHeight));
  const ctx = canvas.getContext("2d")!;

  // ── Bleed ───────────────────────────────────────────────────────────
  // A blurred impression under the sharp one. Ink wicks into the fibre before
  // it dries, so the edge of a stroke is never where the plate put it.
  if (settings.inkBleed > 0.01 && supportsFilter(ctx)) {
    ctx.save();
    ctx.filter = `blur(${(settings.inkBleed * 2.6 * scale).toFixed(2)}px)`;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = `rgba(${INK},${(0.5 * darkness).toFixed(3)})`;
    options.paint(ctx);
    ctx.restore();
  }

  // ── Ghost impression ────────────────────────────────────────────────
  if (settings.ghosting > 0.01) {
    const dx = range(rng, -1, 1) * settings.ghosting * 5;
    const dy = range(rng, -1, 1) * settings.ghosting * 3;
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, dx * scale, dy * scale);
    ctx.fillStyle = `rgba(${INK},${(settings.ghosting * 0.35 * darkness).toFixed(3)})`;
    options.paint(ctx);
    ctx.restore();
  }

  // ── The impression itself ───────────────────────────────────────────
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = `rgba(${INK},${(0.94 * darkness).toFixed(3)})`;
  options.paint(ctx);
  ctx.restore();

  // ── Uneven inking ───────────────────────────────────────────────────
  // Broad soft patches lifted back out. A press does not lay down an even film
  // across a whole word; one end of a line is always heavier than the other.
  const unevenness = 0.18 + settings.inkDistress * 0.7;
  if (unevenness > 0.02) {
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    const patches = 2 + Math.round(settings.inkDistress * 6);
    for (let i = 0; i < patches; i++) {
      const cx = range(rng, -0.1, 1.1) * pageWidth;
      const cy = range(rng, -0.1, 1.1) * pageHeight;
      const r = range(rng, 0.25, 0.85) * Math.max(pageWidth, pageHeight) * 0.5;
      const strength = range(rng, 0.05, 0.3) * unevenness;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(0,0,0,${strength.toFixed(3)})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, pageWidth, pageHeight);
    }
    ctx.restore();
  }

  // ── Erosion ─────────────────────────────────────────────────────────
  // Flecks the paper simply did not take. Small, many, and biased toward the
  // middle of the layer where the glyphs actually are.
  if (settings.inkDistress > 0.01) {
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    const area = pageWidth * pageHeight;
    const count = Math.round((area / 850) * settings.inkDistress);
    for (let i = 0; i < count; i++) {
      const x = rng() * pageWidth;
      const y = rng() * pageHeight;
      const r = range(rng, 0.25, 1.5 + settings.inkDistress * 2.5);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // A few dry scratches across the grain.
    if (chance(rng, settings.inkDistress)) {
      ctx.lineCap = "round";
      const scratches = 1 + Math.round(settings.inkDistress * 3);
      for (let i = 0; i < scratches; i++) {
        const y = rng() * pageHeight;
        ctx.lineWidth = range(rng, 0.4, 1.4);
        ctx.beginPath();
        ctx.moveTo(range(rng, -0.1, 0.5) * pageWidth, y);
        ctx.lineTo(range(rng, 0.5, 1.1) * pageWidth, y + range(rng, -2, 2));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  return canvas;
}

function supportsFilter(ctx: CanvasRenderingContext2D): boolean {
  return typeof ctx.filter === "string";
}
