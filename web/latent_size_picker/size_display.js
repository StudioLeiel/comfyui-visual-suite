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