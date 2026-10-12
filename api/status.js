import { supabase } from "../src/clients.js";
import { maskEmail } from "../src/contacts.js";

// Read-only public data feed for the dashboard pages. Never exposes secrets or recipient emails.
const REPO = "https://github.com/sid1935/Funding-Outreach";
const STARTUP_COLS =
  "id,name,domain,round_type,amount_usd,announced_at,source_url,description,status,fit_score,fit_rationale,fit_breakdown,founders,contact_email,contact_type,contact_source,created_at,outreach(id,status,decided_at,sent_to,fit_score,subject,body,rationale,thesis_version,created_at)";

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
      let q = supabase.from("startups").select(STARTUP_COLS).order("fit_score", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).limit(200);
      if (status) q = q.eq("status", status);
      // The full address stays server-side (database and the Gmail draft); the public page gets a masked version.
      const hide = (o) => (o ? { ...o, sent_to: maskEmail(o.sent_to) } : o); // the "sent to" address is personal too
      out = { startups: ((await q).data ?? []).map(({ contact_email, outreach, ...x }) => ({
        ...x, contact_masked: maskEmail(contact_email), outreach: Array.isArray(outreach) ? outreach.map(hide) : hide(outreach),
      })) };
    } else if (view === "thesis") {
      const { data } = await supabase
        .from("thesis")
        .select("version,description,stages,sectors,geographies,exclusions,min_score,pitch,sender_name,sender_org,rubric,updated_at")
        .eq("active", true)
        .single();
      out = { thesis: data };
    } else if (view === "mode") {
      out = { mode: process.env.SEND_MODE === "live" ? "live" : "test" };
    } else if (view === "sources") {
      const { data, error } = await supabase.from("sources").select("*").order("kind").order("name");
      out = { sources: error ? [] : data ?? [] };
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
    // Decisions must show immediately after a click, so the dashboard data is never served stale.
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(out);
  } catch {
    res.status(500).json({ error: "status unavailable" });
  }
}
