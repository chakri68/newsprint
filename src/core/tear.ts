/**
 * Paper outlines — clean, roughly cut, or torn.
 *
 * The tear is a damped random walk along each edge rather than independent
 * jitter per point. Independent jitter gives a zigzag: every point is free to
 * jump the full amplitude away from its neighbour, and the eye reads that as
 * lightning, not paper. A walk keeps consecutive deviations correlated — the
 * tear wanders — while the pull back toward the edge stops it drifting away.
 * That correlation is the entire difference between "torn" and "serrated".
 */

import type { Rng } from "./prng";
import { chance, gauss, range } from "./prng";
import type { PaperShape } from "./settings";

export interface Point {
  x: number;
  y: number;
}

/** How far the tear may wander from the nominal edge, in page units. */
function amplitudeFor(shape: PaperShape, roughness: number, size: number): number {
  if (shape === "rectangle") return 0;
  const base = shape === "torn" ? 0.055 : 0.014;
  return size * base * (0.35 + roughness * 1.3);
}

function segmentsFor(shape: PaperShape, length: number): number {
  const per = shape === "torn" ? 16 : 26; // page units per segment
  return Math.max(3, Math.min(60, Math.round(length / per)));
}

/**
 * Points along one edge, jittered perpendicular to it. Endpoints are left
 * untouched so adjacent edges still meet at the corners.
 */
export function generateTornEdge(
  start: Point,
  end: Point,
  segments: number,
  amplitude: number,
  rng: Rng,
  notchChance: number,
): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  const points: Point[] = [start];
  let offset = 0;

  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    // Damped walk: 0.62 keeps the memory of where the tear already was, the
    // added deviate is the new wander, and the whole thing is squeezed to zero
    // at both ends so corners stay put.
    offset = offset * 0.62 + gauss(rng) * amplitude * 0.5;
    let deviation = offset;

    // The occasional deeper notch — where a fibre gave way early.
    if (chance(rng, notchChance)) deviation += gauss(rng) * amplitude * 1.6;

    const taper = Math.sin(Math.PI * t); // 0 at the corners, 1 mid-edge
    const d = deviation * taper;
    points.push({
      x: start.x + dx * t + nx * d,
      y: start.y + dy * t + ny * d,
    });
  }

  points.push(end);
  return points;
}

/**
 * The closed outline of one scrap of paper, in its own local space
 * (0,0 → width,height).
 */
export function paperPath(
  width: number,
  height: number,
  shape: PaperShape,
  roughness: number,
  rng: Rng,
): Point[] {
  if (shape === "rectangle") {
    return [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ];
  }

  const notchChance = shape === "torn" ? 0.1 : 0.03;
  // Corners drift a little so the scrap is not a perfect rectangle before the
  // edges even start wandering.
  const skew = shape === "torn" ? 0.02 : 0.008;
  const sx = width * skew * (0.4 + roughness);
  const sy = height * skew * (0.4 + roughness);
  const corners: Point[] = [
    { x: range(rng, 0, sx), y: range(rng, 0, sy) },
    { x: width - range(rng, 0, sx), y: range(rng, 0, sy) },
    { x: width - range(rng, 0, sx), y: height - range(rng, 0, sy) },
    { x: range(rng, 0, sx), y: height - range(rng, 0, sy) },
  ];

  const horizontal = amplitudeFor(shape, roughness, height);
  const vertical = amplitudeFor(shape, roughness, width);

  const out: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const isHorizontalEdge = i === 0 || i === 2;
    const amp = isHorizontalEdge ? horizontal : vertical;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const edge = generateTornEdge(a, b, segmentsFor(shape, len), amp, rng, notchChance);
    // Drop the last point — the next edge starts there.
    out.push(...edge.slice(0, -1));
  }
  return out;
}

export function tracePath(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

/** Axis-aligned bounds of an outline — the tear can push past the nominal box. */
export function pathBounds(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
