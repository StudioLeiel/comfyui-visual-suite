"""
Studio Leiel - Filename Builder for ComfyUI
--------------------------------------------------
Core idea
  ComfyUI hands every node two hidden inputs:
    PROMPT        = {node_id: {"class_type": ..., "inputs": {widget_name: value}}}
    EXTRA_PNGINFO = {"workflow": {"nodes": [{"id":.., "title":.., "type":..}, ...]}}
  Together they let a single node look up "node title -> widget name -> value"
  for the entire graph, so no Widget To String wiring is needed.

Design rules
  1. Never raise. Always return a string, whatever happens - a crash here
     would mean a finished render that never gets saved.
  2. A token that cannot resolve disappears along with its [[ ... ]] group.
  3. Windows path length and illegal characters are handled automatically.
"""

import os
import re
import time
import datetime
import traceback

# ----------------------------------------------------------------------
# any type helper
# ----------------------------------------------------------------------
class _AnyType(str):
    def __ne__(self, other): return False
    def __eq__(self, other): return True
    def __hash__(self): return hash("*")

ANY = _AnyType("*")

# ----------------------------------------------------------------------
# Execution start time
# ----------------------------------------------------------------------
# The store lives on builtins so the Anchor and the Studio node share it even
# when this package gets imported twice (a stray single-file copy alongside the
# folder, for instance).
import builtins as _bi

_STORE = getattr(_bi, "_LEIEL_TIMER", None)
if _STORE is None:
    _STORE = {"t": None, "count": 0, "src": "-"}
    try:
        _bi._LEIEL_TIMER = _STORE
    except Exception:
        pass


def _mark_start(src):
    _STORE["t"] = time.perf_counter()
    _STORE["count"] += 1
    _STORE["src"] = src
    return _STORE["t"]


def _elapsed(prompt=None):
    if _STORE["t"] is None:
        return None
    e = time.perf_counter() - _STORE["t"]
    if e < 0 or e > 6 * 3600:
        return None
    return e


def _anchor_status():
    if _STORE["count"] == 0:
        return "no start time recorded - the execution hook could not be installed"
    e = _elapsed()
    if e is None:
        return f"start record is stale (source: {_STORE['src']})"
    return f"ok - {e:.1f}s since start (source: {_STORE['src']})"


def _install_exec_hook():
    """Capture the moment ComfyUI starts executing a prompt, so total workflow
       time works with no extra nodes."""
    try:
        import execution
        cls = getattr(execution, "PromptExecutor", None)
        if cls is None or getattr(cls, "_leiel_patched", False):
            return
        for meth in ("execute", "execute_async"):
            orig = getattr(cls, meth, None)
            if orig is None:
                continue

            def make(orig_fn):
                def patched(self, *a, **kw):
                    try:
                        _mark_start("prompt start (auto)")
                    except Exception:
                        pass
                    return orig_fn(self, *a, **kw)
                return patched

            setattr(cls, meth, make(orig))
        cls._leiel_patched = True
    except Exception:
        pass


_install_exec_hook()


# ----------------------------------------------------------------------
# sanitize
# ----------------------------------------------------------------------
_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_MULTI_SEP = re.compile(r'_{2,}')
_WS = re.compile(r'\s+')

_WIN_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def _clean_segment(s, escape_percent=True, repl="-"):
    s = _ILLEGAL.sub(repl, str(s))
    if escape_percent:
        # stop core or custom SaveImage nodes from re-substituting %...% patterns
        s = s.replace("%", "pct")
    s = _WS.sub(" ", s).strip()
    s = _MULTI_SEP.sub("_", s)
    s = s.strip(". ")            # Windows forbids trailing dots and spaces
    if s.upper() in _WIN_RESERVED:
        s = s + "_"
    return s


