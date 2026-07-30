/* =============================================================
   battle-engine.js
   Gen 1 Pokémon battle simulation engine.

   Pure JS module — no DOM, no browser dependencies. Runs standalone
   in Node for unit-testing, and gets loaded by battle.html at runtime.

   Consumes data from battle-data.js: MOVES, LEARNSETS, BASE_STATS,
   POKE_TYPES, TYPE_CHART.

   Public API:
     simulateBattle(team1, team2, opts) → { winner, log, teams }
     computeStats(pokemonId, level)      → { hp, atk, def, spc, spd }
     pickMoveAI(...)                     → chosen move slug
     defaultMovesetForPokemon(id, level) → array of up to 4 move slugs

   Team format (input):
     [{ id: 6, level: 45, moves: ['flamethrower', 'slash', ...], nickname?: 'Zard' }, ...]
     Moves are provided in PRIORITY ORDER (top of array = highest priority).

   Battle log format (output):
     Array of structured event objects that the battle overlay can play back
     as animation. Each event has { type, ...payload } for rendering.
   ============================================================= */

'use strict';

// -----------------------------------------------------------------
// Data source — supports both browser (window globals) and Node (require)
// -----------------------------------------------------------------
let _MOVES, _LEARNSETS, _BASE_STATS, _POKE_TYPES, _TYPE_CHART;
if (typeof window !== 'undefined' && window.MOVES) {
  _MOVES = window.MOVES;
  _LEARNSETS = window.LEARNSETS;
  _BASE_STATS = window.BASE_STATS;
  _POKE_TYPES = window.POKE_TYPES;
  _TYPE_CHART = window.TYPE_CHART;
} else if (typeof require !== 'undefined') {
  try {
    const d = require('./battle-data.js');
    _MOVES = d.MOVES;
    _LEARNSETS = d.LEARNSETS;
    _BASE_STATS = d.BASE_STATS;
    _POKE_TYPES = d.POKE_TYPES;
    _TYPE_CHART = d.TYPE_CHART;
  } catch (e) {
    console.warn('[battle-engine] battle-data.js not loaded — call setBattleData() manually');
  }
}
function setBattleData(d) {
  _MOVES = d.MOVES; _LEARNSETS = d.LEARNSETS;
  _BASE_STATS = d.BASE_STATS; _POKE_TYPES = d.POKE_TYPES; _TYPE_CHART = d.TYPE_CHART;
}

// -----------------------------------------------------------------
// Constants — Gen 1 mechanics
// -----------------------------------------------------------------
const IV = 15;                  // max DV in Gen 1 (assume all Pokémon are IV-max for simplicity)
const EV = 0;                   // no effort training in our system
const CRIT_BASE_RATE = 1 / 16;  // base crit probability (adjusted by speed)

// Types that use Special (attack + defense) in Gen 1
const SPECIAL_TYPES = new Set([
  'fire', 'water', 'grass', 'ice', 'electric', 'psychic', 'dragon',
]);

// Status effects (per Gen 1)
const STATUS = {
  NONE: 'none',
  BURN: 'burn',       // -1/16 HP per turn, halves Atk
  POISON: 'poison',   // -1/16 HP per turn
  PARALYSIS: 'paralysis', // 25% skip turn, quarters Speed
  SLEEP: 'sleep',     // skip turn for 1-3 turns
  FREEZE: 'freeze',   // skip turn until hit by fire move (Gen 1 never thaws naturally)
};

// -----------------------------------------------------------------
// Random helper — swappable for deterministic testing
// -----------------------------------------------------------------
let _rand = Math.random;
function setRandom(fn) { _rand = fn; }  // for unit tests
function rand()        { return _rand(); }
function randInt(min, max) { return Math.floor(rand() * (max - min + 1)) + min; }

// -----------------------------------------------------------------
// Stat calculation — Gen 1 formula, IV=15 EV=0
// -----------------------------------------------------------------
function computeStats(pokemonId, level) {
  const base = _BASE_STATS[pokemonId];
  if (!base) throw new Error(`No base stats for Pokémon #${pokemonId}`);
  const nonHP = (baseStat) =>
    Math.floor((((2 * baseStat) + IV + Math.floor(EV / 4)) * level) / 100) + 5;
  const hp =
    Math.floor((((2 * base.hp) + IV + Math.floor(EV / 4)) * level) / 100) + level + 10;
  return {
    hp,
    atk: nonHP(base.atk),
    def: nonHP(base.def),
    spc: nonHP(base.spc),
    spd: nonHP(base.spd),
  };
}

