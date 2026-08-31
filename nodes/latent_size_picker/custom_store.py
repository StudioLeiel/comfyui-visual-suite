"""Persistence for the user-defined size list.

The list is stored as JSON under the ComfyUI user directory rather than in
browser storage, so clearing the browser cache never loses it:

    ComfyUI/user/random_latent_size_picker/custom_sizes.json
"""

import json
import os

from . import size_presets

STORE_DIR_NAME = "random_latent_size_picker"
STORE_FILE_NAME = "custom_sizes.json"


def _user_root():
    try:
        import folder_paths

        get_user_directory = getattr(folder_paths, "get_user_directory", None)
        if callable(get_user_directory):
            return get_user_directory()
    except Exception:
        pass

    # Walk up until the folder holding custom_nodes turns up, so this keeps
    # working wherever inside the pack the module happens to sit.
    path = os.path.dirname(os.path.abspath(__file__))
    for _ in range(6):
        parent = os.path.dirname(path)
        if parent == path:
            break
        path = parent
        if os.path.isdir(os.path.join(path, "custom_nodes")):
            return os.path.join(path, "user")
    return os.path.join(path, "user")


def store_dir():
    return os.path.join(_user_root(), STORE_DIR_NAME)


def store_path():
    return os.path.join(store_dir(), STORE_FILE_NAME)


def load_custom_sizes():
    path = store_path()
    if not os.path.isfile(path):
        # First run: seed the file so the custom family starts with a usable
        # list. An explicit "delete all" writes an empty list, which is kept.
        try:
            return save_custom_sizes(size_presets.DEFAULT_CUSTOM_SIZES)
        except Exception:
            return list(size_presets.DEFAULT_CUSTOM_SIZES)

    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return []

    raw = payload.get("sizes") if isinstance(payload, dict) else payload
    if not isinstance(raw, list):
        return []

    sizes = []
    for entry in raw:
        parsed = None
        if isinstance(entry, (list, tuple)) and len(entry) >= 2:
            parsed = size_presets.parse_size("%s x %s" % (entry[0], entry[1]))
        elif isinstance(entry, dict):
            parsed = size_presets.parse_size(
                "%s x %s" % (entry.get("width"), entry.get("height"))
            )
        else:
            parsed = size_presets.parse_size(entry)

        if parsed and parsed not in sizes:
            sizes.append(parsed)

    return sizes


def save_custom_sizes(sizes):
    cleaned = []
    for entry in sizes or []:
        parsed = entry
        if not (isinstance(entry, (list, tuple)) and len(entry) == 2):
            parsed = size_presets.parse_size(entry)
        else:
            parsed = size_presets.parse_size("%s x %s" % (entry[0], entry[1]))
        if parsed and parsed not in cleaned:
            cleaned.append(parsed)

    directory = store_dir()
    os.makedirs(directory, exist_ok=True)

    path = store_path()
    temp_path = path + ".tmp"
    payload = {"sizes": [[w, h] for w, h in cleaned]}

    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    os.replace(temp_path, path)

    return cleaned


def _sizes_payload():
    families = {}
    for family in size_presets.MODEL_FAMILIES:
        if family == size_presets.CUSTOM_FAMILY:
            sizes = load_custom_sizes()
        else:
            sizes = size_presets.MODEL_SIZES.get(family, [])
        families[family] = [[w, h] for w, h in sizes]

    return {
        "families": families,
        "family_order": list(size_presets.MODEL_FAMILIES),
        "custom_family": size_presets.CUSTOM_FAMILY,
        "presets": list(size_presets.RESOLUTION_PRESETS),
    }


def register_routes():
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return False

    instance = getattr(PromptServer, "instance", None)
    if instance is None or not hasattr(instance, "routes"):
        return False

    routes = instance.routes

    @routes.get("/studio_leiel/rlsp/sizes")
    async def get_sizes(request):
        return web.json_response(_sizes_payload())

    @routes.get("/studio_leiel/rlsp/custom")
    async def get_custom(request):
        return web.json_response(
            {"sizes": [[w, h] for w, h in load_custom_sizes()]}
        )

    @routes.post("/studio_leiel/rlsp/custom")
    async def post_custom(request):
        try:
            body = await request.json()
        except Exception:
            return web.json_response(
                {"error": "invalid json body"}, status=400
            )

        incoming = body.get("sizes", []) if isinstance(body, dict) else []
        if not isinstance(incoming, list):
            return web.json_response(
                {"error": "sizes must be a list"}, status=400
            )

        saved = save_custom_sizes(incoming)
        return web.json_response({"sizes": [[w, h] for w, h in saved]})

    return True
