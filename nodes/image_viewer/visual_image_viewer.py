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
Studio Leiel - Visual Image Viewer
--------------------------------------------------
A folder of pictures, inside the graph: thumbnails to click, a large view to
step through, 100% to check a hand or an eyelash. It takes nothing and
returns nothing - it is a window, not a step in the workflow.

The pictures reach the browser through ComfyUI's own server, and that server
can be opened to a network with --listen. A route that read any path it was
handed would then hand any file on this machine to anyone who could reach
the port. So every path is checked against a short list of places before it
is read: ComfyUI's output and input folders, and whatever the owner of the
machine has written into allowed_folders.txt in the user folder. Nothing
outside them is listed, browsed or served, and a picture's name is never
allowed to carry a path of its own.

Deleting is moving. A picture deleted in the viewer goes into a _deleted
folder beside it, out of the folder's view, so it can be brought back at
once. The bin view lists the _deleted folders of the folder on show - and of
the folders inside it, nothing else - to restore from or empty; only
emptying lets go of a picture - to the Recycle Bin when send2trash is
installed. Picks, the pictures marked as good, are kept in
picks.json in the same user folder as the list of allowed folders.
"""

import asyncio
import hashlib
import io
import json
import os
import re
import shutil
import sys
import threading
from collections import OrderedDict

from PIL import Image, ImageOps

import folder_paths

VALID_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}

ALLOW_DIRNAME = "visual_image_viewer"
ALLOW_FILENAME = "allowed_folders.txt"
PICKS_FILENAME = "picks.json"
TRASH_DIR = "_deleted"
ALLOW_TEMPLATE = """\
# Visual Image Viewer - folders it may open besides ComfyUI's output and input.
#
# One folder per line, as a full path. Everything inside a folder listed here
# can be opened too. Lines starting with # are ignored.
#
# The viewer reads pictures through ComfyUI's server. If ComfyUI is reachable
# from other machines (--listen), so is every folder listed here - list only
# folders you would be happy to share that way.
#
# D:\\StudioLeiel\\selected
"""


# ------------------------------------------------------------- allowed roots
def _user_dir():
    get = getattr(folder_paths, "get_user_directory", None)
    try:
        d = get() if get else None
    except Exception:
        d = None
    if not d:
        d = os.path.join(os.path.dirname(folder_paths.get_output_directory()), "user")
    return d


def _allow_file():
    return os.path.join(_user_dir(), ALLOW_DIRNAME, ALLOW_FILENAME)


def _ensure_allow_file():
    """Written once, with instructions and nothing allowed, so the place to
    add a folder is there to be found rather than guessed at."""
    path = _allow_file()
    if os.path.exists(path):
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(ALLOW_TEMPLATE)
    except OSError:
        pass


_allow_cache = {"mtime": None, "dirs": []}


def _extra_roots():
    path = _allow_file()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return []
    if _allow_cache["mtime"] == mtime:
        return list(_allow_cache["dirs"])
    dirs = []
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip().strip('"').strip("'")
                if not line or line.startswith("#"):
                    continue
                if os.path.isabs(line) and os.path.isdir(line):
                    dirs.append(os.path.normpath(line))
    except OSError:
        return []
    _allow_cache.update(mtime=mtime, dirs=dirs)
    return list(dirs)


def _roots():
    """[(label, path)] - the places the viewer may open, output first."""
    out = []
    for label, get in (("output", folder_paths.get_output_directory),
                       ("input", folder_paths.get_input_directory)):
        try:
            p = os.path.normpath(get())
            if os.path.isdir(p):
                out.append((label, p))
        except Exception:
            pass
    for p in _extra_roots():
        out.append((p, p))
    return out


def _key(path):
    return os.path.normcase(os.path.realpath(path))


def _allowed(path):
    """True when the path really sits in one of the roots - after links and
    .. are resolved, so neither can walk out of one."""
    try:
        target = _key(path)
    except Exception:
        return False
    for _label, root in _roots():
        r = _key(root)
        if target == r or target.startswith(r.rstrip(os.sep) + os.sep):
            return True
    return False


def resolve(raw):
    """A folder as typed: empty is the output folder, a relative path is
    read from the output folder, an absolute one is taken as it is."""
    p = str(raw or "").strip().strip('"').strip("'")
    out = folder_paths.get_output_directory()
    if not p:
        return os.path.normpath(out)
    if os.path.isabs(p):
        return os.path.normpath(p)
    return os.path.normpath(os.path.join(out, p))


def _folder(raw):
    """(path, error) - the folder, or why it may not be opened."""
    path = resolve(raw)
    if not _allowed(path):
        return path, "outside the folders this viewer may open"
    if not os.path.isdir(path):
        return path, "folder not found"
    return path, None


# ------------------------------------------------------------ several at once
# Folders picked together - Ctrl or Shift in the folder picker - are written
# as one string, their paths joined by "|": "2026-11-10|2026-10-26". That is
# all of them at once, each with its subfolders. "|" cannot be in a path on
# Windows, so no real folder is ever read as one of these.
#
# A picture from such a view is named as usual, with "|" and the name of the
# folder it came from on the end - "S1E4 The Burning Rose Garden/01.png|
# 2026-11-10" - so the same name in two folders stays two pictures. Two
# picked folders of the same name are told apart as "name (2)".
MULTI_MARK = "|"


def _multi(raw):
    """[(tag, path)] for several folders joined by "|", in the order they
    were given, or None for an ordinary folder."""
    p = str(raw or "").strip().strip('"').strip("'")
    if MULTI_MARK not in p:
        return None
    out, seen, used = [], set(), {}
    for part in p.split(MULTI_MARK):
        part = part.strip().strip('"').strip("'")
        if not part:
            continue
        d = resolve(part)
        k = _key(d)
        if k in seen or not os.path.isdir(d) or not _allowed(d):
            continue
        seen.add(k)
        name = os.path.basename(d.rstrip("\\/")) or d
        used[name] = used.get(name, 0) + 1
        tag = name if used[name] == 1 else "%s (%d)" % (name, used[name])
        out.append((tag, d))
    return out


def _multi_path(raw):
    """The folders of a several-at-once view, written out in full."""
    return MULTI_MARK.join(d for _, d in (_multi(raw) or []))


def _untag(name):
    name = str(name or "")
    cut = name.rfind(MULTI_MARK)
    return (name[:cut], name[cut + 1:]) if cut >= 0 else (name, None)


def _tag(name, tag):
    return "%s%s%s" % (name, MULTI_MARK, tag) if name else name


def _by_root(roots, names):
    """The names grouped by the folder each came from, untagged."""
    known = dict(roots)
    out = OrderedDict()
    for n in names or []:
        plain, tag = _untag(n)
        if tag in known:
            out.setdefault(tag, []).append(plain)
    return known, out


def _multi_rel(raw):
    if MULTI_MARK in str(raw or ""):
        return None
    try:
        out = folder_paths.get_output_directory()
        path = resolve(raw)
        if _key(path).startswith(_key(out).rstrip(os.sep) + os.sep):
            return os.path.relpath(path, out).replace("\\", "/")
    except Exception:
        pass
    return None


def _multi_list(raw, roots, thumb, newest, trash_view):
    if not roots:
        return {"ok": False, "error": "none of these folders can be opened",
                "path": str(raw or "")}
    items, trash, capped, kind = [], 0, False, ""
    for tag, d in roots:
        j = _list_body(d, True, thumb, newest, trash_view)
        if not j.get("ok"):
            continue
        for it in j.get("items") or []:
            it["name"] = _tag(it["name"], tag)
            items.append(it)
        trash += j.get("trash") or 0
        capped = capped or bool(j.get("capped"))
        kind = kind or j.get("bin") or ""
    return {"ok": True, "path": _multi_path(raw), "rel": None, "items": items,
            "deep": True, "capped": capped, "trash": trash, "bin": kind,
            "folders": [t for t, _ in roots]}


def _locate(folder, name):
    """The picture a request names, or None.

    The name is a file name with a picture's extension, or - for a folder
    shown with its subfolders - a path below the folder written with "/".
    Every part of it must be a plain name: no "..", no drive, no leading
    slash. And the file it ends at must still be inside the folder and an
    allowed place once links are resolved, so no spelling can step out."""
    roots = _multi(folder)
    if roots is not None:
        plain, tag = _untag(name)
        for t, d in roots:
            if t == tag:
                return _locate(d, plain)
        return None
    name = str(name or "").replace("\\", "/")
    parts = name.split("/")
    if not name or any(p in ("", ".", "..") for p in parts):
        return None
    if ":" in name or os.path.isabs(name):
        return None
    if os.path.splitext(parts[-1])[1].lower() not in VALID_EXT:
        return None
    path, err = _folder(folder)
    if err:
        return None
    full = os.path.join(path, *parts)
    if not os.path.isfile(full) or not _allowed(full):
        return None
    base = _key(path).rstrip(os.sep) + os.sep
    return full if _key(full).startswith(base) else None


# -------------------------------------------------------------------- picks
# The pictures marked as good, by their full path as the system spells it.
# One file for every viewer, so a pick made in one workflow is a pick in all
# of them.
_picks_lock = threading.RLock()
_picks_cache = {"mtime": None, "keys": frozenset()}


RECENT_FILENAME = "recent.json"
RECENT_MAX = 8


def _recent_file():
    return os.path.join(_user_dir(), ALLOW_DIRNAME, RECENT_FILENAME)


def _recent():
    """The folders opened last, newest first - only ones still allowed."""
    try:
        with open(_recent_file(), "r", encoding="utf-8") as fh:
            v = json.load(fh)
    except Exception:
        return []
    out = []
    for p in v if isinstance(v, list) else []:
        if isinstance(p, str) and p and p not in out and _allowed(p) and os.path.isdir(p):
            out.append(p)
    return out[:RECENT_MAX]


def _push_recent(path):
    path = str(path or "").strip()
    if not path or not _allowed(path) or not os.path.isdir(path):
        return _recent()
    path = os.path.normpath(path)
    lst = [path] + [p for p in _recent() if os.path.normcase(p) != os.path.normcase(path)]
    lst = lst[:RECENT_MAX]
    try:
        f = _recent_file()
        os.makedirs(os.path.dirname(f), exist_ok=True)
        tmp = f + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(lst, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, f)
    except OSError:
        pass
    return lst


def _picks_file():
    return os.path.join(_user_dir(), ALLOW_DIRNAME, PICKS_FILENAME)


def _picks():
    """The set of picked paths - read again only when the file changes."""
    path = _picks_file()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return frozenset()
    with _picks_lock:
        if _picks_cache["mtime"] == mtime:
            return _picks_cache["keys"]
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        keys = frozenset(os.path.normcase(str(k)) for k in (data.get("picks") or [])
                         if isinstance(k, str))
    except (OSError, ValueError, AttributeError):
        keys = frozenset()
    with _picks_lock:
        _picks_cache.update(mtime=mtime, keys=keys)
    return keys


def _set_picks(add=(), remove=()):
    """Add and remove paths, written through a temporary file so a crash
    half way never leaves the list unreadable."""
    path = _picks_file()
    with _picks_lock:
        keys = set(_picks())
        keys |= {os.path.normcase(k) for k in add}
        keys -= {os.path.normcase(k) for k in remove}
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"picks": sorted(keys)}, f, ensure_ascii=False, indent=0)
            os.replace(tmp, path)
            _picks_cache.update(mtime=os.path.getmtime(path), keys=frozenset(keys))
        except OSError:
            return False
    return True


def _pick_body(folder, names, on):
    keys = []
    for name in names or []:
        full = _locate(folder, name)
        if full:
            keys.append(_key(full))
    if not keys:
        return {"ok": False, "error": "not found"}
    ok = _set_picks(add=keys) if on else _set_picks(remove=keys)
    return {"ok": ok, "count": len(keys)}


# ----------------------------------------------------------------- deleting
def _free_name(folder, name):
    """name, or "name (2)" and on, whichever is not taken in folder."""
    stem, ext = os.path.splitext(name)
    candidate, k = name, 2
    while os.path.exists(os.path.join(folder, candidate)):
        candidate = "%s (%d)%s" % (stem, k, ext)
        k += 1
    return candidate


def _delete_body(folder, names):
    """Each picture into the _deleted folder beside it. Returns where each
    went, as a name from the folder on show, so it can be brought back."""
    roots = _multi(folder)
    if roots is not None:
        known, groups = _by_root(roots, names)
        moved = []
        for tag, plain in groups.items():
            j = _delete_body(known[tag], plain)
            for m in j.get("moved") or []:
                m["name"] = _tag(m["name"], tag)
                m["stash"] = _tag(m["stash"], tag)
                moved.append(m)
            if not j.get("ok"):
                return {"ok": False, "error": j.get("error"), "moved": moved}
        return {"ok": True, "moved": moved}
    path, err = _folder(folder)
    if err:
        return {"ok": False, "error": err}
    picks = _picks()
    moved, unpick = [], []
    for name in names or []:
        full = _locate(folder, name)
        if not full:
            continue
        key = _key(full)
        here = os.path.dirname(full)
        bin_dir = os.path.join(here, TRASH_DIR)
        try:
            os.makedirs(bin_dir, exist_ok=True)
            to = _free_name(bin_dir, os.path.basename(full))
            os.replace(full, os.path.join(bin_dir, to))
        except OSError as exc:
            return {"ok": False, "error": str(exc), "moved": moved}
        picked = key in picks
        if picked:
            unpick.append(key)
        cut = name.rfind("/")
        stash = (name[:cut + 1] if cut >= 0 else "") + TRASH_DIR + "/" + to
        moved.append({"name": name, "stash": stash, "picked": picked})
    if unpick:
        _set_picks(remove=unpick)
    return {"ok": True, "moved": moved}


def _plain_name(name):
    parts = name.split("/")
    return (bool(name) and not any(p in ("", ".", "..") for p in parts)
            and ":" not in name and not os.path.isabs(name)
            and os.path.splitext(parts[-1])[1].lower() in VALID_EXT)


def _restore_body(folder, items):
    """Back from _deleted to where each picture was - unless something has
    taken its name since, in which case it stays where it is."""
    roots = _multi(folder)
    if roots is not None:
        known = dict(roots)
        groups = OrderedDict()
        for it in items or []:
            if not isinstance(it, dict):
                continue
            name, tag = _untag(it.get("name"))
            stash, _t = _untag(it.get("stash"))
            if tag in known:
                groups.setdefault(tag, []).append(dict(it, name=name, stash=stash))
        back = []
        for tag, its in groups.items():
            j = _restore_body(known[tag], its)
            back += [_tag(n, tag) for n in j.get("back") or []]
        return {"ok": True, "back": back}
    path, err = _folder(folder)
    if err:
        return {"ok": False, "error": err}
    back, repick = [], []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or "").replace("\\", "/")
        stash = str(it.get("stash") or "").replace("\\", "/")
        parts = stash.split("/")
        if len(parts) < 2 or parts[-2] != TRASH_DIR or not _plain_name(name):
            continue
        src = _locate(folder, stash)
        if not src:
            continue
        dst = os.path.join(path, *name.split("/"))
        if os.path.exists(dst) or not _allowed(os.path.dirname(dst)):
            continue
        try:
            os.replace(src, dst)
        except OSError:
            continue
        try:
            os.rmdir(os.path.dirname(src))       # only when it is now empty
        except OSError:
            pass
        back.append(name)
        if it.get("picked"):
            repick.append(_key(dst))
    if repick:
        _set_picks(add=repick)
    return {"ok": True, "back": back}


def _trash_dirs(path):
    """Every _deleted folder in a folder and the folders inside it."""
    out = []
    for here, dirs, _files in os.walk(path):
        if TRASH_DIR in dirs:
            out.append(os.path.join(here, TRASH_DIR))
        dirs[:] = [d for d in dirs if not d.startswith(".") and not d.startswith("_")
                   and d.lower() not in _SKIP_DIRS]
    return out


def _count_files(folder):
    try:
        with os.scandir(folder) as it:
            return sum(1 for e in it if e.is_file())
    except OSError:
        return 0


def _desktop(name):
    """A desktop helper another pack on this machine offers, or None.

    Putting a file on the clipboard or into the Recycle Bin means talking to
    the operating system directly, which this pack leaves alone. A pack that
    does it can offer it by keeping a dict named LEIEL_VIEWER_DESKTOP in one
    of its modules - {"clipboard": f(path), "recycle": f(paths)} - and the
    viewer uses it when it is there. It is looked for when needed, so the
    order the packs load in does not matter."""
    for mod in list(sys.modules.values()):
        hooks = getattr(mod, "LEIEL_VIEWER_DESKTOP", None)
        if isinstance(hooks, dict) and callable(hooks.get(name)):
            return hooks[name]
    return None


def _send2trash():
    try:
        from send2trash import send2trash
        return send2trash
    except ImportError:
        return None


def _bin_kind():
    """Where emptying sends things: the Recycle Bin, or nowhere."""
    return "recycle" if (_send2trash() or _desktop("recycle")) else "delete"


def _empty_body(folder):
    """Every _deleted folder in the folder on show and the folders inside
    it - to the Recycle Bin where there is one, otherwise gone."""
    roots = _multi(folder)
    if roots is not None:
        count, how = 0, _bin_kind()
        for _t, d in roots:
            j = _empty_body(d)
            if not j.get("ok"):
                return j
            count += j.get("count") or 0
        return {"ok": True, "count": count, "how": how}
    path, err = _folder(folder)
    if err:
        return {"ok": False, "error": err}
    dirs = [d for d in _trash_dirs(path) if _allowed(d)]
    how = _bin_kind()
    if not dirs:
        return {"ok": True, "count": 0, "how": how}
    count = sum(_count_files(d) for d in dirs)
    try:
        to_bin = _send2trash()
        recycle = _desktop("recycle")
        if to_bin:
            for d in dirs:
                to_bin(d)
        elif recycle:
            recycle(dirs)
        else:
            for d in dirs:
                shutil.rmtree(d)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "count": count, "how": how}


# ----------------------------------------------------------------- the prompt
# ComfyUI writes the graph it ran into every PNG it saves. From that graph
# the prompt is read back - and where a Series Lab made the render, rebuilt
# exactly as the Lab built it: the Series Book's layout as it was at that
# moment, the prompt the recipe picked, the capsules a sweep put in, the
# trigger words. Elsewhere the longest text given to a text input is taken,
# which is the prompt in all but odd graphs.
_METAS = OrderedDict()

_SETTING_KEYS = (("seed", "seed"), ("noise_seed", "seed"), ("steps", "steps"),
                 ("cfg", "cfg"), ("sampler_name", "sampler"),
                 ("scheduler", "scheduler"), ("denoise", "denoise"))


def _lab_modules():
    """The Series Lab and Series Book of this pack - as a package inside
    ComfyUI, or side by side when loaded on their own."""
    try:
        from ..series_lab import visual_series_lab as lab
        from ..prompt_composer import leiel_prompt as book
    except Exception:
        import series_lab.visual_series_lab as lab          # noqa: E402
        import prompt_composer.leiel_prompt as book          # noqa: E402
    return lab, book


def _linked(value):
    return isinstance(value, list) and len(value) == 2 and isinstance(value[1], int)


def _guess_prompt(graph):
    best = ""
    for node in graph.values():
        inputs = node.get("inputs", {}) if isinstance(node, dict) else {}
        for key, val in inputs.items():
            k = key.lower()
            if (isinstance(val, str) and val.strip() and len(val) > len(best)
                    and any(p in k for p in ("text", "prompt", "positive"))
                    and not k.endswith("_json")):
                best = val
    return best


def _str_in(ins, key, default):
    v = ins.get(key)
    return v if isinstance(v, str) else default


def _compose_book(ins, bookmod):
    """A Series Book's output, run again from the inputs the graph saved."""
    # by name: the Book has dropped its joining widgets, and a picture saved
    # before that still carries them - either way the call fits
    return bookmod.LeielSeriesBook().compose(
        layout_json=ins.get("layout_json") or "",
        prompt_separator=_str_in(ins, "prompt_separator", "blank_line"),
        labeled_style=_str_in(ins, "labeled_style", "banner"),
        skip_empty=ins.get("skip_empty") if isinstance(ins.get("skip_empty"), bool) else True)


