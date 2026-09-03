# newsprint

type a sentence, get it back cut out of a newspaper.

```
THE CITY NEVER SLEEPS
```

becomes four scraps of paper, each one printed on its own synthetic newsprint,
in its own typeface, with its own ink damage and its own torn edge, arranged the
way you'd arrange them on a table.

there is no image input. there is no image input *anywhere* — not upload, not
paste, not a texture pack it downloads on the sly. the only thing you give it is
text. every pixel of paper, grain, fibre, background print and ink is generated
in the tab.

## why this exists

every "ransom note generator" i found was a font picker with a paper JPEG behind
it, and you can tell instantly — the paper repeats, the letters all sit on the
same sheet, and nothing was ever actually cut out of anything. the tell is always
the same: it's one image with text on top, not a pile of separate objects.

so this one goes the other way. each word gets its own scrap of paper, generated
from scratch, and the scrap knows it was cut out of a larger page — there's faint
column text and a masthead fragment behind the headline, going off the edges,
because that's what's actually on a clipping. then it gets torn, inked badly, and
dropped on a board with a shadow under it.

turns out most of "looks real" is just committing to the objects being separate.

## running it

```bash
npm install
npm run dev
```

no backend, no accounts, no build step beyond vite.

## the controls

- **presets** — clean editorial, daily news, cut & paste, punk xerox, archive.
  they merge over the defaults, never over whatever you were just looking at, so
  clicking one twice does the same thing twice.
- **assembly** — word or letter, four layout modes, fill / rotation / jitter /
  overlap.
- **type** — how far each scrap may drift from the phrase's base treatment: face,
  size, weight, tracking, caps, italic.
- **paper** — cut, rough or torn edges; age, grain, margins.
- **ink** — bleed, distress, fade, ghosting, and how much of the page behind the
  headline shows through.
- **finish** — photocopy, which crushes the whole page to copier contrast and
  throws dirt at it.
- **seed** — same text + settings + seed always gives the same artwork.
  Randomize is nothing but a new number in that box.

## how it works (the load-bearing bits)

**everything is in page units.** the artwork has its own coordinate space and the
renderer takes a scale. the preview renders at one scale, export at another, and
neither knows about the other. that's why export is a genuine re-render and not
the preview stretched — the type is redrawn at 4860px, not upscaled to it.

**paper texture splits by frequency, and the two halves scale differently.** each
scrap's texture is generated at the scale that scrap is being rasterised at. the
*structural* bands — blotching, mottling, edge dirt, fibres, specks — are sampled
in page space, so they keep their size on the sheet however big the export gets;
index those per device pixel and they shrink away to nothing. the finest *tooth*
is sampled in texture space, so it always lands about one grain cell per output
pixel. pin that to page space instead and a 4× export smears every grain texel
across 4×4 output pixels — flat cream paper under razor-sharp type, which is the
plasticky look arrived at from the other direction. paper photographed closer
shows finer tooth, not blurrier tooth. ink damage scales with the type, because a
fleck of missing ink is part of the printing, not part of the paper.

this is what makes the download look like the viewport instead of a suspiciously
clean version of it. it costs: a 4× export is ~0.9s of blocking work, so Save
paints a pending state before it starts.

**three passes, cached by how expensive they are to redo.** plan every scrap
(pick a face, measure it, tear an outline — pure arithmetic), lay them out (also
arithmetic), then rasterise and composite (the only part that costs anything).
the raster cache is keyed on text, seed and the settings that change what a scrap
*is*. layout settings are deliberately not in that key, so dragging rotation
moves finished paper around and never re-renders ink.

**separate PRNG streams per tier, per token.** if both tiers drew from one
sequence, nudging a layout slider would consume a different number of values and
silently reshuffle every word's typeface. each token's stream is salted with its
own text, so editing the last word leaves the earlier scraps alone while you type.

**the tear is a damped random walk**, not per-point jitter. independent jitter
lets every point jump the full amplitude away from its neighbour and the eye
reads that as lightning. correlated deviation reads as paper. that one detail is
the whole difference between "torn" and "serrated".

**layout packs and measures rather than estimating.** it tries every row count,
measures what actually came out, and scores it against the page's aspect plus a
raggedness penalty borrowed from how a typesetter scores a paragraph. without the
penalty the search cheerfully sets RANSOM as five letters and a lonely M, which
scores beautifully on aspect and looks exactly as bad as it sounds. words always
flow left to right and top to bottom, in every mode including scatter — a
composition you can't read isn't a headline.

**the drop shadow is baked into each cached scrap.** it started life as canvas
`shadowBlur` at composite time, which recomputes on every `drawImage`; profiling
found a fully warm cache — doing nothing but blitting finished paper — still
costing 700ms a frame. baked into the raster it runs once per scrap and
compositing became a plain blit. same pass took the paper texture from 100ms to
10ms by sampling the smooth noise fields on coarse grids and interpolating, since
low-frequency noise per pixel is by definition buying nothing. cold render went
1726ms → 119ms.

**nothing renders until the fonts are actually loaded.** canvas `measureText`
against a fallback doesn't fail, it returns entirely plausible numbers for the
wrong typeface, and you get a composition laid out to metrics it then throws
away. the boot screen covers that wait honestly — the bar tracks faces
downloaded, not a timer pretending to. the font stylesheet is injected from JS
rather than linked in the head, because a render-blocking stylesheet for nine
display faces meant the loading screen couldn't paint until the loading was
already over. ask me how i know.
