/**
 * Loads the game's real minigameGrimoire.js into a sandbox.
 *
 * The important detail: Math.seedrandom is not reimplemented here. The exact
 * minified library the game ships is lifted out of main.js and evaluated in
 * the sandbox, so the seeded number stream is bit-identical to the one a real
 * cast sees. Any prediction that matches here matches in the game.
 *
 * Game.shimmer is the one thing that IS a stand-in, because the real one lives
 * deep inside main.js and is all DOM. It is written to consume exactly the
 * draws the golden shimmer's initFunc consumes - the seasonal sprite draw, then
 * x and y - and nothing else. Everything after it, the whole choice list, is
 * the game's own untouched code from minigameGrimoire.js.
 *
 *   var sb = require('./grimoire.js').boot({seed:'abcd', towers:150, level:5});
 *   sb.M.castSpell(sb.M.spells['hand of fate']);
 *   sb.lastShimmer.force        // what the game actually forced
 */
'use strict';

var fs = require('fs');
var path = require('path');

/*
 * The harness has to work from two places: inside the game tree (where it is
 * reached through a junction as moddev/<Mod>) and inside the git repo (where it
 * sits beside the mod as Code/moddev). The two have different relative layouts,
 * so nothing here assumes one - each path is looked up among the candidates and
 * the first that exists wins.
 */
function firstExisting(candidates, what) {
	for (var i = 0; i < candidates.length; i++) {
		if (fs.existsSync(candidates[i])) return candidates[i];
	}
	throw new Error('cannot find ' + what + ' - looked in:\n  ' + candidates.join('\n  '));
}

var GAME_DIR = 'C:/Program Files (x86)/Steam/steamapps/common/Cookie Clicker/resources/app';

function gameSrc(file) {
	return firstExisting([
		path.join(__dirname, '..', '..', 'src', file),   // moddev/<Mod> in the game tree
		path.join(GAME_DIR, 'src', file)                 // anywhere else
	], 'the game source ' + file);
}

function modMain(name) {
	return firstExisting([
		path.join(__dirname, '..', 'mod', 'main.js'),                        // in the repo
		path.join(__dirname, '..', '..', 'mods', 'local', name, 'main.js'),  // in the game tree
		path.join(GAME_DIR, 'mods', 'local', name, 'main.js')
	], name + '/main.js');
}

var vm = require('vm');
var nodeCrypto = require('crypto');

var SRC     = null;   // resolved per file by gameSrc()
var MOD_SRC = modMain('GrandmasGrimoire');

/** The seedrandom library, exactly as the game ships it (main.js line 702). */
function seedrandomSource() {
	var main = fs.readFileSync(gameSrc('main.js'), 'utf8').split(/\r?\n/);
	for (var i = 0; i < main.length; i++) {
		if (main[i].indexOf('c.seedrandom=function') >= 0) return main[i];
	}
	throw new Error('seedrandom not found in main.js - the game was updated');
}

function makeDOM() {
	var byId = {}, created = [], root = null;
	function el(id) {
		return {
			id: id || '', innerHTML: '', textContent: '', value: '',
			style: {}, className: '', isConnected: true, parentNode: null, nextSibling: null,
			children: [], checked: false,
			classList: {add: function () {}, remove: function () {}, contains: function () { return false; }},
			appendChild: function (c) { this.children.push(c); c.parentNode = this; return c; },
			insertBefore: function (c) { this.children.push(c); c.parentNode = this; return c; },
			removeChild: function (c) { return c; },
			addEventListener: function () {},
			setAttribute: function (k, v) { this[k] = v; },
			getAttribute: function (k) { return typeof this[k] === 'string' ? this[k] : null; },
			closest: function () { return null; },
			// A Cookie Clicker helper the Grimoire calls when a spell lands.
			getBounds: function () { return {left: 0, right: 0, top: 0, bottom: 0}; },
			getBoundingClientRect: function () { return {left: 0, top: 0, width: 0, height: 0}; }
		};
	}
	function get(id) {
		if (!byId[id]) { var e = el(id); e.isConnected = false; e.parentNode = root; byId[id] = e; }
		return byId[id];
	}
	root = el('root');
	return {
		get: get, root: root, created: created,
		doc: {
			getElementById: get,
			createElement: function () { var e = el(''); created.push(e); return e; },
			head: el('head'), body: el('body'), addEventListener: function () {}
		},
		findCreated: function (id) {
			for (var i = created.length - 1; i >= 0; i--) if (created[i].id === id) return created[i];
			return null;
		}
	};
}

