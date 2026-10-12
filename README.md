# Funding Outreach

Automated pipeline that finds startups which have just announced a **seed or pre-seed** round, scores them against an accelerator's thesis, and leaves a **researched, personalised outreach email in Gmail Drafts**, ready for a human to read, edit and send.

Live dashboard: https://funding-outreach.vercel.app

> **Nothing is ever sent automatically.** The code only creates Gmail *drafts*.

## What it does

```
news feeds ──► extract ──► dedupe ──► research ──► score ──► draft
(~50 sources)  (Gemini)    (Supabase)  (company    (Gemini +  (Gemini ──► Gmail Drafts)
                                        website)    rubric)
```

1. **Ingest.** Pulls ~50 sources every run: RSS feeds (TechCrunch, Crunchbase News, Inc42, YourStory, TNW, GeekWire, …) plus Google News and Bing News searches ("raises pre-seed", "closes seed round", regional variants for India, Europe, Africa, SE Asia, …). Only items from the last 26 hours are kept.
2. **Extract.** Gemini turns each article into structured data (company, round, amount, description, investors) and discards anything that is not a seed or pre-seed announcement.
3. **Dedupe.** A startup is claimed in the database before any work is done. Unique constraints on the normalised company name and on the domain make this atomic, so a startup that was already handled is never processed or contacted twice, even if two runs overlap.
4. **Research.** Finds the company's website (Gemini with Google Search if the article does not name it), checks the page really mentions the company, and reads the homepage text and any public contact email.
5. **Score.** Gemini scores the startup on every criterion of the **rubric**; the final score is the weighted average, computed in code. Scores near the cutoff are scored three times and the median is used, to damp run-to-run noise.
6. **Draft.** Startups at or above the minimum score get a short personalised email, created as a Gmail draft. Non-fits are stored (with score and reason) but never reach the inbox.

Every evaluated startup is scored **once**. Its score is stored and never recalculated, so rankings only change when new companies arrive.

## Configuring the thesis (no code changes)

The thesis lives in the `thesis` table and is read fresh on **every** run. Edit it either:

- on the website: **https://funding-outreach.vercel.app/thesis → Edit thesis**, or
- directly in Supabase: Table Editor → `thesis`.

| Field | Meaning |
|---|---|
| `description` | What the accelerator looks for (the scorer reads this) |
| `stages` | Accepted rounds: `pre-seed`, `seed`, `series-a` |
| `sectors`, `geographies` | Preferred sectors / regions (empty = any) |
| `exclusions` | Anything matching is auto-rejected (empty = none) |
| `min_score` | Minimum weighted score (0–100) to create a draft |
| `rubric` | Scoring criteria: name, weight (must total 100), and what good looks like |
| `sender_name`, `sender_org`, `pitch` | Used in the email |

Each change bumps `version` automatically, and every draft records which version scored it.

> The website edit form has **no password** by design. Anyone with the link can change the thesis. Emails are still only drafts that a human reviews, but protect or remove `api/thesis.js` if the link will be widely shared.

## Architecture

| Piece | Tech | Role |
|---|---|---|
| Pipeline | Node.js (ES modules) | `src/` — ingest, extract, score, draft |
| LLM | Google Gemini (`gemini-3.8-flash`) | extraction, scoring, drafting, domain lookup |
| Database | Supabase (Postgres) | thesis, startups, outreach, seen articles, run log |
| Email | Gmail API (OAuth) | creates drafts only |
| Hosting | Vercel | dashboard (`public/`), `/api/run`, `/api/status`, `/api/thesis` |
| Schedulers | cron-job.org, GitHub Actions, Vercel Cron | trigger runs (see below) |

### Database (`supabase/schema.sql`)

- `thesis` — the editable configuration above.
- `startups` — every startup seen; `status` is `processing | drafted | rejected | error`; unique on `name_key` and `domain`; stores `fit_score`, `fit_rationale`, `fit_breakdown`.
- `outreach` — one draft per startup (`startup_id` unique): subject, body, score, thesis version, Gmail draft id.
- `seen_articles` — URLs already looked at, so the LLM is not paid for twice.
- `runs` — a log row per run with stats and errors.

