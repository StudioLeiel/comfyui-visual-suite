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

"""Visual Series Lab - Setup

Walks a series test on its own: one style LoRA at a time, one factor moved at
a time, the whole routine driven from a single node.

It deliberately does not sample, decode or save. The nodes that patch the
model and the conditioning stay on the canvas where they can be seen and
adjusted, and this node hands them a MODEL and a CONDITIONING that already
carry the configuration for this render.
"""

import json
import os
from urllib.parse import quote as _quote

from . import lab_core as core

try:
    import torch
except Exception:                                    # pragma: no cover
    torch = None


# How many named prompt sockets the node can grow. The face opens them one at
# a time as they are used, so this is a ceiling and not a row of empty holes -
# raised from six, which a single series of scenes filled up in an afternoon.
MAX_PROMPTS = 10

# Prompts from a Series Book arrive on the one "series" wire rather than on
# sockets, and the shelf numbers them past every socket so a recipe can name
# either kind with the same field: BOOK_SLOT_BASE + the prompt's own id in the
# book. The id never changes when prompts are reordered or renamed, so a
# recipe queued an hour ago still finds the scene it was built for.
BOOK_SLOT_BASE = 1000


KIND_ORDER = ("trigger", "quality", "subject", "outfit", "pose", "scene", "camera",
              "absolute")


def _book_swap(series, pid, swap):
    """A book prompt with capsules put in place of the ones of their kind.

    The capsule sweep: the same scene rendered once per camera, per light, per
    pose - or per combination of them, a pose from one series with a camera
    from another. The prompt's own parts are joined exactly as the book joins
    them, with each capsule standing where its kind stands - or, when the
    prompt has nothing of that kind, where that kind belongs. A kind the swap
    does not name keeps the prompt's own part.

    `swap` is {"caps": [{"kind", "cap"}, ...]}, or a single {"kind", "cap"}
    as recipes queued before combinations sent it."""
    if not isinstance(series, dict) or not isinstance(swap, dict):
        return None
    prompts = series.get("prompts") or []
    caps = series.get("caps") or {}
    p = next((q for q in prompts if isinstance(q, dict) and q.get("id") == pid), None)
    if not p or not isinstance(p.get("parts"), list) or not isinstance(caps, dict):
        return None
    wanted = swap.get("caps") if isinstance(swap.get("caps"), list) else [swap]
    parts = [dict(x) for x in p["parts"] if isinstance(x, dict)]
    used = 0
    for one in wanted:
        if not isinstance(one, dict):
            continue
        cap = caps.get(str(one.get("cap")))
        if not isinstance(cap, dict):
            continue
        kind = str(one.get("kind") or cap.get("kind") or "")
        mine = {"kind": kind, "body": cap.get("body")}
        at = next((i for i, x in enumerate(parts) if x.get("kind") == kind), -1)
        if at >= 0:
            parts[at] = mine
        else:
            rank = KIND_ORDER.index(kind) if kind in KIND_ORDER else len(KIND_ORDER)
            at = next((i for i, x in enumerate(parts)
                       if x.get("kind") in KIND_ORDER
                       and KIND_ORDER.index(x.get("kind")) > rank), len(parts))
            parts.insert(at, mine)
        used += 1
    if not used:
        return None
    sep = str(series.get("sep") if series.get("sep") is not None else "\n\n")
    skip = series.get("skip_empty", True)
    bodies = [x.get("body") for x in parts if x.get("body") is not None]
    if skip:
        bodies = [b for b in bodies if b]
    return sep.join(bodies)


def _from_book(series, pid, name):
    """The text of one prompt in a Series Book, by id and failing that by name."""
    prompts = series.get("prompts") if isinstance(series, dict) else None
    if not isinstance(prompts, list):
        return None
    for p in prompts:
        if isinstance(p, dict) and p.get("id") == pid:
            return str(p.get("text") or "")
    if name:
        for p in prompts:
            if isinstance(p, dict) and str(p.get("name") or "") == name:
                return str(p.get("text") or "")
    return None


# --------------------------------------------------------------------------
# thumbnails
#
# The loaders keep a preview image beside the LoRA file itself, named after
# it. Reading that directly means the chip strip can show real thumbnails
# without depending on any particular loader extension staying installed or
# keeping its routes.
# --------------------------------------------------------------------------

IMG_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif")
MODEL_EXTS = (".safetensors", ".pt", ".ckpt")


