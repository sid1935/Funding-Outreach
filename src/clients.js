import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const supabase = createClient(new URL(need("SUPABASE_URL")).origin, need("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});
export const ai = new GoogleGenAI({ apiKey: need("GEMINI_API_KEY") });
export const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
export const DRY_RUN = process.env.DRY_RUN === "1" || process.argv.includes("--dry");

// Call Gemini and return parsed JSON, retrying on rate limits / transient errors.
export async function geminiJson(prompt, schema, { model = MODEL, tries = 4, temperature = 0.3 } = {}) {
  for (let i = 0; ; i++) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: schema, temperature },
      });
      return JSON.parse(res.text);
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
}
