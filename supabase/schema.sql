-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

-- 1. Accelerator thesis. Rohit edits the active row; the pipeline reads it fresh every run.
create table if not exists thesis (
  id            bigint generated always as identity primary key,
  active        boolean not null default true,
  version       int not null default 1,
  description   text not null,                 -- free-text "what we look for"
  stages        text[] not null default '{seed,pre-seed}',
  sectors       text[] not null default '{}',  -- empty = any sector
  geographies   text[] not null default '{}',  -- empty = anywhere
  exclusions    text[] not null default '{}',  -- e.g. {crypto, gambling}
  min_score     int not null default 70,       -- fit threshold (0-100)
  sender_name   text not null default 'Rohit',
  sender_org    text not null default 'Our Accelerator',
  pitch         text not null default '',      -- what the accelerator offers
  updated_at    timestamptz not null default now()
);

-- Auto-bump version + updated_at on every edit so each draft records which thesis scored it.
create or replace function thesis_touch() returns trigger as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$ language plpgsql;

drop trigger if exists thesis_touch_trg on thesis;
create trigger thesis_touch_trg before update on thesis
  for each row execute function thesis_touch();

-- Only one active thesis at a time.
create unique index if not exists thesis_one_active on thesis (active) where active;

insert into thesis (description, sectors, geographies, exclusions, pitch)
select
  'Early-stage B2B software, fintech and climate startups with technical founders, building something genuinely new, that just raised a pre-seed or seed round and are likely to need help with go-to-market, hiring and follow-on fundraising.',
  '{saas,fintech,climate,ai,developer tools}', '{}', '{crypto,gambling,adult}',
  'A 12-week program with mentorship from operators, customer introductions and a path to Series A investors.'
where not exists (select 1 from thesis);

-- 2. Startups seen. Unique constraints are the dedupe guarantee.
create table if not exists startups (
  id           bigint generated always as identity primary key,
  name         text not null,
  name_key     text not null unique,           -- lowercased, punctuation stripped
  domain       text unique,                    -- nullable; unique when present
  round_type   text,
  amount_usd   numeric,
  announced_at timestamptz,
  source_url   text,
  description  text,
  status       text not null default 'processing'
                 check (status in ('processing','drafted','rejected','error')),
  error        text,
  created_at   timestamptz not null default now()
);

-- Score and reason for every evaluated startup, rejected ones included (shown on the dashboard).
alter table startups add column if not exists fit_score int;
alter table startups add column if not exists fit_rationale text;

alter table startups add column if not exists fit_breakdown jsonb;   -- per-criterion scores
alter table thesis   add column if not exists rubric jsonb;            -- editable scoring rubric

-- 3. Drafts. One per startup, enforced.
create table if not exists outreach (
  id             bigint generated always as identity primary key,
  startup_id     bigint not null unique references startups(id),
  fit_score      int not null,
  rationale      text,
  thesis_version int not null,
  to_email       text,
  subject        text not null,
  body           text not null,
  gmail_draft_id text,
  created_at     timestamptz not null default now()
);

-- 4. Articles already looked at, so we don't pay for the LLM twice.
create table if not exists seen_articles (
  url     text primary key,
  seen_at timestamptz not null default now()
);

-- 5. Run log.
create table if not exists runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  stats       jsonb,
  error       text
);

-- Server-side script uses the service-role key, which bypasses RLS. Lock out everyone else.
alter table thesis        enable row level security;
alter table startups      enable row level security;
alter table outreach      enable row level security;
alter table seen_articles enable row level security;
alter table runs          enable row level security;

-- 6. Sources and their latest health (shown on the dashboard's Sources page).
create table if not exists sources (
  url          text primary key,
  name         text not null,
  kind         text not null,
  last_checked timestamptz,
  last_ok      boolean,
  last_error   text,
  last_items   int not null default 0,   -- funding-related items in the last window
  total_items  int not null default 0,
  checks       int not null default 0,
  ok_checks    int not null default 0
);
alter table sources enable row level security;

-- 7. Approval workflow (dashboard Approve / Reject).
alter table outreach add column if not exists status text not null default 'pending'
  check (status in ('pending','sent','rejected'));
alter table outreach add column if not exists decided_at timestamptz;
alter table outreach add column if not exists sent_to text;
alter table outreach add column if not exists gmail_message_id text;
