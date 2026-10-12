import { ai, MODEL } from "./clients.js";
import { normalizeDomain } from "./extract.js";

// SOP step 2: find a founder's OWN personal website (not a social profile or data broker) and read the contact
// address they publish there. An address is only accepted when the page clearly belongs to that person: it must
// name them AND mention their startup. Nothing is guessed, and no social or lookup sites are used.
const BLOCKED = /(^|\.)(linkedin|twitter|x|facebook|instagram|github|gitlab|youtube|tiktok|medium|substack|wikipedia|crunchbase|pitchbook|zoominfo|rocketreach|apollo|signalhire|contactout|lusha|hunter|techcrunch|forbes|bloomberg|reuters|yourstory|inc42|entrackr|angel|wellfound|producthunt|ycombinator|google|bing|duckduckgo)\./i;
const NOT_PERSONAL = /^(support|help|careers?|jobs|hr|privacy|legal|abuse|security|billing|accounts?|noreply|no-reply|donotreply|admin|webmaster|postmaster|unsubscribe)$/i;
const PATHS = ["", "/contact", "/about", "/me"];
const strip = (h) => h.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");

async function get(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 funding-outreach" }, redirect: "follow" });
    if (!r.ok || !/html|text/.test(r.headers.get("content-type") || "")) return null;
    return (await r.text()).slice(0, 300_000);
  } catch {
    return null;
  }
}

// Google Search (via Gemini grounding) for the person's own site. Returns a URL or null.
async function findSite(founder, startup, domain) {
  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: `Find the PERSONAL website (their own domain, portfolio or blog) of ${founder.name}${founder.role ? `, ${founder.role}` : ""} of the startup ${startup.name} (${domain}).
It must NOT be LinkedIn, X/Twitter, GitHub, a news article, a company page or a data-broker page.
Reply with ONLY the URL, or NONE if you cannot find one.`,
      config: { tools: [{ googleSearch: {} }], temperature: 0 },
    });
    const m = res.text.match(/https?:\/\/[^\s)"'<>]+/);
    if (!m) return null;
    const u = new URL(m[0]);
    const host = u.hostname.replace(/^www\./, "");
    if (BLOCKED.test(host + ".") || normalizeDomain(host) === normalizeDomain(domain)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function pickEmail(html, founder) {
  const text = html.replace(/&#64;|&commat;|\[at\]|\(at\)/gi, "@").replace(/&#46;|\[dot\]|\(dot\)/gi, ".");
  const mailto = [...text.matchAll(/mailto:([a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)].map((m) => m[1].toLowerCase());
  const plain = [...text.matchAll(/[a-z0-9._%+-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)].map((m) => m[0].toLowerCase());
  const ok = (e) => !NOT_PERSONAL.test(e.split("@")[0]) && !/\.(png|jpe?g|gif|svg|webp)$/.test(e) && !/example\.|sentry|wixpress/.test(e);
  const first = norm(founder.name.split(/\s+/)[0]), last = norm(founder.name.split(/\s+/).at(-1));
  const all = [...new Set([...mailto, ...plain])].filter(ok);
  const related = all.find((e) => { const l = norm(e.split("@")[0]); return (first && l.includes(first)) || (last && l.includes(last)); });
  return related || mailto.filter(ok)[0] || null; // a name-matching address, else the one they link as "email me"
}

// Returns { email, source } or null.
export async function personalSiteEmail(founder, startup, domain) {
  const site = await findSite(founder, startup, domain);
  if (!site) return null;
  const pages = (await Promise.all(PATHS.map(async (p) => ({ url: site + p, html: await get(site + p) })))).filter((p) => p.html);
  if (!pages.length) return null;

  // The page must be about this person AND this startup, otherwise it could be someone with the same name.
  const all = pages.map((p) => strip(p.html).toLowerCase()).join(" ");
  const first = founder.name.split(/\s+/)[0].toLowerCase(), last = founder.name.split(/\s+/).at(-1).toLowerCase();
  const company = startup.name.toLowerCase().split(/\s+/)[0];
  if (!(all.includes(last) && all.includes(first) && (all.includes(company) || all.includes(domain.replace(/^www\./, ""))))) return null;

  for (const p of pages) {
    const email = pickEmail(p.html, founder);
    if (email) return { email, source: `personal website · ${p.url}` };
  }
  return null;
}

// When nobody is named yet, ask Google (via Gemini grounding) who founded the startup. These names are used only to
// look for a personal site; they are saved only if that site verifies, so a wrong guess can never reach an email.
export async function searchFounders(startup, domain) {
  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: `Who are the founders (or the CEO) of the startup ${startup.name} (${domain})? Context: ${startup.description}
Reply with one person per line as: Full Name | Role. Only people you are confident about. If unsure reply NONE.`,
      config: { tools: [{ googleSearch: {} }], temperature: 0 },
    });
    return res.text.split("\n").map((l) => l.replace(/^[-*\d.\s]+/, "").split("|")).map(([n, r]) => ({ name: (n || "").trim(), role: (r || "").trim() || undefined }))
      .filter((f) => /^[A-Z][\p{L}.'-]+(\s+[A-Z][\p{L}.'-]+){1,3}$/u.test(f.name)).slice(0, 2);
  } catch {
    return [];
  }
}
