import { supabase } from "../src/clients.js";

// Read-only public data feed for the dashboard pages. Never exposes secrets or recipient emails.
const REPO = "https://github.com/sid1935/Funding-Outreach";
const STARTUP_COLS =
  "id,name,domain,round_type,amount_usd,announced_at,source_url,description,status,fit_score,fit_rationale,created_at,outreach(fit_score,subject,body,rationale,thesis_version,created_at)";

export default async function handler(req, res) {
  const view = req.query?.view || "overview";
  try {
    let out;
    if (view === "overview") {
      const [thesis, runs, startups] = await Promise.all([
        supabase.from("thesis").select("version,min_score,sectors,stages,updated_at").eq("active", true).single(),
        supabase.from("runs").select("started_at,finished_at,stats,error").order("id", { ascending: false }).limit(1),
        supabase.from("startups").select("status"),
      ]);
      const counts = {};
      (startups.data ?? []).forEach((r) => (counts[r.status] = (counts[r.status] || 0) + 1));
      out = { thesis: thesis.data, lastRun: runs.data?.[0] ?? null, counts, repo: REPO };
    } else if (view === "startups") {
      const status = ["drafted", "rejected", "error", "processing"].includes(req.query.status) ? req.query.status : null;
      let q = supabase.from("startups").select(STARTUP_COLS).order("id", { ascending: false }).limit(200);
      if (status) q = q.eq("status", status);
      out = { startups: (await q).data ?? [] };
    } else if (view === "thesis") {
      const { data } = await supabase
        .from("thesis")
        .select("version,description,stages,sectors,geographies,exclusions,min_score,pitch,sender_org,updated_at")
        .eq("active", true)
        .single();
      out = { thesis: data };
    } else if (view === "runs") {
      const { data } = await supabase
        .from("runs")
        .select("started_at,finished_at,stats,error")
        .order("id", { ascending: false })
        .limit(50);
      out = { runs: data ?? [] };
    } else {
      return res.status(400).json({ error: "unknown view" });
    }
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=300");
    res.status(200).json(out);
  } catch {
    res.status(500).json({ error: "status unavailable" });
  }
}
