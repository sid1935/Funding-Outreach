import { waitUntil } from "@vercel/functions";
import { runPipeline } from "../src/run.js";

// Triggered by Vercel Cron (daily) and by an external hourly timer. Both send "Authorization: Bearer $CRON_SECRET".
// Replies immediately (202) and keeps working in the background, so a timer with a short HTTP timeout
// (cron-job.org waits only ~30s) does not mark the job failed or cut it off.
export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  waitUntil(runPipeline({ deadlineMs: 240_000 }).catch((e) => console.error("run failed:", e.message))); // headroom under maxDuration
  return res.status(202).json({ ok: true, started: true });
}
