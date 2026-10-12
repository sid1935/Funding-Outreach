import { Type } from "@google/genai";
import { geminiJson, ai, MODEL } from "./clients.js";
import { normalizeDomain } from "./extract.js";
import { findContacts } from "./contacts.js";

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

// Light research: the company's own site text, plus a contact address and founder names found on it.
export async function research(startup) {
  let domain = startup.domain;
  if (!domain) domain = await findDomain(startup);
  const none = { siteText: "", email: null, domain: null, contact: null, founders: startup.founders || [] };
  if (!domain) return none;
  try {
    const res = await fetch(`https://${domain}`, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0 funding-outreach" } });
    const html = await res.text();
    const first = startup.name.toLowerCase().split(/\s+/)[0];
    if (!startup.domain && !html.toLowerCase().includes(first)) return none; // not the right company
    const c = await findContacts(startup, domain, startup.founders || []);
    return { siteText: strip(html).slice(0, 3500) || c.text, email: c.email, domain, contact: c.email ? { email: c.email, type: c.type, source: c.source } : null, founders: c.founders };
  } catch {
    return none;
  }
}

const fmtUsd = (n) => !n ? "undisclosed" : n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;

const schema = {
  type: Type.OBJECT,
  properties: { subject: { type: Type.STRING }, body: { type: Type.STRING } },
  required: ["subject", "body"],
};

// Every email has the same frame, added here rather than left to the model: a greeting on top and this sign-off at the
// bottom. Any greeting or sign-off the model wrote anyway is removed first so nothing appears twice.
const SIGNOFF_LINE = /^(best|best regards|kind regards|warm regards|regards|thanks|thank you|many thanks|sincerely|cheers|cordially)[,.!]*$/i;
export function frameBody(body, greeting, senderName) {
  let lines = String(body).replace(/\r/g, "").trim().split("\n");
  if (lines.length && /^(hi|hello|hey|dear)\b/i.test(lines[0].trim())) lines.shift();               // model's own greeting
  while (lines.length) {                                                                              // model's own sign-off
    const last = lines.at(-1).trim();
    if (!last || SIGNOFF_LINE.test(last) || last.toLowerCase() === String(senderName).toLowerCase()) lines.pop();
    else break;
  }
  const text = lines.join("\n").trim();
  return `${greeting}\n\n${text}\n\nThank you,\nWarm Regards,\n${senderName}`;
}

export function greetingFor(founders = []) {
  const names = founders.map((f) => f.name.split(/\s+/)[0]);
  return names.length === 1 ? `Hi ${names[0]},` : names.length === 2 ? `Hi ${names[0]} and ${names[1]},` : names.length > 2 ? `Hi ${names.slice(0, -1).join(", ")} and ${names.at(-1)},` : "Hi team,";
}

export async function draftEmail(startup, thesis, fit, siteText, founders = []) {
  const names = founders.map((f) => f.name.split(/\s+/)[0]);
  const greeting = names.length === 1 ? `Hi ${names[0]},` : names.length === 2 ? `Hi ${names[0]} and ${names[1]},` : names.length > 2 ? `Hi ${names.slice(0, -1).join(", ")} and ${names.at(-1)},` : "Hi team,";
  const out = await geminiJson(
    `Write a short, warm, personalised cold email from ${thesis.sender_name} at ${thesis.sender_org} to the
founders of ${startup.name}, who just announced a ${startup.round_type} round.

Rules:
- Under 130 words, plain text, no hype, no emojis, no markdown.
- Open with something specific about what they build or the round. Congratulate briefly.
- Say in one sentence why they fit (from the fit note) and one sentence on what we offer.
- End with a low-pressure ask for a short call. Do NOT write a sign-off or your name; both are added automatically.
- Use ONLY facts below. Never invent traction, names, numbers or mutual connections.
- Subject: under 8 words, about THEM (what they build or their round). Never include the accelerator's name
  or the startup's name followed by "and". Example style: "Congrats on the pre-seed for on-prem security AI".
- Do NOT write a greeting line (like "Hi" or "Dear"); it is added automatically.
- Format the body as 3 short paragraphs separated by a blank line (use \\n\\n): (1) congratulations plus one
  specific observation, (2) why they fit and what we offer, (3) the ask.
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
  return { subject: out.subject.trim(), body: frameBody(out.body, greeting, thesis.sender_name) };
}
