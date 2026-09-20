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
Studio Leiel - Save Image
--------------------------------------------------
The core SaveImage node always appends a five digit counter of its own:
whatever name it is handed comes out as name_00001_.png. That counter is
scoped to the prefix it is given, so a name that carries the time, the size
and the settings is unique already and the counter only ever reads 00001 -
seven characters that say nothing, on a name that is fighting the Windows
path limit.

This node writes the name it is given and nothing else, unless the counter
is asked for - it is there for anyone who wants the familiar behaviour, and
for a name plain enough to need it. Everything else it does the way SaveImage
does it, because the rest of ComfyUI expects that:
the same output folder, the same prompt and workflow metadata in the PNG,
and the same list handed back to the browser so the images appear under the
node and Open Image and Save Image work.

Without the counter two names can still collide - the same recipe run twice
in the same second, or a batch of four, where the name is built once and
handed to every image in it. A collision is answered with a short suffix
rather than a silent overwrite: a render that has finished is never thrown
away.
"""

import json
import os

import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import folder_paths

try:                                                 # pragma: no cover
    from comfy.cli_args import args as _cli_args
except Exception:                                    # pragma: no cover
    _cli_args = None


def _inside_output(path):
    """A path is only touched when it really sits under the output folder."""
    try:
        root = os.path.realpath(folder_paths.get_output_directory())
        target = os.path.realpath(path)
        return target == root or target.startswith(root + os.sep)
    except Exception:
        return False


_IMG_EXT = (".png", ".jpg", ".jpeg", ".webp")


def _folder_images(folder):
    """The images in one folder, in the order their names put them in.

    One entry per render rather than one per file: a JPEG or WebP copy shares
    its PNG's name, and listing both would make every step through the folder
    land on the same picture twice.
    """
    try:
        names = os.listdir(folder)
    except Exception:
        return []
    stems = set()
    for n in names:
        if n.lower().endswith(".png"):
            stems.add(n[:-4])
    out = []
    for n in names:
        low = n.lower()
        if not low.endswith(_IMG_EXT):
            continue
        if not low.endswith(".png") and os.path.splitext(n)[0] in stems:
            continue
        out.append(n)
    out.sort()
    return out


TRASH_DIRNAME = "_trash"


def _trash_dir():
    return os.path.join(folder_paths.get_output_directory(), TRASH_DIRNAME)


def _inside_trash(path):
    try:
        root = os.path.realpath(_trash_dir())
        return os.path.realpath(path).startswith(root + os.sep)
    except Exception:
        return False


def _discard(folder, name):
    """Move one render, and any lighter copy of it, out of the way.

    Into a folder rather than deleted outright. This is the one thing here
    that cannot be undone by running the workflow again, and a render thrown
    away by a mis-hit key is gone for good - so it is only ever moved, and
    emptying the folder stays a decision made in the file manager, by hand.

    The folder each file came from is kept inside the trash, so a file put
    back goes back where it belongs and two renders of the same name from
    different days cannot overwrite each other.
    """
    root = os.path.realpath(folder_paths.get_output_directory())
    here = os.path.realpath(folder)
    rel = os.path.relpath(here, root) if here != root else ""
    dest_dir = os.path.join(_trash_dir(), rel) if rel else _trash_dir()
    os.makedirs(dest_dir, exist_ok=True)

    stem, ext = os.path.splitext(name)
    moved = []
    for cand in [name] + [stem + e for e in (".jpg", ".jpeg", ".webp")
                          if ext.lower() == ".png"]:
        src = os.path.join(folder, cand)
        if not os.path.isfile(src):
            continue
        dest = os.path.join(dest_dir, cand)
        n = 2
        while os.path.exists(dest):
            root_, e_ = os.path.splitext(cand)
            dest = os.path.join(dest_dir, "%s_%d%s" % (root_, n, e_))
            n += 1
        os.replace(src, dest)
        moved.append({"from": src, "to": dest})
    return moved


try:                                                 # pragma: no cover
    from aiohttp import web as _web
    from server import PromptServer as _PromptServer

    @_PromptServer.instance.routes.post("/leiel/discard")
    async def _leiel_discard(request):
        try:
            data = await request.json()
        except Exception:
            data = {}
        folder = str(data.get("folder") or "")
        name = str(data.get("name") or "")
        if not folder or not name or not _inside_output(folder):
            return _web.json_response({"ok": False, "error": "outside output"},
                                      status=400)
        if os.sep in name or "/" in name or name in (".", ".."):
            return _web.json_response({"ok": False, "error": "bad name"},
                                      status=400)
        if not name.lower().endswith(_IMG_EXT):
            return _web.json_response({"ok": False, "error": "not an image"},
                                      status=400)
        try:
            moved = _discard(folder, name)
        except Exception:
            return _web.json_response({"ok": False, "error": "discard failed"},
                                      status=500)
        if not moved:
            return _web.json_response({"ok": False, "error": "not found"},
                                      status=404)
        return _web.json_response({"ok": True, "moved": moved})

    @_PromptServer.instance.routes.post("/leiel/restore")
    async def _leiel_restore(request):
        """Undo for the last discard, and for that only."""
        try:
            data = await request.json()
        except Exception:
            data = {}
        moved = data.get("moved") or []
        back = 0
        for pair in moved:
            src = str(pair.get("to") or "")
            dest = str(pair.get("from") or "")
            if not src or not dest:
                continue
            if not _inside_output(src) or not _inside_output(dest):
                continue
            # Only a file that is sitting in the trash can be put back, and
            # only a render: this is the undo for discard, not a general move.
            if not _inside_trash(src) or not src.lower().endswith(_IMG_EXT):
                continue
            if not dest.lower().endswith(_IMG_EXT) or _inside_trash(dest):
                continue
            if not os.path.isfile(src) or os.path.exists(dest):
                continue
            try:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                os.replace(src, dest)
                back += 1
            except Exception:
                pass
        return _web.json_response({"ok": back > 0, "restored": back})

    @_PromptServer.instance.routes.post("/leiel/list_folder")
    async def _leiel_list_folder(request):
        try:
            data = await request.json()
        except Exception:
            data = {}
        path = str(data.get("path") or "")
        if not path or not _inside_output(path):
            return _web.json_response({"ok": False, "error": "outside output"},
                                      status=400)
        return _web.json_response({"ok": True, "files": _folder_images(path)})
except Exception:                                    # pragma: no cover
    pass


def _metadata_allowed():
    """Mirrors SaveImage: --disable-metadata strips prompt and workflow."""
    if _cli_args is None:
        return True
    return not bool(getattr(_cli_args, "disable_metadata", False))


def _free_name(folder, stem, ext=".png"):
    """The name as asked for, or the first free variant of it.

    Tried plain first, so the ordinary case - a name that is already unique -
    comes out exactly as the Filename Manager built it.
    """
    if not os.path.exists(os.path.join(folder, stem + ext)):
        return stem + ext
    n = 2
    while n < 10000:
        candidate = "%s_%d%s" % (stem, n, ext)
        if not os.path.exists(os.path.join(folder, candidate)):
            return candidate
        n += 1
    return "%s_%d%s" % (stem, os.getpid(), ext)


def _write_copy(folder, png_name, img, fmt, quality):
    """A lighter copy at full size, sitting beside the PNG under its name.

    Not resized: what a copy is wanted for is the weight, and a WebP at 90
    already lands near a quarter of the PNG without touching a pixel of it.
    The size something has to be is decided by wherever it is going, and that
    is a question for then, not for the moment it is written.
    """
    stem = png_name[:-4] if png_name.lower().endswith(".png") else png_name
    ext = ".jpg" if fmt == "jpg" else ".webp"
    out = img
    if fmt == "jpg":
        # JPEG has no alpha, and pasting onto white beats a black fringe.
        if out.mode in ("RGBA", "LA", "P"):
            out = out.convert("RGBA")
            flat = Image.new("RGB", out.size, (255, 255, 255))
            flat.paste(out, mask=out.split()[-1])
            out = flat
        elif out.mode != "RGB":
            out = out.convert("RGB")
        name = _free_name(folder, stem, ext)
        # No optimize pass: on a full size render its buffer overflows and
        # the encode fails outright, which is a poor trade for a few percent.
        out.save(os.path.join(folder, name), quality=int(quality),
                 subsampling=0)
    else:
        name = _free_name(folder, stem, ext)
        out.save(os.path.join(folder, name), quality=int(quality), method=4)
    return name


class LeielSaveImage:
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self.prefix_append = ""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                # Wire the Filename Manager's filename_prefix in here. Typed
                # by hand it behaves like SaveImage's own field, folders and
                # all.
                "filename_prefix": ("STRING", {"default": "Leiel"}),
                # Off writes the name as given. On appends the five digit
                # counter SaveImage adds, for a plain prefix that has nothing
                # else to tell one render from the next.
                "trailing_counter": ("BOOLEAN", {"default": False,
                                                 "label_on": "name_00001_",
                                                 "label_off": "name"}),
                "compress_level": ("INT", {"default": 4, "min": 0, "max": 9}),
                # Lighter copies beside the PNG, same size, same name - for
                # sending to someone, or for a contact sheet. Either, both or
                # neither: written after the PNG, never affecting it.
                "extra_jpg": ("BOOLEAN", {"default": False,
                                          "label_on": "jpg", "label_off": "jpg"}),
                "extra_webp": ("BOOLEAN", {"default": False,
                                           "label_on": "webp", "label_off": "webp"}),
                "extra_quality": ("INT", {"default": 92, "min": 1, "max": 100}),
                # Written by the node itself and hidden behind the bar: the
                # folder last looked at, so opening the workflow tomorrow
                # starts where it was left rather than blank. Nothing here
                # reaches the save - it is a note the browser leaves itself.
                "last_seen": ("STRING", {"default": ""}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "Studio Leiel"
    DESCRIPTION = "Save PNGs under the exact name given, with the counter optional"

    def save(self, images, filename_prefix="Leiel", trailing_counter=False,
             compress_level=4, extra_jpg=False, extra_webp=False,
             extra_quality=92, last_seen="", prompt=None, extra_pnginfo=None):
        filename_prefix += self.prefix_append
        # Borrowed rather than rebuilt: this is what keeps a prefix from
        # writing outside the output folder, and what expands %date% and the
        # rest. Its counter is the one thing thrown away.
        full_output_folder, filename, counter, subfolder, _prefix = \
            folder_paths.get_save_image_path(
                filename_prefix, self.output_dir,
                images[0].shape[1], images[0].shape[0])

        results = []
        saved = []
        for i, image in enumerate(images):
            array = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(array, 0, 255).astype(np.uint8))

            metadata = None
            if _metadata_allowed():
                metadata = PngInfo()
                if prompt is not None:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo is not None:
                    for key, value in extra_pnginfo.items():
                        metadata.add_text(key, json.dumps(value))

            if trailing_counter:
                # SaveImage's own shape, counter and all.
                name = "%s_%05d_.png" % (filename, counter)
                counter += 1
            else:
                # One name is built per run, so a batch would ask for the same
                # file several times over. The first keeps the name.
                stem = filename if i == 0 else "%s_%d" % (filename, i + 1)
                name = _free_name(full_output_folder, stem)
            img.save(os.path.join(full_output_folder, name),
                     pnginfo=metadata, compress_level=compress_level)
            results.append({"filename": name, "subfolder": subfolder,
                            "type": self.type})

            # Only once the PNG is safely on disk. A copy that fails to write
            # is reported and otherwise ignored - it must never cost the
            # render it was made from.
            extra = []
            wanted = []
            if extra_jpg:
                wanted.append("jpg")
            if extra_webp:
                wanted.append("webp")
            for fmt in wanted:
                try:
                    extra.append(_write_copy(full_output_folder, name, img,
                                             fmt, extra_quality))
                except Exception as exc:
                    print("[Visual Save Image] %s copy failed for %s: %s"
                          % (fmt, name, exc))
            saved.append({"filename": name, "subfolder": subfolder,
                          "folder": full_output_folder, "extra": extra})

        return {"ui": {"images": results, "leielsave": saved}}


NODE_CLASS_MAPPINGS = {
    "LeielSaveImage": LeielSaveImage,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LeielSaveImage": "Visual Save Image (Studio Leiel)",
}
