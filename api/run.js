import { runPipeline } from "../src/run.js";

// Vercel serverless function. Vercel Cron calls it with "Authorization: Bearer $CRON_SECRET".
export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const { stats, error } = await runPipeline({ deadlineMs: 240_000 }); // leave headroom under maxDuration
  return res.status(error ? 500 : 200).json({ ok: !error, stats, error });
}
