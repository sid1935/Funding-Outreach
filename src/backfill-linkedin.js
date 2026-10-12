// One-off: add founders' LinkedIn links (only those the company publishes on its own site) to startups already stored.
// Reads the company's own pages; nothing is fetched from LinkedIn. Run: node src/backfill-linkedin.js
import { supabase } from "./clients.js";
import { findContacts } from "./contacts.js";

const { data: rows, error } = await supabase.from("startups").select("id,name,domain,description,founders,contact_email,contact_type,contact_source").not("domain", "is", null);
if (error) throw new Error(error.message);

let links = 0, newEmails = 0;
for (const s of rows) {
  const known = Array.isArray(s.founders) ? s.founders : [];
  const r = await findContacts(s, s.domain, known);
  const update = { founders: r.founders };
  if (!s.contact_email && r.email) { Object.assign(update, { contact_email: r.email, contact_type: r.type, contact_source: r.source }); newEmails++; }
  await supabase.from("startups").update(update).eq("id", s.id);
  const n = (r.founders || []).filter((f) => f.linkedin).length;
  links += n;
  console.log(`${s.name}: ${r.founders.length} founders, ${n} LinkedIn links${update.contact_email ? ", new contact found" : ""}`);
}
console.log(`Done. ${links} LinkedIn links, ${newEmails} new contact addresses.`);
process.exit(0);
