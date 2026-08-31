import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_NAME = "RandomLatentSizePicker";
const CUSTOM_FAMILY = "custom size";
const HIDDEN_TYPE = "rlsp-hidden";
const SELECTED_WIDGET = "Selected Size";

const PANEL_HEIGHT_PROPERTY = "rlsp_panel_height";
const PANEL_HEIGHT_DEFAULT = 150;
const PANEL_HEIGHT_MIN = 44;
const PANEL_HEIGHT_MAX = 900;
const GRIP_HEIGHT = 8;

const PLACEHOLDER = "sample resolution\n1536x1024\n1472x1088\n1600x960";

const NOTE_CUSTOM_PRESET =
    "Type one resolution per line. Every image is generated at a size picked at random from this list only - nothing stored in the node is used.";
const NOTE_CUSTOM_FAMILY =
    "Edit freely, then press SAVE. Sizes are sorted into landscape / portrait / square automatically from their aspect ratio.";

const HELP_TEXT = `MODE
  RANDOM     picks one size from the list using the seed.
  SEQUENCE   walks the list one step per run, wrapping round at
             the end. The marked chip is where the next run
             starts: click a chip to start there, drag one to
             change the order. The seed is the step counter, so
             control after generate is set to increment when you
             switch to this mode; decrement walks back but stops
             at zero, and randomize turns it into RANDOM.
  FIXED      always uses the size in resolution_list, or the chip
             you click in the display.

MODEL FAMILY
  Chooses which built-in size table is offered: krea2, z-image,
  flux, boogu, hidream, sdxl, sd1.5. The latent shape itself
  still comes from the connected MODEL, so the family only picks
  which sizes are on the menu.
  custom size uses your own list, kept on disk at
  ComfyUI/user/random_latent_size_picker/custom_sizes.json

RESOLUTION PRESET
  landscape / portrait / square narrow the list by orientation,
  worked out from each size's aspect ratio.
  all      every size in the family.
  custom   ignores the built-in table completely, for every
           family. Only what you type in the box is used.

DISPLAY
  Chips show exactly what a run will pick from. Blue is
  landscape, violet is portrait, green is square. In FIXED mode
  the chips are clickable.
  EDIT swaps the chips for the editor and back. The editor holds
  the whole list whatever the preset is set to, and the ratio in
  brackets is worked out as you type.
  Drag the bar under the panel, or the node's own corner, to
  resize the display.

BUTTONS
  SAVE   writes the editor contents to custom_sizes.json.
  RESET  throws away edits and reloads the saved file.

FORMAT
  One resolution per line: 1536x1024. A comma instead of the x,
  and a trailing ratio in brackets, are both accepted. Sizes are
  rounded to the connected model's latent step automatically.`;

const WIDGET_ORDER = [
    "rlsp_mode",
    "mode",
    "model_family",
    "seed",
    "control_after_generate",
    "resolution_preset",
    "resolution_list",
    "batch_size",
    SELECTED_WIDGET,
    "rlsp_panel",
    "resolution_text",
    "rlsp_actions",
];

let sizeCache = null;
let sizePromise = null;

function fetchSizes(force) {
    if (force) {
        sizeCache = null;
        sizePromise = null;
    }
    if (sizeCache) {
        return Promise.resolve(sizeCache);
    }
    if (!sizePromise) {
        sizePromise = api
            .fetchApi("/studio_leiel/rlsp/sizes")
            .then((response) => response.json())
            .then((data) => {
                sizeCache = data && data.families ? data : { families: {} };
                return sizeCache;
            })
            .catch(() => {
                sizeCache = { families: {} };
                return sizeCache;
            });
    }
    return sizePromise;
}

/* ------------------------------------------------------------------ *
 * size helpers
 * ------------------------------------------------------------------ */

function ratioLabel(width, height) {
    let ratio = (width / height).toFixed(2);
    if (ratio.endsWith("0")) {
        ratio = ratio.slice(0, -1);
    }
    return ratio;
}

function formatSize(width, height) {
    return `${width}\u00d7${height} (${ratioLabel(width, height)})`;
}

function plainSize(width, height) {
    return `${width}x${height}`;
}

function parseSize(text) {
    if (text === null || text === undefined) {
        return null;
    }
    const head = String(text).split("(")[0];
    const numbers = head.match(/\d+/g);
    if (!numbers || numbers.length < 2) {
        return null;
    }
    const width = parseInt(numbers[0], 10);
    const height = parseInt(numbers[1], 10);
    if (!width || !height || width < 64 || height < 64) {
        return null;
    }
    if (width > 16384 || height > 16384) {
        return null;
    }
    return [width, height];
}

function parseSizeList(text) {
    if (!text) {
        return [];
    }
    const parsed = [];
    for (const line of String(text).split(/[\n|;]/)) {
        const size = parseSize(line.trim());
        if (size && !parsed.some((s) => s[0] === size[0] && s[1] === size[1])) {
            parsed.push(size);
        }
    }
    return parsed;
}

function orientationOf(width, height) {
    if (width > height) {
        return "landscape";
    }
    if (width < height) {
        return "portrait";
    }
    return "square";
}

function filterByPreset(sizes, preset) {
    if (preset === "all" || preset === "custom") {
        return sizes.slice();
    }
    return sizes.filter((s) => orientationOf(s[0], s[1]) === preset);
}

function sortByRatio(sizes) {
    return sizes.slice().sort((a, b) => a[0] / a[1] - b[0] / b[1] || a[0] - b[0]);
}

function sameSizes(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) {
            return false;
        }
    }
    return true;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/* ------------------------------------------------------------------ *
 * widget helpers
 * ------------------------------------------------------------------ */

