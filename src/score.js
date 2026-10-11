import { Type } from "@google/genai";
import { geminiJson, supabase } from "./clients.js";
import { rubricOf } from "./thesis-config.js";

// Always read the thesis fresh so edits (in Supabase or on the site) apply to the very next run.
export async function loadThesis() {
  const { data, error } = await supabase.from("thesis").select("*").eq("active", true).single();
  if (error) throw new Error("No active thesis row in Supabase: " + error.message);
  if (process.env.MIN_SCORE) data.min_score = Number(process.env.MIN_SCORE); // testing override only
  return data;
}

const schema = {
  type: Type.OBJECT,
  properties: {
    criteria: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, score: { type: Type.INTEGER, description: "0-100 for this criterion" } },
        required: ["name", "score"],
      },
    },
    rationale: { type: Type.STRING, description: "2-3 specific sentences explaining the overall verdict" },
    excluded: { type: Type.BOOLEAN, description: "true if it hits any exclusion" },
  },
  required: ["criteria", "rationale", "excluded"],
};

// The final score is a weighted average computed here, so the weights in the rubric are honoured exactly.
function weighted(rubric, criteria) {
  const byName = new Map(criteria.map((c) => [c.name.trim().toLowerCase(), c.score]));
  const breakdown = rubric.map((r) => {
    const s = byName.get(r.name.trim().toLowerCase());
    return { name: r.name, weight: r.weight, score: Math.max(0, Math.min(100, Number.isFinite(s) ? s : 0)) };
  });
  const score = Math.round(breakdown.reduce((a, b) => a + (b.score * b.weight) / 100, 0));
  return { score, breakdown };
}

export async function scoreFit(startup, thesis, siteText = "") {
  const rubric = rubricOf(thesis);
  const first = await scoreOnce(startup, thesis, siteText, rubric);
  let { score } = first;
  let breakdown = first.breakdown;
  // Near the cutoff a few points decide who sees the startup, so take the median of three scores.
  if (Math.abs(score - thesis.min_score) <= 12) {
    const more = await Promise.all([scoreOnce(startup, thesis, siteText, rubric), scoreOnce(startup, thesis, siteText, rubric)]);
    const all = [first, ...more].sort((a, b) => a.score - b.score);
    score = all[1].score;
    breakdown = all[1].breakdown;
    if (more.some((m) => m.excluded)) first.excluded = true;
  }
  const fits = !first.excluded && score >= thesis.min_score && thesis.stages.includes(startup.round_type);
  return { score, rationale: first.rationale, fits, breakdown };
}

async function scoreOnce(startup, thesis, siteText, rubric) {
  const out = await geminiJson(
    `You screen startups for an accelerator. Score this startup on each rubric criterion below (0-100 each).
Be strict: 70+ on a criterion means a clear, defensible match. Use only the facts given; do not guess.
Score consistently: judge the company's actual product, sector and stage, and do not let the article's wording or
missing details move the score. If facts are missing, score what is known. Return one entry per criterion, using the
exact criterion names.

RUBRIC
${rubric.map((r) => `- ${r.name} (weight ${r.weight}%): ${r.description || "use your judgement"}`).join("\n")}

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
  const { score, breakdown } = weighted(rubric, out.criteria || []);
  return { score, breakdown, rationale: out.rationale, excluded: out.excluded };
}
