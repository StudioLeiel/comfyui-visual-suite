from . import custom_store
from .node import RandomLatentSizePicker

custom_store.register_routes()

NODE_CLASS_MAPPINGS = {
    "RandomLatentSizePicker": RandomLatentSizePicker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    # The class id is the one this node shipped with a year ago; renaming it
    # would break every workflow that already uses it.
    "RandomLatentSizePicker": "Visual Latent Size Picker (Studio Leiel)",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
