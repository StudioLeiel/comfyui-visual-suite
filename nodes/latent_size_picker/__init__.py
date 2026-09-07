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
