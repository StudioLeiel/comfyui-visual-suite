# Visual Series Book

A whole series of prompts in one node. Every anchor is kept once, as a
**capsule**, and a **prompt** is a list of capsules. Below the book sits the
full Prompt Composer, working on whichever prompt is open.

---

## Why this exists

A series is mostly the same words. The quality line and the person - who she
is, what she wears - are written once and carried through every scene; the
pose, the place and the camera are what change. Built from Prompt Composers,
a ten-scene series is ten nodes holding ten copies of the shared parts. Taking
a hat off means opening ten nodes, and missing one puts two different coats in
the same series.

The Book keeps each piece of writing once. Prompts that share a capsule share
the text itself rather than a copy of it: edit the Subject in one prompt and
every prompt using it has changed. A section whose capsule is shared says so
in its header - `shared · 6` - so the reach of an edit is never a surprise.

---

## Series

One book can hold several series - a few in progress at once, borrowing from
each other. Each series has its own box, its own number and its own capsules,
and its prompts are numbered within it: `2-03` is the third scene of series 2.
Numbers are given once and never reused, so a deleted scene leaves a gap
rather than renumbering the rest.

- **+ Series** starts a new one with an empty first prompt, ready for a paste.
- Double click a series name to rename it; the caret folds it.
- Drag a prompt onto another series' box to move it there. It takes the next
  number in that series.

**A capsule belongs to one series.** Prompts of the same series share
capsules, exactly as before. A capsule taken into another series - clicked,
dragged, or put in every series at once - arrives there as a copy. Work on a
new series can therefore never change a finished one.

**Every series is written to its own file**, in
`user/visual_series_book/series/`, a few seconds after it changes. The `✕`
on a series box closes the whole series - the file stays - and **Files**
lists the saved series and brings one back as it was. Closing the last series
leaves an empty one to start on. A series can be in a book only once. A
series with nothing written in it yet - every anchor empty but the trigger -
gets no file, and older files like that are left out of the list. (Series
files from before 1.5, in `user/visual_prompt_composer/series/`, are copied
across on first use.)

**The whole book as one file.** In **Files**, **Save book** writes every
series, prompt and capsule - the open prompt and the book's colour included -
to `user/visual_series_book/books/` under the name typed; saving under the
same name again updates it. **Open** beside a saved book brings it into any
Series Book. One workflow can then serve every series: keep the workflow as it
is, keep a book per project, and open the one you need. Opening takes the
place of the book on the node, after asking. A book file kept somewhere else
opens with **Open a file from the computer**.

## Prompts

The top row of the book. Click a prompt to open it in the sections below,
double click to rename it, drag to reorder. The arrows step through them.

The icons at the top right of a series box act on its prompts; the `✕` after
them closes the series itself.

| | |
| --- | --- |
| **new** (icon) | A new scene: the trigger, quality and subject of the open prompt carried over, everything else empty. On another series' box, it starts from that series' last prompt. |
| **duplicate** (icon) | A copy of the open prompt sharing every capsule - replace only what changes. |
| **delete** (icon) | Removes the open prompt. Its capsules stay on the shelf, and Undo brings it back. |
| **Copy Text** | Copies every prompt of the open series as text, in the form Paste reads - each scene's name, then each anchor under a label carrying its capsule's name. Shift+click copies every series. |
| **From Canvas** | Brings in every Prompt Composer on the canvas as a prompt, in Series Lab order when they are wired to one, top to bottom otherwise. Identical anchors become one capsule. |

---

## Capsules

One row per kind of anchor - trigger, quality, subject, outfit, pose, scene,
camera, absolute - and one colour per row, matched to the section colours. The
number on a capsule is how many prompts use it; `0` means it is in none.

**Outfit** is optional, and sits between Subject and Pose. Keep the person in
Subject - face, build, age - and the clothes in Outfit, and a change of clothes
becomes one click while the same face carries from one series to the next. A
reply labelled `OUTFIT` (or `WARDROBE`) fills it; a prompt without one works as
it always has.

The figure at the front of a capsule is the prompt it is in, or the one it was
last in, in a fainter colour. When several capsules of one row share that
prompt, a second figure counts them in the order they were written: `03-1`,
`03-2`, `03-3` are the first, second and third cameras tried for scene 03.
A row keeps that order: putting a capsule in lights it where it stands rather
than moving it to the front.

