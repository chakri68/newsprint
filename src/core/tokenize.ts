/**
 * Text → tokens.
 *
 * A token is one piece of paper. Word mode keeps punctuation glued to the word
 * it belongs to ("SLEEPS." is one clipping, not two) because a comma cut onto
 * its own scrap reads as a mistake rather than as punctuation.
 *
 * Line breaks in the source survive as `breakBefore`, so a typed stanza lays out
 * as a stanza. The spec never mentions this; people type multi-line text anyway.
 */

export type TokenMode = "word" | "character";

export interface Token {
  text: string;
  /** Position in the phrase — fixes reading order and seeds the token's stream. */
  index: number;
  /** Start a new row here regardless of what would otherwise fit. */
  breakBefore: boolean;
  /**
   * A word boundary fell before this token. Only ever true in character mode,
   * where the space was dropped rather than cut out -- the layout pass has to
   * put the gap back or the phrase runs together into one long word.
   */
  spaceBefore: boolean;
}

export function tokenize(text: string, mode: TokenMode): Token[] {
  const tokens: Token[] = [];
  const lines = text.split(/\r?\n/);

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line) continue;

    const words = line.split(/\s+/).filter(Boolean);

    if (mode === "word") {
      for (let wi = 0; wi < words.length; wi++) {
        tokens.push({
          text: words[wi],
          index: tokens.length,
          breakBefore: wi === 0 && tokens.length > 0,
          spaceBefore: false,
        });
      }
      continue;
    }

    // Character mode: a blank scrap of paper is not a letter, so spaces never
    // become clippings -- they survive as `spaceBefore` on the letter after.
    for (let wi = 0; wi < words.length; wi++) {
      const chars = [...words[wi]];
      for (let ci = 0; ci < chars.length; ci++) {
        tokens.push({
          text: chars[ci],
          index: tokens.length,
          breakBefore: wi === 0 && ci === 0 && tokens.length > 0,
          spaceBefore: ci === 0 && wi > 0,
        });
      }
    }
  }

  return tokens;
}
