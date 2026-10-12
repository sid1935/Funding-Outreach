import { Type } from "@google/genai";
import { geminiJson } from "./clients.js";
import { INDUSTRIES, normalizeIndustry } from "./industries.js";

const schema = {
  type: Type.OBJECT,
  properties: {
    is_funding_announcement: { type: Type.BOOLEAN },
    company_name: { type: Type.STRING },
    domain: { type: Type.STRING, description: "Company website domain, e.g. acme.com. Empty if unknown." },
    round_type: { type: Type.STRING, description: "pre-seed, seed, series-a, other, or unknown" },
    amount_usd: { type: Type.NUMBER, description: "Approx USD amount, 0 if unknown" },
    country: { type: Type.STRING },
    description: { type: Type.STRING, description: "One or two sentences on what the company builds" },
    industry: { type: Type.STRING, enum: INDUSTRIES, description: "The single best-fitting industry for what the company builds" },
    investors: { type: Type.ARRAY, items: { type: Type.STRING } },
    founders: { type: Type.ARRAY, description: "Founders or CEO named in the article, if any", items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, role: { type: Type.STRING } }, required: ["name"] } },
  },
  required: ["is_funding_announcement", "company_name", "round_type", "description"],
};

// Turns a news item into structured data. Returns null if it is not a seed/pre-seed announcement.
export async function extractStartup(article) {
  const out = await geminiJson(
    `Extract funding-announcement data from this news item. The company must be the one that RAISED money
(not the investor). Set is_funding_announcement=false for anything that is not a company announcing a
funding round (opinion pieces, roundups, acquisitions, IPOs). Only fill domain if it is stated or obvious.

Title: ${article.title}
Text: ${article.text}
URL: ${article.url}`,
    schema
  );
  const round = (out.round_type || "").toLowerCase().replace(/[\s_]/g, "-");
  if (!out.is_funding_announcement || !out.company_name) return null;
  if (round !== "seed" && round !== "pre-seed") return null;
  return {
    name: out.company_name.trim(),
    domain: normalizeDomain(out.domain),
    round_type: round,
    amount_usd: out.amount_usd || null,
    country: out.country || null,
    description: out.description,
    industry: normalizeIndustry(out.industry),
    investors: out.investors || [],
    founders: (out.founders || []).filter((f) => f.name).slice(0, 4),
    source_url: article.url,
    announced_at: article.publishedAt,
  };
}

export function normalizeDomain(d) {
  if (!d) return null;
  const host = d.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

// A company shows up in the news as "Loops", "Loops AI" and "Loops Smart AI". Trailing filler words are dropped so
// those collapse to one key and the startup is not processed (or drafted) twice.
const FILLER = new Set(["ai", "ag", "smart", "capital", "labs", "lab", "inc", "llc", "ltd", "gmbh", "pvt", "private", "limited", "technologies", "technology", "tech", "group", "holdings", "hq", "io", "app"]);
export const nameKey = (n) => {
  const words = n.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  while (words.length > 1 && FILLER.has(words.at(-1))) words.pop();   // keep at least one word
  return words.join("");
};