// -----------------------------------------------------------------
// Default moveset — 4 most recent learnable moves, RE-ORDERED so
// damaging moves come first (highest power first), status moves last.
//
// The canonical Gen 1 rule is "last 4 learned", but that produces
// terrible default priorities when several statuses land in the window
// (e.g. Bulbasaur at Lv 20 = [growl, leech-seed, vine-whip, poison-powder]).
// Since viewers can customize movesets and priority later via the UI,
// the default should at least be functional out of the box.
// -----------------------------------------------------------------
function defaultMovesetForPokemon(pokemonId, level) {
  const set = _LEARNSETS[pokemonId] || [];
  const eligible = set.filter(m => m.level <= level);
  const last4 = eligible.slice(-4).map(m => m.move);

  // Sort: damaging moves (by descending power) first, statuses last.
  return last4.sort((a, b) => {
    const ma = _MOVES[a] || {};
    const mb = _MOVES[b] || {};
    const pa = (ma.power || 0);
    const pb = (mb.power || 0);
    if ((pa > 0) !== (pb > 0)) return pb - pa;   // damaging before status
    return pb - pa;                                // within same category, higher power first
  });
}

// -----------------------------------------------------------------
// Type effectiveness
// -----------------------------------------------------------------
function typeEffectiveness(moveType, defenderTypes) {
  let mult = 1;
  for (const dt of defenderTypes) {
    const row = _TYPE_CHART[moveType];
    if (row && typeof row[dt] === 'number') mult *= row[dt];
  }
  return mult;
}

// -----------------------------------------------------------------
// Damage formula — Gen 1 exact
//   damage = floor(((((2*level/5 + 2) * power * A/D) / 50) + 2) * modifier)
//   modifier = STAB * typeEff * crit * randomFactor(217-255)/255
// -----------------------------------------------------------------
function calcDamage(attacker, defender, move, opts = {}) {
  if (!move || (move.power || 0) === 0) return { damage: 0, effectiveness: 1, crit: false };

  // Attack / Defense selection (physical vs special by TYPE per Gen 1)
  const isSpecial = SPECIAL_TYPES.has(move.type);
  let A = isSpecial ? attacker.stats.spc : attacker.stats.atk;
  let D = isSpecial ? defender.stats.spc : defender.stats.def;
  // Burn halves Atk (only for physical)
  if (attacker.status === STATUS.BURN && !isSpecial) A = Math.floor(A / 2);

  // Crit check — Gen 1 speed-based
  const critRate = opts.forceCrit ? 1 :
                   (move.effect && /high critical/i.test(move.effect)) ? Math.min(1, attacker.base.spd / 64)
                   : attacker.base.spd / 512;
  const isCrit = rand() < critRate;

  // Gen 1 crit doubles the effective LEVEL, not just damage — so recompute
  const effectiveLevel = isCrit ? attacker.level * 2 : attacker.level;

  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const eff = typeEffectiveness(move.type, defender.types);
  const randomFactor = randInt(217, 255) / 255;

  const base = Math.floor(
    ((((2 * effectiveLevel) / 5 + 2) * move.power * A) / D) / 50
  ) + 2;

  const damage = Math.floor(base * stab * eff * randomFactor);

  return {
    damage: Math.max(1, damage),  // at least 1 damage on a hit (Gen 1 rule)
    effectiveness: eff,
    crit: isCrit,
    stab: stab === 1.5,
  };
}

// -----------------------------------------------------------------
// Accuracy check — Gen 1 has 1/256 miss bug on 100% moves, we skip that
// -----------------------------------------------------------------
function accuracyCheck(move, attacker, defender) {
  if (!move.accuracy || move.accuracy >= 100) return true;
  return rand() * 100 < move.accuracy;
}