The **?** at the right end of the CAPSULES bar opens a one-page key to all of
this - each figure on a capsule drawn as the shelf draws it, what every click
does, and how a pasted reply becomes capsules. Close it with **Close**, **Esc**
or the **?** again.

- **Click** puts the capsule in the open prompt, in place of the one of its kind. Clicking one that is already in it takes it out again; it stays on the shelf.
- **Shift+click** puts it in every prompt of the open series - the hatless Subject, everywhere, in one press.
- **Ctrl+Shift+click** puts it in every prompt of every series, each series getting its own copy.
- With several series in the book, the series are named beside CAPSULES: click one to see only its capsules, or **All** for every series. The open series is shown by default. Another series' capsules carry its number.
- **Drag** it onto a section to take that section's place, or onto a prompt chip to put it in that prompt.
- **Double click** renames it. The layers a series shares are named for what they are (`Subject`, `Subject 2`); the layers that make a scene are named for the scene they came from, unless the pasted label named them (see Paste).
- With **TR** on, hovering a capsule shows its text translated as well, into the language chosen beside it. The translation runs in the browser, on this machine.
- **✕** deletes it - twice when a prompt is still using it.
- An orange **!** on a capsule says putting it in would clash with the open
  prompt - a walking pose against a close portrait, say. Hover it for why.

**Keeping the shelf tidy.** A long series leaves capsules behind - earlier
takes of a pose, the layers of a scene that was deleted. They read `0`, and
two controls beside CAPSULES deal with them:

- **In use** hides every capsule no prompt uses. Nothing is deleted; the count
  beside CAPSULES shows how many are out of sight (`48 +23`). Click again to
  see them.
- **Tidy 23** deletes every capsule no prompt uses in the series shown (in
  every series when **All** is picked). It asks for a second click -
  `Delete 23?` - and Undo brings them back. It shows only when there is
  something to tidy.

Deleting the scenes you will not use first, then pressing Tidy, clears out a
series in two steps.

To change one prompt only, give it a capsule of its own: paste the new text,
or duplicate the section and edit the copy.

An empty capsule nobody uses simply disappears. One with writing in it stays
on the shelf until it is deleted, so taking a capsule out of a prompt never
throws writing away.

Emptying a section works the same way. Clear the Pose to read a new picture
into it, or to write another one, and the pose that was there stays on the
shelf as it was; the section carries on with a new capsule of its own, shown
on the shelf as `empty - fill the box` until something is in it. Click the
old capsule to put it back.

To start from what is there rather than from nothing, press **+ variant** on
the section's header (it shows when the pointer is over the section): the
capsule stays as it is, and the section goes on with a copy of it to edit -
a second pose from the first, a closer camera from the wide one.

Either way is how a scene gathers several poses - or cameras, or lights - to
sweep through in the Series Lab, without a prompt for each. Other prompts
that shared the old capsule keep it. On the shelf, a capsule in no prompt
reads `0` and is as ready to use as any other.

---


## The Drawer

Under the capsules sits the **Drawer**: anchors kept for good, outside any
series. An outfit that came out right, a pose, a camera, a light, a line in
ABSOLUTE that finally fixed something - put away once, taken out again in any
series later. There is one drawer for the whole computer, kept at
`user/visual_series_book/drawer.json`, so every Series Book in every workflow
opens the same one. The first time it is opened it holds a starting set of
about forty ready-made anchors - lights, outfits, poses, places, cameras -
so the node can be used without writing a prompt at all.

- **Keep** - right click a capsule, or drag it onto the Drawer. A capsule
  whose name starts with a name and a comma - `Amara, Denim Shirt` - is
  tagged with that name on its own. The picture a Visual Image Viewer is
  showing - open large, or framed in its grid - comes along as the card's
  picture, so the render that made the capsule worth keeping is kept with it.
  A card already in the drawer without a picture is given that one.
- **Use** - click a card and it asks first, naming the capsule it would
  replace; **Put it in** (or Enter) puts it in the open prompt in place of the
  capsule of its kind, and the words become a capsule of the series like any
  pasted anchor. Dragging a card onto a section puts it in at once.
- **Find** - the kinds along the Drawer's bar, the tags under it, and the find
  box, which narrows by name, tag and words as you type.
- **Add to the capsules** - double click a card to put it on the open series'
  capsule shelf without putting it in the prompt. Gather several cameras this
  way and sweep them in the Series Lab.
- **Clashes** - with a prompt open, a card that would clash with it wears an
  orange label - `! vs Camera` on a walking pose when the camera is a close
  portrait - and the ask says why before it is put in. Choosing a camera first
  and the rest after it is the natural order.