# ----------------------------------------------------------------------
# graph index
# ----------------------------------------------------------------------
def _build_index(prompt, extra_pnginfo):
    """Build the lookup index. Returns an empty one rather than failing."""
    idx = {"by_id": {}, "by_title": {}, "by_class": {}, "modes": {}}
    titles, order = {}, {}

    try:
        wf = (extra_pnginfo or {}).get("workflow") or {}
        for i, n in enumerate(wf.get("nodes") or []):
            nid = str(n.get("id"))
            t = n.get("title")
            if t:
                titles[nid] = str(t)
            order[nid] = i
            # 2 = mute, 4 = bypass - not part of the run
            try:
                idx["modes"][nid] = int(n.get("mode", 0) or 0)
            except Exception:
                pass
    except Exception:
        pass

    try:
        for nid, node in (prompt or {}).items():
            nid = str(nid)
            if not isinstance(node, dict):
                continue
            cls = str(node.get("class_type", "?"))
            entry = {
                "id": nid,
                "class": cls,
                "title": titles.get(nid, cls),
                "inputs": node.get("inputs") or {},
                "order": order.get(nid, 10 ** 6),
            }
            idx["by_id"][nid] = entry
            idx["by_title"].setdefault(entry["title"], []).append(entry)
            idx["by_class"].setdefault(cls, []).append(entry)
    except Exception:
        pass

    for bucket in ("by_title", "by_class"):
        for lst in idx[bucket].values():
            lst.sort(key=lambda e: e["order"])
    return idx


def _select(idx, selector):
    """selector: '#12' | '@ClassType' | 'Node Title'  (+ '[n]' 1-based)"""
    n = 1
    m = re.match(r"^(.*?)\[(\d+)\]$", selector.strip())
    if m:
        selector, n = m.group(1).strip(), int(m.group(2))

    if selector.startswith("#"):
        e = idx["by_id"].get(selector[1:].strip())
        return e

    if selector.startswith("@"):
        key = selector[1:].strip()
        lst = idx["by_class"].get(key)
        if lst is None:  # allow partial match
            lst = [e for c, v in idx["by_class"].items()
                   if key.lower() in c.lower() for e in v]
        return lst[n - 1] if lst and len(lst) >= n else None

    lst = idx["by_title"].get(selector)
    if lst is None:
        lst = [e for t, v in idx["by_title"].items()
               if selector.lower() == t.lower().strip() for e in v]
    if not lst:
        lst = [e for t, v in idx["by_title"].items()
               if selector.lower() in t.lower() for e in v]
    return lst[n - 1] if lst and len(lst) >= n else None


def _get_widget(idx, entry, widget, depth=0):
    """Read a widget value, following links upstream one hop at a time."""
    if entry is None:
        return None
    v = entry["inputs"].get(widget)
    if v is None:
        # retry ignoring case
        for k, vv in entry["inputs"].items():
            if k.lower() == str(widget).lower():
                v = vv
                break
    if v is None:
        return None
    if isinstance(v, list) and len(v) == 2 and depth < 4:
        up = idx["by_id"].get(str(v[0]))
        if up is None:
            return None
        for _, vv in up["inputs"].items():
            if not isinstance(vv, (list, dict)):
                return vv
        return None
    if isinstance(v, (list, dict)):
        return None
    return v


# ----------------------------------------------------------------------
# value formatting
# ----------------------------------------------------------------------
_MODEL_EXT = (".safetensors", ".ckpt", ".pt", ".sft", ".pth", ".bin", ".gguf")


def _fmt_num(x):
    try:
        f = float(x)
    except Exception:
        return str(x)
    if abs(f - round(f)) < 1e-9 and abs(f) < 1e15:
        return str(int(round(f)))
    return ("%.4f" % f).rstrip("0").rstrip(".")


def _auto_stem(v):
    if isinstance(v, str):
        low = v.lower()
        if low.endswith(_MODEL_EXT) or "/" in v or "\\" in v:
            v = os.path.basename(v.replace("\\", "/"))
            v = os.path.splitext(v)[0]
    return v


def _apply_spec(value, spec):
    if value is None:
        return None
    if not spec:
        value = _auto_stem(value)
        if isinstance(value, (int, float)):
            return _fmt_num(value)
        return str(value)

    s = spec.strip()
    if s == "raw":
        return str(value)
    if s == "stem":
        return str(_auto_stem(value))
    if s == "num":
        return _fmt_num(value)
    if s == "int":
        try:
            return str(int(round(float(value))))
        except Exception:
            return str(value)
    if s == "upper":
        return str(_auto_stem(value)).upper()
    if s == "lower":
        return str(_auto_stem(value)).lower()
    if s.startswith("cut"):  # cut12 -> first 12 characters
        try:
            return str(_auto_stem(value))[: int(s[3:])]
        except Exception:
            return str(_auto_stem(value))
    try:
        if re.search(r"[dfeg%]$", s):
            return format(float(value), s)
        return format(value, s)
    except Exception:
        return str(_auto_stem(value))