// -----------------------------------------------------------------
// AI move selection — "Reasonable Trainer"
//   Layer 1: follow priority order (top of moveset array)
//   Layer 2: overrides in obvious situations
// -----------------------------------------------------------------
function pickMoveAI(attacker, defender) {
  // Filter to moves with PP remaining
  const available = attacker.moveset.filter(m => m.pp > 0);
  if (available.length === 0) return null;  // Struggle in canon; caller handles

  // Override 1: is a KO available? If a damaging move would drop opponent, use it
  let koMove = null;
  for (const m of available) {
    if ((m.power || 0) === 0) continue;
    const preview = calcDamage(attacker, defender, m, { forceCrit: false });
    // Estimate: if avg-random damage would KO, use this move
    // Use expected damage: preview.damage is already after random roll, but averaged
    // damage is roughly the same magnitude — good enough for KO detection
    if (preview.damage >= defender.currentHP) { koMove = m; break; }
  }
  if (koMove) return koMove;

  // Override 2: strongly prefer damaging moves over status moves.
  // Status moves are only picked when no damaging moves have PP left.
  // (Previously the AI blindly returned pool[0], which meant Bulbasaur
  // with default moveset [growl, leech-seed, vine-whip, poison-powder]
  // would spam Growl forever — obviously wrong.)
  //
  // Within damaging moves, still respect viewer priority (array order).
  const damaging = available.filter(m => (m.power || 0) > 0);
  if (damaging.length > 0) return damaging[0];

  // No damaging moves left — fall back to status. Skip status-inflicters
  // if opponent already has a status (wasted).
  const usefulStatus = available.filter(m => {
    if (m.category === 'status' && defender.status !== STATUS.NONE) {
      // Any status-inflicting move on a statused foe is wasted
      return false;
    }
    return true;
  });
  return (usefulStatus.length > 0 ? usefulStatus : available)[0];
}

// -----------------------------------------------------------------
// AI action selection — move OR switch
// Returns { type: 'move', move } | { type: 'switch', to: teamIdx }
//
// Switch triggers when:
//   - Current attacker has NO damaging move that hits opponent for >= 1x
//   - AND a teammate has a damaging move that hits for >= 2x
//   - AND current Pokémon still has meaningful HP (>15% — don't waste
//     a switch if we're about to die anyway, might as well swing)
// This mirrors typical Pokémon switch heuristics — "you're walled here,
// something else on the team has coverage, swap in that."
// -----------------------------------------------------------------
function pickAction(attacker, defender, team, activeIdx, currentTurn) {
  // Anti-loop: a Pokémon that switched in last turn can't switch out
  // again this turn — must commit to at least one action. Without this,
  // mutual prediction-swaps lock the battle in an infinite switch dance.
  if (attacker.switchInTurn != null && currentTurn - attacker.switchInTurn <= 1) {
    return { type: 'move', move: pickMoveAI(attacker, defender) };
  }

  // Best expected effectiveness from current attacker's damaging moves
  const currentBestEff = attacker.moveset
    .filter(m => m.pp > 0 && (m.power || 0) > 0)
    .map(m => typeEffectiveness(m.type, defender.types))
    .reduce((a, b) => Math.max(a, b), 0);

  // Best switch target — teammate whose best move most effectively hits opponent
  let bestSwitchIdx = -1;
  let bestSwitchEff = 0;
  for (let i = 0; i < team.length; i++) {
    if (i === activeIdx) continue;
    const teammate = team[i];
    if (teammate.currentHP <= 0) continue;
    const eff = teammate.moveset
      .filter(m => m.pp > 0 && (m.power || 0) > 0)
      .map(m => typeEffectiveness(m.type, defender.types))
      .reduce((a, b) => Math.max(a, b), 0);
    if (eff > bestSwitchEff) {
      bestSwitchEff = eff;
      bestSwitchIdx = i;
    }
  }

  // Compute defensive matchup — how much does opponent hit US for vs teammate?
  const opponentBestEffVsCurrent = defender.moveset
    .filter(m => m.pp > 0 && (m.power || 0) > 0)
    .map(m => typeEffectiveness(m.type, attacker.types))
    .reduce((a, b) => Math.max(a, b), 1);   // default 1 (neutral) if nothing damaging
  const opponentBestEffVsSwitchIn = bestSwitchIdx === -1 ? 1 : defender.moveset
    .filter(m => m.pp > 0 && (m.power || 0) > 0)
    .map(m => typeEffectiveness(m.type, team[bestSwitchIdx].types))
    .reduce((a, b) => Math.max(a, b), 1);

  const currentHPRatio = attacker.currentHP / attacker.stats.hp;

  // Combined switch score — bigger = more reason to switch.
  //   Offensive gain: how much MORE super-effective is teammate?
  //   Defensive gain: how much LESS does opponent hit teammate for?
  // Both factored in; either alone can trigger a switch, but the combo is strongest.
  //
  // Rules:
  //   - Never switch if we can KO opponent next turn (handled by pickMoveAI KO override running first — see below)
  //   - Switch if teammate has super-effective move AND we don't  (offensive escape)
  //   - Switch if we're being 2x+ walloped AND teammate resists       (defensive escape)
  //   - Never switch below 15% HP (last stand — swing while we can)
  //   - Never switch away from a fully-healthy Pokémon just because a slightly better teammate exists
  //     (require a real reason: 2x+ effectiveness gain OR 2x+ defensive gain)
  const offensiveGain = bestSwitchEff >= 2 && currentBestEff < 2;
  const defensiveGain = opponentBestEffVsCurrent >= 2 && opponentBestEffVsSwitchIn <= 1;
  // Don't switch if current attacker can KO this turn (pickMoveAI would use that anyway)
  const koAvailable = attacker.moveset
    .filter(m => m.pp > 0 && (m.power || 0) > 0)
    .some(m => calcDamage(attacker, defender, m).damage >= defender.currentHP);

  const shouldSwitch =
    !koAvailable &&
    currentHPRatio > 0.15 &&
    bestSwitchIdx !== -1 &&
    (offensiveGain || defensiveGain);

  if (shouldSwitch) return { type: 'switch', to: bestSwitchIdx };
  return { type: 'move', move: pickMoveAI(attacker, defender) };
}