def _composer_text(ins, bookmod, slot):
    """A Prompt Composer's text and its sections, read from its layout as it
    joins them. Text arriving on a section's wire is not in the graph; a
    section fed that way shows its own text."""
    try:
        layout = json.loads(ins.get("layout_json") or "{}")
    except (TypeError, ValueError):
        return None, []
    sep = bookmod.SEPARATORS.get(_str_in(ins, "prompt_separator", "blank_line"), "\n\n")
    skip = ins.get("skip_empty") if isinstance(ins.get("skip_empty"), bool) else True
    secs = []
    for sec in (layout.get("sections") or []) if isinstance(layout, dict) else []:
        if not isinstance(sec, dict) or not sec.get("on", True):
            continue
        body = bookmod._clean(sec.get("text"))
        if skip and not body:
            continue
        secs.append({"kind": str(sec.get("title") or ""), "name": "", "text": body,
                     "swapped": False, "slot": sec.get("slot")})
    if slot >= 2:                                     # one section's own output
        one = [x for x in secs if str(x.get("slot")) == str(slot - 1)]
        return (one[0]["text"] if one else None), one
    return sep.join(x["text"] for x in secs if x["text"]), secs


def _resolve_text(graph, link, bookmod, lab=None, depth=0):
    """(text, sections) a link carries, when its node can be run again from
    what the graph saved: a Prompt Composer or a Series Book is composed
    anew, a text box gives its text."""
    if not _linked(link) or depth > 4:
        return None, []
    node = graph.get(str(link[0])) or {}
    ins = node.get("inputs") or {}
    cls = node.get("class_type")
    try:
        if cls == "LeielSeriesBook" and isinstance(ins.get("layout_json"), str) and bookmod:
            out = _compose_book(ins, bookmod)
            val = out[link[1]] if link[1] < len(out) else None
            secs = []
            if link[1] == 1 and lab is not None:          # the open prompt
                try:
                    active = int(((json.loads(ins["layout_json"]) or {}).get("book") or {}).get("active") or 0)
                except Exception:
                    active = 0
                secs = _book_sections(lab, out[0], active, None)
            return (val if isinstance(val, str) else None), secs
        if cls == "LeielPromptComposer" and isinstance(ins.get("layout_json"), str) and bookmod:
            return _composer_text(ins, bookmod, link[1])
    except Exception:
        return None, []
    for key in ("text", "string", "value", "prompt"):
        v = ins.get(key)
        if isinstance(v, str) and v.strip():
            return v, []
        if _linked(v):
            return _resolve_text(graph, v, bookmod, lab, depth + 1)
    return None, []


