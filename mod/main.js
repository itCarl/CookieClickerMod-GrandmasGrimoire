/**
 * Grandma's Grimoire - a spell assistant for Cookie Clicker's Wizard Tower.
 *
 * The one thing worth knowing about the Grimoire is that a cast is not random
 * at the moment you click it. M.castSpell does this:
 *
 *     Math.seedrandom(Game.seed + '/' + M.spellsCastTotal);
 *     if (!spell.fail || Math.random() < (1 - failChance)) win(); else fail();
 *     Math.seedrandom();
 *
 * Both inputs to that seed are readable, so the outcome of your next cast is
 * already decided and can be looked up before you spend a single point of
 * magic. This mod looks it up.
 *
 * For Force the Hand of Fate it goes further and replays the whole draw
 * sequence - the shimmer's own two draws, then the choice list - to name the
 * exact golden cookie you would get. That only works because every conditional
 * draw here is guarded by the same condition the game guards it with; skip one
 * the game takes, or take one it skips, and everything after it shifts.
 *
 * See README.md for the mechanics and the caveats.
 */
(function () {
'use strict';

var MOD_ID   = 'grandmas grimoire';
var VERSION  = '1.0';
var PANEL_ID = 'grandmasGrimoirePanel';

/* ------------------------------------------------------------------ *
 * Outcome labels
 * ------------------------------------------------------------------ */

// The `force` strings Force the Hand of Fate can pick, in readable form.
var FATE_OUTCOMES = {
	'frenzy':            {label:'Frenzy',            note:'x7 CpS for 77s',        good:true},
	'multiply cookies':  {label:'Lucky',             note:'a cookie payout',       good:true},
	'click frenzy':      {label:'Click Frenzy',      note:'x777 click power, 13s', good:true},
	'cookie storm':      {label:'Cookie Storm',      note:'a shower of cookies',   good:true},
	'cookie storm drop': {label:'Cookie Storm drop', note:'one big cookie',        good:true},
	'building special':  {label:'Building Special',  note:'a building bonus',      good:true},
	'free sugar lump':   {label:'Free sugar lump',   note:'a whole sugar lump',    good:true},
	'blab':              {label:'Blab',              note:'nothing at all',        good:false},
	'clot':              {label:'Clot',              note:'x0.5 CpS for 66s',      good:false},
	'ruin cookies':      {label:'Ruin',              note:'costs you cookies',     good:false},
	'cursed finger':     {label:'Cursed Finger',     note:'CpS frozen, 10s',       good:false},
	'blood frenzy':      {label:'Blood Frenzy',      note:'x666 CpS for 6s',       good:true}
};

// Spells that can take something away from you when they backfire. Auto-cast
// refuses these unless you arm them one by one, and says why.
var DESTRUCTIVE = {
	'spontaneous edifice':   'can destroy one of your buildings',
	'resurrect abomination': 'can pop one of your wrinklers',
	'gambler\'s fever dream':'casts a random spell at double backfire risk'
};

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

var DEFAULTS = {
	autoArmed:   false,  // master switch for auto-casting
	autoSpells:  {},     // spellKey -> true, opt-in one at a time
	reserve:     0,      // magic to keep in the bank, as a share of the maximum
	onlyWins:    true,   // never auto-cast a roll predicted to backfire
	fateFilter:  true,   // auto-FtHoF only for outcomes worth having
	burnBadRolls:false,  // spend a cheap spell to advance past a bad roll

	// 'manual' casts only what you arm; 'profit' picks for you, by cookies.
	strategy:    'manual',
	conjureAt:   0.9,    // cast Conjure once it pays this share of its cap
	patience:    0.5     // hold out if something ahead is worth this much more
};

// Burning is only worth it with a spell that is cheap, whose backfire costs
// almost nothing, and that always counts as a cast. Haggler's Charm fits:
// a backfire makes upgrades 2% pricier for an hour and nothing else, and unlike
// Stretch Time it never returns -1 and leave the counter where it was.
var BURN_ORDER = ["haggler's charm", 'summon crafty pixies', 'conjure baked goods'];

var S = {};
(function () {
	for (var k in DEFAULTS) S[k] = DEFAULTS[k];
	S.autoSpells = {};
})();

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

var stats      = {cast:0, backfired:0, burned:0};
var statusText = 'waiting for the Grimoire';
var predCache  = {key:'', data:null};
var lastCastTotal = -1;
var lastAutoTick  = -1e9;   // Game.T of the last auto-cast decision
var autoTick      = 0;      // fallback clock when Game.T is unavailable
var AUTO_EVERY    = 30;     // frames between decisions, i.e. about a second
var panelJustBuilt = false;
var uiBroken   = false;
var showHelp   = false;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function grimoire() {
	if (typeof Game === 'undefined' || !Game.Objects) return null;
	var tower = Game.Objects['Wizard tower'];
	if (!tower || !tower.minigameLoaded || !tower.minigame) return null;
	var m = tower.minigame;
	return (m.spells && m.castSpell && m.getSpellCost) ? m : null;
}

function fmt(n, dec) {
	if (typeof Beautify === 'function') return Beautify(n, dec);
	return String(Math.round(n));
}

function fmtTime(secs) {
	if (!isFinite(secs) || secs < 0) return 'never';
	if (secs < 1) return 'now';
	var m = Math.floor(secs / 60), s = Math.round(secs % 60);
	return m ? (m + 'm ' + s + 's') : (s + 's');
}

/** Magic per second, from the game's own per-frame regeneration. */
function magicPerSecond(m) {
	var fps = (typeof Game !== 'undefined' && Game.fps) ? Game.fps : 30;
	var per = Math.max(0.002, Math.pow(m.magic / Math.max(m.magicM, 100), 0.5)) * 0.002;
	return per * fps;
}

function secondsUntil(m, cost) {
	if (m.magic >= cost) return 0;
	var rate = magicPerSecond(m);
	return rate > 0 ? (cost - m.magic) / rate : Infinity;
}

/* ------------------------------------------------------------------ *
 * Reading the locked-in roll
 * ------------------------------------------------------------------ */

/**
 * Runs `fn` against exactly the seeded stream castSpell would see, then hands
 * the global RNG back the way the game does - with a bare Math.seedrandom(),
 * which re-seeds from entropy. Leaving the game on a deterministic stream
 * would quietly make everything else in it predictable too.
 */
function withCastSeed(m, fn, castIndex) {
	if (typeof Math.seedrandom !== 'function') return null;
	var n = (castIndex === undefined) ? m.spellsCastTotal : castIndex;
	Math.seedrandom(Game.seed + '/' + n);
	try {
		return fn();
	} finally {
		Math.seedrandom();
	}
}

/**
 * Replays the draws Force the Hand of Fate makes after the backfire roll, in
 * the game's order, and returns the outcome it would force.
 *
 * The draw sequence, from minigameGrimoire.js and the golden shimmer's
 * initFunc:
 *   - the shimmer's wrath check takes NO draw here, because both the win path
 *     ({noWrath:true}) and the backfire path ({wrath:true}) short-circuit it;
 *   - one draw for the sprite only during Valentines and Easter;
 *   - two draws for the shimmer's x and y;
 *   - then the choice list, then choose().
 */
function replayFate(wins) {
	var season = (typeof Game !== 'undefined') ? Game.season : '';
	if (season === 'valentines' || season === 'easter') Math.random();
	Math.random();   // shimmer x
	Math.random();   // shimmer y

	var choices = [];
	if (wins) {
		choices.push('frenzy', 'multiply cookies');
		if (!Game.hasBuff('Dragonflight')) choices.push('click frenzy');
		if (Math.random() < 0.1) choices.push('cookie storm', 'cookie storm', 'blab');
		// Short-circuit: below ten buildings the game never takes this draw.
		if (Game.BuildingsOwned >= 10 && Math.random() < 0.25) choices.push('building special');
		if (Math.random() < 0.15) choices = ['cookie storm drop'];
		if (Math.random() < 0.0001) choices.push('free sugar lump');
	} else {
		choices.push('clot', 'ruin cookies');
		if (Math.random() < 0.1) choices.push('cursed finger', 'blood frenzy');
		if (Math.random() < 0.003) choices.push('free sugar lump');
		if (Math.random() < 0.1) choices = ['blab'];
	}
	return choices[Math.floor(Math.random() * choices.length)];
}

/**
 * What every spell would do if cast right now.
 *
 * Cached, because working it out reseeds the global RNG and the panel redraws
 * every frame. The key holds everything the answer depends on, so it recomputes
 * exactly when it has to.
 */
function predictions(m) {
	var key = [
		Game.seed, m.spellsCastTotal, Game.season, Game.elderWrath,
		Game.BuildingsOwned >= 10 ? 1 : 0,
		Game.hasBuff('Dragonflight') ? 1 : 0,
		Game.hasBuff('Magic adept') ? 1 : 0,
		Game.hasBuff('Magic inept') ? 1 : 0,
		Math.round(m.magicM)
	].join('|');
	if (predCache.key === key) return predCache.data;

	var out = {};
	for (var k in m.spells) {
		var spell = m.spells[k];
		var failChance = m.getFailChance(spell);
		var res = withCastSeed(m, function () {
			var roll = Math.random();
			var wins = !spell.fail || roll < (1 - failChance);
			var fate = null;
			if (k === 'hand of fate') fate = replayFate(wins);
			return {roll: roll, wins: wins, fate: fate};
		});
		if (!res) { predCache.key = ''; return null; }
		out[k] = {
			wins:       res.wins,
			roll:       res.roll,
			failChance: failChance,
			fate:       res.fate
		};
	}

	predCache.key = key;
	predCache.data = out;
	return out;
}


/* ------------------------------------------------------------------ *
 * What a cast is actually worth
 * ------------------------------------------------------------------ */

var LOOKAHEAD = 20;      // casts to read ahead when deciding whether to wait

/**
 * Cookies, using the game's own formulas.
 *
 * Two of these are exact and one thing about them matters more than any tuning:
 * both Conjure Baked Goods and a Lucky pay
 *     min(cookies * 0.15, cookiesPs * <window>)
 * and Game.cookiesPs already carries whatever buffs are running. So the same
 * cast is worth several times more inside a Frenzy, and it is capped by
 * whichever of your bank and your production is smaller - which is what makes
 * "when" a real decision rather than a preference.
 *
 * Everything not valued here returns null. The profit planner will not spend
 * magic on a spell it cannot price; those stay available to arm by hand.
 */
function spellValue(m, key, pred) {
	if (!pred || !pred.wins) return null;
	var cookies = Game.cookies, cps = Game.cookiesPs;

	if (key === 'conjure baked goods') {
		var v = Math.max(7, Math.min(cookies * 0.15, cps * 60 * 30));
		var capped = (cookies * 0.15) <= (cps * 60 * 30);
		return {
			cookies: v,
			exact: true,
			note: capped ? 'limited by your bank (15% of it)' : 'limited by 30 minutes of production'
		};
	}

	if (key === 'hand of fate') {
		if (!pred.fate) return null;
		if (pred.fate === 'multiply cookies') {
			return {
				cookies: Math.min(cookies * 0.15, cps * 60 * 15) + 13,
				exact: true,
				note: 'a Lucky, worth 15% of your bank or 15 minutes, whichever is less'
			};
		}
		if (pred.fate === 'frenzy') {
			// x7 for 77 seconds. Refreshing a Frenzy that is already running
			// replaces it rather than stacking, so it is worth far less then.
			if (Game.hasBuff('Frenzy')) {
				return {cookies: cps * 20, exact: false, note: 'a Frenzy, but one is already running'};
			}
			return {cookies: 6 * cps * 77, exact: false, note: 'a Frenzy: x7 production for 77 seconds'};
		}
		if (pred.fate === 'building special') {
			return {cookies: cps * 60 * 10, exact: false, note: 'a Building Special'};
		}
		if (pred.fate === 'cookie storm') {
			return {cookies: cps * 60 * 7, exact: false, note: 'a Cookie Storm'};
		}
		if (pred.fate === 'blood frenzy') {
			return {cookies: 665 * cps * 6, exact: false, note: 'a Blood Frenzy: x666 for 6 seconds'};
		}
		// Click frenzies are only worth anything if you are clicking, and a
		// Cookie Storm drop is a single cookie. Neither is worth planning for.
		return {cookies: 0, exact: true, note: 'nothing worth the magic'};
	}

	return null;
}

/**
 * Force the Hand of Fate outcomes for the next few casts.
 *
 * Every roll is fixed by the save seed and the number of spells ever cast, so
 * the future is readable - not guessable. That is what lets the planner decide
 * to sit on its magic: it can see a Frenzy three casts away and know that
 * spending now would take the roll that leads there.
 */
function lookaheadFate(m, count) {
	var out = [];
	var failChance = m.getFailChance(m.spells['hand of fate']);
	for (var j = 0; j < count; j++) {
		var res = withCastSeed(m, function () {
			var roll = Math.random();
			var wins = roll < (1 - failChance);
			return {wins: wins, fate: replayFate(wins)};
		}, m.spellsCastTotal + j);
		if (!res) break;
		out.push({at: j, wins: res.wins, fate: res.fate});
	}
	return out;
}

/**
 * Picks what to cast, and when, for cookies.
 *
 * The rules, in order:
 *   1. never a roll that backfires - the seed already says which those are;
 *   2. never Conjure while its payout is still climbing, because it is capped
 *      by 15% of your bank and waiting for the bank to reach that cap is free;
 *   3. take the best cookies-per-magic on offer, but only if it is within
 *      `patience` of the best thing visible in the next LOOKAHEAD rolls -
 *      otherwise hold the magic for that instead.
 */
function chooseProfitCast(m, preds) {
	if (!preds) return {reason: 'cannot read the roll'};

	var reserve = m.magicM * S.reserve;
	var best = null, blocked = null;

	for (var k in m.spells) {
		var spell = m.spells[k], p = preds[k];
		var cost = m.getSpellCost(spell);
		if (cost <= 0) continue;
		if (m.magic - cost < reserve) continue;
		if (!p || !p.wins) continue;

		var val = spellValue(m, k, p);
		if (!val || val.cookies <= 0) continue;

		// Conjure's payout rises with your bank until it hits the cap. Casting
		// early throws away the difference for nothing.
		if (k === 'conjure baked goods') {
			var cap = Game.cookiesPs * 60 * 30;
			var now = Math.min(Game.cookies * 0.15, cap);
			if (now < cap * S.conjureAt) {
				blocked = blocked || ('Conjure Baked Goods pays ' +
					Math.round(100 * now / cap) + '% of its cap - waiting for your bank to fill');
				continue;
			}
		}

		var per = val.cookies / cost;
		if (!best || per > best.per) {
			best = {spell: spell, key: k, pred: p, value: val, per: per, cost: cost};
		}
	}

	// Is something better close enough ahead to be worth holding out for?
	var ahead = lookaheadFate(m, LOOKAHEAD);
	var fateCost = m.getSpellCost(m.spells['hand of fate']);
	var bestAhead = null;
	for (var i = 1; i < ahead.length; i++) {
		if (!ahead[i].wins) continue;
		var v = spellValue(m, 'hand of fate', ahead[i]);
		if (!v || v.cookies <= 0) continue;
		var per2 = v.cookies / fateCost;
		if (!bestAhead || per2 > bestAhead.per) {
			bestAhead = {per: per2, at: ahead[i].at, fate: ahead[i].fate, value: v};
		}
	}

	if (best && bestAhead && bestAhead.per > best.per / Math.max(0.01, S.patience)) {
		var label = (FATE_OUTCOMES[bestAhead.fate] || {}).label || bestAhead.fate;
		return {
			reason: 'holding: ' + label + ' is ' + bestAhead.at + ' cast' +
				(bestAhead.at === 1 ? '' : 's') + ' away and worth far more',
			hold: true
		};
	}

	if (best) return best;
	if (bestAhead) {
		var lbl = (FATE_OUTCOMES[bestAhead.fate] || {}).label || bestAhead.fate;
		return {reason: 'nothing worth casting now; ' + lbl + ' is ' + bestAhead.at +
			' casts away', hold: true};
	}
	return {reason: blocked || 'nothing worth casting at this roll'};
}

/* ------------------------------------------------------------------ *
 * Auto-cast
 * ------------------------------------------------------------------ */

function fateIsWorthIt(force) {
	var o = FATE_OUTCOMES[force];
	if (!o) return false;
	// Blab is a dud and a cookie storm drop is a rounding error; everything
	// else on the good list is worth the magic.
	return o.good && force !== 'cookie storm drop';
}

/**
 * A roll only changes when a spell is actually cast, so refusing to cast a bad
 * one means living with it forever: nothing moves the counter, so the same bad
 * roll comes back every time. The way out is to spend a cheap spell on purpose
 * and step to the next roll.
 *
 * Only offered at full magic, which makes the timing decision easy: magic that
 * is already capped is regenerating into nothing, so the burn costs no progress
 * at all. Below the cap it would eat magic the armed spell is still saving for.
 */
function burnCandidate(m, preds) {
	if (!S.burnBadRolls) return null;
	if (m.magic < m.magicM * 0.98) return null;
	for (var i = 0; i < BURN_ORDER.length; i++) {
		var key = BURN_ORDER[i], spell = m.spells[key];
		if (!spell || S.autoSpells[key]) continue;      // not the one we are waiting on
		if (m.magic >= m.getSpellCost(spell)) return {spell: spell, key: key, pred: preds[key], burn: true};
	}
	return null;
}

/**
 * The rules, in the order they are checked. Returns the spell to cast, or a
 * reason not to - the panel shows whichever it gets, so a stalled auto-cast
 * always says why it is stalled rather than looking broken.
 */
function chooseAutoCast(m, preds) {
	if (!S.autoArmed) return {reason: 'auto-cast is off'};
	if (!preds) return {reason: 'cannot read the roll'};

	if (S.strategy === 'profit') {
		var pick = chooseProfitCast(m, preds);
		if (pick.spell) return pick;
		// Holding out for something better is a decision, not a stall, so the
		// burn rule stays out of its way.
		if (pick.hold) return pick;
		var burn = burnCandidate(m, preds);
		return burn || pick;
	}

	var reserve = m.magicM * S.reserve;
	var blocked = null, stalledOnRoll = false;

	for (var k in m.spells) {
		if (!S.autoSpells[k]) continue;
		var spell = m.spells[k], p = preds[k];
		var cost = m.getSpellCost(spell);

		// Two very different reasons live here, and telling a player "saving
		// magic" when the bank is simply too small reads as though a setting is
		// in the way. Magic regenerates at well under one point a minute, so a
		// spell can legitimately be half an hour off - say so, with the wait.
		if (m.magic < cost) {
			blocked = blocked || (spell.name + ': needs ' + fmt(cost) + ' magic, have ' +
				Math.floor(m.magic) + ' (about ' + fmtTime(secondsUntil(m, cost)) + ')');
			continue;
		}
		if (m.magic - cost < reserve) {
			blocked = blocked || (spell.name + ': affordable, but that would dip into your ' +
				Math.round(S.reserve * 100) + '% reserve');
			continue;
		}
		if (S.onlyWins && !p.wins) {
			blocked = blocked || (spell.name + ': this roll backfires');
			stalledOnRoll = true;
			continue;
		}
		if (k === 'hand of fate' && S.fateFilter && p.fate && !fateIsWorthIt(p.fate)) {
			blocked = blocked || (spell.name + ': roll gives ' +
				((FATE_OUTCOMES[p.fate] || {}).label || p.fate));
			stalledOnRoll = true;
			continue;
		}
		return {spell: spell, key: k, pred: p};
	}

	// Nothing armed can be cast because of the roll itself. The roll will not
	// change on its own, so either burn past it or say plainly that it is stuck.
	if (stalledOnRoll) {
		var burn = burnCandidate(m, preds);
		if (burn) return burn;
		if (!S.burnBadRolls) {
			return {reason: blocked + ' - this roll cannot change until something is cast' +
				' (turn on "burn past bad rolls", or cast one yourself)'};
		}
		return {reason: blocked + ' - waiting for full magic to burn past it'};
	}
	return {reason: blocked || 'nothing armed is ready'};
}

function runAuto(m) {
	var preds = predictions(m);
	var pick = chooseAutoCast(m, preds);
	if (!pick.spell) { statusText = pick.reason; return; }

	var before = m.spellsCastTotal;
	var ok = m.castSpell(pick.spell);
	if (!ok) { statusText = pick.spell.name + ': the game refused the cast'; return; }

	stats.cast++;
	if (pick.burn) stats.burned++;
	if (pick.pred && !pick.pred.wins) stats.backfired++;
	if (pick.burn) {
		statusText = 'burned a bad roll with ' + pick.spell.name + ' - a fresh roll is up';
		return;
	}
	statusText = 'cast ' + pick.spell.name +
		(pick.pred.fate ? ' -> ' + ((FATE_OUTCOMES[pick.pred.fate] || {}).label || pick.pred.fate) : '') +
		(pick.value ? ', about ' + fmt(pick.value.cookies) + ' cookies' : '') +
		(pick.pred.wins ? '' : ' (backfired)');
	if (m.spellsCastTotal === before) statusText += ' - the cast did not take';
}

/* ------------------------------------------------------------------ *
 * Panel
 * ------------------------------------------------------------------ */

/**
 * Hover text, kept in one place so the panel markup stays readable and every
 * explanation is written once. Anything a player might reasonably wonder about
 * is answered here rather than by a longer label.
 */
var HELP = {
	magic:   'Magic pays for spells and refills on its own. It refills more slowly the emptier it is, so a bank sitting at full is regenerating almost nothing - which is the moment a cheap spell costs you close to nothing.',
	roll:    'The game seeds its generator with your save seed and the number of spells you have ever cast, then draws once. The next result is therefore already fixed, shared by every spell in the list, and whichever you cast first takes it. It changes only when something is actually cast.',
	auto:    'Turn auto-casting on. Nothing is cast until you also tick "auto" on the spells you want, and a roll that will backfire is never cast.',
	help:    'Explain how the outcome can be known before you cast.',
	colName: 'The spell, in the order the Grimoire itself lists them. Hover a row for what it does and what its backfire costs.',
	colCost: 'Magic this spell costs right now. It scales with your maximum magic, so it grows as you build and level Wizard towers.',
	colOut:  'What this cast would actually do - read out of the seed, not estimated. WIN means it succeeds, BACKFIRE means it fails and does its backfire instead.',
	colWhy:  'For Force the Hand of Fate, the exact golden cookie you would get. Otherwise what a backfire would cost you, or how long until you can afford the spell.',
	colArm:  'Let auto-cast use this spell. Off for everything until you say otherwise.',
	colCast: 'Cast it now, by hand, at the outcome shown.',
	onlyWins:'Skip any cast the seed says will backfire. Turning this off makes auto-cast ordinary again - it will spend magic on losing rolls.',
	fateFlt: 'Only spend Force the Hand of Fate on an outcome worth having. A Blab does nothing and a Cookie Storm drop is a single cookie, so both are skipped.',
	burn:    'A bad roll never clears on its own, because only a cast advances the seed. With this on a cheap spell is cast to step past it - but only while magic is full, where the magic it costs was about to be wasted anyway.',
	reserve: 'Magic to leave untouched. Useful when you are saving for something expensive and do not want auto-cast spending it first.',
	strategy:'Switch between casting only the spells you tick, and letting the assistant choose. Choosing for cookies values each cast with the game\'s own payout formulas, reads the next twenty rolls, and will sit on full magic rather than spend it on a mediocre one - it holds Conjure until your bank is big enough to pay its cap, and holds Force the Hand of Fate for a Frenzy or a Lucky.'
};

function tip(key) {
	return HELP[key] ? ' title="' + HELP[key].replace(/"/g, '&quot;') + '"' : '';
}

function buildCSS() {
return [
	'#' + PANEL_ID + '{position:relative;z-index:120;margin:0;padding:8px 24px 10px 24px;',
	'background:rgba(0,0,0,0.84);color:#e8e8e8;font-size:14px;',
	'border-top:1px solid #8d5fd3;box-shadow:0 0 8px rgba(0,0,0,0.6) inset;text-align:left;}',
	'#' + PANEL_ID + ' .gmgRow{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:4px 0;}',
	'#' + PANEL_ID + ' .gmgTitle{font-weight:bold;color:#c0a0f0;letter-spacing:1px;}',
	'#' + PANEL_ID + ' .gmgBtn{cursor:pointer;border:1px solid rgba(255,255,255,0.35);border-radius:3px;',
	'padding:1px 9px;font-weight:bold;font-size:13px;background:rgba(255,255,255,0.08);color:#fff;}',
	'#' + PANEL_ID + ' .gmgBtn:hover{background:rgba(255,255,255,0.2);}',
	'#' + PANEL_ID + ' .gmgBtn.gmgOn{background:#8d5fd3;color:#fff;border-color:#cbb0f0;}',
	'#' + PANEL_ID + ' .gmgStat{font-size:13px;color:#bbb;}',
	'#' + PANEL_ID + ' .gmgStat b{color:#fff;}',
	'#' + PANEL_ID + ' .gmgSep{border:0;height:1px;background:#413352;margin:6px 0;}',
	'#' + PANEL_ID + ' .gmgNote{font-size:12px;color:#9a9a9a;max-width:660px;line-height:1.45;}',
	'#' + PANEL_ID + ' table{border-collapse:collapse;font-size:13px;}',
	'#' + PANEL_ID + ' td{padding:2px 8px;white-space:nowrap;vertical-align:middle;}',
	'#' + PANEL_ID + ' td.gmgNum{text-align:right;font-family:monospace;}',
	'#' + PANEL_ID + ' tr.gmgPoor td{opacity:0.45;}',
	'#' + PANEL_ID + ' tr.gmgHead td{color:#9a86bb;font-size:11px;text-transform:uppercase;',
	'letter-spacing:0.5px;border-bottom:1px solid #413352;}',
	'#' + PANEL_ID + ' [title]{cursor:help;}',
	'#' + PANEL_ID + ' .gmgBtn[title]{cursor:pointer;}',
	// The spell icons come straight off the game's own sheet.
	'#' + PANEL_ID + ' .gmgIcon{width:24px;height:24px;position:relative;overflow:hidden;',
	'display:inline-block;vertical-align:middle;}',
	'#' + PANEL_ID + ' .gmgIcon i{position:absolute;left:0;top:0;width:48px;height:48px;',
	'transform:scale(0.5);transform-origin:0 0;background:url(' + iconSheet() + ');}',
	'#' + PANEL_ID + ' .gmgWin{color:#7ddc6a;font-weight:bold;}',
	'#' + PANEL_ID + ' .gmgFail{color:#ff6b6b;font-weight:bold;}',
	'#' + PANEL_ID + ' .gmgFate{color:#ffd75e;}',
	'#' + PANEL_ID + ' .gmgDim{color:#8a8a8a;}',
	'#' + PANEL_ID + ' .gmgBar{display:inline-block;width:150px;height:9px;border-radius:5px;',
	'background:rgba(255,255,255,0.12);overflow:hidden;vertical-align:middle;}',
	'#' + PANEL_ID + ' .gmgBarFull{height:100%;background:linear-gradient(90deg,#6f4bb0,#c0a0f0);}',
	'#' + PANEL_ID + ' label{font-size:13px;color:#ddd;cursor:pointer;}',
	'#' + PANEL_ID + ' .gmgSet{display:flex;align-items:center;gap:5px;}'
].join('');
}

function iconSheet() {
	var base = (typeof Game !== 'undefined' && Game.resPath) ? Game.resPath : '';
	var ver  = (typeof Game !== 'undefined' && Game.version) ? Game.version : '';
	return base + 'img/icons.png?v=' + ver;
}

function injectCSS() {
	if (document.getElementById('grandmasGrimoireCSS')) return;
	var st = document.createElement('style');
	st.id = 'grandmasGrimoireCSS';
	st.textContent = buildCSS();
	document.head.appendChild(st);
}

function buildPanel(host, m) {
	injectCSS();
	var panel = document.createElement('div');
	panel.id = PANEL_ID;
	panel.innerHTML =
		'<div class="gmgRow">' +
			'<span class="gmgTitle">GRANDMA&#39;S GRIMOIRE</span>' +
			'<span class="gmgStat" id="gmgMagic"' + tip('magic') + '></span>' +
			'<span class="gmgBar"><span class="gmgBarFull" id="gmgBar" style="width:0%;"></span></span>' +
			'<div class="gmgBtn" data-act="auto" id="gmgAutoBtn"' + tip('auto') + '>Auto-cast</div>' +
			'<div class="gmgBtn" data-act="help"' + tip('help') + '>How this works</div>' +
		'</div>' +
		'<div class="gmgRow"><span class="gmgStat" id="gmgRoll"' + tip('roll') + '></span></div>' +
		'<div id="gmgHelpBox" style="display:none;"><hr class="gmgSep">' +
			'<span class="gmgNote">A cast is not rolled when you click it. The game seeds its ' +
			'random generator with your save seed and the number of spells you have ever cast, ' +
			'so the result of your next cast is already fixed and can simply be read. That is ' +
			'what the WIN and BACKFIRE column is - not an estimate, the actual outcome. It ' +
			'changes only when the cast counter does, which is why every spell in the list ' +
			'shares the same roll: whichever you cast first gets it.' +
			'<br><br>Auto-cast is off until you arm it and tick individual spells. It never casts ' +
			'a roll it can see will backfire, and for Force the Hand of Fate it waits for an ' +
			'outcome worth the magic.</span>' +
		'</div>' +
		'<hr class="gmgSep">' +
		'<table id="gmgTable">' + buildSpellRows(m) + '</table>' +
		'<div id="gmgAutoBox" style="display:none;"><hr class="gmgSep">' +
			'<div class="gmgRow">' +
				'<div class="gmgSet"' + tip('onlyWins') + '><input type="checkbox" id="gmgSet-onlyWins" data-key="onlyWins">' +
					'<label for="gmgSet-onlyWins">Only cast rolls that win</label></div>' +
				'<div class="gmgSet"' + tip('fateFlt') + '><input type="checkbox" id="gmgSet-fateFilter" data-key="fateFilter">' +
					'<label for="gmgSet-fateFilter">Force the Hand of Fate only for a worthwhile cookie</label></div>' +
				'<div class="gmgSet"' + tip('burn') + '><input type="checkbox" id="gmgSet-burnBadRolls" data-key="burnBadRolls">' +
					'<label for="gmgSet-burnBadRolls">Burn past bad rolls at full magic</label></div>' +
				'<div class="gmgSet"' + tip('strategy') + '>' +
					'<div class="gmgBtn" data-act="strategy" id="gmgStrategyBtn"></div></div>' +
				'<div class="gmgSet"' + tip('reserve') + '><label for="gmgSet-reserve">Keep in reserve</label>' +
					'<input type="number" id="gmgSet-reserve" data-key="reserve" min="0" max="90" step="5" ' +
					'style="width:56px;background:#1a1a1a;color:#eee;border:1px solid #666;border-radius:3px;">' +
					'<span class="gmgStat">% of max magic</span></div>' +
			'</div>' +
		'</div>' +
		'<hr class="gmgSep">' +
		'<div class="gmgRow"><span class="gmgStat" id="gmgStatus"></span></div>';

	host.parentNode.insertBefore(panel, host.nextSibling);
	panel.addEventListener('click', onPanelClick);
	panel.addEventListener('change', onPanelChange);
	return panel;
}

function ensurePanel(m) {
	if (typeof document === 'undefined') return null;
	var panel = document.getElementById(PANEL_ID);
	if (panel && panel.isConnected) return panel;
	var host = document.getElementById('grimoireContent');
	if (!host) return null;
	if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
	panelJustBuilt = true;
	return buildPanel(host, m);
}

function onPanelClick(e) {
	var el = e.target.closest ? e.target.closest('[data-act]') : null;
	if (!el) return;
	var act = el.getAttribute('data-act');
	var m = grimoire();

	if (act === 'auto') {
		S.autoArmed = !S.autoArmed;
		lastAutoTick = -1e9;          // act on the very next frame, not a second later
		lastCastTotal = -1;
	} else if (act === 'strategy') {
		S.strategy = (S.strategy === 'profit') ? 'manual' : 'profit';
		lastAutoTick = -1e9;
		lastCastTotal = -1;
	} else if (act === 'help') {
		showHelp = !showHelp;
	} else if (act === 'arm') {
		var key = el.getAttribute('data-spell');
		S.autoSpells[key] = !S.autoSpells[key];
		lastAutoTick = -1e9;
		lastCastTotal = -1;
	} else if (act === 'cast') {
		// Casting by hand from the panel, for when you want the roll but not
		// a standing rule.
		var key2 = el.getAttribute('data-spell');
		if (m && m.spells[key2]) {
			var p = predictions(m);
			if (m.castSpell(m.spells[key2])) {
				stats.cast++;
				if (p && p[key2] && !p[key2].wins) stats.backfired++;
			}
		}
	}
	safeUI('panel refresh', refreshPanel);
}

function onPanelChange(e) {
	var el = e.target, key = el.getAttribute && el.getAttribute('data-key');
	if (!key) return;
	if (key === 'reserve') S.reserve = Math.max(0, Math.min(0.9, (parseFloat(el.value) || 0) / 100));
	else S[key] = !!el.checked;
	safeUI('panel refresh', refreshPanel);
}

function setText(id, text) {
	var el = document.getElementById(id);
	if (el && el.textContent !== text) el.textContent = text;
}

function setInner(id, html) {
	var el = document.getElementById(id);
	if (el && el.innerHTML !== html) el.innerHTML = html;
}

function setHTML(id, html) {
	var el = document.getElementById(id);
	if (el && el.innerHTML !== html) el.innerHTML = html;
}

/**
 * The spell rows are built once and then only their changed cells are
 * rewritten.
 *
 * Rebuilding the table's innerHTML every frame - which is what this used to do,
 * because the cost and the countdown change constantly - destroyed and recreated
 * every button thirty times a second. A click whose mousedown landed on a button
 * that was replaced before the mouseup simply never arrived, so the "auto"
 * toggles were unusable. Delegated listeners do not save you from that: the
 * element the press started on has to still be there when it ends.
 */
function buildSpellRows(m) {
	var rows = '<tr class="gmgHead">' +
		'<td></td>' +
		'<td' + tip('colName') + '>Spell</td>' +
		'<td class="gmgNum"' + tip('colCost') + '>Cost</td>' +
		'<td' + tip('colOut') + '>This cast</td>' +
		'<td' + tip('colWhy') + '>What that means</td>' +
		'<td' + tip('colArm') + '>Auto</td>' +
		'<td></td></tr>';

	for (var key in m.spells) {
		var spell = m.spells[key], icon = spell.icon || [28, 12];

		// The row explains itself on hover using the game's own description and
		// backfire text, with the markup stripped out of them.
		var rowTip = spell.name + '. ' + (spell.desc || '') +
			(spell.failDesc ? '  Backfire: ' + spell.failDesc : '');
		rowTip = rowTip.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').replace(/"/g, '&quot;').trim();

		var armTip = DESTRUCTIVE[key]
			? 'Careful - this one ' + DESTRUCTIVE[key] + '. Auto-cast still refuses a roll it can ' +
			  'see will backfire, but arm it only if you mean it.'
			: HELP.colArm;

		rows += '<tr id="gmgR-' + spell.id + '" title="' + rowTip + '">' +
			'<td><span class="gmgIcon"><i style="background-position:' +
				(-icon[0] * 48) + 'px ' + (-icon[1] * 48) + 'px;"></i></span></td>' +
			'<td>' + spell.name + '</td>' +
			'<td class="gmgNum" id="gmgR-' + spell.id + '-cost"' + tip('colCost') + '></td>' +
			'<td id="gmgR-' + spell.id + '-out"' + tip('colOut') + '></td>' +
			'<td id="gmgR-' + spell.id + '-why"' + tip('colWhy') + '></td>' +
			'<td><div class="gmgBtn" id="gmgR-' + spell.id + '-arm" data-act="arm" data-spell="' +
				key.replace(/"/g, '&quot;') + '" title="' + armTip.replace(/"/g, '&quot;') +
				'">auto</div></td>' +
			'<td><div class="gmgBtn" id="gmgR-' + spell.id + '-cast" data-act="cast" data-spell="' +
				key.replace(/"/g, '&quot;') + '"' + tip('colCast') + '>cast</div></td>' +
			'</tr>';
	}
	return rows;
}

/** Rewrites only what actually changed, leaving every button in place. */
function updateSpellRows(m, preds) {
	for (var key in m.spells) {
		var spell = m.spells[key], id = spell.id;
		var cost = m.getSpellCost(spell);
		var affordable = m.magic >= cost;
		var p = preds ? preds[key] : null;

		var row = document.getElementById('gmgR-' + id);
		if (row) {
			var cls = affordable ? '' : 'gmgPoor';
			if (row.className !== cls) row.className = cls;
		}

		setText('gmgR-' + id + '-cost', fmt(cost));

		var outcome;
		if (!p) outcome = '<span class="gmgDim">-</span>';
		else if (!spell.fail) outcome = '<span class="gmgWin">always works</span>';
		else if (p.wins) outcome = '<span class="gmgWin">WIN</span>';
		else outcome = '<span class="gmgFail">BACKFIRE</span>';
		setInner('gmgR-' + id + '-out', outcome);

		var detail = '';
		if (p && p.fate) {
			var o = FATE_OUTCOMES[p.fate] || {label: p.fate, note: ''};
			detail = '<span class="gmgFate">-&gt; ' + o.label + '</span> <span class="gmgDim">' +
				o.note + '</span>';
		} else if (p && !p.wins && DESTRUCTIVE[key]) {
			detail = '<span class="gmgFail">-&gt; ' + DESTRUCTIVE[key] + '</span>';
		} else if (!affordable) {
			detail = '<span class="gmgDim">ready in ' + fmtTime(secondsUntil(m, cost)) + '</span>';
		}
		setInner('gmgR-' + id + '-why', detail);

		var armBtn = document.getElementById('gmgR-' + id + '-arm');
		if (armBtn) {
			var armCls = 'gmgBtn' + (S.autoSpells[key] ? ' gmgOn' : '');
			if (armBtn.className !== armCls) armBtn.className = armCls;
		}
		var castBtn = document.getElementById('gmgR-' + id + '-cast');
		if (castBtn) {
			var vis = affordable ? '' : 'none';
			if (castBtn.style.display !== vis) castBtn.style.display = vis;
		}
	}
}

function refreshPanel() {
	var m = grimoire();
	if (!m || !document.getElementById(PANEL_ID)) return;

	var preds = predictions(m);

	setText('gmgMagic', 'Magic ' + Math.floor(m.magic) + ' / ' + Math.floor(m.magicM) +
		'  (+' + magicPerSecond(m).toFixed(2) + '/s)');
	var bar = document.getElementById('gmgBar');
	if (bar) bar.style.width = ((m.magic / Math.max(1, m.magicM)) * 100) + '%';

	var autoBtn = document.getElementById('gmgAutoBtn');
	if (autoBtn) autoBtn.className = 'gmgBtn' + (S.autoArmed ? ' gmgOn' : '');
	var autoBox = document.getElementById('gmgAutoBox');
	if (autoBox) autoBox.style.display = S.autoArmed ? 'block' : 'none';
	var helpBox = document.getElementById('gmgHelpBox');
	if (helpBox) helpBox.style.display = showHelp ? 'block' : 'none';

	if (S.autoArmed) {
		var r = document.getElementById('gmgSet-reserve');
		if (r && document.activeElement !== r) r.value = Math.round(S.reserve * 100);
		var ow = document.getElementById('gmgSet-onlyWins');
		if (ow) ow.checked = !!S.onlyWins;
		var ff = document.getElementById('gmgSet-fateFilter');
		if (ff) ff.checked = !!S.fateFilter;
		var bb = document.getElementById('gmgSet-burnBadRolls');
		if (bb) bb.checked = !!S.burnBadRolls;
		var sb2 = document.getElementById('gmgStrategyBtn');
		if (sb2) {
			var want = (S.strategy === 'profit')
				? 'Choosing for cookies' : 'Only what I arm';
			if (sb2.textContent !== want) sb2.textContent = want;
			var cls = 'gmgBtn' + (S.strategy === 'profit' ? ' gmgOn' : '');
			if (sb2.className !== cls) sb2.className = cls;
		}
	}

	// Every spell shares one roll, because the seed does not depend on which
	// spell you pick - only on how many you have cast. Worth saying plainly.
	if (preds) {
		var anyFail = false;
		for (var k in preds) if (preds[k].failChance > 0) anyFail = true;
		setText('gmgRoll', 'Cast #' + (m.spellsCastTotal + 1) + ' is already decided - every spell ' +
			'below shares it, and whichever you cast first takes it.' +
			(anyFail ? '' : ' (no spell can backfire right now)'));
	} else {
		setText('gmgRoll', 'The roll cannot be read in this build - costs and timings still work.');
	}

	updateSpellRows(m, preds);

	var lines = [];
	if (S.autoArmed) {
		var armedNames = [];
		for (var ak in S.autoSpells) if (S.autoSpells[ak] && m.spells[ak]) armedNames.push(m.spells[ak].name);
		lines.push('Auto-cast is on, ' + (armedNames.length
			? 'armed for ' + armedNames.join(', ')
			: 'but no spell is armed yet - press "auto" on the ones you want'));
	}
	lines.push(statusText);
	if (stats.cast) {
		lines.push(stats.cast + ' cast from here, ' + stats.backfired + ' backfired' +
			(stats.burned ? ', ' + stats.burned + ' spent burning bad rolls' : ''));
	}
	setHTML('gmgStatus', lines.join('<br>'));
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

function saveString() {
	return JSON.stringify({v: 1, S: S, stats: stats});
}

function loadString(str) {
	if (!str) return;
	var data = JSON.parse(str);
	if (data.S) {
		for (var k in DEFAULTS) {
			if (k === 'autoSpells') continue;
			if (typeof data.S[k] === typeof DEFAULTS[k]) S[k] = data.S[k];
		}
		S.autoSpells = {};
		if (data.S.autoSpells) for (var sk in data.S.autoSpells) S.autoSpells[sk] = !!data.S.autoSpells[sk];
	}
	if (data.stats) for (var st in stats) if (typeof data.stats[st] === 'number') stats[st] = data.stats[st];
	predCache.key = '';
}

/* ------------------------------------------------------------------ *
 * Hooks
 * ------------------------------------------------------------------ */

function safeUI(what, fn) {
	if (uiBroken) return;
	try {
		fn();
	} catch (err) {
		uiBroken = true;
		console.error('[Grandma\'s Grimoire] ' + what + ' failed - the panel is disabled for this ' +
			'session. Please report this:', err);
	}
}

function onLogic() {
	var m = grimoire();
	if (!m) return;

	safeUI('panel setup', function () {
		ensurePanel(m);
		if (panelJustBuilt) { panelJustBuilt = false; refreshPanel(); }
	});

	try {
		// Re-checked on a timer rather than only when the cast counter moves.
		// Tying it to the counter deadlocks: if the next roll backfires nothing
		// is cast, so the counter never moves, so it never looks again - and it
		// would stay stuck even after magic regenerated or a buff changed the
		// odds. Once a second is often enough to feel instant and far too slow
		// to hammer a spell the game keeps declining.
		if (S.autoArmed) {
			var now = (typeof Game !== 'undefined' && Game.T) ? Game.T : (autoTick + AUTO_EVERY);
			// Game.T is reset to 0 on load and on ascension, which would leave
			// `now` far behind lastAutoTick and stall this forever - so a clock
			// that has gone backwards counts as due.
			if (now < lastAutoTick || now - lastAutoTick >= AUTO_EVERY ||
					m.spellsCastTotal !== lastCastTotal) {
				lastAutoTick = now;
				lastCastTotal = m.spellsCastTotal;
				runAuto(m);
			}
			autoTick++;
		}
	} catch (err) {
		statusText = 'error - see console';
		console.error('[Grandma\'s Grimoire] auto-cast failed:', err);
	}

	safeUI('panel refresh', refreshPanel);
}

function onReset() {
	predCache.key = '';
	lastCastTotal = -1;
	lastAutoTick = -1e9;
	S.autoArmed = false;          // never carry an armed caster into a new run
	statusText = 'reset - auto-cast disarmed';
}

Game.registerMod(MOD_ID, {
	init: function () {
		Game.registerHook('logic', onLogic);
		Game.registerHook('reset', onReset);
		console.log('[Grandma\'s Grimoire] v' + VERSION + ' ready.');
	},
	save: function () {
		try { return saveString(); } catch (e) { return ''; }
	},
	load: function (str) {
		try { loadString(str); } catch (e) { /* keep defaults */ }
	},

	/** Read-only window for other mods and for dev/test.js. */
	version: VERSION,
	getPredictions: function () { var m = grimoire(); return m ? predictions(m) : null; },
	getSettings:    function () { return S; },
	getStats:       function () { return stats; },
	getStatus:      function () { return statusText; },
	setAuto:        function (key, on) { S.autoSpells[key] = !!on; },
	setArmed:       function (on) { S.autoArmed = !!on; lastCastTotal = -1; lastAutoTick = -1e9; },
	chooseAutoCast: function () { var m = grimoire(); return m ? chooseAutoCast(m, predictions(m)) : null; },
	runAutoNow:     function () { var m = grimoire(); if (m) runAuto(m); },
	invalidate:     function () { predCache.key = ''; },
	spellValue:     function (key) { var m = grimoire(); if (!m) return null;
	                                 var p = predictions(m); return p ? spellValue(m, key, p[key]) : null; },
	lookahead:      function (n) { var m = grimoire(); return m ? lookaheadFate(m, n || LOOKAHEAD) : null; },
	setStrategy:    function (v) { S.strategy = v; lastAutoTick = -1e9; lastCastTotal = -1; }
});

})();