- **Edit** - right click a card, or press **Edit card** when it asks, for its
  name, kind, tags, words and picture. The window opens in the middle of the
  screen and moves by its top bar; Esc or a press outside it closes it without
  saving. While it is open, clicking a picture in a Visual Image Viewer puts
  that picture on the card; **Select from Visual Image Viewer** takes the one
  it is showing, and a picture can also be pasted, dropped or chosen from a
  file. It is kept small, inside the drawer file.
- **Pictures on capsules** - hovering a capsule shows the picture of the
  drawer card with the same words. Change the capsule's words and it no
  longer claims that picture.
- **This Prompt** - the first tab on the Drawer's bar lays the open prompt
  out as a set of cards, one per anchor from the light to the rules, each with
  the picture of its drawer card: the whole look of a scene at a glance. A
  dashed card is not in the drawer yet - right click it to keep it; double
  click a card to open its drawer card.
- **The anchor check** - above those cards, This Prompt says where the
  anchors pull against each other. A scene written in one go has every anchor
  in view; cards from the drawer were each written alone, and the commonest
  way they disagree is over how much of the body the frame holds. A close
  portrait with a walking pose and loafers is drawn as both - a large face and
  a small full figure beside it. The check reads each anchor for what it asks
  of the frame - a Subject that describes the face closely in a picture
  where the face is small (the commonest cause of a doubled figure: keep the
  Subject to age, build, skin and hair and let the LoRA carry the face), the
  Camera's crop, a whole-body action in the Pose, shoes in
  the Outfit, a Camera that fixes the stance (both feet on the ground) under a
  Pose that moves, a camera close behind her while the Pose walks off or faces
  the lens, a shape passing in the foreground, a standing figure where some
  latent sizes are wide, lens or shape words outside the Camera, someone else where only
  one person is allowed - and the latent size on the canvas, and names the
  clash with what to change. Orange is likely to show in the picture; grey is
  worth knowing. It only warns and never rewrites, since the same words in
  every scene is what keeps a series together. When there is something to
  check, an orange **! to check** sits on the Capsules bar.
- **Take out** - the x on a card, twice.
- **Beside the book** - the two small layout pictures on the Drawer's bar
  move it under the book or beside it, above the anchors. With many series
  and a long shelf the book alone makes the node tall; moving the drawer to
  the anchors' column shares the height between the two. Choosing beside
  also puts the anchors beside the book. Kept with the book.

With **Outfit** kept apart from **Subject**, the Drawer becomes a wardrobe:
one face, any clothes.

## Paste

Copy a whole reply - a scene name, then each anchor under its own label
(`QUALITY`, `SUBJECT`, `POSE`, `SCENE`, `CAMERA`, `ABSOLUTE`) with its text in
a code box or on the lines below - and press **Paste**, or hover the node and
press `Ctrl+V`.

A reply looks like this:

```
**Princess House, Looking In**

POSE · Lying in the Grass, Looking In
She lies on her stomach in the meadow grass right in front of the open toy
house, her chin resting on her folded forearms...

CAMERA · From Behind the Doll
The camera is inside the toy house, low at the back of the room...
```

One paste does all of it:

- **The prompt.** The bold first line is the scene's name. A new name adds a prompt chip to the open series under that name; a name already there updates that prompt.
- **The anchors.** Each label - `POSE`, `CAMERA` and the rest - says which anchor its text goes into, and the text lands there.
- **The capsules.** Each block becomes a capsule on the shelf, named after the dot in its label (`Lying in the Grass, Looking In`). A block whose text the shelf already has reuses that capsule instead of making a twin.
- **The rest.** Anchors the reply leaves out - here Quality and Subject - are carried over from the prompt that was open, so a scene can be pasted with only what changes.

**Paste** sits on the bar below the book as well, the one with the open
prompt's name, so it is there with the anchors folded away. That is the
usual way to work: paste a reply, render, paste the next. The anchors - the
toolbar and the open prompt's sections - fold into that bar with a click on
it, and only need opening to change a prompt's text by hand.