def _encoded_prompt(graph, bookmod, lab=None):
    """The longest text going into a text encoder - followed back through a
    Prompt Composer or a Series Book when that is where it comes from."""
    best, best_secs = "", []
    for node in graph.values():
        if not isinstance(node, dict) or "textencode" not in str(node.get("class_type") or "").lower():
            continue
        for key, v in (node.get("inputs") or {}).items():
            if key.lower() not in ("text", "text_g", "text_l", "prompt", "positive"):
                continue
            t, secs = (v, []) if isinstance(v, str) else _resolve_text(graph, v, bookmod, lab)
            if isinstance(t, str) and len(t) > len(best):
                best, best_secs = t, secs
    return best, best_secs


def _book_sections(lab, series, pid, swap):
    """The prompt's parts in order, the swept capsules marked - for showing
    which anchor said what. The text itself comes from the Lab's own code."""
    prompts = series.get("prompts") or []
    caps = series.get("caps") or {}
    p = next((q for q in prompts if isinstance(q, dict) and q.get("id") == pid), None)
    if not p:
        return []
    parts = [dict(x, swapped=False) for x in p.get("parts") or [] if isinstance(x, dict)]
    wanted = []
    if isinstance(swap, dict):
        wanted = swap.get("caps") if isinstance(swap.get("caps"), list) else [swap]
    for one in wanted:
        if not isinstance(one, dict):
            continue
        cap = caps.get(str(one.get("cap")))
        if not isinstance(cap, dict):
            continue
        kind = str(one.get("kind") or cap.get("kind") or "")
        mine = {"kind": kind, "cap": one.get("cap"), "body": cap.get("body"), "swapped": True}
        at = next((i for i, x in enumerate(parts) if x.get("kind") == kind), -1)
        if at >= 0:
            parts[at] = mine
        else:
            order = lab.KIND_ORDER
            rank = order.index(kind) if kind in order else len(order)
            at = next((i for i, x in enumerate(parts)
                       if x.get("kind") in order and order.index(x.get("kind")) > rank), len(parts))
            parts.insert(at, mine)
    out = []
    for x in parts:
        body = x.get("body")
        if not body:
            continue
        cap = caps.get(str(x.get("cap"))) or {}
        out.append({"kind": str(x.get("kind") or ""), "name": str(cap.get("name") or ""),
                    "text": str(body), "swapped": bool(x.get("swapped"))})
    return out


def _from_lab(graph, lab_id, lab, bookmod):
    node = graph[lab_id]
    inputs = node.get("inputs") or {}
    try:
        current = json.loads(inputs.get("current_json") or "{}")
    except (TypeError, ValueError):
        return None
    if not isinstance(current, dict):
        return None
    try:
        slot = int(current.get("prompt_slot") or 0)
    except (TypeError, ValueError):
        slot = 0
    base, sections = None, []
    if slot >= lab.BOOK_SLOT_BASE and _linked(inputs.get("series")):
        bnode = graph.get(str(inputs["series"][0])) or {}
        bin_ = bnode.get("inputs") or {}
        if bnode.get("class_type") == "LeielSeriesBook" and isinstance(bin_.get("layout_json"), str):
            series = _compose_book(bin_, bookmod)[0]
            pid = slot - lab.BOOK_SLOT_BASE
            # by number, and failing that by name - the same way the Lab finds it
            if not any(isinstance(q, dict) and q.get("id") == pid for q in series.get("prompts") or []):
                named = next((q for q in series.get("prompts") or [] if isinstance(q, dict)
                              and q.get("name") == str(current.get("prompt_name") or "")), None)
                if named:
                    pid = named.get("id")
            swap = current.get("swap")
            if swap:
                base = lab._book_swap(series, pid, swap)
            if base is None:
                base = lab._from_book(series, pid, str(current.get("prompt_name") or ""))
            sections = _book_sections(lab, series, pid, swap)
    elif 1 <= slot <= lab.MAX_PROMPTS:
        src = inputs.get("prompt%d" % slot)
        if isinstance(src, str):
            base = src
        elif _linked(src):
            base, sections = _resolve_text(graph, src, bookmod, lab)
    if base is None:
        return None
    words = [str(w) for w in (current.get("triggers") or []) if str(w).strip()]
    text = lab.core.merge_prompt(base, words, position=str(current.get("trigger_position") or "prepend"))
    loras = []
    for e in current.get("loras") or []:
        if isinstance(e, dict) and e.get("name"):
            loras.append({"name": str(e["name"]), "strength": e.get("strength", 1.0)})
    return {"prompt": text, "how": "series lab", "sections": sections,
            "triggers": words, "loras": loras,
            "prompt_name": str(current.get("prompt_name") or ""),
            "series_name": str(current.get("series_name") or "")}