def _norm(path):
    return str(path or "").replace("\\", "/").replace("#", "/")


def _preview_for(lora_rel):
    """The picture that sits beside a LoRA file, as an absolute path.

    Resolved from the LoRA's own path rather than by asking folder_paths for
    the image: that call only answers for model extensions in recent ComfyUI
    versions, so every .jpeg lookup came back empty and no thumbnail ever
    appeared.
    """
    import folder_paths
    try:
        model_path = folder_paths.get_full_path("loras", lora_rel)
    except Exception:
        model_path = None
    if not model_path:
        return None
    folder = os.path.dirname(str(model_path))
    base = os.path.splitext(os.path.basename(str(model_path)))[0]
    stems = [base + ".thumb", base + ".preview", base,
             base + "_thumb", base + "_preview"]
    for stem in stems:
        for ext in IMG_EXTS:
            for spelling in (ext, ext.upper()):
                candidate = os.path.join(folder, stem + spelling)
                if os.path.isfile(candidate):
                    return candidate
    return None


# "tags" is deliberately absent: it holds a model's descriptive tags, not
# words meant to be typed into a prompt, and picking it up dragged unrelated
# terms into every file.
TRIGGER_KEYS = ("trainedWords", "trained_words", "activation text",
                "activation_text", "activationText", "trigger_words",
                "triggerWords")


def _words_from(obj, depth=0):
    """Trigger words out of whatever shape the metadata file happens to be.

    Every downloader writes these differently - a list under trainedWords, a
    comma separated string under "activation text", or nested inside a civitai
    block - so look for any of the usual keys at any depth rather than
    insisting on one layout.
    """
    out = []
    if depth > 4 or obj is None:
        return out
    if isinstance(obj, dict):
        for key, val in obj.items():
            if key in TRIGGER_KEYS:
                if isinstance(val, str):
                    out.extend(w.strip() for w in val.split(","))
                elif isinstance(val, list):
                    for v in val:
                        if isinstance(v, str):
                            out.extend(w.strip() for w in v.split(","))
            else:
                out.extend(_words_from(val, depth + 1))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(_words_from(v, depth + 1))
    seen, kept = set(), []
    for w in out:
        w = w.strip()
        if not w or w.lower() in seen:
            continue
        seen.add(w.lower())
        kept.append(w)
    return kept


def _triggers_for(lora_rel):
    """The words filed beside a LoRA, if any."""
    import folder_paths
    try:
        model_path = folder_paths.get_full_path("loras", lora_rel)
    except Exception:
        model_path = None
    if not model_path:
        return []
    folder = os.path.dirname(str(model_path))
    base = os.path.splitext(os.path.basename(str(model_path)))[0]
    for name in (base + ".metadata.json", base + ".civitai.info",
                 base + ".info.json", base + ".json"):
        path = os.path.join(folder, name)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return _words_from(json.load(fh))
        except Exception:
            continue
    return []


# --------------------------------------------------------------------------
# example pictures
#
# Beside the one preview a LoRA keeps, the downloaders file the model page's
# sample pictures: their web addresses in the metadata file, and - when LoRA
# Manager has been told to fetch them - copies on disk in a folder named after
# the file's hash. The hover card shows these as a strip under the preview.
# --------------------------------------------------------------------------

EXAMPLE_MAX = 16
VIDEO_EXTS = (".mp4", ".webm", ".mov", ".gif")


def _meta_for(lora_rel):
    """The metadata file beside a LoRA, read, with its folder and base name."""
    import folder_paths
    try:
        model_path = folder_paths.get_full_path("loras", lora_rel)
    except Exception:
        model_path = None
    if not model_path:
        return None, None
    folder = os.path.dirname(str(model_path))
    base = os.path.splitext(os.path.basename(str(model_path)))[0]
    for name in (base + ".metadata.json", base + ".civitai.info",
                 base + ".info.json", base + ".json"):
        path = os.path.join(folder, name)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh), str(model_path)
        except Exception:
            continue
    return None, str(model_path)


