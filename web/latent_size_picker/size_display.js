/*
 * Copyright 2026 Studio Leiel
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { app } from "../../../scripts/app.js";

app.registerExtension({
    name: "StudioLeiel.RandomLatentSizePicker.SizeDisplay",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "RandomLatentSizePicker") {
            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (message) {
                onExecuted?.apply(this, arguments);

                if (message?.text) {
                    let widget = this.widgets?.find((w) => w.name === "Selected Size");
                    if (!widget) {
                        widget = this.addWidget("text", "Selected Size", message.text[0], () => {}, {
                            serialize: false,
                        });
                        widget.inputEl.readOnly = true;
                    } else {
                        widget.value = message.text[0];
                    }
                    this.onResize?.(this.size);
                }
            };
        }
    },
});