### Scheduling

Runs are triggered three ways; the database makes overlapping runs safe.

1. **cron-job.org** calls `GET /api/run` every hour with `Authorization: Bearer <CRON_SECRET>` (reliable hourly trigger).
2. **GitHub Actions** (`.github/workflows/daily.yml`) runs hourly at :17 as a backup. GitHub treats schedules as best-effort and may delay or skip runs.
3. **Vercel Cron** (`vercel.json`) runs once a day. The Vercel Hobby plan does not allow more frequent crons.

`/api/run` replies `202` immediately and keeps working in the background (`waitUntil`), so timers with short HTTP timeouts do not cut a run off. A run stops starting new work after 4 minutes; unprocessed articles are not marked seen and are picked up next time.

## Setup

### Requirements
Node.js 20+, a Supabase project, a Gemini API key, a Google Cloud project with the Gmail API enabled.

### 1. Database
Paste `supabase/schema.sql` into the Supabase SQL Editor and run it. It also seeds a starter thesis.

### 2. Gmail access (one time)
1. In Google Cloud: enable the Gmail API, configure the OAuth consent screen, add yourself as a test user and the scope `https://www.googleapis.com/auth/gmail.compose`, and create a **Desktop app** OAuth client. Download it as `credentials.json`.
2. Run `node get_gmail_token.js` and approve in the browser. It writes `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN` to `.env`.

> While the OAuth app is in **Testing** mode the refresh token expires after **7 days**. Publish the app, or re-run the script and update the secrets.

### 3. Environment variables
Copy `.env.example` to `.env` and fill in:

```
SUPABASE_URL=              # https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
```

On Vercel and GitHub Actions set the same variables as secrets. Vercel also needs `CRON_SECRET` (any long random string; the hourly timer sends it as a Bearer token).

### 4. Run locally

```bash
npm install
npm run dry        # full pipeline, prints drafts, writes nothing to Supabase or Gmail
npm start          # real run: creates Gmail drafts and database rows
npm run test-gmail # creates one harmless test draft to check the Gmail connection
```

### 5. Deploy

```bash
vercel deploy --prod
gh secret set -f .env     # for the GitHub Actions backup schedule
```

## Dashboard

| Page | Shows |
|---|---|
| `/` | Clickable stats, how it works, thesis summary |
| `/startups` | Every evaluated startup, ranked by score; filter by status |
| `/drafts` | Fits, with the email text and per-criterion score breakdown |
| `/rejected` | Non-fits, each with a score and the reason |
| `/thesis` | The thesis and rubric, with the edit form |
| `/runs` | Run history |

The public API (`/api/status`) is read-only and never returns recipient emails or secrets.

## Design decisions and limitations

- **Draft-only by design.** A human always reviews before anything is sent.
- **Idempotent.** Re-running is always safe; duplicates are blocked by database constraints, not just application code.
- **Scoring noise.** LLM scores vary a little between runs. Scoring runs at temperature 0, includes the company's own website text, and uses the median of three near the cutoff, but scores close to the threshold can still land either side.
- **Recipient addresses.** The `To` field is only filled when a public `mailto:` is found on the company site; otherwise the reviewer adds it.
- **Coverage.** Sources are public RSS and news search. Paywalled or script-blocking sites (some are skipped automatically) are not covered.
- **Extraction accuracy.** Amounts and rounds are read from short article snippets and can occasionally be wrong.
- **Existing scores are final.** Changing the thesis or rubric affects new startups only; previously scored startups are not re-ranked.

## Project layout

```
api/          Vercel functions: run.js, status.js, thesis.js
public/       Dashboard (static HTML, app.js, style.css)
src/          Pipeline: sources, extract, score, draft, gmail, run, thesis-config
supabase/     schema.sql
.github/      Workflow (backup schedule)
```