def _meta(path):
    """What a render says about itself, read from the PNG's text only."""
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return {"ok": False, "error": "not found"}
    hit = _cache_get(_METAS, (path, mtime))
    if hit is not None:
        return hit
    try:
        with Image.open(path) as im:
            info = dict(im.info or {})
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    raw = info.get("prompt")
    has_wf = bool(info.get("workflow"))
    if not raw:
        body = {"ok": True, "found": False, "workflow": has_wf}
        _cache_put(_METAS, (path, mtime), body, 400)
        return body
    try:
        graph = json.loads(raw)
        if not isinstance(graph, dict):
            raise ValueError("not a graph")
    except Exception:
        body = {"ok": True, "found": False, "workflow": has_wf}
        _cache_put(_METAS, (path, mtime), body, 400)
        return body
    body = None
    labs = [k for k, n in graph.items()
            if isinstance(n, dict) and n.get("class_type") == "VisualSeriesLabSetup"]
    if labs:
        try:
            lab, bookmod = _lab_modules()
            body = _from_lab(graph, labs[0], lab, bookmod)
        except Exception as exc:                    # pragma: no cover
            print("[Visual Image Viewer] prompt from the Series Lab: %s" % exc)
            body = None
    if body is None:
        try:
            bookmod = _lab_modules()[1]
        except Exception:
            bookmod = None
        try:
            labmod = _lab_modules()[0]
        except Exception:
            labmod = None
        text, secs = _encoded_prompt(graph, bookmod, labmod) if bookmod else ("", [])
        body = {"prompt": text or _guess_prompt(graph),
                "how": "text encoder" if text else "longest text", "sections": secs,
                "triggers": [], "loras": [], "prompt_name": "", "series_name": ""}
        for n in graph.values():
            if not isinstance(n, dict) or "lora" not in str(n.get("class_type") or "").lower():
                continue
            ins = n.get("inputs") or {}
            name = ins.get("lora_name")
            if isinstance(name, str) and name:
                body["loras"].append({"name": name, "strength": ins.get("strength_model", 1.0)})
    settings = []
    seen = set()
    for n in graph.values():
        ins = n.get("inputs") if isinstance(n, dict) else None
        if not isinstance(ins, dict) or not any(k in ins for k in ("steps", "sampler_name")):
            continue
        for key, label in _SETTING_KEYS:
            v = ins.get(key)
            if v is None or _linked(v) or label in seen:
                continue
            seen.add(label)
            settings.append({"label": label, "value": str(v)})
    nodes = _node_values(graph)
    body.update(ok=True, found=bool(body.get("prompt")), settings=settings, workflow=has_wf,
                nodes=nodes, models=_model_names(graph),
                enhancers=_enhancers(graph, nodes, info.get("workflow")))
    _cache_put(_METAS, (path, mtime), body, 400)
    return body


# Nodes whose values are told elsewhere (prompts, LoRAs, names, saving) or
# change on every render without meaning anything.
_NODE_SKIP = re.compile(r"lora|cliptext|textencode|clip|book|series|composer|save|preview|"
                        r"filename|viewer|vae|loader|checkpoint|unet|note|"
                        r"anything|everywhere|purge|primitive|reroute", re.I)
# "text" alone is a prompt; text_scale and the like are settings and stay
_KEY_SKIP = re.compile(r"seed|control_after|filename|prefix|path|folder|^text_?\d*$|^text_[gl]$|prompt|^image$|^upload$", re.I)


_MODEL_FILE = re.compile(r"\.(pth|pt|ckpt|bin|gguf|onnx|safetensors)$", re.I)
_MODEL_KEY = re.compile(r"(^|_)(model|ckpt|unet|vae|clip)(_name)?\d*$|_name\d*$", re.I)


def _model_names(graph):
    """Every model file a render loaded - the upscale model, the checkpoint
    or UNet, the VAE, the text encoders - so two renders made with different
    models say so. The loaders are left out of the node values above, which
    is why a changed upscale model never showed. LoRAs are told elsewhere."""
    out = []
    for n in graph.values():
        if not isinstance(n, dict):
            continue
        cls = str(n.get("class_type") or "")
        low = cls.lower()
        if "lora" in low:
            continue
        for k, v in (n.get("inputs") or {}).items():
            if not isinstance(v, str) or not _MODEL_FILE.search(v) or not _MODEL_KEY.search(k):
                continue
            kl = k.lower()
            if "upscale" in low or "upscale" in kl or "esrgan" in low:
                kind = "upscale model"
            elif "vae" in low or "vae" in kl:
                kind = "vae"
            elif "clip" in low or "clip" in kl or "textencoder" in low or "text_encoder" in kl:
                kind = "text encoder"
            else:
                kind = "model"
            out.append({"kind": kind, "name": v})
    return out


_ENH = re.compile(r"enhanc", re.I)


def _enhancers(graph, nodes, wf_raw):
    """The enhancer nodes a render went through, with their values - and the
    ones that sat in the workflow switched off, which the run graph leaves
    out altogether, so a render made without one says so."""
    out = []
    for nid, n in graph.items():
        if not isinstance(n, dict):
            continue
        cls = str(n.get("class_type") or "")
        got = nodes.get(str(nid))
        title = got["title"] if got else cls
        if not (_ENH.search(cls) or _ENH.search(title)):
            continue
        out.append({"title": title, "on": True, "values": (got or {}).get("values") or {}})
    try:
        wf = json.loads(wf_raw) if wf_raw else None
    except Exception:
        wf = None
    for n in (wf or {}).get("nodes") or []:
        if not isinstance(n, dict) or str(n.get("id")) in graph:
            continue
        t = str(n.get("type") or "")
        title = str(n.get("title") or t)
        if (_ENH.search(t) or _ENH.search(title)) and n.get("mode") in (2, 4):
            out.append({"title": title, "on": False, "values": {}})
    return out


def _node_values(graph):
    """The plain values of every other node a render went through, by node -
    so comparing two renders can say an enhancer was on in one and off, or
    bypassed, in the other. Long texts and links are left out."""
    out = {}
    taken = {k for k, _ in _SETTING_KEYS}
    for nid, n in graph.items():
        if not isinstance(n, dict):
            continue
        cls = str(n.get("class_type") or "")
        meta = n.get("_meta") if isinstance(n.get("_meta"), dict) else {}
        title = str(meta.get("title") or cls)
        if not cls or _NODE_SKIP.search(cls) or _NODE_SKIP.search(title):
            continue
        ins = n.get("inputs") or {}
        vals = {}
        for k, v in ins.items():
            if k in taken or _KEY_SKIP.search(k) or _linked(v):
                continue
            if isinstance(v, bool) or isinstance(v, (int, float)):
                vals[k] = v
            elif isinstance(v, str) and len(v) <= 40 and "\n" not in v:
                vals[k] = v
        out[str(nid)] = {"title": title, "values": vals}
    return out


# ------------------------------------------------------------- filtering
# The grid narrowed to the renders whose settings mention every word typed:
# a LoRA, a trigger word, a sampler, a word of the prompt, a folder. Each
# file's words are read once from its PNG and kept, keyed by its time.
_HAY = OrderedDict()
_HAY_LIMIT = 20000


def _haystack(path):
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return ""
    key = (path, mtime)
    hit = _HAY.get(key)
    if hit is not None:
        return hit
    m = _meta(path)
    parts = []
    if m.get("ok") and m.get("found"):
        for l in m.get("loras") or []:
            nm = os.path.splitext(os.path.basename(str(l.get("name") or "").replace("\\", "/")))[0]
            parts.append("%s %s" % (nm, l.get("strength")))
        parts.extend(str(t) for t in (m.get("triggers") or []))
        for st in m.get("settings") or []:
            parts.append("%s %s" % (st.get("label"), st.get("value")))
        parts.extend([str(m.get("prompt_name") or ""), str(m.get("series_name") or ""),
                      str(m.get("prompt") or "")])
    hay = " | ".join(parts).lower()
    _HAY[key] = hay
    if len(_HAY) > _HAY_LIMIT:
        _HAY.popitem(last=False)
    return hay


def _filter_body(raw, deep, query):
    """The names in a folder - as the list gives them - whose render matches
    every word of the query. A word starting with "-" must not match."""
    roots = _multi(raw)
    if roots is not None:
        names, total, words = [], 0, ""
        for tag, d in roots:
            j = _filter_body(d, True, query)
            if not j.get("ok"):
                continue
            names += [_tag(n, tag) for n in j.get("names") or []]
            total += j.get("total") or 0
            words = j.get("query") or words
        return {"ok": True, "names": names, "total": total, "query": words}
    path, err = _folder(raw)
    if err:
        return {"ok": False, "error": err}
    words = [w for w in str(query or "").lower().split() if w and w != "-"]
    try:
        names = sorted(os.listdir(path), key=lambda n: n.lower())
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    names = [n for n in names if os.path.splitext(n)[1].lower() in VALID_EXT
             and os.path.isfile(os.path.join(path, n))]
    if deep or not names:
        names = _deep_names(path, _DEEP_CAP)
    want = [w for w in words if not w.startswith("-")]
    avoid = [w[1:] for w in words if w.startswith("-")]
    out = []
    for name in names:
        full = os.path.join(path, *name.split("/"))
        hay = name.lower() + " | " + _haystack(full)
        if all(w in hay for w in want) and not any(w in hay for w in avoid):
            out.append(name)
    return {"ok": True, "names": out, "total": len(names), "query": " ".join(words)}


def _clip_body(folder, name, local):
    """Ctrl+C on a picture: the file itself on the clipboard, when a desktop
    helper is there to put it (see _desktop). Otherwise the browser copies
    the picture alone."""
    path = _locate(folder, name)
    if not path:
        return {"ok": False, "error": "not found"}
    hook = _desktop("clipboard")
    if not hook:
        return {"ok": False, "why": "browser"}
    if not local:
        return {"ok": False, "why": "remote"}
    try:
        hook(path)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True}


