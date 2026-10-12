// One-off: put every still-pending draft into the standard frame (greeting on top, "Thank you, / Warm Regards, /
// <sender>" at the bottom), in the database and in the Gmail draft. Sent drafts are left alone. Never sends.
import { supabase } from "./clients.js";
import { frameBody, greetingFor } from "./draft.js";
import { updateDraft } from "./gmail.js";
import { loadThesis } from "./score.js";

const thesis = await loadThesis();
const { data: rows, error } = await supabase.from("outreach").select("id,status,subject,body,to_email,gmail_draft_id,startups(name,founders)").eq("status", "pending");
if (error) throw new Error(error.message);

for (const o of rows) {
  const body = frameBody(o.body, greetingFor(Array.isArray(o.startups?.founders) ? o.startups.founders : []), thesis.sender_name);
  if (body === o.body) { console.log(`${o.startups?.name}: already in the standard frame`); continue; }
  await supabase.from("outreach").update({ body }).eq("id", o.id);
  if (o.gmail_draft_id) await updateDraft({ draftId: o.gmail_draft_id, to: o.to_email, subject: o.subject, body }).catch((e) => console.warn("  Gmail draft not updated:", e.message));
  console.log(`${o.startups?.name}: reformatted`);
}
process.exit(0);
