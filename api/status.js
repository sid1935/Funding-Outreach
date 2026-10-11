import { supabase } from "../src/clients.js";

// Read-only, public status feed for the dashboard at /. Exposes no secrets, emails or draft bodies.
export default async function handler(req, res) {
  try {
    const [thesis, runs, drafts, counts] = await Promise.all([
      supabase.from("thesis").select("version,description,stages,sectors,geographies,exclusions,min_score,updated_at").eq("active", true).single(),
      supabase.from("runs").select("started_at,finished_at,stats,error").order("id", { ascending: false }).limit(8),
      supabase.from("outreach").select("fit_score,subject,thesis_version,created_at,startups(name,round_type,amount_usd)").order("id", { ascending: false }).limit(15),
      supabase.from("startups").select("status"),
    ]);
    const byStatus = {};
    (counts.data ?? []).forEach((r) => (byStatus[r.status] = (byStatus[r.status] || 0) + 1));
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({
      thesis: thesis.data, runs: runs.data, drafts: drafts.data, startups: byStatus,
      repo: "https://github.com/sid1935/Funding-Outreach",
    });
  } catch (e) {
    res.status(500).json({ error: "status unavailable" });
  }
}