// -----------------------------------------------------------------
// Status inflict — attempt to apply status from a move
// Returns true if newly applied, false if already had one / immune
// -----------------------------------------------------------------
function tryInflictStatus(target, statusToApply) {
  if (target.status !== STATUS.NONE) return false;  // one status at a time in Gen 1
  // Immunities: Fire types can't be burned, Ice types can't be frozen, etc.
  const t = target.types;
  if (statusToApply === STATUS.BURN && t.includes('fire')) return false;
  if (statusToApply === STATUS.FREEZE && t.includes('ice')) return false;
  if (statusToApply === STATUS.POISON && (t.includes('poison') || t.includes('steel'))) return false;
  if (statusToApply === STATUS.PARALYSIS && t.includes('electric') && statusToApply === STATUS.PARALYSIS) {
    // Note: Gen 1 electric types WERE paralyzable by non-electric moves. But for simplicity we allow it.
  }

  target.status = statusToApply;
  if (statusToApply === STATUS.SLEEP) target.sleepTurns = randInt(1, 3);
  return true;
}

// -----------------------------------------------------------------
// Move effect resolver — pattern-match on effect text to apply
// This is heuristic (based on PokeAPI effect strings) but covers most
// common Gen 1 secondary effects. Complex moves (Bide, Counter,
// Substitute, Metronome, multi-turn) are treated as basic damage for MVP.
// -----------------------------------------------------------------
function resolveMoveEffect(attacker, defender, move, log) {
  const eff = (move.effect || '').toLowerCase();

  // Status inflictions from move name (more reliable than effect text)
  const N = move.name;
  const statusFromName = {
    'thunder-wave': STATUS.PARALYSIS,
    'stun-spore': STATUS.PARALYSIS,
    'poison-powder': STATUS.POISON,
    'poison-gas': STATUS.POISON,
    'toxic': STATUS.POISON,
    'sleep-powder': STATUS.SLEEP,
    'hypnosis': STATUS.SLEEP,
    'sing': STATUS.SLEEP,
    'lovely-kiss': STATUS.SLEEP,
    'spore': STATUS.SLEEP,
    'will-o-wisp': STATUS.BURN,   // not Gen 1 but in the data
    'glare': STATUS.PARALYSIS,
  };
  if (statusFromName[N] && (move.power || 0) === 0) {
    // Pure status move — apply if accuracy check passed (already done)
    if (tryInflictStatus(defender, statusFromName[N])) {
      log.push({ type: 'status', target: defender.slot, status: statusFromName[N], via: N });
    }
    return;
  }

  // Damaging moves with secondary status chance
  const secondary = [
    { moves: ['fire-blast','flamethrower','ember','fire-punch'], status: STATUS.BURN, chance: 0.1 },
    { moves: ['ice-beam','ice-punch','blizzard'], status: STATUS.FREEZE, chance: 0.1 },
    { moves: ['thunderbolt','thunder','thunder-punch','thunder-shock','body-slam'], status: STATUS.PARALYSIS, chance: 0.1 },
    { moves: ['poison-sting','sludge','smog'], status: STATUS.POISON, chance: 0.3 },
    { moves: ['lick'], status: STATUS.PARALYSIS, chance: 0.3 },
  ];
  for (const s of secondary) {
    if (s.moves.includes(N) && rand() < s.chance) {
      if (tryInflictStatus(defender, s.status)) {
        log.push({ type: 'status', target: defender.slot, status: s.status, via: N, secondary: true });
      }
    }
  }
}