function hideWidget(widget) {
    if (!widget || widget.__rlspHidden) {
        return;
    }
    widget.__rlspHidden = true;
    widget.__rlspType = widget.type;
    widget.__rlspComputeSize = widget.computeSize;
    widget.type = HIDDEN_TYPE;
    widget.hidden = true;
    widget.computeSize = () => [0, -4];

    const el = widget.element || widget.inputEl;
    if (el && el.style) {
        widget.__rlspDisplay = el.style.display;
        el.style.display = "none";
    }
}

function showWidget(widget) {
    if (!widget || !widget.__rlspHidden) {
        return;
    }
    widget.type = widget.__rlspType;
    widget.computeSize = widget.__rlspComputeSize;
    widget.hidden = false;

    const el = widget.element || widget.inputEl;
    if (el && el.style) {
        el.style.display = widget.__rlspDisplay || "";
    }

    delete widget.__rlspHidden;
    delete widget.__rlspType;
    delete widget.__rlspComputeSize;
    delete widget.__rlspDisplay;
}

function setWidgetVisible(widget, visible) {
    if (visible) {
        showWidget(widget);
    } else {
        hideWidget(widget);
    }
}

function widgetByName(node, name) {
    return node.widgets ? node.widgets.find((w) => w.name === name) : undefined;
}

function seedControlWidgets(node, seedWidget) {
    const targets = [];
    if (seedWidget && Array.isArray(seedWidget.linkedWidgets)) {
        targets.push(...seedWidget.linkedWidgets);
    }
    for (const widget of node.widgets || []) {
        if (widget.name === "control_after_generate" && !targets.includes(widget)) {
            targets.push(widget);
        }
    }
    return targets;
}

function orderWidgets(node) {
    if (!node.widgets) {
        return;
    }
    const ranked = [];
    const rest = [];
    for (const widget of node.widgets) {
        const index = WIDGET_ORDER.indexOf(widget.name);
        if (index === -1) {
            rest.push(widget);
        } else {
            ranked.push([index, widget]);
        }
    }
    ranked.sort((a, b) => a[0] - b[0]);
    node.widgets = ranked.map((entry) => entry[1]).concat(rest);
}

function setDomWidgetHeight(widget, height) {
    widget.__rlspHeight = height;
    widget.options = widget.options || {};
    widget.options.getHeight = () => height;
    widget.options.getMinHeight = () => height;
    widget.options.getMaxHeight = () => height;
    widget.computeSize = () => [0, height];
}

function baseComputeSize(node) {
    const base = node.__rlspBaseComputeSize || node.computeSize;
    return base.call(node);
}

function fitNode(node) {
    // Change, then settle the node, then draw. Any other order and the size
    // correction inside the redraw fights the change.
    node.__rlspAdjusting = true;
    try {
        const computed = baseComputeSize(node);
        node.setSize([Math.max(node.size[0], computed[0]), computed[1]]);
    } finally {
        node.__rlspAdjusting = false;
    }
    node.setDirtyCanvas(true, true);
}

/* ------------------------------------------------------------------ *
 * styles
 * ------------------------------------------------------------------ */

const STYLE_ID = "rlsp-styles";

function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.rlsp-root {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    font-family: inherit;
    color: var(--input-text, #ddd);
}
.rlsp-cap {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.11em;
    text-transform: uppercase;
}

.rlsp-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
.rlsp-seg {
    flex: 0 0 auto;
    display: inline-flex;
    padding: 2px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.24);
    border: 1px solid rgba(255, 255, 255, 0.07);
}
.rlsp-seg button {
    appearance: none;
    border: 0;
    cursor: pointer;
    padding: 2px 12px;
    border-radius: 999px;
    background: transparent;
    color: rgba(255, 255, 255, 0.42);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    transition: background 0.12s, color 0.12s;
}
.rlsp-seg button:hover {
    color: rgba(255, 255, 255, 0.75);
}
.rlsp-seg button.rlsp-active {
    color: #9dbbe4;
    background: rgba(127, 168, 232, 0.16);
}
.rlsp-seg button.rlsp-active[data-mode="sequential"] {
    color: #86c7a4;
    background: rgba(127, 201, 160, 0.16);
}
.rlsp-seg button.rlsp-active[data-mode="fixed"] {
    color: #e08f52;
    background: rgba(224, 143, 82, 0.18);
}
.rlsp-title .rlsp-st.rlsp-seq {
    color: #86c7a4;
}
/* The step the next run will use. A ring rather than a brighter fill: every
   size in a sequence is an equal member of the list, and dimming the rest
   makes them look disabled. */
