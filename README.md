# Kick Gift-Sub Pokémon Pack Opener

OBS browser source overlay for **kick.com/amateurgamer**. When a viewer gifts a sub on Kick, a Pokémon booster pack opens on stream: top of the pack rips, card back rises out, then the card spins for ~7 seconds (fast → slow), landing on a random Kanto Pokémon. Each viewer builds a personal Pokédex they can view on a public page. First viewer to collect all 151 wins the prize.

## Files

| File | Purpose |
|---|---|
| `overlay.html` | OBS browser source — plays the pack opening |
| `pokedex.html` | Public page viewers visit to see their own collection |
| `cards.js` | All 151 Kanto Pokémon data + sprite URLs |
| `config.js` | Your Firebase URL, Streamer.bot connection, shiny odds, etc. |

## How it works (high level)

1. Viewer gifts a sub on Kick.
2. **Streamer.bot** (running on your PC) receives the event from Kick's API.
3. A Streamer.bot action fires a Custom Event named `pokepack` with the gifter's name + gift count.
4. `overlay.html` (your OBS browser source) is connected to Streamer.bot's WebSocket server, sees the event, and plays the pack animation.
5. The card is saved to that viewer's collection in Firebase + your local browser storage.
6. The viewer can visit `pokedex.html?viewer=theirname` to see their collection any time.

---

## Setup — one-time

### 1) Firebase Realtime Database (free, takes 5 min)

