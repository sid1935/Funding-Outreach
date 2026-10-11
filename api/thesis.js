import { timingSafeEqual } from "crypto";
import { supabase } from "../src/clients.js";
import { validateThesis } from "../src/thesis-config.js";

// Password-protected write endpoint for the thesis (the only public write path).
// The password is the ADMIN_PASSWORD environment variable; it is never stored in the database or the page.
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const admin = process.env.ADMIN_PASSWORD;
  if (!admin) return res.status(503).json({ error: "Editing is not enabled: ADMIN_PASSWORD is not set." });

  const { password, thesis } = req.body || {};
  if (!password || !same(password, admin)) {
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    return res.status(401).json({ error: "Wrong password." });
  }
  let clean;
  try {
    clean = validateThesis(thesis || {});
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const { data, error } = await supabase.from("thesis").update(clean).eq("active", true).select("version").single();
  if (error) return res.status(500).json({ error: "Could not save. Has the rubric column been added in Supabase?" });
  return res.status(200).json({ ok: true, version: data.version });
}
