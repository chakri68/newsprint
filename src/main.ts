import "./style.css";
import { controls, formatVal } from "./ui/controls";
import { downloadBlob, suggestFilename } from "./export/download";
import { loadFonts } from "./core/fonts";
import {
  DEFAULTS,
  PAGE_SIZES,
  PRESETS,
  type PresetName,
  type Settings,
} from "./core/settings";
import { createCache, renderPage, type RenderStats } from "./core/render";

/**
 * newsprint -- type a sentence, get it back cut out of a newspaper.
 *
 * The page is rendered once into an offscreen canvas at its own resolution and
 * then blitted into the visible one under a fit/zoom/pan transform. Keeping
 * those two apart is what makes panning free: moving the view never touches the
 * renderer, and resizing the window never re-renders a single scrap of paper.
 *
 * Export is a re-render at a higher scale from the same text, settings and
 * seed -- never an upscale of what is on screen. That is the whole reason the
 * renderer takes a scale rather than reading one off the canvas.
 */

const PREVIEW_MAX = 1600; // longest page side, device px, for the preview raster
const MAX_EXPORT_PX = 40_000_000;
const MAX_ZOOM = 12;
const TEXT_DEBOUNCE = 140;

const PRESET_NAMES: PresetName[] = [
  "Clean Editorial",
  "Daily News",
  "Cut & Paste",
  "Punk Xerox",
  "Archive",
];

// The inline mask in index.html hides #app until this module has run, by which
// point its stylesheet has applied (Vite injects CSS during module evaluation in
// dev, and emits a real <link> in the build).
document.body.classList.add("booted");

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar">
    <h1>newsprint</h1>
    <div class="spacer"></div>
    <span class="readout" id="readout">&mdash;</span>
    <button class="btn" id="randomize" title="New seed">Randomize</button>
    <button class="btn" id="copy">Copy</button>
    <button class="btn primary" id="save">Save</button>
  </header>
  <div class="body">
    <div class="stage">
      <div class="screen">
        <canvas id="view"></canvas>
        <div class="hint hidden" id="hint">scroll to zoom &middot; drag to pan &middot; double-click to reset</div>
      </div>
      <div class="composer">
        <label for="text">source text</label>
        <textarea id="text" spellcheck="false" rows="2">THE CITY NEVER SLEEPS</textarea>
      </div>
    </div>
    <aside class="panel" id="panel"></aside>
  </div>