// -----------------------------------------------------------------
// Per-turn status damage (poison / burn) — applied at end of turn
// -----------------------------------------------------------------
function applyEndOfTurnStatus(p, log) {
  if (p.currentHP <= 0) return;
  if (p.status === STATUS.POISON || p.status === STATUS.BURN) {
    const dmg = Math.max(1, Math.floor(p.stats.hp / 16));
    p.currentHP = Math.max(0, p.currentHP - dmg);
    log.push({ type: 'status-damage', slot: p.slot, status: p.status, damage: dmg, currentHP: p.currentHP });
  }
}

// -----------------------------------------------------------------
// Check if a Pokémon can act this turn based on status
// Returns { canAct: boolean, reason: string }
// -----------------------------------------------------------------
function canAct(p, log) {
  if (p.status === STATUS.SLEEP) {
    if (p.sleepTurns > 0) {
      p.sleepTurns--;
      log.push({ type: 'sleep', slot: p.slot, turnsRemaining: p.sleepTurns });
      return { canAct: false };
    }
    // Woke up
    p.status = STATUS.NONE;
    log.push({ type: 'wakeup', slot: p.slot });
  }
  if (p.status === STATUS.FREEZE) {
    // In Gen 1, frozen Pokémon never thaw naturally
    log.push({ type: 'frozen', slot: p.slot });
    return { canAct: false };
  }
  if (p.status === STATUS.PARALYSIS && rand() < 0.25) {
    log.push({ type: 'paralyzed', slot: p.slot });
    return { canAct: false };
  }
  return { canAct: true };
}

// -----------------------------------------------------------------
// Battle Pokémon setup — expand team entry into full battle state
// -----------------------------------------------------------------
function buildBattlePokemon(entry, teamIdx, pokemonIdx) {
  const id = entry.id;
  const level = entry.level || 5;
  const stats = computeStats(id, level);
  const types = _POKE_TYPES[id] || ['normal'];
  const baseStats = _BASE_STATS[id];

  // Moveset — use provided moves or fall back to default learnset picks
  const moveSlugs = (entry.moves && entry.moves.length > 0)
    ? entry.moves.slice(0, 4)
    : defaultMovesetForPokemon(id, level);

  const moveset = moveSlugs.map(slug => {
    const m = _MOVES[slug];
    if (!m) {
      // Missing move data — return a placeholder Tackle
      return { name: slug, type: 'normal', power: 40, accuracy: 100, pp: 35, maxPp: 35, category: 'physical', priority: 0, effect: '' };
    }
    return {
      name: m.name,
      type: m.type,
      power: m.power,
      accuracy: m.accuracy,
      pp: m.pp,
      maxPp: m.pp,
      category: m.category,
      priority: m.priority || 0,
      effect: m.effect,
    };
  });

  return {
    slot: `${teamIdx}:${pokemonIdx}`,   // stable identifier for logs
    teamIdx,
    pokemonIdx,
    id,
    name: entry.nickname || `#${id}`,   // caller can pass a nickname
    level,
    types,
    stats,
    base: baseStats,
    currentHP: stats.hp,
    status: STATUS.NONE,
    sleepTurns: 0,
    moveset,
    isShiny: !!entry.isShiny,
  };
}

