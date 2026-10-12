import { waitUntil } from "@vercel/functions";
import { supabase } from "../src/clients.js";
import { runPipeline } from "../src/run.js";

// Public "Run now" button on the Runs page. Safe to expose: a run only creates Gmail DRAFTS (never sends),
// known startups are skipped, and a cooldown stops anyone from hammering it.
export const config = { maxDuration: 300 };
const COOLDOWN_MS = 3 * 60 * 1000;   // minimum gap between runs started from the dashboard
const STALE_MS = 6 * 60 * 1000;      // an unfinished run older than this is treated as dead

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { data } = await supabase.from("runs").select("started_at,finished_at").order("id", { ascending: false }).limit(1);
  const last = data?.[0];
  if (last) {
    const age = Date.now() - Date.parse(last.started_at);
    if (!last.finished_at && age < STALE_MS) return res.status(409).json({ error: "A run is already in progress." });
    if (age < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - age) / 1000);
      return res.status(429).json({ error: `A run just started. Try again in ${wait}s.` });
    }
  }
  waitUntil(runPipeline({ deadlineMs: 240_000 }).catch((e) => console.error("run failed:", e.message)));
  return res.status(202).json({ ok: true, started: true });
}
