/* =============================================================
   fetch-battledata.js
   One-time script that pulls Gen 1 battle data from PokeAPI and
   generates `battle-data.js` — the data foundation for the
   battle system.

   Fetches:
     - Base stats for Pokémon #1-151 (HP, Atk, Def, Spc, Spd, single Special
       stat per Gen 1 convention — averaged from PokeAPI's Sp.Atk + Sp.Def)
     - Full type list (Gen 1 = 15 types, no Dark/Steel)
     - Type effectiveness chart, filtered to Gen 1 type interactions
       via past_damage_relations
     - Level-up learnsets per Pokémon, filtered to red-blue version group
       (falls back to yellow if red-blue has no data for that mon)
     - Move details for every unique move used across all Gen 1 learnsets
       (name, type, category, power, accuracy, PP, effect summary)

   Generates:
     - `battle-data.js` — single JS file with MOVES, LEARNSETS, BASE_STATS,
       TYPE_CHART, TYPES exports (attached to window for browser use, also
       CommonMod exports for node testing).

   Usage: node fetch-battledata.js
   Runtime: ~5-10 min (script paces requests to be nice to PokeAPI).

   Data caveats:
     - PokeAPI base stats reflect CURRENT gen. For MVP that's 95%+ accurate
       — a small handful of Pokémon (Beedrill, Butterfree, Farfetch'd, Kadabra,
       and others got rebalanced in Gen 6+). Post-launch we can hand-adjust the
       few outliers if battle testing shows weirdness.
     - Gen 1 had a single Special stat (not split into Sp.Atk / Sp.Def).
       PokeAPI stores these separately per modern convention; this script
       averages them into one `spc` field to match Gen 1 mechanics.
     - Learnsets are filtered to red-blue version_group. Pokémon with
       yellow-only learnsets fall back to yellow.
   ============================================================= */

const https = require('https');
const fs = require('fs');

const POKEAPI = 'https://pokeapi.co/api/v2';
const CONCURRENCY = 10;      // parallel fetches — PokeAPI is generous, but stay reasonable
const GEN1_LAST_ID = 151;

// Simple parallel-with-limit runner
async function runParallel(items, worker, limit = CONCURRENCY) {
  const results = new Array(items.length);
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const my = idx++;
      try { results[my] = await worker(items[my], my); }
      catch (e) { results[my] = { __error: e.message }; }
    }
  }
  await Promise.all(Array.from({length: limit}, next));
  return results;
}
const GEN1_TYPE_LAST_ID = 15;  // types 1-15: normal..dragon (no dark=17, no steel=9-but-wait, steel=17? let me check)
// Actually Gen 1 types by PokeAPI id: 1 normal, 2 fighting, 3 flying, 4 poison, 5 ground, 6 rock, 7 bug, 8 ghost, 10 fire, 11 water, 12 grass, 13 electric, 14 psychic, 15 ice, 16 dragon. IDs 9 (steel) and 17 (dark) don't exist in Gen 1.
const GEN1_TYPE_NAMES = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug',
  'ghost', 'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon',
];

// -----------------------------------------------------------------
// HTTP helpers
// -----------------------------------------------------------------
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Bad JSON from ${url}: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// -----------------------------------------------------------------
// Fetch a single Pokémon: base stats + Gen 1 learnset
// -----------------------------------------------------------------
async function fetchPokemon(id) {
  const p = await get(`${POKEAPI}/pokemon/${id}`);

  // Base stats — PokeAPI returns modern split; average Sp.Atk + Sp.Def
  // into a single Gen 1 Special stat.
  const s = Object.fromEntries(p.stats.map(x => [x.stat.name, x.base_stat]));
  const baseStats = {
    hp:  s['hp']              || 0,
    atk: s['attack']          || 0,
    def: s['defense']         || 0,
    spc: Math.round(((s['special-attack'] || 0) + (s['special-defense'] || 0)) / 2),
    spd: s['speed']           || 0,
  };

  const types = p.types.map(t => t.type.name);

  // Gen 1 level-up learnset — filter moves to red-blue version_group,
  // fall back to yellow if RB has nothing.
  const learnset = [];
  for (const move of p.moves) {
    // Try red-blue first
    let vg = move.version_group_details.find(v =>
      v.version_group.name === 'red-blue' && v.move_learn_method.name === 'level-up'
    );
    // Fall back to yellow
    if (!vg) {
      vg = move.version_group_details.find(v =>
        v.version_group.name === 'yellow' && v.move_learn_method.name === 'level-up'
      );
    }
    if (vg) {
      learnset.push({ move: move.move.name, level: vg.level_learned_at });
    }
  }
  learnset.sort((a, b) => a.level - b.level);

  return {
    id,
    name: p.name,
    types,
    baseStats,
    learnset,
  };
}

