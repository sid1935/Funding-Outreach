import { supabase, DRY_RUN } from "./clients.js";
import { fetchArticles } from "./sources.js";
import { extractStartup, nameKey } from "./extract.js";
import { loadThesis, scoreFit } from "./score.js";
import { research, draftEmail } from "./draft.js";
import { createDraft } from "./gmail.js";

const stats = { articles: 0, new_articles: 0, funding: 0, duplicates: 0, rejected: 0, drafted: 0, errors: 0 };

// Claim a startup before doing any work. The unique constraints on name_key/domain make this
// atomic: if a startup was already handled (or another run is on it), we skip.
async function claim(s) {
  const row = {
    name: s.name, name_key: nameKey(s.name), domain: s.domain, round_type: s.round_type,
    amount_usd: s.amount_usd, announced_at: s.announced_at, source_url: s.source_url, description: s.description,
  };
  const { data, error } = await supabase.from("startups").insert(row).select("id").single();
  if (!error) return data.id;
  if (error.code !== "23505") throw error;
  // Already known. Retry only if its earlier attempt errored out.
  const { data: ex } = await supabase.from("startups").select("id,status")
    .or(`name_key.eq.${row.name_key}${row.domain ? `,domain.eq.${row.domain}` : ""}`).limit(1).single();
  if (ex?.status === "error") {
    await supabase.from("startups").update({ status: "processing", error: null }).eq("id", ex.id);
    return ex.id;
  }
  return null;
}

async function processStartup(s, thesis) {
  const id = await claim(s);
  if (!id) { stats.duplicates++; console.log(`  skip (already seen): ${s.name}`); return; }
  try {
    const { siteText, email, domain } = await research(s); // research first so scoring sees the company's own site
    if (domain && !s.domain) await supabase.from("startups").update({ domain }).eq("id", id); // remember it; a unique conflict is harmless
    const fit = await scoreFit(s, thesis, siteText);
    // Kept in its own update so a missing column can never block the status change.
    if (!DRY_RUN) await supabase.from("startups").update({ fit_score: fit.score, fit_rationale: fit.rationale }).eq("id", id);
    if (!DRY_RUN) await supabase.from("startups").update({ fit_breakdown: fit.breakdown }).eq("id", id);
    if (!fit.fits) {
      if (DRY_RUN) await supabase.from("startups").delete().eq("id", id); // dry run leaves no trace
      else await supabase.from("startups").update({ status: "rejected" }).eq("id", id);
      stats.rejected++;
      console.log(`  no fit (${fit.score}): ${s.name}`);
      return;
    }
    const mail = await draftEmail(s, thesis, fit, siteText);
    if (DRY_RUN) {
      console.log(`\n--- DRY RUN draft for ${s.name} (score ${fit.score}) ---\nTo: ${email ?? "(none)"}\nSubject: ${mail.subject}\n\n${mail.body}\n`);
      await supabase.from("startups").delete().eq("id", id); // leave no trace so a real run can process it
      return;
    }
    const draftId = await createDraft({ to: email, subject: mail.subject, body: mail.body });
    await supabase.from("outreach").insert({
      startup_id: id, fit_score: fit.score, rationale: fit.rationale, thesis_version: thesis.version,
      to_email: email, subject: mail.subject, body: mail.body, gmail_draft_id: draftId,
    });
    await supabase.from("startups").update({ status: "drafted" }).eq("id", id);
    stats.drafted++;
    console.log(`  DRAFTED (${fit.score}): ${s.name}`);
  } catch (e) {
    stats.errors++;
    await supabase.from("startups").update({ status: "error", error: String(e.message).slice(0, 500) }).eq("id", id);
    console.error(`  error on ${s.name}: ${e.message}`);
  }
}

// deadlineMs: stop starting new work after this many ms (serverless time limits). Unprocessed
// articles are not marked seen, so the next run picks them up.
export async function runPipeline({ deadlineMs = Infinity, concurrency = 4 } = {}) {
  const startedAt = Date.now();
  for (const k of Object.keys(stats)) stats[k] = 0;
  const { data: run } = await supabase.from("runs").insert({}).select("id").single();
  let fatal = null;
  try {
    const thesis = await loadThesis();
    console.log(`Thesis v${thesis.version}, min score ${thesis.min_score}${DRY_RUN ? " [DRY RUN]" : ""}`);

    const articles = await fetchArticles();
    stats.articles = articles.length;
    const { data: seen } = await supabase.from("seen_articles").select("url").in("url", articles.map((a) => a.url));
    const seenSet = new Set((seen ?? []).map((r) => r.url));
    const fresh = articles.filter((a) => !seenSet.has(a.url));
    stats.new_articles = fresh.length;
    console.log(`${articles.length} recent funding-ish articles, ${fresh.length} not yet seen`);

    let next = 0;
    const worker = async () => {
      while (next < fresh.length && Date.now() - startedAt < deadlineMs) {
        const a = fresh[next++];
        let s = null;
        try { s = await extractStartup(a); } catch (e) { stats.errors++; console.error(`  extract failed: ${e.message}`); continue; }
        if (!DRY_RUN) await supabase.from("seen_articles").upsert({ url: a.url });
        if (!s) continue;
        stats.funding++;
        await processStartup(s, thesis);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    if (next < fresh.length) console.log(`Time budget hit: ${fresh.length - next} articles left for the next run`);
  } catch (e) {
    fatal = e;
    console.error("Run failed:", e.message);
  }
  await supabase.from("runs").update({ finished_at: new Date().toISOString(), stats, error: fatal?.message ?? null }).eq("id", run.id);
  console.log("Done:", stats);
  return { stats: { ...stats }, error: fatal?.message ?? null };
}

// Run directly (npm start / GitHub Actions); skipped when imported by the Vercel function.
import { pathToFileURL } from "url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { error } = await runPipeline();
  process.exit(error ? 1 : 0); // open keep-alive sockets would otherwise hold the process open
}
