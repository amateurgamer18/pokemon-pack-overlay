// =============================================================================
// !battle @<username>
// =============================================================================
// Challenges another viewer to a battle. Both viewers must have teams set
// and all Pokémon on those teams must be healthy (not at the Pokémon Center,
// not wounded, not statused). If both conditions hold, the target has 60s
// to type !accept @<challenger> — see streamerbot-accept.cs.
//
// Example:
//   !battle @jdjammer13    → challenges jdjammer13
//
// Streamer.bot setup:
//   1. New action "Battle Challenge"
//   2. Trigger: Kick → Chat Message  (no permission filter — open to everyone)
//   3. Sub-action 1: Core → Execute Code (paste this file)
//   4. Sub-action 2: Kick → Chat → Send Message To Channel, message = %reply%,
//      "send as broadcaster" toggled on
// =============================================================================

using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    const string FIREBASE_URL =
        "https://pokemon-pack-overlay-default-rtdb.europe-west1.firebasedatabase.app";
    const int COOLDOWN_MS   = 30000;    // 30s per-sender cooldown
    const int CHALLENGE_TTL_MS = 60000; // challenge expires after 60s

    public bool Execute()
    {
        // ---- Parse message + sender
        string message = "";
        if (args.ContainsKey("message") && args["message"] != null)
            message = args["message"].ToString();
        else if (args.ContainsKey("messageStripped") && args["messageStripped"] != null)
            message = args["messageStripped"].ToString();

        string sender = "";
        foreach (string k in new[] { "user", "userName", "user_name" }) {
            if (args.ContainsKey(k) && args[k] != null) {
                sender = args[k].ToString().Trim();
                if (!string.IsNullOrEmpty(sender)) break;
            }
        }
        if (string.IsNullOrEmpty(sender)) return false;
        string senderKey = sender.ToLower();

        // ---- Match the !battle command
        string msgLower = message.Trim().ToLower();
        if (msgLower != "!battle" && !msgLower.StartsWith("!battle ")) return false;

        // ---- Parse target (must be @-mention)
        var parts = message.Trim().Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2) {
            SetReply("@" + sender + " — usage: !battle @username");
            return true;
        }
        string targetRaw = parts[1].TrimStart('@').Trim();
        if (string.IsNullOrEmpty(targetRaw)) {
            SetReply("@" + sender + " — usage: !battle @username");
            return true;
        }
        string targetKey = targetRaw.ToLower();

        if (targetKey == senderKey) {
            SetReply("@" + sender + " — you can't battle yourself.");
            return true;
        }

        // ---- Per-sender cooldown
        string cdKey = "battleCD_" + senderKey;
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        string lastTs = CPH.GetGlobalVar<string>(cdKey, false);
        if (!string.IsNullOrEmpty(lastTs)) {
            long last;
            if (long.TryParse(lastTs, out last) && (now - last) < COOLDOWN_MS) {
                int wait = (int)Math.Ceiling((COOLDOWN_MS - (now - last)) / 1000.0);
                SetReply("@" + sender + " — !battle cooldown, try again in " + wait + "s.");
                return true;
            }
        }

        // ---- Check both teams exist and are healthy
        string senderErr, targetErr;
        JArray senderTeam = LoadValidatedTeam(senderKey, out senderErr);
        if (senderTeam == null) {
            SetReply("@" + sender + " — " + senderErr);
            return true;
        }
        JArray targetTeam = LoadValidatedTeam(targetKey, out targetErr);
        if (targetTeam == null) {
            SetReply("@" + sender + " — @" + targetRaw + " " + targetErr);
            return true;
        }

        // ---- Check for existing pending challenge on target (don't overwrite)
        string chalUrl = FIREBASE_URL + "/battle_challenges/" + Uri.EscapeDataString(targetKey) + ".json";
        try {
            using (var http = new HttpClient()) {
                http.Timeout = TimeSpan.FromSeconds(6);
                var resp = http.GetAsync(chalUrl).GetAwaiter().GetResult();
                if (resp.IsSuccessStatusCode) {
                    string body = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!string.IsNullOrWhiteSpace(body) && body != "null") {
                        var existing = JObject.Parse(body);
                        long expires = existing["expiresAt"] != null ? (long)existing["expiresAt"] : 0;
                        if (expires > now) {
                            SetReply("@" + sender + " — @" + targetRaw + " already has a pending challenge. Try again in " + (int)((expires - now) / 1000) + "s.");
                            return true;
                        }
                    }
                }
            }
        } catch (Exception ex) {
            CPH.LogWarn("[battle] check-existing-challenge failed: " + ex.Message);
        }

        // ---- Write the pending challenge
        long expiresAt = now + CHALLENGE_TTL_MS;
        // Explicit indexer assignments — Streamer.bot's C# host doesn't support
        // the dictionary-initializer syntax `new JObject { ["k"] = v }` (throws
        // IDynamicMetaObjectProvider reference errors).
        var payload = new JObject();
        payload["from"] = senderKey;
        payload["fromDisplay"] = sender;
        payload["expiresAt"] = expiresAt;
        payload["postedAt"] = now;
        try {
            using (var http = new HttpClient()) {
                http.Timeout = TimeSpan.FromSeconds(8);
                var content = new StringContent(payload.ToString(), Encoding.UTF8, "application/json");
                var resp = http.PutAsync(chalUrl, content).GetAwaiter().GetResult();
                if (!resp.IsSuccessStatusCode) {
                    CPH.LogWarn("[battle] failed to write challenge: " + resp.StatusCode);
                    SetReply("@" + sender + " — couldn't post the challenge. Try again in a moment.");
                    return true;
                }
            }
        } catch (Exception ex) {
            CPH.LogWarn("[battle] write-challenge error: " + ex.Message);
            SetReply("@" + sender + " — network hiccup, try again.");
            return true;
        }

        // Cooldown starts on successful post
        CPH.SetGlobalVar(cdKey, now.ToString(), false);

        SetReply("⚔ @" + targetRaw + " — @" + sender + " challenges you to a Pokémon battle! Type " +
                 "\"!accept @" + sender + "\" within 60s to accept, or \"!decline @" + sender + "\" to refuse.");
        return true;
    }

    // -------------------------------------------------------------------------
    // Fetch a viewer's team from Firebase, validate every member is healthy.
    // Returns the JArray of {id, shiny, level, moves} objects on success,
    // or null with a human-readable error in `err`.
    // -------------------------------------------------------------------------
    JArray LoadValidatedTeam(string userKey, out string err)
    {
        err = "";
        JArray teamRaw = null;
        JObject collection = null;

        try {
            using (var http = new HttpClient()) {
                http.Timeout = TimeSpan.FromSeconds(6);
                // Fetch team
                string teamUrl = FIREBASE_URL + "/teams/" + Uri.EscapeDataString(userKey) + ".json";
                var teamResp = http.GetAsync(teamUrl).GetAwaiter().GetResult();
                if (teamResp.IsSuccessStatusCode) {
                    string body = teamResp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!string.IsNullOrWhiteSpace(body) && body != "null") teamRaw = JArray.Parse(body);
                }
                // Fetch collection
                string colUrl = FIREBASE_URL + "/collections/" + Uri.EscapeDataString(userKey) + ".json";
                var colResp = http.GetAsync(colUrl).GetAwaiter().GetResult();
                if (colResp.IsSuccessStatusCode) {
                    string body = colResp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!string.IsNullOrWhiteSpace(body) && body != "null") collection = JObject.Parse(body);
                }
            }
        } catch (Exception ex) {
            err = "couldn't load team (network issue).";
            CPH.LogWarn("[battle] LoadValidatedTeam error: " + ex.Message);
            return null;
        }

        if (teamRaw == null || teamRaw.Count == 0) {
            err = "hasn't set up a battle team yet. Log in on the pokédex page and pick some Pokémon.";
            return null;
        }
        if (collection == null) {
            err = "has no Pokémon in their collection.";
            return null;
        }

        var enriched = new JArray();
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var t in teamRaw) {
            var entry = t as JObject;
            if (entry == null || entry["id"] == null) continue;
            int id = (int)entry["id"];
            bool shiny = entry["shiny"] != null && (bool)entry["shiny"];
            string slotKey = shiny ? (id + "_shiny") : id.ToString();
            var col = collection[slotKey] as JObject;
            if (col == null) {
                err = "has a team member (#" + id + ") that isn't in their collection anymore.";
                return null;
            }
            // Health checks — must compute EFFECTIVE current HP from stored fields
            // (currentHP + damagedAt/centerUntil timestamps) using the same
            // proportional-regen logic as pokedex.html. Otherwise we'd flag
            // Pokémon that have naturally healed since the stored damage but
            // whose stale currentHP field hasn't been cleared yet.
            int level = col["level"] != null ? (int)col["level"] : 5;
            int maxHP = ComputeMaxHP(id, level);
            int storedHP = col["currentHP"] != null && col["currentHP"].Type != JTokenType.Null
                ? (int)col["currentHP"] : maxHP;
            string storedStatus = col["status"] != null && col["status"].Type != JTokenType.Null
                ? (string)col["status"] : null;
            long damagedAt = col["damagedAt"] != null && col["damagedAt"].Type != JTokenType.Null
                ? (long)col["damagedAt"] : 0;
            long centerUntil = col["centerUntil"] != null && col["centerUntil"].Type != JTokenType.Null
                ? (long)col["centerUntil"] : 0;

            // At Pokémon Center — always block (even if timer expired, they're
            // considered healing until the viewer's dex reloads or writeback runs).
            if (centerUntil > now) {
                err = "has Pokémon at the Pokémon Center. Wait for healing to complete or swap them out.";
                return null;
            }

            // Compute effective current HP + status given elapsed natural regen
            int effectiveHP = storedHP;
            string effectiveStatus = storedStatus;
            if (damagedAt > 0 && storedHP < maxHP) {
                int missing = maxHP - storedHP;
                double damagePct = (double)missing / maxHP;
                long naturalMs = Math.Max(60000L, (long)(damagePct * 30 * 60 * 1000));
                long elapsed = now - damagedAt;
                if (elapsed >= naturalMs) {
                    effectiveHP = maxHP;
                    effectiveStatus = null;
                } else {
                    double pct = (double)elapsed / naturalMs;
                    effectiveHP = (int)Math.Round(storedHP + (maxHP - storedHP) * pct);
                }
            } else if (damagedAt > 0 && !string.IsNullOrEmpty(storedStatus) && storedStatus != "none") {
                // Status-only case (HP full but poisoned/burned) — 1 min floor
                long elapsed = now - damagedAt;
                if (elapsed >= 60000L) effectiveStatus = null;
            }

            if (effectiveHP < maxHP || (!string.IsNullOrEmpty(effectiveStatus) && effectiveStatus != "none")) {
                err = "has wounded Pokémon on their team. Send them to the Pokémon Center or swap in healthy ones.";
                return null;
            }

            // Build enriched entry for the /active_battle payload
            var out_entry = new JObject();
            out_entry["id"] = id;
            out_entry["shiny"] = shiny;
            out_entry["level"] = level;
            out_entry["isShiny"] = shiny;
            if (col["moves"] != null && col["moves"].Type != JTokenType.Null) {
                out_entry["moves"] = col["moves"];
            }
            enriched.Add(out_entry);
        }

        if (enriched.Count == 0) {
            err = "has an empty battle team.";
            return null;
        }
        return enriched;
    }

    // Gen 1 HP formula, IV=15, EV=0. Must match battle-engine.js / pokedex.html.
    static readonly Dictionary<int, int> BASE_HP = BuildBaseHP();
    static Dictionary<int, int> BuildBaseHP()
    {
        // Full Gen 1 base HP values, keyed by pokedex ID 1-151.
        // These are canonical Gen 1 base HP stats.
        var d = new Dictionary<int, int>();
        int[] hp = new int[] {
            45, 60, 80, 39, 58, 78, 44, 59, 79, 45, 50, 60, 40, 45, 65,
            40, 63, 83, 30, 55, 40, 65, 35, 60, 35, 60, 50, 75, 55, 70,
            90, 46, 61, 81, 60, 95, 38, 73, 115, 140, 20, 45, 45, 60, 75,
            35, 60, 60, 40, 55, 30, 55, 40, 65, 25, 50, 50, 90, 40, 65,
            90, 40, 65, 25, 40, 65, 20, 50, 65, 40, 60, 40, 40, 50, 80,
            80, 105, 55, 65, 45, 60, 65, 90, 25, 60, 70, 50, 75, 90, 60,
            80, 35, 50, 60, 50, 80, 130, 40, 60, 40, 60, 60, 90, 40, 105,
            80, 80, 40, 55, 80, 30, 60, 80, 90, 90, 30, 50, 50, 80, 50,
            250, 30, 50, 40, 55, 65, 100, 55, 90, 65, 65, 65, 90, 130, 90,
            65, 90, 105, 85, 250, 165, 35, 55, 65, 106, 106
        };
        for (int i = 0; i < hp.Length && i < 151; i++) d[i + 1] = hp[i];
        return d;
    }

    static int ComputeMaxHP(int pokemonId, int level)
    {
        if (!BASE_HP.ContainsKey(pokemonId)) return 40;
        int b = BASE_HP[pokemonId];
        return (int)Math.Floor((double)((2 * b + 15) * level) / 100) + level + 10;
    }

    void SetReply(string text)
    {
        CPH.SetArgument("reply", text);
        CPH.LogInfo("[battle] reply queued: " + text);
    }
}
