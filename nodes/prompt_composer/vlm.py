"""Image reading for the Prompt Composer.

A vision-language model is loaded on demand and kept in memory between calls,
so pressing the button on a section answers in a second or two rather than
reloading several gigabytes each time.

Nothing here runs as part of the graph. The node calls these routes directly,
which is what lets a section be analysed without queueing a render.

transformers and its friends are imported lazily. The pack installs and runs
without them; only the reading button needs them, and it says so plainly if
they are missing.
"""

import base64
import io
import json
import os
import threading
import traceback

MODELS = [
    "Qwen/Qwen3-VL-2B-Instruct",
    "Qwen/Qwen3-VL-4B-Instruct",
    "Qwen/Qwen3-VL-8B-Instruct",
    "Qwen/Qwen2.5-VL-3B-Instruct",
    "Qwen/Qwen2.5-VL-7B-Instruct",
]

QUANTS = ["none", "8-bit", "4-bit"]

DEFAULT_MODEL = "Qwen/Qwen3-VL-4B-Instruct"
DEFAULT_MAX_TOKENS = 220

# --------------------------------------------------------------------------
# what to suggest on a given card
# --------------------------------------------------------------------------
#
# Timed on a 24GB card with the 4B, stopwatch rather than guesswork:
#
#            resident   first read   later reads
#   none        9.6GB         24s           10s
#   4-bit       4.1GB         30s           13s
#
# So 4-bit is not free. It saves 5.5GB and costs about three seconds on every
# reading, because the weights are unpacked again each time. And the gap
# between the first read and the rest is the load itself: fourteen seconds
# unquantized, seventeen at 4-bit. That is what an unload really costs to
# undo, not the eight seconds assumed here before it was measured.
#
# 4-bit is still the suggestion at every size. Comparing the same photograph
# read both ways, it lost one thing - it stopped reporting how far away the
# camera was - and avoided two: it did not name the subject's dress, and it
# did not invent a shallow depth of field for a plain backdrop. Coarser
# wording suits a job that is not allowed to name objects. It is also the
# side that fails safely: a card that cannot hold the unquantized model
# stops mid-workflow, which is how this came up in the first place.
#
# What varies with the card is how soon the model should get out of the way,
# since it competes with the image model for the same memory. Seventeen
# seconds to undo means waiting is worth it wherever there is room to wait.
#
# These are starting points, not rules. Once the user picks something it is
# theirs and nothing here overrides it.
# Measured, not assumed: on a 24GB card the 4B model reads in about 13 seconds
# at 4-bit and 10 at bf16, with the first reading of a session taking 30 and 24.
# So the reload a timer costs is roughly seventeen seconds - not the eight I
# first guessed, and not free. It is still the right trade: a card that runs
# out of memory stops working altogether, and seventeen seconds is a wait.
# Even 24GB runs short in practice, so no tier is set to "never".
VRAM_TIERS = [
    # (at least this many GB, quantization, idle minutes, model)
    (20, "4-bit", 3, "Qwen/Qwen3-VL-4B-Instruct"),
    (14, "4-bit", 2, "Qwen/Qwen3-VL-4B-Instruct"),
    (10, "4-bit", 1, "Qwen/Qwen3-VL-4B-Instruct"),
    (0,  "4-bit", 1, "Qwen/Qwen3-VL-2B-Instruct"),
]


def total_vram_gb():
    """Total memory on the card, or None when there is no card to ask."""
    try:
        import torch
        if not torch.cuda.is_available():
            return None
        props = torch.cuda.get_device_properties(0)
        return props.total_memory / (1024 ** 3)
    except Exception:
        return None


def suggested_setup():
    gb = total_vram_gb()
    if gb is None:
        # No card, or torch is not installed yet. Suggest the cautious end and
        # say why, rather than pretending to have measured something.
        return {
            "vram_gb": None,
            "quant": "4-bit",
            "idle_minutes": 2,
            "model": DEFAULT_MODEL,
            "note": "no CUDA device detected - using cautious defaults",
        }
    for floor, quant, idle, model in VRAM_TIERS:
        if gb >= floor:
            return {
                "vram_gb": round(gb, 1),
                "quant": quant,
                "idle_minutes": idle,
                "model": model,
                "note": "%.0fGB detected" % gb,
            }
    return {
        "vram_gb": round(gb, 1),
        "quant": "4-bit",
        "idle_minutes": 1,
        "model": "Qwen/Qwen3-VL-2B-Instruct",
        "note": "%.0fGB detected" % gb,
    }

