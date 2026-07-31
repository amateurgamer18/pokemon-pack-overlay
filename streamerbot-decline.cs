// =============================================================================
// !decline [@<challenger>]
// =============================================================================
// Refuses a pending battle challenge. The @-target is optional — if you have
// exactly one pending challenge, !decline alone is enough.
//
// Streamer.bot setup:
//   1. New action "Battle Decline"
//   2. Trigger: Kick → Chat Message
//   3. Sub-action 1: Core → Execute Code (paste this file)
//   4. Sub-action 2: Kick → Chat → Send Message To Channel, message = %reply%,
//      "send as broadcaster" toggled on
// =============================================================================

using System;
using System.Net.Http;
using System.Text;
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
        if (msgLower != "!decline" && !msgLower.StartsWith("!decline ")) return false;

        // Fetch the pending challenge
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
            CPH.LogWarn("[decline] fetch failed: " + ex.Message);
        }

        if (challenge == null) {
            SetReply("@" + sender + " — no pending battle challenge for you.");
            return true;
        }

        string challengerDisplay = challenge["fromDisplay"] != null ? (string)challenge["fromDisplay"] :
                                    (challenge["from"] != null ? (string)challenge["from"] : "someone");

        // Delete the challenge
        try {
            using (var http = new HttpClient()) {
                http.Timeout = TimeSpan.FromSeconds(6);
                http.DeleteAsync(chalUrl).GetAwaiter().GetResult();
            }
        } catch (Exception ex) {
            CPH.LogWarn("[decline] delete failed: " + ex.Message);
        }

        SetReply("@" + challengerDisplay + " — @" + sender + " declined your battle challenge.");
        return true;
    }

    void SetReply(string text)
    {
        CPH.SetArgument("reply", text);
        CPH.LogInfo("[decline] reply queued: " + text);
    }
}