# ------------------------------------------------------------------ copying
def _copy_body(folder, names, dest, move=False, rename=None):
    """The picks into another folder - one folder, side by side, whatever
    folders they came from. A picture already there under the same name
    and size is left alone; a different one with that name gets " (2)".
    Moving carries the pick along; copying leaves the copy unpicked.
    rename, when given, is the name each one should take there - an undo
    putting a picture back under the name it had."""
    roots = _multi(folder)
    if roots is not None:
        known = dict(roots)
        rename = rename if isinstance(rename, list) else []
        groups = OrderedDict()
        for i, n in enumerate(names or []):
            plain, tag = _untag(n)
            if tag in known:
                g = groups.setdefault(tag, ([], []))
                g[0].append(plain)
                g[1].append(rename[i] if i < len(rename) else None)
        dest_s = str(dest or "").strip().strip('"').strip("'")
        out = {"ok": True, "count": 0, "there": 0, "failed": [], "dest": dest_s, "pairs": []}
        for tag, (plain, ren) in groups.items():
            j = _copy_body(known[tag], plain, dest_s, move, ren)
            if not j.get("ok"):
                return dict(j, pairs=out["pairs"])
            out["count"] += j.get("count") or 0
            out["there"] += j.get("there") or 0
            out["failed"] += j.get("failed") or []
            for pr in j.get("pairs") or []:
                out["pairs"].append({"name": _tag(pr["name"], tag), "to": pr["to"]})
        return out
    path, err = _folder(folder)
    if err:
        return {"ok": False, "error": err}
    dest = str(dest or "").strip().strip('"').strip("'")
    if MULTI_MARK in dest:
        return {"ok": False, "error": "choose one folder to copy into", "dest": dest}
    if not dest or not os.path.isabs(dest):
        return {"ok": False, "error": "choose a folder to copy into"}
    dest = os.path.normpath(dest)
    if not _allowed(dest):
        return {"ok": False, "error": "outside the folders this viewer may open", "dest": dest}
    try:
        os.makedirs(dest, exist_ok=True)
    except OSError as exc:
        return {"ok": False, "error": str(exc), "dest": dest}
    picks = _picks()
    done, there, failed, add, drop, pairs = [], 0, [], [], [], []
    rename = rename if isinstance(rename, list) else []
    for i, name in enumerate(names or []):
        src = _locate(folder, name)
        if not src:
            continue
        base = os.path.basename(src)
        want = rename[i] if i < len(rename) else None
        if isinstance(want, str) and want and os.path.basename(want) == want and want not in (".", ".."):
            base = want
        to = os.path.join(dest, base)
        if os.path.exists(to):
            try:
                same = _key(to) == _key(src) or os.path.getsize(to) == os.path.getsize(src)
            except OSError:
                same = False
            # moving never leaves a picture behind: one of the same name
            # goes in beside it under " (2)" rather than staying put
            if same and not move:
                there += 1
                continue
            to = os.path.join(dest, _free_name(dest, base))
        key = _key(src)
        try:
            if move:
                shutil.move(src, to)
                if key in picks:
                    drop.append(key)
                    add.append(_key(to))
            else:
                shutil.copy2(src, to)
        except OSError as exc:
            failed.append("%s: %s" % (base, exc))
            continue
        done.append(os.path.basename(to))
        pairs.append({"name": name, "to": os.path.basename(to)})
    if add or drop:
        _set_picks(add=add, remove=drop)
    return {"ok": True, "count": len(done), "there": there, "failed": failed,
            "dest": dest, "pairs": pairs}


# ------------------------------------------------------------------ listing
_SIZES = OrderedDict()
_cache_lock = threading.Lock()


def _cache_get(cache, key):
    with _cache_lock:
        v = cache.get(key)
        if v is not None:
            cache.move_to_end(key)
        return v


def _cache_put(cache, key, value, limit):
    with _cache_lock:
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > limit:
            cache.popitem(last=False)


def _size(path, mtime):
    """Width and height as shown, EXIF turn included - header only."""
    key = (path, mtime)
    hit = _cache_get(_SIZES, key)
    if hit is not None:
        return hit
    try:
        with Image.open(path) as im:
            w, h = im.size
            # The turn a camera writes into EXIF. Only where it is read from
            # the header: asking a PNG for its EXIF makes Pillow decode the
            # whole picture to look for it - seconds over a folder of renders,
            # for a tag a render never carries.
            try:
                if im.format in ("JPEG", "MPO", "WEBP", "TIFF"):
                    turn = im.getexif().get(274)
                else:
                    turn = None
                if turn in (5, 6, 7, 8):
                    w, h = h, w
            except Exception:
                pass
    except Exception:
        w, h = 0, 0
    _cache_put(_SIZES, key, (w, h), 20000)
    return w, h


_DEEP_CAP = 5000              # pictures listed from a folder's subfolders


def _deep_names(folder, cap):
    """Every picture below a folder, as "/"-joined paths from it, in folder
    then name order. Hidden folders, the trash and the like are left out."""
    out = []
    for here, dirs, files in os.walk(folder):
        dirs[:] = sorted((d for d in dirs
                          if not d.startswith(".") and not d.startswith("_")
                          and d.lower() not in _SKIP_DIRS),
                         key=lambda d: d.lower())
        rel = os.path.relpath(here, folder)
        for f in sorted(files, key=lambda f: f.lower()):
            if os.path.splitext(f)[1].lower() not in VALID_EXT:
                continue
            out.append(f if rel == "." else rel.replace(os.sep, "/") + "/" + f)
            if len(out) >= cap:
                return out
    return out


def _trash_names(path, cap):
    """The pictures waiting in the _deleted folders of a folder and of the
    folders inside it, as "/"-joined paths from it - "_deleted/a.png",
    "Scene 2/_deleted/b.png". Nothing outside the folder on show."""
    out = []
    for d in _trash_dirs(path):
        if not _allowed(d):
            continue
        rel = os.path.relpath(d, path).replace(os.sep, "/")
        try:
            files = sorted(os.listdir(d), key=lambda f: f.lower())
        except OSError:
            continue
        for f in files:
            if os.path.splitext(f)[1].lower() in VALID_EXT and os.path.isfile(os.path.join(d, f)):
                out.append(rel + "/" + f)
                if len(out) >= cap:
                    return out
    return out


def _bin_name(name):
    """True for a name that points into a _deleted folder."""
    parts = str(name or "").replace("\\", "/").split("/")
    return len(parts) >= 2 and parts[-2] == TRASH_DIR and _plain_name("/".join(parts))


def _untrash_body(folder, names):
    """Out of the bin, back into the folder its _deleted folder sits in. A
    name taken since gets a free one beside it, so nothing is overwritten."""
    roots = _multi(folder)
    if roots is not None:
        known, groups = _by_root(roots, names)
        back = []
        for tag, plain in groups.items():
            j = _untrash_body(known[tag], plain)
            back += [_tag(n, tag) for n in j.get("back") or []]
            if not j.get("ok"):
                return {"ok": False, "error": j.get("error"), "back": back}
        return {"ok": True, "back": back}
    path, err = _folder(folder)
    if err:
        return {"ok": False, "error": err}
    back = []
    for name in names or []:
        name = str(name or "").replace("\\", "/")
        if not _bin_name(name):
            continue
        src = _locate(folder, name)
        if not src:
            continue
        bin_dir = os.path.dirname(src)
        home = os.path.dirname(bin_dir)
        if not _allowed(home):
            continue
        to = _free_name(home, os.path.basename(src))
        try:
            os.replace(src, os.path.join(home, to))
        except OSError as exc:
            return {"ok": False, "error": str(exc), "back": back}
        try:
            os.rmdir(bin_dir)                    # only when it is now empty
        except OSError:
            pass
        rel = os.path.relpath(home, path).replace(os.sep, "/")
        back.append(to if rel == "." else rel + "/" + to)
    return {"ok": True, "back": back}


def _purge_body(folder, names):
    """Single pictures out of the bin for good - to the Recycle Bin where
    there is one."""
    roots = _multi(folder)
    if roots is not None:
        known, groups = _by_root(roots, names)
        count, how = 0, _bin_kind()
        for tag, plain in groups.items():
            j = _purge_body(known[tag], plain)
            if not j.get("ok"):
                return j
            count += j.get("count") or 0
        return {"ok": True, "count": count, "how": how}
    path, err = _folder(folder)
    if err:
        return {"ok": False, "error": err}
    files = []
    for name in names or []:
        name = str(name or "").replace("\\", "/")
        if _bin_name(name):
            full = _locate(folder, name)
            if full:
                files.append(full)
    how = _bin_kind()
    if not files:
        return {"ok": True, "count": 0, "how": how}
    try:
        to_bin = _send2trash()
        recycle = _desktop("recycle")
        if to_bin:
            for f in files:
                to_bin(f)
        elif recycle:
            recycle(files)
        else:
            for f in files:
                os.remove(f)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    for d in {os.path.dirname(f) for f in files}:
        try:
            os.rmdir(d)
        except OSError:
            pass
    return {"ok": True, "count": len(files), "how": how}


