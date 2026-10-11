import "dotenv/config";
import { createDraft } from "./gmail.js";

const id = await createDraft({
  to: null,
  subject: "TEST draft from funding-outreach (safe to delete)",
  body: "If you can see this in Gmail Drafts, the Gmail connection works.\n\nRohit",
});
console.log("Draft created, id:", id);
