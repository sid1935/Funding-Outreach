# Funding Outreach

Automated pipeline that finds startups which have just announced a **seed or pre-seed** round, scores them against an accelerator's thesis, finds a founder contact, and leaves a **researched, personalised outreach email in Gmail Drafts**, ready for a human to read, edit and send.

Live dashboard: https://funding-outreach.vercel.app

> **The pipeline never sends email.** It only creates Gmail *drafts*. An email is sent only when a person clicks **Approve** on the dashboard, and by default that sends to a single test inbox, never to the startup (see [Approval workflow](#approval-workflow)).

## What it does

```
news feeds ─► extract ─► dedupe ─► research ─► score ─► contact SOP ─► draft ─► Gmail Drafts ─► approve / reject
(~50 sources) (Gemini)  (Supabase) (company   (Gemini +  (fits only)    (Gemini)              (human, dashboard)
                                    website)   rubric)
```

1. **Ingest.** Pulls ~50 sources every run: RSS feeds (TechCrunch, Crunchbase News, Inc42, YourStory, TNW, GeekWire, …) plus Google News and Bing News searches ("raises pre-seed", "closes seed round", regional variants for India, Europe, Africa, SE Asia, …). Only items from the last 26 hours are kept.
2. **Extract.** Gemini turns each article into structured data (company, round, amount, description, investors, founders named) and discards anything that is not a seed or pre-seed announcement.
3. **Dedupe.** A startup is claimed in the database before any work is done. Unique constraints on the normalised company name and on the domain make this atomic, so a startup that was already handled is never processed or contacted twice, even if two runs overlap. (A startup left half-processed by a killed run is retried after 15 minutes.)
4. **Research.** Finds the company's website (Gemini with Google Search if the article does not name it), checks the page really mentions the company, and reads the homepage text and the founders named on its own pages.
5. **Score.** Gemini scores the startup on every criterion of the **rubric**; the final score is the weighted average, computed in code. Scores near the cutoff are scored three times and the median is used, to damp run-to-run noise.
6. **Contact SOP** (only for startups that pass the score). See [Contact SOP](#contact-sop).
7. **Draft.** Startups at or above the minimum score get a short personalised email, created as a Gmail draft. Non-fits are stored (with score and reason) but never reach the inbox.
8. **Approve or reject.** A person reviews each draft on the dashboard and approves (sends) or rejects it.

Every evaluated startup is scored **once**. Its score is stored and never recalculated, so rankings only change when new companies arrive.

## The email

Every draft has the same frame, added by code (not left to the model) so it never varies:

```
Subject: <specific to the startup, under 8 words>

Hi <founder first name(s)>,        (or "Hi team," when no founder is known)

<three short paragraphs: congratulations + one specific observation,
 why they fit and what we offer, a low-pressure ask for a call>

Thank you,
Warm Regards,
<sender name from the thesis>
```

If the model writes its own greeting or sign-off, it is stripped first so nothing appears twice. The model only uses facts it was given and is told never to invent traction, names, numbers or connections.

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

The website editor uses **dropdowns** instead of free typing: checkbox dropdowns for stages, sectors, geographies and exclusions (with an "add your own" box), a dropdown for the minimum score, template dropdowns for the description and pitch, and dropdowns for each rubric criterion and its weight (weights must total 100%).

Each change bumps `version` automatically, and every draft records which version scored it.

> The website edit form has **no password** by design. Anyone with the link can change the thesis. Emails are still only drafts that a human approves, but protect or remove `api/thesis.js` if the link will be widely shared.

## Contact SOP

For every new startup that passes the score threshold, the pipeline looks for a founder's contact address in this order and stops at the first hit (`src/waterfall.js`):

1. **Company contact page.** The company's own contact, about and team pages, for an address that matches a named founder.
2. **Founder's personal website.** Google search (Gemini grounding) for the founder's own site (never LinkedIn, X, GitHub, news or data-broker pages). An address is accepted only if the page names the founder *and* their startup. If no founder is named, it searches for the founders first, and keeps those names only if a verified site turns up.
3. **Hunter.** Email Finder for each named founder, or Domain Search for senior contacts. Needs `HUNTER_API_KEY`; capped at `HUNTER_MAX_PER_RUN` (default 5) to protect the monthly credits; only addresses at 70%+ confidence (`HUNTER_MIN_CONFIDENCE`) that are not verified invalid.
4. **Fallback.** A general company inbox (`hello@`, `founders@`, `contact@`, …) published on the company website.

The winning address and how it was found are stored in `startups.contact_email` / `contact_source`, and the address goes into the Gmail draft's **To** field. Nothing is guessed from name patterns. Each run records how many contacts came from each step in its stats. Contacts are only kept for startups that pass the score.

**Privacy.** Email addresses are never shown on the dashboard and never returned by the public API; they live only in Supabase and in each Gmail draft's To field. Founder names and roles are shown. Hunter data is licensed to you and must not be republished. Founders' LinkedIn links published on a company's own site may be stored with the founder record but are not displayed, and LinkedIn itself is never scraped.

## Approval workflow

Each draft on the **Drafts** page shows the subject and the full email, with **Approve & send** and **Reject** buttons.

- **Reject** marks the draft rejected. The Gmail draft is left untouched.
- **Approve** sends the email through the Gmail API (the existing draft is updated and sent, so it leaves the Drafts folder), then records the time and Gmail message id. The card shows a green *Sent* line with the full email, so reviewers do not need access to the mailbox.
- **A draft can be decided only once.** The status change is an atomic database claim, so double clicks or concurrent requests cannot send twice. A failed send returns the draft to *pending*.

The dashboard is public, so sending is restricted by design:

| Mode | Set by | Behaviour |
|---|---|---|
| **Demo** (default) | `DEMO_TO` | Approve always sends to the one address in `DEMO_TO` (subject prefixed `[DEMO]`, with a note of who it would have gone to). Nobody can use the button to email a third party. |
| **Live** | `SEND_MODE=live` and `APPROVAL_PIN` | Approve sends to the draft's real recipient and requires the PIN. Drafts with no recipient address are refused. |

## Architecture

| Piece | Tech | Role |
|---|---|---|
| Pipeline | Node.js (ES modules) | `src/` — ingest, extract, score, contact SOP, draft |
| LLM | Google Gemini (`gemini-3.8-flash`) | extraction, scoring, drafting, domain / founder lookup (with Google Search grounding) |
| Contact data | Hunter API (optional) | step 3 of the contact SOP |
| Database | Supabase (Postgres) | thesis, startups, outreach, seen articles, sources, run log |
| Email | Gmail API (OAuth) | creates drafts; sends only on Approve |
| Hosting | Vercel | dashboard (`public/`) and functions in `api/` |

### API (`api/`)

| Endpoint | Purpose |
|---|---|
| `/api/run` | Starts a run. Needs `Authorization: Bearer <CRON_SECRET>`; replies `202` immediately and works in the background |
| `/api/trigger` | The dashboard's **Run now** button (public): refuses if a run is in progress or one started in the last 3 minutes |
| `/api/status` | Read-only data for the dashboard. No email addresses, no secrets |
| `/api/thesis` | Saves edits to the thesis (validated, no password) |
| `/api/decision` | Approve / reject a draft (demo or live mode, atomic, one decision per draft) |

### Database (`supabase/schema.sql`)

- `thesis` — the editable configuration above.
- `startups` — every startup seen; `status` is `processing | drafted | rejected | error`; unique on `name_key` and `domain`; stores `fit_score`, `fit_rationale`, `fit_breakdown`, `founders`, and the contact (`contact_email`, `contact_type`, `contact_source`).
- `outreach` — one draft per startup (`startup_id` unique): subject, body, score, thesis version, recipient, Gmail draft id, plus the approval state (`status` is `pending | sent | rejected`, `decided_at`, `sent_to`, `gmail_message_id`).
- `seen_articles` — URLs already looked at, so the LLM is not paid for twice.
- `runs` — a log row per run with stats (including contacts per SOP step) and errors.
- `sources` — one row per news source with its latest health (`last_ok`, items returned) and running totals, shown on the Sources page.

### Scheduling

Runs are triggered several ways; the database makes overlapping runs safe.

1. **cron-job.org** calls `GET /api/run` every hour with `Authorization: Bearer <CRON_SECRET>` (the reliable hourly trigger).
2. **GitHub Actions** (`.github/workflows/daily.yml`) runs hourly at :17 as a backup. GitHub treats schedules as best-effort and may delay or skip runs.
3. **Vercel Cron** (`vercel.json`) runs once a day. The Vercel Hobby plan does not allow more frequent crons.
4. **Run now** button on the Runs page, for on-demand runs.

A run stops starting new work after 4 minutes (serverless limit); unprocessed articles are not marked seen and are picked up next time.

## Setup

### Requirements
Node.js 20+, a Supabase project, a Gemini API key, a Google Cloud project with the Gmail API enabled. A Hunter API key is optional.

### 1. Database
Paste `supabase/schema.sql` into the Supabase SQL Editor and run it. It creates every table and column and seeds a starter thesis.

### 2. Gmail access (one time)
1. In Google Cloud: enable the Gmail API, configure the OAuth consent screen, add yourself as a test user and the scope `https://www.googleapis.com/auth/gmail.compose`, and create a **Desktop app** OAuth client. Download it as `credentials.json`.
2. Run `node get_gmail_token.js` and approve in the browser. It writes `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN` to `.env`.

> While the OAuth app is in **Testing** mode the refresh token expires after **7 days**. Publish the app, or re-run the script and update the secrets (`.env`, GitHub, Vercel). Until then, drafting and Approve fail once it expires; nothing is lost, and affected startups are retried on the next run.

### 3. Environment variables
Copy `.env.example` to `.env` and fill in:

```
SUPABASE_URL=              # https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
HUNTER_API_KEY=            # optional, contact SOP step 3
```

On Vercel and GitHub Actions set the same variables as secrets. Vercel also needs:

| Variable | Purpose |
|---|---|
| `CRON_SECRET` | Any long random string; the schedulers send it as a Bearer token to `/api/run` |
| `DEMO_TO` | Inbox that Approve sends to in demo mode (not a secret) |
| `SEND_MODE` | Optional. `live` to send to real recipients (also set `APPROVAL_PIN`) |
| `APPROVAL_PIN` | Required only in live mode |
| `HUNTER_MAX_PER_RUN`, `HUNTER_MIN_CONFIDENCE` | Optional Hunter tuning (defaults 5 and 70) |

### 4. Run locally

```bash
npm install
npm run dry        # full pipeline, prints drafts, writes nothing to Supabase or Gmail
npm start          # real run: creates Gmail drafts and database rows
npm run test-gmail # creates one harmless test draft to check the Gmail connection
```

One-off maintenance scripts live in `src/` (`backfill-scores.js`, `backfill-hunter.js`, `backfill-sop.js`, `reformat-drafts.js`). They only update stored data and pending Gmail drafts; none of them sends email.

### 5. Deploy

```bash
vercel deploy --prod
gh secret set -f .env     # for the GitHub Actions backup schedule
```

## Dashboard

Dark navy theme with 3D buttons. Pages:

| Page | Shows |
|---|---|
| `/` | Clickable stats, how it works, thesis summary |
| `/startups` | Every evaluated startup, ranked by score; filter by status |
| `/drafts` | Fits: subject, the full email, founders, score breakdown, **Approve / Reject** buttons, and filters (Awaiting approval, Sent, Rejected, All) |
| `/rejected` | Non-fits, each with a score and the reason |
| `/sources` | Every news source, with status, items returned last run, totals and uptime |
| `/thesis` | The thesis and rubric, with the dropdown edit form |
| `/runs` | Run history and a **Run now** button |

## Design decisions and limitations

- **Human in the loop.** The pipeline only drafts; sending needs a person to click Approve, and the public site sends only to a test inbox unless live mode (with a PIN) is enabled.
- **Idempotent.** Re-running is always safe; duplicates are blocked by database constraints, not just application code.
- **Scoring noise.** LLM scores vary a little between runs. Scoring runs at temperature 0, includes the company's own website text, and uses the median of three near the cutoff, but scores close to the threshold can still land either side.
- **Contact coverage is partial.** Most startups do not publish a founder's address, so the SOP often ends at the company inbox or at nothing; the reviewer then adds the recipient in Gmail. Step 2 (personal websites) rarely finds anything and is slow, and Hunter's free plan allows only ~50 lookups a month.
- **Open endpoints.** Thesis editing and Run now need no password. Both are bounded (validation, cooldown) and neither can send email, but anyone with the link can use them.
- **Coverage.** Sources are public RSS and news search. Paywalled or script-blocking sites (some are skipped automatically) are not covered.
- **Extraction accuracy.** Amounts and rounds are read from short article snippets and can occasionally be wrong.
- **Existing scores are final.** Changing the thesis or rubric affects new startups only; previously scored startups are not re-ranked.

## Components map

A one-page map of the system in the same Trigger → Input → Context → Processing → AI → Output format: [docs/Components_Map_Funding_Outreach.pdf](docs/Components_Map_Funding_Outreach.pdf). (It predates the contact SOP, which sits inside the Processing column.)

## Project layout

```
api/          Vercel functions: run, trigger, status, thesis, decision
public/       Dashboard (static HTML pages, app.js, style.css)
src/          Pipeline: sources, extract, score, draft, contacts, personal-site, hunter,
              waterfall (contact SOP), gmail, run, thesis-config, plus maintenance scripts
supabase/     schema.sql
.github/      Workflow (backup schedule)
docs/         Components map (PDF and PNG)
```