.rlsp-chip.rlsp-now {
    box-shadow: 0 0 0 2px #86c7a4;
    border-color: transparent;
}
.rlsp-chip.rlsp-drag {
    opacity: 0.3;
}
.rlsp-chips.rlsp-sorting .rlsp-chip {
    cursor: grab;
}
.rlsp-chips.rlsp-sorting .rlsp-chip.rlsp-drag {
    cursor: grabbing;
}
/* the chip the next run starts from */
.rlsp-chip .rlsp-go {
    font-size: 8px;
    line-height: 16px;
    color: #86c7a4;
    margin-right: -1px;
}
/* where the chip will land */
.rlsp-drop {
    flex: 0 0 auto;
    align-self: center;
    width: 3px;
    height: 20px;
    border-radius: 2px;
    background: #d9b26a;
}
.rlsp-hint {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.26);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.rlsp-wrap {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.rlsp-panel {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    /* A near-black well, so the panel reads as a recess rather than as more
       node body. */
    background: rgba(0, 0, 0, 0.62);
    overflow: hidden;
}
.rlsp-head {
    position: relative;
    flex: 0 0 auto;
    min-width: 0;
    padding: 5px 7px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(0, 0, 0, 0.35);
}
/* One text node for the whole title. Two boxes in a row could be laid out
   on top of each other by the host's stylesheet; a single line cannot. */
.rlsp-title {
    display: block;
    width: 100%;
    font-size: 10px;
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.rlsp-title .rlsp-st {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: #9dbbe4;
}
.rlsp-title .rlsp-st.rlsp-fixed {
    color: #e08f52;
}
.rlsp-title .rlsp-st.rlsp-editing {
    color: #86c7a4;
}
.rlsp-title .rlsp-v {
    color: #d9b26a;
}
.rlsp-title .rlsp-sep {
    color: rgba(255, 255, 255, 0.3);
}
.rlsp-title .rlsp-un {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: #d98b8b;
}
.rlsp-edit {
    position: absolute;
    right: 7px;
    top: 50%;
    transform: translateY(-50%);
    appearance: none;
    cursor: pointer;
    padding: 2px 10px;
    border-radius: 999px;
    color: #d9b26a;
    background: transparent;
    border: 1px solid rgba(217, 178, 106, 0.35);
    white-space: nowrap;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.rlsp-edit:hover {
    background: rgba(217, 178, 106, 0.14);
}
.rlsp-edit.rlsp-active {
    color: #86c7a4;
    border-color: rgba(127, 201, 160, 0.45);
    background: rgba(127, 201, 160, 0.14);
}

.rlsp-note {
    flex: 0 0 auto;
    padding: 5px 8px;
    font-size: 10px;
    line-height: 14px;
    color: rgba(255, 255, 255, 0.34);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.rlsp-chips {
    flex: 1 1 auto;
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 4px;
    padding: 7px;
    overflow-y: auto;
    min-height: 0;
}
.rlsp-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    line-height: 16px;
    white-space: nowrap;
    border: 1px solid transparent;
    user-select: none;
}
.rlsp-chip .rlsp-d {
    font-variant-numeric: tabular-nums;
}
.rlsp-chip .rlsp-r {
    font-size: 9px;
    opacity: 0.55;
}
.rlsp-chip.rlsp-landscape {
    color: #94b3dd;
    border-color: rgba(127, 168, 232, 0.28);
    background: rgba(127, 168, 232, 0.09);
}
.rlsp-chip.rlsp-portrait {
    color: #b795cf;
    border-color: rgba(185, 143, 214, 0.28);
    background: rgba(185, 143, 214, 0.09);
}
.rlsp-chip.rlsp-square {
    color: #86c7a4;
    border-color: rgba(127, 201, 160, 0.28);
    background: rgba(127, 201, 160, 0.09);
}
.rlsp-chip.rlsp-pick {
    cursor: pointer;
}
.rlsp-chip.rlsp-pick:hover {
    border-color: rgba(255, 255, 255, 0.32);
}
.rlsp-chip.rlsp-active.rlsp-landscape {
    color: #cfe0f7;
    background: rgba(127, 168, 232, 0.3);
    border-color: rgba(127, 168, 232, 0.6);
}
.rlsp-chip.rlsp-active.rlsp-portrait {
    color: #e6d5f2;
    background: rgba(185, 143, 214, 0.3);
    border-color: rgba(185, 143, 214, 0.6);
}
.rlsp-chip.rlsp-active.rlsp-square {
    color: #d3ede0;
    background: rgba(127, 201, 160, 0.3);
    border-color: rgba(127, 201, 160, 0.6);
}
.rlsp-empty {
    padding: 8px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.24);
}

.rlsp-editor {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
}
.rlsp-ratios,
.rlsp-input {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    margin: 0;
    padding: 7px 8px;
    font-family: ui-monospace, Consolas, monospace;
    font-size: 11px;
    line-height: 16px;
    white-space: pre;
    overflow: auto;
    border: 0;
}
.rlsp-ratios {
    z-index: 0;
    pointer-events: none;
    color: rgba(255, 255, 255, 0.3);
}
.rlsp-ratios .rlsp-gh {
    color: transparent;
}
.rlsp-input {
    z-index: 1;
    resize: none;
    outline: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.82);
}
.rlsp-input::placeholder {
    color: rgba(255, 255, 255, 0.2);
}

.rlsp-help {
    position: absolute;
    inset: 0;
    z-index: 5;
    padding: 9px 11px;
    overflow-y: auto;
    background: #14161a;
    border-radius: 8px;
    white-space: pre-wrap;
    font-family: ui-monospace, Consolas, monospace;
    font-size: 10px;
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.62);
}
.rlsp-help h4 {
    margin: 0 0 6px;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #d9b26a;
}

.rlsp-grip {
    flex: 0 0 auto;
    height: 5px;
    margin: 3px 0 0;
    border-radius: 3px;
    background: #2a2a2a;
    cursor: row-resize;
}
.rlsp-grip:hover,
.rlsp-grip.rlsp-dragging {
    background: #4a688a;
}

