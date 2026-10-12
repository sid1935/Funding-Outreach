import { supabase } from "../src/clients.js";
import { sendMail } from "../src/gmail.js";

// Approve or reject a draft from the dashboard.
//  - Reject: marks the draft rejected.
//  - Approve: sends through Gmail. In the default TEST mode the email goes only to DEMO_TO (the owner's own inbox),
//    so the public button can never email a third party. LIVE mode (SEND_MODE=live) sends to the draft's real
//    recipient and additionally requires APPROVAL_PIN.
// A draft can be decided only once: the status flip below is an atomic claim.
const same = async (a, b) => {
  const { timingSafeEqual } = await import("crypto");
  const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { id, action, pin } = req.body || {};
  if (!Number.isInteger(id) || !["approve", "reject"].includes(action)) return res.status(400).json({ error: "Bad request" });

  if (action === "reject") {
    const { data } = await supabase.from("outreach").update({ status: "rejected", decided_at: new Date().toISOString() })
      .eq("id", id).eq("status", "pending").select("id");
    return data?.length ? res.status(200).json({ ok: true, status: "rejected" }) : res.status(409).json({ error: "This draft was already decided." });
  }

  const live = process.env.SEND_MODE === "live";
  if (live && !(process.env.APPROVAL_PIN && (await same(pin, process.env.APPROVAL_PIN)))) {
    return res.status(401).json({ error: "pin_required" });
  }
  if (!live && !process.env.DEMO_TO) return res.status(503).json({ error: "Demo mode needs DEMO_TO to be set." });

  // Claim: only one request can move a draft from pending to sent.
  const now = new Date().toISOString();
  const { data: claimed } = await supabase.from("outreach").update({ status: "sent", decided_at: now })
    .eq("id", id).eq("status", "pending").select("id,subject,body,to_email,gmail_draft_id,startups(name)");
  const row = claimed?.[0];
  if (!row) return res.status(409).json({ error: "This draft was already decided." });

  try {
    const to = live ? row.to_email : process.env.DEMO_TO;
    if (!to) throw Object.assign(new Error("This draft has no recipient address. Add one in Gmail first."), { user: true });
    const subject = live ? row.subject : `[DEMO] ${row.subject}`;
    const body = live ? row.body
      : `[Demo mode: approved on the dashboard. In live mode this goes to ${row.to_email || "the founder (no address found)"}.]

${row.body}`;
    const messageId = await sendMail({ draftId: row.gmail_draft_id, to, subject, body });
    await supabase.from("outreach").update({ sent_to: to, gmail_message_id: messageId }).eq("id", id);
    return res.status(200).json({ ok: true, status: "sent", sent_to: to });
  } catch (e) {
    await supabase.from("outreach").update({ status: "pending", decided_at: null }).eq("id", id); // let it be retried
    return res.status(e.user ? 400 : 500).json({ error: e.user ? e.message : "Sending failed. Please try again." });
  }
}