Skip this step if you only want local-only tracking (viewers won't be able to see their dex).

1. Go to <https://console.firebase.google.com> → **Add project** → name it anything (e.g. `amateurgamer-pokedex`).
2. In the left sidebar pick **Build → Realtime Database** → **Create Database** → choose a region → start in **test mode** for now.
3. Copy the database URL shown at the top — it looks like `https://amateurgamer-pokedex-default-rtdb.firebaseio.com`.
4. Paste it into `config.js` as `firebaseUrl`.
5. **Set proper security rules** (Realtime Database → Rules tab). Replace with:

   ```json
   {
     "rules": {
       "collections": {
         ".read": true,
         "$user": { ".write": true }
       },
       "completers": {
         ".read": true,
         ".write": true
       }
     }
   }
   ```

   This lets anyone read (so viewers can see their dex) and anyone write (so the overlay can save pulls). The trade-off: a determined troll who finds the database URL could pollute the data. To lock it down further later, use Firebase Anonymous Auth + a write key — out of scope for v1.

### 2) Host the files (so viewers can visit pokedex.html)

Easiest free option: **GitHub Pages**.

1. Create a new GitHub repo (e.g. `amateurgamer-pokedex`) and upload all four files.
2. Repo Settings → Pages → deploy from `main` branch root.
3. Your URLs become:
   - Overlay (for OBS): `https://YOUR_USER.github.io/amateurgamer-pokedex/overlay.html?debug=0`
   - Public dex (for viewers): `https://YOUR_USER.github.io/amateurgamer-pokedex/pokedex.html?viewer=NAME`

For OBS the overlay can also be loaded from your local disk — but if you host it, the same URL works across machines.

### 3) Streamer.bot — wire up the Kick gift event

1. Install Streamer.bot → <https://streamer.bot>.
2. Open it → **Platforms → Kick** → Connect (OAuth flow).
3. **Servers/Clients → WebSocket Server** → confirm it's running on `127.0.0.1:8080` (the default). If you change it, update `config.js`.
4. **Actions → New Action** → name it `Pokemon Pack Trigger`.
5. Add sub-action: **Core → Sub-Actions → Set Argument** —
   - name: `user`, value: `%userName%` (or `%gifter%` depending on Streamer.bot version)
6. Add sub-action: **Core → Sub-Actions → Set Argument** —
   - name: `count`, value: `%quantity%` (or `%giftCount%`)
7. Add sub-action: **Core → Custom → Trigger Custom Event** —
   - Event name: `pokepack`
   - Arguments: `user`, `count`
8. **Triggers → Add → Kick → Sub Gift** → assign to this action.

> If your Streamer.bot version uses different variable names (`%gifter%`, `%giftCount%` etc.), open the action's **Test** menu and inspect the available variables. The overlay reads `data.user` / `data.gifter` / `data.username` and `data.count` / `data.gifts` / `data.quantity` so any of those names will work.

### 4) OBS — add the browser source

1. In OBS scene → **+ → Browser**.
2. URL: `file:///C:/path/to/overlay.html` *or* your GitHub Pages URL.
3. Width `1920`, Height `1080`.
4. Check **Shutdown source when not visible** OFF (you want it always listening).
5. Check **Refresh browser when scene becomes active** OFF (kills the WebSocket connection otherwise).

### 5) Test before going live

Open `overlay.html?debug=1` in a normal browser (Chrome). You'll see a debug panel bottom-left:

- **Fire gift event** — simulates a gift sub for the username in the box.
- **Force shiny next** — next pull is guaranteed shiny so you can confirm the rainbow effect.
- **Test: 149 caught** — fills the local dex up to 149, gift one more sub to see the completion celebration trigger.
- Keyboard shortcut **G** = fire test gift, **S** = force shiny.

After testing, remove `?debug=1` from the OBS URL.

---

## Tuning

Edit `config.js`:

- **`shinyOdds: 100`** — 1-in-100 shiny rate. Bump to `50` for more excitement on stream, `4096` for true Pokemon odds.
- **`giftsPerPack: 2`** — viewers must accumulate this many gifted subs before they earn a pack. Partial credits persist across streams per viewer (gift 1 today, 1 tomorrow → pack tomorrow).
- **`cardsPerPack: 1`** — cards revealed per earned pack. Bump to `3` for a "real booster pack" feel (still no dupes — all unique pulls from what's missing).
- **`animMs` / `lingerMs`** — total animation length and how long the card sits on screen after the spin.

URL parameters override config values, e.g. `overlay.html?shinyOdds=20` to temporarily boost shiny rate for a special event.

---

## Sharing pokedex links with viewers

In your panels / chat command (Streamer.bot can do this too):

```
!dex  → https://YOUR_USER.github.io/amateurgamer-pokedex/pokedex.html?viewer={user}
```

Where `{user}` is replaced by the requester's username. Streamer.bot's chat command action can post that URL with `%user%` substitution.

---

## Troubleshooting

- **Animation never plays in OBS.** Open the browser source's dev console (right-click source → Interact). Look for WebSocket errors. Check the status bar in `?debug=1` mode — it should say `connected`. If it says `connecting…` forever, Streamer.bot isn't running or the port is wrong.
- **Card image is broken.** PokeAPI's GitHub sprite repo is occasionally rate-limited from a single IP. The image will retry on next pull. If it persists, mirror the sprites to your GitHub repo and adjust `cardSprites()` in `cards.js`.
- **Multiple gifts at once stack weirdly.** A gift bomb of N subs queues N pack openings one after another. Each is ~14s including linger. A 10-sub bomb = ~2:20 of animation. Reduce `lingerMs` or set `cardsPerGift: 1` and have Streamer.bot only fire once per bomb if you want it tighter.
- **Pokédex page shows nothing.** Make sure `firebaseUrl` is set in both `config.js` files (same value) and that you used the security rules above.

---

## Notes

- Sprite art is the official Pokémon artwork hosted by PokéAPI (community project, free, no API key needed). No images bundled.
- All 151 Kanto Pokémon are in the pool. No duplicates per viewer — every pull is a new dex entry.
- Shiny is rolled per-pull at 1-in-100. A viewer can theoretically own both a standard and shiny of the same Pokémon if they pull both, but the dex still treats them as one slot filled (the shiny "upgrades" the entry visually).
