/**
 * Compositing the page.
 *
 * Three passes, in order of how expensive they are to redo: plan every scrap
 * (arithmetic), lay them out (arithmetic), rasterise and composite (pixels).
 * Only the third costs anything, and it is the one that gets cached.
 *
 * The cache is keyed by a signature of everything that changes what a scrap
 * *is* -- text, seed, and the clipping-tier settings -- plus the raster scale.
 * Layout settings are deliberately absent from that key: nudging rotation moves
 * finished paper around and must not re-render ink.
 *
 * Raster scale is quantised because the fit-to-page factor drifts slightly
 * whenever anything moves. Snapping it to a geometric ladder means small layout
 * changes land in the same bucket and hit the cache, while a real change of
 * size -- a different page, a new word count -- crosses a bucket and correctly
 * re-renders at the resolution it now needs.
 */

import type { ClippingPlan, Raster } from "./clipping";
import { planClippings, rasterize } from "./clipping";
import { layout } from "./layout";
import { hashNoise } from "./noise";
import { stream } from "./prng";
import type { Settings } from "./settings";
import { CLIPPING_KEYS } from "./settings";
import { tokenize } from "./tokenize";
import { chooseBaseCategory } from "./typography";

export interface RasterCache {
  signature: string;
  entries: Map<string, Raster>;
}

export function createCache(): RasterCache {
  return { signature: "", entries: new Map() };
}

export interface RenderRequest {
  text: string;
  settings: Settings;
  seed: number;
  pageWidth: number;
  pageHeight: number;
  /** Device pixels per page unit. */
  scale: number;
  cache?: RasterCache;
}

export interface RenderStats {
  pieces: number;
  /** Device pixels per page unit the scraps were rasterised at. */
  rasterScale: number;
  milliseconds: number;
}

const RASTER_RATIO = 1.18;

function quantizeScale(fit: number): number {
  const clamped = Math.max(0.15, Math.min(8, fit));
  return RASTER_RATIO ** Math.round(Math.log(clamped) / Math.log(RASTER_RATIO));
}

function signatureOf(request: RenderRequest): string {
  const parts: string[] = [request.text, String(request.seed)];
  for (const key of CLIPPING_KEYS) parts.push(`${key}=${String(request.settings[key])}`);
  return parts.join(" ");
}

/** A shade darker and greyer than newsprint, so the scraps read as sitting on it. */
const BOARD = "#cfc7b6";

