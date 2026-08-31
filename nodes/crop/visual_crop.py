import os
import random

import numpy as np
import torch
from PIL import Image

import folder_paths


ASPECT_PRESETS = ["free", "1:1", "4:5", "5:4", "3:2", "2:3", "16:9"]


class VisualCropStudioLeiel:
    """
    Drag a box on the node preview to set the crop region.

    First run feeds the source image into the node preview.
    After that, drag on the preview and re-run: the selection is applied.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "enabled": ("BOOLEAN", {"default": True}),
                "x": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 8}),
                "y": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 8}),
                "width": ("INT", {"default": 1024, "min": 8, "max": 16384, "step": 8}),
                "height": ("INT", {"default": 1024, "min": 8, "max": 16384, "step": 8}),
                "snap": ("INT", {"default": 8, "min": 1, "max": 64, "step": 1}),
                "lock_aspect": (ASPECT_PRESETS, {"default": "1:1"}),
            },
            "optional": {
                "mask": ("MASK",),
            },
        }

    # mask is appended last so existing links keep their slot numbers
    RETURN_TYPES = ("IMAGE", "INT", "INT", "INT", "INT", "MASK")
    RETURN_NAMES = ("image", "x", "y", "width", "height", "mask")
    FUNCTION = "crop"
    CATEGORY = "Studio Leiel"

    def _save_preview(self, tensor):
        """Write the source image to the temp folder so the frontend can show it."""
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)

        arr = tensor[0].cpu().numpy()
        arr = np.clip(arr * 255.0, 0, 255).astype(np.uint8)
        img = Image.fromarray(arr)

        # Downscale the preview only; the crop itself always uses full resolution.
        preview = img.copy()
        preview.thumbnail((1024, 1024), Image.LANCZOS)

        prefix = "slcrop_%08d" % random.randint(0, 99999999)
        filename = prefix + ".png"
        preview.save(os.path.join(temp_dir, filename), compress_level=4)

        return {
            "filename": filename,
            "subfolder": "",
            "type": "temp",
            "source_width": img.width,
            "source_height": img.height,
        }

    @staticmethod
    def _crop_mask(mask, image_shape, cx, cy, cw, ch):
        """Crop the mask with the same box, rescaling if it is a different size.

        Returns an empty mask when nothing is connected, which is what
        Load Image gives for a picture with no alpha channel.
        """
        _, src_h, src_w, _ = image_shape
        if mask is None:
            return torch.zeros((1, ch, cw), dtype=torch.float32)

        m = mask
        if m.dim() == 2:
            m = m.unsqueeze(0)

        mh, mw = int(m.shape[-2]), int(m.shape[-1])
        if mh == src_h and mw == src_w:
            return m[:, cy:cy + ch, cx:cx + cw]

        # different resolution: map the box across proportionally
        sx = mw / float(src_w)
        sy = mh / float(src_h)
        mx = max(0, min(int(round(cx * sx)), mw - 1))
        my = max(0, min(int(round(cy * sy)), mh - 1))
        mcw = max(1, min(int(round(cw * sx)), mw - mx))
        mch = max(1, min(int(round(ch * sy)), mh - my))
        return m[:, my:my + mch, mx:mx + mcw]

    def crop(self, image, enabled, x, y, width, height, snap, lock_aspect,
             mask=None):
        _, src_h, src_w, _ = image.shape

        preview = self._save_preview(image)

        if not enabled:
            full = self._crop_mask(mask, image.shape, 0, 0, src_w, src_h)
            return {
                "ui": {"images": [preview], "slcrop": [preview]},
                "result": (image, 0, 0, src_w, src_h, full),
            }

        step = max(1, int(snap))

        cx = (int(x) // step) * step
        cy = (int(y) // step) * step
        cw = max(step, (int(width) // step) * step)
        ch = max(step, (int(height) // step) * step)

        # Clamp the box so it always stays inside the source image.
        cw = min(cw, src_w)
        ch = min(ch, src_h)
        cx = max(0, min(cx, src_w - cw))
        cy = max(0, min(cy, src_h - ch))

        out = image[:, cy:cy + ch, cx:cx + cw, :]
        out_mask = self._crop_mask(mask, image.shape, cx, cy, cw, ch)

        return {
            "ui": {"images": [preview], "slcrop": [preview]},
            "result": (out, cx, cy, cw, ch, out_mask),
        }


NODE_CLASS_MAPPINGS = {
    "VisualCrop_StudioLeiel": VisualCropStudioLeiel,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "VisualCrop_StudioLeiel": "Visual Crop (Studio Leiel)",
}