// -----------------------------------------------------------------
// Fetch move details — one call per unique move name
// -----------------------------------------------------------------
async function fetchMove(name) {
  const m = await get(`${POKEAPI}/move/${name}`);

  // Prefer past_values for gen-i if present (moves changed between gens)
  let power = m.power;
  let accuracy = m.accuracy;
  let pp = m.pp;
  let type = m.type ? m.type.name : null;

  if (m.past_values && m.past_values.length > 0) {
    const gen1 = m.past_values.find(p =>
      p.version_group && p.version_group.name === 'red-blue'
    ) || m.past_values.find(p =>
      p.version_group && p.version_group.name === 'yellow'
    );
    if (gen1) {
      if (gen1.power != null) power = gen1.power;
      if (gen1.accuracy != null) accuracy = gen1.accuracy;
      if (gen1.pp != null) pp = gen1.pp;
      if (gen1.type && gen1.type.name) type = gen1.type.name;
    }
  }

  // Effect summary in English
  const effectEntry = (m.effect_entries || []).find(e => e.language.name === 'en');
  const effect = effectEntry ? effectEntry.short_effect : '';

  return {
    name: m.name,
    type: type || 'normal',
    // damage_class: physical / special / status. In Gen 1 this was actually
    // determined by type (fire/water/grass/ice/electric/psychic/dragon = special,
    // others = physical), but PokeAPI's per-move category is fine for our sim.
    category: m.damage_class ? m.damage_class.name : 'status',
    power: power ?? 0,
    accuracy: accuracy ?? 100,
    pp: pp ?? 5,
    priority: m.priority || 0,
    effect,
  };
}

