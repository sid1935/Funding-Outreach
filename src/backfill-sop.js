// One-off: run the contact SOP (waterfall.js) for startups already drafted and still awaiting approval, best score
// first. Updates the database and the To field of the pending Gmail draft. Never sends anything.
//   node src/backfill-sop.js           (HUNTER_MAX caps Hunter credits, default 5)
import { supabase } from "./clients.js";
import { research } from "./draft.js";
import { resolveContact } from "./waterfall.js";
import { updateDraft } from "./gmail.js";

const { data: rows, error } = await supabase.from("startups")
  .select("id,name,domain,status,fit_score,founders,contact_email,contact_type,contact_source,description,outreach(id,status,subject,body,gmail_draft_id)")
  .eq("status", "drafted").order("fit_score", { ascending: false, nullsFirst: false });
if (error) throw new Error(error.message);

let hunterLeft = Number(process.env.HUNTER_MAX || 5);
const tally = {};
for (const s of rows) {
  const o = Array.isArray(s.outreach) ? s.outreach[0] : s.outreach;
  if (!o || o.status !== "pending" || (s.contact_type === "founder" && s.contact_email)) continue;
  const triedHunter = String(s.contact_source || "").startsWith("hunter.io: nothing");
  const r = await research({ ...s, founders: Array.isArray(s.founders) ? s.founders : [] });
  const { contact, founders } = await resolveContact({
    startup: s, domain: r.domain || s.domain, founders: r.founders, siteContact: r.contact,
    canUseHunter: () => !triedHunter && hunterLeft-- > 0, log: (m) => console.warn(`  ${s.name}: ${m}`),
  });
  const key = contact ? contact.method : "none";
  tally[key] = (tally[key] || 0) + 1;
  await supabase.from("startups").update({ founders, contact_email: contact?.email ?? null, contact_type: contact?.type ?? null, contact_source: contact?.source ?? "no address found" }).eq("id", s.id);
  if (contact) {
    await supabase.from("outreach").update({ to_email: contact.email }).eq("id", o.id);
    if (o.gmail_draft_id) await updateDraft({ draftId: o.gmail_draft_id, to: contact.email, subject: o.subject, body: o.body }).catch((e) => console.warn("  draft not updated:", e.message));
  }
  console.log(`${s.name.padEnd(14)} ${fmt(contact)}`);
}
function fmt(c) { return c ? `${c.method.padEnd(9)} ${c.type}` : "none"; }
console.log("Summary:", tally);
process.exit(0);
