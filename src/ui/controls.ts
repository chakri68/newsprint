/**
 * Panel control builders -- the little HTML strings the right-hand panel is made
 * of. Pure: they emit markup and nothing else, so the wiring stays free to read
 * and sync them however the settings object happens to be shaped.
 */

export interface ControlBuilders {
  slider(
    key: string,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    unit: string,
  ): string;
  select(key: string, label: string, value: string, opts: [string, string][]): string;
  chips(key: string, label: string, value: string, opts: [string, string][]): string;
  toggle(key: string, label: string, value: boolean): string;
}

export function controls(prefix: string): ControlBuilders {
  const id = (key: string): string => `${prefix}-${key}`;
  return {
    slider(key, label, min, max, step, value, unit) {
      return `
    <div class="g-row">
      <label for="${id(key)}">${label}<span class="g-val">${formatVal(String(value), unit)}</span></label>
      <input id="${id(key)}" type="range" data-key="${key}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${value}" />
    </div>`;
    },
    select(key, label, value, opts) {
      return `
    <div class="g-row">
      <label for="${id(key)}">${label}</label>
      <select id="${id(key)}" data-key="${key}">
        ${opts.map(([v, t]) => `<option value="${v}"${v === value ? " selected" : ""}>${t}</option>`).join("")}
      </select>
    </div>`;
    },
    chips(key, label, value, opts) {
      return `
    <div class="g-row">
      <span class="g-chips-label">${label}</span>
      <div class="g-chips" data-key="${key}" role="group" aria-label="${label}">
        ${opts.map(([v, t]) => `<button class="chip${v === value ? " on" : ""}" data-val="${v}">${t}</button>`).join("")}
      </div>
    </div>`;
    },
    toggle(key, label, value) {
      return `
    <div class="g-row inline">
      <label for="${id(key)}">${label}</label>
      <input id="${id(key)}" type="checkbox" data-key="${key}"${value ? " checked" : ""} />
    </div>`;
    },
  };
}

export function formatVal(v: string, unit: string): string {
  const n = Number(v);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
  return unit === "x"
    ? `${s}x`
    : unit
      ? `${s}${unit === "px" || unit === "%" || unit === "deg" ? "" : " "}${unit}`
      : s;
}
