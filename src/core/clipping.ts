/**
 * One token → one scrap of paper.
 *
 * Split in two on purpose.
 *
 * `planClipping` is cheap: it picks the typeface, measures the text and tears
 * the outline, which is everything the layout pass needs to know and nothing
 * that costs a pixel. `rasterize` is the expensive half — paper, background
 * print, ink — and it cannot run until layout has decided how big the scrap
 * ends up on the page.
 *
 * That ordering is forced by the fit-to-page step. Type is sized nominally, so
 * the composition's real scale is not known until every piece has been placed;
 * rasterising before then means either upscaling a small bitmap (soft type at
 * export) or rendering everything at a wasteful ceiling. Plan, place, then
 * rasterise at the size it will actually be drawn.
 *
 * Within `rasterize` the order is the physical one: paper exists, then the page
 * was printed on it, then the headline was printed over that, then someone cut
 * it out. Tearing before inking would let ink sit outside the paper, which is
 * exactly the tell that gives a fake away.
 */

import { drawBackgroundPrint } from "./backgroundPrint";
import { makeInkLayer } from "./ink";
import { paperTexture } from "./paper";
import type { Rng } from "./prng";
import { hashString, jitter, stream } from "./prng";
import type { Settings } from "./settings";
import type { Token } from "./tokenize";
import type { Treatment } from "./typography";
import { BASE_SIZE, applyFont, chooseTreatment, displayText, drawText, measure } from "./typography";
import type { FontCategory } from "./fonts";
import type { Point } from "./tear";
import { pathBounds, paperPath, tracePath } from "./tear";

export interface ClippingPlan {
  token: Token;
  treatment: Treatment;
  /** Rendered form of the token — case already applied. */
  text: string;
  /** Outline in the scrap's own space, already shifted so its bounds start at 0. */
  path: Point[];
  pageWidth: number;
  pageHeight: number;
  textX: number;
  textBaseline: number;
}

/**
 * A token's own streams, salted by its text and position.
 *
 * Deriving from the *text* as well as the index means editing the last word of
 * a phrase leaves the earlier scraps untouched — what you want while typing,
 * and what a single shared sequence could never give you. Plan and raster get
 * separate salts so the raster pass does not depend on how many values the plan
 * pass happened to consume.
 */
function planStream(seed: number, token: Token): Rng {
  return stream(seed, hashString(token.text) ^ (token.index * 0x9e37));
}

function rasterStream(seed: number, token: Token): Rng {
  return stream(seed, hashString(token.text) ^ (token.index * 0x2f1b) ^ 0x5bf03635);
}

export function planClipping(
  token: Token,
  settings: Settings,
  baseCategory: FontCategory,
  seed: number,
): ClippingPlan {
  const rng = planStream(seed, token);
  const treatment = chooseTreatment(rng, settings, baseCategory);
  const metrics = measure(token.text, treatment);

  // Padding is proportional to the type, not absolute, so a small word is not
  // swallowed by the same margin that suits a large one.
  const sizeRatio = treatment.size / BASE_SIZE;
  const padX = Math.max(
    2,
    settings.paddingX * sizeRatio * (1 + jitter(rng, settings.paddingVariation)),
  );
  const padY = Math.max(
    2,
    settings.paddingY * sizeRatio * (1 + jitter(rng, settings.paddingVariation)),
  );

  const path = paperPath(
    metrics.width + padX * 2,
    metrics.height + padY * 2,
    settings.paperShape,
    settings.edgeRoughness,
    rng,
  );

  // A tear wanders outside the nominal box, so the scrap is sized to the
  // outline's real bounds and everything inside shifts to compensate.
  const bounds = pathBounds(path);
  return {
    token,
    treatment,
    text: displayText(token.text, treatment),
    path: path.map((p) => ({ x: p.x - bounds.minX, y: p.y - bounds.minY })),
    pageWidth: Math.max(1, bounds.maxX - bounds.minX),
    pageHeight: Math.max(1, bounds.maxY - bounds.minY),
    textX: padX - bounds.minX,
    textBaseline: padY + metrics.ascent - bounds.minY,
  };
}

