// =============================================================================
// !battlerank [optional @username]
// =============================================================================
// Replies in chat with the viewer's battle stats: wins, losses, win rate, and
// current streak. Reads /battle_stats/<userkey> from Firebase.
//
// Streamer.bot setup:
//   1. New action "Battle Rank"
//   2. Trigger: Kick → Chat Message
//   3. Sub-action 1: Core → Execute Code (paste this file)
//   4. Sub-action 2: Kick → Chat → Send Message To Channel, message = %reply%,
//      "send as broadcaster" toggled on
// =============================================================================

using System;
using System.Net.Http;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    const string FIREBASE_URL =
        "https://pokemon-pack-overlay-default-rtdb.europe-west1.firebasedatabase.app";
    const int COOLDOWN_MS = 30000;

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
        if (msgLower != "!battlerank" && !msgLower.StartsWith("!battlerank ")) return false;

        // Cooldown
        string cdKey = "battlerankCD_" + senderKey;
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        string lastTs = CPH.GetGlobalVar<string>(cdKey, false);
        if (!string.IsNullOrEmpty(lastTs)) {
            long last;
            if (long.TryParse(lastTs, out last) && (now - last) < COOLDOWN_MS) {
                int wait = (int)Math.Ceiling((COOLDOWN_MS - (now - last)) / 1000.0);
                SetReply("@" + sender + " — !battlerank cooldown, try again in " + wait + "s.");
                return true;
            }
        }

        string targetRaw = sender;
        var parts = message.Trim().Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length >= 2) {
            string typed = parts[1].TrimStart('@').Trim();
            if (!string.IsNullOrEmpty(typed)) targetRaw = typed;
        }
        string targetKey = targetRaw.ToLower();

        CPH.SetGlobalVar(cdKey, now.ToString(), false);

        // Fetch battle stats
        JObject stats = null;
        try {
            using (var http = new HttpClient()) {
                http.Timeout = TimeSpan.FromSeconds(6);
                string url = FIREBASE_URL + "/battle_stats/" + Uri.EscapeDataString(targetKey) + ".json";
                var resp = http.GetAsync(url).GetAwaiter().GetResult();
                if (resp.IsSuccessStatusCode) {
                    string body = resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!string.IsNullOrWhiteSpace(body) && body != "null") stats = JObject.Parse(body);
                }
            }
        } catch (Exception ex) {
            CPH.LogWarn("[battlerank] fetch failed: " + ex.Message);
            SetReply("@" + sender + " — couldn't check battle records right now.");
            return true;
        }

        if (stats == null) {
            string who = targetKey == senderKey ? "@" + sender + " — you haven't battled yet." :
                         "@" + targetRaw + " hasn't battled yet.";
            SetReply(who + " Type !battle @someone to start.");
            return true;
        }

        int wins    = stats["wins"] != null ? (int)stats["wins"] : 0;
        int losses  = stats["losses"] != null ? (int)stats["losses"] : 0;
        int streak  = stats["streak"] != null ? (int)stats["streak"] : 0;
        int total   = wins + losses;
        int winRate = total > 0 ? (int)Math.Round((double)wins / total * 100.0) : 0;
        string streakTxt = streak >= 3 ? " · 🔥 " + streak + " win streak" : (streak > 0 ? " · " + streak + " win streak" : "");

        SetReply("⚔ @" + targetRaw + " — " + wins + "W / " + losses + "L (" + winRate + "% win rate)" + streakTxt);
        return true;
    }

    void SetReply(string text)
    {
        CPH.SetArgument("reply", text);
        CPH.LogInfo("[battlerank] reply queued: " + text);
    }
}
