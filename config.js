// =============================================================
// CONFIG — edit these values to match your setup, then save.
// This file is loaded by both overlay.html and pokedex.html.
// =============================================================

window.STREAM_CONFIG = {
  // ---- Streamer.bot WebSocket Server ----
  // Defaults match Streamer.bot's out-of-the-box settings.
  // Open Streamer.bot → Servers/Clients → WebSocket Server to confirm.
  streamerbotHost: '127.0.0.1',
  streamerbotPort: 8080,
  streamerbotEndpoint: '/',
  streamerbotPassword: '',         // leave '' if you didn't set one

  // ---- Custom Event name ----
  // In Streamer.bot, create an action triggered by "Kick → Sub Gift"
  // and add a sub-action "Custom: Trigger Custom Event" with this name.
  // The action should pass two arguments: user (gifter name) and count (qty).
  customEventName: 'pokepack',

  // Native Kick events are also broadcast by Streamer.bot for real (non-test) gift subs.
  // Keep this OFF — the Raw.Action path (via your pokepack action) already catches every
  // gift, so enabling this would double-count credits on real subs.
  listenNativeKickGifts: false,

  // ---- Shiny odds — 1 in N ----
  shinyOdds: 100,

  // ---- Legendary rarity weight (vs regular cards = 1.0) ----
  // The 5 Gen 1 legendaries (Articuno, Zapdos, Moltres, Mewtwo, Mew) are
  // weighted lower so they feel like a chase pull. No-dupes means viewers
  // WILL still get all 5 eventually — just less often early on.
  //   0.1   = 10× rarer than regulars (recommended starting point)
  //   0.05  = 20× rarer
  //   0.02  = 50× rarer (shock-value moments)
  legendaryWeight: 0.1,

  // ---- Firebase Realtime Database ----
  // Required if you want viewers to see their own dex on pokedex.html.
  // Leave blank to run with localStorage-only (overlay still works,
  // but viewers can't access their collection page).
  //
  // Get this URL from: Firebase Console → Realtime Database → Data tab
  // Format: https://YOUR-PROJECT-default-rtdb.firebaseio.com
  // See README for setup steps + security rules.
  firebaseUrl: 'https://pokemon-pack-overlay-default-rtdb.europe-west1.firebasedatabase.app',

  // ---- Pack economy ----
  // How many gifted subs a viewer must accumulate to earn one pack.
  // Partial credits persist across sessions per viewer.
  giftsPerPack: 2,

  // Cards per pack (once the viewer earns a pack).
  cardsPerPack: 1,

  // ---- Animation timing (ms) ----
  animMs:   10000,   // total pack opening (~10s as requested)
  lingerMs:  4000,   // how long card sits on screen after reveal

  // ---- Card back image (optional) ----
  // Leave blank to use the built-in CSS recreation of the classic TCG back
  // (blue swirl + Pokéball + mirrored POKÉMON wordmarks).
  // To use your own back art, paste a direct image URL here, e.g. an .png
  // you've uploaded to your own GitHub repo. NOTE: hosting Nintendo/Pokémon-
  // licensed artwork on public sites can attract takedown notices — that's
  // your call.
  cardBackImageUrl: 'https://raw.githubusercontent.com/amateurgamer18/pokemon-pack-overlay/main/backcard.png',

  // ---- Wild Pokémon spawn system ----
  // 3 random auto-spawns per stream. Timing is fully random within ranges
  // so viewers can't predict drops. One within the first hour, the other two
  // spread across the rest of the stream. Broadcaster can force extra spawns
  // beyond the cap with !spawn.
  wildSpawn: {
    enabled: true,
    firstSpawnMinMs:  5 * 60 * 1000,   // earliest first spawn — 5 min after overlay loads
    firstSpawnMaxMs: 60 * 60 * 1000,   // latest first spawn   — within the first hour
    intervalMinMs:   60 * 60 * 1000,   // minimum gap between subsequent auto-spawns — 1 hr
    intervalMaxMs:  180 * 60 * 1000,   // maximum gap between subsequent auto-spawns — 3 hr
    timeoutMs:        5 * 60 * 1000,   // viewers get 5 min to catch before Pokémon flees
    maxPerSession: 3,                  // auto-spawn cap per stream (manual !spawn bypasses)
    catchPercent: 90,                  // also lives in streamerbot-pokecatch.cs (kept here for reference)
    // OG-style catch sound. Plays the moment the pokéball animation starts.
    // Leave blank to disable. Add an MP3 to your GitHub repo and put the raw URL here.
    // Sound plays at cfg.soundVolume and only if cfg.soundsEnabled is true.
    catchSoundUrl: 'https://raw.githubusercontent.com/amateurgamer18/pokemon-pack-overlay/main/pokemon-catch.mp3',
  },

  // ---- Sound effects ----
  // soundsEnabled        — master on/off (or add ?mute=1 to the URL to silence)
  // soundVolume          — 0.0 (silent) to 1.0 (full). Tune so SFX sit
  //                        comfortably under your stream voice.
  // legendaryFanfareUrl  — relative path or full URL to your fanfare MP3.
  //                        Pack tear, regular reveal, and shiny reveal are
  //                        generated procedurally — no files needed for those.
  soundsEnabled: true,
  soundVolume: 0.5,
  legendaryFanfareUrl: 'legendary-fanfare.mp3',
};