TAIL = (
    " Write as flowing prose in two or three sentences. "
    "No lists, no headings, no labels, no preamble."
)

# The questions are the real substance of this node. A model can be swapped;
# these took a while to get right.
#
# The rule they all follow: a layer may not borrow another layer's nouns.
# Naming a thing is how a reading leaks, because nothing downstream knows which
# layer a sentence came from. A camera reading that mentions "a wide arched
# opening" is describing the frame, correctly and obediently - but the image
# model reads it as an arch to build, and builds one in a scene that said it
# had no man-made structures. So the camera question is not allowed to name
# objects at all: an edge that darkens is described as an effect on the frame,
# never as the thing casting it.
BUILTIN_PRESETS = {
    "quality": {
        "label": "Quality Details",
        "question": (
            "Describe only how this photograph was recorded: the grain and how "
            "coarse it is, the contrast and the way shadows and highlights roll "
            "off, the colour cast and saturation, the character of the "
            "sharpness, and whether it reads as film or as digital capture. "
            "Treat these as properties of the image itself. Name no person, "
            "object, material or place, and do not say what the picture is of. "
            "Do not name a film stock, camera or lens, and give no numbers."
            + TAIL
        ),
    },
    "subject": {
        "label": "Subject Details",
        "question": (
            "Describe only the main subject: build and proportions, hair, face "
            "and expression, clothing and the fabrics it is made of, posture, "
            "and what the hands are doing. Name nothing behind or around them "
            "- no background, no furniture, no architecture, no landscape, no "
            "weather. Say nothing about the light, and nothing about where the "
            "camera is or how the shot is framed." + TAIL
        ),
    },
    "scene": {
        "label": "Scene Details",
        "question": (
            "Describe only the place: what kind of space it is, its "
            "architecture, its surfaces and materials, what grows or stands in "
            "it, the time of day, the weather, and the quality of the light "
            "falling on it. Say nothing about any person, their body or their "
            "clothing. Say nothing about where the camera is, how near it is, "
            "or what is in or out of focus." + TAIL
        ),
    },
    "camera": {
        "label": "Camera Details",
        "question": (
            "Describe only the camera: its height relative to the subject, its "
            "angle, how near or far it is, how much of the frame is in focus "
            "and how the rest falls away, and the direction and quality of the "
            "light. Name no object, building, material or place. Where part of "
            "the frame is darker, narrower or softer, describe it as an effect "
            "on the frame and never as the thing that causes it. Do not guess "
            "focal length, aperture or any other number. If nothing sits at a "
            "different distance from the subject, say the depth cannot be "
            "judged rather than inventing it." + TAIL
        ),
    },
    "all": {
        "label": "The whole picture",
        "question": (
            "Describe this image as a photograph: the subject, the setting, "
            "the light, the camera work and the photographic quality. Describe "
            "only what is visible, and guess no numbers." + TAIL
        ),
    },
}

# Section names map onto presets, so a section called "Camera Anchor" opens
# with the camera question already chosen.
NAME_HINTS = [
    ("quality", "quality"),
    ("subject", "subject"),
    ("character", "subject"),
    ("model", "subject"),
    ("casting", "subject"),
    ("scene", "scene"),
    ("setting", "scene"),
    ("location", "scene"),
    ("background", "scene"),
    ("camera", "camera"),
    ("lens", "camera"),
    ("framing", "camera"),
    ("composition", "camera"),
]

PRESET_FILENAME = "reader_questions.json"
# Where the questions lived when the reader shipped as a separate pack.
# Read once, if the current file has not been written yet, so an edited
# set of questions survives the move.
LEGACY_DIRNAME = "visual_prompt_atelier"
LEGACY_FILENAME = "atelier_questions.json"

# Reentrant on purpose. Several of the helpers here take this lock and are
# also useful to call from code that already holds it; with a plain Lock that
# is a silent hang rather than an error.
_lock = threading.RLock()
_state = {"model": None, "processor": None, "key": None}

