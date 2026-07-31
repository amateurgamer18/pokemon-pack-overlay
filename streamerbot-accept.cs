// =============================================================================
// !accept @<challenger>
// =============================================================================
// Accepts a pending battle challenge posted by !battle. Reads both viewers'
// teams from Firebase, validates health one more time (in case something
// changed since the challenge was posted), then writes /active_battle for
// the battle overlay to pick up and animate.
//
// Streamer.bot setup:
//   1. New action "Battle Accept"
//   2. Trigger: Kick → Chat Message
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

    public bool Execute()
    {
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

        string msgLower = message.Trim().ToLower();
        if (msgLower != "!accept" && !msgLower.StartsWith("!accept ")) return false;

        // ---- Fetch the pending challenge for this sender
        string chalUrl = FIREBASE_URL + "/battle_challenges/" + Uri.EscapeDataString(senderKey) + ".json";
        JObject challenge = null;
        try {
            using (var http = new HttpClient()) {
                http.Timeout = TimeSpan.FromSeconds(6);
                var resp = http.GetAsync(chalUrl).GetAwaiter().GetResult();
                if (resp.IsSuccessStatusCode) {
                    string body = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!string.IsNullOrWhiteSpace(body) && body != "null") {
                        challenge = JObject.Parse(body);
                    }
                }
            }
        } catch (Exception ex) {
            CPH.LogWarn("[accept] fetch challenge failed: " + ex.Message);
            SetReply("@" + sender + " — couldn't check for challenges. Try again.");
            return true;
        }

        if (challenge == null) {
            SetReply("@" + sender + " — no pending battle challenge for you.");
            return true;
        }

        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        long expiresAt = challenge["expiresAt"] != null ? (long)challenge["expiresAt"] : 0;
        if (expiresAt <= now) {
            // Clean up the stale entry
            DeleteChallenge(senderKey);
            SetReply("@" + sender + " — that battle challenge has expired.");
            return true;
        }

        string challengerKey = challenge["from"] != null ? (string)challenge["from"] : "";
        string challengerDisplay = challenge["fromDisplay"] != null ? (string)challenge["fromDisplay"] : challengerKey;
        if (string.IsNullOrEmpty(challengerKey)) {
            SetReply("@" + sender + " — challenge data is malformed. Ask them to try !battle again.");
            DeleteChallenge(senderKey);
            return true;
        }

        // Optional: !accept @somebody — verify the @ matches the actual challenger
        var parts = message.Trim().Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length >= 2) {
            string typed = parts[1].TrimStart('@').Trim().ToLower();
            if (typed != challengerKey) {
                SetReply("@" + sender + " — your pending challenge is from @" + challengerDisplay + ", not @" + parts[1].TrimStart('@') + ".");
                return true;
            }
        }

        // ---- Re-validate both teams (state might have changed since challenge posted)
        string senderErr, challengerErr;
        JArray senderTeam = LoadValidatedTeam(senderKey, out senderErr);
        if (senderTeam == null) {
            SetReply("@" + sender + " — " + senderErr);
            return true;
        }
        JArray challengerTeam = LoadValidatedTeam(challengerKey, out challengerErr);
        if (challengerTeam == null) {
            SetReply("@" + sender + " — @" + challengerDisplay + " " + challengerErr + " Battle cancelled.");
            DeleteChallenge(senderKey);
            return true;
        }

        // ---- Write /active_battle for the overlay to pick up
        string battleId = now.ToString() + "_" + challengerKey + "_" + senderKey;
        // Explicit indexer assignments — Streamer.bot's C# host doesn't support
        // the dictionary-initializer syntax `new JObject { ["k"] = v }`.
        var battle = new JObject();
        battle["battleId"] = battleId;
        battle["trainer1"] = challengerDisplay;
        battle["trainer2"] = sender;
        battle["team1"] = challengerTeam;
        battle["team2"] = senderTeam;
        battle["postedAt"] = now;
        // Queue design: /battle_queue/<battleId> = battle payload. The overlay
        // polls the queue, processes oldest first (by postedAt), then deletes.
        // Prevents /active_battle overwriting itself when accepts fire fast.
        int queueDepth = 0;
        try {
            using (var http = new HttpClient()) {
                http.Timeout = TimeSpan.FromSeconds(6);
                var checkResp = http.GetAsync(FIREBASE_URL + "/battle_queue.json").GetAwaiter().GetResult();
                if (checkResp.IsSuccessStatusCode) {
                    string body = checkResp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!string.IsNullOrWhiteSpace(body) && body != "null") {
                        var q = JObject.Parse(body);
                        queueDepth = q.Count;
                    }
                }
            }
        } catch (Exception ex) {
            CPH.LogWarn("[accept] queue-depth check failed: " + ex.Message);
        }
        try {
            using (var http = new HttpClient()) {
                http.Timeout = TimeSpan.FromSeconds(8);
                string battleUrl = FIREBASE_URL + "/battle_queue/" + Uri.EscapeDataString(battleId) + ".json";
                var content = new StringContent(battle.ToString(), Encoding.UTF8, "application/json");
                var resp = http.PutAsync(battleUrl, content).GetAwaiter().GetResult();
                if (!resp.IsSuccessStatusCode) {
                    CPH.LogWarn("[accept] failed to post to battle_queue: " + resp.StatusCode);
                    SetReply("@" + sender + " — couldn't queue the battle. Try again.");
                    return true;
                }
            }
        } catch (Exception ex) {
            CPH.LogWarn("[accept] post battle_queue error: " + ex.Message);
            SetReply("@" + sender + " — network hiccup, try again.");
            return true;
        }

        DeleteChallenge(senderKey);
        string queueMsg;
        if (queueDepth == 0) {
            queueMsg = "starting now!";
        } else {
            int waitMin = Math.Max(1, (queueDepth * 2));   // ~2 min per battle estimate
            queueMsg = "queued — " + queueDepth + " battle" + (queueDepth == 1 ? "" : "s") + " ahead (~" + waitMin + " min wait)";
        }
        SetReply("⚔ Battle " + queueMsg + " @" + challengerDisplay + " vs @" + sender);
        return true;
    }

    void DeleteChallenge(string userKey)
    {
        try {
            using (var http = new HttpClient()) {
                http.Timeout = TimeSpan.FromSeconds(6);
                string url = FIREBASE_URL + "/battle_challenges/" + Uri.EscapeDataString(userKey) + ".json";
                http.DeleteAsync(url).GetAwaiter().GetResult();
            }
        } catch (Exception ex) {
            CPH.LogWarn("[accept] delete challenge failed: " + ex.Message);
        }
    }

    // Identical to streamerbot-battle.cs — kept inline so each action stays self-contained.
    JArray LoadValidatedTeam(string userKey, out string err)
    {
        err = "";
        JArray teamRaw = null;
        JObject collection = null;

        try {
            using (var http = new HttpClient()) {
                http.Timeout = TimeSpan.FromSeconds(6);
                string teamUrl = FIREBASE_URL + "/teams/" + Uri.EscapeDataString(userKey) + ".json";
                var teamResp = http.GetAsync(teamUrl).GetAwaiter().GetResult();
                if (teamResp.IsSuccessStatusCode) {
                    string body = teamResp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!string.IsNullOrWhiteSpace(body) && body != "null") teamRaw = JArray.Parse(body);
                }
                string colUrl = FIREBASE_URL + "/collections/" + Uri.EscapeDataString(userKey) + ".json";
                var colResp = http.GetAsync(colUrl).GetAwaiter().GetResult();
                if (colResp.IsSuccessStatusCode) {
                    string body = colResp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!string.IsNullOrWhiteSpace(body) && body != "null") collection = JObject.Parse(body);
                }
            }
        } catch (Exception ex) {
            err = "couldn't load team (network issue).";
            CPH.LogWarn("[accept] LoadValidatedTeam error: " + ex.Message);
            return null;
        }

        if (teamRaw == null || teamRaw.Count == 0) { err = "has no battle team set."; return null; }
        if (collection == null) { err = "has no Pokémon in their collection."; return null; }

        var enriched = new JArray();
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var t in teamRaw) {
            var entry = t as JObject;
            if (entry == null || entry["id"] == null) continue;
            int id = (int)entry["id"];
            bool shiny = entry["shiny"] != null && (bool)entry["shiny"];
            string slotKey = shiny ? (id + "_shiny") : id.ToString();
            var col = collection[slotKey] as JObject;
            if (col == null) { err = "has a team member no longer in their collection."; return null; }
            // Same proportional-regen math as pokedex.html — accounts for
            // natural healing elapsed since damagedAt (stale currentHP fields
            // don't get cleared until viewer interaction or writeback).
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
            if (centerUntil > now) { err = "has Pokémon at the Pokémon Center."; return null; }

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
                long elapsed = now - damagedAt;
                if (elapsed >= 60000L) effectiveStatus = null;
            }

            if (effectiveHP < maxHP || (!string.IsNullOrEmpty(effectiveStatus) && effectiveStatus != "none")) {
                err = "has wounded Pokémon on their team."; return null;
            }
            var out_entry = new JObject();
            out_entry["id"] = id;
            out_entry["shiny"] = shiny;
            out_entry["level"] = level;
            out_entry["isShiny"] = shiny;
            if (col["moves"] != null && col["moves"].Type != JTokenType.Null) out_entry["moves"] = col["moves"];
            enriched.Add(out_entry);
        }
        if (enriched.Count == 0) { err = "has an empty battle team."; return null; }
        return enriched;
    }

    static readonly Dictionary<int, int> BASE_HP = BuildBaseHP();
    static Dictionary<int, int> BuildBaseHP()
    {
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
    static int ComputeMaxHP(int id, int level)
    {
        if (!BASE_HP.ContainsKey(id)) return 40;
        int b = BASE_HP[id];
        return (int)Math.Floor((double)((2 * b + 15) * level) / 100) + level + 10;
    }

    void SetReply(string text)
    {
        CPH.SetArgument("reply", text);
        CPH.LogInfo("[accept] reply queued: " + text);
    }
}
