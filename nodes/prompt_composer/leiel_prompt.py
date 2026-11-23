# Copyright 2026 Studio Leiel
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

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
import re
import shutil
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
# the Series Book
#
# A whole series in one node. Each anchor is kept once, as a capsule, and a
# prompt is a list of capsules - so the Subject shared by ten scenes is one
# piece of text rather than ten copies of it. The frontend owns the editing,
# exactly as with the Composer; this only assembles every prompt.
#
# What leaves the node is the series itself, on one wire, for the Series Lab
# to put on its shelf: one chip per prompt, picked per recipe.
# --------------------------------------------------------------------------

SERIES_TYPE = "LEIEL_SERIES"


def _assemble(sections, separator, label_style, skip_empty, rules):
    """One prompt from its sections: the plain text and the labelled one."""
    sep = SEPARATORS.get(separator, "\n\n")
    plain, labelled = [], []
    for s in sections:
        if not isinstance(s, dict) or not s.get("on", True):
            continue
        body = _clean(s.get("text"))
        if rules:
            body = _apply_rules(body, rules)
        if skip_empty and not body:
            continue
        plain.append(body)
        labelled.append(_label(str(s.get("title", "")), body, label_style))
    joined = sep.join(p for p in plain if p)
    lab_sep = " / " if label_style == "slash" else "\n\n"
    return joined, lab_sep.join(l for l in labelled if l)


def _book_prompts(layout):
    """Every prompt in a stored book, as (id, name, sections, capsule ids)."""
    book = layout.get("book") if isinstance(layout, dict) else None
    if not isinstance(book, dict):
        return []
    caps = book.get("caps") or {}
    if not isinstance(caps, dict):
        return []
    out = []
    for p in book.get("prompts") or []:
        if not isinstance(p, dict):
            continue
        secs, ids = [], []
        for cid in p.get("caps") or []:
            cap = caps.get(str(cid))
            if isinstance(cap, dict) and isinstance(cap.get("sec"), dict):
                secs.append(cap["sec"])
                ids.append(str(cid))
        try:
            pid = int(p.get("id"))
        except (TypeError, ValueError):
            continue
        out.append((pid, str(p.get("name") or "Prompt"), secs, ids))
    return out


def _body(sec, rules):
    """One section's text as it goes out, or None when it is switched off."""
    if not isinstance(sec, dict) or not sec.get("on", True):
        return None
    body = _clean(sec.get("text"))
    if rules:
        body = _apply_rules(body, rules)
    return body


# The labelled prompt of a Book prompt is written in the very form a reply
# is pasted in: the prompt's name in bold, then each anchor under its label
# and its capsule's name. Copied out, it pastes straight back into a Book,
# and read by a person - or a chat - every part says what it is.
_REPLY_WORD = {"trigger": "LORA TRIGGER", "quality": "QUALITY", "subject": "SUBJECT",
               "outfit": "OUTFIT",
               "pose": "POSE", "scene": "SCENE", "camera": "CAMERA", "absolute": "ABSOLUTE"}


def _reply_labeled(name, secs, ids, raw_caps, rules):
    out = [f"**{name.strip() or 'Prompt'}**"]
    for sec, cid in zip(secs, ids):
        body = _body(sec, rules)
        if not body:
            continue
        cap = raw_caps.get(cid) if isinstance(raw_caps, dict) else None
        cap = cap if isinstance(cap, dict) else {}
        kind = str(cap.get("kind") or "")
        word = _REPLY_WORD.get(kind) or (str(sec.get("title") or "section").strip().upper())
        cname = str(cap.get("name") or "").strip()
        out.append(f"{word} \u00b7 {cname}\n{body}" if cname else f"{word}\n{body}")
    return "\n\n".join(out)


