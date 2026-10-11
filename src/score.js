import { Type } from "@google/genai";
import { geminiJson, supabase } from "./clients.js";

// Always read the thesis fresh so edits in Supabase apply to the very next run, no code change.
export async function loadThesis() {
  const { data, error } = await supabase.from("thesis").select("*").eq("active", true).single();
  if (error) throw new Error("No active thesis row in Supabase: " + error.message);
  if (process.env.MIN_SCORE) data.min_score = Number(process.env.MIN_SCORE); // testing override only
  return data;
}

const schema = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.INTEGER, description: "0-100 fit with the thesis" },
    rationale: { type: Type.STRING, description: "2-3 sentences, specific" },
    excluded: { type: Type.BOOLEAN, description: "true if it hits any exclusion" },
  },
  required: ["score", "rationale", "excluded"],
};

export async function scoreFit(startup, thesis, siteText = "") {
  const first = await scoreOnce(startup, thesis, siteText);
  let { score } = first;
  // Near the cutoff a few points decide who sees the startup, so take the median of three scores.
  if (Math.abs(score - thesis.min_score) <= 12) {
    const more = await Promise.all([scoreOnce(startup, thesis, siteText), scoreOnce(startup, thesis, siteText)]);
    const all = [score, ...more.map((m) => m.score)].sort((a, b) => a - b);
    score = all[1];
    if (more.some((m) => m.excluded)) first.excluded = true;
  }
  const fits = !first.excluded && score >= thesis.min_score && thesis.stages.includes(startup.round_type);
  return { score, rationale: first.rationale, fits };
}

async function scoreOnce(startup, thesis, siteText) {
  const out = await geminiJson(
    `You screen startups for an accelerator. Score how well this startup fits the thesis (0-100).
Be strict: 70+ means a clear, defensible fit. Use only the facts given; do not guess.
Score consistently: judge the company's actual product, sector and stage against each thesis criterion, and do not
let the article's wording or missing details move the score. If facts are missing, score what is known.

ACCELERATOR THESIS
${thesis.description}
Stages: ${thesis.stages.join(", ")}
Sectors of interest: ${thesis.sectors.join(", ") || "any"}
Geographies: ${thesis.geographies.join(", ") || "any"}
Exclusions (auto-reject): ${thesis.exclusions.join(", ") || "none"}

STARTUP
Name: ${startup.name}
Round: ${startup.round_type}, amount USD: ${startup.amount_usd ?? "unknown"}
Country: ${startup.country ?? "unknown"}
What they do: ${startup.description}
Investors: ${startup.investors.join(", ") || "unknown"}
Company's own website text (most reliable source of what they do; prefer it over the article): ${siteText || "(unavailable)"}`,
    schema,
    { temperature: 0 }
  );
  return out;
}