# ----------------------------------------------------------------------
# LoRA auto-collect
# ----------------------------------------------------------------------
_LORA_TAG = re.compile(
    r"<\s*lora\s*:\s*([^:>]+?)\s*:\s*([0-9.eE+-]+)(?:\s*:\s*[0-9.eE+-]+)?\s*>", re.I)


def _parse_lora_text(txt):
    """LoRA names arriving on a wire, in either shape they come in.

    '<lora:retrovintage:1.0> <lora:Elise_v2:0.95>' is what a prompt-style
    loader writes. 'canon1D(1.0), Elise_v2(0.9)' is what the Series Lab
    sends: the LoRAs of the render actually on its way out. A bare
    'canon1D, m87' with no strength also reads, and none is invented in that
    case - a chip asking for name(strength) prints just the name rather than
    a made-up 1.0.
    """
    out = []
    if not txt:
        return out
    try:
        text = str(txt)
        for m in _LORA_TAG.finditer(text):
            # keep the literal strength text so 1.0 stays 1.0
            out.append((_auto_stem(m.group(1).strip()), m.group(2).strip()))
        if out:
            return out
        # 'canon1D(1.0), Elise_v2(0.9)' - the Series Lab's shape. The bracket
        # is optional: a bare 'canon1D, m87' still reads, with no strength.
        for piece in re.split(r"[,\n]+", text):
            piece = piece.strip()
            if not piece:
                continue
            m = re.match(r"^(.*?)\(\s*([-\d.]+)\s*\)$", piece)
            if m:
                name = _auto_stem(m.group(1).strip())
                if name:
                    out.append((name, m.group(2).strip()))
                continue
            name = _auto_stem(piece)
            if name:
                out.append((name, ""))
    except Exception:
        pass
    return out


def _collect_loras(idx):
    out = []
    for cls, entries in idx["by_class"].items():
        cl = cls.lower()
        if "lora" not in cl:
            continue
        for e in entries:
            ins = e["inputs"]
            # 1) standard LoraLoader / LoraLoaderModelOnly
            name = ins.get("lora_name")
            if isinstance(name, str):
                st = ins.get("strength_model", ins.get("strength", 1.0))
                if isinstance(st, list):
                    st = 1.0
                out.append((e["order"], _auto_stem(name), _fmt_num(st)))
                continue
            # 2) dict-style widgets, e.g. rgthree Power Lora Loader
            for k, v in ins.items():
                if isinstance(v, dict) and "lora" in v:
                    if v.get("on") is False:
                        continue
                    st = v.get("strength", v.get("strengthTwo", 1.0))
                    out.append((e["order"], _auto_stem(str(v.get("lora"))), _fmt_num(st)))
    out.sort(key=lambda x: x[0])
    return [(n, s) for _, n, s in out]


# ----------------------------------------------------------------------
# template engine
# ----------------------------------------------------------------------
_TOKEN = re.compile(r"\{([^{}]*)\}")


def _resolve_token(body, idx, prompt, missing_log):
    body = body.strip()
    if not body:
        return None

    low = body.lower()

    # --- special tokens --------------------------------------------
    if low == "date" or low.startswith("date:"):
        fmt = body[5:] if ":" in body else "%Y-%m-%d"
        return datetime.datetime.now().strftime(fmt or "%Y-%m-%d")
    if low == "time" or low.startswith("time:"):
        fmt = body[5:] if ":" in body else "%H%M%S"
        return datetime.datetime.now().strftime(fmt or "%H%M%S")
    if low.startswith("elapsed"):
        e = _elapsed(prompt)
        if e is None:
            missing_log.append("elapsed (no start time recorded)")
            return None
        spec = body.split(":", 1)[1] if ":" in body else ".1f"
        try:
            return format(e, spec)
        except Exception:
            return "%.1f" % e
    if low.startswith("loras"):
        sep = body.split(":", 1)[1] if ":" in body else "_"
        loras = _collect_loras(idx)
        if not loras:
            missing_log.append("loras (no LoRA node, or all bypassed)")
            return None
        return sep.join(f"{n}({s})" for n, s in loras)
    if low.startswith("lora:"):  # {lora:1} - nth LoRA only
        try:
            n = int(body.split(":", 1)[1])
            loras = _collect_loras(idx)
            nm, st = loras[n - 1]
            return f"{nm}({st})"
        except Exception:
            missing_log.append(body)
            return None

    # --- {selector|widget|spec} -----------------------------------
    parts = [p.strip() for p in body.split("|")]
    if len(parts) < 2:
        missing_log.append(f"{body} (bad syntax: expected selector|widget)")
        return None
    selector, widget = parts[0], parts[1]
    spec = parts[2] if len(parts) > 2 else ""

    entry = _select(idx, selector)
    if entry is None:
        missing_log.append(f"{body} -> no node named '{selector}'")
        return None
    val = _get_widget(idx, entry, widget)
    if val is None:
        avail = ", ".join(list(entry["inputs"].keys())[:8])
        missing_log.append(f"{body} -> no widget '{widget}' (available: {avail})")
        return None
    return _apply_spec(val, spec)