class LeielSeriesBook:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "layout_json": ("STRING", {"default": "", "multiline": False}),
            },
        }

    # The Composer's joining options are fixed here: sections joined by a
    # blank line, labelled with a banner, empty ones left out.
    SEPARATOR = "blank_line"
    LABEL_STYLE = "banner"
    SKIP_EMPTY = True

    RETURN_TYPES = (SERIES_TYPE, "STRING", "STRING")
    # "current": the prompt open in the book when the run is queued. Inside
    # the book it is the open prompt; outside, current reads at a glance.
    RETURN_NAMES = ("series", "current prompt", "current labeled prompt")
    FUNCTION = "compose"
    CATEGORY = "Studio Leiel"
    DESCRIPTION = ("Keep a whole series of prompts in one node, built from "
                   "shared anchor capsules, and send it to the Series Lab")

    def compose(self, layout_json, **_old):
        prompt_separator, labeled_style, skip_empty = (self.SEPARATOR, self.LABEL_STYLE,
                                                       self.SKIP_EMPTY)
        try:
            try:
                layout = json.loads(layout_json) if layout_json.strip() else {}
            except Exception:
                layout = {}
            rules = None          # find and replace live on the Composer only
            book = layout.get("book") if isinstance(layout, dict) else None
            raw_caps = (book or {}).get("caps") or {}
            prompts = []
            for pid, name, secs, ids in _book_prompts(layout):
                text, _banner = _assemble(secs, prompt_separator, labeled_style,
                                          skip_empty, rules)
                labelled = _reply_labeled(name, secs, ids, raw_caps, rules)
                # The parts, so a Series Lab capsule sweep can put a different
                # capsule in one place and join the rest exactly as here.
                parts = [{"cap": cid,
                          "kind": str((raw_caps.get(cid) or {}).get("kind") or ""),
                          "body": _body(sec, rules)}
                         for sec, cid in zip(secs, ids)]
                prompts.append({"id": pid, "name": name, "text": text,
                                "labeled": labelled, "parts": parts})
            caps_out = {}
            if isinstance(raw_caps, dict):
                for cid, cap in raw_caps.items():
                    if not isinstance(cap, dict):
                        continue
                    caps_out[str(cid)] = {
                        "kind": str(cap.get("kind") or ""),
                        "name": str(cap.get("name") or ""),
                        "body": _body(cap.get("sec"), rules),
                    }
            try:
                active = int((layout.get("book") or {}).get("active") or 0)
            except (TypeError, ValueError, AttributeError):
                active = 0
            open_one = next((p for p in prompts if p["id"] == active),
                            prompts[0] if prompts else None)
            series = {"prompts": prompts, "caps": caps_out,
                      "sep": SEPARATORS.get(prompt_separator, "\n\n"),
                      "skip_empty": bool(skip_empty)}
            if not open_one:
                return (series, "", "")
            return (series, open_one["text"], open_one["labeled"])
        except Exception:
            print("[Leiel Series Book] " + traceback.format_exc())
            return ({"prompts": []}, "", "")


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
# Short pieces of writing that go INTO a section rather than over it. The
# reader describes what a photograph shows; a shot size it failed to name, a
# film stock, a time of day it could not know - those are added by hand, and
# after the third time of typing one out it belongs in a library.
#
# Two copies, and the difference matters. The pack ships a starting set so the
# node is useful on the first run and so the set travels with a release. That
# file is overwritten by the next release, so it is never the live one: the
# first time the library is read it is copied into the user folder, and from
# then on only the copy is read or written. Edits survive an update, and a
# deletion stays deleted instead of coming back with the next version.
SNIPPET_FILENAME = "snippets.json"
SNIPPET_MAX = 400
SNIPPET_TEXT_MAX = 20000
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


def _snippets_path():
    return _user_file(SNIPPET_FILENAME)


def _pack_snippets_path():
    """The shipped starting set, at the root of the pack."""
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(os.path.dirname(here)),
                        SNIPPET_FILENAME)


def _sanitize_snippets(data):
    """Drop anything malformed rather than hand it to the browser."""
    out = []
    seen = set()
    for raw in data:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name", "")).strip()
        text = raw.get("text", "")
        kind = str(raw.get("kind", "")).strip().lower()
        # Snippets in the same group answer the same question - one shot size,
        # one lens, one time of day - so a new one takes the old one's place
        # instead of arguing with it. An empty group simply stacks.
        group = str(raw.get("group", "")).strip().lower()[:80]
        if not isinstance(text, str) or not name or not text.strip():
            continue
        if len(name) > 200 or len(text) > SNIPPET_TEXT_MAX or len(kind) > 80:
            continue
        key = (kind, name)
        if key in seen:
            continue
        seen.add(key)
        out.append({"kind": kind, "group": group, "name": name, "text": text})
        if len(out) >= SNIPPET_MAX:
            break
    return out


# Shelves that arrived after a user copy may already exist. The copy is only
# seeded once, so a shelf added in a later release would never reach anyone
# who installed before it. Each one listed here is offered once: the shipped
# phrases for it are added to the user copy, the file remembers that it was
# done, and from then on that shelf is the user's like every other - deleting
# its phrases does not bring them back.
LATE_KINDS = ("pose",)


