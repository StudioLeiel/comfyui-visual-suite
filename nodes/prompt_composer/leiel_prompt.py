"""
Studio Leiel - Visual Prompt Composer for ComfyUI

One node holding several labelled prompt sections instead of a chain of text
nodes feeding a concatenator.

The whole layout (titles, text, on/off, box heights, slot numbers) lives in a
single hidden STRING widget, so it travels with the workflow like any other
widget value. The frontend owns the editing; this file only assembles the
final strings.

Design rules
  1. Never raise. A prompt node that throws would stop a render before it
     starts, so every path returns strings.
  2. External inputs are bound to a section's stable slot number, never to its
     position, so reordering or deleting sections cannot rewire existing links.
"""

import json
import os
import traceback

MAX_SLOTS = 8

SEPARATORS = {
    "blank_line": "\n\n",
    "newline": "\n",
    "space": " ",
    "comma": ", ",
}

LABEL_STYLES = [
    "banner", "rule", "bracket",
    "title_block", "upper_block", "title_inline", "slash",
]


def _clean(t):
    if t is None:
        return ""
    return str(t).replace("\r\n", "\n").strip()


def _apply_external(text, ext, mode):
    """How a connected input combines with what is typed in the box."""
    ext = _clean(ext)
    if not ext:
        return text
    if mode == "append":
        return (text + "\n" + ext).strip() if text else ext
    if mode == "prepend":
        return (ext + "\n" + text).strip() if text else ext
    return ext                      # "replace" - the default


def _build_rules(find_text, replace_text):
    """Replacement rules from the connected inputs.

    One pair:      find_text = "Elise Vasseur", replace_text = "Sofia Marchetti"
    Several pairs: find_text = "Elise=>Sofia\nink-black=>chestnut"  (one per line)
    The arrow form wins when it is present, so a list can arrive down a single
    wire from any text node.
    """
    rules = []
    ft = _clean(find_text)
    if not ft:
        return rules
    if "=>" in ft:
        for line in ft.split("\n"):
            if "=>" not in line:
                continue
            a, b = line.split("=>", 1)
            a = a.strip()
            if a:
                rules.append((a, b.strip()))
    else:
        rules.append((ft, _clean(replace_text)))
    return rules


def _apply_rules(text, rules):
    for a, b in rules:
        if a:
            text = text.replace(a, b)
    return text


def _label(title, body, style):
    title = title.strip() or "section"
    up = title.upper()
    if style == "banner":
        return f"===== {up} =====\n{body}"
    if style == "rule":
        return f"{up}\n{'-' * max(8, len(up))}\n{body}"
    if style == "bracket":
        return f"[ {up} ]\n{body}"
    if style == "title_block":
        return f"{title}\n{body}"
    if style == "upper_block":
        return f"{up}\n{body}"
    if style == "title_inline":
        return f"{title}: {body}"
    return f"{title} {body}"        # "slash" - joined with " / " later