def _render(template, idx, prompt, missing_log):
    """Resolve [[ ... ]] optional groups, then substitute tokens."""
    if not template:
        return ""

    def render_flat(text, optional):
        ok = [True]

        def sub(m):
            r = _resolve_token(m.group(1), idx, prompt, missing_log)
            if r is None:
                ok[0] = False
                return ""
            return r

        out = _TOKEN.sub(sub, text)
        if optional and not ok[0]:
            return ""
        return out

    result, i = [], 0
    while True:
        s = template.find("[[", i)
        if s < 0:
            result.append(render_flat(template[i:], False))
            break
        e = template.find("]]", s)
        if e < 0:
            result.append(render_flat(template[i:], False))
            break
        result.append(render_flat(template[i:s], False))
        result.append(render_flat(template[s + 2:e], True))
        i = e + 2
    return "".join(result)



def _find_entry(idx, chip):
    """Find a node by id, then title, then class, so chips survive a move."""
    nid = str(chip.get("id", ""))
    cls = chip.get("cls")
    title = chip.get("title")

    e = idx["by_id"].get(nid)
    if e is not None and (cls is None or e["class"] == cls):
        return e
    if title:
        lst = idx["by_title"].get(title)
        if lst:
            return lst[0]
    if cls:
        lst = idx["by_class"].get(cls)
        if lst:
            return lst[0]

    # Last resort: if exactly one node carries that widget name, use it.
    # Covers pasting the node into a workflow where every id differs.
    w = chip.get("widget")
    if w and w not in _GENERIC_WIDGETS:
        hits = [e for e in idx["by_id"].values() if w in (e["inputs"] or {})]
        if len(hits) == 1:
            return hits[0]
    return None


def _resolve_chip(chip, idx, prompt, missing, ext_loras=None, ext_texts=None):
    try:
        kind = chip.get("kind", "widget")
        fmt = chip.get("fmt", "") or ""
        pre = chip.get("pre", "") or ""
        suf = chip.get("suf", "") or ""

        if kind == "input":
            v = (ext_texts or {}).get(str(chip.get("n")))
            if not v:
                missing.append(f"{chip.get('label', 'input')} - nothing on that wire")
                return None
            return f"{pre}{v}{suf}"

        if kind == "text":
            t = f"{pre}{chip.get('text', '')}{suf}"
            return t if t else None

        if kind == "date":
            core = datetime.datetime.now().strftime(fmt or "%Y-%m-%d")
        elif kind == "time":
            core = datetime.datetime.now().strftime(fmt or "%H%M%S")
        elif kind == "elapsed":
            e = _elapsed(prompt)
            if e is None:
                missing.append("elapsed - " + _anchor_status())
                return None
            try:
                core = format(e, fmt or ".1f")
            except Exception:
                core = "%.1f" % e
        elif kind == "loras":
            loras = ext_loras or _collect_loras(idx)
            if not loras:
                missing.append("loras - no LoRA found (nodes missing/bypassed, lora_text empty)")
                return None
            sep = chip.get("sep", "_")
            if fmt == "name":
                core = sep.join(n for n, _ in loras)
            else:
                core = sep.join(f"{n}({s})" if str(s) != "" else n
                                for n, s in loras)
        elif kind == "lora":
            loras = ext_loras or _collect_loras(idx)
            n = int(chip.get("n", 1))
            if len(loras) < n:
                missing.append(f"lora{n} - not found (missing/bypassed)")
                return None
            nm, st = loras[n - 1]
            core = nm if (fmt == "name" or str(st) == "") else f"{nm}({st})"
        else:  # widget
            entry = _find_entry(idx, chip)
            if entry is None:
                missing.append(f"{chip.get('label', '?')} - node not found "
                               f"(id={chip.get('id')}, title={chip.get('title')})")
                return None
            val = _get_widget(idx, entry, chip.get("widget", ""))
            if val is None:
                missing.append(f"{chip.get('label', '?')} - widget "
                               f"'{chip.get('widget')}' not found")
                return None
            core = _apply_spec(val, fmt)

        if core is None or core == "":
            return None
        return f"{pre}{core}{suf}"
    except Exception:
        missing.append(f"{chip.get('label', '?')} - exception while resolving")
        return None


