/**
 * Procedural newsprint. No scans, no image assets — every scrap makes its own.
 *
 * Texture detail is split by frequency band, and the two halves scale
 * differently. Getting this wrong ruins the export in one direction or the
 * other.
 *
 * The *structural* bands — blotching, mottling, edge dirt, fibres, specks —
 * are sampled in page space. They have an apparent size on the sheet, and
 * indexing them per device pixel would shrink them as the export grew until
 * they vanished.
 *
 * The *tooth* — the finest per-pixel grain — is sampled in texture space, at
 * whatever resolution the scrap is being rasterised at. Pinning it to page
 * space instead (as this used to) meant a 4x export smeared every grain texel
 * across 4x4 output pixels: the paper came out flat cream under razor-sharp
 * type, which is the plasticky result arrived at from the other side. Paper
 * that is photographed closer shows finer tooth, not blurrier tooth.
 *
 * Structure, cheapest first: base tint, blotching and grain go in one pass over
 * the ImageData; fibres and specks are a handful of canvas ops on top, because
 * drawing forty short strokes beats testing every pixel for whether it is
 * inside one.
 *
 * The two smooth fields are sampled on coarse grids and interpolated rather
 * than evaluated per pixel. Blotching is by definition the part of the texture
 * that barely changes between neighbouring pixels, so running fbm on every one
 * bought nothing and cost most of the render — profiling put this function at
 * 100ms for a single word. Only the grain, which genuinely is uncorrelated, is
 * still computed per pixel.
 */

import { hashNoise, makeNoise } from "./noise";
import type { Rng } from "./prng";
import { chance, int, range } from "./prng";
import type { Settings } from "./settings";

/** Fresh newsprint → long-filed newsprint. */
const FRESH: [number, number, number] = [247, 243, 232];
const AGED: [number, number, number] = [226, 214, 184];

/** Page units between samples of each smooth field. */
const BLOTCH_STEP = 8;
const MOTTLE_STEP = 2;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface Grid {
  data: Float32Array;
  cols: number;
  step: number;
}

function sampleGrid(
  width: number,
  height: number,
  step: number,
  at: (x: number, y: number) => number,
): Grid {
  const cols = Math.ceil(width / step) + 2;
  const rows = Math.ceil(height / step) + 2;
  const data = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) data[j * cols + i] = at(i * step, j * step);
  }
  return { data, cols, step };
}

function bilinear(grid: Grid, x: number, y: number): number {
  const gx = x / grid.step;
  const gy = y / grid.step;
  const i = gx | 0;
  const j = gy | 0;
  const tx = gx - i;
  const ty = gy - j;
  const row = j * grid.cols + i;
  const a = grid.data[row];
  const b = grid.data[row + 1];
  const c = grid.data[row + grid.cols];
  const d = grid.data[row + grid.cols + 1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/**
 * @param detailScale Texture pixels per page unit. Pass the scale the scrap is
 * being rasterised at so the tooth lands 1:1 on output pixels; 1 keeps the old
 * page-resolution behaviour.
 */
export function paperTexture(
  width: number,
  height: number,
  settings: Settings,
  seed: number,
  rng: Rng,
  detailScale = 1,
): HTMLCanvasElement {
  const detail = Math.max(0.25, detailScale);
  // Page-unit extent, and the pixel grid it is sampled on.
  const pageW = Math.max(1, width);
  const pageH = Math.max(1, height);
  const w = Math.max(1, Math.round(pageW * detail));
  const h = Math.max(1, Math.round(pageH * detail));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const age = settings.paperAge;
  const baseR = lerp(FRESH[0], AGED[0], age);
  const baseG = lerp(FRESH[1], AGED[1], age);
  const baseB = lerp(FRESH[2], AGED[2], age);

  const noise = makeNoise(seed);

  // Scales are in page units, not cells, so a big scrap and a small one show
  // the same size of mottling — they were cut from the same sheet.
  const blotchScale = 1 / 90;
  const fineScale = 1 / 7;
  const grain = settings.paperGrain;

  // The grids are indexed in texture pixels but their step is a page-unit
  // distance, so the features they carry keep the same size on the sheet
  // however finely the scrap is being rasterised.
  const blotch = sampleGrid(w, h, BLOTCH_STEP * detail, (x, y) =>
    noise.fbm((x / detail) * blotchScale, (y / detail) * blotchScale, 3),
  );
  const mottle = sampleGrid(w, h, MOTTLE_STEP * detail, (x, y) =>
    noise.at((x / detail) * fineScale, (y / detail) * fineScale),
  );

  const mottleGain = 16 * (0.4 + grain);
  const grainGain = 40 * grain;
  const dirtGain = 10 + age * 26;
  const edgeBand = Math.max(2, Math.min(w, h) * 0.09);

  const image = ctx.createImageData(w, h);
  const data = image.data;

  for (let y = 0; y < h; y++) {
    const edgeY = Math.min(y, h - 1 - y);
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      // Slow luminance drift — how the pulp settled.
      const b = (bilinear(blotch, x, y) - 0.5) * 26;
      // Mid-frequency mottle, the texture of the sheet itself.
      const m = (bilinear(mottle, x, y) - 0.5) * mottleGain;
      // Per-pixel grain — uncorrelated on purpose; this is the paper's tooth.
      const g = (hashNoise(x, y, seed) - 0.5) * grainGain;

      // Edge dirt: handled scraps darken where they were held and where the
      // cut exposed the fibre.
      const d = Math.min(x, w - 1 - x, edgeY);
      let dirt = 0;
      if (d < edgeBand) {
        const t = 1 - d / edgeBand;
        dirt = -t * t * dirtGain;
      }

      const delta = b + m + g + dirt;
      // Yellowing is not a uniform tint: blue loses the most, which is what
      // makes aged paper read as warm rather than as beige.
      const r = baseR + delta;
      const gr = baseG + delta * 1.02;
      const bl = baseB + delta * 1.1 - age * 4;
      data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      data[i + 1] = gr < 0 ? 0 : gr > 255 ? 255 : gr;
      data[i + 2] = bl < 0 ? 0 : bl > 255 ? 255 : bl;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Fibres and specks are physical objects on the sheet, so they are drawn in
  // page units and scale with the texture rather than multiplying with it.
  ctx.setTransform(detail, 0, 0, detail, 0, 0);
  drawFibres(ctx, pageW, pageH, grain, rng);
  drawSpecks(ctx, pageW, pageH, age, rng);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  return canvas;
}

/** Short pale strands — pulp fibres sitting proud of the surface. */
function drawFibres(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grain: number,
  rng: Rng,
): void {
  const count = Math.round((w * h) / 2600) * (0.4 + grain);
  ctx.lineCap = "round";
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const angle = rng() * Math.PI * 2;
    const len = range(rng, 2, 11);
    const light = chance(rng, 0.6);
    ctx.strokeStyle = light
      ? `rgba(255,255,255,${range(rng, 0.05, 0.16).toFixed(3)})`
      : `rgba(120,105,80,${range(rng, 0.04, 0.12).toFixed(3)})`;
    ctx.lineWidth = range(rng, 0.5, 1.1);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }
}

/** Stray toner. Rare, small, and never in the same place twice. */
function drawSpecks(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  age: number,
  rng: Rng,
): void {
  const count = int(rng, 0, Math.round(2 + (w * h) / 9000) * (0.5 + age));
  for (let i = 0; i < count; i++) {
    const r = range(rng, 0.4, 1.9);
    ctx.fillStyle = `rgba(40,34,26,${range(rng, 0.25, 0.7).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