# --------------------------------------------------------------------------
# getting out of the way
# --------------------------------------------------------------------------
#
# The model stays resident after a reading so that the next one is instant.
# That is the right trade while you are reading four anchors in a row, and the
# wrong one the moment you stop and render: the image model wants the same
# memory and finds it taken. Nothing marks the boundary between "still
# reading" and "moved on", so it is inferred from silence.
#
# A timer rather than an unload-after-every-read, because a reload costs eight
# to ten seconds and reading four anchors would pay it four times.
_idle = {"minutes": 0, "timer": None}



def _idle_fire():
    with _lock:
        _idle["timer"] = None
        if _state["model"] is None:
            return
    unload()
    print("[Leiel Composer] reader idle - model unloaded, memory released")


def set_idle_minutes(minutes):
    """0 turns it off. Called on every reading, so the clock always restarts
    from the last thing the user actually did."""
    try:
        minutes = float(minutes)
    except (TypeError, ValueError):
        minutes = 0
    minutes = max(0, min(120, minutes))
    with _lock:
        _idle["minutes"] = minutes
        old = _idle["timer"]
        _idle["timer"] = None
    if old is not None:
        try:
            old.cancel()
        except Exception:
            pass
    return minutes


def _idle_restart():
    with _lock:
        minutes = _idle["minutes"]
        old = _idle["timer"]
        _idle["timer"] = None
    if old is not None:
        try:
            old.cancel()
        except Exception:
            pass
    if minutes <= 0:
        return
    timer = threading.Timer(minutes * 60.0, _idle_fire)
    timer.daemon = True
    with _lock:
        _idle["timer"] = timer
    timer.start()


# --------------------------------------------------------------------------
# stored questions
# --------------------------------------------------------------------------

def _store_dir():
    try:
        import folder_paths
    except Exception:
        return os.path.dirname(os.path.abspath(__file__))

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
        return os.path.dirname(os.path.abspath(__file__))

    folder = os.path.join(str(base), "visual_prompt_composer")
    try:
        os.makedirs(folder, exist_ok=True)
    except Exception:
        return os.path.dirname(os.path.abspath(__file__))
    return folder


def _questions_path():
    """The file the questions are read from.

    Normally the one beside the presets. If it has not been written yet and a
    file from when the reader was its own pack is still on disk, that one is
    read instead - edited questions are worth more than a tidy folder, and the
    first save writes to the new place anyway.
    """
    path = os.path.join(_store_dir(), PRESET_FILENAME)
    if os.path.isfile(path):
        return path
    try:
        legacy = os.path.join(
            os.path.dirname(_store_dir()), LEGACY_DIRNAME, LEGACY_FILENAME)
        if os.path.isfile(legacy):
            return legacy
    except Exception:
        pass
    return path


def load_questions():
    path = _questions_path()
    merged = {k: dict(v) for k, v in BUILTIN_PRESETS.items()}
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                saved = json.load(handle)
            for key, entry in (saved or {}).items():
                if isinstance(entry, dict) and entry.get("question"):
                    merged[key] = {
                        "label": entry.get("label") or key,
                        "question": entry["question"],
                    }
        except Exception:
            pass
    return merged


def save_questions(data):
    path = os.path.join(_store_dir(), PRESET_FILENAME)
    clean = {}
    for key, entry in (data or {}).items():
        if isinstance(entry, dict) and entry.get("question"):
            clean[str(key)] = {
                "label": str(entry.get("label") or key),
                "question": str(entry["question"]),
            }
    temp = path + ".tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(clean, handle, indent=2, ensure_ascii=False)
    os.replace(temp, path)
    return load_questions()


# --------------------------------------------------------------------------
# the model
# --------------------------------------------------------------------------

def dependency_problem():
    """None when the reading button can work, otherwise what to install."""
    try:
        import torch  # noqa: F401
    except Exception:
        return "PyTorch is missing, which should not happen inside ComfyUI."
    try:
        import transformers  # noqa: F401
    except Exception:
        return (
            "transformers is not installed. Run "
            "'pip install transformers accelerate' in the environment "
            "ComfyUI runs in, then restart it."
        )
    try:
        from PIL import Image  # noqa: F401
    except Exception:
        return "Pillow is missing, which should not happen inside ComfyUI."
    return None


def will_load(model_id, quantization):
    """True when the next reading would have to bring a model in."""
    return _state["key"] != (model_id, quantization) or _state["model"] is None