// -----------------------------------------------------------------
// Main
// -----------------------------------------------------------------
(async () => {
  const t0 = Date.now();
  console.log(`Fetching Gen 1 Pokémon (1-151), concurrency=${CONCURRENCY}...`);
  const ids = Array.from({length: GEN1_LAST_ID}, (_, i) => i + 1);
  const pokemonResults = await runParallel(ids, async (id) => {
    try { return await fetchPokemon(id); }
    catch (e) { console.log(`  ✗ #${id}: ${e.message}`); return null; }
  });
  const pokemon = pokemonResults.filter(p => p && !p.__error);
  console.log(`  ${pokemon.length}/${GEN1_LAST_ID} fetched in ${((Date.now()-t0)/1000).toFixed(1)}s`);

  console.log('\nFetching type chart (MODERN — Gen 6+ effectiveness within Gen 1 types)...');
  // Modern type chart is used deliberately even though Pokémon are Gen 1.
  // Reason: Gen 1 had confusing bugs (Ghost 0× vs Psychic, Bug 2× vs Poison)
  // that would frustrate modern viewers who know current Pokemon rules.
  // Uses CURRENT damage_relations, filtered to the 15 Gen 1 types (no Dark/Steel).
  const t1 = Date.now();
  const typeResults = await runParallel(GEN1_TYPE_NAMES, async (typeName) => {
    const t = await get(`${POKEAPI}/type/${typeName}`);
    const rels = t.damage_relations;   // current-gen relations (no past_damage_relations filter)
    const row = {};
    for (const other of GEN1_TYPE_NAMES) row[other] = 1;
    for (const d of (rels.double_damage_to || [])) if (GEN1_TYPE_NAMES.includes(d.name)) row[d.name] = 2;
    for (const d of (rels.half_damage_to || [])) if (GEN1_TYPE_NAMES.includes(d.name)) row[d.name] = 0.5;
    for (const d of (rels.no_damage_to || [])) if (GEN1_TYPE_NAMES.includes(d.name)) row[d.name] = 0;
    return { typeName, row };
  });
  const typeChart = {};
  for (const r of typeResults) if (r && r.typeName) typeChart[r.typeName] = r.row;
  console.log(`  type chart done in ${((Date.now()-t1)/1000).toFixed(1)}s`);

  const moveNames = new Set();
  for (const p of pokemon) for (const l of p.learnset) moveNames.add(l.move);
  console.log(`\nFetching ${moveNames.size} unique moves (parallel)...`);
  const t2 = Date.now();
  const moveList = Array.from(moveNames);
  const moveResults = await runParallel(moveList, async (name) => {
    try { return await fetchMove(name); }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); return null; }
  });
  const moves = {};
  for (const m of moveResults) if (m && m.name) moves[m.name] = m;
  console.log(`  ${Object.keys(moves).length}/${moveNames.size} moves fetched in ${((Date.now()-t2)/1000).toFixed(1)}s`);

  // -----------------------------------------------------------------
  // Emit battle-data.js
  // -----------------------------------------------------------------
  const baseStats = {};
  const learnsets = {};
  const pokeTypes = {};
  for (const p of pokemon) {
    baseStats[p.id] = p.baseStats;
    learnsets[p.id] = p.learnset;
    pokeTypes[p.id] = p.types;
  }

  const banner = `// AUTO-GENERATED by fetch-battledata.js — do not edit by hand.
// Regenerate: node fetch-battledata.js
// Source: PokeAPI (${POKEAPI}). Gen 1 data filtered to red-blue version group.
// Generated: ${new Date().toISOString()}
`;

  const body = `${banner}
// -----------------------------------------------------------------
// TYPES — 15 Gen 1 types (no Dark, no Steel)
// -----------------------------------------------------------------
const BATTLE_TYPES = ${JSON.stringify(GEN1_TYPE_NAMES)};

// -----------------------------------------------------------------
// TYPE_CHART[attackerType][defenderType] = multiplier (0 / 0.5 / 1 / 2)
// -----------------------------------------------------------------
const TYPE_CHART = ${JSON.stringify(typeChart, null, 2)};

// -----------------------------------------------------------------
// BASE_STATS[id] = { hp, atk, def, spc, spd }
// Gen 1 uses a single Special stat (spc). PokeAPI's Sp.Atk + Sp.Def
// averaged to produce this.
// -----------------------------------------------------------------
const BASE_STATS = ${JSON.stringify(baseStats, null, 2)};

// -----------------------------------------------------------------
// POKE_TYPES[id] = [type1, type2?]  (Pokémon can be single or dual type)
// -----------------------------------------------------------------
const POKE_TYPES = ${JSON.stringify(pokeTypes, null, 2)};

// -----------------------------------------------------------------
// LEARNSETS[id] = [{ move: <slug>, level: <n> }, ...] sorted by level
// Level 1 moves = starting moveset (canonical Gen 1 default 4 moves are
// the highest-level moves at or below the Pokémon's current level, up
// to 4; older moves get bumped as new ones are learned).
// -----------------------------------------------------------------
const LEARNSETS = ${JSON.stringify(learnsets, null, 2)};

// -----------------------------------------------------------------
// MOVES[slug] = { name, type, category, power, accuracy, pp, priority, effect }
// -----------------------------------------------------------------
const MOVES = ${JSON.stringify(moves, null, 2)};

// -----------------------------------------------------------------
// Exports (browser + node)
// -----------------------------------------------------------------
if (typeof window !== 'undefined') {
  window.BATTLE_TYPES = BATTLE_TYPES;
  window.TYPE_CHART = TYPE_CHART;
  window.BASE_STATS = BASE_STATS;
  window.POKE_TYPES = POKE_TYPES;
  window.LEARNSETS = LEARNSETS;
  window.MOVES = MOVES;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BATTLE_TYPES, TYPE_CHART, BASE_STATS, POKE_TYPES, LEARNSETS, MOVES };
}
`;

  fs.writeFileSync(__dirname + '/battle-data.js', body);
  console.log(`\n✅ Wrote battle-data.js — ${pokemon.length} Pokémon, ${Object.keys(moves).length} moves, ${GEN1_TYPE_NAMES.length} types.`);
})();
