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
    " Write as flowing prose in three or four sentences. Work through the "
    "items in the order given. An item with something to report gets words; "
    "an item with nothing to report is passed over in silence, with no remark "
    "that it was passed over and no sentence saying it is absent. Say each "
    "thing once: do not restate a point in other words. "
    "No lists, no headings, no labels, no preamble."
)

# The subject layer carries more to report than the others - a garment run
# alone can be four or five pieces - and the shared three-or-four-sentence tail
# was cutting the answer off at the waist, which is exactly where the shoes
# are. Same rules, more room.
SUBJECT_TAIL = TAIL.replace(
    "three or four sentences", "five or six sentences")

# A standing instruction, sent as the system turn rather than folded into the
# question. The same sentence carries much further from there: asked inside the
# question it reads as one more thing to cover, and the model covers it and
# moves on. Asked from the system turn it reads as the terms of the job.
#
# It says why the restriction exists as well as what it is. A model told only
# "name no objects" treats the ban as a style note and writes around it, which
# is how "a wide arched opening" survives - it is not an object, it is a
# description of the frame. A model told that four readings of one picture are
# joined afterwards understands what a stray noun costs, and drops the clause
# instead of rephrasing it.
SYSTEM = (
    "You are reading one photograph for a single named layer of a prompt, and "
    "for nothing else. Four separate readings are taken from this same image "
    "and joined together afterwards, so anything you mention that belongs to "
    "another layer is repeated or contradicted downstream, and an image model "
    "will build it twice.\n"
    "The rules, in order:\n"
    "1. Stay inside the layer you are given. A detail that belongs to another "
    "layer is left out completely - not mentioned in passing, not used to "
    "introduce a sentence, not offered as context.\n"
    "2. Do not name a thing your layer does not own. No nouns for objects, "
    "buildings, furniture, plants, garments, materials or places. When you "
    "need to point at something, use only the words your layer gives you.\n"
    "3. Describe what is visible. Do not infer equipment, settings, brands or "
    "numbers, and do not add a detail because photographs usually have one.\n"
    "4. When something in your layer cannot be described without naming "
    "something outside it, leave it out. A short reading is correct. A "
    "complete one that borrows is not.\n"
    "5. Describe what is there. Never report an absence - not that something "
    "is missing, not that an effect is not happening, not that a quality is "
    "absent. A thing that is not in the picture gets no sentence at all, not "
    "a sentence saying it is not there. These words do not appear in your "
    "answer at any point, in any sentence: no, not, never, without, nothing, "
    "none, free of, lacking, absent, devoid. If a sentence needs "
    "one of them, that sentence is describing an absence, and the present "
    "state should be described instead: a grain that is fine is fine, not "
    "'without coarseness'; contrast that rolls off gently rolls off gently, "
    "not 'with no harsh roll-off'.\n"
    "Reply with the description alone."
)