.rlsp-btnrow {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
}
.rlsp-btnrow button {
    flex: 0 0 auto;
    appearance: none;
    cursor: pointer;
    padding: 3px 12px;
    border-radius: 999px;
    background: transparent;
    white-space: nowrap;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.rlsp-btnrow button.rlsp-save {
    color: #86c7a4;
    border: 1px solid rgba(127, 201, 160, 0.3);
}
.rlsp-btnrow button.rlsp-save:hover {
    background: rgba(127, 201, 160, 0.14);
}
.rlsp-btnrow button.rlsp-reset {
    color: #94b3dd;
    border: 1px solid rgba(127, 168, 232, 0.3);
}
.rlsp-btnrow button.rlsp-reset:hover {
    background: rgba(127, 168, 232, 0.14);
}
.rlsp-btnrow button.rlsp-helpbtn {
    margin-left: auto;
    width: 22px;
    padding: 3px 0;
    text-align: center;
    color: rgba(255, 255, 255, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.16);
}
.rlsp-btnrow button.rlsp-helpbtn:hover,
.rlsp-btnrow button.rlsp-helpbtn.rlsp-active {
    color: #d9b26a;
    border-color: rgba(217, 178, 106, 0.45);
    background: rgba(217, 178, 106, 0.12);
}
`;
    document.head.appendChild(style);
}

/* ------------------------------------------------------------------ *
 * element builders
 * ------------------------------------------------------------------ */

function buildToolbar() {
    const el = document.createElement("div");
    el.className = "rlsp-root rlsp-toolbar";
    el.innerHTML = `
<div class="rlsp-seg">
    <button type="button" data-mode="random">random</button>
    <button type="button" data-mode="sequential">sequence</button>
    <button type="button" data-mode="fixed">fixed</button>
</div>
<span class="rlsp-hint"></span>`;
    return { el, hint: el.querySelector(".rlsp-hint") };
}

function buildPanel() {
    const el = document.createElement("div");
    el.className = "rlsp-root rlsp-wrap";
    el.innerHTML = `
<div class="rlsp-panel">
    <div class="rlsp-head">
        <span class="rlsp-title"></span>
        <button type="button" class="rlsp-edit rlsp-cap">edit</button>
    </div>
    <div class="rlsp-note"></div>
    <div class="rlsp-chips"></div>
    <div class="rlsp-editor">
        <div class="rlsp-ratios"></div>
        <textarea class="rlsp-input" spellcheck="false"></textarea>
    </div>
    <div class="rlsp-help"></div>
</div>
<div class="rlsp-grip" title="drag to resize the display"></div>`;
    const help = el.querySelector(".rlsp-help");
    help.innerHTML = `<h4>Random Latent Size Picker</h4>${escapeHtml(HELP_TEXT)}`;
    help.style.display = "none";
    return {
        el,
        head: el.querySelector(".rlsp-head"),
        title: el.querySelector(".rlsp-title"),
        edit: el.querySelector(".rlsp-edit"),
        note: el.querySelector(".rlsp-note"),
        chips: el.querySelector(".rlsp-chips"),
        editor: el.querySelector(".rlsp-editor"),
        ratios: el.querySelector(".rlsp-ratios"),
        input: el.querySelector(".rlsp-input"),
        help,
        grip: el.querySelector(".rlsp-grip"),
    };
}

function buildButtonRow() {
    const el = document.createElement("div");
    el.className = "rlsp-root rlsp-btnrow";
    el.innerHTML = `
<button type="button" class="rlsp-save rlsp-cap" title="Write the editor contents to custom_sizes.json">save</button>
<button type="button" class="rlsp-reset rlsp-cap" title="Discard edits and reload the saved list">reset</button>
<button type="button" class="rlsp-helpbtn rlsp-cap" title="How this node works">?</button>`;
    return {
        el,
        save: el.querySelector(".rlsp-save"),
        reset: el.querySelector(".rlsp-reset"),
        help: el.querySelector(".rlsp-helpbtn"),
    };
}

/* ------------------------------------------------------------------ *
 * node setup
 * ------------------------------------------------------------------ */

function setupNode(node) {
    if (node.__rlspSetup) {
        return;
    }
    node.__rlspSetup = true;

    const modeWidget = widgetByName(node, "mode");
    const familyWidget = widgetByName(node, "model_family");
    const seedWidget = widgetByName(node, "seed");
    const presetWidget = widgetByName(node, "resolution_preset");
    const listWidget = widgetByName(node, "resolution_list");
    const textWidget = widgetByName(node, "resolution_text");
    const seqWidget = widgetByName(node, "sequence");

    if (!modeWidget || !familyWidget || !presetWidget || !listWidget || !textWidget) {
        return;
    }

    const hasDom = typeof node.addDOMWidget === "function";
    let refreshing = false;
    let editOpen = false;
    let helpOpen = false;
    let toolbar = null;
    let panel = null;
    let buttons = null;

    node.__rlspLastFamily = familyWidget.value;
    node.__rlspLastPreset = presetWidget.value;

    function addDom(name, element, height) {
        const widget = node.addDOMWidget(name, "rlsp", element, {
            serialize: false,
            hideOnZoom: false,
            getValue: () => "",
            setValue: () => {},
        });
        setDomWidgetHeight(widget, height);
        return widget;
    }

    function storedPanelHeight() {
        node.properties = node.properties || {};
        const stored = parseInt(node.properties[PANEL_HEIGHT_PROPERTY], 10);
        if (!stored || Number.isNaN(stored)) {
            return PANEL_HEIGHT_DEFAULT;
        }
        return clamp(stored, PANEL_HEIGHT_MIN, PANEL_HEIGHT_MAX);
    }

    function applyPanelHeight(height) {
        const clamped = clamp(Math.round(height), PANEL_HEIGHT_MIN, PANEL_HEIGHT_MAX);
        setDomWidgetHeight(panel.widget, clamped + GRIP_HEIGHT);
        node.properties = node.properties || {};
        node.properties[PANEL_HEIGHT_PROPERTY] = clamped;
        return clamped;
    }

    function currentPanelHeight() {
        return (panel.widget.__rlspHeight || PANEL_HEIGHT_DEFAULT) - GRIP_HEIGHT;
    }

    function storedSizes(family) {
        const families = (sizeCache && sizeCache.families) || {};
        return (families[family] || []).map((s) => [s[0], s[1]]);
    }

    function sourceText() {
        return panel ? panel.input.value : String(textWidget.value || "");
    }

    function isSequential() {
        return modeWidget.value === "sequential";
    }

    // The saved order, kept to the sizes that are actually on offer. Anything
    // new is appended, so changing preset does not throw the order away.
    function sequenceOf(candidates) {
        const saved = seqWidget ? parseSizeList(seqWidget.value) : [];
        const inList = (list, size) =>
            list.some((s) => s[0] === size[0] && s[1] === size[1]);
        const ordered = saved.filter((s) => inList(candidates, s));
        for (const size of candidates) {
            if (!inList(ordered, size)) {
                ordered.push(size);
            }
        }
        return ordered;
    }

    // Which entry the next run will land on.
    function stepIndex(length) {
        if (!length) {
            return 0;
        }
        const seed = Number(seedWidget && seedWidget.value) || 0;
        return ((seed % length) + length) % length;
    }

    // Reordering moves chips, not the turn. Whatever was up next stays up
    // next, so the seed is nudged to follow it to its new place.
    function keepStepOnSize(oldOrder, newOrder) {
        if (!seedWidget || !oldOrder.length) {
            return;
        }
        const was = oldOrder[stepIndex(oldOrder.length)];
        const now = newOrder.findIndex(
            (size) => size[0] === was[0] && size[1] === was[1]
        );
        if (now === -1) {
            return;
        }
        const shift = now - stepIndex(oldOrder.length);
        let seed = (Number(seedWidget.value) || 0) + shift;
        while (seed < 0) {
            seed += newOrder.length;
        }
        seedWidget.value = seed;
    }

    // Move the turn to a chosen entry without disturbing the order.
    function setStep(index, length) {
        if (!seedWidget || !length) {
            return;
        }
        let seed = (Number(seedWidget.value) || 0) + (index - stepIndex(length));
        while (seed < 0) {
            seed += length;
        }
        seedWidget.value = seed;
    }

    function writeSequence(sizes) {
        if (!seqWidget) {
            return;
        }
        const text = sizes.map((s) => plainSize(s[0], s[1])).join("|");
        if (seqWidget.value !== text) {
            seqWidget.value = text;
        }
    }

    function isTextEditable() {
        return presetWidget.value === "custom" || familyWidget.value === CUSTOM_FAMILY;
    }

    function isEditorOpen() {
        // The editor replaces the chip strip: only one of the two is ever on
        // screen, so the panel never reads as two stacked boxes.
        return presetWidget.value === "custom" || (isTextEditable() && editOpen);
    }

    function candidateSizes() {
        const preset = presetWidget.value;
        const family = familyWidget.value;

        // A custom preset drops the built-in table entirely, for every family.
        if (preset === "custom") {
            return sortByRatio(parseSizeList(sourceText()));
        }

        let sizes;
        if (family === CUSTOM_FAMILY) {
            sizes = parseSizeList(sourceText());
            if (sizes.length === 0) {
                sizes = storedSizes(CUSTOM_FAMILY);
            }
        } else {
            sizes = storedSizes(family);
        }
        return sortByRatio(filterByPreset(sizes, preset));
    }

    /* -------------------------------------------------------------- */

    function refresh() {
        if (refreshing) {
            return;
        }
        refreshing = true;
        try {
            refreshBody();
        } finally {
            refreshing = false;
        }
    }

    function refreshBody() {
        const preset = presetWidget.value;
        const family = familyWidget.value;
        const isFixed = modeWidget.value === "fixed";
        const isSeq = isSequential();
        const isCustomFamily = family === CUSTOM_FAMILY;

        const enteredCustomPreset =
            preset === "custom" && node.__rlspLastPreset !== "custom";
        const enteredCustomFamily =
            isCustomFamily && node.__rlspLastFamily !== CUSTOM_FAMILY;

        if (!isCustomFamily) {
            editOpen = false;
        }

        if (panel) {
            if (enteredCustomPreset) {
                // Switching to the custom preset starts from an empty list:
                // nothing stored in the node is used any more.
                panel.input.value = "";
                textWidget.value = "";
            } else if (preset !== "custom" && isCustomFamily) {
                if (enteredCustomFamily || parseSizeList(panel.input.value).length === 0) {
                    const stored = sortByRatio(storedSizes(CUSTOM_FAMILY))
                        .map((s) => plainSize(s[0], s[1]))
                        .join("\n");
                    if (stored && panel.input.value !== stored) {
                        panel.input.value = stored;
                        textWidget.value = stored;
                    }
                }
            }
        }
        node.__rlspLastFamily = family;
        node.__rlspLastPreset = preset;

        let candidates = candidateSizes();
        if (isSeq) {
            // Sequence mode is about order, so the list keeps the one it was
            // given rather than being sorted by ratio.
            candidates = sequenceOf(candidates);
            writeSequence(candidates);
        }
        const labels = candidates.map((s) => formatSize(s[0], s[1]));

        listWidget.options = listWidget.options || {};
        listWidget.options.values = labels;
        if (labels.length > 0 && !labels.includes(listWidget.value)) {
            listWidget.value = labels[0];
        }

        setWidgetVisible(seedWidget, !isFixed);
        for (const widget of seedControlWidgets(node, seedWidget)) {
            setWidgetVisible(widget, !isFixed);
        }
        setWidgetVisible(listWidget, isFixed);
        if (seqWidget) {
            hideWidget(seqWidget);
        }

        if (!panel) {
            setWidgetVisible(textWidget, true);
            const joined = labels.join("\n");
            if (!isTextEditable() && textWidget.value !== joined) {
                textWidget.value = joined;
            }
            fitNode(node);
            return;
        }

        if (!isTextEditable()) {
            const joined = labels.join("\n");
            if (panel.input.value !== joined) {
                panel.input.value = joined;
            }
            if (textWidget.value !== joined) {
                textWidget.value = joined;
            }
        } else if (textWidget.value !== panel.input.value) {
            textWidget.value = panel.input.value;
        }

        renderToolbar(isFixed, isSeq);
        renderPanel({ preset, family, isFixed, isSeq, isCustomFamily, candidates });

        orderWidgets(node);
        fitNode(node);
    }

    function renderToolbar(isFixed, isSeq) {
        const active = isFixed ? "fixed" : isSeq ? "sequential" : "random";
        for (const button of toolbar.el.querySelectorAll("button[data-mode]")) {
            button.classList.toggle("rlsp-active", button.dataset.mode === active);
        }
        toolbar.hint.textContent = isFixed
            ? "one size, chosen below"
            : isSeq
            ? "one step along the list per run"
            : "seeded pick from the list";
    }

    function renderRatios() {
        const lines = panel.input.value.split("\n");
        panel.ratios.innerHTML = lines
            .map((line) => {
                const size = parseSize(line);
                const tail = size ? `  (${ratioLabel(size[0], size[1])})` : "";
                return `<span class="rlsp-gh">${escapeHtml(line)}</span>${escapeHtml(tail)}`;
            })
            .join("\n");
        panel.ratios.scrollTop = panel.input.scrollTop;
        panel.ratios.scrollLeft = panel.input.scrollLeft;
    }

    function renderPanel(state) {
        const { preset, family, isFixed, isSeq, isCustomFamily, candidates } = state;
        const step = stepIndex(candidates.length);
        const editing = isEditorOpen();

        const typed = parseSizeList(panel.input.value);
        const stored = storedSizes(CUSTOM_FAMILY);

        const stateClass = editing
            ? "rlsp-editing"
            : isFixed
            ? "rlsp-fixed"
            : isSeq
            ? "rlsp-seq"
            : "";
        const stateLabel = editing
            ? preset === "custom"
                ? "custom mode"
                : "edit list"
            : isFixed
            ? "fixed size"
            : isSeq
            ? "sequence"
            : "random range";

        let count = editing
            ? `${typed.length} size${typed.length === 1 ? "" : "s"}`
            : isSeq && candidates.length
            ? `step ${step + 1} of ${candidates.length}`
            : `${candidates.length} size${candidates.length === 1 ? "" : "s"}`;
        if (!editing && isCustomFamily && preset !== "custom" && preset !== "all") {
            count += ` of ${typed.length || stored.length}`;
        }

        const unsaved =
            isCustomFamily &&
            preset !== "custom" &&
            !sameSizes(sortByRatio(typed), sortByRatio(stored));

        const dot = `<span class="rlsp-sep"> \u00b7 </span>`;
        panel.title.innerHTML =
            `<span class="rlsp-st ${stateClass}">${escapeHtml(stateLabel)}</span>` +
            dot +
            `<span class="rlsp-v">${escapeHtml(family)}</span>` +
            dot +
            `<span class="rlsp-v">${escapeHtml(preset)}</span>` +
            dot +
            `<span class="rlsp-v">${escapeHtml(count)}</span>` +
            (unsaved ? `${dot}<span class="rlsp-un">unsaved</span>` : "");

        const showEditToggle = isCustomFamily && preset !== "custom";
        panel.edit.style.display = showEditToggle ? "" : "none";
        panel.edit.classList.toggle("rlsp-active", editOpen);
        panel.edit.textContent = editOpen ? "finish edit" : "edit";
        // The button is taken out of flow, so the title reserves its width.
        panel.title.style.paddingRight = showEditToggle
            ? editOpen
                ? "78px"
                : "44px"
            : "0";

        const note = editing
            ? preset === "custom"
                ? NOTE_CUSTOM_PRESET
                : NOTE_CUSTOM_FAMILY
            : "";
        panel.note.textContent = note;
        panel.note.style.display = note ? "" : "none";

        panel.chips.style.display = editing ? "none" : "";
        panel.editor.style.display = editing ? "" : "none";
        panel.input.readOnly = !isTextEditable();

        panel.chips.classList.toggle("rlsp-sorting", isSeq);
        panel.chips.innerHTML = "";
        if (!editing) {
            if (candidates.length === 0) {
                const empty = document.createElement("div");
                empty.className = "rlsp-empty";
                empty.textContent = isCustomFamily
                    ? "Nothing stored yet. Press EDIT to add sizes."
                    : "No resolutions for this preset.";
                panel.chips.appendChild(empty);
            } else {
                const selected = listWidget.value;
                candidates.forEach(([width, height], index) => {
                    const label = formatSize(width, height);
                    const chip = document.createElement("span");
                    chip.className = `rlsp-chip rlsp-${orientationOf(width, height)}`;
                    if (isFixed) {
                        chip.classList.add("rlsp-pick");
                        if (label === selected) {
                            chip.classList.add("rlsp-active");
                        }
                    }
                    if (isSeq) {
                        chip.dataset.index = String(index);
                        if (index === step) {
                            chip.classList.add("rlsp-now");
                        }
                    }
                    const marker =
                        isSeq && index === step
                            ? `<span class="rlsp-go">\u25b6</span>`
                            : "";
                    chip.dataset.label = label;
                    chip.title = isFixed
                        ? "Use this size"
                        : isSeq
                        ? "Click to start here, drag to reorder"
                        : label;
                    chip.innerHTML =
                        marker +
                        `<span class="rlsp-d">${width}\u00d7${height}</span>` +
                        `<span class="rlsp-r">${ratioLabel(width, height)}</span>`;
                    panel.chips.appendChild(chip);
                });
            }
        } else {
            renderRatios();
        }

        panel.input.placeholder =
            document.activeElement === panel.input ? "" : PLACEHOLDER;

        panel.help.style.display = helpOpen ? "" : "none";
        buttons.help.classList.toggle("rlsp-active", helpOpen);
        // A custom preset never touches the stored list, so saving and
        // resetting it would do nothing there.
        const showStoreButtons = isCustomFamily && preset !== "custom";
        buttons.save.style.display = showStoreButtons ? "" : "none";
        buttons.reset.style.display = showStoreButtons ? "" : "none";

        // The badge label changes width between states; reading a layout
        // property here forces the row to settle before the next paint.
        void panel.head.offsetHeight;
    }

    /* -------------------------------------------------------------- */

    function postCustomSizes(sizes) {
        return api
            .fetchApi("/studio_leiel/rlsp/custom", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sizes }),
            })
            .then((response) => response.json())
            .then(() => fetchSizes(true))
            .then(() => refresh());
    }

    function saveCustomSizes() {
        const sizes = parseSizeList(sourceText());
        if (sizes.length === 0) {
            alert("Nothing to save. Enter one resolution per line, e.g. 1536x1024.");
            return;
        }
        postCustomSizes(sizes).catch(() => {
            alert("Random Latent Size Picker: could not save custom sizes.");
        });
    }

    function resetCustomSizes() {
        fetchSizes(true)
            .then(() => {
                const stored = sortByRatio(storedSizes(CUSTOM_FAMILY))
                    .map((s) => plainSize(s[0], s[1]))
                    .join("\n");
                if (panel) {
                    panel.input.value = stored;
                }
                textWidget.value = stored;
                refresh();
            })
            .catch(() => {
                alert("Random Latent Size Picker: could not load custom sizes.");
            });
    }

    /* -------------------------------------------------------------- */

    function startGripDrag(event) {
        event.preventDefault();
        event.stopPropagation();

        const startY = event.clientY;
        const startHeight = currentPanelHeight();
        let active = true;
        panel.grip.classList.add("rlsp-dragging");

        const finish = () => {
            if (!active) {
                return;
            }
            active = false;
            panel.grip.classList.remove("rlsp-dragging");
            window.removeEventListener("pointermove", move, true);
            window.removeEventListener("pointerup", finish, true);
            window.removeEventListener("pointercancel", finish, true);
            window.removeEventListener("mouseup", finish, true);
            window.removeEventListener("blur", finish, true);
        };

        const move = (moveEvent) => {
            if (!active) {
                return;
            }
            // The canvas can swallow a pointerup; a move with no button held
            // means the drag is already over.
            if (moveEvent.buttons === 0) {
                finish();
                return;
            }
            applyPanelHeight(startHeight + (moveEvent.clientY - startY));
            fitNode(node);
        };

        // Capture phase: LiteGraph stops propagation on its own pointer
        // handlers, so a bubble-phase pointerup never arrives and the drag
        // would never end.
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", finish, true);
        window.addEventListener("pointercancel", finish, true);
        window.addEventListener("mouseup", finish, true);
        window.addEventListener("blur", finish, true);
    }

    function wireEvents() {
        panel.input.addEventListener("input", () => {
            textWidget.value = panel.input.value;
            renderRatios();
            refresh();
        });
        panel.input.addEventListener("scroll", () => {
            panel.ratios.scrollTop = panel.input.scrollTop;
            panel.ratios.scrollLeft = panel.input.scrollLeft;
        });
        panel.input.addEventListener("focus", () => {
            panel.input.placeholder = "";
        });
        panel.input.addEventListener("blur", () => {
            panel.input.placeholder = PLACEHOLDER;
        });
        panel.input.addEventListener("pointerdown", (event) => {
            event.stopPropagation();
        });

        // Reordering in sequence mode: the chip follows the pointer and the
        // list is rewritten where it is let go.
        panel.chips.addEventListener("pointerdown", (event) => {
            if (!isSequential()) {
                return;
            }
            const chip = event.target.closest(".rlsp-chip");
            if (!chip || chip.dataset.index === undefined) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();

            const from = Number(chip.dataset.index);
            let to = from;
            let dragging = false;
            const startX = event.clientX;
            const startY = event.clientY;

            // A bar standing in the flow: the chips move aside around it, so
            // the landing place is visible before the button is released.
            const bar = document.createElement("span");
            bar.className = "rlsp-drop";

            // Reading order: rows first, then across.
            const slotAt = (x, y) => {
                const others = [...panel.chips.querySelectorAll(".rlsp-chip")].filter(
                    (other) => other !== chip
                );
                for (let i = 0; i < others.length; i += 1) {
                    const box = others[i].getBoundingClientRect();
                    const below = y < box.bottom;
                    const before = x < box.left + box.width / 2;
                    if (below && (before || y < box.top)) {
                        return { index: i, before: others[i] };
                    }
                }
                return { index: others.length, before: null };
            };

            const move = (moveEvent) => {
                if (!dragging) {
                    // A press that never travels is a click, and a click picks
                    // where the sequence starts. The bar stays away until the
                    // pointer has actually gone somewhere.
                    const dx = moveEvent.clientX - startX;
                    const dy = moveEvent.clientY - startY;
                    if (dx * dx + dy * dy < 25) {
                        return;
                    }
                    dragging = true;
                    chip.classList.add("rlsp-drag");
                }
                const slot = slotAt(moveEvent.clientX, moveEvent.clientY);
                to = slot.index;
                if (slot.before) {
                    panel.chips.insertBefore(bar, slot.before);
                } else {
                    panel.chips.appendChild(bar);
                }
            };

            const finish = () => {
                window.removeEventListener("pointermove", move, true);
                window.removeEventListener("pointerup", finish, true);
                window.removeEventListener("pointercancel", finish, true);
                chip.classList.remove("rlsp-drag");
                bar.remove();
                const order = parseSizeList(seqWidget ? seqWidget.value : "");
                if (!dragging) {
                    setStep(from, order.length);
                } else if (order.length && to !== from) {
                    const before = order.slice();
                    const [moved] = order.splice(from, 1);
                    order.splice(Math.min(to, order.length), 0, moved);
                    keepStepOnSize(before, order);
                    writeSequence(order);
                }
                refresh();
            };

            move(event);
            window.addEventListener("pointermove", move, true);
            window.addEventListener("pointerup", finish, true);
            window.addEventListener("pointercancel", finish, true);
        });

        panel.chips.addEventListener("click", (event) => {
            const chip = event.target.closest(".rlsp-chip");
            if (!chip || modeWidget.value !== "fixed") {
                return;
            }
            listWidget.value = chip.dataset.label;
            if (listWidget.callback) {
                listWidget.callback(listWidget.value);
            } else {
                refresh();
            }
        });

        panel.edit.addEventListener("click", () => {
            editOpen = !editOpen;
            refresh();
        });

        toolbar.el.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-mode]");
            if (!button) {
                return;
            }
            const was = modeWidget.value;
            modeWidget.value = button.dataset.mode;
            if (was !== "sequential" && modeWidget.value === "sequential") {
                // Without this the step never advances and it looks broken.
                for (const widget of seedControlWidgets(node, seedWidget)) {
                    if (widget.name === "control_after_generate") {
                        widget.value = "increment";
                    }
                }
            }
            refresh();
        });

        buttons.save.addEventListener("click", saveCustomSizes);
        buttons.reset.addEventListener("click", resetCustomSizes);
        buttons.help.addEventListener("click", () => {
            helpOpen = !helpOpen;
            refresh();
        });

        panel.grip.addEventListener("pointerdown", startGripDrag);
    }

    /* -------------------------------------------------------------- */

    if (hasDom) {
        injectStyles();
        toolbar = buildToolbar();
        panel = buildPanel();
        buttons = buildButtonRow();

        toolbar.widget = addDom("rlsp_mode", toolbar.el, 26);
        panel.widget = addDom("rlsp_panel", panel.el, PANEL_HEIGHT_DEFAULT + GRIP_HEIGHT);
        buttons.widget = addDom("rlsp_actions", buttons.el, 26);
        applyPanelHeight(storedPanelHeight());

        hideWidget(modeWidget);
        hideWidget(textWidget);
        orderWidgets(node);
        wireEvents();

        // LiteGraph clamps a node against computeSize() before it calls
        // onResize, so reporting the panel at its minimum here is what lets
        // the node be dragged smaller at all.
        node.__rlspBaseComputeSize = node.computeSize;
        node.computeSize = function (out) {
            const size = node.__rlspBaseComputeSize.call(this, out);
            if (panel && panel.widget) {
                size[1] -=
                    panel.widget.__rlspHeight - (PANEL_HEIGHT_MIN + GRIP_HEIGHT);
            }
            return size;
        };

        const previousOnResize = node.onResize;
        node.onResize = function (size) {
            if (previousOnResize) {
                previousOnResize.apply(this, arguments);
            }
            if (!panel || node.__rlspAdjusting || !size) {
                return;
            }
            node.__rlspAdjusting = true;
            try {
                const overhead = baseComputeSize(node)[1] - panel.widget.__rlspHeight;
                const applied = applyPanelHeight(size[1] - overhead - GRIP_HEIGHT);
                size[1] = overhead + applied + GRIP_HEIGHT;
            } finally {
                node.__rlspAdjusting = false;
            }
        };
    }

    function chain(widget) {
        if (!widget) {
            return;
        }
        const original = widget.callback;
        widget.callback = function (...args) {
            const result = original ? original.apply(this, args) : undefined;
            refresh();
            return result;
        };
    }

    chain(modeWidget);
    chain(familyWidget);
    chain(presetWidget);
    chain(listWidget);
    if (!panel) {
        chain(textWidget);
    }

    node.__rlspRefresh = refresh;
    node.__rlspSyncText = () => {
        if (panel) {
            const value = String(textWidget.value || "");
            if (panel.input.value !== value) {
                panel.input.value = value;
            }
            applyPanelHeight(storedPanelHeight());
        }
    };

    fetchSizes(false).then(() => {
        node.__rlspSyncText();
        refresh();
    });
}

/* ------------------------------------------------------------------ */

app.registerExtension({
    name: "StudioLeiel.RandomLatentSizePicker.DynamicWidgets",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) {
            return;
        }

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            setupNode(this);
            return result;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = onConfigure ? onConfigure.apply(this, arguments) : undefined;
            const node = this;
            fetchSizes(false).then(() => {
                if (node.__rlspSyncText) {
                    node.__rlspSyncText();
                }
                if (node.__rlspRefresh) {
                    node.__rlspRefresh();
                }
            });
            return result;
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            const result = onExecuted ? onExecuted.apply(this, arguments) : undefined;
            // The Selected Size widget is appended by the other extension once
            // a run finishes; deferring puts it back in place whichever order
            // the two handlers run in.
            const node = this;
            setTimeout(() => {
                orderWidgets(node);
                fitNode(node);
            }, 0);
            return result;
        };
    },
});
