import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

/* Active LoRA list pushed back from the backend after each run.
   LoraManager registers many LoRAs but only a few are enabled; the
   lora_text input is the only place that truth exists.            */
const LORA_CACHE = {};        // nodeId -> [[name, strength], ...]
const TEXT_CACHE = {};        // nodeId -> { "1": "1472 x 1088", ... }

/* ---------- layout snapshot store ----------
   Survives undo, copy/paste, workflow switching and browser reloads.
   Shared across workflows, so a layout built once can be reused.     */
const LS_KEY = "leiel.vfm.snapshots";
const LS_MAX = 40;

function snapRead() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
  catch (e) { return []; }
}
function snapWrite(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, LS_MAX))); }
  catch (e) { /* quota or private mode - ignore */ }
}
function snapPush(layout, label) {
  const body = JSON.stringify(layout);
  if (!layout || (!layout.folder?.length && !layout.file?.length)) return;
  const list = snapRead();
  if (list.length && JSON.stringify(list[0].layout) === body && list[0].label === label) return;
  list.unshift({ t: Date.now(), label: label || "auto", layout: JSON.parse(body) });
  /* keep every named snapshot, trim only the automatic ones */
  const named = list.filter(x => x.label !== "auto");
  const auto = list.filter(x => x.label === "auto").slice(0, 25);
  snapWrite(named.concat(auto).sort((a, b) => b.t - a.t));
}
function snapLabel(e) {
  const d = new Date(e.t), p = x => String(x).padStart(2, "0");
  const when = `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const n = (e.layout.folder?.length || 0) + (e.layout.file?.length || 0);
  return `${when}  ${n} chips${e.label === "auto" ? "" : "  " + e.label}`;
}
const STUDIO_NODES = new Map();  // nodeId -> refresh fn

try {
  api.addEventListener("leiel.loras", (e) => {
    const d = e?.detail || {};
    if (!d.node) return;
    LORA_CACHE[String(d.node)] = d.loras || [];
    if (d.texts) TEXT_CACHE[String(d.node)] = d.texts;
    const fn = STUDIO_NODES.get(String(d.node));
    if (fn) fn();
  });
} catch (err) { /* ignore */ }

/* ==================================================================
   Studio Leiel - Filename Studio
   Palette (top) -> drag chips into Folder / File boxes (bottom).
   Graph data is read directly from app.graph._nodes, no server call.
   ================================================================== */

const PRIORITY = [
  "ckpt_name", "unet_name", "model_name", "clip_name", "clip_name1",
  "clip_name2", "vae_name", "lora_name", "sampler_name", "scheduler",
  "steps", "cfg", "shift", "denoise", "seed", "noise_seed",
  "width", "height", "string", "text", "value",
];

const SKIP_WIDGET_TYPES = ["button", "converted-widget", "hidden", "leiel-hidden"];

/* ---------- chip categories ----------
   Colour is assigned by kind, so related values read as a group at a glance. */
const CAT_MODEL   = new Set(["ckpt_name", "unet_name", "model_name", "clip_name",
                             "clip_name1", "clip_name2", "vae_name", "weight_dtype",
                             "type", "device"]);
const CAT_SAMPLER = new Set(["sampler_name", "scheduler", "steps", "cfg", "shift",
                             "denoise", "seed", "noise_seed", "control_after_generate",
                             "start_at_step", "end_at_step", "add_noise"]);
const CAT_SIZE    = new Set(["width", "height", "batch_size", "length",
                             "upscale_method", "crop", "megapixels"]);
const CAT_TEXT    = new Set(["text", "string", "value", "prompt", "title"]);

/* Which node a chip came from decides its colour. Chips that belong to no
   node - a date, a piece of free text, the LoRA list - keep the category
   colour they always had, because there is no node to name. */
const NODE_CLS = ["c-n0", "c-n1", "c-n2", "c-n3", "c-n4",
                  "c-n5", "c-n6", "c-n7", "c-n8", "c-n9"];

function nodeColourClass(title) {
  const t = String(title || "");
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return NODE_CLS[h % NODE_CLS.length];
}

const NODELESS_KINDS = new Set(["lora", "loras", "date", "time", "elapsed",
                                "text"]);

function chipColourClass(chip) {
  if (chip && !NODELESS_KINDS.has(chip.kind) && chip.group) {
    return nodeColourClass(chip.group);
  }
  return "c-" + chipCategory(chip);
}

function chipCategory(chip) {
  switch (chip.kind) {
    case "lora": case "loras":   return "lora";
    case "date": case "time":    return "time";
    case "elapsed":              return "time";
    case "text":                 return "free";
  }
  const w = (chip.widget || "").toLowerCase();
  if (CAT_MODEL.has(w)) return "model";
  if (CAT_SAMPLER.has(w)) return "sampler";
  if (CAT_SIZE.has(w)) return "size";
  if (CAT_TEXT.has(w)) return "text";
  if (/strength|scale|weight|power|ratio|amount/.test(w)) return "strength";
  return "other";
}

/* ---------- helpers ---------- */
function stemFull(v) {
  if (v === undefined || v === null) return "";
  let s = String(v);
  if (/\.(safetensors|ckpt|pt|sft|pth|bin|gguf)$/i.test(s) ||
      s.includes("/") || s.includes("\\")) {
    s = s.replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "");
  }
  return s;
}
function stem(v) {
  const s = stemFull(v);
  return s.length > 22 ? s.slice(0, 22) + "…" : s;
}
function num(v) {
  const f = parseFloat(v);
  if (isNaN(f)) return String(v);
  return String(Math.abs(f - Math.round(f)) < 1e-9 ? Math.round(f) : +f.toFixed(4));
}
function today() {
  const d = new Date(), p = x => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ---------- LoRA extraction ----------
   Handles: "<lora:name:1.0> <lora:other:0.95>" strings,
            arrays of {name/lora, strength, active},
            JSON encoded versions of either.                        */
const LORA_TAG = /<\s*lora\s*:\s*([^:>]+?)\s*:\s*([0-9.eE+-]+)(?:\s*:\s*[0-9.eE+-]+)?\s*>/gi;

function parseLoraBlob(v, depth = 0) {
  const out = [];
  if (v === null || v === undefined || depth > 3) return out;

  if (typeof v === "string") {
    LORA_TAG.lastIndex = 0;
    let m;
    while ((m = LORA_TAG.exec(v)) !== null) out.push([stemFull(m[1]), m[2].trim()]);
    if (out.length) return out;
    const t = v.trim();
    if (t.startsWith("[") || t.startsWith("{")) {
      try { return parseLoraBlob(JSON.parse(t), depth + 1); } catch (e) { return out; }
    }
    return out;
  }

  if (Array.isArray(v)) {
    for (const it of v) out.push(...parseLoraBlob(it, depth + 1));
    return out;
  }

  if (typeof v === "object") {
    for (const k of ["loras", "lora_list", "items", "value", "loraList"]) {
      if (v[k] !== undefined) {
        const r = parseLoraBlob(v[k], depth + 1);
        if (r.length) return r;
      }
    }
    if (v.active === false || v.on === false || v.enabled === false) return out;
    const nm = v.name ?? v.lora ?? v.lora_name ?? v.file ?? v.path;
    if (nm && typeof nm === "string") {
      const st = v.strength ?? v.strength_model ?? v.modelStrength ?? v.weight ?? 1;
      out.push([stemFull(nm), num(st)]);
    }
  }
  return out;
}

/* Read the enabled LoRAs straight out of the upstream loader node.
   LoraManager keeps its on/off state in the node's own data, so this works
   without running the graph. Only trusted when explicit on/off flags are
   present - a flat "<lora:...>" string lists everything registered.      */
function upstreamNodeFor(node, inputName) {
  try {
    const inp = (node.inputs || []).find(i => i.name === inputName);
    if (!inp || inp.link === null || inp.link === undefined) return null;
    const link = app.graph.links[inp.link];
    if (!link) return null;
    return app.graph.getNodeById(link.origin_id) || null;
  } catch (e) { return null; }
}

function scanActiveLoras(n) {
  /* One LoRA may show up several times while walking the node (widgets,
     widgets_values, properties can each hold a copy). Key by name and keep
     the copy that carries an explicit on/off flag. */
  const byName = new Map();
  let sawFlags = false;
  const seen = new WeakSet();

  const visit = (v, d) => {
    if (!v || d > 6 || typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) visit(x, d + 1); return; }

    const nm = v.name ?? v.lora ?? v.lora_name ?? v.file ?? v.path ?? v.modelName;
    if (typeof nm === "string" && nm.trim()) {
      const flagged = ("active" in v) || ("on" in v) || ("enabled" in v);
      if (flagged) sawFlags = true;
      const st = v.strength ?? v.strength_model ?? v.modelStrength ??
                 v.strengthModel ?? v.weight ?? 1;
      const entry = {
        name: stemFull(nm),
        st: num(st),
        on: !!(v.active ?? v.on ?? v.enabled ?? true),
        flagged,
      };
      const prev = byName.get(entry.name);
      if (!prev || (entry.flagged && !prev.flagged)) byName.set(entry.name, entry);
    }
    for (const k in v) {
      if (k === "graph" || k === "_graph" || k === "node") continue;
      visit(v[k], d + 1);
    }
  };

  for (const w of (n.widgets || [])) visit(w.value, 0);
  visit(n.properties, 0);
  visit(n.widgets_values, 0);
  return { found: Array.from(byName.values()), sawFlags };
}

function loraTextLinked(node) {
  return (node?.inputs || []).some(
    i => i.name === "lora_text" && i.link !== null && i.link !== undefined);
}

/* The Series Lab applies its LoRAs inside itself rather than through a loader
   on the canvas, so there is nothing in the graph to read: a scan finds no
   LoRA at all, or worse, finds a leftover loader that is not what is running.
   It does write down what it is doing, though, and that can be read straight
   off the node.

   current_json holds the row on its way out and is emptied when the queue
   ends; queue_json holds the plan. So: whatever is rendering, and when
   nothing is, the row that will go first. That is the same row the file name
   will be built from, which is the point. */
const SERIES_LAB_CLASS = "VisualSeriesLabSetup";

function loraStrengthText(v) {
  const f = Number(v);
  if (!Number.isFinite(f)) return String(v ?? "1");
  return Number.isInteger(f) ? f.toFixed(1) : String(f);
}

function seriesLabLoras(n) {
  if (!n) return null;
  const cls = n.comfyClass || n.type || "";
  if (cls !== SERIES_LAB_CLASS) return null;

  const widgetValue = (name) => {
    const w = (n.widgets || []).find((x) => x && x.name === name);
    return w ? w.value : null;
  };
  const parse = (t) => {
    try { return JSON.parse(t || ""); } catch (e) { return null; }
  };
  const asPairs = (loras) => (loras || [])
    .filter((l) => l && l.name)
    .map((l) => [stemFull(l.name), loraStrengthText(l.strength)]);

  const current = parse(widgetValue("current_json"));
  if (current && Array.isArray(current.loras) && current.loras.length) {
    return asPairs(current.loras);
  }

  /* Written twice by that node - the widget and its properties - because an
     encrypting pass can drop one of them. An emptied widget parses to a
     perfectly valid empty list, so "parsed something" is not enough to stop
     looking: only rows count. */
  const rows = (text) => {
    const v = parse(text);
    if (Array.isArray(v)) return v.length ? v : null;          // older shape
    if (v && Array.isArray(v.queue)) return v.queue.length ? v.queue : null;
    return null;
  };
  const queue = rows(widgetValue("queue_json")) ||
                rows(n.properties && n.properties.vsl_store) || [];
  const first = queue.find((r) => r && Array.isArray(r.loras) && r.loras.length);
  return first ? asPairs(first.loras) : [];
}

function collectLoras(node) {
  /* lora_text wired up -> use only what the backend reported as active */
  if (node && loraTextLinked(node)) {
    /* live read first, so toggling a LoRA updates without a render */
    const up = upstreamNodeFor(node, "lora_text");
    const lab = seriesLabLoras(up);
    if (lab) return lab;
    if (up) {
      const { found, sawFlags } = scanActiveLoras(up);
      if (sawFlags) {
        const on = found.filter(x => x.on);
        if (on.length) return on.map(x => [x.name, x.st]);
      }
    }
    const c = LORA_CACHE[String(node.id)];
    return c ? c.slice() : [];
  }
  const out = [];
  const seen = new Set();
  const push = (n, s) => {
    const k = n + "|" + s;
    if (!seen.has(k)) { seen.add(k); out.push([n, s]); }
  };

  const nodes = (app.graph?._nodes || []).slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const n of nodes) {
    if (n.mode === 2 || n.mode === 4) continue;
    const cls = n.comfyClass || n.type || "";
    const title = n.title || "";
    const looksLora = /lora/i.test(cls) || /lora/i.test(title);

    /* standard LoraLoader */
    const nameW = (n.widgets || []).find(w => w.name === "lora_name");
    if (nameW && typeof nameW.value === "string") {
      const stW = (n.widgets || []).find(w => w.name === "strength_model")
               || (n.widgets || []).find(w => w.name === "strength");
      push(stemFull(nameW.value), stW ? num(stW.value) : "1");
      continue;
    }

    /* LoraManager style: value may be a string of <lora:..> or an object list */
    if (!looksLora) continue;
    for (const w of (n.widgets || [])) {
      if (!w) continue;
      for (const [nm, st] of parseLoraBlob(w.value)) push(nm, st);
    }
    for (const key of ["loras", "lorasValue", "properties"]) {
      if (n[key] !== undefined) for (const [nm, st] of parseLoraBlob(n[key])) push(nm, st);
    }
  }
  return out;
}

/* Reachable from tests: these are pure readers over the graph, and the
   behaviour worth pinning down - which row's LoRAs the palette shows - lives
   in them rather than in the drawing. */
if (typeof globalThis !== "undefined") {
  globalThis.__leielFilenameInternals = { collectLoras, seriesLabLoras };
}

/* ---------- graph scan ---------- */
function scanGraph(selfNode) {
  const chips = [];
  const nodes = (app.graph?._nodes || []).slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const n of nodes) {
    if (n === selfNode) continue;
    const cls = n.comfyClass || n.type || "?";
    if (String(cls).startsWith("Leiel")) continue;
    const title = n.title || cls;
    const muted = n.mode === 2 || n.mode === 4;

    for (const w of (n.widgets || [])) {
      if (!w || !w.name) continue;
      if (SKIP_WIDGET_TYPES.includes(w.type)) continue;
      const v = w.value;
      if (v === null || v === undefined || typeof v === "object") continue;
      const sv = String(v);
      if (sv.length > 120 || sv.trim() === "") continue;

      const pi = PRIORITY.indexOf(w.name);
      const isNum = (typeof v === "number") ||
                    (sv.trim() !== "" && !isNaN(Number(sv)));
      chips.push({
        kind: "widget",
        id: String(n.id), cls, title, widget: w.name,
        label: w.name, hint: stem(sv), muted, num: isNum,
        group: title, score: pi < 0 ? 100 : 20 + pi,
      });
    }
  }

  /* LoRA chips */
  const loras = collectLoras(selfNode);

  const loraChips = [];
  loras.forEach(([nm, st], i) => {
    loraChips.push({
      kind: "lora", n: i + 1, label: `lora${i + 1}`,
      hint: `${stem(nm)}(${st})`, group: "LoRA", score: 10 + i * 0.1,
    });
  });
  /* No placeholder chips. The loader is read live, so an empty list means
     every LoRA really is switched off - offering lora1..lora4 then produced
     chips that could never resolve and a file name with holes in it. */
  if (loras.length) {
    loraChips.unshift({
      kind: "loras", label: "LoRA all", group: "LoRA", score: 9,
      hint: `${loras.length} active`,
    });
    loraChips.unshift({
      kind: "loras", fmt: "name", label: "LoRA all (names)", group: "LoRA", score: 9.1,
      hint: `${loras.length} active`,
    });
  }

  /* One chip per connected text input. The value is read on the server at run
     time, so it is right even when it did not exist when the queue was sent -
     a randomly picked size, for instance. */
  const wired = [];
  for (let i = 1; i <= 4; i++) {
    const inp = (selfNode?.inputs || []).find(x => x.name === `text_${i}`);
    if (!inp || inp.link === null || inp.link === undefined) continue;
    const cached = (TEXT_CACHE[String(selfNode.id)] || {})[String(i)];
    wired.push({
      kind: "input", n: i, label: `input ${i}`,
      hint: cached ? stem(cached) : "from wire",
      group: "wired", score: 4 + i * 0.01,
    });
  }

  const specials = [
    { kind: "date", fmt: "%Y-%m-%d", label: "date", hint: today(), group: "special", score: 0 },
    { kind: "time", fmt: "%H%M%S", label: "time", hint: "143022", group: "special", score: 1 },
    { kind: "elapsed", fmt: ".1f", label: "elapsed", hint: "50.4", group: "special", score: 2 },
    { kind: "text", text: "K2", label: "text", hint: "free text", group: "special", score: 3 },
  ];

  return specials
    .concat(wired)
    .concat(loraChips)
    .concat(chips.sort((a, b) => a.score - b.score));
}

/* ---------- resolve one chip in the browser ----------
   zone "folder" + folderNamesOnly: drop numeric chips, LoRA name only,
   and strip any trailing (number) group.                            */
const PAREN_NUM = /\(\s*[-+0-9.eE]+\s*\)/g;

/* ---------- rebinding ----------
   A chip remembers a node id, which means nothing in a different workflow.
   When it fails to resolve, look for the same value here: same class first,
   then same node title, then any node carrying that widget name - but only
   if there is exactly one, so a generic name like "value" never guesses. */
const GENERIC_WIDGETS = new Set([
  "value", "text", "string", "enabled", "debug", "mode", "type", "device",
  "strength", "scale", "control_after_generate", "crop", "upscale_method",
]);

function rebindChip(chip) {
  if (chip.kind !== "widget" || !chip.widget) return false;

  const nodes = (app.graph?._nodes || [])
    .filter(n => n.mode !== 2 && n.mode !== 4)
    .filter(n => !String(n.comfyClass || n.type || "").startsWith("Leiel"))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const has = n => (n.widgets || []).some(w => w.name === chip.widget);

  let hit = nodes.find(n => (n.comfyClass || n.type) === chip.cls && has(n));
  if (!hit) hit = nodes.find(n => (n.title || n.type) === chip.title && has(n));
  if (!hit) {
    const all = nodes.filter(has);
    if (all.length === 1 && !GENERIC_WIDGETS.has(chip.widget)) hit = all[0];
  }
  if (!hit) return false;

  chip.id = String(hit.id);
  chip.cls = hit.comfyClass || hit.type;
  chip.title = hit.title || chip.cls;
  return true;
}

function chipBypassed(chip) {
  if (chip.kind !== "widget") return false;
  const n = app.graph.getNodeById(parseInt(chip.id))
         || (app.graph._nodes || []).find(x => (x.title || x.type) === chip.title);
  return !!n && (n.mode === 2 || n.mode === 4);
}

function previewChip(chip, node, zone, namesOnly) {
  /* A bundle is several settings of one node kept together, so the name says
     which node they came from: Krea2T[strength(0.5)_text_scale(1.8)]. It is
     resolved from its parts, so everything downstream - rebinding, the
     unresolved count, Clean - keeps working unchanged. */
  if (chip.kind === "bundle") {
    const parts = [];
    for (const sub of chip.items || []) {
      const r = previewChip(sub, node, zone, namesOnly);
      if (r !== null && r !== "") parts.push(r);
    }
    if (!parts.length) return null;
    /* No node name, no brackets. Wrapping them made a name that was already
       long unreadable, and the parts say plenty on their own. */
    return parts.join(chip.inner || "_");
  }
  const simplify = (zone === "folder" && namesOnly !== false);
  if (simplify && chip.num) return null;

  let pre = chip.pre || "", suf = chip.suf || "";
  let fmt = chip.fmt;
  if (simplify && (chip.kind === "lora" || chip.kind === "loras")) {
    fmt = "name"; pre = ""; suf = "";
  }
  let core = "";
  switch (chip.kind) {
    case "text": {
      const t = pre + (chip.text || "") + suf;
      return t === "" ? null : t;
    }
    case "input": {
      const cached = (TEXT_CACHE[String(node?.id)] || {})[String(chip.n)];
      if (!cached) return null;
      core = cached;
      break;
    }
    case "date":    core = today(); break;
    case "time":    core = "143022"; break;
    case "elapsed": core = "50.4"; break;
    case "loras": {
      const l = collectLoras(node);
      if (!l.length) return null;
      core = l.map(x => fmt === "name" ? x[0] : `${x[0]}(${x[1]})`)
              .join(chip.sep || "_");
      break;
    }
    case "lora": {
      const l = collectLoras(node);
      const it = l[(chip.n || 1) - 1];
      if (!it) return null;
      core = fmt === "name" ? it[0] : `${it[0]}(${it[1]})`;
      break;
    }
    default: {
      const n = app.graph.getNodeById(parseInt(chip.id))
             || (app.graph._nodes || []).find(x => (x.title || x.type) === chip.title);
      if (!n) return null;
      /* bypassed (4) or muted (2) -> the node is not part of the run,
         so it must not appear in the name                            */
      if (n.mode === 2 || n.mode === 4) return null;
      const w = (n.widgets || []).find(x => x.name === chip.widget);
      if (!w) return null;
      core = fmt === "raw" ? String(w.value) : stemFull(w.value);
    }
  }
  if (core === "" || core === null) return null;
  let out = pre + core + suf;
  if (simplify) {
    out = out.replace(PAREN_NUM, "").replace(/_{2,}/g, "_").replace(/^[_\- ]+|[_\- ]+$/g, "");
    if (!out) return null;
  }
  return out;
}

/* ---------- styles ---------- */
/* ---------- category colours ----------
   One table. These used to be typed out in three places - the chips in the
   Folder and File boxes, the pods in the palette, and the legend between them
   - and they had already drifted apart: a date chip was #c98a3c while a date
   pod was #c9a227, and size was teal on one and green on the other. The CSS
   and the legend are both generated from here now, so they cannot disagree
   again. */
const CAT_COLOURS = [
  ["lora",     "#7b6ce0", "#b9aef5", "LoRA"],
  ["sampler",  "#4a92c8", "#a7d2ef", "sampler"],
  ["model",    "#48a882", "#93d9bd", "model"],
  ["time",     "#c9a227", "#e6cf7a", "date / time"],
  ["text",     "#c06a9c", "#e3aecb", "text widget"],
  ["free",     "#c85f5f", "#efb0b0", "free text"],
  ["size",     "#6f9f6f", "#b5d8b5", "size"],
  ["strength", "#a89040", "#dcc884", "strength"],
  ["other",    "#7c7c7c", "#bbbbbb", "anything else"],
];
const CAT_CSS = CAT_COLOURS.map(([k, b, f]) =>
  `.leiel-chip.c-${k}{border-color:${b};background:${b}2e;}\n` +
  `.leiel-pod.c-${k},.leiel-line.c-${k} .gt{border-color:${b};color:${f};}\n` +
  `.leiel-pod.c-${k}{background:${b}1f;}`).join("\n");

const CSS = `
.leiel-wrap{display:flex;flex-direction:column;gap:6px;font-family:system-ui,sans-serif;
  font-size:11px;color:var(--fg-color,#ddd);height:100%;box-sizing:border-box;padding:4px;}
.leiel-bar{display:flex;gap:4px;align-items:center;}
.leiel-bar input{flex:1;background:var(--comfy-input-bg,#222);color:inherit;
  border:1px solid var(--border-color,#444);border-radius:4px;padding:3px 6px;font-size:11px;}
.leiel-btn{background:#2b2b2b;border:1px solid #555;border-radius:4px;color:#ddd;
  padding:3px 7px;cursor:pointer;font-size:11px;}
.leiel-btn:hover{background:#3a3a3a;}
/* the heading lives inside the box, as it does for FOLDER and FILE */
.leiel-palbox{border:1px solid var(--border-color,#444);border-radius:5px;
  background:#1b1b1b;padding:4px 5px;flex:0 0 200px;display:flex;
  flex-direction:column;gap:2px;overflow:hidden;min-height:0;}
.leiel-palbox h4{margin:0;font-size:10px;opacity:.6;letter-spacing:.5px;
  font-weight:600;flex:0 0 auto;}
.leiel-pal{flex:1 1 0;min-height:0;overflow-y:auto;display:flex;flex-wrap:wrap;
  gap:4px;align-content:flex-start;}
/* boxed: a light frame per node. rows: a name at the head of each line. */
/* pods: each node is a large rounded chip of its own, several to a line
   when they are small. lines: one node per row, ruled off from the next. */
.leiel-pal.view-pods{flex-direction:row;flex-wrap:wrap;gap:6px;
  align-content:flex-start;align-items:flex-start;}
.leiel-pal.view-lines{flex-direction:column;flex-wrap:nowrap;gap:0;}
.leiel-pod{border:1px solid #444;border-radius:14px;padding:5px 9px 8px;
  flex:0 1 auto;max-width:100%;}
.leiel-pod .gt{font-size:9px;letter-spacing:.6px;margin-bottom:4px;
  padding-left:2px;opacity:.85;}
.leiel-line{display:flex;align-items:flex-start;gap:10px;padding:6px 2px;
  border-bottom:1px solid #2b2b2b;}
.leiel-line:last-child{border-bottom:0;}
.leiel-line .gt{flex:0 0 128px;font-size:10px;padding-top:5px;opacity:.9;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.leiel-pod .gw,.leiel-line .gw{display:flex;flex-wrap:wrap;gap:4px;flex:1 1 0;
  min-width:0;}
.leiel-zones{display:flex;gap:0;flex:0 0 auto;min-height:60px;}
.leiel-grip{height:5px;flex:0 0 auto;border-radius:3px;background:#2a2a2a;
  cursor:row-resize;margin:2px 0;}
.leiel-grip:hover{background:#5b7fa6;}
.leiel-split{width:6px;flex:0 0 auto;border-radius:3px;background:#2a2a2a;
  cursor:col-resize;margin:0 3px;align-self:stretch;}
.leiel-split:hover{background:#5b7fa6;}
.leiel-foot{display:flex;align-items:center;gap:6px;padding:5px 2px 10px;}
.leiel-help-box{position:absolute;z-index:40;background:#161616;
  border:1px solid #5b7fa6;border-radius:6px;padding:12px 14px;width:460px;
  max-height:70vh;overflow-y:auto;box-shadow:0 6px 24px #000c;
  font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.65;
  color:#ddd;}
.leiel-help-box h3{margin:0 0 8px;font-size:14px;color:#fff;letter-spacing:.5px;}
.leiel-help-box h5{margin:12px 0 3px;font-size:11px;color:#ffd479;
  letter-spacing:.5px;text-transform:uppercase;}
.leiel-help-box p{margin:0 0 4px;opacity:.85;}
.leiel-help-box code{background:#0d0d0d;border:1px solid #333;border-radius:3px;
  padding:0 4px;color:#9fd3f0;}
.leiel-help-box .hc{margin-top:12px;text-align:right;}
.leiel-brand{font-size:11px;opacity:.4;letter-spacing:1px;}
.leiel-btn.leiel-help{width:24px;padding:2px 0;font-size:13px;font-weight:700;
  border-radius:12px;line-height:1;}
.leiel-btn.on{background:#2d4a5a;border-color:#4a7f9e;color:#cfe8ff;}
/* fixed box: the three glyphs are not the same height, and letting them set
   it made the button jump about as the mode changed */
.leiel-btn.leiel-view{background:#2b2340;border-color:#7b6ce0;color:#cfc6ff;
  font-weight:600;width:86px;height:24px;line-height:22px;padding:0;
  display:inline-flex;align-items:center;justify-content:center;gap:5px;
  flex:0 0 auto;box-sizing:border-box;}
.leiel-btn.leiel-view:hover{background:#3a2f5c;color:#fff;}
.leiel-btn.leiel-view .ic{font-size:11px;line-height:1;width:11px;
  display:inline-block;text-align:center;}
.leiel-group{position:absolute;z-index:40;background:#161616;
  border:1px solid #5b7fa6;border-radius:6px;padding:10px 12px;width:470px;
  max-height:70vh;overflow-y:auto;box-shadow:0 6px 24px #000c;
  font-family:ui-monospace,Consolas,monospace;font-size:12px;color:#ddd;}
.leiel-group h5{margin:0 0 8px;font-size:12px;color:#ffd479;letter-spacing:.5px;}
.leiel-group .grow{display:flex;align-items:center;gap:8px;padding:3px 0;}
.leiel-group .grow:hover{background:#1e1e1e;border-radius:4px;}
.leiel-group .gn{flex:0 0 auto;font-weight:600;font-size:12px;}
.leiel-group .gv{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;opacity:.5;}
.leiel-group .grow input{margin:0 2px 0 0;flex:0 0 auto;}
.leiel-group .gb{display:flex;align-items:center;gap:5px;margin-top:10px;
  flex-wrap:wrap;justify-content:flex-end;}
.leiel-group .gh{flex:1 1 0;opacity:.45;font-size:10px;}
/* big enough to hit without aiming, and coloured for the box they fill */
.leiel-group .leiel-add{cursor:pointer;border:1px solid #555;border-radius:50%;
  width:22px;height:22px;line-height:20px;text-align:center;font-weight:700;
  font-size:12px;flex:0 0 auto;user-select:none;}

/* each box wears the colour of the button that sends things to it */
.leiel-zone[data-zone="folder"]{border-color:#7b6ce0;background:#211d2e;}
.leiel-zone[data-zone="folder"] h4{color:#b9aef5;opacity:.85;}
.leiel-zone[data-zone="file"]{border-color:#48a882;background:#18241f;}
.leiel-zone[data-zone="file"] h4{color:#93d9bd;opacity:.85;}
.leiel-zone{flex:1;border:1px dashed #555;border-radius:5px;background:#1b1b1b;
  padding:5px;display:flex;flex-direction:column;gap:4px;overflow-y:auto;}
.leiel-zone.over{border-color:#7ab8ff;background:#1f2733;}
.leiel-zone h4{margin:0 0 2px;font-size:10px;opacity:.6;letter-spacing:.5px;font-weight:600;}
.leiel-chips{display:flex;flex-wrap:wrap;gap:4px;align-content:flex-start;}
.leiel-chip{display:inline-flex;align-items:center;gap:4px;background:#333;border:1px solid #555;
  border-radius:11px;padding:2px 7px;cursor:grab;user-select:none;white-space:nowrap;
  max-width:100%;min-width:0;}
/* long values are clipped so the controls never get pushed out of reach */
.leiel-chip .lbl,.leiel-chip .x,.leiel-chip .mv,.leiel-chip .fm{flex:0 0 auto;}
${CAT_CSS}
/* One colour per source node, the same rule the Series Lab uses. Colouring
   by the kind of setting meant one node's options came out in four colours
   and the pod around them took whichever happened to be first. No grey in
   here: every option came from some node, and the colour is what says which. */
.leiel-pod.c-n0,.leiel-line.c-n0 .gt{border-color:#4a92c8;color:#a7d2ef;}
.leiel-pod.c-n1,.leiel-line.c-n1 .gt{border-color:#48a882;color:#93d9bd;}
.leiel-pod.c-n2,.leiel-line.c-n2 .gt{border-color:#c06a9c;color:#e3aecb;}
.leiel-pod.c-n3,.leiel-line.c-n3 .gt{border-color:#c9a33f;color:#e8d089;}
.leiel-pod.c-n4,.leiel-line.c-n4 .gt{border-color:#7b6ce0;color:#b9aef5;}
.leiel-pod.c-n5,.leiel-line.c-n5 .gt{border-color:#c8794a;color:#efbb95;}
.leiel-pod.c-n6,.leiel-line.c-n6 .gt{border-color:#3fa8b4;color:#96dde5;}
.leiel-pod.c-n7,.leiel-line.c-n7 .gt{border-color:#c05f6a;color:#eda9b1;}
.leiel-pod.c-n8,.leiel-line.c-n8 .gt{border-color:#8fa83f;color:#cfe08c;}
.leiel-pod.c-n9,.leiel-line.c-n9 .gt{border-color:#9a6cc0;color:#cfaee8;}
.leiel-pod.c-n0{background:#4a92c81f;}
.leiel-pod.c-n1{background:#48a8821f;}
.leiel-pod.c-n2{background:#c06a9c1f;}
.leiel-pod.c-n3{background:#c9a33f1f;}
.leiel-pod.c-n4{background:#7b6ce01f;}
.leiel-pod.c-n5{background:#c8794a1f;}
.leiel-pod.c-n6{background:#3fa8b41f;}
.leiel-pod.c-n7{background:#c05f6a1f;}
.leiel-pod.c-n8{background:#8fa83f1f;}
.leiel-pod.c-n9{background:#9a6cc01f;}
.leiel-chip .own{flex:0 1 auto;min-width:0;max-width:110px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;opacity:.55;}
.leiel-chip .sep{flex:0 0 auto;opacity:.3;padding:0 1px;}
.leiel-chip .v{min-width:0;max-width:190px;overflow:hidden;text-overflow:ellipsis;}
.leiel-btn.armed{border-color:#c85f5f;background:#3a2020;color:#ffb0b0;}
.leiel-chip.bad{border-style:dashed;}
.leiel-chip.bad .v{color:#e08a8a;font-style:italic;}
.leiel-chip.bad .lbl{opacity:.6;}
.leiel-chip:hover{background:#3d3d3d;}
.leiel-chip.muted{opacity:.4;}
/* category colours - muted enough to sit on a dark canvas, distinct enough to scan */
.leiel-chip.c-n0{border-color:#4a92c8;background:#1e2c3a;}
.leiel-chip.c-n1{border-color:#48a882;background:#1c3029;}
.leiel-chip.c-n2{border-color:#c06a9c;background:#361f2d;}
.leiel-chip.c-n3{border-color:#c9a33f;background:#332b16;}
.leiel-chip.c-n4{border-color:#7b6ce0;background:#2f2b45;}
.leiel-chip.c-n5{border-color:#c8794a;background:#372417;}
.leiel-chip.c-n6{border-color:#3fa8b4;background:#153033;}
.leiel-chip.c-n7{border-color:#c05f6a;background:#361d21;}
.leiel-chip.c-n8{border-color:#8fa83f;background:#2a3016;}
.leiel-chip.c-n9{border-color:#9a6cc0;background:#2c2140;}
.leiel-legend{display:flex;flex-wrap:wrap;gap:5px;font-size:9px;opacity:.6;
  padding:1px 2px;align-items:center;}
.leiel-legend span{display:inline-flex;align-items:center;gap:3px;}
/* says which half of the node the swatches are about - the palette above uses
   one colour per source node, not these */
.leiel-legend b{font-weight:700;letter-spacing:.5px;opacity:.75;}
.leiel-legend i{width:8px;height:8px;border-radius:2px;display:inline-block;
  border:1px solid rgba(255,255,255,.25);}
.leiel-chip .v{opacity:.55;font-size:10px;}
.leiel-chip .x{cursor:pointer;opacity:.5;padding:0 1px;}
.leiel-chip .x:hover{opacity:1;color:#f88;}
.leiel-chip .mv,.leiel-chip .fm{cursor:pointer;opacity:.4;font-size:9px;}
.leiel-chip .mv:hover,.leiel-chip .fm:hover{opacity:1;color:#7ab8ff;}
.leiel-add{font-size:10px;padding:1px 5px;border-radius:8px;border:1px solid #555;
  background:#262626;cursor:pointer;}
/* F and N wear the colours of the two boxes they send to, wherever they
   appear. Declared after the plain rule above, or that would win. */
.leiel-add[data-z="folder"]{background:#2f2b45;border-color:#7b6ce0;
  color:#cfc6ff;}
.leiel-add[data-z="folder"]:hover{background:#443c68;color:#fff;}
.leiel-add[data-z="file"]{background:#1c3029;border-color:#48a882;
  color:#c2ecd9;}
.leiel-add[data-z="file"]:hover{background:#2a4a3d;color:#fff;}
.leiel-add:hover{background:#3a5a7a;}
.leiel-prev{background:#141414;border:1px solid #333;border-radius:4px;padding:4px 6px;
  font-family:ui-monospace,Consolas,monospace;font-size:10px;line-height:1.5;
  word-break:break-all;flex:0 0 auto;max-height:56px;overflow-y:auto;}
.leiel-prev .ok{color:#8fd18f;} .leiel-prev .warn{color:#e0a04d;}
.leiel-edit{display:flex;gap:3px;margin-top:3px;}
.leiel-edit input{width:100%;min-width:34px;background:#111;border:1px solid #666;
  border-radius:3px;color:#ddd;font-size:10px;padding:2px 4px;}
.leiel-edit input:focus{outline:none;border-color:#7ab8ff;}
.leiel-edit .leiel-ok{background:#2d5a2d;border:1px solid #4a8a4a;border-radius:3px;
  color:#dfd;font-size:10px;padding:1px 6px;cursor:pointer;}
.leiel-edit .leiel-ok:hover{background:#3d7a3d;}
.leiel-panel{position:absolute;inset:0;background:#151515;border:1px solid #666;
  border-radius:6px;z-index:20;display:flex;flex-direction:column;gap:5px;padding:7px;
  font-size:11px;}
.leiel-panel h5{margin:0;font-size:11px;opacity:.75;letter-spacing:.4px;}
.leiel-panel .row{display:flex;gap:4px;}
.leiel-panel .list{flex:1;overflow-y:auto;border:1px solid #333;border-radius:4px;
  background:#101010;padding:3px;display:flex;flex-direction:column;gap:2px;}
.leiel-snap{display:flex;align-items:center;gap:5px;padding:3px 5px;border-radius:3px;
  cursor:pointer;font-family:ui-monospace,Consolas,monospace;font-size:10px;}
.leiel-snap:hover{background:#243040;}
.leiel-snap .tag{color:#8fd18f;}
.leiel-snap .del{margin-left:auto;opacity:.4;padding:0 3px;}
.leiel-snap .del:hover{opacity:1;color:#f88;}
.leiel-panel textarea{width:100%;height:60px;background:#0d0d0d;color:#ccc;
  border:1px solid #444;border-radius:4px;font-family:ui-monospace,monospace;
  font-size:9px;resize:none;box-sizing:border-box;}
`;

/* ---------- extension ---------- */
app.registerExtension({
  name: "leiel.filename.studio",

  async setup() {
    if (!document.getElementById("leiel-filename-css")) {
      const s = document.createElement("style");
      s.id = "leiel-filename-css";
      s.textContent = CSS;
      document.head.appendChild(s);
    }
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "LeielFilenameStudio") return;

    const orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      orig?.apply(this, arguments);
      const node = this;

      /* hide the serialized layout widget */
      setTimeout(() => {
        const w = node.widgets?.find(x => x.name === "layout_json");
        if (w) {
          w.type = "leiel-hidden";
          w.computeSize = () => [0, -4];
          if (w.element) w.element.style.display = "none";
          node.setDirtyCanvas(true, true);
        }
      }, 0);

      /* Both inputs are optional and each serves exactly one feature, so say
         so on the slot itself - most people never reach the README. */
      const SLOT_LABELS = {
        run_after: "run_after (for elapsed)",
        lora_text: "lora_text (for Visual Series Lab)",
        text_1: "text_1 (any text -> chip)",
        text_2: "text_2 (any text -> chip)",
        text_3: "text_3 (any text -> chip)",
        text_4: "text_4 (any text -> chip)",
      };
      function labelInputs() {
        for (const inp of (node.inputs || [])) {
          const want = SLOT_LABELS[inp.name];
          if (want && inp.label !== want) inp.label = want;
        }
      }

      /* Four empty text sockets on a node that mostly needs none is four rows
         of nothing to read past. One is shown, and the next appears as soon as
         that one is used - the same way the Series Lab opens its prompt
         sockets. The Python side still declares all four as optional, so a
         socket that is not on screen is simply one the server never receives.
         Removing an unlinked one can never lose a connection. */
      const MAX_TEXT = 4;
      function syncTextInputs() {
        const at = (i) => (node.inputs || []).findIndex(x => x.name === "text_" + i);
        const linked = (i) => {
          const j = at(i);
          const inp = j >= 0 ? node.inputs[j] : null;
          return !!(inp && inp.link !== null && inp.link !== undefined);
        };
        let want = 1;
        for (let i = 1; i <= MAX_TEXT; i++) if (linked(i)) want = i + 1;
        want = Math.min(MAX_TEXT, want);

        let changed = false;
        for (let i = 1; i <= want; i++) {
          if (at(i) < 0) { node.addInput("text_" + i, "STRING"); changed = true; }
        }
        /* from the end backwards, so removing one cannot renumber the next */
        for (let i = MAX_TEXT; i > want; i--) {
          const j = at(i);
          if (j >= 0 && !linked(i)) { node.removeInput(j); changed = true; }
        }
        if (changed) { labelInputs(); node.setDirtyCanvas(true, true); }
        return changed;
      }

      setTimeout(() => {
        syncTextInputs(); labelInputs(); node.setDirtyCanvas(true, true);
      }, 0);

      const state = { folder: [], file: [], palH: 200, zoneH: 90, split: 0.5,
                      showOpts: false, view: "flat" };
      node._leielState = state;

      /* Nothing may be written back to the widget until the saved layout has
         been read in. Without this, a node rebuilt by undo / paste / workflow
         switch would autosave its empty starting state over real data.      */
      let ready = false;

      const root = document.createElement("div");
      root.className = "leiel-wrap";
      root.innerHTML = `
        <div class="leiel-bar">
          <button class="leiel-btn leiel-view" title="How the palette is laid out">flat</button>
          <input class="leiel-search" placeholder="Search options (sampler, shift, lora ...)">
          <button class="leiel-btn leiel-opts" title="Show the settings below">Settings</button>

          <button class="leiel-btn leiel-tag" title="Toggle name labels on numeric chips - steps(8)">Tag</button>
          <button class="leiel-btn leiel-refresh" title="ReScan workflow">ReScan</button>
          <button class="leiel-btn leiel-save" title="Save / restore layout">Save</button>
          <button class="leiel-btn leiel-clean" style="display:none;border-color:#a05555"
                  title="Remove chips that cannot resolve in this workflow">Clean</button>
        </div>
        <div class="leiel-palbox">
          <h4>OPTIONS</h4>
          <div class="leiel-pal"></div>
        </div>
        <div class="leiel-grip leiel-grip-pal" title="drag to resize the palette&#10;hold Shift to trade height with the boxes below instead of resizing the node"></div>
        <div class="leiel-legend" title="The colours of the chips in the Folder and File boxes below. In the palette above, a chip takes the colour of the node it came from instead.">
          <b>below:</b>
          ${CAT_COLOURS.map(([k, b, f, label]) =>
            `<span><i style="background:${b}2e;border-color:${b}"></i>${label}</span>`
          ).join("")}
        </div>
        <div class="leiel-zones">
          <div class="leiel-zone" data-zone="folder"><h4>FOLDER</h4><div class="leiel-chips"></div></div>
          <div class="leiel-split" title="drag to share the width"></div>
          <div class="leiel-zone" data-zone="file"><h4>FILE</h4><div class="leiel-chips"></div></div>
        </div>
        <div class="leiel-grip leiel-grip-zone" title="drag to resize both boxes&#10;hold Shift to trade height with the palette instead of resizing the node"></div>
        <div class="leiel-prev"></div>
        <div class="leiel-foot">
          <span class="leiel-brand">Visual Filename Manager</span>
          <span style="flex:1"></span>
          <button class="leiel-btn leiel-help" title="How this node works">?</button>
        </div>`;

      for (const ev of ["pointerdown", "mousedown", "wheel", "contextmenu"]) {
        root.addEventListener(ev, e => e.stopPropagation());
      }

      root.style.position = "relative";
      const pal = root.querySelector(".leiel-pal");
      const palBox = root.querySelector(".leiel-palbox");
      const zoneWrap = root.querySelector(".leiel-zones");
      const search = root.querySelector(".leiel-search");
      const prev = root.querySelector(".leiel-prev");
      const zones = {
        folder: root.querySelector('[data-zone="folder"] .leiel-chips'),
        file: root.querySelector('[data-zone="file"] .leiel-chips'),
      };

      let catalog = [];
      let dragging = null;
      let dropHandled = false;
      /* Set by any deliberate edit. Without it, deleting the last chip looks
         identical to a layout wiped by undo, and the recovery guard below
         would helpfully put it back.                                       */
      let userTouched = false;
      const touch = () => { userTouched = true; };
      let editing = false;

      /* Serialize layout AND a snapshot of what the UI currently shows.
         The backend prefers the snapshot, so preview == output.         */
      const namesOnly = () =>
        (node.widgets?.find(x => x.name === "folder_style")?.value ?? "names_only")
          === "names_only";

      const save = () => {
        if (!ready) return;
        const w = node.widgets?.find(x => x.name === "layout_json");
        if (!w) return;

        /* Second guard: never let an empty layout overwrite a populated one -
           unless the user emptied it on purpose. */
        if (!userTouched && !state.folder.length && !state.file.length && w.value) {
          try {
            const prev = JSON.parse(w.value);
            if (prev.folder?.length || prev.file?.length) {
              restoreFrom(prev, "recovered");
              return;
            }
          } catch (e) { /* unreadable - fall through and overwrite */ }
        }

        const snap = {};
        const no = namesOnly();
        state.folder.forEach((c, i) => {
          if (c.kind === "elapsed" || c.kind === "input") return;
          const v = previewChip(c, node, "folder", no);
          if (v !== null) snap["f" + i] = v;
        });
        state.file.forEach((c, i) => {
          if (c.kind === "elapsed" || c.kind === "input") return;
          const v = previewChip(c, node, "file", no);
          if (v !== null) snap["n" + i] = v;
        });
        w.value = JSON.stringify({
          folder: state.folder, file: state.file, palH: state.palH,
          zoneH: state.zoneH, split: state.split, showOpts: state.showOpts,
          view: state.view,
          snap, loraCache: LORA_CACHE[String(node.id)] || undefined,
        });
        snapPush({ folder: state.folder, file: state.file }, "auto");
      };

      /* Load a layout object into the live state. */
      function restoreFrom(p, why) {
        if (!p) return false;
        state.folder = p.folder || [];
        state.file = p.file || [];
        if (p.palH) state.palH = p.palH;
        if (p.zoneH) state.zoneH = p.zoneH;
        if (p.split) state.split = p.split;
        if (p.showOpts !== undefined) state.showOpts = !!p.showOpts;
        if (p.view) {
          /* layouts saved before they were renamed */
          const OLD = { boxed: "pods", rows: "lines" };
          state.view = OLD[p.view] || p.view;
        }
        if (p.loraCache && !LORA_CACHE[String(node.id)]) {
          LORA_CACHE[String(node.id)] = p.loraCache;
        }
        ready = true;
        userTouched = (p.folder?.length || p.file?.length) ? userTouched : userTouched;
        applyPalH();
        renderZones();
        if (why) console.log(`[Leiel VFM] layout ${why}`);
        return true;
      }
      node._leielRestore = restoreFrom;

      function renderPreview() {
        const fsep = node.widgets?.find(w => w.name === "folder_sep")?.value || "/";
        const nsep = node.widgets?.find(w => w.name === "file_sep")?.value || "_";
        let warn = 0;
        const no = namesOnly();
        const join = (list, sep, zone) => list.map(c => {
          const r = previewChip(c, node, zone, no);
          if (r === null) { if (!(zone === "folder" && no && c.num)) warn++; return null; }
          return r;
        }).filter(Boolean).join(sep);

        const folder = join(state.folder, fsep, "folder");
        const file = join(state.file, nsep, "file");
        const full = folder ? `${folder}/${file}` : file;
        const cls = file.length > 190 ? "warn" : "ok";
        prev.innerHTML =
          `<span class="${cls}">${escapeHtml(full || "(empty)")}</span>` +
          `<br><span style="opacity:.5">file name ${file.length} chars` +
          (reboundCount ? ` &middot; ${reboundCount} rebound` : "") +
          (warn ? ` &middot; <span style="color:#e08a8a">${warn} unresolved</span>` : "") +
          `</span>`;
        updateCleanButton(warn);
      }

      /* One chip per node rather than one per setting. A busy workflow put
         sixty chips on screen and finding one meant reading all of them. */
      function paletteGroups(q) {
        const groups = new Map();
        for (const c of catalog) {
          const blob = `${c.label} ${c.hint} ${c.group} ${c.widget || ""}`.toLowerCase();
          if (q && !blob.includes(q)) continue;
          const key = c.group || "other";
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(c);
        }
        return groups;
      }

      /* Three ways of laying the palette out. Grouping them behind a popup
         read well but cost a click for every setting, and the quick rhythm of
         tapping F or N straight off a chip was what made this usable. So the
         chips are always right there; only how they are arranged changes. */
      const VIEWS = ["flat", "pods", "lines"];

      function shortNode(title) {
        /* "Visual Prompt Composer (Studio Leiel)" is most of a chip on its
           own. Trim the bracketed part; the full name is on hover. */
        return String(title).replace(/\s*\([^)]*\)\s*$/, "").trim() || title;
      }

      function paletteChip(c) {
        const el = document.createElement("div");
        el.className = "leiel-chip " + chipColourClass(c);
        el.title = `${c.group || ""} - ${c.label}` +
          (c.hint ? `\n${c.hint}` : "");
        el.innerHTML = `<span class="lbl">${escapeHtml(c.label)}</span>` +
          (c.hint ? `<span class="v">${escapeHtml(c.hint)}</span>` : "") +
          `<span class="leiel-add" data-z="folder" title="send to FOLDER">F</span>` +
          `<span class="leiel-add" data-z="file" title="send to FILE">N</span>`;
        el.querySelectorAll(".leiel-add").forEach((b) => {
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            addChip(b.dataset.z, c);
          });
        });
        return el;
      }

      function renderPalette() {
        const q = search.value.trim().toLowerCase();
        pal.innerHTML = "";
        const groups = paletteGroups(q);
        const view = VIEWS.includes(state.view) ? state.view : "flat";
        pal.className = "leiel-pal view-" + view;

        if (view === "flat") {
          for (const [, list] of groups) {
            for (const c of list) pal.appendChild(paletteChip(c));
          }
        } else {
          for (const [title, list] of groups) {
            /* the group wears the colour of what it holds, so a node can be
               found by its shade before its name is read */
            const cat = chipColourClass(list[0]);
            const box = document.createElement("div");
            box.className = (view === "pods" ? "leiel-pod" : "leiel-line") +
              " " + cat;
            const h = document.createElement("div");
            h.className = "gt";
            h.textContent = shortNode(title);
            h.title = title;
            box.appendChild(h);
            const wrap = document.createElement("div");
            wrap.className = "gw";
            for (const c of list) wrap.appendChild(paletteChip(c));
            box.appendChild(wrap);
            pal.appendChild(box);
          }
        }
        if (!pal.children.length) {
          pal.innerHTML = `<span style="opacity:.5">nothing matched - press ReScan</span>`;
        }
      }

      /* The settings of one node, each with the same F / N buttons the flat
         palette had, plus the option of sending several as one bundle. */
      function openGroup(title, list, anchor) {
        closeGroup();
        const box = document.createElement("div");
        box.className = "leiel-group";
        box.innerHTML = `<h5>${escapeHtml(title)}</h5>` +
          `<div class="gl"></div>` +
          `<div class="gb">` +
          `<span class="gh">tick several, then</span>` +
          `<button class="leiel-btn gfolder">Bundle to FOLDER</button>` +
          `<button class="leiel-btn gfile">Bundle to FILE</button>` +
          `<button class="leiel-btn gclose">Close</button></div>`;
        const glist = box.querySelector(".gl");
        const ticked = new Set();
        for (const c of list) {
          const row = document.createElement("div");
          row.className = "grow";
          /* the two buttons come first, so a setting can be sent with one
             tap without reading past its name */
          row.innerHTML =
            `<span class="leiel-add gf" data-z="folder" title="send to FOLDER">F</span>` +
            `<span class="leiel-add gnn" data-z="file" title="send to FILE">N</span>` +
            `<span class="gn">${escapeHtml(c.label)}</span>` +
            `<span class="gv">${escapeHtml(c.hint || "")}</span>` +
            `<input type="checkbox" title="tick to bundle with others">`;
          row.querySelector("input").addEventListener("change", (e) => {
            if (e.target.checked) ticked.add(c); else ticked.delete(c);
          });
          row.querySelectorAll(".leiel-add").forEach((b) => {
            b.addEventListener("click", (e) => {
              e.stopPropagation();
              addChip(b.dataset.z, c);
            });
          });
          glist.appendChild(row);
        }
        const bundle = (zone) => {
          if (ticked.size < 2) return;
          addChip(zone, {
            kind: "bundle", label: title, inner: "_",
            items: [...ticked].map((c) => {
              const sub = JSON.parse(JSON.stringify(c));
              delete sub.score; delete sub.muted; delete sub.group;
              delete sub.hint;
              if (sub.num && !sub.pre && !sub.suf) {
                sub.pre = sub.label + "("; sub.suf = ")";
              }
              return sub;
            }),
          });
          closeGroup();
        };
        box.querySelector(".gfolder").addEventListener("click", (e) => {
          e.stopPropagation(); bundle("folder");
        });
        box.querySelector(".gfile").addEventListener("click", (e) => {
          e.stopPropagation(); bundle("file");
        });
        box.querySelector(".gclose").addEventListener("click", (e) => {
          e.stopPropagation(); closeGroup();
        });
        for (const k of ["pointerdown", "mousedown", "wheel", "keydown"]) {
          box.addEventListener(k, (e) => e.stopPropagation());
        }
        const r = anchor.getBoundingClientRect();
        box.style.left = Math.max(8, Math.min(r.left,
          window.innerWidth - 380)) + "px";
        document.body.appendChild(box);
        const h = box.getBoundingClientRect().height;
        box.style.top = (r.bottom + 4 + h < window.innerHeight)
          ? (r.bottom + 4) + "px"
          : Math.max(8, r.top - h - 4) + "px";
        groupBox = box;
      }

      let groupBox = null;
      function closeGroup() {
        if (groupBox) { groupBox.remove(); groupBox = null; }
      }

      function addChip(zone, src, index) {
        const c = JSON.parse(JSON.stringify(src));
        delete c.score; delete c.muted; delete c.group; delete c.hint;
        if (c.kind === "bundle") {
          if (index === undefined) state[zone].push(c);
          else state[zone].splice(index, 0, c);
          touch();
          renderZones();
          return;
        }
        /* numeric values get their widget name so they stay readable later */
        if (c.num && !c.pre && !c.suf) { c.pre = c.label + "("; c.suf = ")"; }
        if (index === undefined) state[zone].push(c);
        else state[zone].splice(index, 0, c);
        touch();
        renderZones();
      }

      /* Re-point unresolved chips at this workflow's nodes. Runs on paste,
         on load and on every rescan, so a copied node heals itself.      */
      let reboundCount = 0;
      function rebindPass() {
        const no = namesOnly();
        let n = 0;
        for (const z of ["folder", "file"]) {
          for (const c of state[z]) {
            if (c.kind !== "widget") continue;
            if (previewChip(c, node, z, no) !== null) continue;
            if (chipBypassed(c)) continue;          // deliberately off, leave it
            if (rebindChip(c)) n++;
          }
        }
        reboundCount = n;
        if (n) console.log(`[Leiel VFM] ${n} chip(s) rebound to this workflow`);
        return n;
      }

      /* Taking a bundle apart puts its parts back where it stood, in order,
         so nothing has to be dragged into place again. */
      function splitBundle(zone, index) {
        const c = state[zone][index];
        if (!c || c.kind !== "bundle") return;
        state[zone].splice(index, 1, ...(c.items || []));
        touch();
        renderZones();
      }

      function renderZones() {
        rebindPass();
        for (const z of ["folder", "file"]) {
          const host = zones[z];
          host.innerHTML = "";
          state[z].forEach((c, i) => {
            const el = document.createElement("div");
            const isLora = c.kind === "lora" || c.kind === "loras";
            el.className = "leiel-chip " + chipColourClass(c);
            el.draggable = true;
            const val = previewChip(c, node, z, namesOnly());
            const isText = c.kind === "text";
            const skipped = (z === "folder" && namesOnly() && c.num);
            if (val === null && !skipped) el.classList.add("bad");
            const shown = val === null
              ? (skipped ? "skipped in folder"
                 : (chipBypassed(c) ? "bypassed - omitted" : "unresolved"))
              : val;
            /* Away from the palette there is nothing to say which node a
               setting belongs to, and "steps" alone is ambiguous once two
               nodes have one. The short name goes on the chip, the full one
               on hover. */
            const owner = c.group && c.group !== "special" ? c.group : "";
            el.title = (owner ? `${owner}\n` : "") + `${c.label}\n${shown}`;
            el.innerHTML =
              `<span class="mv" data-mv="-1">&#9664;</span>` +
              (owner && !isText
                ? `<span class="own">${escapeHtml(shortNode(owner))}</span>` +
                  `<span class="sep">|</span>`
                : "") +
              `<span class="lbl">${isText ? "T" : escapeHtml(c.label)}</span>` +
              `<span class="v">${escapeHtml(shown)}</span>` +
              (c.kind === "bundle"
                ? `<span class="fm ub" title="Split this bundle back into separate chips">&#8942;</span>`
                : "") +
              (isLora ? `<span class="fm" title="Toggle name only / name+strength">#</span>` : "") +
              `<span class="mv" data-mv="1">&#9654;</span>` +
              `<span class="x">&#10005;</span>`;

            el.addEventListener("dragstart", () => {
              dragging = { chip: c, from: z, index: i }; dropHandled = false;
            });
            el.addEventListener("dragend", (e) => {
              /* released outside the node = throw it away */
              if (dragging && !dropHandled) {
                const r = root.getBoundingClientRect();
                const out = e.clientX < r.left || e.clientX > r.right ||
                            e.clientY < r.top || e.clientY > r.bottom;
                if (out) {
                  snapPush({ folder: state.folder, file: state.file }, "before drag-out");
                  state[dragging.from].splice(dragging.index, 1);
                  dragging = null;
                  touch();
                  renderZones();
                  return;
                }
              }
              dragging = null;
            });
            el.querySelector(".x").addEventListener("click", e => {
              e.stopPropagation(); state[z].splice(i, 1); touch(); renderZones();
            });
            el.querySelectorAll(".mv").forEach(m => m.addEventListener("click", e => {
              e.stopPropagation();
              const j = i + parseInt(m.dataset.mv);
              if (j < 0 || j >= state[z].length) return;
              state[z].splice(j, 0, state[z].splice(i, 1)[0]);
              touch();
              renderZones();
            }));
            const ub = el.querySelector(".fm.ub");
            if (ub) ub.addEventListener("click", (e) => {
              e.stopPropagation();
              splitBundle(z, i);
            });
            /* the LoRA format toggle and the bundle split share a class, so
               pick the one that is not the split button */
            const fm = el.querySelector(".fm:not(.ub)");
            if (fm) fm.addEventListener("click", e => {
              e.stopPropagation();
              c.fmt = (c.fmt === "name") ? "" : "name";
              c.label = c.kind === "loras"
                ? (c.fmt === "name" ? "LoRA all (names)" : "LoRA all")
                : `lora${c.n}${c.fmt === "name" ? " (name)" : ""}`;
              touch();
              renderZones();
            });
            el.querySelector(".lbl").addEventListener("dblclick", e => {
              e.stopPropagation(); openEditor(el, c);
            });
            host.appendChild(el);
          });
          if (!state[z].length) {
            host.innerHTML = `<span style="opacity:.35">drop chips here</span>`;
          }
        }
        save();
        renderPreview();
        node.setDirtyCanvas(true);
      }

      /* prefix / format / suffix editor.
         Closes only when focus leaves the editor entirely.            */
      function openEditor(el, c) {
        if (editing || el.querySelector(".leiel-edit")) return;
        editing = true;
        const isText = c.kind === "text";
        const box = document.createElement("div");
        box.className = "leiel-edit";
        box.innerHTML =
          `<input class="p" placeholder="prefix" value="${escapeHtml(c.pre || "")}">` +
          (isText
            ? `<input class="t" placeholder="text" value="${escapeHtml(c.text || "")}">`
            : `<input class="f" placeholder="format" value="${escapeHtml(c.fmt || "")}">`) +
          `<input class="s" placeholder="suffix" value="${escapeHtml(c.suf || "")}">` +
          `<button class="leiel-ok" title="Apply (Enter)">OK</button>`;
        el.appendChild(box);

        let closed = false;
        const close = (apply) => {
          if (closed) return;
          closed = true;
          if (apply) {
            c.pre = box.querySelector(".p").value;
            c.suf = box.querySelector(".s").value;
            if (isText) c.text = box.querySelector(".t").value;
            else c.fmt = box.querySelector(".f").value;
            touch();
          }
          editing = false;
          renderZones();
        };

        box.addEventListener("focusout", () => {
          setTimeout(() => {
            if (closed) return;
            if (box.contains(document.activeElement)) return;
            close(true);
          }, 0);
        });
        box.querySelectorAll("input").forEach(inp => {
          ["keydown", "keyup", "keypress"].forEach(k =>
            inp.addEventListener(k, e => e.stopPropagation()));
          inp.addEventListener("keydown", e => {
            if (e.key === "Enter") { e.preventDefault(); close(true); }
            else if (e.key === "Escape") { e.preventDefault(); close(false); }
          });
          inp.addEventListener("pointerdown", e => e.stopPropagation());
        });
        box.querySelector(".leiel-ok").addEventListener("pointerdown", e => {
          e.preventDefault(); e.stopPropagation(); close(true);
        });
        const first = box.querySelector(isText ? ".t" : ".p");
        first.focus(); first.select();
      }

      /* Where a drop lands. The chips wrap over several lines, so "before the
         one whose middle the pointer has not passed" is worked out per row:
         the nearest chip on the same line as the pointer, falling through to
         the end of the box when it is below every row. Without this every
         drop went to the end, which made dragging inside a box useless for
         putting a chip anywhere but last. */
      function dropIndexIn(zoneEl, x, y) {
        const chips = [...zoneEl.querySelectorAll(".leiel-chip")];
        if (!chips.length) return 0;
        const rows = [];
        for (const el of chips) {
          const r = el.getBoundingClientRect();
          let row = rows.find(w => y >= w.top - 2 && y <= w.bottom + 2);
          if (!row) { row = { top: r.top, bottom: r.bottom, items: [] }; rows.push(row); }
          row.top = Math.min(row.top, r.top);
          row.bottom = Math.max(row.bottom, r.bottom);
          row.items.push({ el, r });
        }
        const hit = rows.find(w => y >= w.top - 2 && y <= w.bottom + 2);
        if (!hit) {
          /* above everything, or below everything */
          if (y < rows[0].top) return 0;
          return chips.length;
        }
        for (const it of hit.items) {
          if (x < it.r.left + it.r.width / 2) return chips.indexOf(it.el);
        }
        return chips.indexOf(hit.items[hit.items.length - 1].el) + 1;
      }

      for (const z of ["folder", "file"]) {
        const zoneEl = root.querySelector(`[data-zone="${z}"]`);
        zoneEl.addEventListener("dragover", e => {
          e.preventDefault(); zoneEl.classList.add("over");
        });
        zoneEl.addEventListener("dragleave", () => zoneEl.classList.remove("over"));
        zoneEl.addEventListener("drop", e => {
          e.preventDefault(); e.stopPropagation();
          zoneEl.classList.remove("over");
          if (!dragging) return;
          dropHandled = true;
          let at = dropIndexIn(zoneEl, e.clientX, e.clientY);
          if (dragging.from !== "pal") {
            /* Taking the chip out first shifts everything after it down one,
               so an index measured against the old list would land the chip
               one place too far right whenever it moves rightwards. */
            if (dragging.from === z && dragging.index < at) at -= 1;
            state[dragging.from].splice(dragging.index, 1);
          }
          addChip(z, dragging.chip, at);
          dragging = null;
        });
      }

      /* What the graph is made of, cheaply.

         The palette is a reading of the workflow, so it goes stale the moment
         a node is added or taken away - and nothing was watching for that. The
         timer below only looked at the style names and the enabled LoRAs, both
         of which can be unchanged while the graph around them has grown a
         sampler. ReScan existed to paper over exactly this.

         Counting ids and types is cheap enough to do twice a second on a large
         workflow, where re-reading every widget is not. */
      let lastGraphSig = null;

      function graphSignature() {
        const list = node.graph?._nodes || [];
        let sig = list.length + "|";
        for (const n of list) sig += n.id + ":" + (n.comfyClass || n.type || "") + ",";
        return sig;
      }

      function refresh() {
        syncTextInputs();
        labelInputs();
        catalog = scanGraph(node);
        renderPalette();
        renderZones();
        lastGraphSig = graphSignature();
      }

      root.querySelector(".leiel-tag").addEventListener("click", () => {
        const all = state.folder.concat(state.file).filter(c => c.num);
        if (!all.length) return;
        const anyBare = all.some(c => !c.pre && !c.suf);
        for (const c of all) {
          if (anyBare) { c.pre = c.label + "("; c.suf = ")"; }
          else { c.pre = ""; c.suf = ""; }
        }
        renderZones();
      });

      /* --- sizing ---
         The two stored numbers are the whole truth about this node's height.
         Nothing here measures the DOM or reads the node size: a widget's real
         height is what ComfyUI takes as the node's minimum, so a height
         derived from either of those feeds itself and creeps upward on every
         repaint - and cannot be made smaller again. */
      const PAL_MIN = 60, ZONE_MIN = 54, H_MAX = 1400;
      /* declared here, beside the other limits: a const is not hoisted, and
         chromeOf() below would hit it before its own line ran */
      const H_FLOOR = PAL_MIN + ZONE_MIN + 186;

      function wantHeight() {
        return state.palH + state.zoneH + 186;   // headings, legend, preview, foot
      }

      function chromeOf() {
        try { return node.computeSize()[1] - H_FLOOR; } catch (e) { return 96; }
      }

      function applyPalH() {
        palBox.style.flex = `0 0 ${state.palH}px`;
        zoneWrap.style.flex = `0 0 ${state.zoneH}px`;
        root.style.height = wantHeight() + "px";
        applySplit();
        node.setSize([Math.max(node.size[0], 560), chromeOf() + wantHeight()]);
        node.setDirtyCanvas(true, true);
      }

      function applySplit() {
        const r = Math.min(0.8, Math.max(0.2, Number(state.split) || 0.5));
        const f = root.querySelector('[data-zone="folder"]');
        const g = root.querySelector('[data-zone="file"]');
        if (!f || !g) return;
        for (const [el, grow] of [[f, r], [g, 1 - r]]) {
          el.style.flexGrow = String(grow);
          el.style.flexShrink = "1";
          el.style.flexBasis = "0";
        }
      }

      /* Drag the bar under a box to resize it. Change, then settle the node,
         then draw - any other order and the size correction inside the redraw
         fights the change. */
      /* Hold Shift and the two boxes trade height instead of the node growing:
         whatever one gains the other gives up, so the node keeps the size it
         had. Same gesture as the sections in the Prompt Composer. Without a
         modifier the node still grows, which is what you want when you simply
         need more room. */
      function addGrip(sel, key, min, other, otherMin) {
        const grip = root.querySelector(sel);
        if (!grip) return;
        grip.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          const y0 = e.clientY;
          const h0 = state[key], o0 = state[other];
          const move = (ev) => {
            const d = Math.round(ev.clientY - y0);
            if (ev.shiftKey) {
              /* clamped against BOTH floors before either is written, or the
                 pair drifts apart once one of them hits its limit and the
                 node quietly changes size after all */
              const room = Math.min(d, o0 - otherMin);
              const give = Math.max(room, min - h0);
              state[key] = h0 + give;
              state[other] = o0 - give;
            } else {
              state[key] = Math.min(H_MAX, Math.max(min, h0 + d));
            }
            applyPalH();
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            save();
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        });
      }
      addGrip(".leiel-grip-pal", "palH", PAL_MIN, "zoneH", ZONE_MIN);
      addGrip(".leiel-grip-zone", "zoneH", ZONE_MIN, "palH", PAL_MIN);

      /* The width is kept as a ratio, so it survives the node being made
         wider or narrower instead of drifting back. */
      const splitEl = root.querySelector(".leiel-split");
      if (splitEl) {
        splitEl.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          const box = root.querySelector(".leiel-zones").getBoundingClientRect();
          const move = (ev) => {
            state.split = Math.min(0.8, Math.max(0.2,
              (ev.clientX - box.left) / (box.width || 1)));
            applySplit();
            node.setDirtyCanvas(true, true);
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            save();
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        });
        splitEl.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          state.split = 0.5;
          applySplit();
          save();
        });
      }

      /* Dragging the node's corner does not repaint the widget, so without
         this the extra room just sat at the bottom as dead space. Share it
         between the two boxes in proportion to what they already have. */
      const prevOnResize = node.onResize;
      node.onResize = function (size) {
        if (prevOnResize) prevOnResize.apply(this, arguments);
        try {
          const diff = size[1] - (chromeOf() + wantHeight());
          if (Math.abs(diff) <= 1) return;
          const total = state.palH + state.zoneH || 1;
          const a = Math.round(diff * (state.palH / total));
          state.palH = Math.min(H_MAX, Math.max(PAL_MIN, state.palH + a));
          state.zoneH = Math.min(H_MAX,
            Math.max(ZONE_MIN, state.zoneH + (diff - a)));
          applyPalH();
        } catch (err) { /* ignore */ }
      };
      /* The five settings underneath are set once and then forgotten - a
         path length limit, a percent escape, a fallback name. They are worth
         keeping, because when one of them does bite there has to be a way to
         fix it, but they do not deserve permanent space. Folded away, one
         button to bring them back. */
      const TUCKED = ["max_filename_chars", "resolve_mode", "folder_style",
                      "escape_percent", "fallback_name"];
      const tuckedOriginals = new Map();

      function applyTucked() {
        for (const name of TUCKED) {
          const w2 = (node.widgets || []).find((x) => x.name === name);
          if (!w2) continue;
          if (!tuckedOriginals.has(name)) {
            tuckedOriginals.set(name, {
              computeSize: w2.computeSize, draw: w2.draw, type: w2.type,
            });
          }
          const o = tuckedOriginals.get(name);
          if (state.showOpts) {
            w2.computeSize = o.computeSize;
            w2.draw = o.draw;
            w2.hidden = false;
          } else {
            /* the type is left alone: replacing it drops the value from the
               saved workflow entirely */
            w2.computeSize = () => [0, -4];
            w2.draw = () => {};
            w2.hidden = true;
          }
        }
        const b = root.querySelector(".leiel-opts");
        if (b) b.classList.toggle("on", !!state.showOpts);
        node.setSize([Math.max(node.size[0], 560), chromeOf() + wantHeight()]);
        node.setDirtyCanvas(true, true);
      }

      const viewBtn = root.querySelector(".leiel-view");
      if (viewBtn) {
        const VIEW_ICON = { flat: "\u25A6", pods: "\u25A2", lines: "\u2261" };
        const paintView = () => {
          const v = state.view || "flat";
          viewBtn.innerHTML = `<span class="ic">${VIEW_ICON[v]}</span>` +
            `<span>${v}</span>`;
        };
        paintView();
        viewBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const i = VIEWS.indexOf(state.view || "flat");
          state.view = VIEWS[(i + 1) % VIEWS.length];
          paintView();
          renderPalette();
          save();
        });
      }

      const optsBtn = root.querySelector(".leiel-opts");
      if (optsBtn) {
        optsBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          state.showOpts = !state.showOpts;
          applyTucked();
          save();
        });
      }
      setTimeout(applyTucked, 0);

      /* A short guide: the things that cannot be worked out by looking at the
         node. Anything longer goes stale as the code moves on. */
      const HELP = `
        <h3>Visual Filename Manager</h3>
        <p>Builds the folder and file name for a render out of what this
        workflow is actually doing, so a picture can be traced back to the
        settings that made it.</p>

        <h5>Getting started</h5>
        <p>Drag a chip from the palette into <b>FOLDER</b> or <b>FILE</b>. The
        preview underneath is the name that will be written - what you see is
        what you get.</p>
        <p>Chips can be dragged to any position inside a box, or from one box
        to the other; a chip dropped outside the node is thrown away. The small
        arrows on a chip nudge it one place left or right, and <code>x</code>
        removes it.</p>

        <h5>What comes out</h5>
        <p>Four outputs. <b>filename_prefix</b> is folder and file name joined
        with a slash, and it is the one to wire into a save node: ComfyUI's own
        <code>filename_prefix</code> field takes a path, and the save node adds
        the counter and the extension. <b>folder</b> and <b>filename</b> are
        the same two pieces separately, for anything that wants them apart.
        <b>report</b> is the working: what each token resolved to, and which
        ones did not.</p>

        <h5>Where the chips come from</h5>
        <p>The palette is this workflow, scanned: every sampler, scheduler,
        seed, size and LoRA it can find. Press <b>ReScan</b> after changing the
        graph. A chip whose node has gone shows as unresolved, and
        <b>CLEAN</b> removes those - the number on it is how many it would
        take out.</p>
        <p>LoRA chips follow the loader's switches. Switch them all off and the
        LoRA chips go away, because there is nothing left to name.</p>

        <h5>Colours</h5>
        <p>In the palette a chip takes the colour of the <b>node it came
        from</b>, so one node's settings read as one group. Down in the two
        boxes there is no node left to name, so a chip is coloured by <b>what
        kind of value</b> it is instead - that is what the strip of swatches
        between them lists.</p>

        <h5>Values that only exist at run time</h5>
        <p><code>elapsed</code>, a randomly picked size, or anything fed into
        <code>text_1</code> onwards is read while the render happens, so the
        name is right even for values that did not exist when the queue was
        sent. One text socket is shown at a time: wire it and the next one
        appears, up to four.</p>

        <h5>Buttons</h5>
        <p><b>Tag</b> puts each numeric chip's own name in front of its value -
        <code>steps(8)</code> rather than <code>8</code>. <b>Save</b> keeps a
        layout you can come back to. <b>Settings</b> holds the separators and
        the length limit. The purple button cycles the palette between one
        loose pile, a box per node and a row per node. The search field filters
        the palette by option or node name.</p>

        <h5>Sizing</h5>
        <p>Drag the bar under the palette or under the two boxes to resize
        them, and the divider between the boxes to share the width. Double
        click the divider to even it out again.</p>
        <p>Hold <code>Shift</code> while dragging either bar and the palette
        and the boxes trade height with each other instead - what one gains the
        other gives up, and the node itself stays the size it is.</p>`;

      let helpBox = null;
      function closeHelp() {
        if (helpBox) { helpBox.remove(); helpBox = null; }
      }
      const helpBtn = root.querySelector(".leiel-help");
      if (helpBtn) {
        helpBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (helpBox) { closeHelp(); return; }
          const box = document.createElement("div");
          box.className = "leiel-help-box";
          box.innerHTML = HELP +
            '<div class="hc"><button class="leiel-btn hclose">Close</button></div>';
          const r = e.currentTarget.getBoundingClientRect();
          box.style.left = Math.max(8, Math.min(r.left - 240,
            window.innerWidth - 480)) + "px";
          document.body.appendChild(box);
          const h = box.getBoundingClientRect().height;
          box.style.top = (r.bottom + 6 + h < window.innerHeight)
            ? (r.bottom + 6) + "px"
            : Math.max(8, r.top - h - 6) + "px";
          helpBox = box;
          box.querySelector(".hclose").addEventListener("click", (ev) => {
            ev.stopPropagation();
            closeHelp();
          });
          for (const k of ["keydown", "keyup", "keypress", "pointerdown",
                           "mousedown", "wheel"]) {
            box.addEventListener(k, (ev) => ev.stopPropagation());
          }
        });
      }
      const prevRemoved = node.onRemoved;
      node.onRemoved = function () {
        closeHelp();
        closeGroup();
        if (prevRemoved) prevRemoved.apply(this, arguments);
      };

      /* ---- save / restore panel ---- */
      function openPanel() {
        if (root.querySelector(".leiel-panel")) return;
        const box = document.createElement("div");
        box.className = "leiel-panel";
        box.innerHTML = `
          <h5>LAYOUT SNAPSHOTS</h5>
          <div class="row">
            <input class="nm" placeholder="name this snapshot (optional)"
                   style="flex:1;background:#0d0d0d;border:1px solid #444;border-radius:4px;
                          color:#ddd;font-size:10px;padding:3px 5px;">
            <button class="leiel-btn keep">Save now</button>
          </div>
          <div class="list"></div>
          <h5>TEXT BACKUP</h5>
          <textarea class="ta" spellcheck="false"></textarea>
          <div class="row">
            <button class="leiel-btn exp">Copy current</button>
            <button class="leiel-btn imp">Load from text</button>
            <button class="leiel-btn cls" style="margin-left:auto">Close</button>
          </div>`;
        root.appendChild(box);
        for (const ev of ["pointerdown", "mousedown", "wheel", "contextmenu"]) {
          box.addEventListener(ev, e => e.stopPropagation());
        }
        box.querySelectorAll("input,textarea").forEach(el =>
          ["keydown", "keyup", "keypress"].forEach(k =>
            el.addEventListener(k, e => e.stopPropagation())));

        const list = box.querySelector(".list");
        const ta = box.querySelector(".ta");

        function paint() {
          const all = snapRead();
          list.innerHTML = "";
          if (!all.length) {
            list.innerHTML = `<span style="opacity:.4;padding:4px">no snapshots yet</span>`;
            return;
          }
          all.forEach((e, i) => {
            const row = document.createElement("div");
            row.className = "leiel-snap";
            row.innerHTML =
              `<span class="${e.label === "auto" ? "" : "tag"}">${escapeHtml(snapLabel(e))}</span>` +
              `<span class="del" title="Delete">&#10005;</span>`;
            row.addEventListener("click", () => {
              snapPush({ folder: state.folder, file: state.file }, "before restore");
              restoreFrom(JSON.parse(JSON.stringify(e.layout)), "restored from snapshot");
              paint();
            });
            row.querySelector(".del").addEventListener("click", ev => {
              ev.stopPropagation();
              const a = snapRead(); a.splice(i, 1); snapWrite(a); paint();
            });
            list.appendChild(row);
          });
        }
        paint();

        box.querySelector(".keep").addEventListener("click", () => {
          const nm = box.querySelector(".nm").value.trim();
          snapPush({ folder: state.folder, file: state.file }, nm || "saved");
          box.querySelector(".nm").value = "";
          paint();
        });
        box.querySelector(".exp").addEventListener("click", () => {
          ta.value = JSON.stringify({ folder: state.folder, file: state.file });
          ta.select();
          try { document.execCommand("copy"); } catch (e) { /* select is enough */ }
        });
        box.querySelector(".imp").addEventListener("click", () => {
          try {
            const p = JSON.parse(ta.value);
            if (!p.folder && !p.file) throw new Error("no layout");
            snapPush({ folder: state.folder, file: state.file }, "before import");
            restoreFrom(p, "imported from text");
            paint();
          } catch (e) {
            ta.value = "could not read that text - paste a layout exported from this panel";
          }
        });
        box.querySelector(".cls").addEventListener("click", () => box.remove());
      }
      root.querySelector(".leiel-save").addEventListener("click", openPanel);

      /* Drop chips that have no counterpart here - undoable from the SAVE panel.
         Two stages: the first pass spares chips whose node exists but is
         bypassed, since those are usually switched off on purpose. If only
         those are left, a second press removes them too.                   */
      let cleanArmed = false;
      root.querySelector(".leiel-clean").addEventListener("click", () => {
        const no = namesOnly();
        snapPush({ folder: state.folder, file: state.file }, "before cleanup");
        const keepBypassed = !cleanArmed;
        for (const z of ["folder", "file"]) {
          state[z] = state[z].filter(c => {
            if (z === "folder" && no && c.num) return true;   // intentional skip
            if (keepBypassed && chipBypassed(c)) return true;
            return previewChip(c, node, z, no) !== null;
          });
        }
        cleanArmed = false;
        touch();
        renderZones();
      });

      /* Arm the second stage when everything left is a bypassed chip. */
      function updateCleanButton(warn) {
        const cb = root.querySelector(".leiel-clean");
        if (!cb) return;
        if (!warn) {
          cb.style.display = "none";
          cleanArmed = false;
          return;
        }
        const no = namesOnly();
        let removable = 0;
        for (const z of ["folder", "file"]) {
          for (const c of state[z]) {
            if (z === "folder" && no && c.num) continue;
            if (previewChip(c, node, z, no) !== null) continue;
            if (!chipBypassed(c)) removable++;
          }
        }
        cleanArmed = (removable === 0);
        cb.style.display = "";
        cb.classList.toggle("armed", cleanArmed);
        cb.textContent = cleanArmed ? `CLEAN ${warn} !` : `CLEAN ${warn}`;
        cb.title = cleanArmed
          ? "Only bypassed chips are left - press again to remove those too"
          : "Remove chips that cannot resolve in this workflow";
      }

      root.querySelector(".leiel-refresh").addEventListener("click", refresh);
      STUDIO_NODES.set(String(node.id), refresh);   // backend push -> rescan
      search.addEventListener("input", renderPalette);
      search.addEventListener("keydown", e => e.stopPropagation());

      const w = node.addDOMWidget("leiel_ui", "div", root, { serialize: false });
      /* Always the floor, never the height it currently has. LiteGraph will
         not let a node be dragged below what a widget reports, so reporting
         the current height locks the node at its largest and it can never be
         made smaller again. The real height is applied to the element. */
      w.computeSize = function (width) {
        return [width, H_FLOOR];
      };
      node.size = [600, 580];

      function loadStored(info) {
        let raw = null;
        const lw = node.widgets?.find(x => x.name === "layout_json");
        if (lw?.value) raw = lw.value;
        if (!raw && info?.widgets_values) {
          const i = node.widgets?.findIndex(x => x.name === "layout_json");
          if (i >= 0 && typeof info.widgets_values[i] === "string") {
            raw = info.widgets_values[i];
          }
        }
        if (!raw) return false;
        try { return restoreFrom(JSON.parse(raw)); } catch (e) { return false; }
      }

      /* A socket opening or closing has to happen the moment a wire is made,
         not on the next 1.2s tick - waiting means dropping a link on text_1
         and then hunting for a text_2 that is not there yet. */
      const origConn = node.onConnectionsChange;
      node.onConnectionsChange = function (type, index, connected, link, ioSlot) {
        const r = origConn?.apply(this, arguments);
        /* after the graph has finished attaching the link, or the socket we
           are about to count is still the old one */
        setTimeout(() => {
          if (!node.graph) return;
          if (syncTextInputs() && ready) { catalog = scanGraph(node); renderPalette(); }
        }, 0);
        return r;
      };

      /* Fires on workflow load, paste and undo - the moments where the old
         code lost everything.                                             */
      const origConfigure = node.onConfigure;
      node.onConfigure = function (info) {
        const r = origConfigure?.apply(this, arguments);
        try { loadStored(info); } catch (e) { /* ignore */ }
        ready = true;
        setTimeout(refresh, 0);
        return r;
      };

      setTimeout(() => {
        if (!ready) { loadStored(); ready = true; }
        applyPalH();
        refresh();
      }, 60);

      let lastStyle = null;
      let lastLoraSig = null;
      const iv = setInterval(() => {
        if (!node.graph) { clearInterval(iv); STUDIO_NODES.delete(String(node.id)); return; }
        if (editing || !ready) return;
        /* a node added or removed anywhere in the workflow - checked first,
           because it changes what every other reading below is made of */
        const gsig = graphSignature();
        if (gsig !== lastGraphSig) {
          lastGraphSig = gsig;
          catalog = scanGraph(node);
          renderPalette();
          renderZones();
          return;
        }
        const st = namesOnly();
        if (st !== lastStyle) { lastStyle = st; renderZones(); return; }
        /* rebuild the palette when the enabled LoRAs change */
        const sig = JSON.stringify(collectLoras(node));
        if (sig !== lastLoraSig) {
          lastLoraSig = sig;
          catalog = scanGraph(node);
          renderPalette();
          renderZones();
          return;
        }
        renderPreview();
        save();
      }, 1200);

      /* make sure the snapshot is current at queue time */
      const origSerialize = node.onSerialize;
      node.onSerialize = function (o) {
        try {
          if (!ready) return origSerialize?.apply(this, arguments);
          save();
          const lw = node.widgets?.find(x => x.name === "layout_json");
          const i = node.widgets?.indexOf(lw);
          if (o?.widgets_values && i >= 0) o.widgets_values[i] = lw.value;
        } catch (e) { /* ignore */ }
        return origSerialize?.apply(this, arguments);
      };

      return this;
    };
  },
});
