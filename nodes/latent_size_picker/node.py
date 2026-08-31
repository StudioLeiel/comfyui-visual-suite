import random

import torch
import comfy.model_management

from . import custom_store
from . import size_presets


class RandomLatentSizePicker:
    """Pick an image resolution and build a standard ComfyUI LATENT.

    Two modes:
      random - pick from the candidate list using the seed
      fixed  - use the single resolution chosen in resolution_list

    The candidate list comes from the built-in table of the selected model
    family, narrowed by resolution_preset. When resolution_preset is set to
    "custom" the built-in table is ignored entirely and only the resolutions
    typed into resolution_text are used.

    The model input is still required: the latent channel count, dimension
    count and downscale ratio are read from the connected MODEL, so the
    model_family widget only selects which size table to offer.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "mode": (["random", "sequential", "fixed"], {"default": "random"}),
                "model_family": (
                    list(size_presets.MODEL_FAMILIES),
                    {"default": "krea2"},
                ),
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xffffffffffffffff,
                    },
                ),
                "resolution_preset": (
                    list(size_presets.RESOLUTION_PRESETS),
                    {"default": "all"},
                ),
                "resolution_list": (
                    size_presets.all_labels(custom_store.load_custom_sizes()),
                    {"default": size_presets.format_size(1536, 1024)},
                ),
                "resolution_text": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                    },
                ),
                # Sequential order, one size per line, written by the panel
                # when chips are dragged. Empty means "the list as it comes".
                "sequence": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                    },
                ),
                "batch_size": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 64,
                    },
                ),
            }
        }

    @classmethod
    def VALIDATE_INPUTS(cls, resolution_list):
        # resolution_list is a combo whose entries are rebuilt on the client
        # from the selected model family, so a valid value is not always part
        # of the list that was published with /object_info. Naming the input
        # here tells ComfyUI to skip its own membership check for it.
        return True

    RETURN_TYPES = ("LATENT", "INT", "INT", "STRING")
    RETURN_NAMES = ("latent", "width", "height", "size_text")

    FUNCTION = "pick_random_size"
    CATEGORY = "latent"
    OUTPUT_NODE = True

    @staticmethod
    def _get_latent_format(model):
        latent_format = None
        try:
            latent_format = model.get_model_object("latent_format")
        except Exception:
            pass

        if latent_format is None:
            try:
                latent_format = getattr(model.model, "latent_format", None)
            except Exception:
                pass

        return latent_format

    @staticmethod
    def _round_to_multiple(value, multiple):
        return max(multiple, int(round(value / multiple) * multiple))

    @staticmethod
    def _build_candidates(model_family, resolution_preset, resolution_text):
        preset = size_presets.normalize_preset(resolution_preset)

        if preset == "custom":
            return size_presets.parse_size_list(resolution_text)

        if model_family == size_presets.CUSTOM_FAMILY:
            stored = custom_store.load_custom_sizes()
            candidates = size_presets.filter_by_preset(stored, preset)
            if not candidates:
                # Nothing saved yet - fall back to whatever is in the box so
                # the node still runs while the user is editing.
                typed = size_presets.parse_size_list(resolution_text)
                candidates = size_presets.filter_by_preset(typed, preset)
            return candidates

        family_sizes = size_presets.get_family_sizes(model_family)
        return size_presets.filter_by_preset(family_sizes, preset)

    def pick_random_size(
        self,
        model,
        mode,
        model_family,
        seed,
        resolution_preset,
        resolution_list,
        resolution_text,
        sequence,
        batch_size,
    ):
        latent_format = self._get_latent_format(model)

        if latent_format is None:
            raise RuntimeError(
                "Random Latent Size Picker: Could not detect the latent format "
                "from the connected MODEL. Connect a MODEL output from your "
                "model loader."
            )

        latent_channels = int(getattr(latent_format, "latent_channels", 4))
        latent_dimensions = int(getattr(latent_format, "latent_dimensions", 2))
        spatial_downscale = int(
            getattr(latent_format, "spacial_downscale_ratio", 8)
        )

        found = self._build_candidates(
            model_family, resolution_preset, resolution_text
        )

        if mode == "sequential":
            # The order is the point here, so the list is left as it was
            # written rather than sorted by ratio.
            ordered = size_presets.parse_size_list(sequence)
            candidates = [wh for wh in ordered if wh in found] or found
        else:
            candidates = size_presets.sort_by_ratio(found)

        if mode == "fixed":
            chosen = size_presets.parse_size(resolution_list)
            if chosen is None:
                chosen = candidates[0] if candidates else None
        elif mode == "sequential":
            # seed is the step counter: set control_after_generate to increment
            # and every run moves one place along the list.
            chosen = candidates[seed % len(candidates)] if candidates else None
        else:
            if candidates:
                chosen = random.Random(seed).choice(candidates)
            else:
                chosen = None

        if chosen is None:
            raise RuntimeError(
                "Random Latent Size Picker: No resolution available for "
                "model_family '%s' with resolution_preset '%s'. Add sizes to "
                "the list box, or pick a different preset."
                % (model_family, resolution_preset)
            )

        width, height = chosen
        width = self._round_to_multiple(width, spatial_downscale)
        height = self._round_to_multiple(height, spatial_downscale)

        latent_width = width // spatial_downscale
        latent_height = height // spatial_downscale

        device = comfy.model_management.intermediate_device()

        if latent_dimensions == 3:
            shape = [batch_size, latent_channels, 1, latent_height, latent_width]
        else:
            shape = [batch_size, latent_channels, latent_height, latent_width]

        samples = torch.zeros(shape, dtype=torch.float32, device=device)

        latent = {"samples": samples}
        display_text = "%d x %d" % (width, height)

        return {
            "ui": {"text": (display_text,)},
            "result": (latent, width, height, display_text),
        }
