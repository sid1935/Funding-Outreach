// Read-only: shows what the contact finder would find for already-known startups (addresses masked). Writes nothing.
import { supabase } from "./clients.js";
import { research } from "./draft.js";
import { maskEmail } from "./contacts.js";

const { data } = await supabase.from("startups").select("name,domain,description").order("id", { ascending: false }).limit(21);
for (const s of data) {
  const r = await research({ ...s, founders: [] });
  console.log(`${s.name.padEnd(24)} site:${r.domain ? "yes" : "no "}  founders:${(r.founders || []).map((f) => f.name).join(", ") || "-"}  contact:${r.contact ? `${maskEmail(r.contact.email)} (${r.contact.type})` : "none"}`);
}
process.exit(0);
