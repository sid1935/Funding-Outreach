// Contact lookup through Hunter (hunter.io), using the owner's own API key (HUNTER_API_KEY).
// Hunter is a licensed data provider; results are stored server-side only and never shown on the public site.
// Endpoints used: /account (credits), /email-finder (a named founder), /domain-search (when no names are known).
const BASE = "https://api.hunter.io/v2";
const MIN_CONFIDENCE = Number(process.env.HUNTER_MIN_CONFIDENCE || 70);
const SENIOR = /founder|ceo|chief|owner|president|managing director|cto|coo|head/i;

export const hunterEnabled = () => !!process.env.HUNTER_API_KEY;

async function call(path, params = {}) {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers: { "X-API-KEY": process.env.HUNTER_API_KEY }, signal: AbortSignal.timeout(20000) });
  if (r.status === 429 || r.status === 402) { const e = new Error("Hunter credits or rate limit exhausted"); e.quota = true; throw e; }
  if (r.status === 401) throw new Error("Hunter rejected the API key");
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Hunter ${path} returned ${r.status}`);
  return (await r.json()).data ?? null;
}

// Remaining monthly searches, so bulk jobs can stop before running dry.
export async function hunterCredits() {
  const d = await call("/account");
  const s = d?.requests?.searches ?? d?.requests?.credits;
  return s ? { used: s.used, available: s.available, plan: d.plan_name } : null;
}

const ok = (v) => v && v.status !== "invalid";

// Returns { email, type: "founder", source, founders } or null. Costs up to one credit per founder, or one for a domain search.
export async function hunterContact({ domain, founders = [] }) {
  if (!hunterEnabled() || !domain) return null;

  // 1) Named founders: ask Hunter for each person's address.
  for (const f of [...founders].sort((a, b) => (SENIOR.test(b.role || "") ? 1 : 0) - (SENIOR.test(a.role || "") ? 1 : 0)).slice(0, 2)) {
    const parts = f.name.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const d = await call("/email-finder", { domain, first_name: parts[0], last_name: parts.at(-1) });
    if (d?.email && (d.score ?? 0) >= MIN_CONFIDENCE && ok(d.verification)) {
      return { email: d.email.toLowerCase(), type: "founder", source: `hunter.io · ${f.name} · ${d.score}% confidence`, founders };
    }
  }

  // 2) No usable names: look at the domain's senior people.
  const d = await call("/domain-search", { domain, limit: 10, type: "personal", seniority: "senior,executive" });
  const list = (d?.emails || []).filter((e) => (e.confidence ?? 0) >= MIN_CONFIDENCE && ok(e.verification));
  list.sort((a, b) => (SENIOR.test(b.position || "") ? 1 : 0) - (SENIOR.test(a.position || "") ? 1 : 0) || (b.confidence ?? 0) - (a.confidence ?? 0));
  const best = list[0];
  if (!best) return null;
  const name = [best.first_name, best.last_name].filter(Boolean).join(" ");
  return {
    email: best.value.toLowerCase(), type: "founder",
    source: `hunter.io · ${name || "senior contact"}${best.position ? ` (${best.position})` : ""} · ${best.confidence}% confidence`,
    founders: founders.length || !name ? founders : [{ name, role: best.position || undefined }],
  };
}