def render_in_progress():
    """Whether ComfyUI is running or has something queued.

    Asking for several gigabytes in the middle of a render is how the card
    fills to the top and stops. The interface greys the button out; this is
    the same answer given again for anything that gets past it.
    """
    try:
        from server import PromptServer
        queue = PromptServer.instance.prompt_queue
        running, pending = queue.get_current_queue()
        return bool(running) or bool(pending)
    except Exception:
        # Unable to tell - say no rather than blocking every reading on a
        # detail of a ComfyUI version we have not seen.
        return False


# There was a free_comfy_models() here, and it is gone for good.
#
# It asked ComfyUI to put its own models away before the reader loaded, on the
# reasoning that the two are never needed at the same instant. The reasoning
# was right and the method was wrong. After a render ComfyUI keeps its model in
# memory still patched, ready for the next one; unloading it from outside, at a
# moment of our choosing, left the patcher half restored, and the next render
# died in partially_unload with "Cannot set version_counter for inference
# tensor" - a traceback with nothing of ours in it, pointing at ComfyUI.
#
# Moving the call to ComfyUI's thread and out of inference mode fixed one of
# the two places it surfaced. That it surfaced somewhere else is the lesson:
# the timing was never ours to choose.
#
# It was also unnecessary. ComfyUI frees its own memory when something else
# asks for the card - at 4-bit the reader needs about 4GB and gets it without
# any help. What it cannot survive is being asked mid-render, and that is now
# prevented in the interface rather than worked around here.


def _quant_config(quantization):
    if quantization not in ("8-bit", "4-bit"):
        return None
    try:
        from transformers import BitsAndBytesConfig
    except Exception:
        return None
    try:
        import torch
        if quantization == "8-bit":
            return BitsAndBytesConfig(load_in_8bit=True)
        return BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.float16,
            bnb_4bit_quant_type="nf4",
        )
    except Exception:
        return None


def _load(model_id, quantization):
    """Load a model, reusing the one in memory when it is already the right one."""
    import torch
    from transformers import AutoProcessor

    key = (model_id, quantization)
    if _state["key"] == key and _state["model"] is not None:
        return _state["model"], _state["processor"]

    unload()

    kwargs = {"device_map": "auto"}
    config = _quant_config(quantization)
    if config is not None:
        kwargs["quantization_config"] = config
    else:
        kwargs["torch_dtype"] = (
            torch.float16 if torch.cuda.is_available() else torch.float32
        )

    model = None
    errors = []
    # The class name for these models has moved between transformers releases.
    for name in (
        "AutoModelForImageTextToText",
        "Qwen2_5_VLForConditionalGeneration",
        "AutoModelForVision2Seq",
    ):
        try:
            import transformers
            cls = getattr(transformers, name, None)
            if cls is None:
                continue
            model = cls.from_pretrained(model_id, **kwargs)
            break
        except Exception as error:
            errors.append(f"{name}: {error}")

    if model is None:
        raise RuntimeError(
            "Could not load "
            + model_id
            + ". transformers may be too old for this model.\n"
            + "\n".join(errors[-2:])
        )

    processor = AutoProcessor.from_pretrained(model_id)
    model.eval()

    _state["model"] = model
    _state["processor"] = processor
    _state["key"] = key
    return model, processor


def unload():
    if _state["model"] is None:
        return False
    _state["model"] = None
    _state["processor"] = None
    _state["key"] = None
    try:
        import gc
        import torch
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    return True


def _open_image(payload):
    from PIL import Image

    if isinstance(payload, str) and payload.startswith("data:"):
        raw = base64.b64decode(payload.split(",", 1)[1])
        return Image.open(io.BytesIO(raw)).convert("RGB")

    filename = (payload or {}).get("filename")
    if not filename:
        raise ValueError("No image was given.")
    subfolder = (payload or {}).get("subfolder") or ""
    kind = (payload or {}).get("type") or "input"

    import folder_paths
    if kind == "output":
        base = folder_paths.get_output_directory()
    elif kind == "temp":
        base = folder_paths.get_temp_directory()
    else:
        base = folder_paths.get_input_directory()

    path = os.path.normpath(os.path.join(base, subfolder, filename))
    # A plain prefix test would let a sibling folder through: "input_backup"
    # starts with "input". Compare whole path components instead.
    root = os.path.normpath(base)
    if os.path.commonpath([root, path]) != root:
        raise ValueError("That image is outside the ComfyUI folders.")
    if not os.path.isfile(path):
        raise FileNotFoundError("The image is no longer on disk: " + filename)
    return Image.open(path).convert("RGB")