- A scene name the book does not have becomes a new prompt. Whatever the reply leaves out is carried over from the prompt that is open, so a reply with only Pose, Scene and Camera keeps the series' quality and subject.
- A name the book already has updates that prompt.
- Right after **new** or **duplicate**, the paste fills the fresh prompt instead of adding another.
- Text that matches a capsule already on the shelf reuses that capsule.
- A label may name its capsule after a dot or a dash - `CAMERA · High Overhead, Long Lens`. Without one, a scene's pose, camera and absolute are named after the scene. A named label on text the shelf already has renames that capsule, so pasting the same reply again with names on its labels is how capsules get better names. The name reads like a title - a capital first, no full stop, up to about a dozen words. A label that starts like one but is not (a sentence after the dot, say) is skipped, and Paste says which anchor it left as it was.
- Commentary around the blocks is ignored. A label is a line holding nothing but the anchor word (with "Anchor", a remark in brackets or a colon allowed), so a sentence that happens to begin with SCENE is never taken for one.

Several scenes can come in one paste - what **Copy Text** writes, or a reply
covering a whole series. Each scene starts at its name set apart as a heading
(bold or `#`), and scenes under a `# Series 2 - Name` heading go back to that
series. Copy the series, rename or rewrite in it, paste it back: only what
changed is applied.

Every box is fitted to its text afterwards. Where the browser will not let a
page read the clipboard - an address that is neither localhost nor https -
Paste opens a box to press `Ctrl+V` into instead.

---

## Search

**this series** is the first scope and **every series** the next. The open prompt is marked as usual, every
capsule with a hit lights up on the shelf with its count, and REPLACE ALL
changes each capsule once, so every prompt using it follows. The EFFECT row
styles hits across the book the same way.

---

## Outputs

| Output | |
| --- | --- |
| `series` | Every prompt in the book, for the Series Lab. |
| `current prompt` | The prompt open in the book when the run is queued, as plain text - for using the Book without a Series Lab. |
| `current labeled prompt` | The same in the form Paste reads: the prompt's name in bold, then each anchor under its label and capsule name (`CAMERA · Low Angle Flash`). Copied out, it pastes straight back into a Book. |

The series name for a file name comes from the Series Lab's
`this render's series name`, which follows each render. Sections are always
joined by a blank line and empty ones left out, without the Composer's
widgets for it. Find and replace across prompts is the Composer's;
in the Book, Search does it in place.

Wire `series` into the Series Lab's `series` socket and every prompt in the
book appears on its prompt shelf, named as it is here. A recipe remembers its
prompt by an id that survives renaming and reordering, so a recipe queued an
hour ago still renders the scene it was built for.

### Capsule sweep

A recipe on a book prompt can render once per capsule - the same scene
through several cameras, lights or poses - or once per combination of
capsules: a pose from one series with a camera from another. In the Series
Lab, put a book prompt in the recipe and click the `⇄ sweep` chip beside it.

The picker has two halves. Below are the capsules, one kind at a time - pick
the kind from the row of tabs. Each capsule is shown with the start of its
text, so a capsule named after a scene still says what it does. With several
series in the book, a row above the tabs says whose capsules are offered: the
prompt's own series, by name, or `all series`. A capsule from another series
carries that series' number and name, in its colour.

Above are the **takes** - one line per render setting, rendered in that
order. Click a capsule below and it becomes a take of its own; click it again
and the take goes. `All` makes every capsule of the kind on show a take. A
sweep of one kind is just that: four poses ticked, four takes.

To combine, press `+` on a take. It lights up, and until you press it again
(or `done` in the note that appears) a capsule you click goes into that take,
in place of any capsule of its kind already there - the tabs switch to a kind
the take has not got yet. A take can hold one capsule of each kind; whatever
kind it does not hold, the prompt keeps its own. So

    1  pose Venetian Passage  +  camera Low Angle Flash   ×2
    2  pose Stair Lean                                     ×4

renders the first pose with that camera twice, then the second pose with the
prompt's own camera four times - six renders, no more. The `x` on a capsule
takes it out of its take, the `x` at the end of the line removes the take,
`Clear` removes them all.

Each take has its own count: it renders as many times as the recipe asks until
you change it with `−` and `+`. Click the count to hand it back to the recipe.
The chip says which kinds the sweep touches (`⇄ pose + camera`), how many
takes and how many renders, and wears the prompt's series colour, a shade
darker.

The same chip sits on the recipe once it is queued, and the picker works there
too: add, change or drop takes while the queue runs. On a queued recipe the
picker also marks which takes are done and which one is rendering now. The
`x` on the chip turns the sweep off. Each render carries its capsules' names
in its label and file name - `pose(Venetian_Passage)_camera(Low_Angle_Flash)`.