def _web_images(meta):
    """Sample picture addresses out of LoRA Manager or Civitai metadata."""
    if not isinstance(meta, dict):
        return []
    lists = []
    civ = meta.get("civitai")
    if isinstance(civ, dict) and isinstance(civ.get("images"), list):
        lists.append(civ["images"])
    if isinstance(meta.get("images"), list):
        lists.append(meta["images"])
    out = []
    for lst in lists:
        for im in lst:
            url = im.get("url") if isinstance(im, dict) else im
            kind = str(im.get("type") or "") if isinstance(im, dict) else ""
            if not isinstance(url, str) or not url.startswith(("http://", "https://")):
                continue
            if kind == "video" or url.split("?")[0].lower().endswith(VIDEO_EXTS):
                continue
            if url not in out:
                out.append(url)
    return out


def _example_roots():
    """Where LoRA Manager keeps downloaded example pictures, if it says."""
    import folder_paths
    roots = []
    candidates = []
    try:
        custom = os.path.join(os.path.dirname(folder_paths.__file__), "custom_nodes")
        for d in os.listdir(custom):
            if "lora" in d.lower() and "manager" in d.lower():
                candidates.append(os.path.join(custom, d, "settings.json"))
    except Exception:
        pass
    try:
        user = folder_paths.get_user_directory()
        for sub in ("", "default", "ComfyUI-Lora-Manager", "lora-manager"):
            candidates.append(os.path.join(user, sub, "settings.json"))
    except Exception:
        pass
    for path in candidates:
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                cfg = json.load(fh)
        except Exception:
            continue
        val = cfg.get("example_images_path") if isinstance(cfg, dict) else None
        if isinstance(val, str) and val and os.path.isdir(val) and val not in roots:
            roots.append(val)
    return roots


def _local_examples(meta):
    """Downloaded example pictures, as absolute paths."""
    sha = str((meta or {}).get("sha256") or "").lower() if isinstance(meta, dict) else ""
    if not sha:
        return []
    out = []
    for root in _example_roots():
        folder = os.path.join(root, sha)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if os.path.splitext(name)[1].lower() in IMG_EXTS and \
                    os.path.splitext(name)[1].lower() != ".gif":
                out.append(os.path.join(folder, name))
        if out:
            break
    return out


def _examples_for(lora_rel):
    """Every sample picture of a LoRA: local copies first, then web ones."""
    meta, _ = _meta_for(lora_rel)
    local = _local_examples(meta)
    pics = ["/visual_series_lab/example?lora=" + _quote(lora_rel) + "&i=" + str(i)
            for i in range(len(local))]
    if not local:
        pics += _web_images(meta)
    return pics[:EXAMPLE_MAX]


# --------------------------------------------------------------------------
# favourites
#
# The list is a file on disk, not browser storage: clearing the cache or
# moving to another browser must not erase it. It is kept in ComfyUI's own
# user directory rather than beside this node, so updating or reinstalling
# the node cannot overwrite or delete it either.
# --------------------------------------------------------------------------

FAV_DIRNAME = "visual_series_lab"
FAV_FILENAME = "favorites.json"
FAV_MAX = 2000


def _legacy_favorites_path():
    """Where the list used to live: inside this node's own folder."""
    return os.path.join(os.path.dirname(__file__), FAV_FILENAME)


def _favorites_path():
    """The user-directory file, creating its folder on first use.

    Falls back to the old in-node location only if ComfyUI's user directory
    cannot be resolved or written, so the feature still works rather than
    failing outright.
    """
    try:
        import folder_paths
    except Exception:                                # pragma: no cover
        return _legacy_favorites_path()

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
        return _legacy_favorites_path()

    folder = os.path.join(str(base), FAV_DIRNAME)
    try:
        os.makedirs(folder, exist_ok=True)
    except Exception:                                # pragma: no cover
        return _legacy_favorites_path()
    return os.path.join(folder, FAV_FILENAME)


def _sanitize_favorites(data):
    """Reduce a posted list to safe, relative model paths.

    Entries are deliberately NOT checked against the installed LoRA list. A
    favourite is a list the user chose, not a list of what happens to be
    mounted at this moment: an external drive that is offline, or a file
    being renamed, must not silently prune entries the user never removed.
    The rules here exist only to stop the endpoint from being used as a
    general-purpose file writer.
    """
    out = []
    for item in data:
        rel = _norm(item).strip()
        if not rel or len(rel) > 400:
            continue
        # An absolute path is refused outright rather than trimmed into a
        # relative one: quietly rewriting what was sent hides the mistake.
        if rel.startswith("/"):
            continue
        parts = rel.split("/")
        if any(p in ("", ".", "..") for p in parts):
            continue
        if ":" in rel or "\x00" in rel:
            continue
        if os.path.splitext(rel)[1].lower() not in MODEL_EXTS:
            continue
        if rel not in out:
            out.append(rel)
        if len(out) >= FAV_MAX:
            break
    return out


