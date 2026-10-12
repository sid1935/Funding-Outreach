// Read-only: shows which SOP step would succeed for stored startups (addresses masked, nothing saved).
import { supabase } from "./clients.js";
import { research } from "./draft.js";
import { resolveContact } from "./waterfall.js";
const mask = (e) => { const [l, d] = e.split("@"); return l[0] + "•••@" + d; };
const { data } = await supabase.from("startups").select("name,domain,description,founders").eq("status", "drafted").limit(12);
for (const s of data) {
  const r = await research({ ...s, founders: s.founders || [] });
  const { contact } = await resolveContact({ startup: s, domain: r.domain || s.domain, founders: r.founders, siteContact: r.contact, canUseHunter: () => false });
  console.log(s.name.padEnd(14), contact ? `${contact.method.padEnd(9)} ${mask(contact.email)}  [${contact.source.slice(0, 70)}]` : "none");
}
process.exit(0);