_LIVE_ONLY = ("elapsed", "date", "time", "input")

_PAREN_NUM = re.compile(r"\(\s*[-+0-9.eE]+\s*\)")


def _simplify_for_folder(s):
    """Folder form: lenovo_k(1.00) -> lenovo_k"""
    s = _PAREN_NUM.sub("", str(s))
    s = _MULTI_SEP.sub("_", s).strip("_- ")
    return s


def _resolve_zone(chips, idx, prompt, missing, sep, snap=None,
                  key_prefix="", snapshot_first=True, ext_loras=None,
                  simplify=False, ext_texts=None):
    """snapshot_first=True: prefer the value the UI computed, resolving on the
       server only when there is none. Time tokens are always computed here,
       since a stale snapshot would be wrong."""
    snap = snap or {}
    parts = []
    for i, c in enumerate(chips or []):
        kind = c.get("kind", "widget")
        key = f"{key_prefix}{i}"

        # a chip pointing at a bypassed node is dropped even if a snapshot exists
        if kind == "widget" and idx.get("modes", {}).get(str(c.get("id"))) in (2, 4):
            missing.append(f"{c.get('label', '?')} - node bypassed, omitted")
            continue

        if simplify:
            # folders drop numeric chips entirely and use LoRA names only
            if c.get("num"):
                continue
            if kind in ("lora", "loras"):
                c = dict(c)
                c["fmt"] = "name"
                c["pre"] = ""
                c["suf"] = ""
                snap = dict(snap)
                snap.pop(key, None)          # snapshot carries strengths, ignore it

        # lora_text is the source of truth, so it beats the snapshot
        if ext_loras and kind in ("lora", "loras"):
            r = _resolve_chip(c, idx, prompt, missing, ext_loras, ext_texts)
            if r:
                parts.append(_simplify_for_folder(r) if simplify else r)
            continue

        if snapshot_first and kind not in _LIVE_ONLY and key in snap:
            v = str(snap[key])
            if simplify:
                v = _simplify_for_folder(v)
            if v:
                parts.append(v)
                continue

        before = len(missing)
        r = _resolve_chip(c, idx, prompt, missing, ext_loras, ext_texts)
        if not r and kind not in _LIVE_ONLY and key in snap:
            r = str(snap[key])
            if len(missing) > before:
                missing[-1] += "  -> used UI snapshot value"
        if r:
            parts.append(_simplify_for_folder(r) if simplify else r)
    return sep.join(parts)