// -----------------------------------------------------------------
// Battle simulation — top-level
// -----------------------------------------------------------------
function simulateBattle(team1, team2, opts = {}) {
  if (!_MOVES) throw new Error('battle-engine: no battle data loaded. Call setBattleData() or ensure battle-data.js is available.');

  const maxTurns = opts.maxTurns || 200;   // safety cutoff to prevent infinite loops
  const teams = [
    team1.map((e, i) => buildBattlePokemon(e, 0, i)),
    team2.map((e, i) => buildBattlePokemon(e, 1, i)),
  ];
  const active = [0, 0];  // index into each team of the currently-out Pokémon
  const log = [];

  log.push({ type: 'battle-start', team1Size: teams[0].length, team2Size: teams[1].length });
  log.push({ type: 'send-out', teamIdx: 0, slot: teams[0][0].slot, name: teams[0][0].name, isShiny: teams[0][0].isShiny });
  log.push({ type: 'send-out', teamIdx: 1, slot: teams[1][0].slot, name: teams[1][0].name, isShiny: teams[1][0].isShiny });

  let turn = 0;
  while (turn < maxTurns) {
    turn++;
    log.push({ type: 'turn', number: turn });

    const p1 = teams[0][active[0]];
    const p2 = teams[1][active[1]];

    // ---- Action selection — each side picks move OR switch ----
    const action1 = pickAction(p1, p2, teams[0], active[0], turn);
    const action2 = pickAction(p2, p1, teams[1], active[1], turn);

    // ---- Phase 1: resolve switches first (canonical Pokémon rule) ----
    // Switches have highest priority. Both sides switch simultaneously
    // if both chose to. The switched-in Pokémon takes the free hit from
    // any side that chose to attack this turn.
    if (action1.type === 'switch') {
      const inIdx = action1.to;
      log.push({
        type: 'switch-out',
        teamIdx: 0,
        outSlot: teams[0][active[0]].slot,
        inSlot: teams[0][inIdx].slot,
        inName: teams[0][inIdx].name,
        isShiny: teams[0][inIdx].isShiny,
      });
      active[0] = inIdx;
      teams[0][inIdx].switchInTurn = turn;      // can't switch out again next turn
    }
    if (action2.type === 'switch') {
      const inIdx = action2.to;
      log.push({
        type: 'switch-out',
        teamIdx: 1,
        outSlot: teams[1][active[1]].slot,
        inSlot: teams[1][inIdx].slot,
        inName: teams[1][inIdx].name,
        isShiny: teams[1][inIdx].isShiny,
      });
      active[1] = inIdx;
      teams[1][inIdx].switchInTurn = turn;      // can't switch out again next turn
    }

    // Re-reference actives in case of switches
    const attacker1 = teams[0][active[0]];
    const attacker2 = teams[1][active[1]];

    // Skip attack phase entirely if both switched (both used their turn)
    const bothSwitched = action1.type === 'switch' && action2.type === 'switch';
    if (bothSwitched) {
      // End of turn — process status damage below
    }

    // ---- Phase 2: attacks (skipping any side that switched) ----
    const move1 = action1.type === 'move'
      ? (action1.move || { name: 'struggle', type: 'normal', power: 50, accuracy: 100, pp: 1, maxPp: 1, category: 'physical', priority: 0 })
      : null;
    const move2 = action2.type === 'move'
      ? (action2.move || { name: 'struggle', type: 'normal', power: 50, accuracy: 100, pp: 1, maxPp: 1, category: 'physical', priority: 0 })
      : null;
    const m1 = move1;
    const m2 = move2;

    // Turn order: priority, then speed. Paralysis quarters speed for the check.
    // Note: uses the CURRENT actives (post-switch), and only ranks attackers
    // that actually chose a move.
    const speed1 = attacker1.status === STATUS.PARALYSIS ? Math.floor(attacker1.stats.spd / 4) : attacker1.stats.spd;
    const speed2 = attacker2.status === STATUS.PARALYSIS ? Math.floor(attacker2.stats.spd / 4) : attacker2.stats.spd;
    const pri1 = m1 ? m1.priority : -99;   // switches (null move) don't participate in ordering
    const pri2 = m2 ? m2.priority : -99;
    let order;
    if (pri1 !== pri2) {
      order = pri1 > pri2 ? [0, 1] : [1, 0];
    } else if (speed1 !== speed2) {
      order = speed1 > speed2 ? [0, 1] : [1, 0];
    } else {
      order = rand() < 0.5 ? [0, 1] : [1, 0];  // speed tie — random
    }

    for (const idx of order) {
      const attacker = teams[idx][active[idx]];
      const defender = teams[1 - idx][active[1 - idx]];
      const move = idx === 0 ? m1 : m2;
      if (!move) continue;             // this side switched — no attack
      if (attacker.currentHP <= 0 || defender.currentHP <= 0) continue;  // KO'd mid-turn — skip

      // Can the attacker act? (sleep/freeze/paralysis)
      const act = canAct(attacker, log);
      if (!act.canAct) continue;

      // Deduct PP (Struggle doesn't decrement)
      if (move.name !== 'struggle') move.pp = Math.max(0, move.pp - 1);

      log.push({ type: 'move-declare', attacker: attacker.slot, move: move.name });

      // Accuracy check
      if (!accuracyCheck(move, attacker, defender)) {
        log.push({ type: 'miss', attacker: attacker.slot, move: move.name });
        continue;
      }

      // Damage calculation
      const dmg = calcDamage(attacker, defender, move);
      if (dmg.damage > 0) {
        defender.currentHP = Math.max(0, defender.currentHP - dmg.damage);
        log.push({
          type: 'damage',
          attacker: attacker.slot,
          defender: defender.slot,
          move: move.name,
          damage: dmg.damage,
          effectiveness: dmg.effectiveness,
          crit: dmg.crit,
          stab: dmg.stab,
          defenderHP: defender.currentHP,
        });
      }

      // Secondary effects (status procs, etc.)
      resolveMoveEffect(attacker, defender, move, log);

      // KO check
      if (defender.currentHP <= 0) {
        log.push({ type: 'ko', slot: defender.slot });
        // Try to switch in next Pokémon for the KO'd side
        const koTeam = 1 - idx;
        const next = teams[koTeam].findIndex((p, i) => i > active[koTeam] && p.currentHP > 0);
        if (next === -1) {
          // No more Pokémon — this team loses
          log.push({ type: 'team-defeat', teamIdx: koTeam });
          const winner = idx;
          log.push({ type: 'battle-end', winner });
          return { winner, log, teams };
        }
        active[koTeam] = next;
        log.push({ type: 'send-out', teamIdx: koTeam, slot: teams[koTeam][next].slot, name: teams[koTeam][next].name, isShiny: teams[koTeam][next].isShiny });
      }
    }

    // End-of-turn status damage (poison/burn) for both actives
    applyEndOfTurnStatus(teams[0][active[0]], log);
    applyEndOfTurnStatus(teams[1][active[1]], log);

    // Recheck KOs from status damage
    for (const idx of [0, 1]) {
      const p = teams[idx][active[idx]];
      if (p.currentHP <= 0) {
        log.push({ type: 'ko', slot: p.slot });
        const next = teams[idx].findIndex((tp, i) => i > active[idx] && tp.currentHP > 0);
        if (next === -1) {
          log.push({ type: 'team-defeat', teamIdx: idx });
          const winner = 1 - idx;
          log.push({ type: 'battle-end', winner });
          return { winner, log, teams };
        }
        active[idx] = next;
        log.push({ type: 'send-out', teamIdx: idx, slot: teams[idx][next].slot, name: teams[idx][next].name, isShiny: teams[idx][next].isShiny });
      }
    }
  }

  // Turn cap hit — treat as draw
  log.push({ type: 'battle-end', winner: -1, reason: 'turn-cap' });
  return { winner: -1, log, teams };
}

// -----------------------------------------------------------------
// Exports (browser + node)
// -----------------------------------------------------------------
if (typeof window !== 'undefined') {
  window.BattleEngine = {
    simulateBattle,
    computeStats,
    pickMoveAI,
    defaultMovesetForPokemon,
    setBattleData,
    setRandom,
    STATUS,
  };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    simulateBattle,
    computeStats,
    pickMoveAI,
    defaultMovesetForPokemon,
    setBattleData,
    setRandom,
    STATUS,
  };
}
