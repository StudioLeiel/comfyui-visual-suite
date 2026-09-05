# Visual Prompt Composer

A prompt editor for ComfyUI: named sections you can switch off, reorder, mark up
and reuse - and, when you want it, a reader that fills a section from a
reference image, one layer at a time.

![Overview](images/prompt-composer/01-overview.png)

---

## What changes when a prompt has parts

A prompt usually arrives as one long string. There is nothing in it to hold on
to - no parts, no seams, nothing you could point at and disagree with. So it
gets pasted in and run, and when the result is wrong the whole thing is replaced
rather than examined. You end up downstream of your own writing.

This node gives it parts. The text is divided into named sections, any section
can be switched off without deleting it, any sentence can be marked while you
read it, and any of it can be read back in another language. None of that is
decoration. It is what makes a prompt available for judgement.

Once the text has parts, you can say things about it that could not be said
before: this section is doing the work and that one is not, this line is
observation and that one is invention, this is worth keeping and that is worth
rewriting. The prompt stops being an ingredient and becomes work.

---

## Sections

Up to eight named sections, each its own text box, each with its own output.

Every section header carries the controls that matter for that section alone:

| | |
| --- | --- |
| **B** | Bypass. The section stays where it is and drops out of the output. |
| **IMG** | Opens the reference strip for this section. |
| **TR** | Opens a translation of this section underneath it. |
| **▾** | Fold the section down to its title. |
| **●** | Section colour. |
| **444** | Live character count for this section. |
| fit | Fit this section to the text it holds. |
| clear | Empty this section's text, keeping its picture, colour and title. |
| copy | Duplicate the section. |
| **△ ▽** | Move the section up or down. |
| **✕** | Remove the section. |
| **PRESET** | Save or load the text of this section. |

Bypass is the one to know. Testing what a part contributes normally means
deleting it and putting it back; here it is one click, the text is never at
risk, and the section keeps its place in the order. Four sections and four
clicks will tell you which one is carrying the image.

Colour is worth more than it looks. Sections that always mean the same thing -
quality, subject, scene, camera - keep the same colour across every workflow,
and a node you have not opened in a month reads at a glance.

Dragging a section's bottom edge resizes it. With a translation open the new
room goes to the translation rather than to the text box, since a box you can
already read is rarely the one that needed the space. Hold Shift to trade height
with the section below instead of growing the node. `ALIGN` in the toolbar -
`EVEN`, `FIT`, `MIN` - sets how all of them share the height at once, and
`UNDO` / `REDO` step through edits.

The footer keeps a running total: `5/5 sections active - 14207 chars`.

### Outputs

- **all prompt** - every active section, joined by `prompt_separator`.
- **labeled prompt** - the same with each section's name attached, in the style
  set by `labeled_style`.
- **one output per section** - so a section can go somewhere of its own.

`skip_empty` decides whether an empty section still contributes a separator.

---

## Marks that cost nothing

A long prompt is a record of many decisions that all look alike once it is
saved. Styling gives it landmarks.

Text can be bold, italic, underlined, coloured or highlighted. Select a run and
pick an effect, or use the format brush next to `STYLE` to lift the styling off
one piece of text and stamp it onto another. **None of it reaches the model.**
The styling is metadata stored alongside the text; the output is plain. `STYLE`
toggles the whole display so you can see the prompt exactly as it will be sent,
and switch back.

Because the marks cost nothing at generation time, they can carry whatever helps
you read: the clause you changed last run, the two sentences that contradict
each other, the phrase you keep meaning to cut, the part you are not sure is
doing anything. It all survives in the saved workflow, so next week's you
inherits this week's thinking instead of an undifferentiated wall.

---

## Search and replace

![Search and replace](images/prompt-composer/07-search-replace.png)

`Search` steps through matches across every section, with case and whole-word
options. What it finds can be replaced - in one section or in all of them at
once - or simply styled where it stands, which is often the more useful of the
two: colouring every instance of a word is how you find out how often you lean
on it.

`find_text` and `replace_text` are inputs as well as fields, so a substitution
can be driven from elsewhere in the graph.

---

## Presets

![Presets](images/prompt-composer/08-preset.png)

Any section's text can be saved by name and loaded back later, into that section
or any other. Each entry keeps its length and the date it was saved, and the
list filters as you type. A quality anchor that works is worth keeping once
rather than retyping into every workflow.

Presets live in ComfyUI's `user/` directory, so updating the pack does not touch
them.

---

## Translation

![Translation](images/prompt-composer/04-translation.png)

`TR` opens a read-only pane under a section and translates it in place, in 26
languages. Hovering a sentence in either pane lights up its match in the other,
so a long paragraph can be checked line against line rather than as a block. The
second dropdown sets how finely the text is cut - paragraph, sentence or clause
- which is also the unit the highlight lines up on. The source language is
detected rather than assumed.

It is there to be read, not to be sent: translation runs in the browser, is
never saved, and never reaches the model. Reading a line you wrote in a language
you think in is a good way to notice that it says less than you meant.

---

## It is not only for one prompt

Nothing ties a section to a particular role. Two sections named `Positive
Prompt` and `Negative Prompt`, each wired to its own encoder, is as valid a use
as five sections feeding one.

![Positive and negative](images/prompt-composer/05-versatile.png)

---

## What it replaces

A prompt assembled by hand needs a text box per part, a concatenate node per
join, and a preview node to see the result. Change the order and the wiring has
to change with it. Test one part on its own and you delete the rest, then paste
it back.

