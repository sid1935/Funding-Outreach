// One-time helper: runs the Google OAuth flow and saves a Gmail refresh token to .env.
// Zero dependencies. Usage: node get_gmail_token.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");

const SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const PORT = 8765;
const REDIRECT = `http://localhost:${PORT}`;
const ENV_PATH = path.join(__dirname, ".env");

const { installed } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "credentials.json"), "utf8")
);
const state = crypto.randomBytes(16).toString("hex");

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: installed.client_id,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // forces a refresh_token to be issued
    state,
  });

function upsertEnv(vars) {
  const lines = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/).filter(Boolean)
    : [];
  for (const [k, v] of Object.entries(vars)) {
    const i = lines.findIndex((l) => l.startsWith(k + "="));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.searchParams.get("state") !== state || !url.searchParams.get("code")) {
    res.end("Waiting for Google redirect...");
    return;
  }
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: url.searchParams.get("code"),
        client_id: installed.client_id,
        client_secret: installed.client_secret,
        redirect_uri: REDIRECT,
        grant_type: "authorization_code",
      }),
    });
    const tok = await r.json();
    if (!tok.refresh_token) throw new Error("No refresh_token returned: " + JSON.stringify(Object.keys(tok)));
    upsertEnv({
      GMAIL_CLIENT_ID: installed.client_id,
      GMAIL_CLIENT_SECRET: installed.client_secret,
      GMAIL_REFRESH_TOKEN: tok.refresh_token,
    });
    res.end("Done. You can close this tab and return to the terminal.");
    console.log("Success: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN saved to .env");
  } catch (e) {
    res.end("Failed: " + e.message);
    console.error("Failed:", e.message);
  }
  server.close();
});

server.listen(PORT, () => {
  console.log("Opening browser for Google sign-in...\nIf it doesn't open, visit:\n" + authUrl + "\n");
  exec(`start "" "${authUrl}"`);
});
