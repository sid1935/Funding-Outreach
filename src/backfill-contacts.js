// One-off: find founders and a public contact address for startups already in the database, store them, and
// add the address as the recipient of any still-pending Gmail drafts. Never sends anything.
// Run after the contact columns exist: node src/backfill-contacts.js
import { supabase } from "./clients.js";
import { research } from "./draft.js";
import { updateDraft } from "./gmail.js";

const { data: rows, error } = await supabase.from("startups").select("id,name,domain,description,founders,contact_email,outreach(id,status,subject,body,gmail_draft_id,to_email)");
if (error) throw new Error(error.message + " (did you run the ALTER TABLE SQL?)");

let found = 0;
for (const s of rows) {
  if (s.contact_email) continue; // already done
  const known = Array.isArray(s.founders) ? s.founders : [];
  const r = await research({ ...s, founders: known });
  await supabase.from("startups").update({
    founders: r.founders, contact_email: r.contact?.email ?? null, contact_type: r.contact?.type ?? null, contact_source: r.contact?.source ?? null,
    ...(r.domain && !s.domain ? { domain: r.domain } : {}),
  }).eq("id", s.id);
  if (r.contact) found++;

  const o = Array.isArray(s.outreach) ? s.outreach[0] : s.outreach;
  if (r.contact && o && o.status === "pending" && !o.to_email) {
    await supabase.from("outreach").update({ to_email: r.contact.email }).eq("id", o.id);
    if (o.gmail_draft_id) await updateDraft({ draftId: o.gmail_draft_id, to: r.contact.email, subject: o.subject, body: o.body }).catch((e) => console.warn("  draft not updated:", e.message));
  }
  console.log(`${s.name}: ${r.founders.length} founders, contact ${r.contact ? r.contact.type : "none"}`);
}
console.log(`Done. Contact found for ${found} startups.`);
process.exit(0);
