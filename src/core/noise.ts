/**
 * Seeded value noise.
 *
 * Paper is not white and it is not uniformly off-white: it has slow luminance
 * drift over centimetres (how the pulp settled, how the light hits it) with fine
 * grain riding on top. One frequency cannot express both, so `fbm` sums octaves
 * — and the low ones are what stop a clipping from reading as a flat rectangle.
 *
 * The lattice is a fixed-size table of random values indexed by a hash of the
 * cell coordinate, so sampling is O(1), tiles infinitely, and never allocates
 * per-pixel. Everything derives from the seed; nothing here touches Math.random.
 */

import { mulberry32 } from "./prng";

const SIZE = 256;
const MASK = SIZE - 1;

export interface NoiseField {
  /** Smoothed value noise at (x, y), in 0..1. One unit = one lattice cell. */
  at(x: number, y: number): number;
  /** Summed octaves, in 0..1. */
  fbm(x: number, y: number, octaves: number): number;
}

/** Smoothstep — cubic ease, so cells blend without visible lattice creases. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

export function makeNoise(seed: number): NoiseField {
  const rand = mulberry32(seed);
  const table = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < table.length; i++) table[i] = rand();

  const lattice = (xi: number, yi: number): number =>
    table[((yi & MASK) << 8) | (xi & MASK)];

  const at = (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = fade(x - xi);
    const ty = fade(y - yi);
    const a = lattice(xi, yi);
    const b = lattice(xi + 1, yi);
    const c = lattice(xi, yi + 1);
    const d = lattice(xi + 1, yi + 1);
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };

  const fbm = (x: number, y: number, octaves: number): number => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let o = 0; o < octaves; o++) {
      sum += at(fx, fy) * amp;
      norm += amp;
      amp *= 0.5;
      fx *= 2.03; // slightly off 2 so octaves don't share lattice alignment
      fy *= 2.01;
    }
    return sum / norm;
  };

  return { at, fbm };
}

/** Cheap per-pixel white noise — for grain, where correlation is not wanted. */
export function hashNoise(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
