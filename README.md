# RemNote Flashcard Timer

A floating countdown for the RemNote flashcard queue. It starts at your set
number of seconds (20 by default) and resets itself every time you move to the
next card.

## Install

1. Download the code: `git clone https://github.com/GoooDUFO/remnote-flashcard-timer.git`
   (or **Code → Download ZIP** on GitHub, then unzip).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the folder.
5. Open RemNote and start a review — the timer appears in the top right.

Reload the RemNote tab if it was already open before you installed.

## Settings

Click the extension icon in the toolbar. The switch beside the title is the
master on/off — see below.

| Setting | What it does |
| --- | --- |
| Seconds per card | How long each card gets. Slider goes to 180s; type into the box for anything up to 3600s. |
| Beep at zero | A short tone when time runs out. |
| Soft cue at 25% left | A gentler, lower tone once a quarter of the card's time remains. |
| Count up past zero | Keeps counting in red (`+7`) so you can see how far over you ran. Off means it stops at 0. |
| Stop on the review step | Hides the timer and stops the countdown once the answer is showing, so only your recall time is measured. On by default. |
| Pause in background tabs | Freezes the countdown while you're on another tab. |
| Only in the flashcard queue | Hides the timer everywhere else in RemNote. |
| Overtime budget | Scores each card against the clock. See below. |
| Diagnostic panel | Shows what the extension is detecting, with a report you can copy. See below. |

### Sounds

Two independent cues, either of which can be turned off on its own:

- **Soft cue at 25% left** — a quarter of the way from the end, while there's
  still time to do something about it. D5 at a third the volume of the end
  beep, eased in over 60ms rather than struck, so it registers without pulling
  you off the card.
- **Beep at zero** — brighter and firmer, at A5.

The cue fires at most once per card and re-arms when the next card is dealt.
It follows the countdown, so it stays silent while the timer is paused, while
the review step is up, and in background tabs. On a card short enough to cross
both marks in a single tick, only the end beep plays.

Drag the timer to reposition it — the spot is remembered. Hover it for pause
and restart buttons; the pause button turns into a play arrow while paused.

### Pause shortcut

**Alt+Shift+P** (**⌥⇧P** on a Mac) pauses and resumes the current card. The
popup's footer shows the binding in effect, and **change** opens
`chrome://extensions/shortcuts` to rebind it.

It's a Chrome command rather than a key listener on the page, so Chrome
handles the keystroke before RemNote sees it — it can't collide with RemNote's
own shortcuts or type into a card. It only acts while a card is being timed;
pressed anywhere else it does nothing, so the timer is never left silently
paused for your next review. If another extension already owns the default
combination, Chrome leaves it unassigned and the popup shows *not set*.

### Turning it off

The switch next to the title in the popup turns the whole thing off and on. Off
is a real stop, not just a hidden widget: the mutation observer, every interval
and both page listeners are unhooked, so nothing of ours runs on the page. The
remaining settings dim to show they aren't doing anything.

Switching back on re-hooks everything and starts a fresh card. Neither
direction needs a page reload, and the setting syncs across your Chrome
profiles like the rest.

### Overtime budget

Optional, on by default, and deliberately quiet — one small line under the dial
and nothing that moves while you're reading a card.

You hold a number of **tokens** (5 by default). Each card is judged the moment
recall ends — when the answer appears, or when the next card is dealt if no
answer step showed:

- **Beat the clock** — your streak grows. It appears as `🔥7` once it reaches 3.
- **Miss it** — one token is spent and the streak resets to zero.

Tokens show as pips (`●●●○○`), or a count once you hold more than eight. They
turn red at zero, which is the only signal — nothing is blocked and nothing
interrupts you.

Every 50 cards, 5 tokens come back, capped at your maximum, with a brief `+5`
next to the pips. Both numbers and the token count are configurable in the
popup, which also shows the session line — cards, on-time percentage, current
and best streak — and a **Reset score**.

The score is judged on recall time only, so revealing an answer and thinking
about it costs nothing. Turning the feature off stops all scoring; the stored
score is kept.

### The review step

RemNote shows the answer and a "were you right?" step before dealing the next
card. By default the timer hides itself there and the countdown stops — it's
timing recall, not review. It reappears, reset, on the next card. Turn off
**Stop on the review step** if you'd rather have it stay up and run straight
through.

With the diagnostic panel on, the timer stays visible during the review step,
since otherwise the panel would vanish exactly when you want to read it.

The answer step is spotted two ways, so it doesn't depend on RemNote's button
labels: the rating row appearing, or the card's text growing well past the
question while still containing it. Button labels are read from `aria-label`
and `title` as well as text, so icon-only controls still register.

The queue itself is sticky for a few seconds once entered. Without that, an
answer step whose controls we can't name reads as "you left the queue", which
hides the timer and stops the clock for entirely the wrong reason.

## How the reset works

RemNote is a single-page app with generated class names, so there is no stable
"next card" event to hook and no reliable selector for the card. Nothing here
keys off a specific class name. Three independent signals drive the reset:

1. **The answer to question flip.** When the rating row (Again/Hard/Good/Easy)
   is replaced by the reveal control, a new card has been dealt. This needs no
   knowledge of the card's markup at all, so it works even if the card is
   advanced by a swipe or a button whose label we don't recognise.
2. **An explicit rating** — clicking a rating button, or pressing `1`-`4`
   (or space/enter once the answer is showing). Resets instantly rather than
   waiting on the DOM.
3. **The card's text changing.** The comparison region is found by walking up
   from the queue's own buttons to the nearest ancestor that holds card text
   but is still much smaller than the whole app shell. That deliberately
   excludes the sidebar — including it was what made every card look identical.

Within that region, button labels and cloze blanks are stripped out, and
signatures are compared by containment rather than equality, so *revealing an
answer never resets the timer* — only an actual card change does.

## If it still doesn't reset

Turn on **Diagnostic panel** in the popup. A readout appears under the timer
showing whether it thinks you're in the queue, which buttons it found, which
region it picked, and a log of recent resets. **Copy report** puts the whole
thing on your clipboard.

The most useful line is `rating btns` — if that's empty during the answer
phase, your RemNote's button labels don't match what the extension looks for,
and the fix is to add them to `RATING_RE` in `content.js`.

Note that the report includes a short snippet of the card currently on screen.

## Files

- `manifest.json` — MV3 manifest, scoped to `remnote.com` / `remnote.io`
- `content.js` — the timer widget (in a shadow root) and card-change detection
- `background.js` — relays the pause shortcut to the active RemNote tab
- `popup.html` / `popup.js` — settings, stored in `chrome.storage.sync`
- `icons/` — toolbar icons

## Notes

- Settings sync across your Chrome profiles; the timer's on-screen position is
  stored locally per device.
- The widget lives in a shadow root, so RemNote's CSS can't affect it and it
  can't affect RemNote's.
- No network access, no analytics, no data leaves the page.

## License

MIT — see [LICENSE](LICENSE).
