/**
 * Behavioural tests for Grandma's Grimoire, run against the game's real
 * minigameGrimoire.js and the real seedrandom library through grimoire.js.
 *
 *   node test.js
 *
 * The prediction tests do not check the mod against a model of the game - they
 * predict, then actually cast, then compare.
 */
'use strict';

var boot = require('./grimoire.js').boot;

var passed = 0, failed = 0;

function ok(name, cond, detail) {
	if (cond) { passed++; console.log('  ok   ' + name); }
	else { failed++; console.log('  FAIL ' + name + (detail ? '   ' + detail : '')); }
}

function eq(name, got, want) {
	ok(name, got === want, 'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
}

function fresh(opts) {
	var sb = boot(opts);
	sb.mod = sb.loadMod();
	return sb;
}

/**
 * Predict every spell, cast one for real, and report whether the prediction
 * held. Returns {winHit, fateHit, casts}.
 */
function trial(opts, spellKey, casts) {
	var sb = fresh(opts);
	var spell = sb.M.spells[spellKey];
	var res = {winHit: 0, fateHit: 0, casts: 0, fateSeen: {}};

	for (var i = 0; i < casts; i++) {
		sb.M.magic = sb.M.magicM;
		sb.mod.invalidate();
		var p = sb.mod.getPredictions();
		if (!p || !p[spellKey]) break;
		var predWin = p[spellKey].wins, predFate = p[spellKey].fate;

		sb.lastShimmer = null;
		var before = sb.M.spellsCastTotal;
		sb.M.castSpell(spell);
		if (sb.M.spellsCastTotal === before) break;      // the game declined it
		res.casts++;

		if (spellKey === 'hand of fate') {
			var actualWin = !(sb.lastShimmer.forceObj && sb.lastShimmer.forceObj.wrath);
			if (predWin === actualWin) res.winHit++;
			if (predFate === sb.lastShimmer.force) res.fateHit++;
			res.fateSeen[sb.lastShimmer.force] = (res.fateSeen[sb.lastShimmer.force] || 0) + 1;
		} else {
			// For the other spells the buff the game handed out says which
			// branch ran.
			res.winHit++;   // counted by the caller's own check
		}
	}
	return res;
}

/* ------------------------------------------------------------------ *
 * 1. The locked-in roll
 * ------------------------------------------------------------------ */
console.log('\nreading the roll');
(function () {
	var seeds = ['abcde', 'zzzzz', 'q7f2k', 'cookie', '11111'];
	var totalCasts = 0, winHits = 0, fateHits = 0, distinct = {};
	for (var s = 0; s < seeds.length; s++) {
		var r = trial({seed: seeds[s], towers: 150, level: 5}, 'hand of fate', 40);
		totalCasts += r.casts; winHits += r.winHit; fateHits += r.fateHit;
		for (var f in r.fateSeen) distinct[f] = 1;
	}
	ok('enough casts to mean something (' + totalCasts + ')', totalCasts >= 150);
	eq('win/backfire predicted correctly every time', winHits, totalCasts);
	eq('the exact golden cookie predicted every time', fateHits, totalCasts);
	ok('and the sample covered several outcomes (' + Object.keys(distinct).join(', ') + ')',
		Object.keys(distinct).length >= 3);
})();

(function () {
	// A spell that cannot backfire must never be reported as backfiring.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	var p = sb.mod.getPredictions();
	eq("gambler's fever dream has no fail branch", !!sb.M.spells["gambler's fever dream"].fail, false);
	eq('so it is always predicted to work', p["gambler's fever dream"].wins, true);
})();

/* ------------------------------------------------------------------ *
 * 2. The conditional draws - where a naive replay goes wrong
 * ------------------------------------------------------------------ */
console.log('\nconditional draws');

// Under ten buildings the game never takes the "building special" draw, and
// during Valentines and Easter the shimmer takes an extra one for its sprite.
// Get either wrong and every draw after it shifts, so the outcome changes.
[
	{name: 'fewer than ten buildings', opts: {buildings: 4}},
	{name: 'at least ten buildings',   opts: {buildings: 400}},
	{name: 'Valentines season',        opts: {season: 'valentines'}},
	{name: 'Easter season',            opts: {season: 'easter'}},
	{name: "April Fools' season",      opts: {season: 'fools'}},
	{name: 'Dragonflight active',      opts: {buffs: {'Dragonflight': 1}}},
	{name: 'Magic adept active',       opts: {buffs: {'Magic adept': 1}}},
	{name: 'Magic inept active',       opts: {buffs: {'Magic inept': 1}}}
].forEach(function (c) {
	var opts = {seed: 'q7f2k', towers: 150, level: 5};
	for (var k in c.opts) opts[k] = c.opts[k];
	var r = trial(opts, 'hand of fate', 25);
	ok(c.name + ': outcome still exact (' + r.fateHit + '/' + r.casts + ')',
		r.casts > 0 && r.fateHit === r.casts && r.winHit === r.casts);
});

(function () {
	// Magic inept multiplies the backfire chance by five, so a seed that wins
	// clean should start producing backfires - proof the fail chance is being
	// read from the game rather than assumed.
	var backfires = 0, casts = 0;
	for (var s = 0; s < 6; s++) {
		var r = trial({seed: 'seed' + s, towers: 150, level: 5, buffs: {'Magic inept': 1}},
			'hand of fate', 30);
		casts += r.casts;
		backfires += (r.fateSeen['clot'] || 0) + (r.fateSeen['ruin cookies'] || 0) +
			(r.fateSeen['blab'] || 0) + (r.fateSeen['cursed finger'] || 0) +
			(r.fateSeen['blood frenzy'] || 0);
	}
	ok('with Magic inept the backfires actually show up (' + backfires + ' of ' + casts + ')',
		backfires > 0);
})();

/* ------------------------------------------------------------------ *
 * 3. The global RNG must be handed back
 * ------------------------------------------------------------------ */
console.log('\nthe random generator is left alone');
(function () {
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	var rnd = sb.ctx.Math.random;

	sb.mod.invalidate(); sb.mod.getPredictions();
	var a = rnd();
	sb.mod.invalidate(); sb.mod.getPredictions();
	var b = rnd();

	// If the mod left the generator seeded, these two would be identical.
	ok('reading the roll does not leave the game on a fixed stream', a !== b,
		'both draws were ' + a);

	var seq = [];
	for (var i = 0; i < 5; i++) { sb.mod.invalidate(); sb.mod.getPredictions(); seq.push(rnd()); }
	var same = seq.every(function (v) { return v === seq[0]; });
	ok('and repeated reads do not repeat the stream', !same);
})();

(function () {
	// Reading the roll must not consume a cast or move any state.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	var before = {total: sb.M.spellsCastTotal, cast: sb.M.spellsCast, magic: sb.M.magic};
	for (var i = 0; i < 20; i++) { sb.mod.invalidate(); sb.mod.getPredictions(); }
	eq('the cast counter is untouched', sb.M.spellsCastTotal, before.total);
	eq('the session counter is untouched', sb.M.spellsCast, before.cast);
	eq('and no magic was spent', sb.M.magic, before.magic);
})();

/* ------------------------------------------------------------------ *
 * 4. Auto-cast safety
 * ------------------------------------------------------------------ */
console.log('\nauto-cast');
(function () {
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	eq('it is disarmed out of the box', sb.mod.getSettings().autoArmed, false);
	eq('and nothing is armed individually',
		Object.keys(sb.mod.getSettings().autoSpells).length, 0);

	var before = sb.M.spellsCastTotal;
	for (var i = 0; i < 30; i++) sb.frame();
	eq('so running the game casts nothing', sb.M.spellsCastTotal, before);
})();

(function () {
	// Arming the master switch alone is not enough; a spell has to be picked.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.mod.setArmed(true);
	var before = sb.M.spellsCastTotal;
	for (var i = 0; i < 10; i++) { sb.Game.T += 30; sb.frame(); }
	eq('armed but with nothing selected casts nothing', sb.M.spellsCastTotal, before);
	ok('and it says so', /nothing armed/.test(sb.mod.getStatus()), sb.mod.getStatus());
})();

(function () {
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.mod.setArmed(true);
	sb.mod.setAuto('conjure baked goods', true);
	sb.M.magic = sb.M.magicM;
	var before = sb.M.spellsCastTotal;
	sb.Game.T += 30;
	sb.frame();
	ok('an armed, affordable, winning spell is cast', sb.M.spellsCastTotal > before,
		sb.mod.getStatus());
})();

(function () {
	// The whole point of reading the roll: never spend magic on a loser.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.mod.setArmed(true);
	sb.mod.setAuto('hand of fate', true);
	sb.mod.getSettings().fateFilter = false;

	var casts = 0, backfires = 0;
	for (var i = 0; i < 200; i++) {
		sb.M.magic = sb.M.magicM;
		sb.mod.invalidate();
		var p = sb.mod.getPredictions();
		var predWin = p['hand of fate'].wins;
		var before = sb.M.spellsCastTotal;
		sb.Game.T += 30;                 // a second of game time between attempts
		sb.frame();
		if (sb.M.spellsCastTotal > before) { casts++; if (!predWin) backfires++; }
	}
	// Without a way past a bad roll it casts until it meets one and then stops,
	// because nothing else can move the counter. That is correct, and it is
	// exactly why burning exists.
	ok('it cast until it hit a bad roll (' + casts + ')', casts > 0);
	eq('and never once on a roll it could see would backfire', backfires, 0);
	ok('then it stalls, and says the roll cannot change',
		/cannot change until something is cast/.test(sb.mod.getStatus()), sb.mod.getStatus());
})();

(function () {
	// With burning on it keeps going, and every real cast is still a winner.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.mod.setArmed(true);
	sb.mod.setAuto('hand of fate', true);
	sb.mod.getSettings().fateFilter = false;
	sb.mod.getSettings().burnBadRolls = true;

	var fateCasts = 0, backfires = 0;
	for (var i = 0; i < 400; i++) {
		sb.M.magic = sb.M.magicM;
		sb.mod.invalidate();
		var p = sb.mod.getPredictions()['hand of fate'];
		sb.lastShimmer = null;
		var before = sb.M.spellsCastTotal;
		sb.Game.T += 30;
		sb.frame();
		if (sb.M.spellsCastTotal > before && sb.lastShimmer) {
			fateCasts++;
			if (sb.lastShimmer.forceObj && sb.lastShimmer.forceObj.wrath) backfires++;
		}
	}
	ok('burning keeps it moving (' + fateCasts + ' real casts)', fateCasts > 20);
	eq('and not one of them backfired', backfires, 0);
	ok('the burns are counted', sb.mod.getStats().burned > 0, JSON.stringify(sb.mod.getStats()));
})();

(function () {
	// Burning is only allowed when magic is capped, so it never eats magic the
	// armed spell is still saving for.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.mod.setArmed(true);
	sb.mod.setAuto('hand of fate', true);
	sb.mod.getSettings().burnBadRolls = true;

	// Walk to a roll the filter refuses, then starve it of magic.
	var found = false;
	for (var i = 0; i < 300 && !found; i++) {
		sb.mod.invalidate();
		var p = sb.mod.getPredictions()['hand of fate'];
		if (!p.wins) found = true; else sb.M.spellsCastTotal++;
	}
	ok('found a backfiring roll to test with', found);
	// Affordable, but short of the cap - so the roll is the only thing in the
	// way, and burning still has to wait.
	var cost = sb.M.getSpellCost(sb.M.spells['hand of fate']);
	sb.M.magic = Math.min(sb.M.magicM * 0.97, Math.max(cost + 1, sb.M.magicM * 0.9));
	ok('the test set up an affordable but uncapped bank (' +
		sb.M.magic.toFixed(1) + ' of ' + sb.M.magicM + ', cost ' + cost + ')',
		sb.M.magic >= cost && sb.M.magic < sb.M.magicM * 0.98);
	sb.mod.invalidate();
	var pick = sb.mod.chooseAutoCast();
	ok('below full magic it will not burn', !pick.spell && /waiting for full magic/.test(pick.reason),
		JSON.stringify(pick.reason));

	sb.M.magic = sb.M.magicM;
	pick = sb.mod.chooseAutoCast();
	ok('at full magic it burns', !!pick.spell && pick.burn === true,
		JSON.stringify(pick.reason || pick.key));
	ok('and never burns with the spell it is waiting on', !pick.spell || pick.key !== 'hand of fate');
})();

(function () {
	// A backfiring roll blocks, and the panel explains rather than going quiet.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.mod.setArmed(true);
	sb.mod.setAuto('hand of fate', true);
	sb.mod.getSettings().fateFilter = false;

	var sawBlock = false;
	for (var i = 0; i < 200 && !sawBlock; i++) {
		sb.M.magic = sb.M.magicM;
		sb.mod.invalidate();
		if (!sb.mod.getPredictions()['hand of fate'].wins) {
			var pick = sb.mod.chooseAutoCast();
			sawBlock = !pick.spell && /backfires/.test(pick.reason);
		}
		sb.M.spellsCastTotal++;    // move to the next roll without casting
	}
	ok('a backfiring roll is refused with a reason', sawBlock);
})();

(function () {
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.mod.setArmed(true);
	sb.mod.setAuto('conjure baked goods', true);
	sb.mod.getSettings().reserve = 0.9;
	sb.M.magic = sb.M.magicM;
	var pick = sb.mod.chooseAutoCast();
	ok('a magic reserve holds the cast back', !pick.spell && /reserve/.test(pick.reason),
		JSON.stringify(pick.reason));
})();

(function () {
	// "Cannot afford it yet" and "your reserve forbids it" are different
	// answers, and reporting the first as the second is what made auto-cast
	// look broken: magic regenerates at well under a point a minute, so a spell
	// can honestly be half an hour away.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.mod.setArmed(true);
	sb.mod.setAuto('conjure baked goods', true);
	sb.M.magic = 4;
	var pick = sb.mod.chooseAutoCast();
	ok('too little magic says so, with the wait',
		!pick.spell && /needs \d+ magic, have 4/.test(pick.reason) && /about /.test(pick.reason),
		JSON.stringify(pick.reason));
	ok('and does not blame the reserve', !/reserve/.test(pick.reason), JSON.stringify(pick.reason));
})();

(function () {
	// It must actually cast under real conditions: natural regeneration, the
	// clock advancing one frame at a time, nothing forced.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.mod.setArmed(true);
	sb.mod.setAuto('conjure baked goods', true);
	sb.M.magic = sb.M.magicM;
	var casts = 0, last = sb.M.spellsCastTotal;
	for (var i = 0; i < 3000; i++) {
		sb.M.logic();
		sb.frame();
		if (sb.M.spellsCastTotal !== last) { casts++; last = sb.M.spellsCastTotal; }
	}
	ok('it casts under ordinary play (' + casts + ' in 3000 frames)', casts > 0);
})();

(function () {
	// Game.T goes back to 0 on a save load and on ascension. A timer that only
	// looks forward would stall there for good.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.mod.setArmed(true);
	sb.mod.setAuto('conjure baked goods', true);
	sb.Game.T = 50000;
	sb.M.magic = sb.M.magicM;
	sb.frame();
	var after = sb.M.spellsCastTotal;

	sb.Game.T = 0;
	sb.M.magic = sb.M.magicM;
	for (var i = 0; i < 200; i++) { sb.M.logic(); sb.frame(); }
	ok('a clock that jumps backwards does not stall it', sb.M.spellsCastTotal > after);
})();

(function () {
	// The Force the Hand of Fate filter should hold out for a real buff.
	var sb = fresh({seed: 'q7f2k', towers: 150, level: 5});
	sb.mod.setArmed(true);
	sb.mod.setAuto('hand of fate', true);

	var castOutcomes = [];
	for (var i = 0; i < 250; i++) {
		sb.M.magic = sb.M.magicM;
		sb.mod.invalidate();
		var p = sb.mod.getPredictions()['hand of fate'];
		var before = sb.M.spellsCastTotal;
		sb.Game.T += 30;
		sb.frame();
		if (sb.M.spellsCastTotal > before) castOutcomes.push(p.fate);
	}
	ok('it cast something (' + castOutcomes.length + ')', castOutcomes.length > 0);
	var duds = castOutcomes.filter(function (f) {
		return f === 'blab' || f === 'clot' || f === 'ruin cookies' ||
			f === 'cursed finger' || f === 'cookie storm drop';
	});
	eq('and never on a dud outcome', duds.length, 0);
})();

(function () {
	// Ascending must not leave an armed caster running in the new game.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.mod.setArmed(true);
	eq('armed', sb.mod.getSettings().autoArmed, true);
	var hooks = sb.Game.hooks['reset'] || [];
	for (var i = 0; i < hooks.length; i++) hooks[i]();
	eq('a reset disarms it', sb.mod.getSettings().autoArmed, false);
})();

/* ------------------------------------------------------------------ *
 * 5. Costs and timings
 * ------------------------------------------------------------------ */
console.log('\ncosts and timings');
(function () {
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	var spell = sb.M.spells['conjure baked goods'];
	// costMin 2 + 0.4 * magicM, floored - straight from the game.
	var want = Math.floor(2 + sb.M.magicM * 0.4);
	eq('the cost matches the game', sb.M.getSpellCost(spell), want);

	sb.M.magic = 0;
	var p1 = sb.M.magicM;
	sb.M.logic();
	ok('magic regenerates', sb.M.magic > 0);
	ok('and the maximum did not move', sb.M.magicM === p1);
})();

/* ------------------------------------------------------------------ *
 * 6. The panel
 * ------------------------------------------------------------------ */
console.log('\nthe panel');
(function () {
	var errors = [];
	var realError = console.error;
	console.error = function () { errors.push(Array.prototype.join.call(arguments, ' ')); };
	var sb, panel;
	try {
		sb = fresh({seed: 'abcde', towers: 150, level: 5});
		sb.frame();
		panel = sb.dom.findCreated('grandmasGrimoirePanel');
	} finally {
		console.error = realError;
	}

	ok('the panel is built', !!panel);
	eq('nothing was logged as an error', errors.join(' | '), '');

	// The rows live in the panel markup now, because they are built once and
	// only their cells are updated afterwards.
	var table = panel.innerHTML;
	eq('one row per spell, plus a header', table.split('<tr').length - 1, 10);
	ok('the header labels the columns', /gmgHead/.test(table) && /This cast/.test(table));

	// Hover help: every column header and every spell row explains itself, and
	// the spell rows borrow the game's own wording.
	ok('column headers carry hover text', (table.match(/<td title="/g) || []).length >= 4);
	ok('each spell row explains itself on hover',
		(table.match(/<tr id="gmgR-\d+" title="/g) || []).length === 9);
	ok('and that text comes from the game',
		table.indexOf('Summon a random golden cookie') >= 0, 'row tooltips missing the game text');
	ok('the backfire is spelled out too', /Backfire: /.test(table));
	ok('destructive spells warn on their arm button', /Careful - this one can destroy/.test(table));

	var head = panel.innerHTML;
	ok('the magic meter has hover text', /id="gmgMagic" title="/.test(head), 'no tip on gmgMagic');
	ok('the roll line has hover text', /id="gmgRoll" title="/.test(head), 'no tip on gmgRoll');
	ok('the auto-cast button has hover text', /data-act="auto" id="gmgAutoBtn" title="/.test(head));
	// The outcome is written into its own cell each refresh, not into the row
	// markup, so it has to be read from there.
	var outs = '';
	for (var oi = 0; oi < 9; oi++) outs += sb.dom.get('gmgR-' + oi + '-out').innerHTML;
	ok('outcomes are spelled out', /WIN|BACKFIRE|always works/.test(outs), outs.slice(0, 200));
	ok('costs are shown', /gmgNum/.test(table) &&
		sb.dom.get('gmgR-0-cost').textContent.length > 0);
	ok('every spell has an arm button', table.split('data-act="arm"').length - 1 === 9);
	ok('the magic meter is filled in', /Magic \d+ \/ \d+/.test(sb.dom.get('gmgMagic').textContent),
		sb.dom.get('gmgMagic').textContent);
	ok('the shared-roll warning is there', /already decided/.test(sb.dom.get('gmgRoll').textContent),
		sb.dom.get('gmgRoll').textContent);
	ok('destructive spells are flagged',
		panel.innerHTML.indexOf('destroy one of your buildings') >= 0 ||
		table.indexOf('destroy one of your buildings') >= 0 ||
		/Careful/.test(table));
})();

(function () {
	// The auto-cast settings only render once it is armed; they need help text
	// too, because they are the ones with non-obvious consequences.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.mod.setArmed(true);
	sb.frame();
	var panel = sb.dom.findCreated('grandmasGrimoirePanel').innerHTML;
	['onlyWins', 'fateFilter', 'burnBadRolls', 'reserve'].forEach(function (k) {
		var re = new RegExp('title="[^"]+"[^>]*>\s*<input[^>]*data-key="' + k + '"');
		var alt = new RegExp('<div class="gmgSet" title="[^"]+"><input[^>]*id="gmgSet-' + k + '"');
		var altLabel = new RegExp('<div class="gmgSet" title="[^"]+"><label for="gmgSet-' + k + '"');
		ok('the ' + k + ' setting has hover text',
			re.test(panel) || alt.test(panel) || altLabel.test(panel));
	});
})();

/* ------------------------------------------------------------------ *
 * 5d. Choosing for cookies
 * ------------------------------------------------------------------ */
console.log('\nprofit planning');
(function () {
	// Conjure Baked Goods pays min(bank * 15%, 30 minutes of production). With
	// a small bank that is far below the cap, and waiting for the bank to grow
	// costs nothing - so it must not be cast yet.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.Game.cookiesPs = 1e9;
	sb.Game.cookies = 1e9 * 60;              // one minute banked: nowhere near
	sb.M.magic = sb.M.magicM;
	sb.mod.setStrategy('profit');
	sb.mod.setArmed(true);
	sb.mod.invalidate();

	var v = sb.mod.spellValue('conjure baked goods');
	ok('Conjure is priced from the game formula', !!v && v.exact === true,
		JSON.stringify(v));
	ok('and it knows the bank is what limits it', /bank/.test(v.note), v.note);

	var pick = sb.mod.chooseAutoCast();
	ok('with a small bank it refuses to cast Conjure',
		!pick.spell || pick.key !== 'conjure baked goods',
		JSON.stringify(pick.reason || pick.key));

	// Fill the bank past the cap and it becomes worth casting.
	sb.Game.cookies = 1e9 * 60 * 60 * 10;    // ten hours banked
	sb.mod.invalidate();
	var v2 = sb.mod.spellValue('conjure baked goods');
	ok('a full bank pays the capped amount', v2.cookies >= 1e9 * 60 * 30 * 0.999,
		String(v2.cookies));
	ok('and the reason changes to production', /production/.test(v2.note), v2.note);
})();

(function () {
	// A Lucky pays a share of your bank, so it is worth vastly more when the
	// bank is big - the planner has to price that, not just name the outcome.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.Game.cookiesPs = 1e9;

	sb.Game.cookies = 1e6;
	sb.mod.invalidate();
	var poor = sb.mod.spellValue('hand of fate');

	sb.Game.cookies = 1e9 * 60 * 60 * 10;
	sb.mod.invalidate();
	var rich = sb.mod.spellValue('hand of fate');

	if (poor && rich && /Lucky/.test(poor.note || '')) {
		ok('a Lucky is worth more with a bigger bank', rich.cookies > poor.cookies * 10,
			poor.cookies + ' -> ' + rich.cookies);
	} else {
		ok('the roll priced was not a Lucky, so the bank test is skipped', true);
	}
})();

(function () {
	// The rolls ahead are readable, which is the whole basis for waiting.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	var ahead = sb.mod.lookahead(20);
	eq('it can read twenty rolls ahead', ahead.length, 20);
	eq('starting with the one about to happen', ahead[0].at, 0);
	var kinds = {};
	ahead.forEach(function (a) { kinds[a.fate] = 1; });
	ok('and they are not all the same outcome (' + Object.keys(kinds).length + ' kinds)',
		Object.keys(kinds).length > 1);

	// The first entry must agree with what the live prediction says.
	sb.mod.invalidate();
	var now = sb.mod.getPredictions()['hand of fate'];
	eq('the first lookahead entry matches the live roll', ahead[0].fate, now.fate);
	eq('and agrees on win or backfire', ahead[0].wins, now.wins);
})();

(function () {
	// Profit mode must never spend magic on an outcome worth nothing.
	var sb = fresh({seed: 'q7f2k', towers: 150, level: 5});
	sb.Game.cookiesPs = 1e9;
	sb.Game.cookies = 1e9 * 60 * 60 * 10;
	sb.mod.setStrategy('profit');
	sb.mod.setArmed(true);

	var duds = 0, casts = 0;
	for (var i = 0; i < 250; i++) {
		sb.M.magic = sb.M.magicM;
		sb.mod.invalidate();
		var p = sb.mod.getPredictions()['hand of fate'];
		var before = sb.M.spellsCastTotal;
		sb.lastShimmer = null;
		sb.Game.T += 30;
		sb.frame();
		if (sb.M.spellsCastTotal > before) {
			casts++;
			// Only a Force the Hand of Fate produces a golden cookie, so that is
			// what says whether this cast was the one the outcome belongs to -
			// any other spell would be wrongly blamed for the roll.
			if (sb.lastShimmer && (p.fate === 'blab' || p.fate === 'cookie storm drop')) duds++;
		}
	}
	ok('it cast something (' + casts + ')', casts > 0);
	eq('and never on a worthless outcome', duds, 0);
})();

(function () {
	// Nothing is armed by hand, yet profit mode still works - that is the
	// difference between the two strategies.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.Game.cookiesPs = 1e9;
	sb.Game.cookies = 1e9 * 60 * 60 * 10;
	sb.M.magic = sb.M.magicM;
	sb.mod.setArmed(true);
	sb.mod.setStrategy('manual');
	sb.mod.invalidate();
	var manual = sb.mod.chooseAutoCast();
	ok('manual mode casts nothing with nothing armed',
		!manual.spell && /nothing armed/.test(manual.reason), JSON.stringify(manual.reason));

	sb.mod.setStrategy('profit');
	sb.mod.invalidate();
	var profit = sb.mod.chooseAutoCast();
	ok('profit mode decides for itself',
		!!profit.spell || profit.hold === true,
		JSON.stringify(profit.reason));
})();

/* ------------------------------------------------------------------ *
 * 6b. The buttons must survive a redraw
 * ------------------------------------------------------------------ */
console.log('\nbuttons stay clickable');
(function () {
	// The panel redraws every frame. If a redraw rewrites the table, every
	// button is destroyed and recreated thirty times a second, and a click
	// whose press and release straddle a rebuild never lands - which is exactly
	// what made the "auto" toggles unusable.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.frame();

	var panel = sb.dom.findCreated('grandmasGrimoirePanel');
	ok('the rows are built once, with the panel',
		panel.innerHTML.indexOf('id="gmgR-0-arm"') >= 0, 'rows are not in the panel markup');
	ok('every spell has a stable arm button id',
		(panel.innerHTML.match(/id="gmgR-\d+-arm"/g) || []).length === 9);

	// Drive a couple of hundred frames while magic moves, which is what makes
	// the cost and the countdown change.
	for (var i = 0; i < 200; i++) {
		sb.M.magic = (i % 60);
		sb.M.logic();
		sb.frame();
	}
	eq('a redraw never rewrites the table wholesale',
		sb.dom.get('gmgTable').innerHTML, '');
	ok('but the cells themselves are kept current',
		sb.dom.get('gmgR-0-cost').textContent.length > 0,
		'cost cell is empty');

	// Arming shows on the button without the button being replaced.
	sb.mod.setAuto('conjure baked goods', true);
	sb.frame();
	var id = sb.M.spells['conjure baked goods'].id;
	ok('arming marks the button',
		/gmgOn/.test(sb.dom.get('gmgR-' + id + '-arm').className),
		sb.dom.get('gmgR-' + id + '-arm').className);
	sb.mod.setAuto('conjure baked goods', false);
	sb.frame();
	ok('and disarming clears it',
		!/gmgOn/.test(sb.dom.get('gmgR-' + id + '-arm').className));
})();

/* ------------------------------------------------------------------ *
 * 7. Persistence
 * ------------------------------------------------------------------ */
console.log('\npersistence');
(function () {
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	sb.mod.setAuto('conjure baked goods', true);
	sb.mod.getSettings().reserve = 0.25;
	sb.mod.getSettings().fateFilter = false;
	var str = sb.mod.save();
	ok('save produced a string', typeof str === 'string' && str.length > 0);

	var sb2 = fresh({seed: 'abcde', towers: 150, level: 5});
	sb2.mod.load(str);
	eq('an armed spell survived', sb2.mod.getSettings().autoSpells['conjure baked goods'], true);
	eq('the reserve survived', sb2.mod.getSettings().reserve, 0.25);
	eq('a toggle survived', sb2.mod.getSettings().fateFilter, false);

	var sb3 = fresh({seed: 'abcde', towers: 150, level: 5});
	var threw = false;
	try { sb3.mod.load('not json'); } catch (e) { threw = true; }
	ok('a corrupt save does not throw', !threw);
	eq('and the defaults hold', sb3.mod.getSettings().autoArmed, false);
})();

/* ------------------------------------------------------------------ *
 * 8. The prediction cache must notice what moves the fail chance
 * ------------------------------------------------------------------ */
console.log('\ncache invalidation');
(function () {
	// Fate's fail chance climbs 15% per golden cookie already on screen
	// (minigameGrimoire.js failFunc), so a prediction computed with an empty
	// screen is stale the moment a cookie spawns - the cache key has to carry
	// the count, or the panel shows a WIN that backfires.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	var p1 = sb.mod.getPredictions();
	ok('a second read with nothing changed is the cached object',
		sb.mod.getPredictions() === p1);

	sb.Game.shimmerTypes['golden'].n = 3;
	var p2 = sb.mod.getPredictions();
	ok('a golden cookie on screen recomputes the predictions', p2 !== p1);
	ok('and the fail chance actually moved',
		p2['hand of fate'].failChance > p1['hand of fate'].failChance,
		p1['hand of fate'].failChance + ' -> ' + p2['hand of fate'].failChance);
	sb.Game.shimmerTypes['golden'].n = 0;
})();

/* ------------------------------------------------------------------ *
 * 9. Burning must never cost cookies
 * ------------------------------------------------------------------ */
console.log('\nburn order');
(function () {
	// A burn exists to advance the seed cheaply on a known-bad roll. Conjure
	// Baked Goods backfires into a 15-minute clot plus 15 minutes of CpS lost,
	// so it must never be used as a burn.
	var sb = fresh({seed: 'abcde', towers: 150, level: 5});
	var burn = sb.mod.getBurnOrder();
	ok('burn order is not empty', burn.length > 0);
	eq('conjure baked goods is not a burn spell', burn.indexOf('conjure baked goods'), -1);
	var known = {"haggler's charm": 1, 'summon crafty pixies': 1};
	var allCheap = true;
	for (var i = 0; i < burn.length; i++) {
		if (!known[burn[i]]) allCheap = false;
		if (!sb.M.spells[burn[i]]) allCheap = false;
	}
	ok('every burn spell is real and known-cheap', allCheap, JSON.stringify(burn));
})();

/* ------------------------------------------------------------------ */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
