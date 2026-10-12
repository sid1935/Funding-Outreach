import { personalSiteEmail, searchFounders } from "./personal-site.js";
import { hunterEnabled, hunterContact } from "./hunter.js";

// Contact SOP, run only for startups that pass the thesis score. First hit wins:
//   1. a founder's address on the company's own contact / team pages
//   2. the founder's personal website, found through Google search
//   3. Hunter
//   4. fallback: a general company inbox from the company website
// `siteContact` is what the company-site scan already found (type "founder" or "generic").
// Returns { contact: { email, type, source, method } | null, founders }.
export async function resolveContact({ startup, domain, founders, siteContact, canUseHunter, log = () => {} }) {
  // 1) founder address on the company site
  if (siteContact?.type === "founder") {
    return { contact: { ...siteContact, source: `company website · ${siteContact.source}`, method: "site" }, founders };
  }

  // 2) the founder's personal website
  if (domain) {
    const searched = founders.length ? [] : await searchFounders(startup, domain);
    const people = (founders.length ? founders : searched).slice(0, 2);
    const found = await Promise.all(people.map((f) => personalSiteEmail(f, startup, domain).then((p) => p && { p, f }).catch((e) => { log(`personal-site lookup failed for ${f.name}: ${e.message}`); return null; })));
    const hit = found.find(Boolean);
    if (hit) return { contact: { email: hit.p.email, type: "founder", source: `${hit.p.source} · ${hit.f.name}`, method: "personal" }, founders: founders.length ? founders : [hit.f] };
  }

  // 3) Hunter
  if (hunterEnabled() && domain && canUseHunter()) {
    try {
      const h = await hunterContact({ domain, founders });
      if (h) return { contact: { email: h.email, type: h.type, source: h.source, method: "hunter" }, founders: h.founders };
    } catch (e) { log(`hunter lookup failed: ${e.message}`); }
  }

  // 4) general company inbox
  if (siteContact?.type === "generic") {
    return { contact: { ...siteContact, source: `company inbox (fallback) · ${siteContact.source}`, method: "fallback" }, founders };
  }
  return { contact: null, founders };
}