def _shrink(image, longest=1024):
    """A smaller picture answers faster and reads the same."""
    width, height = image.size
    if max(width, height) <= longest:
        return image
    scale = longest / float(max(width, height))
    return image.resize(
        (max(1, int(width * scale)), max(1, int(height * scale)))
    )


def analyse(payload):
    problem = dependency_problem()
    if problem:
        raise RuntimeError(problem)

    import torch

    question = (payload.get("question") or "").strip()
    if not question:
        raise ValueError("There is no question to ask about this image.")

    model_id = payload.get("model") or DEFAULT_MODEL
    quantization = payload.get("quantization") or suggested_setup()["quant"]
    if quantization not in QUANTS:
        quantization = suggested_setup()["quant"]
    if "idle_minutes" in payload:
        set_idle_minutes(payload.get("idle_minutes"))
    try:
        max_tokens = int(payload.get("max_tokens") or DEFAULT_MAX_TOKENS)
    except Exception:
        max_tokens = DEFAULT_MAX_TOKENS
    max_tokens = max(32, min(1024, max_tokens))

    image = _shrink(_open_image(payload.get("image")))

    with _lock:
        model, processor = _load(model_id, quantization)

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image"},
                    {"type": "text", "text": question},
                ],
            }
        ]
        text = processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = processor(text=[text], images=[image], return_tensors="pt")
        inputs = inputs.to(model.device)

        with torch.inference_mode():
            generated = model.generate(
                **inputs, max_new_tokens=max_tokens, do_sample=False
            )

        start = inputs["input_ids"].shape[1]
        answer = processor.decode(generated[0][start:], skip_special_tokens=True)

    # Outside the block, and it has to stay outside: _idle_restart takes the
    # same lock, and calling it from in there deadlocked the reading. No error
    # and no traceback either - the thread simply stopped on the lock it was
    # already holding, so the request hung for ever and the button never came
    # back. Timed from here rather than from the start of the reading, because
    # a long generation is not idleness.
    _idle_restart()
    return answer.strip()


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------

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

    @routes.get("/leiel_vpc/vlm/state")
    async def vlm_state(request):
        return web.json_response(
            {
                "problem": dependency_problem(),
                "models": MODELS,
                "quants": QUANTS,
                "default_model": DEFAULT_MODEL,
                "default_max_tokens": DEFAULT_MAX_TOKENS,
                "suggested": suggested_setup(),
                "loaded": _state["key"][0] if _state["key"] else None,
                "loaded_quant": _state["key"][1] if _state["key"] else None,
                "idle_minutes": _idle["minutes"],
                "questions": load_questions(),
                "hints": NAME_HINTS,
            }
        )

    @routes.post("/leiel_vpc/vlm/analyse")
    async def vlm_analyse(request):
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "invalid request"}, status=400)
        try:
            import asyncio
            loop = asyncio.get_running_loop()

            # Only when a model has to come in: a reading that reuses what is
            # already loaded asks the card for nothing.
            model_id = payload.get("model") or DEFAULT_MODEL
            quant = payload.get("quantization") or suggested_setup()["quant"]
            if will_load(model_id, quant) and render_in_progress():
                return web.json_response(
                    {"error": "ComfyUI is rendering - "
                              "loading the reader now would run the card out "
                              "of memory. Try again when the queue is done."},
                    status=409)

            # Reading takes seconds; doing it here would block every other
            # request ComfyUI is serving.
            text = await loop.run_in_executor(None, analyse, payload)
            return web.json_response({"text": text})
        except Exception as error:
            traceback.print_exc()
            return web.json_response({"error": str(error)}, status=500)

    @routes.post("/leiel_vpc/vlm/unload")
    async def vlm_unload(request):
        # An explicit unload also stops the clock: there is nothing left for it
        # to unload, and a timer still running would fire against the next
        # model the user loads.
        set_idle_minutes(0)
        return web.json_response({"unloaded": unload()})

    @routes.post("/leiel_vpc/vlm/questions")
    async def vlm_questions(request):
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "invalid request"}, status=400)
        try:
            saved = save_questions(payload.get("questions"))
            return web.json_response({"questions": saved})
        except Exception as error:
            return web.json_response({"error": str(error)}, status=500)

    return True