def _seed_late_kinds(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except Exception:
        return
    if not isinstance(doc, dict):
        doc = {"format": "leiel.vpc.snippets", "version": 1,
               "snippets": doc if isinstance(doc, list) else []}
    done = doc.get("seeded_kinds")
    done = [str(k) for k in done] if isinstance(done, list) else []
    todo = [k for k in LATE_KINDS if k not in done]
    if not todo:
        return
    current = doc.get("snippets") if isinstance(doc.get("snippets"), list) else []
    have = {(str(x.get("kind", "")).lower(), str(x.get("name", "")))
            for x in current if isinstance(x, dict)}
    shipped = _sanitize_snippets(
        _read_json_list(_pack_snippets_path(), "snippets"))
    for entry in shipped:
        if entry["kind"] in todo and (entry["kind"], entry["name"]) not in have:
            current.append(entry)
    doc["snippets"] = _sanitize_snippets(current)
    doc["seeded_kinds"] = done + todo
    try:
        _write_json(path, doc)
    except Exception:
        pass


def _load_snippets():
    """Read the user copy, seeding it from the pack on the first run."""
    path = _snippets_path()
    if os.path.exists(path):
        _seed_late_kinds(path)
    if not os.path.exists(path):
        seed = _sanitize_snippets(
            _read_json_list(_pack_snippets_path(), "snippets"))
        if seed:
            try:
                _write_json(path, {"format": "leiel.vpc.snippets",
                                   "version": 1, "snippets": seed,
                                   "seeded_kinds": list(LATE_KINDS)})
            except Exception:
                pass          # read-only user folder: serve them anyway
        return seed
    return _sanitize_snippets(_read_json_list(path, "snippets"))


def _store_snippets(data):
    clean = _sanitize_snippets(data)
    path = _snippets_path()
    seeded = []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            old = json.load(fh)
        if isinstance(old, dict) and isinstance(old.get("seeded_kinds"), list):
            seeded = old["seeded_kinds"]
    except Exception:
        pass
    doc = {"format": "leiel.vpc.snippets", "version": 1, "snippets": clean}
    if seeded:
        doc["seeded_kinds"] = seeded
    _write_json(path, doc)
    return clean


def _load_presets():
    return _sanitize_presets(_read_json_list(_presets_path(), "presets"))


def _store_presets(data):
    """Write the library atomically and return what was written."""
    clean = _sanitize_presets(data)
    _write_json(_presets_path(),
                {"format": "leiel.vpc.presets", "version": 1, "presets": clean})
    return clean


# --------------------------------------------------------------------------
# the Series Book's series files
#
# Every series in a Series Book is written to its own file in the user folder
# as it is worked on, one file per series, named by an id that never changes.
# A series can then be taken out of the book and brought back later exactly
# as it was - a finished series is kept as it stood, and a capsule edited in
# a newer one can never reach back and change it.
# --------------------------------------------------------------------------

SERIES_DIRNAME = "series"
BOOKS_DIRNAME = "books"
BOOK_HOME = "visual_series_book"
SERIES_BYTES_MAX = 8000000
BOOK_BYTES_MAX = 40000000
_SERIES_UID = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
_moved = {"done": False}


def _book_home():
    """user/visual_series_book - the Series Book's own folder, beside the
    Prompt Composer's."""
    composer = os.path.dirname(_user_file(PRESET_FILENAME))
    home = os.path.join(os.path.dirname(composer), BOOK_HOME)
    os.makedirs(home, exist_ok=True)
    return home


def _series_dir():
    folder = os.path.join(_book_home(), SERIES_DIRNAME)
    os.makedirs(folder, exist_ok=True)
    # series files written before the book had a folder of its own are
    # copied across once; the old copies are left where they were
    if not _moved["done"]:
        _moved["done"] = True
        old = os.path.join(os.path.dirname(_user_file(PRESET_FILENAME)), SERIES_DIRNAME)
        if os.path.isdir(old):
            for fn in os.listdir(old):
                src, dst = os.path.join(old, fn), os.path.join(folder, fn)
                if fn.endswith(".json") and not os.path.exists(dst):
                    try:
                        shutil.copy2(src, dst)
                    except Exception:
                        pass
    return folder


def _books_dir():
    folder = os.path.join(_book_home(), BOOKS_DIRNAME)
    os.makedirs(folder, exist_ok=True)
    return folder


def _book_name(name):
    """A book file's name: what was typed, kept readable, made safe."""
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", str(name or "")).strip(" .")
    name = re.sub(r"\s+", " ", name)[:120]
    if not name:
        raise ValueError("no name")
    return name


def _book_path(name):
    return os.path.join(_books_dir(), _book_name(name) + ".json")


def _is_pic(v):
    return isinstance(v, str) and v.startswith("data:image/") and "," in v


def _pic_bytes(v):
    """A small picture kept inside a file as a data URL, as bytes and type."""
    if not _is_pic(v):
        return None, None
    import base64
    head, data = v.split(",", 1)
    ctype = head[5:].split(";")[0] or "image/jpeg"
    try:
        return base64.b64decode(data), ctype
    except Exception:
        return None, None


def _file_pic(book=None, uid=None):
    """The picture of a book file (its first series that has one) or of a
    series file."""
    try:
        if uid:
            with open(_series_path(uid), "r", encoding="utf-8") as fh:
                doc = json.load(fh)
            return _pic_bytes((doc.get("group") or {}).get("thumb"))
        if book:
            with open(_book_path(book), "r", encoding="utf-8") as fh:
                doc = json.load(fh)
            for g in (((doc.get("doc") or {}).get("book") or {}).get("groups") or []):
                if isinstance(g, dict) and _is_pic(g.get("thumb")):
                    return _pic_bytes(g["thumb"])
    except Exception:
        pass
    return None, None


def _list_books():
    out = []
    folder = _books_dir()
    for fn in os.listdir(folder):
        if not fn.endswith(".json"):
            continue
        path = os.path.join(folder, fn)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                doc = json.load(fh)
            book = ((doc.get("doc") or {}).get("book") or {})
            out.append({
                "name": fn[:-5],
                "series": doc.get("series") or [],
                # each series' note, for the hover card in the Files panel
                "notes": [{"name": str(g.get("name") or ""), "note": str(g.get("note") or "")[:4000]}
                          for g in (book.get("groups") or []) if isinstance(g, dict)],
                "prompts": len(book.get("prompts") or []),
                "saved": doc.get("saved") or os.path.getmtime(path) * 1000,
                # a series of it has a picture - served by /leiel_vpc/file_thumb
                "thumb": any(isinstance(g, dict) and _is_pic(g.get("thumb"))
                             for g in (book.get("groups") or [])),
            })
        except Exception:
            continue
    out.sort(key=lambda x: -float(x.get("saved") or 0))
    return out


def _series_path(uid):
    if not isinstance(uid, str) or not _SERIES_UID.match(uid):
        raise ValueError("bad series id")
    return os.path.join(_series_dir(), uid + ".json")


def _series_empty(doc):
    """Nothing written in it - every capsule empty but perhaps the trigger.
    Such files, left by series started and never used, stay on disk but are
    not listed."""
    caps = doc.get("caps") or {}
    if not isinstance(caps, dict):
        return True
    for cap in caps.values():
        if not isinstance(cap, dict) or cap.get("kind") == "trigger":
            continue
        if str((cap.get("sec") or {}).get("text") or "").strip():
            return False
    return True


def _list_series():
    out = []
    folder = _series_dir()
    for fn in os.listdir(folder):
        if not fn.endswith(".json"):
            continue
        path = os.path.join(folder, fn)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                doc = json.load(fh)
            if _series_empty(doc):
                continue
            group = doc.get("group") or {}
            out.append({
                "uid": fn[:-5],
                "name": str(group.get("name") or fn[:-5]),
                "note": str(group.get("note") or "")[:4000],
                "prompts": len(doc.get("prompts") or []),
                "saved": doc.get("saved") or os.path.getmtime(path) * 1000,
                "thumb": _is_pic(group.get("thumb")),
            })
        except Exception:
            continue
    out.sort(key=lambda x: -float(x.get("saved") or 0))
    return out


# --------------------------------------------------------------------------
# folders in the Files panel
#
# Book files and series files sorted into folders. Only an index is kept -
# which file sits in which folder - so the files never move and a series
# keeps writing to its own file. Books are keyed by name, series by uid.

FILE_FOLDERS_NAME = "file_folders.json"
FILE_FOLDERS_BYTES_MAX = 2000000
# Book and series files left alone this long are left out of their list
# once it holds many files - never deleted. 0 lists them all.
KEEP_DAYS_CHOICES = (0, 7, 14, 30, 60, 90)
KEEP_DAYS_DEFAULT = 30


def _keep_days(v):
    try:
        v = int(v)
    except (TypeError, ValueError):
        return KEEP_DAYS_DEFAULT
    return v if v in KEEP_DAYS_CHOICES else KEEP_DAYS_DEFAULT


def _file_folders_path():
    return os.path.join(_book_home(), FILE_FOLDERS_NAME)


FILE_FOLDER_PATH_MAX = 300


def _sanitize_file_folder_list(folders):
    """Folders of the Files panel, each a path - "Chronicle/Season 1" - in the
    order they were made. A folder inside another is written after its
    parent's path and a slash; a parent missing from the list is put back
    just before its first child, so the tree always holds together."""
    out = []
    for f in folders if isinstance(folders, list) else []:
        parts = [" ".join(p.split()) for p in str(f).split("/")]
        parts = [p for p in parts if p]
        if not parts:
            continue
        for i in range(1, len(parts) + 1):
            path = "/".join(parts[:i])[:FILE_FOLDER_PATH_MAX]
            if path not in out:
                out.append(path)
    return out[:400]


def _rename_lone_series(path, name):
    """A book file holding one series: the series takes the book's new name
    too, inside the book and in the series' own file, so opening it shows the
    name it was given in Files."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        book = ((doc.get("doc") or {}).get("book") or {})
        groups = [g for g in (book.get("groups") or []) if isinstance(g, dict)]
        if len(groups) != 1:
            return
        g = groups[0]
        g["name"] = name
        doc["series"] = [name]
        _write_json(path, doc)
        uid = str(g.get("uid") or "")
        if uid and _SERIES_UID.match(uid):
            sp = _series_path(uid)
            if os.path.exists(sp):
                with open(sp, "r", encoding="utf-8") as fh:
                    sdoc = json.load(fh)
                grp = sdoc.get("group") if isinstance(sdoc.get("group"), dict) else {}
                grp["name"] = name
                sdoc["group"] = grp
                _write_json(sp, sdoc)
    except Exception:
        pass


def _sanitize_file_order(order):
    order = order if isinstance(order, dict) else {}
    out = {}
    for sec, ok in (("book", lambda k: True), ("series", lambda k: bool(_SERIES_UID.match(k)))):
        seen = []
        for k in order.get(sec) if isinstance(order.get(sec), list) else []:
            k = str(k)[:200]
            if k and ok(k) and k not in seen:
                seen.append(k)
        out[sec] = seen[:3000]
    return out


def _sanitize_file_folders(doc):
    doc = doc if isinstance(doc, dict) else {}
    folders = _sanitize_file_folder_list(doc.get("folders"))

    def placed(m, key_ok):
        out = {}
        if isinstance(m, dict):
            for k, v in m.items():
                k = str(k)[:200]
                v = "/".join(p for p in (" ".join(x.split()) for x in str(v or "").split("/")) if p)[:FILE_FOLDER_PATH_MAX]
                if k and v in folders and key_ok(k):
                    out[k] = v
        return out

    return {
        "format": "leiel.files", "version": 1,
        "folders": folders,
        "books": placed(doc.get("books"), lambda k: True),
        "series": placed(doc.get("series"), lambda k: bool(_SERIES_UID.match(k))),
        "open": [f for f in _sanitize_file_folder_list(doc.get("open")) if f in folders],
        # the order files were put in inside their folders, by hand
        "order": _sanitize_file_order(doc.get("order")),
        # files taken off the list by hand - the files themselves are kept
        "hidden": _sanitize_file_order(doc.get("hidden")),
        # a colour picked for a folder, by number - folders inside it wear it too
        "colors": {k: int(v) for k, v in (doc.get("colors") or {}).items()
                   if k in folders and isinstance(v, int) and 0 <= v < 5} if isinstance(doc.get("colors"), dict) else {},
        # files unchanged this long leave a list once it grows long - only
        # the list: nothing is deleted
        "keepDays": _keep_days(doc.get("keepDays", KEEP_DAYS_DEFAULT)),
    }


def _forget_series(uid):
    """Take a deleted series out of the folder index."""
    ix = _read_file_folders()
    if uid in ix["series"] or uid in ix["hidden"]["series"] or uid in ix["order"]["series"]:
        ix["series"].pop(uid, None)
        ix["hidden"]["series"] = [k for k in ix["hidden"]["series"] if k != uid]
        ix["order"]["series"] = [k for k in ix["order"]["series"] if k != uid]
        try:
            _write_json(_file_folders_path(), ix)
        except Exception:
            pass


def _delete_series(uid):
    path = _series_path(uid)
    if os.path.exists(path):
        os.remove(path)
    _forget_series(uid)


def _read_file_folders():
    try:
        with open(_file_folders_path(), "r", encoding="utf-8") as fh:
            return _sanitize_file_folders(json.load(fh))
    except Exception:
        return _sanitize_file_folders({})


# --------------------------------------------------------------------------
# the Drawer
#
# Anchors kept for good, outside any series and any workflow: an outfit, a
# pose, a camera that worked, put away to be taken out again in another
# series months later. One file for the whole machine, so every Series Book
# on every canvas opens the same drawer. The first time it is opened it is
# filled from the starting set shipped with the pack.
# --------------------------------------------------------------------------

DRAWER_FILENAME = "drawer.json"
# the style bar's own settings - paragraph and character styles, favourite
# fonts and colours - kept beside the books so they outlive the browser
UI_PREFS_FILENAME = "ui_prefs.json"
UI_PREF_KEYS = ("lvp-pstyles", "lvp-cstyles", "lvp-font-fav", "lvp-font-reg", "lvp-rgb-fav", "lvp-note-lang")
UI_PREF_VALUE_MAX = 1000000
DRAWER_KINDS = ("quality", "subject", "outfit", "pose", "scene", "camera", "absolute")
DRAWER_MAX = 3000
DRAWER_TEXT_MAX = 20000
DRAWER_THUMB_MAX = 300000          # a small JPEG as a data URL
DRAWER_BYTES_MAX = 60000000


def _drawer_path():
    return os.path.join(_book_home(), DRAWER_FILENAME)


def _pack_drawer_path():
    """The shipped starting set, at the root of the pack."""
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(os.path.dirname(here)), DRAWER_FILENAME)


def _sanitize_drawer(items):
    out, seen = [], set()
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        kind = str(it.get("kind") or "")
        text = str(it.get("text") or "").strip()
        if kind not in DRAWER_KINDS or not text:
            continue
        iid = str(it.get("id") or "")[:40] or ("d" + str(len(out)))
        if iid in seen:
            continue
        seen.add(iid)
        tags = []
        for t in it.get("tags") or []:
            t = " ".join(str(t).split())[:40]
            if t and t not in tags:
                tags.append(t)
        thumb = it.get("thumb")
        if not (isinstance(thumb, str) and thumb.startswith("data:image/")
                and len(thumb) <= DRAWER_THUMB_MAX):
            thumb = None
        try:
            added = float(it.get("added") or 0)
        except (TypeError, ValueError):
            added = 0
        try:
            rev = max(1, int(it.get("rev") or 1))
        except (TypeError, ValueError):
            rev = 1
        out.append({
            "id": iid, "kind": kind,
            "name": " ".join(str(it.get("name") or "").split())[:120] or kind.title(),
            "text": text[:DRAWER_TEXT_MAX],
            "tags": tags[:12], "thumb": thumb, "added": added,
            "rev": rev, "edited": bool(it.get("edited")),
            # the folder it sits in - one folder per card, "" for none
            "folder": " ".join(str(it.get("folder") or "").split())[:90],
        })
        if len(out) >= DRAWER_MAX:
            break
    return out


def _sanitize_folders(folders):
    """The drawer's folders, in the order they were made - kept apart from
    the cards so an empty folder stays."""
    out = []
    for f in folders if isinstance(folders, list) else []:
        f = " ".join(str(f).split())[:90]
        if f and f not in out:
            out.append(f)
    return out[:200]


def _read_folders(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        return _sanitize_folders(doc.get("folders") if isinstance(doc, dict) else None)
    except Exception:
        return []


def _drawer_seeded(path, items):
    """The starting cards this drawer has already been given. A card taken
    out is not brought back; a card added to the pack later still arrives."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        seeded = doc.get("seeded") if isinstance(doc, dict) else None
        if isinstance(seeded, list):
            return set(str(x) for x in seeded)
    except Exception:
        pass
    # a drawer from before the list was kept: what it holds is what it got
    return set(str(it.get("id")) for it in items if isinstance(it, dict))


def _load_drawer():
    path = _drawer_path()
    pack = _sanitize_drawer(_read_json_list(_pack_drawer_path(), "items"))
    if not os.path.exists(path):
        try:
            _write_json(path, {"format": "leiel.drawer", "version": 1, "items": pack,
                               "seeded": [it["id"] for it in pack]})
        except Exception:
            pass          # read-only user folder: serve the starting set anyway
        return pack
    items = _sanitize_drawer(_read_json_list(path, "items"))
    seeded = _drawer_seeded(path, items)
    fresh = [it for it in pack if it["id"] not in seeded]
    # A starting card rewritten in a later pack replaces the old words - but
    # only where the card was never edited by hand. Its picture is kept.
    newer = {it["id"]: it for it in pack}
    renewed = False
    for i, it in enumerate(items):
        p = newer.get(it["id"])
        if p and not it.get("edited") and p.get("rev", 1) > it.get("rev", 1):
            items[i] = {**p, "thumb": it.get("thumb"), "added": it.get("added", 0)}
            renewed = True
    if fresh or renewed:
        items = items + fresh
        try:
            _write_json(path, {"format": "leiel.drawer", "version": 1, "items": items,
                               "folders": _read_folders(path),
                               "seeded": sorted(seeded | {it["id"] for it in fresh})})
        except Exception:
            pass
    return items


def _store_drawer(items, folders=None):
    clean = _sanitize_drawer(items)
    path = _drawer_path()
    seeded = _drawer_seeded(path, clean) if os.path.exists(path) else set()
    folders = _sanitize_folders(folders) if folders is not None else _read_folders(path)
    _write_json(path, {"format": "leiel.drawer", "version": 1, "items": clean,
                       "folders": folders, "seeded": sorted(seeded)})
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

    @routes.get("/leiel_vpc/series")
    async def _get_series_list(request):
        try:
            uid = request.query.get("uid")
            if uid:
                with open(_series_path(uid), "r", encoding="utf-8") as fh:
                    return web.json_response({"ok": True, "series": json.load(fh)})
            return web.json_response({"ok": True, "list": _list_series()})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @routes.post("/leiel_vpc/series")
    async def _save_series(request):
        try:
            raw = await request.read()
            if len(raw) > SERIES_BYTES_MAX:
                return web.json_response({"ok": False, "error": "too large"}, status=413)
            doc = json.loads(raw.decode("utf-8"))
            if not isinstance(doc, dict) or doc.get("format") != "leiel.series":
                return web.json_response({"ok": False, "error": "not a series"}, status=400)
            uid = str((doc.get("group") or {}).get("uid") or "")
            _write_json(_series_path(uid), doc)
            return web.json_response({"ok": True})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @routes.get("/leiel_vpc/ui_prefs")
    async def _get_ui_prefs(request):
        try:
            path = os.path.join(_book_home(), UI_PREFS_FILENAME)
            prefs = {}
            if os.path.isfile(path):
                with open(path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, dict):
                    prefs = {k: v for k, v in data.items()
                             if k in UI_PREF_KEYS and isinstance(v, str)}
            return web.json_response({"ok": True, "prefs": prefs})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc), "prefs": {}})

    @routes.post("/leiel_vpc/ui_prefs")
    async def _save_ui_prefs(request):
        try:
            body = json.loads((await request.read()).decode("utf-8"))
            incoming = body.get("prefs") if isinstance(body, dict) else None
            if not isinstance(incoming, dict):
                return web.json_response({"ok": False, "error": "prefs must be an object"}, status=400)
            path = os.path.join(_book_home(), UI_PREFS_FILENAME)
            prefs = {}
            if os.path.isfile(path):
                try:
                    with open(path, "r", encoding="utf-8") as fh:
                        old = json.load(fh)
                    if isinstance(old, dict):
                        prefs = {k: v for k, v in old.items() if k in UI_PREF_KEYS and isinstance(v, str)}
                except Exception:
                    prefs = {}
            for k, v in incoming.items():
                if k in UI_PREF_KEYS and isinstance(v, str) and len(v) <= UI_PREF_VALUE_MAX:
                    json.loads(v)                      # only well-formed JSON is kept
                    prefs[k] = v
            _write_json(path, prefs)
            return web.json_response({"ok": True})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @routes.get("/leiel_vpc/drawer")
    async def _get_drawer(request):
        try:
            items = _load_drawer()
            return web.json_response({"ok": True, "items": items,
                                      "folders": _read_folders(_drawer_path())})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc), "items": []})

    @routes.post("/leiel_vpc/drawer")
    async def _save_drawer(request):
        try:
            raw = await request.read()
            if len(raw) > DRAWER_BYTES_MAX:
                return web.json_response({"ok": False, "error": "too large"}, status=413)
            body = json.loads(raw.decode("utf-8"))
            items = body.get("items") if isinstance(body, dict) else None
            if not isinstance(items, list):
                return web.json_response({"ok": False, "error": "items must be a list"},
                                         status=400)
            folders = body.get("folders") if isinstance(body.get("folders"), list) else None
            return web.json_response({"ok": True, "items": _store_drawer(items, folders)})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @routes.get("/leiel_vpc/books")
    async def _get_books(request):
        try:
            name = request.query.get("name")
            if name:
                with open(_book_path(name), "r", encoding="utf-8") as fh:
                    return web.json_response({"ok": True, "book": json.load(fh)})
            return web.json_response({"ok": True, "list": _list_books(),
                                      "folder": _books_dir()})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @routes.post("/leiel_vpc/books")
    async def _save_book(request):
        try:
            raw = await request.read()
            if len(raw) > BOOK_BYTES_MAX:
                return web.json_response({"ok": False, "error": "too large"}, status=413)
            body = json.loads(raw.decode("utf-8"))
            doc = body.get("file") if isinstance(body, dict) else None
            if not isinstance(doc, dict) or doc.get("format") != "leiel.book":
                return web.json_response({"ok": False, "error": "not a book"}, status=400)
            path = _book_path(body.get("name"))
            existed = os.path.exists(path)
            _write_json(path, doc)
            return web.json_response({"ok": True, "name": os.path.basename(path)[:-5],
                                      "replaced": existed, "path": path})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @routes.post("/leiel_vpc/series_delete")
    async def _delete_series_file(request):
        try:
            body = await request.json()
            _delete_series(str((body or {}).get("uid") or ""))
            return web.json_response({"ok": True})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @routes.post("/leiel_vpc/book_delete")
    async def _delete_book_file(request):
        """A book file off the disk, and out of the folder index."""
        try:
            body = await request.json()
            path = _book_path((body or {}).get("name"))
            if os.path.exists(path):
                os.remove(path)
            name = os.path.basename(path)[:-5]
            ix = _read_file_folders()
            changed = False
            if name in ix["books"]:
                ix["books"].pop(name, None)
                changed = True
            if name in ix["order"]["book"]:
                ix["order"]["book"] = [k for k in ix["order"]["book"] if k != name]
                changed = True
            if name in ix["hidden"]["book"]:
                ix["hidden"]["book"] = [k for k in ix["hidden"]["book"] if k != name]
                changed = True
            if changed:
                _write_json(_file_folders_path(), ix)
            return web.json_response({"ok": True, "name": name})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @routes.post("/leiel_vpc/book_rename")
    async def _rename_book(request):
        """A book file under a new name. The file moves on disk; the folder
        it sat in follows it."""
        try:
            body = await request.json()
            old = _book_path((body or {}).get("old"))
            new = _book_path((body or {}).get("new"))
            if not os.path.exists(old):
                return web.json_response({"ok": False, "error": "no such book"}, status=404)
            if os.path.abspath(old) == os.path.abspath(new):
                return web.json_response({"ok": True, "name": os.path.basename(new)[:-5]})
            if os.path.exists(new) and os.path.normcase(old) != os.path.normcase(new):
                return web.json_response({"ok": False, "error": "a book of that name already exists"}, status=409)
            os.replace(old, new)
            ix = _read_file_folders()
            oname, nname = os.path.basename(old)[:-5], os.path.basename(new)[:-5]
            _rename_lone_series(new, nname)
            changed = False
            if oname in ix["books"]:
                ix["books"][nname] = ix["books"].pop(oname)
                changed = True
            if oname in ix["order"]["book"]:
                ix["order"]["book"] = [nname if k == oname else k for k in ix["order"]["book"]]
                changed = True
            if oname in ix["hidden"]["book"]:
                ix["hidden"]["book"] = [nname if k == oname else k for k in ix["hidden"]["book"]]
                changed = True
            if changed:
                _write_json(_file_folders_path(), ix)
            return web.json_response({"ok": True, "name": nname})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @routes.post("/leiel_vpc/series_rename")
    async def _rename_series_file(request):
        """A closed series under a new name, written into its own file."""
        try:
            body = await request.json()
            path = _series_path(str((body or {}).get("uid") or ""))
            name = " ".join(str((body or {}).get("name") or "").split())[:120]
            if not name:
                return web.json_response({"ok": False, "error": "no name"}, status=400)
            with open(path, "r", encoding="utf-8") as fh:
                doc = json.load(fh)
            group = doc.get("group") if isinstance(doc.get("group"), dict) else {}
            group["name"] = name
            doc["group"] = group
            _write_json(path, doc)
            return web.json_response({"ok": True, "name": name})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @routes.get("/leiel_vpc/file_thumb")
    async def _file_thumb(request):
        q = request.rel_url.query
        body, ctype = _file_pic(book=q.get("book"), uid=q.get("uid"))
        if not body:
            return web.Response(status=404)
        return web.Response(body=body, content_type=ctype,
                            headers={"Cache-Control": "max-age=86400"})

    @routes.get("/leiel_vpc/file_folders")
    async def _get_file_folders(request):
        return web.json_response({"ok": True, "index": _read_file_folders()})

    @routes.post("/leiel_vpc/file_folders")
    async def _save_file_folders(request):
        try:
            raw = await request.read()
            if len(raw) > FILE_FOLDERS_BYTES_MAX:
                return web.json_response({"ok": False, "error": "too large"}, status=413)
            doc = _sanitize_file_folders(json.loads(raw.decode("utf-8")))
            _write_json(_file_folders_path(), doc)
            return web.json_response({"ok": True, "index": doc})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    @routes.get("/leiel_vpc/presets")
    async def _get_presets(request):
        try:
            return web.json_response(_load_presets())
        except Exception as exc:
            return web.json_response([], headers={"X-VPC-Presets-Error": str(exc)})

    @routes.get("/leiel_vpc/snippets")
    async def _get_snippets(request):
        return web.json_response({"snippets": _load_snippets()})

    @routes.post("/leiel_vpc/snippets")
    async def _save_snippets(request):
        try:
            data = await request.json()
            if isinstance(data, dict):
                data = data.get("snippets", None)
            if not isinstance(data, list):
                return web.json_response(
                    {"ok": False, "error": "snippets must be a list"},
                    status=400)
            clean = _store_snippets(data)
            return web.json_response({"ok": True, "snippets": clean})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)},
                                     status=500)

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
    "LeielSeriesBook": LeielSeriesBook,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    # Display name only. Changing the key would break saved workflows.
    "LeielPromptComposer": "Visual Prompt Composer (Studio Leiel)",
    "LeielSeriesBook": "Visual Series Book (Studio Leiel)",
}
