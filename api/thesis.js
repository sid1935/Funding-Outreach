import { supabase } from "../src/clients.js";
import { validateThesis } from "../src/thesis-config.js";

// Open write endpoint for the thesis (by the owner's choice there is no password).
// Input is strictly validated and length-limited; the page escapes everything it renders.
const lastEdit = { t: 0 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Light brake against scripted abuse: at most one save every 3 seconds per server instance.
  if (Date.now() - lastEdit.t < 3000) return res.status(429).json({ error: "Please wait a few seconds and try again." });
  lastEdit.t = Date.now();

  let clean;
  try {
    clean = validateThesis(req.body?.thesis || {});
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const { data, error } = await supabase.from("thesis").update(clean).eq("active", true).select("version").single();
  if (error) return res.status(500).json({ error: "Could not save. Has the rubric column been added in Supabase?" });
  return res.status(200).json({ ok: true, version: data.version });
}
