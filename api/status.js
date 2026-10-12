import { supabase } from "../src/clients.js";

// Read-only public data feed for the dashboard pages. Never exposes secrets or recipient emails.
const REPO = "https://github.com/sid1935/Funding-Outreach";
const STARTUP_COLS =
  "id,name,domain,round_type,amount_usd,announced_at,source_url,description,status,fit_score,fit_rationale,fit_breakdown,founders,created_at,outreach(id,status,decided_at,sent_to,fit_score,subject,body,rationale,thesis_version,created_at)";

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
      // No email addresses in the public API (they live in Supabase and in each Gmail draft's To field). Founder names and roles only.
      const hide = (o) => { if (!o) return o; const { sent_to, ...rest } = o; return { ...rest, sent: !!sent_to }; };
      const names = (list) => (Array.isArray(list) ? list.map(({ name, role }) => ({ name, role })) : list);
      out = { startups: ((await q).data ?? []).map(({ outreach, founders, ...x }) => ({
        ...x, founders: names(founders), outreach: Array.isArray(outreach) ? outreach.map(hide) : hide(outreach),
      })) };
    } else if (view === "startup") {
      // One startup with everything the dashboard knows about it. Same privacy rules: no email addresses.
      const id = Number(req.query.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
      const { data } = await supabase.from("startups").select(STARTUP_COLS).eq("id", id).maybeSingle();
      if (!data) return res.status(404).json({ error: "not found" });
      const { outreach, founders, ...x } = data;
      const o = Array.isArray(outreach) ? outreach[0] : outreach;
      const { sent_to, ...draft } = o || {};
      out = { startup: { ...x, founders: Array.isArray(founders) ? founders.map(({ name, role }) => ({ name, role })) : [], outreach: o ? { ...draft, sent: !!sent_to } : null } };
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
