import { Type } from "@google/genai";
import { geminiJson, ai, MODEL } from "./clients.js";
import { normalizeDomain } from "./extract.js";

const strip = (h) =>
  h.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// Articles often omit the company website. Ask Gemini (with Google Search) for it, then verify the page
// really mentions the company before trusting it.
async function findDomain(startup) {
  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: `What is the official website domain of the startup "${startup.name}"? Context: ${startup.description}
Reply with ONLY the bare domain (like example.com), or NONE if you are not sure.`,
      config: { tools: [{ googleSearch: {} }], temperature: 0 },
    });
    return normalizeDomain(res.text.trim().split(/\s/)[0]);
  } catch {
    return null;
  }
}

// Light research: pull the startup's own homepage text and any public contact email.
export async function research(startup) {
  let domain = startup.domain;
  if (!domain) domain = await findDomain(startup);
  if (!domain) return { siteText: "", email: null, domain: null };
  try {
    const res = await fetch(`https://${domain}`, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 funding-outreach" },
    });
    const html = await res.text();
    const mail = html.match(/mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i)?.[1] ?? null;
    const siteText = strip(html).slice(0, 3500);
    const first = startup.name.toLowerCase().split(/\s+/)[0];
    if (!startup.domain && !html.toLowerCase().includes(first)) return { siteText: "", email: null, domain: null };
    return { siteText, email: mail, domain };
  } catch {
    return { siteText: "", email: null, domain: null };
  }
}

const fmtUsd = (n) => !n ? "undisclosed" : n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;

const schema = {
  type: Type.OBJECT,
  properties: { subject: { type: Type.STRING }, body: { type: Type.STRING } },
  required: ["subject", "body"],
};

export async function draftEmail(startup, thesis, fit, siteText) {
  return geminiJson(
    `Write a short, warm, personalised cold email from ${thesis.sender_name} at ${thesis.sender_org} to the
founders of ${startup.name}, who just announced a ${startup.round_type} round.

Rules:
- Under 130 words, plain text, no hype, no emojis, no markdown.
- Open with something specific about what they build or the round. Congratulate briefly.
- Say in one sentence why they fit (from the fit note) and one sentence on what we offer.
- End with a low-pressure ask for a short call. Sign off as ${thesis.sender_name}.
- Use ONLY facts below. Never invent traction, names, numbers or mutual connections.
- Subject: under 8 words, about THEM (what they build or their round). Never include the accelerator's name
  or the startup's name followed by "and". Example style: "Congrats on the pre-seed for on-prem security AI".
- Format the body as 3 short paragraphs separated by a blank line (use \\n\\n): (1) congratulations plus one
  specific observation, (2) why they fit and what we offer, (3) the ask. Put the sign-off on its own line.
- Investors are separate companies. Never say the round was "with" an investor or imply the investor is the
  startup; if you mention them, say "led by X" or "backed by X", or leave them out.
- Don't mention that a "fit note" or scoring exists, and don't say "aligns with our target profile".

What we offer: ${thesis.pitch}
Fit note: ${fit.rationale}
Round: ${startup.round_type}, amount ${fmtUsd(startup.amount_usd)}; investors: ${startup.investors.join(", ") || "n/a"}
Article summary: ${startup.description}
Their website text: ${siteText || "(unavailable)"}`,
    schema,
    { model: process.env.GEMINI_DRAFT_MODEL || undefined }
  );
}
