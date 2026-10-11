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

export async function createDraft({ to, subject, body }) {
  const mime = [
    to ? `To: ${to}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body).toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ].filter((l) => l !== null).join("\r\n");

  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw: b64url(mime) } }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Gmail draft failed: " + JSON.stringify(j.error || j));
  return j.id;
}