# ======================================================================
# NODE 4 : Visual Filename Manager - the drag and drop UI
# ======================================================================
class LeielFilenameStudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "layout_json": ("STRING", {"default": "", "multiline": False}),
                "folder_sep": ("STRING", {"default": "/"}),
                "file_sep": ("STRING", {"default": "_"}),
                "max_filename_chars": ("INT", {"default": 190, "min": 40, "max": 250}),
                "resolve_mode": (["ui_snapshot", "live_prompt"], {"default": "ui_snapshot"}),
                "folder_style": (["names_only", "as_is"], {"default": "names_only"}),
                "escape_percent": ("BOOLEAN", {"default": True}),
                "fallback_name": ("STRING", {"default": "LEIEL_FALLBACK"}),
            },
            "optional": {
                "run_after": (ANY, {}),
                # Takes either shape: prompt-style <lora:name:strength> tags,
                # or the plain "name, name" list the Series Lab sends.
                "lora_text": ("STRING", {"forceInput": True}),
                # Values that only exist while the graph runs - a randomly
                # chosen size, a computed label - cannot be read off the canvas:
                # the widget showing them is drawn after execution, so anything
                # reading the canvas is always one run behind. Wire them in.
                "text_1": ("STRING", {"forceInput": True}),
                "text_2": ("STRING", {"forceInput": True}),
                "text_3": ("STRING", {"forceInput": True}),
                "text_4": ("STRING", {"forceInput": True}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO",
                       "unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("filename_prefix", "folder", "filename", "report")
    FUNCTION = "build"
    CATEGORY = "Studio Leiel"
    DESCRIPTION = "Drag option chips to compose folder and file names"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def build(self, layout_json, folder_sep, file_sep, max_filename_chars,
              resolve_mode, folder_style, escape_percent, fallback_name,
              run_after=None, lora_text=None, prompt=None, extra_pnginfo=None,
              unique_id=None, **wired):
        import json
        try:
            idx = _build_index(prompt, extra_pnginfo)
            missing = []

            try:
                layout = json.loads(layout_json) if layout_json.strip() else {}
            except Exception:
                layout = {}
                missing.append("layout_json parse failed - rebuild it in the UI")

            ext_texts = {}
            for i in range(1, 5):
                v = wired.get(f"text_{i}")
                if v is not None and str(v).strip():
                    ext_texts[str(i)] = str(v).strip()

            ext_loras = _parse_lora_text(lora_text) if lora_text else None

            # Push the active LoRA list back to the browser so the palette
            # shows only what is switched on, and follows LoraManager changes.
            if ext_loras is not None or ext_texts:
                try:
                    from server import PromptServer
                    PromptServer.instance.send_sync("leiel.loras", {
                        "node": str(unique_id), "loras": ext_loras,
                        "texts": ext_texts,
                    })
                except Exception:
                    pass
            snapshot_first = (resolve_mode == "ui_snapshot")
            snap = layout.get("snap") or {}

            folder_raw = _resolve_zone(layout.get("folder"), idx, prompt, missing,
                                       folder_sep or "/", snap, "f",
                                       snapshot_first, ext_loras,
                                       simplify=(folder_style == "names_only"),
                                       ext_texts=ext_texts)
            file_raw = _resolve_zone(layout.get("file"), idx, prompt, missing,
                                     file_sep or "_", snap, "n",
                                     snapshot_first, ext_loras, simplify=False,
                                     ext_texts=ext_texts)

            segs = [_clean_segment(s, escape_percent)
                    for s in folder_raw.split("/") if s.strip()]
            folder = "/".join([s for s in segs if s])

            filename = _clean_segment(file_raw.replace("/", "-"), escape_percent)
            if not filename:
                filename = (fallback_name or "LEIEL") + \
                    datetime.datetime.now().strftime("_%H%M%S")
            if len(filename) > max_filename_chars:
                filename = filename[:max_filename_chars].rstrip("_-. ") + "~"

            prefix = f"{folder}/{filename}" if folder else filename

            report = ["[Leiel Filename Studio]",
                      f"  mode     : {resolve_mode} / folder={folder_style}",
                      f"  folder   : {folder}",
                      f"  filename : {filename}",
                      f"  chars    : {len(filename)}",
                      f"  prefix   : {prefix}"]
            if any(c.get("kind") == "elapsed"
                   for c in (layout.get("file") or []) + (layout.get("folder") or [])):
                report.append("  timer    : " + _anchor_status())
                if run_after is None:
                    report.append("  ! run_after is not connected - this node may "
                                  "run before sampling, giving a near-zero time")
            if ext_loras:
                report.append("  lora_text: " +
                              ", ".join(f"{n}({s})" for n, s in ext_loras))
            if missing:
                report.append("  -- notes --")
                report += [f"     ! {m}" for m in missing]
            else:
                report.append("  all chips resolved")
            return (prefix, folder, filename, "\n".join(report))

        except Exception:
            stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
            fb = fallback_name or "LEIEL_FALLBACK"
            return (f"{fb}/{stamp}", fb, stamp,
                    "[Leiel Filename Studio] internal error - fallback used\n"
                    + traceback.format_exc())


NODE_CLASS_MAPPINGS = {
    "LeielFilenameStudio": LeielFilenameStudio,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    # Display names only. Changing the keys would break saved workflows.
    "LeielFilenameStudio": "Visual Filename Manager (Studio Leiel)",
}