def _store_favorites(data):
    """Write the list atomically and return what was written."""
    clean = _sanitize_favorites(data)
    path = _favorites_path()
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(clean, fh, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)
    return clean


# ---------------------------------------------------------------------------
# The LoRA shelf, kept apart from any workflow.
#
# A series is saved and opened from the Series Book now, not as a workflow, so
# a shelf that lived inside the workflow came back empty every time a series
# was opened. It lives here instead, one shelf for every Series Lab: what is
# on it, at what strength, and the groups it is sorted into.
# ---------------------------------------------------------------------------
SHELF_FILENAME = "lora_shelf.json"
SHELF_MAX = 400
SHELF_GROUPS_MAX = 60


def _shelf_path():
    return os.path.join(os.path.dirname(_favorites_path()), SHELF_FILENAME)


def _shelf_name(item):
    """Checked in its forward-slash form, kept as it was written - a LoRA
    named by a loader on Windows carries backslashes, and a group has to
    find it again by that same name."""
    if not _sanitize_favorites([item]):
        return None
    return str(item).strip()


def _sanitize_shelf(data):
    if not isinstance(data, dict):
        data = {}
    picked, seen = [], set()
    for row in data.get("picked") or []:
        if not isinstance(row, dict):
            continue
        name = _shelf_name(row.get("name"))
        if not name or name in seen:
            continue
        try:
            strength = float(row.get("strength", 1))
        except Exception:
            strength = 1.0
        if strength != strength or abs(strength) > 10:
            strength = 1.0
        seen.add(name)
        picked.append({"name": name, "strength": round(strength, 3)})
        if len(picked) >= SHELF_MAX:
            break
    groups, gids = [], set()
    for g in data.get("groups") or []:
        if not isinstance(g, dict):
            continue
        gid = str(g.get("id") or "").strip()[:40]
        if not gid or gid in gids:
            continue
        items = []
        for it in g.get("items") or []:
            name = _shelf_name(it)
            if name and name not in items:
                items.append(name)
        gids.add(gid)
        groups.append({"id": gid, "name": str(g.get("name") or "Group")[:80],
                       "shut": bool(g.get("shut")), "items": items[:SHELF_MAX]})
        if len(groups) >= SHELF_GROUPS_MAX:
            break
    return {"v": 1, "picked": picked, "groups": groups}


def _load_shelf():
    path = _shelf_path()
    if not os.path.isfile(path):
        return {"v": 1, "picked": [], "groups": [], "exists": False}
    with open(path, "r", encoding="utf-8") as fh:
        out = _sanitize_shelf(json.load(fh))
    out["exists"] = True
    return out


def _store_shelf(data):
    clean = _sanitize_shelf(data)
    path = _shelf_path()
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(clean, fh, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)
    return clean


def _load_favorites():
    """Read the list, moving an old in-node file across on first run."""
    path = _favorites_path()
    if not os.path.isfile(path):
        legacy = _legacy_favorites_path()
        if os.path.abspath(legacy) != os.path.abspath(path) \
                and os.path.isfile(legacy):
            try:
                with open(legacy, "r", encoding="utf-8") as fh:
                    old = json.load(fh)
                if isinstance(old, list) and old:
                    return _store_favorites(old)
            except Exception:
                pass
        return []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return []
    return _sanitize_favorites(data) if isinstance(data, list) else []


