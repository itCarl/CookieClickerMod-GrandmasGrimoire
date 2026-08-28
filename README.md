# Grandma's Grimoire

Cookie Clicker spell assistant. A Grimoire cast is seeded from your save and your cast count, so its outcome is already decided - this reads it before you spend the magic, names the exact golden cookie Force the Hand of Fate would give you, and can cast for maximum cookies.

Cookie Clicker Wizard tower / spells minigame. Version 1.0.

- Reads whether your next cast wins or backfires - not a probability, the result.
- Replays the draw sequence to name the exact golden cookie Force the Hand of Fate would summon.
- Verified by predicting and then actually casting, across seeds, seasons, building counts and buffs.
- Prices each cast with the game's own payout formulas and reads twenty rolls ahead, so it waits for a Frenzy rather than spending on a dud.
- Hands the global random generator straight back, so nothing else in the game becomes predictable.

## Layout

```
mod/        what the game loads, and all that ships to the Workshop
moddev/     the test harness - never loaded, never shipped
```

The split matters: the game publishes a mod by zipping its folder whole
(`resources/app/start.js`), so anything sitting beside `main.js` is uploaded to
every subscriber. The harness lives outside `mod/` so that cannot happen, and
the repository's own `.git` directory is outside it for the same reason.

## Installing

`mod/` is what goes into `Cookie Clicker/resources/app/mods/local/GrandmasGrimoire`. On
the machine this was developed on that path is a directory junction pointing
here, so the game and the repository share one copy and an edit is live
immediately.

Restart the game and enable the mod under **Options -> Mods**.

## Testing

```
cd moddev
node test.js
```

91 tests. They do not run against a model of the game - `moddev/grimoire.js`
loads Cookie Clicker's own minigame source into a sandbox with a seeded PRNG and
stubs for the DOM, so a passing test is testing the real thing.

| Script | What it answers |
|---|---|
| `moddev/test.js` | behavioural tests |

The harness resolves its paths for both locations, so the tests run from the
repository and from inside the game tree.

## A note on history

This repository starts at the version above. The mod existed before it, but that
work was never under version control, so there is nothing earlier to import -
the first commit is the state as it shipped, not a reconstruction.
