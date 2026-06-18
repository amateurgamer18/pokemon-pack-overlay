# Pokémon Pack Stream — Roadmap & Ideas

A running list of stream gimmicks and features. Anything checked is shipped.

## ✅ SHIPPED features

- [x] **Pack opening overlay** — regular / shiny / legendary / shiny-legendary tiers, procedural sounds + recorded legendary fanfare, 2-gifts-per-pack economy with carry-over credits, no-duplicates, 10s animation
- [x] **Pokédex page** — collection grid, type breakdown, recent pulls strip, achievements, top-10 leaderboard, hall of fame for completers, evolution chain in modal, streak counter, A/B testable sidebar layout
- [x] **Trainer level system** — XP per pull, level + title shown on dex, retroactive across all pulls
- [x] **Dual-dex (2026-05-13)** — each Pokémon has standard + shiny slots, 302 total / 151 unique prize, variant tabs on dex, XP stacks per variant, "Shiny Dex Complete" + "Living Pokédex" achievements
- [x] **Case-insensitive usernames** — lowercase Firebase keys, original casing preserved as `_meta.displayName`
- [x] **`!dex` command** (Botrix) — viewers get a direct link to their pokédex page
- [x] **`!givepack <user> [count]`** (broadcaster-only) — banks packs for any viewer
- [x] **`!redeempack`** — viewer opens one of their banked packs live on stream
- [x] **`!packs`** — viewer checks their banked count
- [x] **`!rank [@user]`** — full stat line: rank, level, title, count, shinies, legendaries, XP
- [x] **Wild Pokémon spawn system** — 2 random auto-spawns per stream (one in first hour, one later), broadcaster `!spawn` to force more, viewers race to `!pokecatch` (90% catch rate, 30% for legendaries, no per-user attempt limit), 5-min timeout
- [x] **OG-style catch animation** — 3D pokéball flies in, opens with white capture beam, Pokémon spirals in, ball drops and wiggles ×3, gold halo confirms, OG capture sound plays
- [x] **Suspense reveal** — chat sees "@X threw a pokéball at <Name>! Will it catch?!" first; the "🎉 CAUGHT IT!" reveal arrives 8 seconds later via the Catch Reveal action so it syncs with the overlay celebration
- [x] **Source badge on dex** — 📦 packed vs 🌿 caught, so viewers can see how they got each Pokémon
- [x] **Timed chat message** — promotional banner every 10-15 min explaining the system to new viewers

## Stream-side mini-games (no code, just announce on stream)

- [ ] **Pull of the night** — end-of-stream giveaway for whoever pulled the rarest Pokémon that night
- [ ] **Type challenges** — "Fire Day! Anyone who pulls a Fire-type today gets a sub-gift from me back to them next week"
- [ ] **First-to-X races** — "First viewer to hit 50/151 wins X"
- [ ] **Lucky pull predictions** — before a gift sub, viewer in chat predicts what Pokémon will pull → if right, they get a reward
- [ ] **Themed days** — "Legendary hunt night" with bonus odds (flip `legendaryWeight` in `config.js` to e.g. 0.5 for that stream)

## Easy features to build (1–2 hours each)

- [ ] **`!compare USERNAME` command** — Botrix-driven comparison between two viewers' collections
- [ ] **Daily login bonus** — first chat message each stream day = 1 free pack credit for that viewer
- [ ] **Featured viewer of the week** — auto-pick top puller from last 7 days, surface their dex on stream

## 🔥 Big feature — Team battles with Pokémon levelling (~15-25 hrs)

**Concept:** Viewers pick a team of up to 6 from their collection. `!battle @user` pits two teams against each other; type matchups + Pokémon levels decide the outcome. Each participating Pokémon gains XP and levels up individually, alongside the trainer's overall level.

**Data model extensions:**
- Each `/collections/<user>/<slot>` entry gains `level`, `xp`, `wins`, `losses` fields. Starting Lv 5 on catch/pull.
- New `/teams/<user>` = array of up to 6 slot keys.
- New `/active_battle` = current battle state (one at a time).

**Mechanics:**
- `!battle @user` → 60s window for `!accept @user`
- Auto-simulated battle (turn-by-turn would drag on chat); ~30-45s overlay animation
- Type chart (simplified single-type) + level-scaled damage
- Higher level = more damage but type advantage is the bigger lever (upsets matter)
- KO'd Pokémon "rests" 30 min before usable again — team depth matters
- Per-viewer battle cooldown ~15 min