def _register_routes():
    try:
        import server
        from aiohttp import web
        from urllib.parse import quote, unquote
    except Exception:                                # pragma: no cover
        return

    instance = getattr(server.PromptServer, "instance", None)
    if instance is None or getattr(instance, "routes", None) is None:
        return
    routes = instance.routes

    @routes.get("/visual_series_lab/favorites")
    async def _get_favorites(request):
        """Read LoRA favourites from ComfyUI's user directory.

        Clearing browser cache, changing browsers, or updating this node
        does not erase them.
        """
        try:
            return web.json_response(_load_favorites())
        except Exception as exc:
            return web.json_response([], headers={"X-VSL-Favorites-Error": str(exc)})

    @routes.post("/visual_series_lab/favorites")
    async def _save_favorites(request):
        """Persist LoRA favourites, keeping entries that are not installed."""
        try:
            data = await request.json()
            if not isinstance(data, list):
                return web.json_response({"ok": False, "error": "favorites must be a list"}, status=400)
            clean = _store_favorites(data)
            return web.json_response({"ok": True, "favorites": clean})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=500)

    @routes.get("/visual_series_lab/shelf")
    async def _get_shelf(request):
        """The LoRA shelf and its groups, shared by every workflow."""
        try:
            return web.json_response(_load_shelf())
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=500)

    @routes.post("/visual_series_lab/shelf")
    async def _save_shelf(request):
        try:
            data = await request.json()
            return web.json_response({"ok": True, "shelf": _store_shelf(data)})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=500)

    @routes.get("/visual_series_lab/loras")
    async def _list_loras(request):
        try:
            import folder_paths
            out = []
            for raw in folder_paths.get_filename_list("loras"):
                if os.path.splitext(raw)[1].lower() not in MODEL_EXTS:
                    continue
                rel = _norm(raw)
                has = _preview_for(raw) is not None
                # When the file was added, so the browser can put the newest
                # first. Missing on a drive that is not mounted; sorting by
                # date simply leaves those at the end rather than failing.
                mtime = 0.0
                try:
                    full = folder_paths.get_full_path("loras", raw)
                    if full:
                        mtime = os.path.getmtime(full)
                except Exception:
                    mtime = 0.0
                out.append({
                    "full_name": rel,
                    "name": core.short_name(rel),
                    "mtime": mtime,
                    "thumbnail": ("/visual_series_lab/thumb?lora=" + quote(rel))
                                 if has else None,
                })
            return web.json_response(out)
        except Exception as exc:
            return web.json_response({"error": str(exc), "result": []},
                                     status=500)

    @routes.get("/visual_series_lab/triggers")
    async def _triggers(request):
        try:
            rel = unquote(request.query.get("lora", ""))
            if not rel:
                return web.json_response({"words": []})
            return web.json_response({"words": _triggers_for(rel)})
        except Exception as exc:
            return web.json_response({"words": [], "error": str(exc)})

    @routes.get("/visual_series_lab/examples")
    async def _examples(request):
        try:
            rel = unquote(request.query.get("lora", ""))
            if not rel:
                return web.json_response({"images": []})
            return web.json_response({"images": _examples_for(rel)})
        except Exception as exc:
            return web.json_response({"images": [], "error": str(exc)})

    @routes.get("/visual_series_lab/example")
    async def _example(request):
        try:
            rel = unquote(request.query.get("lora", ""))
            i = int(request.query.get("i", "-1"))
            meta, _ = _meta_for(rel)
            local = _local_examples(meta)
            if not (0 <= i < len(local)):
                return web.Response(status=404)
            return web.FileResponse(local[i])
        except Exception:
            return web.Response(status=404)

    @routes.get("/visual_series_lab/thumb")
    async def _thumb(request):
        try:
            rel = unquote(request.query.get("lora", ""))
            if not rel:
                return web.Response(status=404)
            path = _preview_for(rel)
            if not path:
                return web.Response(status=404)
            return web.FileResponse(path)
        except Exception:
            return web.Response(status=404)


_register_routes()


# --------------------------------------------------------------------------
# the node
# --------------------------------------------------------------------------

class AnyType(str):
    """A type that any input will accept.

    sampler_name and scheduler feed COMBO widgets, and the seed-variance
    fields feed INT widgets; a plain STRING or INT output is refused by the
    editor in both cases. Declaring the output as this type lets the wire be
    made, and the value carried is still an ordinary string or number.
    """

    def __ne__(self, other):
        return False


ANY = AnyType("*")

def _push(node_id, payload):
    """Tell the node face where the run has got to."""
    try:
        import server
        instance = getattr(server.PromptServer, "instance", None)
        if instance is None:
            return
        payload = dict(payload)
        payload["node"] = str(node_id)
        instance.send_sync("visual_series_lab.progress", payload)
    except Exception:
        pass


def _floats(text):
    out = []
    for chunk in str(text or "").replace("\n", ",").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            out.append(float(chunk))
        except ValueError:
            continue
    return out


def _names(text):
    out = []
    for chunk in str(text or "").replace("\n", ",").split(","):
        chunk = chunk.strip()
        if chunk:
            out.append(chunk)
    return out