# The questions are the real substance of this node. A model can be swapped;
# these took a while to get right.
#
# The rule they all follow: a layer may not borrow another layer's nouns.
# Naming a thing is how a reading leaks, because nothing downstream knows which
# layer a sentence came from. A camera reading that mentions "a wide arched
# opening" is describing the frame, correctly and obediently - but the image
# model reads it as an arch to build, and builds one in a scene that said it
# had no man-made structures.
#
# Each question is therefore built the same way, and the order matters:
#
#   Layer:      one line naming what this reading is, so the restriction has
#               something to attach to.
#   Describe:   the list of things to cover. Positive, and specific enough
#               that the model has somewhere to put its attention. A model
#               given too little to say goes looking, and what it finds is
#               the next layer over.
#   Refer with: the vocabulary. This is the part that actually works. A
#               prohibition leaves the model needing a word it has just been
#               denied, and it takes the nearest one; handing it a small set
#               of allowed words gives it somewhere to land instead.
#   Omit:       the exclusions, named concretely rather than as a category,
#               because "nothing from the scene" is not a thing a model can
#               check a sentence against and "no walls, doorways, windows"
#               is.
#   If:         what to say when something cannot be judged. Without it the
#               model invents rather than returns an incomplete answer.
#
# Camera is the strict one, and light is the reason. Light was asked for in
# both the scene question and the camera question, and it cannot be described
# without saying what it falls on - so the camera reading reached for a
# surface every time, and the surface was a noun. Light now belongs to scene
# alone. Camera keeps the geometry of the view and the focus, and nothing
# else.
BUILTIN_PRESETS = {
    "quality": {
        "label": "Quality Details",
        "question": (
            "Layer: photographic quality - the properties of the image "
            "itself, not of anything in it.\n"
            "Four things to work out by looking at this picture. What follows "
            "are the questions and never the wording of the reply: an answer "
            "that would fit any photograph is a sign that the picture was not "
            "consulted.\n"
            "1. Find the flattest, most evenly lit area in the picture and "
            "describe the surface you find there - the texture that is in it, "
            "and how that texture stands against the detail beside it.\n"
            "2. Follow the tone from the brightest part of the picture down "
            "to the darkest. Say how far apart those two ends sit, and "
            "describe what the steps are doing as they arrive at each end.\n"
            "3. The colour: which way the whole picture leans, and how hard "
            "the colours are driven - where the strongest colour in the frame "
            "sits and how far it goes.\n"
            "4. Find an edge where two tones meet and describe the crossing "
            "itself - its width, and how the tone travels across it.\n"
            "Four answers, each describing what is at the place you looked. "
            "Describe the thing you found; an answer that names something you "
            "went looking for and did not find is not an answer.\n"
            "A surface that carries little texture is smooth; a crossing that "
            "is gradual is gradual. Describe each of them by what it is doing "
            "rather than by the amount of something it falls short of.\n"
            "Refer with: the image, the frame, the grain, the tone, the "
            "shadows, the highlights, the colour, bright areas, dark areas.\n"
            "Omit: what the picture is of. No person, no object, no material, "
            "no place, no weather, no time of day, no camera position, no "
            "framing - not in a clause, not as an aside, not as the thing a "
            "quality is demonstrated on. Name no film stock, camera or lens, "
            "and give no numbers. These words do not appear in your answer: "
            "foreground, background, sky, subject, woman, man, face, hair, "
            "skin, dress, gown, fabric, wall, floor, tree, leaves, grass, "
            "water, camera, lens, angle, framing, focus.\n"
            "If a quality is not visible enough to describe, pass over it."
            + TAIL
        ),
    },
    "subject": {
        "label": "Subject Details",
        "question": (
            "Layer: the main subject, and only the subject.\n"
            "Describe: build and proportions; hair - its length, colour and "
            "how it is arranged; the face, and what the expression is doing; "
            "the skin; posture and the line of the body; what the hands are "
            "doing.\n"
            "Then the clothing, worked through garment by garment from the "
            "head down to the feet: headwear, then whatever covers the upper "
            "body including anything worn open over another piece, then what "
            "is at the waist, then what covers the lower body, then the "
            "footwear, then anything carried or worn on the hands, wrists, "
            "ears or neck. Take them one at a time and in that order, and for "
            "each one say four things: what garment it is, what colour it is, "
            "what it appears to be made of, and how it is cut - where it ends "
            "on the body, how close or loose it sits, and what fastens or "
            "holds it. Name each piece with the narrowest word that fits what "
            "you can see - a cardigan rather than a top, a trench coat rather "
            "than a coat, ankle boots rather than shoes. Where one garment "
            "covers both the upper and the lower body, report it once as the "
            "single piece it is rather than splitting it in two.\n"
            "The colour of a piece is the particular shade in front of you, "
            "said with its depth and which way it leans: ink black, charcoal, "
            "warm ivory, dusty rose, faded indigo. A colour named on its own, "
            "as black or white or blue and nothing more, is the family and not "
            "the shade, and is worth another look before it is written down.\n"
            "What a piece is made of is the name of the cloth: silk satin, "
            "jersey, chiffon, wool crepe, tweed, denim, corduroy, leather, "
            "loosely knitted wool. Where the cloth cannot be named, say how it "
            "is built instead - how it is woven or knitted, how heavy it hangs, "
            "how much light sits on its surface - rather than calling it soft "
            "or flowing and leaving it there. The same holds for the footwear: "
            "leather, suede, patent, canvas.\n"
            "The "
            "footwear gets the same four things as everything else: shoes are "
            "part of the clothing and are reported whenever the feet are in "
            "the picture, however small they are.\n"
            "Where the subject sits on, rides, leads or holds an animal or a "
            "machine - a horse, a bicycle, a motorcycle, a car, a boat - that "
            "animal or machine is part of the subject and is described with "
            "them: what it is, its size against them, the colour and finish "
            "of its surfaces, its shape and the parts of it that can be seen, "
            "where the subject is in contact with it, and the saddle, bridle, "
            "reins, harness, seat, bars or wheels on it and the materials "
            "those are made of.\n"
            "Refer with: the subject, their hair, face, eyes, mouth, jaw, "
            "neck, shoulders, arms, hands, the garments they wear and the "
            "fabrics those are made of, the animal or machine they are on, "
            "its coat, mane, tail, head and legs, its body, frame, seat, "
            "wheels and panels, and its tack or fittings.\n"
            "Omit: everything behind, beside or beneath them - no wall, "
            "floor, ground, furniture, architecture, landscape, plant, sky or "
            "weather. Say nothing about light, shadow or colour temperature "
            "on them. Say nothing about the camera, the distance, the framing "
            "or what is in focus. Where the body rests against something "
            "that is not an animal or a machine they are on - a railing, a "
            "chair, a wall - describe "
            "the posture alone and not what it is resting on. These words do "
            "not appear in your answer: "
            "light, lit, sunlight, daylight, shadow, glow, bright, dark, "
            "wall, floor, ground, ceiling, railing, window, door, sky, cloud, "
            "grass, tree, leaf, leaves, flower, water, room, street, "
            "background, camera, lens, frame, focus, blur, sharp.\n"
            "Where part of the subject is hidden, leave it out of the "
            "description entirely and carry on with what is visible. Where a "
            "garment is in the picture but one of its four things cannot be "
            "made out, report the ones that can and pass over the rest."
            + SUBJECT_TAIL
        ),
    },
    "scene": {
        "label": "Scene Details",
        "question": (
            "Layer: the place, and the light in it.\n"
            "Describe: what kind of space this is; its architecture and its "
            "condition; the surfaces and the materials they are made of; what "
            "grows or stands in it; how far the space runs back and what "
            "happens to it with distance; the time of day; the weather; the "
            "air; and the light - where it comes from, how hard or soft it "
            "is, its colour, and what it does to the surfaces it lands on.\n"
            "Refer with: the space and anything standing in it, named "
            "plainly.\n"
            "Omit: the person entirely, and any animal or machine they are "
            "on, riding or leading - their body, their clothing, their "
            "position, and the "
            "shadow they cast. Say nothing about where the "
            "camera is, how near it is, what is sharp, what is blurred, or "
            "how the frame is cropped. Say nothing about the grain, the "
            "contrast or the colour rendering of the image; the light in the "
            "place is yours, the way the image records it belongs to another "
            "layer. These words do not appear in your answer, in any form and "
            "in any part of speech - not as a verb either, so nothing frames "
            "anything and nothing is in focus: camera, lens, frame, framing, "
            "focus, focused, blur, blurred, sharp, softness, depth of field, "
            "grain, contrast, saturation, exposure, foreground, background, "
            "unbroken, woman, man, girl, boy, person, subject, figure, model, "
            "she, he, her, his, hair, face, hand, dress, gown.\n"
            "Where the person stands in front of a part of the space you "
            "cannot make out, describe the rest and carry on." + TAIL
        ),
    },
    "camera": {
        "label": "Camera Details",
        "question": (
            "Layer: the camera, and nothing it is pointed at.\n"
            "Write these down the way a photographer writes down a setup and "
            "never the way a viewer describes a picture: every line is "
            "something a person standing here could set before the shutter "
            "went. Seven of them, in this order, each worked out by looking "
            "at this picture. What follows are the questions and never the "
            "wording of the reply: an answer that would fit any photograph is "
            "a sign that the picture was not consulted.\n"
            "1. The focal length. Read it off how far apart near and far have "
            "been driven in size and how hard the outer parts of the frame "
            "pull: near and far close in size is a long lens from well back, "
            "a near thing towering over a far one is a wide lens from close "
            "in. Answer as one of wide (24-35mm), normal (50mm), short "
            "telephoto (85-135mm) or long (200mm and over), and name the "
            "nearest round number inside that band.\n"
            "2. How far the camera stands from the subject. This follows "
            "from the focal length and from how much of them is in the "
            "frame, so work it out rather than guess it: a long lens holding "
            "a whole figure stands twenty paces off or more, a short "
            "telephoto holding one stands eight or ten, a normal lens five "
            "or six, a wide lens two or three, and every one of those closes "
            "in as the frame tightens onto the head. Answer in paces, and in "
            "paces that agree with the focal length just named.\n"
            "3. The height the camera is held at, given against the subject's "
            "own body - at the floor, at the knee, at the waist, at the "
            "chest, at eye level, or above the head.\n"
            "4. Whether it is held level, tilted up or tilted down, and how "
            "far.\n"
            "5. How far round the subject it stands - square on, or round "
            "towards one side, and how far round.\n"
            "6. How much of the frame's height the subject fills. Set the top "
            "of their head and the lowest part of them against the full "
            "height of the frame and answer as a fraction of it: a third, a "
            "half, two thirds, three quarters, or the whole of it. Then where "
            "they sit across it - centred, or to one side, and how far "
            "over.\n"
            "7. Where the frame cuts the subject: name the highest part of "
            "them it keeps and the lowest. Where the whole of them is inside "
            "it, say so, and say how the room left over is divided between "
            "above and below - which follows from the fraction just given, "
            "and cannot exceed what that fraction leaves.\n"
            "All seven get words, and each of the seven gets words that could "
            "only have been written about this picture.\n"
            "The seven describe one photograph and have to agree with one "
            "another. A long lens is never two paces off. A subject filling "
            "the whole frame leaves no room above them. Where two answers "
            "cannot both be true, the one read off the picture most directly "
            "is the one that stands, and the other is worked out again from "
            "it.\n"
            "Where the subject is leaning, tilted, crouched or lying, they "
            "have moved and the camera has not: read the height and the tilt "
            "off the way the space runs away from the camera, and let the "
            "body alone. This is a method, and methods are never mentioned in "
            "a reading.\n"
            "Refer with: the camera, the lens, the frame, the subject, near, "
            "far, sharp, soft.\n"
            "Omit: everything the camera is pointed at - no appearance, no "
            "clothing, no place, no material, no light, no colour, no grain. "
            "Say nothing about lines converging, vanishing points, or which "
            "corner of the frame is nearest: those are how a setting shows "
            "itself and not the setting. The edges of the frame are mentioned "
            "only where something is happening to them; an even frame gets no "
            "words at all. These words do not appear in your answer: wall, "
            "floor, ground, ceiling, railing, window, door, doorway, arch, "
            "column, road, street, step, stair, tile, sky, cloud, grass, "
            "tree, branch, leaf, leaves, flower, water, chair, table, "
            "backdrop, dress, gown, shirt, jacket, coat, glove, hair, fabric, "
            "stone, concrete, wood, metal, light, sunlight, shadow, grain, "
            "colour, color, contrast.\n"
            "Two things are deliberately not asked for, and are not to be "
            "mentioned: which way round the frame stands, and where the "
            "sharpness sits. Both are set when the picture is made rather "
            "than read off one." + TAIL
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
#
# The timer is still the right default, but it is not right for every card. At
# bf16 the 4B sits on about ten gigabytes, and on a card that is also holding
# an image model those ten gigabytes matter more than the seventeen seconds a
# reload costs. So the interface can ask for the model to be put away the
# moment a reading is done, and a user who reads one anchor at a time and
# renders in between can have the memory back immediately.
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


# There was a free_comfy_models() here, it was removed, and this is it back -
# on different terms. What follows is the old note, kept because the terms only
# make sense beside it.
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
#
# Unnecessary held while the handover was orderly. It is not, in two cases a
# user runs into: a render stopped part way through, and a render that ended
# without its memory being given back. The card is then full of an image model
# nothing is using, ComfyUI has no reason to release it because nothing has
# asked, and the reading fails outright.
#
# So it comes back, with the lesson from last time as the rule: the timing was
# never ours to choose, so this never chooses. It runs only where there is
# nothing to corrupt - the queue empty, no render running - and it unloads
# everything rather than trimming, because it was partial unloading that left
# the patcher half restored. And it is asked for only when the card has
# already refused, or when the user has ticked the box saying to ask every
# time. A reading that fits in the memory that is free never touches it.


def free_comfy_models():
    """Ask ComfyUI to put its own models away. Empty queue only.

    Returns True when something was asked to unload. Every failure here is
    survivable - the reading either fits or reports that it does not - so
    nothing raises.
    """
    if render_in_progress():
        return False
    try:
        import comfy.model_management as mm
    except Exception:
        return False
    try:
        import torch
        # Out of inference mode, on purpose: the traceback that killed renders
        # for a day came from unloading inside it.
        with torch.inference_mode(False):
            mm.unload_all_models()
    except Exception:
        try:
            mm.unload_all_models()
        except Exception:
            return False
    try:
        mm.soft_empty_cache()
    except Exception:
        pass
    print("[Leiel Composer] ComfyUI models unloaded to make room for a reading")
    return True


def _out_of_memory(error):
    """CUDA is out of memory, by whichever name this torch build calls it."""
    try:
        import torch
        if isinstance(error, getattr(torch.cuda, "OutOfMemoryError", ())):
            return True
    except Exception:
        pass
    text = str(error).lower()
    return "out of memory" in text or "cuda error" in text and "memory" in text


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

    # Ticked in the panel: clear the card first, every time, without waiting
    # for it to fill. Costs ComfyUI a reload on its next render.
    if payload.get("purge_first"):
        free_comfy_models()

    with _lock:
        try:
            model, processor = _load(model_id, quantization)
        except Exception as error:
            # The card is full and what is on it is not ours. One attempt to
            # clear it, then one more try; if that fails too the error goes
            # back to the panel as it always did.
            if not _out_of_memory(error) or not free_comfy_models():
                raise
            unload()
            model, processor = _load(model_id, quantization)

        # The system turn carries the rule, the user turn carries the layer.
        # Both Qwen3-VL and Qwen2.5-VL templates accept a system role; if a
        # template ever drops it the reading still works, only less strictly,
        # so this is not worth guarding.
        messages = [
            {
                "role": "system",
                "content": [{"type": "text", "text": SYSTEM}],
            },
            {
                "role": "user",
                "content": [
                    {"type": "image"},
                    {"type": "text", "text": question},
                ],
            },
        ]
        text = processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = processor(text=[text], images=[image], return_tensors="pt")
        inputs = inputs.to(model.device)

        def _generate():
            with torch.inference_mode():
                return model.generate(
                    **inputs, max_new_tokens=max_tokens, do_sample=False
                )

        try:
            generated = _generate()
        except Exception as error:
            # Weights fit, working memory did not. Same one attempt, and the
            # model stays where it is: it is already on the card and reloading
            # it would ask for the memory twice.
            if not _out_of_memory(error) or not free_comfy_models():
                raise
            try:
                torch.cuda.empty_cache()
            except Exception:
                pass
            generated = _generate()

        start = inputs["input_ids"].shape[1]
        answer = processor.decode(generated[0][start:], skip_special_tokens=True)

    # Outside the block, and it has to stay outside: _idle_restart takes the
    # same lock, and calling it from in there deadlocked the reading. No error
    # and no traceback either - the thread simply stopped on the lock it was
    # already holding, so the request hung for ever and the button never came
    # back. Timed from here rather than from the start of the reading, because
    # a long generation is not idleness.
    if payload.get("unload_after"):
        # Asked for by the interface, and done here rather than on a timer:
        # the reading is over, so the memory is free to give back now. Same
        # rule as everywhere else in this file - only our own model is
        # touched, never ComfyUI's.
        unload()
        print("[Leiel Composer] reading done - model unloaded, memory released")
    else:
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