**XP rewards per battle:**
- All participating Pokémon get base XP
- KO'ing an opponent = bonus XP
- Winning team's Pokémon get a multiplier
- Trainer XP also awarded

**Build order if/when picked up:**
1. Add level/xp fields to collection entries (passive, no UI) — every new entry starts Lv 5
2. Team picker UI on pokédex
3. `!battle` chat command with text-only output (no overlay)
4. Battle overlay animation on top
5. XP awards + level-up notifications + cooldowns

See conversation memory `team_battle_design.md` for the full design notes.

## Future generations

- [ ] **Gen 2 rollout** — 100 more Pokémon, adds Dark + Steel types, existing XP and collections carry forward
- [ ] **Gen 3 rollout** — 135 more Pokémon, expands the dex further

## Trading

- [ ] **Trading system** — viewers swap Pokémon. With dual-dex it's more feasible (both variants are collectibles). Rules TBD (same-rarity swaps? cooldowns? prevent stripping accounts?)
- [ ] **Trade-up mechanic** — viewer trades 5 caught Pokémon for a guaranteed shiny/legendary attempt

## Tuning ideas (no new features, just config changes)

- [ ] Tune `shinyOdds` (currently 1/100) once we have real pull data
- [ ] Tune `legendaryWeight` (currently 0.1 = 10× rarer)
- [ ] Tune `wildSpawn.catchPercent` if 90% feels too easy in practice
- [ ] Tune `wildSpawn.timeoutMs` if 5 min is too long/short
- [ ] Adjust XP curve constants if Champion is too easy or too hard to reach

## Parked ideas — maybe later

- [ ] **Rigged-pack mechanic for giveaways / charity prizes** — broadcaster writes `/forced_pack/<userkey>` to Firebase with `{id, shiny}`, viewer types `!redeempack` next stream, overlay detects the forced card, plays the normal pack animation, clears the node. Real on-stream hype moment instead of silent Firebase write. Discussed after Macmillan Cancer Charity 2026 event — would have been ideal for revealing jdjammer13's shiny Charizard prize live on stream. Minimum build: ~45 min to 1 hr. Two changes to overlay.html: (1) check for `/forced_pack/<userkey>` before random card roll, use it + delete the node if present, (2) bypass dupe-prevention check when forced card is in play (so users who already own the standard variant can still receive the shiny). No new chat commands needed — manual Firebase write like the charity Charizard flow. Build when the next charity event or special giveaway is on the calendar.
- [ ] **Pokéball shop** — viewers buy Great / Ultra / Master Balls to boost wild catch rate. Suggested on stream 2026-05-19. Held off because the currency question is unsettled (Kicks already convert to packs; adding another spend path complicates the economy). Worth revisiting once battles are running and we see what viewers want to spend on. Likely design: `/balls/<userkey>` Firebase inventory, `!buyball` / `!balls` / `!pokecatch <type>` commands, failed attempts still burn the ball for real stakes. ~4-6 hr build.
- [ ] **Battle-only evolution** — Suggested on stream 2026-05-19. Conflicts with the dex's "151 unique" model (every evolution is already a separate card in packs), so dex-side evolution doesn't make sense. ONLY interesting path: when in battle, a Pokémon above Lv X fights AS its evolved form (Charmander → Charizard) with evolved stats, but stays as Charmander on the dex. Cosmetic on the collection, mechanical in combat. Pre-req: battles must exist. ~3-5 hr build on top of battles. Chat ELI5 reply for now: "Every evolution is already in packs — pull Charmander, Charmeleon, or Charizard directly. Battle-evolution is something I'm thinking about for after battles ship."

## Polish that might come up

- [ ] Custom domain to replace github.io URL ($10/year)
- [ ] Private repo via Cloudflare Pages (if code-hiding becomes worth it)
- [ ] Discord role sync — viewer hits level threshold → Discord role auto-assigned
- [ ] Mobile-optimised pokédex view (already responsive but could be tightened)
- [ ] Animated sprite hover in modal (Showdown GIFs work at modal art size)
- [ ] Pokémon character avatar builder (paused — needs auth model first; chat-driven `!avatar` command is the way)
- [ ] Audit log node (`/audit_log/`) for `!givepack` actions so we can see which broadcaster credit went where
- [ ] Make !redeempack cooldown configurable per stream (currently 4s hard-coded)
- [ ] Pokémon Showdown / higher-res sprites option (currently using PokeAPI showdown mirror — fine but pixelated)