def _list_body(raw, deep=False, thumb=0, newest=False, trash_view=False):
    roots = _multi(raw)
    if roots is not None:
        return _multi_list(raw, roots, thumb, newest, trash_view)
    path, err = _folder(raw)
    if err:
        return {"ok": False, "error": err, "path": path}
    items = []
    try:
        names = sorted(os.listdir(path), key=lambda n: n.lower())
    except OSError as exc:
        return {"ok": False, "error": str(exc), "path": path}
    names = [n for n in names if os.path.splitext(n)[1].lower() in VALID_EXT
             and os.path.isfile(os.path.join(path, n))]
    # A folder that only holds folders - a day of renders sorted by scene -
    # is shown with its subfolders even when they were not asked for: an
    # empty grid would say there is nothing here, which is not true.
    went_deep = bool(deep) or not names
    if trash_view:
        # the bin of the folder on show: its own _deleted folder and those of
        # the folders inside it, and nothing else
        names = _trash_names(path, _DEEP_CAP)
        went_deep = True
    elif went_deep:
        names = _deep_names(path, _DEEP_CAP)
    picks = _picks()
    base = _key(path) if picks else ""
    for name in names:
        p = os.path.join(path, *name.split("/"))
        try:
            if not os.path.isfile(p):
                continue
            st = os.stat(p)
            mtime = st.st_mtime
        except OSError:
            continue
        w, h = _size(p, mtime)
        # b: bytes, for the list view
        item = {"name": name, "v": int(mtime), "t": mtime, "w": w, "h": h, "b": st.st_size}
        if picks and os.path.normcase(os.path.join(base, *name.split("/"))) in picks:
            item["p"] = 1
        items.append(item)
    # thumbnails not made yet are made in the background, in the order the
    # grid will show them
    if thumb:
        order = sorted(items, key=lambda it: (os.path.dirname(it["name"]).lower(),
                                              -it["t"] if newest else 0,
                                              it["name"].lower()))
        _warm([os.path.join(path, *it["name"].split("/")) for it in order],
              _thumb_side(thumb))
    # what is waiting in _deleted folders here - shown so it can be emptied
    trash = 0
    if trash_view:
        trash = len(items)
    else:
        for d in (_trash_dirs(path) if went_deep else [os.path.join(path, TRASH_DIR)]):
            trash += _count_files(d)
    # the same folder as a path from output, when it is in there - what the
    # folder box shows after FOLLOW has moved to a render's folder
    rel = None
    try:
        out = folder_paths.get_output_directory()
        if _key(path) == _key(out):
            rel = ""
        elif _key(path).startswith(_key(out).rstrip(os.sep) + os.sep):
            rel = os.path.relpath(path, out)
    except Exception:
        rel = None
    return {"ok": True, "path": path, "rel": rel, "items": items,
            "deep": went_deep, "capped": went_deep and len(names) >= _DEEP_CAP,
            "trash": trash, "bin": _bin_kind() if trash else ""}


# ------------------------------------------------------------- thumbnails
_THUMBS = OrderedDict()
_VIEWS = OrderedDict()
_THUMB_LIMIT = 3000
_VIEW_LIMIT = 16

# Thumbnails come in a few sizes only, so a thumbnail made once serves every
# size of grid near it - the browser scales the rest.
_THUMB_SIZES = (256, 384, 512, 768)
_THUMB_QUALITY = 84
THUMB_CACHE_DIRNAME = "thumbs"
_THUMB_CACHE_CAP = 40000      # files kept on disk; the oldest go past this
# Making a thumbnail is mostly decoding the PNG, which Pillow does with the
# interpreter lock let go - so more workers really do make more at once. A
# couple of cores are left for ComfyUI itself.
_WARM_WORKERS = max(2, min(8, (os.cpu_count() or 4) - 2))


def _encode(path, max_side, quality):
    with Image.open(path) as im:
        if im.format == "JPEG":
            try:
                im.draft("RGB", (max_side, max_side))
            except Exception:
                pass
        im = ImageOps.exif_transpose(im)
        # made small first and turned to RGB after: converting the whole
        # render first would be work spent on pixels about to be dropped
        if im.mode not in ("RGB", "RGBA", "L", "LA"):
            im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
        try:
            im.thumbnail((max_side, max_side), Image.LANCZOS, reducing_gap=2.0)
        except TypeError:
            im.thumbnail((max_side, max_side), Image.LANCZOS)
        if im.mode != "RGB":
            im = im.convert("RGB")
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality, optimize=False)
        return buf.getvalue()


def _thumb_from_image(img, side, quality):
    """A thumbnail from a picture already in memory - the same as _encode
    makes from the file, without reading it back."""
    im = img.copy()
    if im.mode not in ("RGB", "RGBA", "L", "LA"):
        im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
    try:
        im.thumbnail((side, side), Image.LANCZOS, reducing_gap=2.0)
    except TypeError:
        im.thumbnail((side, side), Image.LANCZOS)
    if im.mode != "RGB":
        im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality, optimize=False)
    return buf.getvalue()


# The sizes a grid asks for at the usual thumbnail sizes and screens - made
# the moment a render is saved, so a folder of new renders opens at once.
_SAVE_THUMB_SIDES = (256, 384)


def prewarm_saved(path, img):
    """Called by Visual Save Image once a file is written: its thumbnails go
    into the cache straight from the picture in memory."""
    try:
        mtime = os.path.getmtime(path)
        w, h = img.size
        _cache_put(_SIZES, (path, mtime), (w, h), 20000)
        for side in _SAVE_THUMB_SIDES:
            body = _thumb_from_image(img, side, _THUMB_QUALITY)
            cache = _thumb_cache_file(path, mtime, side)
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            tmp = cache + ".%d.tmp" % threading.get_ident()
            with open(tmp, "wb") as f:
                f.write(body)
            os.replace(tmp, cache)
            _cache_put(_THUMBS, (path, mtime, side), body, _THUMB_LIMIT)
    except Exception:
        pass


