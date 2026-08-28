# Grandma's Grimoire

A spell assistant for Cookie Clicker's Wizard Tower. It tells you what your next
cast will do **before** you spend the magic, and can cast for you.

Install: the folder sits in `mods/local/GrandmasGrimoire`. Restart the game and
enable it under **Options -> Mods**. The panel appears under the Grimoire.

---

## A cast is not rolled when you click it

That is the whole mod. `M.castSpell` does this:

```js
Math.seedrandom(Game.seed + '/' + M.spellsCastTotal);
if (!spell.fail || Math.random() < (1 - failChance)) win(); else fail();
Math.seedrandom();
```

Both inputs to that seed are readable. Your save seed does not change, and the
number of spells you have ever cast is just a counter. So the outcome of your
next cast is **already decided**, and it can simply be looked up.

This mod looks it up. The WIN / BACKFIRE column is not an estimate or a
probability - it is the result.

Two consequences worth knowing:

- **Every spell shares the same roll.** The seed does not depend on which spell
  you pick, only on how many you have cast. Whichever you cast first takes it.
- **A bad roll does not go away on its own.** Only a cast advances the counter,
  so a backfire sits there until something is cast. That is what the "burn past
  bad rolls" setting is for.

## It names the golden cookie too

For Force the Hand of Fate it goes further and replays the whole draw sequence -
the shimmer's own two draws, then the choice list - to say exactly which golden
cookie you would get:

```
Force the Hand of Fate      36   WIN
                                 -> Frenzy   x7 production for 77 seconds
```

That only works because every conditional draw is guarded by the same condition
the game guards it with. Take one the game skips, or skip one it takes, and
everything after it shifts. The ones that matter:

- below ten buildings the game never rolls for a Building Special;
- Valentines and Easter add a draw for the cookie's sprite;
- the wrath check takes no draw at all here, because both the win and the
  backfire path short-circuit it.

`moddev/test.js` predicts and then actually casts, thousands of times across
seeds, seasons, building counts and buffs. Every prediction has matched.

## Casting for cookies

Auto-cast is off until you turn it on, and then it only uses spells you tick.
Switch it to **Choosing for cookies** and it decides for itself:

- **It prices each cast** with the game's own payout formulas. Conjure Baked
  Goods and a Lucky both pay `min(bank * 15%, production * window)`, and
  `Game.cookiesPs` already carries your buffs - so the same cast is worth
  several times more inside a Frenzy.
- **It waits.** Conjure is capped by 15% of your bank, so casting it with an
  empty bank throws away the difference. It holds until the payout is near its
  cap.
- **It reads twenty rolls ahead.** If a Frenzy is three casts away it will sit
  on full magic rather than spend the roll that leads there.
- **It never casts a roll it can see will backfire.**

Spells whose value cannot be computed honestly - Click Frenzy is worth nothing
unless you are clicking, Gambler's Fever Dream is a random spell at double risk -
are never chosen for you. They stay available to arm by hand.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Only cast rolls that win | on | Skip any cast the seed says will backfire. |
| Force the Hand of Fate only for a worthwhile cookie | on | A Blab does nothing and a Cookie Storm drop is one cookie; both are skipped. |
| Burn past bad rolls at full magic | off | Cast a cheap spell to step past a bad roll - but only while magic is full, where it was about to be wasted anyway. |
| Keep in reserve | 0% | Magic to leave untouched when you are saving for something. |
| Strategy | Only what I arm | Switch to *Choosing for cookies* to let it decide. |

## Reading the panel

Every row explains itself on hover, using the game's own description and
backfire text. The columns:

- **Cost** - magic right now; it scales with your maximum magic, so it grows
  with Wizard towers and their level.
- **This cast** - WIN or BACKFIRE, read from the seed.
- **What that means** - the exact golden cookie for Force the Hand of Fate,
  what a backfire would cost you, or how long until you can afford the spell.
- **auto** - let auto-cast use this spell.

Spells that can take something from you - Spontaneous Edifice destroys a
building, Resurrect Abomination pops a wrinkler - say so on their arm button.

## Notes

- The panel is redrawn every frame but the rows are built once and only their
  changed cells rewritten. Rebuilding the table would destroy and recreate every
  button thirty times a second, and a click whose press and release straddled a
  rebuild would never land.
- Reading the roll re-seeds the global generator for an instant and hands it
  straight back with a bare `Math.seedrandom()`, exactly as the game does.
  Leaving it seeded would quietly make everything else in the game predictable.
- Magic regenerates at well under a point a minute, so a spell can honestly be
  half an hour away. The panel says so, with the wait, rather than going quiet.
- ASCII-only source: the game's `index.html` declares no `<meta charset>` and
  injects mod scripts with `createElement('script')`.
- `Game.mods['grandmas grimoire']` exposes a small read-only API, which is what
  the tests drive.
