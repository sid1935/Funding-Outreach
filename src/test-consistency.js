// Scores each recent startup 3 times to measure run-to-run variance. Writes nothing.
import { fetchArticles } from "./sources.js";
import { extractStartup } from "./extract.js";
import { loadThesis, scoreFit } from "./score.js";
import { research } from "./draft.js";

const thesis = await loadThesis();
const arts = (await fetchArticles()).slice(0, 45);
const seen = new Set();
for (const a of arts) {
  const s = await extractStartup(a).catch(() => null);
  if (!s || seen.has(s.name.toLowerCase())) continue;
  seen.add(s.name.toLowerCase());
  const { siteText } = await research(s);
  const scores = [];
  for (let i = 0; i < 3; i++) scores.push((await scoreFit(s, thesis, siteText)).score);
  const spread = Math.max(...scores) - Math.min(...scores);
  console.log(`${s.name.padEnd(28)} ${scores.join(", ").padEnd(14)} spread ${spread}  site:${siteText ? "yes" : "no"}`);
}
