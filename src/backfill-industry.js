// One-off: give every startup without an industry one primary label, using its stored description.
// Run after the `industry` column exists: node src/backfill-industry.js
import { Type } from "@google/genai";
import { supabase, geminiJson } from "./clients.js";
import { INDUSTRIES, normalizeIndustry } from "./industries.js";

const { data: rows, error } = await supabase.from("startups").select("id,name,domain,description").is("industry", null);
if (error) throw new Error(error.message + " (did you run the ALTER TABLE SQL?)");
console.log(`${rows.length} startups to label`);

const schema = { type: Type.OBJECT, properties: { industry: { type: Type.STRING, enum: INDUSTRIES } }, required: ["industry"] };
for (const r of rows) {
  const out = await geminiJson(`Pick the single best industry for this startup.\nName: ${r.name}\nWebsite: ${r.domain ?? "unknown"}\nWhat it does: ${r.description ?? "unknown"}`, schema, { temperature: 0 }).catch(() => null);
  const industry = normalizeIndustry(out?.industry);
  await supabase.from("startups").update({ industry }).eq("id", r.id);
  console.log(`${r.name}: ${industry}`);
}
process.exit(0);
