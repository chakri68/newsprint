/**
 * Deterministic randomness.
 *
 * Every visual decision in this tool is a draw from a seeded stream, never
 * `Math.random()` — same text + settings + seed has to reproduce the same
 * artwork, and "Randomize" is nothing more than a new seed.
 *
 * The reason there are *streams* rather than one generator: the renderer caches
 * in two tiers (clippings, then placement). If both tiers drew from one shared
 * sequence, nudging a layout slider would consume a different number of values
 * and silently reshuffle every word's typeface — and rebuilding only the cheap
 * tier would be impossible. So each tier, and each token within a tier, gets its
 * own stream derived from (seed, salt). Independent, reproducible, resumable.
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix a seed with a salt into a new, well-distributed seed. */
export function mixSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A named, independent stream off one seed. */
export function stream(seed: number, salt: number): Rng {
  return mulberry32(mixSeed(seed, salt));
}

/** Stable 32-bit hash of a string — lets a token's stream depend on its text. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function int(rng: Rng, min: number, max: number): number {
  return Math.floor(range(rng, min, max + 1 - Number.EPSILON));
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/** Weighted pick. Weights need not sum to anything in particular. */
export function weighted<T>(rng: Rng, items: readonly T[], weightOf: (item: T) => number): T {
  let total = 0;
  for (const item of items) total += Math.max(0, weightOf(item));
  if (total <= 0) return pick(rng, items);
  let r = rng() * total;
  for (const item of items) {
    r -= Math.max(0, weightOf(item));
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

/**
 * Roughly-normal deviate in -1..1 (three summed uniforms, rescaled).
 *
 * Uniform jitter makes every offset equally likely, which reads as noise; real
 * hand-placement clusters near the intended spot with the occasional outlier.
 * That is what this buys, for the cost of two extra calls.
 */
export function gauss(rng: Rng): number {
  return ((rng() + rng() + rng()) / 1.5 - 1) * 1.05;
}

/** Symmetric jitter around zero, magnitude `amount`. */
export function jitter(rng: Rng, amount: number): number {
  return gauss(rng) * amount;
}
