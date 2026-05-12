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
};
