// One primary industry per startup, from a fixed list so the dashboard filter stays tidy.
export const INDUSTRIES = [
  "AI", "SaaS", "Developer tools", "Fintech", "Healthtech", "Climate and energy", "Cybersecurity", "E-commerce and retail",
  "Logistics and supply chain", "Agritech", "Edtech", "Deep tech and hardware", "Consumer", "Web3 and crypto", "Other",
];

// Maps whatever the model returned onto the fixed list.
export function normalizeIndustry(v) {
  if (!v) return null;
  const t = String(v).trim().toLowerCase();
  return INDUSTRIES.find((i) => i.toLowerCase() === t) ?? "Other";
}
