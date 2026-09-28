<a id="readme-top"></a>

<div align="center">
  <img src="docs/logo.png" alt="Logo" width="128" height="128">

  <h3 align="center">Grandma's Grimoire</h3>

  <p align="center">
    Know what your next Cookie Clicker spell does before you spend the magic.
    <br />
    <a href="https://github.com/itCarl/GrandmasGrimoire/releases"><strong>Download the latest release</strong></a>
    <br />
    <br />
    <a href="https://github.com/itCarl/GrandmasGrimoire/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/itCarl/GrandmasGrimoire/issues/new?labels=enhancement">Request Feature</a>
  </p>

  <p align="center">
    <img src="https://img.shields.io/github/v/release/itCarl/GrandmasGrimoire" alt="Release">
    <img src="https://github.com/itCarl/GrandmasGrimoire/actions/workflows/release.yml/badge.svg" alt="CI">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
  </p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#features">Features</a></li>
    <li>
      <a href="#installation">Installation</a>
      <ul>
        <li><a href="#manual">Manual</a></li>
      </ul>
    </li>
    <li><a href="#how-it-works">How It Works</a></li>
    <li><a href="#development">Development</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About The Project

Grandma's Grimoire is a spell assistant for Cookie Clicker's Wizard Tower
minigame.

A Grimoire cast is not rolled when you click it. The game seeds the roll from
your save seed plus the number of spells you have ever cast:

```js
Math.seedrandom(Game.seed + '/' + M.spellsCastTotal);
```

Both inputs are readable, so the outcome of your next cast is already decided.
The mod reads it before you spend the magic - the WIN / BACKFIRE it shows is not
a probability, it is the result. For Force the Hand of Fate it names the exact
golden cookie you would get, and in profit mode it reads twenty rolls ahead to
cast for maximum cookies.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Features

- **Reads the next cast** - WIN or BACKFIRE for every spell, straight from the
  seed.
- **Names the golden cookie** - replays the full draw sequence to say which
  cookie Force the Hand of Fate would summon (Frenzy, Lucky, Building Special,
  ...).
- **Auto-cast** - off until you turn it on, then only uses the spells you tick.
  Never casts a roll it can see will backfire.
- **Choosing for cookies** - a profit mode that decides for itself and reads
  twenty rolls ahead, so it waits for a Frenzy rather than spending on a dud.
- **Buff-aware pricing** - prices each cast with the game's own payout formulas;
  `Game.cookiesPs` already carries your buffs, so the same cast is worth more
  inside a Frenzy.
- **Burn past bad rolls** - a bad roll only goes away when something is cast, so
  it can spend a cheap spell to step past it, but only while magic is full.
- **Magic reserve** - keep a share of your magic untouched when saving up.
- **Leaves the game alone** - hands the global random generator straight back,
  so nothing else in the game becomes predictable.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Installation

### Manual

1. Download `GrandmasGrimoire.zip` from
   [GitHub Releases](https://github.com/itCarl/GrandmasGrimoire/releases).
2. Unzip it into
   `<Cookie Clicker>/resources/app/mods/local/GrandmasGrimoire/`.
3. Restart the game and enable the mod under **Options -> Mods**. The panel
   appears under the Grimoire.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## How It Works

- **Every spell shares the same roll.** The seed depends only on how many spells
  you have cast, not on which one you pick. Whichever you cast first takes it.
- **The golden cookie is replayed, not guessed.** The shimmer's own two draws,
  then the choice list, with every conditional draw guarded exactly as the game
  guards it: below ten buildings there is no Building Special roll, Valentines
  and Easter add a sprite draw, and the wrath check takes no draw on either path.
- **Casts are priced honestly.** Conjure Baked Goods and a Lucky both pay
  `min(bank * 15%, production * window)`, so it holds Conjure until the payout
  is near its cap. Spells whose value cannot be computed honestly (Click Frenzy,
  Gambler's Fever Dream) are never chosen for you; they stay available to arm by
  hand.
- **The generator is handed back.** Reading a roll re-seeds the global generator
  for an instant and restores it with a bare `Math.seedrandom()`, exactly as the
  game does.

Predictions are verified by predicting and then actually casting, across seeds,
seasons, building counts and buffs.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Development

```
mod/        what the game loads, and all that ships to the Workshop
moddev/     the test harness - never loaded, never shipped
```

The split matters: the game publishes a mod by zipping its folder whole
(`resources/app/start.js`), so anything beside `main.js` is uploaded to every
subscriber. The harness and the repository's `.git` stay outside `mod/` for that
reason.

Run the tests:

```
cd moddev && node test.js
```

The tests do not run against a model of the game - `moddev/grimoire.js` loads
Cookie Clicker's own minigame source into a sandbox with a seeded PRNG and DOM
stubs, so a passing test is testing the real thing. That means they need the
game's sources from a local Steam install of Cookie Clicker.

`mod/main.js` is ASCII only: the game's `index.html` declares no
`<meta charset>` and injects mod scripts with `createElement('script')`.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the MIT License. See `LICENSE` for details.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

- [Orteil's Cookie Clicker](https://orteil.dashnet.org/cookieclicker/) - the game this mod reads everything from

<p align="right">(<a href="#readme-top">back to top</a>)</p>