def _bucket(value, default, low, high, step):
    try:
        size = max(low, min(high, int(value)))
    except (TypeError, ValueError):
        size = default
    return max(low, min(high, ((size + step - 1) // step) * step))


def _thumb_side(value):
    """The thumbnail size asked for, raised to the next one that is made."""
    try:
        want = int(value)
    except (TypeError, ValueError):
        want = _THUMB_SIZES[0]
    for s in _THUMB_SIZES:
        if s >= want:
            return s
    return _THUMB_SIZES[-1]


# Thumbnails are also kept on disk, so a folder looked at yesterday opens at
# once today, after a restart too. Named after the picture's path, its time
# and the size - a picture changed or replaced gets a new thumbnail.
def _thumb_cache_dir():
    return os.path.join(_user_dir(), ALLOW_DIRNAME, THUMB_CACHE_DIRNAME)


def _thumb_cache_file(path, mtime, side):
    h = hashlib.sha1(("%s|%r|%d" % (_key(path), mtime, side)).encode("utf-8")).hexdigest()
    return os.path.join(_thumb_cache_dir(), h[:2], h + ".jpg")


_inflight = {}
_inflight_lock = threading.Lock()
_written = [0]


def _thumb(path, mtime, side):
    """The thumbnail's bytes: from memory, from disk, or made now - and made
    once even when the browser and the background ask for it together."""
    key = (path, mtime, side)
    body = _cache_get(_THUMBS, key)
    if body is not None:
        return body
    cache = _thumb_cache_file(path, mtime, side)
    while True:
        with _inflight_lock:
            ev = _inflight.get(key)
            if ev is None:
                ev = threading.Event()
                _inflight[key] = ev
                mine = True
            else:
                mine = False
        if mine:
            break
        ev.wait(30)
        body = _cache_get(_THUMBS, key)
        if body is not None:
            return body
    try:
        try:
            with open(cache, "rb") as f:
                body = f.read()
        except OSError:
            body = None
        if not body:
            body = _encode(path, side, _THUMB_QUALITY)
            try:
                os.makedirs(os.path.dirname(cache), exist_ok=True)
                tmp = cache + ".%d.tmp" % threading.get_ident()
                with open(tmp, "wb") as f:
                    f.write(body)
                os.replace(tmp, cache)
                _written[0] += 1
                if _written[0] % 500 == 0:
                    _prune_thumbs()
            except OSError:
                pass
        _cache_put(_THUMBS, key, body, _THUMB_LIMIT)
        return body
    finally:
        with _inflight_lock:
            _inflight.pop(key, None)
        ev.set()


def _prune_thumbs():
    """Past the cap, the thumbnails not looked at longest are let go."""
    root = _thumb_cache_dir()
    files = []
    try:
        for d in os.scandir(root):
            if not d.is_dir():
                continue
            for e in os.scandir(d.path):
                try:
                    st = e.stat()
                    files.append((max(st.st_atime, st.st_mtime), e.path))
                except OSError:
                    continue
    except OSError:
        return
    over = len(files) - int(_THUMB_CACHE_CAP * 0.85)
    if len(files) <= _THUMB_CACHE_CAP or over <= 0:
        return
    files.sort()
    for _t, p in files[:over]:
        try:
            os.remove(p)
        except OSError:
            pass


# The background: when a folder is listed, the thumbnails it has not got yet
# are made in the order the grid shows them, a couple at a time, while the
# browser asks for the ones on screen. Scrolling down then finds them ready.
# A folder opened later takes the place of the one being worked through.
_warm_lock = threading.Condition()
_warm_queue = []
_warm_started = [False]
_warm_last = [None]


def _warm(paths, side):
    # the same folder listed again by the quiet rescan: leave the work as it is
    sig = (side, len(paths), paths[0] if paths else "", paths[-1] if paths else "")
    if sig == _warm_last[0]:
        return
    _warm_last[0] = sig
    with _warm_lock:
        _warm_queue[:] = [(p, side) for p in paths]
        if not _warm_started[0]:
            _warm_started[0] = True
            for _ in range(_WARM_WORKERS):
                threading.Thread(target=_warm_worker, daemon=True,
                                 name="leiel-viewer-thumbs").start()
        _warm_lock.notify_all()


def _warm_worker():
    while True:
        with _warm_lock:
            while not _warm_queue:
                _warm_lock.wait()
            path, side = _warm_queue.pop(0)
        try:
            mtime = os.path.getmtime(path)
            if (_cache_get(_THUMBS, (path, mtime, side)) is None
                    and not os.path.exists(_thumb_cache_file(path, mtime, side))):
                _thumb(path, mtime, side)
        except Exception:
            continue


# ----------------------------------------------------------------- browse
_SKIP_DIRS = {"$recycle.bin", "system volume information", "__pycache__",
              "node_modules", ".git"}
_COUNT_CAP = 20000
_PREVIEW_CAP = 1000


def _visible_dir(entry):
    if (entry.name.startswith(".") or entry.name == TRASH_DIR
            or entry.name.lower() in _SKIP_DIRS):
        return False
    try:
        return entry.is_dir()
    except OSError:
        return False


def _count_images(folder, sample=0):
    n, names = 0, []
    try:
        with os.scandir(folder) as it:
            for e in it:
                try:
                    if (os.path.splitext(e.name)[1].lower() in VALID_EXT
                            and e.is_file()):
                        n += 1
                        if sample:
                            names.append(e.name)
                except OSError:
                    continue
                if n >= _COUNT_CAP:
                    break
    except OSError:
        return 0, []
    names.sort(key=lambda s: s.lower())
    return n, names[:sample]


def _scan(folder):
    n = subs = 0
    try:
        with os.scandir(folder) as it:
            for e in it:
                try:
                    if os.path.splitext(e.name)[1].lower() in VALID_EXT:
                        if e.is_file():
                            n += 1
                    elif _visible_dir(e):
                        subs += 1
                except OSError:
                    continue
                if n >= _COUNT_CAP:
                    break
    except OSError:
        pass
    return n, subs


# ------------------------------------------------------------ merging folders
# Several folders made into one - the same project rendered over several
# days, say. Everything inside each is moved into the one chosen to keep, at
# the same place below it; a name already taken there gets " (1)", " (2)"
# on the end, the way Windows does it, so nothing is ever written over.
# Every folder left empty afterwards is removed, up to - never including -
# the places the viewer may open. Picks follow their pictures.
_JUNK = {"thumbs.db", "desktop.ini", ".ds_store"}


def _free_win(folder, name):
    """name, or "name (1).ext", "name (2).ext" ... - the first one free."""
    full = os.path.join(folder, name)
    if not os.path.lexists(full):
        return full
    stem, ext = os.path.splitext(name)
    n = 1
    while True:
        full = os.path.join(folder, "%s (%d)%s" % (stem, n, ext))
        if not os.path.lexists(full):
            return full
        n += 1


def _empty_dir(path):
    """True for a folder holding nothing but system clutter - which goes."""
    try:
        names = os.listdir(path)
    except OSError:
        return False
    if any(n.lower() not in _JUNK for n in names):
        return False
    for n in names:
        try:
            os.remove(os.path.join(path, n))
        except OSError:
            return False
    return True


def _prune(top, stop_keys):
    """Remove every empty folder at and below top, deepest first."""
    removed = 0
    for dirpath, dirs, files in os.walk(top, topdown=False, followlinks=False):
        if _key(dirpath) in stop_keys or os.path.islink(dirpath):
            continue
        if _empty_dir(dirpath):
            try:
                os.rmdir(dirpath)
                removed += 1
            except OSError:
                pass
    return removed


def _merge_body(sources, target):
    tgt = resolve(str(target or "").strip().strip('"').strip("'"))
    if not tgt or not os.path.isdir(tgt) or not _allowed(tgt):
        return {"ok": False, "error": "the folder to keep is not there"}
    tk = _key(tgt)
    roots = {_key(r) for _l, r in _roots()}
    if tk in roots:
        return {"ok": False, "error": "choose a folder inside, not a top folder"}
    srcs, seen = [], {tk}
    for raw in sources or []:
        p = resolve(str(raw or "").strip().strip('"').strip("'"))
        if not p or not os.path.isdir(p) or not _allowed(p):
            continue
        k = _key(p)
        if k in seen:
            continue
        if k in roots:
            return {"ok": False, "error": "a top folder cannot be merged away"}
        if tk.startswith(k.rstrip(os.sep) + os.sep) or k.startswith(tk.rstrip(os.sep) + os.sep):
            return {"ok": False, "error": "one folder is inside the other: %s" % os.path.basename(p)}
        seen.add(k)
        srcs.append(p)
    if not srcs:
        return {"ok": False, "error": "nothing to merge"}
    picks = _picks()
    moved = renamed = removed = 0
    failed, pick_add, pick_rem = [], [], []
    stop = roots | {tk}
    for src in srcs:
        for dirpath, dirs, files in os.walk(src, topdown=True, followlinks=False):
            dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(dirpath, d))]
            rel = os.path.relpath(dirpath, src)
            dst_dir = tgt if rel == "." else os.path.join(tgt, rel)
            for fn in files:
                if fn.lower() in _JUNK:
                    continue
                s_path = os.path.join(dirpath, fn)
                try:
                    os.makedirs(dst_dir, exist_ok=True)
                    d_path = _free_win(dst_dir, fn)
                    shutil.move(s_path, d_path)
                except OSError as e:
                    failed.append("%s: %s" % (os.path.relpath(s_path, src), e))
                    continue
                moved += 1
                if os.path.basename(d_path) != fn:
                    renamed += 1
                k = os.path.normcase(os.path.realpath(s_path))
                if k in picks or os.path.normcase(s_path) in picks:
                    pick_rem.append(k)
                    pick_add.append(_key(d_path))
        removed += _prune(src, stop)
        # and the folders it sat in, when they are left empty too
        up = os.path.dirname(src)
        while up and _allowed(up) and _key(up) not in stop and _empty_dir(up):
            try:
                os.rmdir(up)
                removed += 1
            except OSError:
                break
            nxt = os.path.dirname(up)
            if nxt == up:
                break
            up = nxt
    if pick_add:
        _set_picks(add=pick_add, remove=pick_rem)
    return {"ok": not failed or moved > 0, "moved": moved, "renamed": renamed,
            "removed": removed, "failed": failed[:20], "target": tgt}


def _browse_body(raw):
    """One level of the folder tree. Above the roots there is nothing: the
    top of the tree is the list of places this viewer may open."""
    roots = _roots()
    base = {"ok": True, "roots": [{"name": l, "path": p} for l, p in roots],
            "shortcuts": []}
    raw = str(raw or "").strip().strip('"').strip("'")
    path = resolve(raw) if raw else ""
    while path and not (os.path.isdir(path) and _allowed(path)):
        up = os.path.dirname(path.rstrip("\\/"))
        if not up or up == path:
            path = ""
            break
        path = up
    if not path:
        dirs = []
        for label, p in roots:
            try:
                mtime = int(os.path.getmtime(p))
            except OSError:
                mtime = 0
            d = {"name": label, "path": p, "mtime": mtime}
            d["images"], d["subs"] = _scan(p)
            dirs.append(d)
        return dict(base, path="", parent=None, dirs=dirs, images=0, sample=[])

    path = os.path.normpath(path)
    dirs = []
    try:
        with os.scandir(path) as it:
            entries = sorted(it, key=lambda e: e.name.lower())
    except OSError as exc:
        return dict(base, ok=False, error=str(exc), path=path)
    for e in entries:
        if not _visible_dir(e):
            continue
        try:
            mtime = e.stat().st_mtime
        except OSError:
            mtime = 0
        dirs.append({"name": e.name, "path": os.path.join(path, e.name),
                     "mtime": int(mtime)})
    for d in dirs[:400]:
        d["images"], d["subs"] = _scan(d["path"])
    at_root = any(_key(path) == _key(p) for _l, p in roots)
    parent = "" if at_root else os.path.dirname(path.rstrip("\\/"))
    count, sample = _count_images(path, sample=_PREVIEW_CAP)
    body = dict(base, path=path, parent=parent, dirs=dirs, images=count,
                sample=sample)
    if not count:
        deep = _deep_names(path, _PREVIEW_CAP)
        if deep:
            body.update(deep=len(deep), sample=deep)
    return body


# ----------------------------------------------------- a series, found again
# When a series is opened in a Series Book, the viewer goes to its pictures.
# Where they were saved is whatever the filename was built to say, so the
# folders are searched for one carrying the series' name - spelled loosely,
# since a file name drops or swaps the characters a folder cannot hold.
_FIND_DEPTH = 5
_FIND_DIRS_MAX = 30000


def _loose(name):
    return "".join(ch for ch in str(name or "").lower() if ch.isalnum())


def _newest_inside(path):
    """The newest picture's time in a folder and the folders right inside
    it - which of several matches was worked on last."""
    best = 0.0
    try:
        with os.scandir(path) as it:
            for e in it:
                try:
                    if e.is_file() and os.path.splitext(e.name)[1].lower() in VALID_EXT:
                        best = max(best, e.stat().st_mtime)
                    elif _visible_dir(e):
                        with os.scandir(e.path) as it2:
                            for f in it2:
                                if f.is_file() and os.path.splitext(f.name)[1].lower() in VALID_EXT:
                                    best = max(best, f.stat().st_mtime)
                except OSError:
                    continue
    except OSError:
        pass
    return best


def _find_series_body(names):
    wanted = [(str(n), _loose(n)) for n in (names or []) if _loose(n)]
    if not wanted:
        return {"ok": False, "error": "no series name"}
    # input holds what goes into renders, not what comes out of them
    roots = [p for label, p in _roots() if label != "input"]
    found = {w: [] for _n, w in wanted}
    seen = 0
    for root in roots:
        stack = [(root, 0)]
        while stack and seen < _FIND_DIRS_MAX:
            path, depth = stack.pop()
            try:
                with os.scandir(path) as it:
                    subs = [e for e in it if _visible_dir(e)]
            except OSError:
                continue
            for e in subs:
                seen += 1
                key = _loose(e.name)
                if key in found:
                    found[key].append(e.path)
                if depth + 1 < _FIND_DEPTH:
                    stack.append((e.path, depth + 1))
    for name, w in wanted:
        hits = [p for p in found[w] if _allowed(p)]
        if not hits:
            continue
        hits.sort(key=_newest_inside, reverse=True)
        return {"ok": True, "series": name, "folder": hits[0],
                "others": len(hits) - 1}
    return {"ok": False, "series": wanted[0][0], "error": "no folder carries that name"}


# ------------------------------------------------------------------ routes
try:                                                 # pragma: no cover
    from aiohttp import web as _web
    from server import PromptServer as _PromptServer

    _routes = _PromptServer.instance.routes

    async def _json(request):
        try:
            return await request.json()
        except Exception:
            return {}

    async def _run(fn, *args):
        return await asyncio.get_running_loop().run_in_executor(None, fn, *args)

    @_routes.post("/leiel_viewer/list")
    async def _viewer_list(request):
        data = await _json(request)
        return _web.json_response(await _run(_list_body, data.get("folder"),
                                             bool(data.get("deep")),
                                             data.get("thumb") or 0,
                                             bool(data.get("newest")),
                                             bool(data.get("trash"))))

    async def _serve(request, cache, limit, default, low, high, step, quality):
        q = request.rel_url.query
        path = _locate(q.get("folder"), q.get("name"))
        if path is None:
            return _web.Response(status=404, text="not found")
        size = _bucket(q.get("size"), default, low, high, step)
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            return _web.Response(status=404, text="not found")
        key = (path, mtime, size)
        body = _cache_get(cache, key)
        if body is None:
            try:
                body = await _run(_encode, path, size, quality)
            except Exception as exc:
                return _web.Response(status=500, text=str(exc))
            _cache_put(cache, key, body, limit)
        return _web.Response(body=body, content_type="image/jpeg",
                             headers={"Cache-Control": "private, max-age=86400"})

    @_routes.get("/leiel_viewer/thumb")
    async def _viewer_thumb(request):
        q = request.rel_url.query
        path = _locate(q.get("folder"), q.get("name"))
        if path is None:
            return _web.Response(status=404, text="not found")
        try:
            mtime = os.path.getmtime(path)
            body = await _run(_thumb, path, mtime, _thumb_side(q.get("size")))
        except Exception as exc:
            return _web.Response(status=500, text=str(exc))
        return _web.Response(body=body, content_type="image/jpeg",
                             headers={"Cache-Control": "private, max-age=86400"})

    @_routes.get("/leiel_viewer/view")
    async def _viewer_view(request):
        return await _serve(request, _VIEWS, _VIEW_LIMIT,
                            default=2048, low=512, high=4096, step=512, quality=92)

    @_routes.get("/leiel_viewer/raw")
    async def _viewer_raw(request):
        q = request.rel_url.query
        path = _locate(q.get("folder"), q.get("name"))
        if path is None:
            return _web.Response(status=404, text="not found")
        return _web.FileResponse(path, headers={
            "Cache-Control": "private, max-age=86400"})

    @_routes.get("/leiel_viewer/recent")
    async def _viewer_recent(request):
        return _web.json_response({"ok": True, "list": await _run(_recent)})

    @_routes.post("/leiel_viewer/recent")
    async def _viewer_push_recent(request):
        data = await _json(request)
        return _web.json_response({"ok": True, "list": await _run(_push_recent, (data or {}).get("path"))})

    @_routes.post("/leiel_viewer/find_series")
    async def _viewer_find_series(request):
        data = await _json(request)
        names = data.get("names")
        if not isinstance(names, list):
            names = []
        return _web.json_response(await _run(_find_series_body, [str(n) for n in names[:20]]))

    @_routes.post("/leiel_viewer/browse")
    async def _viewer_browse(request):
        data = await _json(request)
        return _web.json_response(await _run(_browse_body, data.get("path")))

    @_routes.post("/leiel_viewer/peek")
    async def _viewer_peek(request):
        data = await _json(request)
        path = os.path.normpath(str(data.get("path") or ""))
        if not os.path.isdir(path) or not _allowed(path):
            return _web.json_response({"ok": False, "error": "not a folder"})
        count, sample = await _run(_count_images, path, _PREVIEW_CAP)
        body = {"ok": True, "path": path, "images": count, "sample": sample}
        if not count:
            deep = await _run(_deep_names, path, _PREVIEW_CAP)
            if deep:
                body.update(deep=len(deep), sample=deep)
        return _web.json_response(body)

    @_routes.post("/leiel_viewer/merge")
    async def _viewer_merge(request):
        data = await _json(request)
        return _web.json_response(await _run(
            _merge_body, data.get("sources") or [], data.get("target")))

    @_routes.post("/leiel_viewer/pick")
    async def _viewer_pick(request):
        data = await _json(request)
        return _web.json_response(await _run(
            _pick_body, data.get("folder"), data.get("names") or [], bool(data.get("on"))))

    @_routes.post("/leiel_viewer/delete")
    async def _viewer_delete(request):
        data = await _json(request)
        return _web.json_response(await _run(
            _delete_body, data.get("folder"), data.get("names") or []))

    @_routes.post("/leiel_viewer/restore")
    async def _viewer_restore(request):
        data = await _json(request)
        return _web.json_response(await _run(
            _restore_body, data.get("folder"), data.get("items") or []))

    @_routes.post("/leiel_viewer/filter")
    async def _viewer_filter(request):
        data = await _json(request)
        return _web.json_response(await _run(
            _filter_body, data.get("folder"), bool(data.get("deep")), data.get("query")))

    @_routes.post("/leiel_viewer/untrash")
    async def _viewer_untrash(request):
        data = await _json(request)
        return _web.json_response(await _run(
            _untrash_body, data.get("folder"), data.get("names") or []))

    @_routes.post("/leiel_viewer/purge")
    async def _viewer_purge(request):
        data = await _json(request)
        return _web.json_response(await _run(
            _purge_body, data.get("folder"), data.get("names") or []))

    @_routes.post("/leiel_viewer/copy")
    async def _viewer_copy(request):
        data = await _json(request)
        return _web.json_response(await _run(
            _copy_body, data.get("folder"), data.get("names") or [],
            data.get("dest"), bool(data.get("move")), data.get("rename")))

    @_routes.get("/leiel_viewer/meta")
    async def _viewer_meta(request):
        q = request.rel_url.query
        path = _locate(q.get("folder"), q.get("name"))
        if path is None:
            return _web.json_response({"ok": False, "error": "not found"})
        return _web.json_response(await _run(_meta, path))

    @_routes.post("/leiel_viewer/clip")
    async def _viewer_clip(request):
        data = await _json(request)
        # only for a browser on this same computer - the clipboard filled is
        # this computer's, and nobody else's business
        local = (request.remote or "") in ("127.0.0.1", "::1", "localhost")
        return _web.json_response(await _run(
            _clip_body, data.get("folder"), data.get("name"), local))

    @_routes.post("/leiel_viewer/empty")
    async def _viewer_empty(request):
        data = await _json(request)
        return _web.json_response(await _run(_empty_body, data.get("folder")))

    @_routes.get("/leiel_viewer/roots")
    async def _viewer_roots(request):
        return _web.json_response({
            "ok": True, "roots": [{"name": l, "path": p} for l, p in _roots()],
            "allow_file": _allow_file()})
except Exception:                                    # pragma: no cover
    pass

_ensure_allow_file()


class LeielImageViewer:
    """A window onto a folder. With nothing wired in it never does anything;
    with images wired in it saves them first - exactly as Visual Save Image
    would, through Visual Save Image's own code - so a workflow needs no
    separate save node, and FOLLOW opens each picture as it lands."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "images": ("IMAGE",),
                # Sockets only, so the viewer keeps its face: the Filename
                # Manager's filename_prefix is meant to be wired in here.
                "filename_prefix": ("STRING", {"forceInput": True}),
                # Only when images are wired in. On, the five digit counter
                # SaveImage adds goes on the end of every name; off, the name
                # is written exactly as given.
                "sequence_number": ("BOOLEAN", {"default": True,
                                                "label_on": "name_00001_",
                                                "label_off": "name"}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "view"
    OUTPUT_NODE = True
    CATEGORY = "Studio Leiel"
    DESCRIPTION = (
        "Browse a folder of pictures as thumbnails and step through them "
        "large. Wire images in and it saves them as Visual Save Image does - "
        "the name from filename_prefix - and shows each one as it lands; or "
        "follow any save node instead. Opens ComfyUI's output and input "
        "folders, and any folder listed in "
        "user/visual_image_viewer/allowed_folders.txt."
    )

    def view(self, images=None, filename_prefix=None, sequence_number=True,
             prompt=None, extra_pnginfo=None):
        if images is None:
            return {}
        try:
            from ..save_image.visual_save_image import LeielSaveImage
        except Exception:                            # pragma: no cover
            from save_image.visual_save_image import LeielSaveImage
        # Only an explicit off turns the counter off. A stray value from a
        # shifted widget slot - a string, a number - falls back to the
        # default rather than quietly dropping the counter.
        counter = not (sequence_number is False
                       or str(sequence_number).strip().lower() in ("false", "0", "off"))
        out = LeielSaveImage().save(
            images, filename_prefix=filename_prefix or "Leiel",
            trailing_counter=counter,
            prompt=prompt, extra_pnginfo=extra_pnginfo)
        names = ", ".join(x["filename"] for x in out["ui"]["leielsave"])
        print("[Visual Image Viewer] saved %s (sequence %s, received %r)"
              % (names, "on" if counter else "off", sequence_number))
        # Only where it went: the viewer shows the picture itself, so the
        # frontend's own preview under the node is not asked for.
        return {"ui": {"leielsave": out["ui"]["leielsave"]}}


NODE_CLASS_MAPPINGS = {
    "LeielImageViewer": LeielImageViewer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LeielImageViewer": "Visual Image Viewer (Studio Leiel)",
}
