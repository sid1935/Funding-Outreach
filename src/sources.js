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

export const FEEDS = [
  "https://techcrunch.com/feed/",
  "https://techcrunch.com/category/startups/feed/",
  "https://news.crunchbase.com/feed/",
  "https://inc42.com/feed/",
  "https://yourstory.com/feed",
  "https://thenextweb.com/feed",
  "https://www.geekwire.com/feed/",
  "https://techcabal.com/feed/",
  "https://www.pehub.com/feed/",
  "https://www.axios.com/feeds/feed.rss",
  "https://www.prnewswire.com/rss/news-releases-list.rss",
  ...QUERIES.map((q) => gnews(q)),
  ...REGIONS.map((q) => gnews(q)),
  ...[...QUERIES.slice(0, 6), ...REGIONS].map(bing),
];

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
  const results = await mapLimit(FEEDS, 8, (f) => withTimeout(parser.parseURL(f), 20000));
  const byUrl = new Map();
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      console.warn(`feed failed: ${FEEDS[i]} (${r.reason?.message})`);
      return;
    }
    for (const it of r.value.items) {
      const url = it.link;
      const ts = Date.parse(it.isoDate || it.pubDate || "");
      if (!url || !ts || ts < cutoff) continue;
      const title = strip(it.title);
      const text = strip(it.contentSnippet || it.content || it.summary || "").slice(0, 1500);
      if (!FUNDING_HINT.test(title + " " + text)) continue;
      byUrl.set(url, { url, title, text, publishedAt: new Date(ts).toISOString() });
    }
  });
  return [...byUrl.values()];
}
