// Shared by the scorer and the edit API: the default rubric and input validation.
export const DEFAULT_RUBRIC = [
  { name: "Sector fit", weight: 30, description: "Does the company operate in a sector the accelerator targets?" },
  { name: "Stage and round", weight: 20, description: "Is it at the right stage, and is the round size typical for it?" },
  { name: "Product clarity", weight: 20, description: "Is there a clear product aimed at a specific customer?" },
  { name: "Founder strength", weight: 15, description: "Do the founders show relevant technical or domain strength?" },
  { name: "Need for the programme", weight: 15, description: "Would go-to-market, hiring and follow-on fundraising help they will soon need be valuable?" },
];

export function rubricOf(thesis) {
  const r = thesis.rubric;
  return Array.isArray(r) && r.length ? r : DEFAULT_RUBRIC;
}

const STAGES = ["pre-seed", "seed", "series-a"];
const str = (v, max, label) => {
  if (typeof v !== "string") throw new Error(`${label} must be text`);
  const t = v.trim();
  if (t.length > max) throw new Error(`${label} is too long (max ${max} characters)`);
  return t;
};
const list = (v, label) => {
  if (!Array.isArray(v) || v.length > 30) throw new Error(`${label} must be a list of up to 30 items`);
  return v.map((x) => str(String(x), 60, label)).filter(Boolean);
};

// Returns a clean update object, or throws an Error with a message safe to show the user.
export function validateThesis(input) {
  const out = {};
  out.description = str(input.description, 2000, "Description");
  if (out.description.length < 20) throw new Error("Description is too short to guide scoring");
  out.stages = list(input.stages, "Stages").map((s) => s.toLowerCase());
  if (!out.stages.length || out.stages.some((s) => !STAGES.includes(s))) throw new Error(`Stages must be from: ${STAGES.join(", ")}`);
  out.sectors = list(input.sectors, "Sectors");
  out.geographies = list(input.geographies, "Geographies");
  out.exclusions = list(input.exclusions, "Exclusions");
  const min = Number(input.min_score);
  if (!Number.isInteger(min) || min < 0 || min > 100) throw new Error("Minimum score must be a whole number from 0 to 100");
  out.min_score = min;
  out.sender_name = str(input.sender_name, 80, "Sender name");
  out.sender_org = str(input.sender_org, 120, "Organisation");
  out.pitch = str(input.pitch, 600, "Pitch");
  if (!out.sender_name || !out.sender_org) throw new Error("Sender name and organisation are required");

  if (!Array.isArray(input.rubric) || input.rubric.length < 1 || input.rubric.length > 8) throw new Error("Rubric needs 1 to 8 criteria");
  out.rubric = input.rubric.map((c, i) => {
    const name = str(c?.name ?? "", 60, `Criterion ${i + 1} name`);
    if (!name) throw new Error(`Criterion ${i + 1} needs a name`);
    const weight = Number(c?.weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) throw new Error(`Criterion "${name}" needs a weight from 0 to 100`);
    return { name, weight, description: str(c?.description ?? "", 300, `Criterion "${name}" description`) };
  });
  const total = out.rubric.reduce((a, c) => a + c.weight, 0);
  if (Math.abs(total - 100) > 0.01) throw new Error(`Rubric weights must add up to 100 (currently ${total})`);
  return out;
}