`;

const canvas = app.querySelector<HTMLCanvasElement>("#view")!;
const ctx = canvas.getContext("2d")!;
const panel = app.querySelector<HTMLElement>("#panel")!;
const textarea = app.querySelector<HTMLTextAreaElement>("#text")!;
const readout = app.querySelector<HTMLElement>("#readout")!;
const hint = app.querySelector<HTMLElement>("#hint")!;
const randomizeBtn = app.querySelector<HTMLButtonElement>("#randomize")!;
const copyBtn = app.querySelector<HTMLButtonElement>("#copy")!;
const saveBtn = app.querySelector<HTMLButtonElement>("#save")!;

// ---- State ---------------------------------------------------------------

const settings: Settings = { ...DEFAULTS };
let text = textarea.value;
let seed = Math.floor(Math.random() * 0xffffff);
let pageSizeId = PAGE_SIZES[0].id;
let exportScale = 2;
let ready = false;

const page = document.createElement("canvas");
const cache = createCache();
let stats: RenderStats = { pieces: 0, rasterScale: 1, milliseconds: 0 };

let zoom = 1;
let panX = 0;
let panY = 0;

const pageSize = (): { width: number; height: number } =>
  PAGE_SIZES.find((p) => p.id === pageSizeId) ?? PAGE_SIZES[0];

const previewScale = (): number => {
  const { width, height } = pageSize();
  return Math.min(1, PREVIEW_MAX / Math.max(width, height));
};

// ---- Render scheduling ---------------------------------------------------
// Two tiers, the same trick the renderer uses internally: the page raster is
// the expensive thing and the view transform is free, so they get separate
// flags. Panning never re-renders; a slider never re-blits on its own.

let pageDirty = true;
let viewDirty = true;
let raf = 0;

function frame(): void {
  raf = 0;
  if (!ready) return;
  if (pageDirty) {
    const { width, height } = pageSize();
    stats = renderPage(page, {
      text,
      settings,
      seed,
      pageWidth: width,
      pageHeight: height,
      scale: previewScale(),
      cache,
    });
    pageDirty = false;
    viewDirty = true;
    refreshReadout();
  }
  if (viewDirty) {
    blit();
    viewDirty = false;
  }
}

const kick = (): void => {
  if (!raf) raf = requestAnimationFrame(frame);
};
const schedulePage = (): void => {
  pageDirty = true;
  kick();
};
const scheduleView = (): void => {
  viewDirty = true;
  kick();
};

function refreshReadout(): void {
  const { width, height } = pageSize();
  readout.textContent = `${width}×${height} · ${stats.pieces} ${
    stats.pieces === 1 ? "piece" : "pieces"
  } · ${Math.round(stats.milliseconds)} ms · seed ${seed}`;
}

// ---- View ----------------------------------------------------------------

const fitScale = (): number =>
  Math.min(
    canvas.width / Math.max(1, page.width),
    canvas.height / Math.max(1, page.height),
  );

function clampPan(): void {
  const s = fitScale() * zoom;
  const limX = Math.max(0, (page.width * s - canvas.width) / 2);
  const limY = Math.max(0, (page.height * s - canvas.height) / 2);
  panX = Math.max(-limX, Math.min(limX, panX));
  panY = Math.max(-limY, Math.min(limY, panY));
}

function blit(): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (page.width === 0 || page.height === 0) return;

  const s = fitScale() * zoom;
  const w = page.width * s;
  const h = page.height * s;
  const x = (canvas.width - w) / 2 + panX;
  const y = (canvas.height - h) / 2 + panY;

  // The artwork sits on the terminal's black. A hairline keeps its own edge
  // legible when the ground is white or transparent.
  ctx.strokeStyle = "rgba(255,176,0,0.22)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  ctx.drawImage(page, x, y, w, h);
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  clampPan();
  scheduleView();
}
window.addEventListener("resize", resize);

// ---- Zoom + pan ----------------------------------------------------------

const toDevice = (clientX: number, clientY: number): { x: number; y: number } => {
  const r = canvas.getBoundingClientRect();
  return {
    x: (clientX - r.left) * (canvas.width / r.width),
    y: (clientY - r.top) * (canvas.height / r.height),
  };
};

/** Zoom about a screen point, holding the page pixel under it still. */
function zoomToward(factor: number, clientX: number, clientY: number): void {
  const next = Math.max(1, Math.min(MAX_ZOOM, zoom * factor));
  if (next === zoom) return;
  const p = toDevice(clientX, clientY);
  const f = fitScale();
  const s0 = f * zoom;
  const s1 = f * next;
  const imgX = (p.x - ((canvas.width - page.width * s0) / 2 + panX)) / s0;
  const imgY = (p.y - ((canvas.height - page.height * s0) / 2 + panY)) / s0;
  panX = p.x - imgX * s1 - (canvas.width - page.width * s1) / 2;
  panY = p.y - imgY * s1 - (canvas.height - page.height * s1) / 2;
  zoom = next;
  if (zoom === 1) {
    panX = 0;
    panY = 0;
  }
  clampPan();
  scheduleView();
}

const pointers = new Map<number, { x: number; y: number }>();
let drag: { x: number; y: number; panX: number; panY: number } | null = null;
let pinch: { dist: number; midX: number; midY: number } | null = null;

function beginPinch(): void {
  const [a, b] = [...pointers.values()];
  pinch = {
    dist: Math.hypot(a.x - b.x, a.y - b.y),
    midX: (a.x + b.x) / 2,
    midY: (a.y + b.y) / 2,
  };
  drag = null;
}

canvas.addEventListener("pointerdown", (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* nothing to capture */
  }
  if (pointers.size >= 2) {
    beginPinch();
    e.preventDefault();
    return;
  }
  if (e.button === 0) drag = { x: e.clientX, y: e.clientY, panX, panY };
});

canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const r = canvas.getBoundingClientRect();
  const toDevX = canvas.width / r.width;
  const toDevY = canvas.height / r.height;
  if (pinch) {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    if (pinch.dist > 0) {
      zoomToward(dist / pinch.dist, midX, midY);
      panX += (midX - pinch.midX) * toDevX;
      panY += (midY - pinch.midY) * toDevY;
      clampPan();
      scheduleView();
    }
    pinch = { dist, midX, midY };
  } else if (drag) {
    panX = drag.panX + (e.clientX - drag.x) * toDevX;
    panY = drag.panY + (e.clientY - drag.y) * toDevY;
    clampPan();
    scheduleView();
  }
});

function endPointer(e: PointerEvent): void {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  if (pointers.size === 1 && pinch) {
    const [p] = [...pointers.values()];
    pinch = null;
    drag = { x: p.x, y: p.y, panX, panY };
  } else if (pointers.size === 0) {
    drag = null;
    pinch = null;
  }
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoomToward(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  },
  { passive: false },
);

canvas.addEventListener("dblclick", () => {
  if (zoom === 1) return;
  zoom = 1;
  panX = 0;
  panY = 0;
  scheduleView();
});

// ---- Text ----------------------------------------------------------------

let textTimer = 0;
textarea.addEventListener("input", () => {
  window.clearTimeout(textTimer);
  textTimer = window.setTimeout(() => {
    text = textarea.value;
    schedulePage();
  }, TEXT_DEBOUNCE);
});

// ---- Panel ---------------------------------------------------------------

const { slider, chips } = controls("n");

panel.innerHTML = `
  <div class="g-group">
    <h2>preset</h2>
    <div class="g-presets">
      ${PRESET_NAMES.map((n) => `<button class="chip" data-preset="${n}">${n}</button>`).join("")}
      <button class="chip" data-preset="reset">Reset</button>
    </div>
  </div>

  <div class="g-group">
    <h2>page</h2>
    <div class="g-row">
      <label for="n-page">size</label>
      <select id="n-page">
        ${PAGE_SIZES.map(
          (p) =>
            `<option value="${p.id}"${p.id === pageSizeId ? " selected" : ""}>${p.label} &mdash; ${p.width}×${p.height}</option>`,
        ).join("")}
      </select>
    </div>
    ${chips("background", "ground", settings.background, [
      ["board", "Board"],
      ["white", "White"],
      ["black", "Black"],
      ["transparent", "None"],
    ])}
  </div>

  <div class="g-group">
    <h2>assembly</h2>
    ${chips("tokenMode", "cut by", settings.tokenMode, [
      ["word", "Word"],
      ["character", "Letter"],
    ])}
    ${chips("layout", "layout", settings.layout, [
      ["baseline", "Baseline"],
      ["loose", "Loose"],
      ["stacked", "Stacked"],
      ["scatter", "Scatter"],
    ])}
    ${slider("fill", "fill", 0.4, 0.98, 0.01, settings.fill, "")}
    ${slider("rotation", "rotation", 0, 25, 0.5, settings.rotation, "deg")}
    ${slider("positionJitter", "jitter", 0, 1, 0.01, settings.positionJitter, "")}
    ${slider("overlap", "overlap", 0, 0.35, 0.01, settings.overlap, "")}
    <small class="g-note">Words always flow left to right and top to bottom, whatever the
    layout does to them &mdash; a composition you cannot read is not a headline.</small>
  </div>

  <div class="g-group">
    <h2>type</h2>
    ${slider("fontVariation", "face variation", 0, 1, 0.01, settings.fontVariation, "")}
    ${slider("sizeVariation", "size variation", 0, 1, 0.01, settings.sizeVariation, "")}
    ${slider("weightVariation", "weight variation", 0, 1, 0.01, settings.weightVariation, "")}
    ${slider("trackingVariation", "tracking", 0, 1, 0.01, settings.trackingVariation, "")}
    ${slider("uppercaseChance", "caps chance", 0, 1, 0.01, settings.uppercaseChance, "")}
    ${slider("italicChance", "italic chance", 0, 1, 0.01, settings.italicChance, "")}
  </div>

  <div class="g-group">
    <h2>paper</h2>
    ${chips("paperShape", "edges", settings.paperShape, [
      ["rectangle", "Cut"],
      ["rough-rectangle", "Rough"],
      ["torn", "Torn"],
    ])}
    ${slider("edgeRoughness", "roughness", 0, 1, 0.01, settings.edgeRoughness, "")}
    ${slider("paperAge", "age", 0, 1, 0.01, settings.paperAge, "")}
    ${slider("paperGrain", "grain", 0, 1, 0.01, settings.paperGrain, "")}
    ${slider("paddingX", "margin x", 2, 48, 1, settings.paddingX, "px")}
    ${slider("paddingY", "margin y", 2, 48, 1, settings.paddingY, "px")}
    ${slider("paddingVariation", "margin variation", 0, 1, 0.01, settings.paddingVariation, "")}
  </div>

  <div class="g-group">
    <h2>ink</h2>
    ${slider("inkBleed", "bleed", 0, 1, 0.01, settings.inkBleed, "")}
    ${slider("inkDistress", "distress", 0, 1, 0.01, settings.inkDistress, "")}
    ${slider("inkFade", "fade", 0, 1, 0.01, settings.inkFade, "")}
    ${slider("ghosting", "ghosting", 0, 1, 0.01, settings.ghosting, "")}
    ${slider("backgroundPrint", "page behind", 0, 1, 0.01, settings.backgroundPrint, "")}
  </div>

  <div class="g-group">
    <h2>finish</h2>
    ${slider("photocopy", "photocopy", 0, 1, 0.01, settings.photocopy, "")}
    <small class="g-note">Crushes the whole page to copier contrast and lays dirt over it.
    The only pass that touches every pixel, so it is also the only slow one.</small>
  </div>

  <div class="g-group">
    <h2>seed</h2>
    <div class="g-seed">
      <input id="n-seed" type="number" min="0" step="1" value="${seed}" />
      <button class="btn" id="n-reseed">New</button>
    </div>
    <small class="g-note">Same text, settings and seed always produce the same artwork.
    Randomize is nothing more than a new number here.</small>
  </div>

  <div class="g-group">
    <h2>export</h2>
    <div class="g-row">
      <label for="n-export">resolution</label>
      <select id="n-export"></select>
    </div>
    <small class="g-note">Export re-renders from the text, settings and seed at the higher
    resolution &mdash; it is not the preview scaled up, so the type stays sharp. Paper grain
    keeps its size on the page rather than getting finer, which is why a 3&times; export
    still reads as paper.</small>
  </div>

  <div class="foot">
    <span>&gt; nothing uploaded, ever</span>
    <a href="https://github.com/chakri68" target="_blank" rel="noopener">chakri68</a>
  </div>
