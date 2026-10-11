// One-off: score startups that were evaluated before scores were stored (e.g. earlier rejects).
// Uses the stored description/domain, so no news fetch is needed. Run: node src/backfill-scores.js
import { supabase } from "./clients.js";
import { loadThesis, scoreFit } from "./score.js";
import { research } from "./draft.js";

const thesis = await loadThesis();
const { data: rows, error } = await supabase.from("startups").select("*").is("fit_score", null).in("status", ["rejected", "drafted"]);
if (error) throw new Error(error.message + " (did you run the ALTER TABLE SQL?)");

for (const r of rows) {
  const startup = { ...r, investors: [], country: null };
  const { siteText } = await research(startup);
  const fit = await scoreFit(startup, thesis, siteText);
  await supabase.from("startups").update({ fit_score: fit.score, fit_rationale: fit.rationale }).eq("id", r.id);
  await supabase.from("startups").update({ fit_breakdown: fit.breakdown }).eq("id", r.id);
  console.log(`${r.name}: ${fit.score}`);
}
console.log(`Backfilled ${rows.length} startups`);
process.exit(0);