class LeielPromptComposer:
    @classmethod
    def INPUT_TYPES(cls):
        opt = {
            f"ext_{i}": ("STRING", {"forceInput": True})
            for i in range(1, MAX_SLOTS + 1)
        }
        opt["find_text"] = ("STRING", {"forceInput": True})
        opt["replace_text"] = ("STRING", {"forceInput": True})
        return {
            "required": {
                "layout_json": ("STRING", {"default": "", "multiline": False}),
                # names say which output each one shapes
                "prompt_separator": (list(SEPARATORS.keys()), {"default": "blank_line"}),
                "labeled_style": (LABEL_STYLES, {"default": "banner"}),
                "skip_empty": ("BOOLEAN", {"default": True}),
            },
            "optional": opt,
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    # Per-section outputs are bound to a section's stable slot number, never to
    # its position, so reordering or deleting sections cannot rewire anything.
    RETURN_TYPES = ("STRING", "STRING") + ("STRING",) * MAX_SLOTS
    RETURN_NAMES = ("all prompt", "labeled prompt") + tuple(
        f"out_{i}" for i in range(1, MAX_SLOTS + 1))
    FUNCTION = "compose"
    CATEGORY = "Studio Leiel"
    DESCRIPTION = "Compose a prompt from labelled sections in one node"

    def compose(self, layout_json, prompt_separator, labeled_style, skip_empty,
                unique_id=None, **kw):
        separator, label_style = prompt_separator, labeled_style
        try:
            try:
                layout = json.loads(layout_json) if layout_json.strip() else {}
            except Exception:
                layout = {}

            sections = layout.get("sections") or []
            sep = SEPARATORS.get(separator, "\n\n")
            rules = _build_rules(kw.get("find_text"), kw.get("replace_text"))

            plain, labelled = [], []
            per_slot = {}
            for s in sections:
                if not s.get("on", True):
                    continue
                slot = s.get("slot")
                ext = kw.get(f"ext_{slot}") if slot else None
                body = _apply_external(_clean(s.get("text")), ext,
                                       s.get("extMode", "replace"))
                if rules:
                    body = _apply_rules(body, rules)
                if skip_empty and not body:
                    continue
                if slot:
                    per_slot[str(slot)] = body
                plain.append(body)
                labelled.append(_label(str(s.get("title", "")), body, label_style))

            joined = sep.join(p for p in plain if p)
            lab_sep = " / " if label_style == "slash" else "\n\n"
            joined_lab = lab_sep.join(l for l in labelled if l)
            # Send whatever arrived on the wires back to the browser, so each
            # section can show the text it is actually being fed.
            try:
                wired = {}
                for i in range(1, MAX_SLOTS + 1):
                    v = kw.get(f"ext_{i}")
                    if v is not None and str(v).strip():
                        wired[str(i)] = str(v)
                from server import PromptServer
                PromptServer.instance.send_sync("leiel.vpc.ext", {
                    "node": str(unique_id), "ext": wired,
                })
            except Exception:
                pass

            outs = tuple(per_slot.get(str(i), "") for i in range(1, MAX_SLOTS + 1))
            return (joined, joined_lab) + outs

        except Exception:
            # A prompt must still come out, or the render never happens.
            print("[Leiel Prompt Composer] " + traceback.format_exc())
            return ("", "") + ("",) * MAX_SLOTS


# --------------------------------------------------------------------------
# the preset library
#
# Presets used to live in the browser, which meant clearing site data threw
# away every anchor the user had ever saved and moving to another browser
# started from nothing. They belong on the machine: a plain JSON file in
# ComfyUI's own user directory, where updating or reinstalling this node
# cannot touch it either.
# --------------------------------------------------------------------------

PRESET_DIRNAME = "visual_prompt_composer"
PRESET_FILENAME = "presets.json"
SNAPSHOT_FILENAME = "snapshots.json"
# Automatic snapshots rotate; the ones the user named have their own room and
# are never dropped to make space for a record nobody asked for.
SNAPSHOT_AUTO_MAX = 25
SNAPSHOT_KEEP_MAX = 200
SNAPSHOT_BYTES_MAX = 4000000
# Matches the cap the frontend enforces. The frontend refuses to grow the
# library past this and says so; this is the backstop for anything else that
# posts to the route.
PRESET_MAX = 2000
PRESET_TEXT_MAX = 200000


def _user_file(filename):
    """A file in ComfyUI's user directory, creating the folder on first use."""
    beside_node = os.path.join(os.path.dirname(__file__), filename)
    try:
        import folder_paths
    except Exception:                                # pragma: no cover
        return beside_node

    base = None
    getter = getattr(folder_paths, "get_user_directory", None)
    if callable(getter):
        try:
            base = getter()
        except Exception:
            base = None
    if not base:
        root = getattr(folder_paths, "base_path", None)
        if root:
            base = os.path.join(str(root), "user")
    if not base:
        return beside_node

    folder = os.path.join(str(base), PRESET_DIRNAME)
    try:
        os.makedirs(folder, exist_ok=True)
    except Exception:                                # pragma: no cover
        return beside_node
    return os.path.join(folder, filename)


def _presets_path():
    return _user_file(PRESET_FILENAME)


def _snapshots_path():
    return _user_file(SNAPSHOT_FILENAME)


def _write_json(path, doc):
    """Atomically, so a half-written file can never replace a good one."""
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def _read_json_list(path, key):
    if not os.path.isfile(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return []
    if isinstance(data, dict):
        data = data.get(key, [])
    return data if isinstance(data, list) else []


def _sanitize_snapshots(data):
    """Keep the list to well-formed snapshots.

    A snapshot is a labelled copy of the sections. The two kinds are counted
    separately: automatic ones rotate, and the ones the user named are held
    to their own limit so an automatic record can never push one out.
    """
    keeps, autos = [], []
    for raw in data:
        if not isinstance(raw, dict):
            continue
        sections = raw.get("sections")
        if not isinstance(sections, list) or not sections:
            continue
        if len(sections) > MAX_SLOTS * 4:
            continue
        if not all(isinstance(x, dict) for x in sections):
            continue
        label = str(raw.get("label", "auto"))[:200]
        kind = "keep" if raw.get("kind") == "keep" else "auto"
        try:
            stamp = int(raw.get("t", 0))
        except Exception:
            stamp = 0
        entry = {"t": stamp, "label": label, "kind": kind, "sections": sections}
        try:
            if len(json.dumps(entry)) > SNAPSHOT_BYTES_MAX:
                continue
        except Exception:
            continue
        bucket = keeps if kind == "keep" else autos
        if len(bucket) >= (SNAPSHOT_KEEP_MAX if kind == "keep"
                           else SNAPSHOT_AUTO_MAX):
            continue
        bucket.append(entry)
    out = keeps + autos
    out.sort(key=lambda e: e["t"], reverse=True)
    return out


def _load_snapshots():
    return _sanitize_snapshots(_read_json_list(_snapshots_path(), "snapshots"))


def _store_snapshots(data):
    clean = _sanitize_snapshots(data)
    _write_json(_snapshots_path(),
                {"format": "leiel.vpc.snapshots", "version": 1,
                 "snapshots": clean})
    return clean


def _sanitize_presets(data):
    """Keep the list to well-formed entries.

    A preset is four fields and nothing else. Anything unrecognised is
    dropped rather than written back out, so the file cannot be used to park
    arbitrary content, and an entry with no name or no body is not a preset
    the user could ever pick.
    """
    out = []
    seen = set()
    for raw in data:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name", "")).strip()
        text = raw.get("text", "")
        if not isinstance(text, str) or not name or not text.strip():
            continue
        if len(name) > 200 or len(text) > PRESET_TEXT_MAX:
            continue
        kind = str(raw.get("kind", "")).strip().lower()
        if len(kind) > 200:
            continue
        try:
            stamp = int(raw.get("t", 0))
        except Exception:
            stamp = 0
        key = (kind, name)
        if key in seen:
            continue
        seen.add(key)
        out.append({"kind": kind, "name": name, "text": text, "t": stamp})
        if len(out) >= PRESET_MAX:
            break                                # backstop, never reached in
                                                 # normal use: the panel
                                                 # refuses before this
    return out


def _load_presets():
    return _sanitize_presets(_read_json_list(_presets_path(), "presets"))


def _store_presets(data):
    """Write the library atomically and return what was written."""
    clean = _sanitize_presets(data)
    _write_json(_presets_path(),
                {"format": "leiel.vpc.presets", "version": 1, "presets": clean})
    return clean


def _register_routes():
    try:
        import server
        from aiohttp import web
    except Exception:                                # pragma: no cover
        return

    instance = getattr(server.PromptServer, "instance", None)
    if instance is None or getattr(instance, "routes", None) is None:
        return
    routes = instance.routes

    @routes.get("/leiel_vpc/presets")
    async def _get_presets(request):
        try:
            return web.json_response(_load_presets())
        except Exception as exc:
            return web.json_response([], headers={"X-VPC-Presets-Error": str(exc)})

    @routes.get("/leiel_vpc/snapshots")
    async def _get_snapshots(request):
        try:
            return web.json_response(_load_snapshots())
        except Exception as exc:
            return web.json_response([], headers={"X-VPC-Snapshots-Error": str(exc)})

    @routes.post("/leiel_vpc/snapshots")
    async def _save_snapshots(request):
        try:
            data = await request.json()
            if isinstance(data, dict):
                data = data.get("snapshots", None)
            if not isinstance(data, list):
                return web.json_response(
                    {"ok": False, "error": "snapshots must be a list"}, status=400)
            clean = _store_snapshots(data)
            return web.json_response({"ok": True, "snapshots": clean})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=500)

    @routes.post("/leiel_vpc/presets")
    async def _save_presets(request):
        try:
            data = await request.json()
            if isinstance(data, dict):
                data = data.get("presets", None)
            if not isinstance(data, list):
                return web.json_response(
                    {"ok": False, "error": "presets must be a list"}, status=400)
            clean = _store_presets(data)
            return web.json_response({"ok": True, "presets": clean})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=500)


_register_routes()


NODE_CLASS_MAPPINGS = {
    "LeielPromptComposer": LeielPromptComposer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    # Display name only. Changing the key would break saved workflows.
    "LeielPromptComposer": "Visual Prompt Composer (Studio Leiel)",
}