def _lora_names_text(loras):
    """The LoRAs of the render on its way out: name and strength.

    'canon1D(1.0), Elise_v2(0.9)'. The folder and the extension are dropped -
    they are noise in a file name - but the strength is kept, because a
    naming node cannot invent it and a run at 0.9 should not be filed as if
    it were at 1.0. A node building a folder name strips the bracket itself.

    Order is the order they were put in the recipe, so "the first LoRA" means
    the same thing here as it does on the node face.
    """
    out, seen = [], set()
    for name, strength in loras or []:
        short = core.short_name(name)
        if not short or short in seen:
            continue
        seen.add(short)
        out.append("%s(%s)" % (short, core.fmt_strength(strength)))
    return ", ".join(out)


class VisualSeriesLabSetup:
    """Applies one render of the queue.

    The face on the node owns the queue and writes each render's option values
    straight onto the widgets of the nodes they belong to, just before the
    graph is sent off. Nothing has to be wired for those: only the model, the
    conditioning travel as links. Naming the saved file is left to the file
    manager nodes, and applying LoRAs is left to the loader already in the
    model path - this node only decides which of them are switched on.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "queue_json": ("STRING", {"default": "[]", "multiline": False}),
                "current_json": ("STRING", {"default": "{}",
                                            "multiline": False}),
            },
            # Prompts work exactly like LoRAs: each one wired up becomes a
            # chip on the shelf, and a recipe picks one. There is no unnumbered
            # prompt - one more thing behaving differently from everything
            # else was not worth the socket.
            "optional": dict(
                [("series", ("LEIEL_SERIES",))]
                + [("prompt%d" % i, ("STRING", {"forceInput": True}))
                   for i in range(1, MAX_PROMPTS + 1)]
            ),
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    # No file name is produced here: naming is a matter of taste and the
    # file manager nodes already do it far more flexibly.
    RETURN_TYPES = ("MODEL", "CONDITIONING", "STRING", "STRING", "STRING",
                    "STRING", "STRING")
    # "this render's" rather than "currently in use": every one of these
    # describes the single render on its way out, and saying so leaves no
    # room to read them as a list of everything the queue holds. And "name"
    # on both of the middle two, because that is what they carry - the names
    # the shelf gives a prompt and a LoRA, for filing and for reading on
    # screen. Without the word, someone meeting the node for the first time
    # reads them as the prompt text and the LoRA files themselves and wires
    # them somewhere expecting to get those.
    # LoRA names first, the order a Filename Manager takes them in
    # (lora_text, then text_1, text_2), so the wires run straight across;
    # then the series before the prompt, the wider name before the one
    # inside it.
    RETURN_NAMES = ("model", "conditioning",
                    "this render's lora names", "this render's series name",
                    "this render's prompt name", "status", "filename")
    FUNCTION = "run"
    CATEGORY = "Studio Leiel"
    DESCRIPTION = "Run a queue of LoRA and option recipes, one render per queue"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Every queue run is a different render, so this can never be cached.
        return float("nan")

    def run(self, model, clip, queue_json, current_json,
            unique_id=None, **kwargs):

        try:
            current = json.loads(current_json or "{}")
            if not isinstance(current, dict):
                current = {}
        except Exception:
            current = {}

        loras = []
        for entry in current.get("loras") or []:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or "").strip()
            if not name:
                continue
            try:
                strength = float(entry.get("strength", 1.0))
            except (TypeError, ValueError):
                strength = 1.0
            loras.append((name, strength))

        # only ever shown on the node face, never saved anywhere
        label = str(current.get("label") or "")
        filename = str(current.get("filename") or "")
        status = str(current.get("status") or "")
        if not status:
            status = ("Queue is empty - build a recipe and press Add que."
                      if not label else label)

        # Applied here, by this node, on purpose. Steering someone else's
        # loader from the browser was tried four ways and lost every time:
        # the loader rebuilds its own list, and an encrypt extension can
        # rewrite the prompt after we have patched it. Doing it here depends
        # on nothing outside this file.
        patched_model, patched_clip = model, clip
        for name, strength in loras:
            patched_model, patched_clip = self._apply_lora(
                patched_model, patched_clip, name, strength)

        # The face decides which trigger words belong to this render and
        # where they go; this only joins them to the prompt.
        # Which prompt this recipe picked off the shelf.
        base = None
        try:
            slot = int(current.get("prompt_slot") or 0)
        except (TypeError, ValueError):
            slot = 0
        if 1 <= slot <= MAX_PROMPTS:
            base = kwargs.get("prompt%d" % slot)
        elif slot >= BOOK_SLOT_BASE:
            if current.get("swap"):
                base = _book_swap(kwargs.get("series"), slot - BOOK_SLOT_BASE,
                                  current.get("swap"))
            if base is None:
                base = _from_book(kwargs.get("series"), slot - BOOK_SLOT_BASE,
                                  str(current.get("prompt_name") or ""))
        if base is None:
            # Nothing on that socket. An older recipe, or a wire pulled out
            # since it was queued - render the rest rather than fail.
            base = kwargs.get("prompt1") or ""

        words = [str(w) for w in (current.get("triggers") or []) if str(w).strip()]
        position = str(current.get("trigger_position") or "prepend")
        text = core.merge_prompt(base, words, position=position)
        cond = self._encode(patched_clip, text)

        _push(unique_id, {
            "status": status,
            "label": label,
            "filename": filename,
            "applied": [core.short_name(n) for n, _ in loras],
            # sent back so the strip survives a reload, where the face has
            # no memory of what it drew before the graph was sent
            "lora_files": [n for n, _ in loras],
            # echoed back so the face shows the render that is running, not
            # the last one it prepared
            "chips": current.get("chips") or [],
            "index": current.get("index"),
            "total": current.get("total"),
        })
        # The name the shelf gives this prompt, not the text itself: it is
        # for filing and for reading on screen, and the text is already going
        # out as conditioning.
        prompt_name = str(current.get("prompt_name") or "")
        # With the prompt's number in its series in front - "03 Watching It
        # Burn" - so the folders and files made from it line up in the order
        # of the book. A prompt on a socket has no number and goes as it is.
        prompt_no = str(current.get("prompt_no") or "").strip()
        if prompt_no and prompt_name:
            prompt_name = "%s %s" % (prompt_no, prompt_name)

        # The series the prompt belongs to in a Series Book, beside the other
        # names. Empty for a prompt on a socket. The face moves any wire
        # already on status or filename to their new places.
        series_name = str(current.get("series_name") or "")

        return (patched_model, cond, _lora_names_text(loras),
                series_name, prompt_name, status, filename)

    # ---- the two places this node touches ComfyUI ------------------------
    def _resolve(self, name):
        """Find the file for a LoRA the loader named.

        Loaders hand over whatever they please: a bare "retrovintage", a
        relative path, or a Windows one with backslashes. Only the last can be
        opened directly, so match against the files that actually exist.
        """
        import folder_paths
        for candidate in (name, _norm(name)):
            try:
                path = folder_paths.get_full_path("loras", candidate)
            except Exception:
                path = None
            if path:
                return path
        want = core.short_name(name).lower()
        try:
            listing = folder_paths.get_filename_list("loras")
        except Exception:
            listing = []
        for rel in listing:
            if _norm(rel).lower() == _norm(name).lower():
                return folder_paths.get_full_path("loras", rel)
        for rel in listing:
            if core.short_name(rel).lower() == want:
                return folder_paths.get_full_path("loras", rel)
        return None

    def _apply_lora(self, model, clip, name, strength):
        import comfy.sd
        import comfy.utils
        path = self._resolve(name)
        if path is None:
            # Stopped, not skipped: a picture made without a LoRA the recipe
            # asked for looks like a picture made with it, and nothing says so.
            raise RuntimeError(
                f"LoRA file not found: {name} - put the file back in the loras "
                f"folder, or swap it in the Series Lab recipe")
        weights = comfy.utils.load_torch_file(path, safe_load=True)
        return comfy.sd.load_lora_for_models(
            model, clip, weights, float(strength), float(strength))

    def _encode(self, clip, text):
        if clip is None:
            raise RuntimeError(
                "Visual Series Lab: the clip input is not connected. If this "
                "node was placed by an older version of the pack, delete it "
                "and add it again - its inputs and outputs have changed.")
        tokens = clip.tokenize(str(text or ""))
        return clip.encode_from_tokens_scheduled(tokens)


NODE_CLASS_MAPPINGS = {
    "VisualSeriesLabSetup": VisualSeriesLabSetup,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "VisualSeriesLabSetup": "Visual Series Lab (Studio Leiel)",
}