function boot(opts) {
	opts = opts || {};
	var dom = makeDOM();
	var out = {lastShimmer: null, buffs: [], popups: []};

	var Game = {
		Objects: {}, ObjectsById: [],
		seed: opts.seed === undefined ? 'aaaaa' : opts.seed,
		season: opts.season || '',
		elderWrath: opts.elderWrath || 0,
		BuildingsOwned: opts.buildings === undefined ? 400 : opts.buildings,
		cookies: 1e15, cookiesPs: 1e9,
		fps: 30, drawT: 0, T: 0, version: 2.053, resPath: '',
		mouseX: 0, mouseY: 0, keys: {}, mods: {}, hooks: {},
		chimeType: 0, ascensionMode: 0, touchEvents: 0,
		shimmers: [], shimmersN: 0, recalculateGains: 0,
		shimmerTypes: {'golden': {n: 0, spawned: 0}},
		bounds: {left: 0, right: 1200, top: 0, bottom: 700},
		buffs: {},
		Has: function () { return false; },
		HasAchiev: function () { return false; },
		hasBuff: function (n) { return opts.buffs && opts.buffs[n] ? {name: n} : 0; },
		gainBuff: function (n, t, m) { out.buffs.push(n); return {name: n, desc: '', icon: [0, 0]}; },
		killBuff: function () {},
		Win: function () {}, Unlock: function () {},
		Notify: function () {}, Popup: function (s) { out.popups.push(s); },
		SparkleAt: function () {},
		Earn: function (n) { Game.cookies += n; },
		Spend: function (n) { Game.cookies -= n; },
		auraMult: function () { return 0; },
		dropRateMult: function () { return 1; },
		sayTime: function () { return ''; },
		getDynamicTooltip: function () { return ''; },
		getTooltip: function () { return ''; },
		SpawnWrinkler: function () { return 1; },
		PopRandomWrinkler: function () { return 1; },
		eff: function () { return 1; },
		registerMod: function (id, mod) { Game.mods[id] = mod; },
		registerHook: function (n, f) { (Game.hooks[n] || (Game.hooks[n] = [])).push(f); }
	};

	// A stand-in that eats exactly the draws the golden shimmer's initFunc eats.
	Game.shimmer = function (type, obj) {
		this.type = type;
		this.forceObj = obj || 0;
		this.force = '';
		this.wrath = 0;
		// The wrath branch short-circuits for both {noWrath:true} and
		// {wrath:true}, so it takes no draw - see the comment at the top.
		if (Game.season === 'valentines' || Game.season === 'easter') Math.random();
		this.x = Math.random();
		this.y = Math.random();
		Game.shimmers.push(this);
		Game.shimmersN++;
		out.lastShimmer = this;
	};

	var towers = opts.towers === undefined ? 150 : opts.towers;
	var buildings = {
		'Wizard tower': {
			id: 7, name: 'Wizard tower', single: 'Wizard tower', plural: 'Wizard towers',
			amount: towers, level: opts.level === undefined ? 5 : opts.level,
			minigameName: 'Grimoire', minigameLoaded: false,
			getPrice: function () { return 1e6; },
			buyFree: function () {}, sacrifice: function () {}
		}
	};
	Game.Objects = new Proxy(buildings, {
		get: function (t, k) {
			if (typeof k !== 'string') return t[k];
			if (!t[k]) t[k] = {id: 0, name: k, single: k, plural: k, amount: 0, level: 1,
				getPrice: function () { return 1e6; }, buyFree: function () {}, sacrifice: function () {}};
			return t[k];
		},
		has: function () { return true; }
	});
	Game.ObjectsById[7] = Game.Objects['Wizard tower'];

	var ctx = {
		Game: Game, Math: Math, document: dom.doc, window: {}, console: console,
		Date: Date, JSON: JSON, Array: Array, Object: Object, String: String,
		Number: Number, Boolean: Boolean, isFinite: isFinite, parseFloat: parseFloat,
		parseInt: parseInt, setTimeout: function () {}, clearTimeout: function () {},
		// seedrandom's auto-seed path reaches for browser entropy and falls back
		// to navigator/screen; give it both so a bare Math.seedrandom() works.
		navigator: {plugins: []},
		screen: {},
		crypto: {getRandomValues: function (arr) { nodeCrypto.randomFillSync(arr); return arr; }},
		EN: 1, l: dom.get,
		loc: function (s) { return String(s); },
		cap: function (s) { return String(s); },
		FindLocStringByPart: function (s) { return String(s); },
		AddEvent: function () {}, PlaySound: function () {},
		Beautify: function (n) { return String(Math.round(n)); },
		LBeautify: function (n) { return String(Math.round(n)); },
		choose: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; }
	};
	ctx.globalThis = ctx;
	vm.createContext(ctx);

	// The real library, so the seeded stream matches the game exactly.
	vm.runInContext(seedrandomSource(), ctx, {filename: 'seedrandom.js'});

	var src = fs.readFileSync(gameSrc('minigameGrimoire.js'), 'utf8').replace(/^﻿/, '');
	vm.runInContext(src, ctx, {filename: 'minigameGrimoire.js'});

	var M = Game.Objects['Wizard tower'].minigame;
	M.launch();
	Game.Objects['Wizard tower'].minigameLoaded = true;

	out.Game = Game;
	out.M = M;
	out.ctx = ctx;
	out.dom = dom;
	out.loadMod = function () {
		vm.runInContext(fs.readFileSync(MOD_SRC, 'utf8'), ctx, {filename: 'GrandmasGrimoire/main.js'});
		var mod = Game.mods['grandmas grimoire'];
		mod.init();
		return mod;
	};
	// One logic frame, clock included - the game advances Game.T every frame and
	// anything that paces itself off that clock needs it to move here too.
	out.frame = function () {
		Game.T++;
		var hooks = Game.hooks['logic'] || [];
		for (var i = 0; i < hooks.length; i++) hooks[i]();
	};
	out.frames = function (n) { for (var i = 0; i < n; i++) out.frame(); };
	return out;
}

module.exports = {boot: boot};
