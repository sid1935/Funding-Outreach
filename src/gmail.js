// Creates a Gmail DRAFT only. This code never sends anything.
async function accessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Gmail token refresh failed: " + (j.error_description || j.error));
  return j.access_token;
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function buildRaw({ to, subject, body }) {
  const mime = [
    to ? `To: ${to}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body).toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ].filter((l) => l !== null).join("\r\n");
  return b64url(mime);
}

async function gmail(path, payload) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path.url}`, {
    method: path.method || "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`Gmail ${path.url} failed: ${JSON.stringify(j.error || j)}`); e.status = r.status; throw e; }
  return j;
}

export async function createDraft(mail) {
  return (await gmail({ url: "drafts" }, { message: { raw: buildRaw(mail) } })).id;
}

// Sends an email. If the Gmail draft still exists it is updated and sent (so it leaves the Drafts folder);
// otherwise the message is sent directly. Called only from the approve endpoint, never from the pipeline.
export async function sendMail({ draftId, to, subject, body }) {
  const raw = buildRaw({ to, subject, body });
  if (draftId) {
    try {
      await gmail({ url: `drafts/${draftId}`, method: "PUT" }, { message: { raw } });
      return (await gmail({ url: "drafts/send" }, { id: draftId })).id;
    } catch (e) {
      if (e.status !== 404) throw e; // draft was deleted in Gmail: fall through to a direct send
    }
  }
  return (await gmail({ url: "messages/send" }, { raw })).id;
}

// Rewrites an existing Gmail draft (used to add a recipient found later). Never sends.
export async function updateDraft({ draftId, to, subject, body }) {
  await gmail({ url: `drafts/${draftId}`, method: "PUT" }, { message: { raw: buildRaw({ to, subject, body }) } });
}
