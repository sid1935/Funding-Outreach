import { Type } from "@google/genai";
import { geminiJson } from "./clients.js";

// Finds a contact address for a startup using ONLY what the company itself publishes on its own website
// (homepage, contact, about and team pages). It never guesses addresses from name patterns and never
// uses third-party lookups or data brokers.
const PAGES = ["", "/contact", "/contact-us", "/about", "/about-us", "/team", "/company", "/press"];
const GENERIC = new Set(["hello", "hi", "hey", "contact", "info", "team", "founders", "founder", "partnerships", "partners", "business", "ceo", "enquiries", "inquiries"]);
const NOT_FOR_OUTREACH = /^(support|help|careers?|jobs|hr|recruit\w*|privacy|legal|abuse|security|billing|accounts?|noreply|no-reply|donotreply|admin|webmaster|postmaster|unsubscribe)$/i;
const strip = (h) => h.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function get(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 funding-outreach" }, redirect: "follow" });
    if (!r.ok || !/html|text/.test(r.headers.get("content-type") || "")) return null;
    return (await r.text()).slice(0, 400_000);
  } catch {
    return null;
  }
}

const rootOf = (d) => d.split(".").slice(-2).join(".");

function emailsIn(html, domain) {
  const found = new Set();
  const decoded = html.replace(/&#64;|&commat;|\[at\]|\(at\)/gi, "@").replace(/&#46;|\[dot\]|\(dot\)/gi, ".");
  for (const m of decoded.matchAll(/[a-z0-9._%+-]{1,64}@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
    const email = m[0].toLowerCase();
    const host = m[1].toLowerCase();
    if (rootOf(host) === rootOf(domain) && !/\.(png|jpe?g|gif|svg|webp)$/.test(email)) found.add(email);
  }
  return [...found];
}

const founderSchema = {
  type: Type.OBJECT,
  properties: { founders: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, role: { type: Type.STRING } }, required: ["name"] } } },
  required: ["founders"],
};

// Names of founders / CEO from the company's own team or about text. Empty if the page does not say.
async function founderNames(startup, text) {
  if (!text) return [];
  try {
    const out = await geminiJson(
      `From this text from ${startup.name}'s own website, list ONLY its founders, co-founders and CEO, with role. Use only names that appear in the text. If none, return an empty list.\n\n${text.slice(0, 6000)}`,
      founderSchema, { temperature: 0 });
    return (out.founders || []).filter((f) => f.name && f.name.split(/\s+/).length <= 4).slice(0, 4);
  } catch {
    return [];
  }
}

// LinkedIn profile links that the company ITSELF publishes on its own pages (usually under each founder on the
// team page). We only read the link; nothing is fetched from LinkedIn.
function linkedinFor(founder, htmls) {
  const parts = founder.name.trim().split(/\s+/).map((p) => p.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")).filter(Boolean);
  const first = parts[0], last = parts.at(-1);
  let best = null, bestScore = 0;
  for (const html of htmls) {
    for (const m of html.matchAll(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^"'\s<>)?#\\]+/gi)) {
      const url = m[0].replace(/\/+$/, "");
      const slug = url.split("/in/")[1].toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
      let score = 0;
      if (last && slug.includes(last)) score += 2;
      if (first && slug.includes(first)) score += 2;
      const before = html.slice(Math.max(0, m.index - 600), m.index).toLowerCase();
      if (founder.name.toLowerCase().split(/\s+/).every((p) => before.includes(p))) score += 1; // name sits just before the link
      if (score > bestScore) { best = url; bestScore = score; }
    }
  }
  return bestScore >= 2 ? best : null;
}

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");

// Does this address plausibly belong to one of the named founders? (e.g. priya@, priya.shah@, pshah@)
function matchesFounder(local, founders) {
  const l = norm(local);
  return founders.some((f) => {
    const parts = f.name.trim().split(/\s+/).map(norm).filter(Boolean);
    const first = parts[0], last = parts[parts.length - 1];
    return l === first || l === parts.join("") || (last && (l === first[0] + last || l === first + last[0] || l === last || l.startsWith(first) && last && l.includes(last)));
  });
}

// Returns { email, type: "founder" | "generic" | null, source, founders, text }
export async function findContacts(startup, domain, knownFounders = []) {
  if (!domain) return { email: null, type: null, source: null, founders: knownFounders, text: "" };
  const base = `https://${domain}`;
  const pages = await Promise.all(PAGES.map(async (p) => ({ url: base + p, html: await get(base + p) })));
  const ok = pages.filter((p) => p.html);
  const text = ok.map((p) => strip(p.html)).join(" ").slice(0, 12000);

  let founders = knownFounders;
  const teamText = ok.filter((p) => /about|team|company/.test(p.url)).map((p) => strip(p.html)).join(" ");
  if (!founders.length) founders = await founderNames(startup, teamText || text);

  founders = founders.map((f) => { const li = f.linkedin || linkedinFor(f, ok.map((p) => p.html)); return li ? { ...f, linkedin: li } : f; });

  // candidates with where they were seen
  const cands = new Map();
  for (const p of ok) for (const e of emailsIn(p.html, domain)) if (!cands.has(e)) cands.set(e, p.url);

  let best = null;
  for (const [email, src] of cands) {
    const local = email.split("@")[0];
    if (NOT_FOR_OUTREACH.test(local)) continue;
    if (matchesFounder(local, founders)) { best = { email, type: "founder", source: src }; break; }
  }
  if (!best) {
    // otherwise a generic inbox the company published for exactly this purpose
    const order = ["founders", "founder", "hello", "hi", "hey", "contact", "team", "partnerships", "info"];
    const generics = [...cands].filter(([e]) => GENERIC.has(e.split("@")[0]));
    generics.sort((a, b) => order.indexOf(a[0].split("@")[0]) - order.indexOf(b[0].split("@")[0]));
    if (generics[0]) best = { email: generics[0][0], type: "generic", source: generics[0][1] };
  }
  return { email: best?.email ?? null, type: best?.type ?? null, source: best?.source ?? null, founders, text: text.slice(0, 3500) };
}

// Public view: keep just enough to recognise it, never the whole personal address.
export const maskEmail = (e) => {
  if (!e || !e.includes("@")) return null;
  const [l, d] = e.split("@");
  return `${l.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(5, l.length - 1)))}@${d}`;
};