export function renderPage(
  target: HTMLCanvasElement,
  request: RenderRequest,
): RenderStats {
  const started = performance.now();
  const { settings, seed, pageWidth, pageHeight, scale } = request;

  const deviceWidth = Math.max(1, Math.round(pageWidth * scale));
  const deviceHeight = Math.max(1, Math.round(pageHeight * scale));
  target.width = deviceWidth;
  target.height = deviceHeight;
  const ctx = target.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, deviceWidth, deviceHeight);

  drawBackground(ctx, deviceWidth, deviceHeight, settings);

  const tokens = tokenize(request.text, settings.tokenMode);
  if (tokens.length === 0) {
    return { pieces: 0, rasterScale: scale, milliseconds: performance.now() - started };
  }

  const baseCategory = chooseBaseCategory(stream(seed, 0xba5e));
  const plans: ClippingPlan[] = planClippings(tokens, settings, baseCategory, seed);
  const composition = layout(plans, pageWidth, pageHeight, settings, seed);

  const rasterScale = scale * quantizeScale(composition.fit);

  const cache = request.cache;
  if (cache) {
    const signature = signatureOf(request);
    if (cache.signature !== signature) {
      cache.signature = signature;
      cache.entries.clear();
    }
  }

  const rasterFor = (plan: ClippingPlan): Raster => {
    const key = `${plan.token.index} ${rasterScale.toFixed(4)}`;
    const hit = cache?.entries.get(key);
    if (hit) return hit;
    const made = rasterize(plan, settings, seed, rasterScale);
    cache?.entries.set(key, made);
    return made;
  };

  // Each raster already carries its own shadow in its margin, so this loop is
  // nothing but rotate-and-blit. That is the point: it runs every frame.
  for (const placement of composition.placements) {
    const raster = rasterFor(placement.plan);
    const w = raster.outerWidth * placement.scale * scale;
    const h = raster.outerHeight * placement.scale * scale;

    ctx.save();
    ctx.translate(placement.x * scale, placement.y * scale);
    ctx.rotate(placement.rotation);
    ctx.drawImage(raster.canvas, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  if (settings.photocopy > 0.01) {
    applyPhotocopy(ctx, deviceWidth, deviceHeight, settings, seed, scale);
  }

  roundCorners(ctx, deviceWidth, deviceHeight, settings.cornerRadius);

  return {
    pieces: composition.placements.length,
    rasterScale,
    milliseconds: performance.now() - started,
  };
}

/**
 * Punch the corners out of the finished page.
 *
 * Done last, as a `destination-in` mask, rather than as a clip set up front:
 * the photocopy pass writes the whole canvas back with `putImageData`, which
 * ignores clipping regions entirely and would refill any corner a clip had
 * already cut. Masking at the end is immune to that and costs one fill.
 */
function roundCorners(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  fraction: number,
): void {
  if (fraction <= 0.001) return;
  const radius = Math.min(width, height) * Math.min(0.5, fraction);

  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = "#000";
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(0, 0, width, height, radius);
  } else {
    // Older Safari. arcTo draws the same shape from the corner points.
    ctx.moveTo(radius, 0);
    ctx.arcTo(width, 0, width, height, radius);
    ctx.arcTo(width, height, 0, height, radius);
    ctx.arcTo(0, height, 0, 0, radius);
    ctx.arcTo(0, 0, width, 0, radius);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: Settings,
): void {
  if (settings.background === "transparent") return;

  if (settings.background === "white") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    return;
  }
  if (settings.background === "black") {
    ctx.fillStyle = "#101010";
    ctx.fillRect(0, 0, width, height);
    return;
  }

  ctx.fillStyle = BOARD;
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.2,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(40,32,20,0.22)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

/**
 * The whole page run through a tired copier.
 *
 * Contrast is crushed toward the extremes -- a copier has no midtones to speak
 * of -- and dirt is laid over the top. The dirt is generated at page resolution
 * and stretched, for the same reason paper grain is: it has an apparent size,
 * and indexing it per device pixel would make it vanish at export.
 */
function applyPhotocopy(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: Settings,
  seed: number,
  scale: number,
): void {
  const amount = settings.photocopy;

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const contrast = 1 + amount * 2.2;
  const lift = amount * 10;
  const greyMix = amount > 0.4 ? (amount - 0.4) / 0.6 : 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) {
      const pushed = (data[i + c] - 128) * contrast + 128 + lift;
      data[i + c] = pushed < 0 ? 0 : pushed > 255 ? 255 : pushed;
    }
    if (greyMix > 0) {
      const grey = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      data[i] += (grey - data[i]) * greyMix;
      data[i + 1] += (grey - data[i + 1]) * greyMix;
      data[i + 2] += (grey - data[i + 2]) * greyMix;
    }
  }
  ctx.putImageData(image, 0, 0);

  const pageWidth = Math.max(1, Math.round(width / scale));
  const pageHeight = Math.max(1, Math.round(height / scale));
  const dirt = document.createElement("canvas");
  dirt.width = pageWidth;
  dirt.height = pageHeight;
  const dirtCtx = dirt.getContext("2d")!;
  const dirtImage = dirtCtx.createImageData(pageWidth, pageHeight);
  const dirtData = dirtImage.data;

  for (let y = 0; y < pageHeight; y++) {
    for (let x = 0; x < pageWidth; x++) {
      const i = (y * pageWidth + x) * 4;
      // Sparse and dark: copier dirt is specks, not a film of noise.
      const on = hashNoise(x, y, seed ^ 0x70c0) > 1 - amount * 0.045;
      dirtData[i] = 20;
      dirtData[i + 1] = 18;
      dirtData[i + 2] = 16;
      dirtData[i + 3] = on ? 190 : 0;
    }
  }
  dirtCtx.putImageData(dirtImage, 0, 0);
  ctx.drawImage(dirt, 0, 0, width, height);
}