export function planClippings(
  tokens: Token[],
  settings: Settings,
  baseCategory: FontCategory,
  seed: number,
): ClippingPlan[] {
  return tokens.map((token) => planClipping(token, settings, baseCategory, seed));
}

/** Page units of margin around each scrap, holding its baked drop shadow. */
export const SHADOW_PAD = 7;

export interface Raster {
  canvas: HTMLCanvasElement;
  /** Page-unit extent of the canvas, shadow margin included. */
  outerWidth: number;
  outerHeight: number;
}

/**
 * Rasterise a planned scrap at `scale` device pixels per page unit.
 *
 * This is the whole cost of the tool. Everything above is arithmetic.
 *
 * The drop shadow is baked in here rather than applied when the scrap is
 * composited onto the page. Canvas `shadowBlur` is re-computed on every
 * `drawImage`, and profiling found it dominating the frame: a fully warm cache,
 * doing nothing but blitting finished paper, still cost 700ms. Baked, the blur
 * runs once per scrap and is cached with it, and compositing becomes a plain
 * `drawImage`. The canvas grows by SHADOW_PAD on every side to hold it.
 */
export function rasterize(
  plan: ClippingPlan,
  settings: Settings,
  seed: number,
  scale: number,
): Raster {
  const rng = rasterStream(seed, plan.token);
  const { pageWidth, pageHeight } = plan;

  const pad = SHADOW_PAD;
  const outerWidth = pageWidth + pad * 2;
  const outerHeight = pageHeight + pad * 2;

  const deviceWidth = Math.max(1, Math.ceil(pageWidth * scale));
  const deviceHeight = Math.max(1, Math.ceil(pageHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(outerWidth * scale));
  canvas.height = Math.max(1, Math.ceil(outerHeight * scale));
  const ctx = canvas.getContext("2d")!;

  // The shadow first, unclipped -- it belongs outside the paper, not on it.
  if (typeof ctx.filter === "string") {
    ctx.save();
    ctx.filter = `blur(${(2.4 * scale).toFixed(2)}px)`;
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.beginPath();
    for (let i = 0; i < plan.path.length; i++) {
      const point = plan.path[i];
      const x = (point.x + pad) * scale;
      const y = (point.y + pad + 1.6) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, pad * scale, pad * scale);
  tracePath(ctx, plan.path);
  ctx.clip();

  // Paper. Generated at page resolution and upscaled by the transform — see
  // paper.ts for why grain must never be indexed per device pixel.
  const texture = paperTexture(
    pageWidth,
    pageHeight,
    settings,
    seed ^ (plan.token.index * 0x9e3779b9),
    rng,
  );
  ctx.drawImage(texture, 0, 0, pageWidth, pageHeight);

  drawBackgroundPrint(
    ctx,
    { width: pageWidth, height: pageHeight, intensity: settings.backgroundPrint },
    rng,
  );

  const inkLayer = makeInkLayer(
    {
      deviceWidth,
      deviceHeight,
      scale,
      pageWidth,
      pageHeight,
      settings,
      darkness: plan.treatment.inkDarkness,
      paint: (target) => {
        applyFont(target, plan.treatment);
        drawText(target, plan.text, plan.treatment, plan.textX, plan.textBaseline);
      },
    },
    rng,
  );
  // The ink layer is already rasterised at device resolution; drawing it under
  // the page transform would scale it a second time.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(inkLayer, pad * scale, pad * scale);
  ctx.setTransform(scale, 0, 0, scale, pad * scale, pad * scale);

  // A torn edge exposes pale fibre; a scissor cut does not. Stroking just
  // inside the clip leaves the fringe on the paper rather than around it.
  if (settings.paperShape !== "rectangle" && settings.edgeRoughness > 0.05) {
    ctx.save();
    ctx.strokeStyle = `rgba(255,252,244,${(0.16 + settings.edgeRoughness * 0.3).toFixed(3)})`;
    ctx.lineWidth = 0.6 + settings.edgeRoughness * 1.6;
    tracePath(ctx, plan.path);
    ctx.stroke();
    ctx.strokeStyle = `rgba(120,106,84,${(0.1 + settings.edgeRoughness * 0.16).toFixed(3)})`;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
  return { canvas, outerWidth, outerHeight };
}