`;

const bag = settings as unknown as Record<string, unknown>;

// One generic handler: the element's own type says how to read it, so adding a
// setting means adding a row and nothing else.
panel
  .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    "input[data-key], select[data-key]",
  )
  .forEach((el) => {
    el.addEventListener("input", () => {
      const key = el.dataset.key!;
      if (el instanceof HTMLInputElement && el.type === "range") {
        bag[key] = Number(el.value);
        const out = el.parentElement?.querySelector<HTMLElement>(".g-val");
        if (out) out.textContent = formatVal(el.value, el.dataset.unit ?? "");
      } else if (el instanceof HTMLInputElement && el.type === "checkbox") {
        bag[key] = el.checked;
      } else {
        bag[key] = el.value;
      }
      syncPresetHighlight();
      schedulePage();
    });
  });

panel.querySelectorAll<HTMLElement>(".g-chips").forEach((group) => {
  group.querySelectorAll<HTMLButtonElement>(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      group.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
      chip.classList.add("on");
      bag[group.dataset.key!] = chip.dataset.val!;
      syncPresetHighlight();
      schedulePage();
    });
  });
});

panel.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const name = btn.dataset.preset!;
    // Merge over the defaults, never over the current state, so a preset means
    // the same thing whatever you were looking at when you clicked it.
    Object.assign(settings, DEFAULTS, name === "reset" ? {} : PRESETS[name as PresetName]);
    syncControls();
    schedulePage();
  });
});

/** Push settings back into the controls (after a preset or reset). */
function syncControls(): void {
  panel
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "input[data-key], select[data-key]",
    )
    .forEach((el) => {
      const value = bag[el.dataset.key!];
      if (el instanceof HTMLInputElement && el.type === "checkbox") {
        el.checked = Boolean(value);
        return;
      }
      el.value = String(value);
      const out = el.parentElement?.querySelector<HTMLElement>(".g-val");
      if (out) out.textContent = formatVal(el.value, el.dataset.unit ?? "");
    });
  panel.querySelectorAll<HTMLElement>(".g-chips").forEach((group) => {
    const value = String(bag[group.dataset.key!]);
    group.querySelectorAll<HTMLButtonElement>(".chip").forEach((chip) => {
      chip.classList.toggle("on", chip.dataset.val === value);
    });
  });
  syncPresetHighlight();
}

/** Light up the preset whose settings the current state exactly matches. */
function syncPresetHighlight(): void {
  panel.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((btn) => {
    const name = btn.dataset.preset!;
    const preset = name === "reset" ? DEFAULTS : PRESETS[name as PresetName];
    btn.classList.toggle(
      "on",
      Object.entries(preset).every(([k, v]) => bag[k] === v),
    );
  });
}

// ---- Page size, seed, export ---------------------------------------------

const pageSelect = panel.querySelector<HTMLSelectElement>("#n-page")!;
pageSelect.addEventListener("change", () => {
  pageSizeId = pageSelect.value;
  zoom = 1;
  panX = 0;
  panY = 0;
  syncExportScales();
  schedulePage();
});

const seedInput = panel.querySelector<HTMLInputElement>("#n-seed")!;
seedInput.addEventListener("change", () => {
  const value = Number(seedInput.value);
  seed = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  seedInput.value = String(seed);
  schedulePage();
});

function reseed(): void {
  seed = Math.floor(Math.random() * 0xffffff);
  seedInput.value = String(seed);
  schedulePage();
}
panel.querySelector<HTMLButtonElement>("#n-reseed")!.addEventListener("click", reseed);
randomizeBtn.addEventListener("click", reseed);

const exportSelect = panel.querySelector<HTMLSelectElement>("#n-export")!;

/** Offer only the multipliers whose output stays inside the safe pixel budget. */
function syncExportScales(): void {
  const { width, height } = pageSize();
  const options: string[] = [];
  const available: number[] = [];
  for (const s of [1, 2, 3, 4]) {
    const w = Math.round(width * s);
    const h = Math.round(height * s);
    if (w * h > MAX_EXPORT_PX) break;
    options.push(`<option value="${s}">${s}× &mdash; ${w}×${h}</option>`);
    available.push(s);
  }
  exportSelect.innerHTML = options.join("");
  if (!available.includes(exportScale)) {
    exportScale = available.includes(2) ? 2 : available[available.length - 1];
  }
  exportSelect.value = String(exportScale);
}
exportSelect.addEventListener("change", () => {
  exportScale = Number(exportSelect.value);
});
syncExportScales();
syncPresetHighlight();

// ---- Export --------------------------------------------------------------

copyBtn.addEventListener("click", () => void exportImage("copy"));
saveBtn.addEventListener("click", () => void exportImage("save"));

async function exportImage(mode: "copy" | "save"): Promise<void> {
  const { width, height } = pageSize();
  const out = document.createElement("canvas");
  // Same renderer, same settings, same seed -- only the scale differs. A fresh
  // cache, because these rasters are export-sized and would evict the preview's
  // for no benefit.
  renderPage(out, {
    text,
    settings,
    seed,
    pageWidth: width,
    pageHeight: height,
    scale: exportScale,
    cache: createCache(),
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    out.toBlob(resolve, "image/png"),
  );
  if (!blob) return;

  if (mode === "copy") {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flash(copyBtn, "Copied");
    } catch {
      flash(copyBtn, "Blocked");
    }
    return;
  }
  downloadBlob(blob, suggestFilename(text, "png"));
}

function flash(button: HTMLButtonElement, label: string): void {
  const previous = button.textContent;
  button.textContent = label;
  setTimeout(() => (button.textContent = previous), 1200);
}

// ---- Boot ----------------------------------------------------------------

// Nothing renders until the type pool has actually loaded. Canvas measureText
// against a fallback returns entirely plausible numbers for the wrong font, so
// an early first paint would lay the composition out to metrics it then throws
// away -- and the reflow when the real faces arrive is very visible. The boot
// screen covers that wait honestly: the bar tracks faces actually downloaded,
// not a timer pretending to.
const intro = document.getElementById("intro")!;
const introFill = document.getElementById("intro-fill")!;
const introSub = document.getElementById("intro-sub")!;

function dismissIntro(): void {
  intro.classList.add("done");
  // Take it out of the layer tree once the fade is over rather than leaving a
  // full-screen transparent div sitting on top of the canvas eating pointers.
  intro.addEventListener("transitionend", () => intro.classList.add("gone"), {
    once: true,
  });
  setTimeout(() => intro.classList.add("gone"), 900); // if the transition never fires
}

resize();
void loadFonts((done, total) => {
  introFill.style.width = `${Math.round((done / total) * 100)}%`;
  introSub.textContent = done < total ? `setting type ${done}/${total}` : "composing";
}).then(() => {
  ready = true;
  hint.classList.remove("hidden");
  resize();
  // Render the first composition *before* the curtain lifts, so the reveal
  // lands on finished artwork instead of an empty board.
  frame();
  schedulePage();
  requestAnimationFrame(dismissIntro);
});
