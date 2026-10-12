// One-off: merge duplicate startups (same company under different names) and delete junk rows, then recompute the
// de-duplication keys with the improved nameKey. For each pair the keeper gets any field it is missing from the
// duplicate. Only rows with no draft are ever deleted.   node src/merge-duplicates.js
import { supabase } from "./clients.js";
import { nameKey } from "./extract.js";

const MERGE = [["Loops Smart AI", "Loops"], ["NeoFleet", "NeoFleet Capital"], ["Visorway", "Visorway AG"], ["Winverse", "Winverse AI"]]; // [keep, drop]
const JUNK = ["Unknown"];
const FIELDS = ["domain", "description", "founders", "industry", "amount_usd", "announced_at", "source_url"];

const { data: all, error } = await supabase.from("startups").select("*, outreach(id)");
if (error) throw new Error(error.message);
const byName = (n) => all.find((r) => r.name === n);
const hasDraft = (r) => (Array.isArray(r.outreach) ? r.outreach.length : !!r.outreach);

for (const [keepName, dropName] of MERGE) {
  const keep = byName(keepName), drop = byName(dropName);
  if (!keep || !drop) { console.log(`skip ${keepName} / ${dropName}: not both present`); continue; }
  if (hasDraft(drop)) { console.log(`skip ${dropName}: it has a draft`); continue; }
  const fill = {};
  for (const f of FIELDS) if ((keep[f] == null || (Array.isArray(keep[f]) && !keep[f].length)) && drop[f] != null) fill[f] = drop[f];
  if (Object.keys(fill).length) await supabase.from("startups").update(fill).eq("id", keep.id);
  await supabase.from("startups").delete().eq("id", drop.id);
  console.log(`merged "${dropName}" into "${keepName}"${Object.keys(fill).length ? ` (filled: ${Object.keys(fill).join(", ")})` : ""}`);
}
for (const n of JUNK) {
  const r = byName(n);
  if (!r) continue;
  if (hasDraft(r)) { console.log(`skip ${n}: it has a draft`); continue; }
  await supabase.from("startups").delete().eq("id", r.id);
  console.log(`deleted "${n}"`);
}

// Recompute keys so future variants of these names collide with the existing row.
const { data: left } = await supabase.from("startups").select("id,name,name_key");
const seen = new Map();
for (const r of left) {
  const key = nameKey(r.name);
  if (seen.has(key)) { console.log(`still a duplicate key: "${r.name}" and "${seen.get(key)}" (left as is)`); continue; }
  seen.set(key, r.name);
  if (key !== r.name_key) await supabase.from("startups").update({ name_key: key }).eq("id", r.id);
}
console.log(`Done. ${left.length} startups remain.`);
process.exit(0);