![Before and after](images/prompt-composer/06-before-after.png)

One node holds all of it, and the parts stay separately addressable.

---

# The image reader

Everything above works on its own. What follows is optional, and needs one
thing the suite does not require:

```bash
pip install transformers accelerate
```

Run that in the environment ComfyUI runs in, then restart. Without it the
composer is unaffected and the `Read` button says plainly what is missing rather
than failing quietly. Models are downloaded on first use and kept in the usual
Hugging Face cache; `Qwen3-VL-4B-Instruct` is a good place to start.

---

## Why one layer at a time

Image-to-prompt tools describe a whole picture at once. That is not how a prompt
is built. The quality of a photograph, the person in it, the place it was taken
and the way it was shot are four separate decisions, and they usually come from
four different references.

![Four layers, four references](images/prompt-composer/02-layers.png)

Here each section reads its own image and is asked its own question. A section
called `Camera Anchor` is asked about angle, distance, depth of field and light,
and told to leave the subject and the setting alone. The one called `Subject
Anchor` is asked the opposite. Four references, four sections, one prompt
assembled from the parts you actually wanted from each.

The questions matter more than the model. They are what stop a camera reading
from drifting into what the person is wearing, and what stop the model inventing
a focal length it cannot possibly know. They are stored beside the presets,
where you can edit them.

---

## Reading an image

`IMG` in a section header opens a strip for the picture. Drop a reference image
on it - or copy a screenshot and paste, with the pointer over the strip you mean
- then choose which part of it to read and press `Read`. The answer replaces the
text in that section.

![Choosing a layer](images/prompt-composer/03-layers-menu.png)

The question is picked from the section's name, so a workflow already laid out
as quality / subject / scene / camera opens ready to use. The menu groups the
four under `Read only`; `The whole picture` and `Custom...` sit outside that
heading because the restriction does not apply to them. Beside the menu, four
stacked bars show which of the four this reading takes and that the other three
are being left to their own sections, and the same mark sits on the picture
itself.

A landscape picture opens above the text and a portrait one beside it, which is
where each has room. The two small squares in the strip move it the other way,
and once you have pressed one that section keeps your choice whatever you drop
on it next. The grip resizes the picture in either arrangement.

A picture can come from anywhere on the screen. Copy a screenshot and paste it
straight in: a frame paused in a video, a photograph in an article, something a
moment ago you would have had to save, find and drag. The cost of trying a
reference falls to almost nothing, and references you would never have bothered
to keep become worth a reading.

---

## Checking what you read

A reading is a claim about a photograph, and some claims are firmer than others.
Deep shadows are something you can verify by looking. A vintage or moody
atmosphere is the model's interpretation, and interpretation is where a reading
drifts. Both arrive in the same sentence, in the same even tone, and telling
them apart is the reader's job.

This is where the marks and the translation earn their place a second time.
Colour the interpretive phrases and they stay coloured while you work; read the
line again in another language and a claim that sounded fine in English often
turns out to be vaguer than it seemed. Then keep what the picture supports and
rewrite the rest.

One thing neither of them catches: a sentence can be well formed and still
describe something the model never really looked at. A reading of a plain
backdrop will report confidently on a depth of field there is no depth to have.
For that, compare the words against the photograph.

And the layers are worth using as intended. Reading all four off a single image
is a description of that image, and the result will look like it. Reading the
quality from one, the subject from another, the place from a third and the
camera from a fourth is composition - four decisions you made, assembled. The
button that reads one layer and leaves the other three alone is there so the
second is as easy as the first.

---

## Sharing the card

Reading an image and rendering one both want the graphics card, and on one card
they cannot both have it. The reader is the guest here: rendering is the work,
reading is the errand, and the errand gives way.

![The reader panel](images/prompt-composer/09-reader.png)

So the two are never resident at the same time. `Read` is greyed out while
ComfyUI has anything queued or running, and comes back on its own when the queue
empties. Queue a render while the reader is loaded and the reader is unloaded at
once, whatever its idle timer had left to run - waiting three more minutes
holding several gigabytes is the wrong thing to do while an image model is
trying to load. After a spell with no reading it unloads anyway.

Defaults come from the card. The total memory is read at startup and used to
pick a starting model, a quantization and an idle time; the `Reader` panel says
what it found, what it suggests when your settings differ from it, and what is
in memory at any moment. Any setting you change is yours and is never
overridden. 4-bit is the default at every size - it costs about three seconds a
reading and saves several gigabytes, and on the layer questions here the loss is
slight.

What it deliberately does not do is manage ComfyUI's memory. An earlier version
asked ComfyUI to unload its models before reading, which seemed reasonable and
was not: after a render ComfyUI holds its model patched and ready, and unloading
that from outside, at a moment of this node's choosing, left the patcher half
restored and killed the next render with an error pointing deep into ComfyUI and
nowhere near here. ComfyUI frees its own memory when something else asks the
card for room. It only needs to not be asked in the middle of a render, and that
is what the greyed-out button is for.

None of this makes a small card large. On 8-12GB the 2B model at 4-bit is the
realistic choice, and setting the idle time to 1 keeps the reader off the card
between readings.

---

## Inputs

Each section can take an input, which overrides the text typed into it - so part
of a prompt can come from elsewhere while the rest stays editable here. An input
wired from another Prompt Composer is read from its layout, so the section it
came from shows through live rather than waiting for a run.
