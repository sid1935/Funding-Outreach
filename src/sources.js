import Parser from "rss-parser";

// Add or remove feeds freely. Search-based feeds (Google News, Bing News) catch announcements from
// outlets we don't list, so they matter most for coverage.
const gnews = (q, region = "US") =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:1d")}&hl=en-${region}&gl=${region}&ceid=${region}:en`;
const bing = (q) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&qft=interval%3d%227%22`;

const QUERIES = [
  '"raises" "pre-seed"', '"raises" "seed round"', '"seed funding" startup', '"pre-seed funding"',
  'startup secures seed funding', '"closes seed round"', '"announces seed"', '"announces pre-seed"',
  '"seed round" led by', 'startup "raised" "million" seed', 'founders "pre-seed round"',
  'site:prnewswire.com "seed round"', 'site:businesswire.com "seed round"', 'site:globenewswire.com "seed"',
];
const REGIONS = [ // extra geographic coverage so non-US news isn't missed
  "India", "Europe", "UK", "Africa", "Southeast Asia", "Middle East", "Latin America", "Canada", "Australia",
].map((r) => `startup raises seed funding ${r}`);

const site = (name, url) => ({ name, url, kind: "News site feed" });
const search = (kind, q, url) => ({ name: `${kind}: ${q}`, url, kind: `${kind} search` });

export const SOURCES = [
  site("TechCrunch (all)", "https://techcrunch.com/feed/"),
  site("TechCrunch (startups)", "https://techcrunch.com/category/startups/feed/"),
  site("Crunchbase News", "https://news.crunchbase.com/feed/"),
  site("Inc42", "https://inc42.com/feed/"),
  site("YourStory", "https://yourstory.com/feed"),
  site("The Next Web", "https://thenextweb.com/feed"),
  site("GeekWire", "https://www.geekwire.com/feed/"),
  site("TechCabal", "https://techcabal.com/feed/"),
  site("PE Hub", "https://www.pehub.com/feed/"),
  site("Axios", "https://www.axios.com/feeds/feed.rss"),
  site("PR Newswire", "https://www.prnewswire.com/rss/news-releases-list.rss"),
  ...QUERIES.map((q) => search("Google News", q, gnews(q))),
  ...REGIONS.map((q) => search("Google News", q, gnews(q))),
  ...[...QUERIES.slice(0, 6), ...REGIONS].map((q) => search("Bing News", q, bing(q))),
];
export const FEEDS = SOURCES.map((s) => s.url);

const FUNDING_HINT = /\b(seed|pre-seed|preseed|raises?|raised|funding|round|backed)\b/i;
const WINDOW_HOURS = Number(process.env.WINDOW_HOURS || 26); // 24h + overlap; dedupe handles repeats

const parser = new Parser({ timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 funding-outreach" } });

const strip = (s = "") => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

// Run fn over items with limited concurrency; returns allSettled-style results in order.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { status: "fulfilled", value: await fn(items[i]) }; }
      catch (reason) { out[i] = { status: "rejected", reason }; }
    }
  }));
  return out;
}

export async function fetchArticles() {
  const cutoff = Date.now() - WINDOW_HOURS * 3600 * 1000;
  const results = await mapLimit(SOURCES, 8, (src) => withTimeout(parser.parseURL(src.url), 20000));
  const report = SOURCES.map((src) => ({ ...src, ok: false, items: 0, error: null }));
  const byUrl = new Map();
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      console.warn(`feed failed: ${SOURCES[i].url} (${r.reason?.message})`);
      report[i].error = String(r.reason?.message || "failed").slice(0, 120);
      return;
    }
    report[i].ok = true;
    for (const it of r.value.items) {
      const url = it.link;
      const ts = Date.parse(it.isoDate || it.pubDate || "");
      if (!url || !ts || ts < cutoff) continue;
      const title = strip(it.title);
      const text = strip(it.contentSnippet || it.content || it.summary || "").slice(0, 1500);
      if (!FUNDING_HINT.test(title + " " + text)) continue;
      report[i].items++;
      byUrl.set(url, { url, title, text, publishedAt: new Date(ts).toISOString() });
    }
  });
  const articles = [...byUrl.values()];
  articles.report = report; // per-source health, saved by the run for the Sources page
  return articles;
}
