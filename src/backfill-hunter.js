// One-off: look up founder contacts through Hunter for startups already stored, best-scoring first, and add the
// address to any still-pending Gmail drafts (never sends). Spends Hunter credits, so it is capped.
//   node src/backfill-hunter.js            -> up to HUNTER_MAX (default 10) startups
//   HUNTER_MAX=25 node src/backfill-hunter.js
import { supabase } from "./clients.js";
import { hunterContact, hunterCredits, hunterEnabled } from "./hunter.js";
import { updateDraft } from "./gmail.js";

if (!hunterEnabled()) throw new Error("HUNTER_API_KEY is not set in .env");
const credits = await hunterCredits().catch((e) => { throw new Error("Hunter check failed: " + e.message); });
console.log("Hunter account:", credits ? `${credits.plan}, ${credits.available - credits.used} searches left of ${credits.available}` : "credits unknown");

const max = Math.min(Number(process.env.HUNTER_MAX || 10), credits ? credits.available - credits.used : 999);
const { data: rows, error } = await supabase.from("startups")
  .select("id,name,domain,status,fit_score,founders,contact_email,contact_type,contact_source,outreach(id,status,subject,body,gmail_draft_id,to_email)")
  .not("domain", "is", null).order("fit_score", { ascending: false, nullsFirst: false });
if (error) throw new Error(error.message);

// Only startups worth contacting (drafted) that still lack a founder address and were not already looked up.
const todo = rows.filter((s) => s.status === "drafted" && s.contact_type !== "founder" && !String(s.contact_source || "").startsWith("hunter.io: nothing")).slice(0, max);
console.log(`Looking up ${todo.length} startups (cap ${max}).`);

let found = 0;
for (const s of todo) {
  try {
    const h = await hunterContact({ domain: s.domain, founders: Array.isArray(s.founders) ? s.founders : [] });
    await supabase.from("startups").update({
      contact_email: h?.email ?? s.contact_email ?? null, contact_type: h ? h.type : s.contact_type ?? null,
      contact_source: h ? h.source : "hunter.io: nothing found", ...(h ? { founders: h.founders } : {}),
    }).eq("id", s.id);
    if (!h) { console.log(`${s.name}: nothing found`); continue; }
    found++;
    const o = Array.isArray(s.outreach) ? s.outreach[0] : s.outreach;
    if (o && o.status === "pending") {
      await supabase.from("outreach").update({ to_email: h.email }).eq("id", o.id);
      if (o.gmail_draft_id) await updateDraft({ draftId: o.gmail_draft_id, to: h.email, subject: o.subject, body: o.body }).catch((e) => console.warn("  draft not updated:", e.message));
    }
    console.log(`${s.name}: found (${h.source.split(" · ").pop()})`);
  } catch (e) {
    console.warn(`${s.name}: ${e.message}`);
    if (e.quota) break;
  }
}
console.log(`Done. Found ${found} of ${todo.length}.`);
process.exit(0);
