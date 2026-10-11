const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const when = (t) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const money = (n) => (!n ? "Undisclosed" : n >= 1e6 ? "$" + +(n / 1e6).toFixed(1) + "M" : "$" + Math.round(n / 1e3) + "K");
const roundName = (r) => ({ "pre-seed": "Pre-seed", seed: "Seed" }[r] || r || "—");
const tags = (a) => (a && a.length ? a.map((x) => `<span class="pill">${esc(x)}</span>`).join("") : '<span class="meta">Any</span>');
const page = document.body.dataset.page;
const REPO = "https://github.com/sid1935/Funding-Outreach";

const DEFAULT_RUBRIC = [
  { name: "Sector fit", weight: 30, description: "Does the company operate in a sector the accelerator targets?" },
  { name: "Stage and round", weight: 20, description: "Is it at the right stage, and is the round size typical for it?" },
  { name: "Product clarity", weight: 20, description: "Is there a clear product aimed at a specific customer?" },
  { name: "Founder strength", weight: 15, description: "Do the founders show relevant technical or domain strength?" },
  { name: "Need for the programme", weight: 15, description: "Would go-to-market, hiring and follow-on fundraising help they will soon need be valuable?" },
];
const NAV = [
  ["/", "Overview", "home"], ["/startups", "Startups", "startups"], ["/drafts", "Drafts", "drafts"],
  ["/rejected", "Rejected", "rejected"], ["/thesis", "Thesis", "thesis"], ["/runs", "Runs", "runs"],
];
document.body.insertAdjacentHTML("afterbegin", `<header class="nav"><div class="nav-in">
  <a class="brand" href="/"><span class="logo"></span>Funding Outreach</a>
  <nav>${NAV.map(([h, l, k]) => `<a href="${h}" class="${k === page ? "on" : ""}">${l}</a>`).join("")}</nav></div></header>`);
document.body.insertAdjacentHTML("beforeend", `<footer><span>Drafts only: nothing is sent automatically.</span><a href="${REPO}" target="_blank" rel="noopener">Source on GitHub</a><span>Scans for new funding news every hour</span></footer>`);

const app = $("#app");
const api = (q) => fetch("/api/status?" + q).then((r) => (r.ok ? r.json() : Promise.reject()));
const loading = () => (app.insertAdjacentHTML("beforeend", '<div id="ld"><div class="skeleton"></div><div class="skeleton" style="width:70%"></div></div>'));
const done = () => $("#ld")?.remove();
const fail = () => { done(); app.insertAdjacentHTML("beforeend", '<div class="card empty">Data is unavailable right now. Try again in a minute.</div>'); };
const head = (h, lead) => (app.innerHTML = `<h1>${h}</h1><p class="lead">${lead}</p>`);

const statusPill = (s) => ({ drafted: '<span class="pill ok">Draft ready</span>', rejected: '<span class="pill bad">Not a fit</span>', error: '<span class="pill">Retrying</span>', processing: '<span class="pill acc">Processing</span>' }[s] || "");

function startupItem(s, { showDraft = true, rank = null } = {}) {
  const o = Array.isArray(s.outreach) ? s.outreach[0] : s.outreach;
  const score = s.fit_score ?? o?.fit_score;
  const why = s.status === "rejected" && s.fit_rationale ? `<p class="desc"><b>Why not a fit:</b> ${esc(s.fit_rationale)}</p>` : "";
  const bd = Array.isArray(s.fit_breakdown) && s.fit_breakdown.length ? `<details><summary>Score breakdown</summary>${s.fit_breakdown.map((c) => `<div class="row"><b style="min-width:170px">${esc(c.name)} <span class="meta">${c.weight}%</span></b><span class="score">${c.score}<span class="bar"><i style="width:${Math.min(100, c.score)}%"></i></span></span></div>`).join("")}</details>` : "";
  const link = s.source_url ? `<a href="${esc(s.source_url)}" target="_blank" rel="noopener">Read the announcement ↗</a>` : "";
  return `<div class="item"><div class="item-h"><div>
    <div class="name">${rank ? `<span class="rank">#${rank}</span>` : ""}${esc(s.name)} ${statusPill(s.status)}</div>
    <div class="meta">${roundName(s.round_type)} · ${money(s.amount_usd)}${s.domain ? " · " + esc(s.domain) : ""} · found ${when(s.created_at)}</div></div>
    ${score != null ? `<div class="score">${score}<span class="bar"><i style="width:${Math.min(100, score)}%"></i></span></div>` : ""}</div>
    <p class="desc">${esc(s.description)}</p>${why}
    ${bd}
    ${showDraft && o ? `<details><summary>${esc(o.subject)}</summary><pre class="mail">${esc(o.body)}</pre><div class="meta">Why it fits: ${esc(o.rationale)} · scored on thesis v${o.thesis_version}</div></details>` : ""}
    <div class="meta" style="margin-top:8px">${link}</div></div>`;
}

const views = {
  async home() {
    head("Funding outreach, on autopilot.", "Finds startups that just announced a seed or pre-seed round, scores them against your accelerator’s thesis, and leaves a researched, personalised draft in Gmail. Non-fits are never shown.");
    loading();
    const d = await api("view=overview");
    done();
    const c = d.counts || {};
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    const r = d.lastRun;
    app.insertAdjacentHTML("beforeend", `<div class="grid">
      <a class="card kpi" href="/startups"><div class="num">${total}</div><div class="lbl">Startups evaluated</div></a>
      <a class="card kpi" href="/drafts"><div class="num ok">${c.drafted || 0}</div><div class="lbl">Drafts ready</div></a>
      <a class="card kpi" href="/rejected"><div class="num bad">${c.rejected || 0}</div><div class="lbl">Rejected (no fit)</div></a>
      <a class="card kpi" href="/runs"><div class="num sm">${r ? when(r.finished_at || r.started_at) : "—"}</div><div class="lbl">Last run ${r ? (r.error ? '· <span class="bad">failed</span>' : "· <span class='ok'>ok</span>") : ""}</div></a></div>
      <div class="card"><h2>How it works</h2><div class="steps">
        <div class="step"><b>Scan</b><span>About 50 feeds and searches, every run.</span></div>
        <div class="step"><b>Extract</b><span>Gemini keeps only seed and pre-seed rounds.</span></div>
        <div class="step"><b>Dedupe</b><span>Anyone already seen is skipped, enforced by the database.</span></div>
        <div class="step"><b>Score</b><span>Fit against the live thesis in Supabase.</span></div>
        <div class="step"><b>Draft</b><span>A researched email lands in Gmail Drafts.</span></div></div></div>
      <div class="card"><h2>Active thesis · v${d.thesis?.version}</h2>
        <div class="row"><b>Stages</b><span>${tags(d.thesis?.stages)}</span></div>
        <div class="row"><b>Sectors</b><span>${tags(d.thesis?.sectors)}</span></div>
        <div class="row"><b>Min. score</b><span class="pill acc">${d.thesis?.min_score}</span></div>
        <a href="/thesis">See the full thesis →</a></div>`);
  },

  async startups() {
    const st = new URLSearchParams(location.search).get("status") || "";
    head("All startups", "Every startup the pipeline has evaluated, ranked by fit score. A startup is scored once, when it first appears; its rank never gets recalculated.");
    const chip = (v, l) => `<a href="/startups${v ? "?status=" + v : ""}" class="${st === v ? "on" : ""}">${l}</a>`;
    app.insertAdjacentHTML("beforeend", `<div class="chips">${chip("", "All")}${chip("drafted", "Draft ready")}${chip("rejected", "Rejected")}</div>`);
    loading();
    const d = await api("view=startups" + (st ? "&status=" + st : ""));
    done();
    app.insertAdjacentHTML("beforeend", `<div class="card">${d.startups.length ? d.startups.map((s, i) => startupItem(s, { rank: i + 1 })).join("") : '<div class="empty">Nothing here yet.</div>'}</div>`);
  },

  async drafts() {
    head("Drafts ready", "Fits the thesis. Each email is waiting in Gmail Drafts for review. Nothing is sent automatically.");
    loading();
    const d = await api("view=startups&status=drafted");
    done();
    app.insertAdjacentHTML("beforeend", `<div class="card">${d.startups.length ? d.startups.map((s, i) => startupItem(s, { rank: i + 1 })).join("") : '<div class="empty">No drafts yet.</div>'}</div>`);
  },

  async rejected() {
    head("Rejected", "Evaluated and judged not a fit for the thesis, ranked by score. Rohit never sees these in his inbox.");
    loading();
    const d = await api("view=startups&status=rejected");
    done();
    app.insertAdjacentHTML("beforeend", `<div class="card">${d.startups.length ? d.startups.map((s, i) => startupItem(s, { showDraft: false, rank: i + 1 })).join("") : '<div class="empty">Nothing rejected yet.</div>'}</div>`);
  },

  async thesis() {
    head("The thesis", "What the accelerator looks for and how startups are scored. It lives in the database and is read fresh on every run, so edits apply to the next run with no code change.");
    loading();
    const { thesis: t } = await api("view=thesis");
    done();
    const rubric = t.rubric?.length ? t.rubric : DEFAULT_RUBRIC;
    const view = () => {
      app.querySelector("#tv")?.remove();
      app.insertAdjacentHTML("beforeend", `<div id="tv">
        <div class="card"><div class="item-h"><h2>Version ${t.version} · updated ${when(t.updated_at)}</h2><button class="btn" id="edit">Edit thesis</button></div>
          <p style="margin-top:0">${esc(t.description)}</p>
          <div class="row"><b>Stages</b><span>${tags(t.stages)}</span></div>
          <div class="row"><b>Sectors</b><span>${tags(t.sectors)}</span></div>
          <div class="row"><b>Geographies</b><span>${tags(t.geographies)}</span></div>
          <div class="row"><b>Excluded</b><span>${t.exclusions?.length ? tags(t.exclusions) : '<span class="meta">None</span>'}</span></div>
          <div class="row"><b>Min. score</b><span class="pill acc">${t.min_score} / 100</span></div></div>
        <div class="card"><h2>Scoring rubric</h2><p class="meta" style="margin-top:0">Each startup is scored 0 to 100 on every criterion; the final score is the weighted average.</p>
          ${rubric.map((c) => `<div class="item"><div class="item-h"><div class="name" style="font-size:15px">${esc(c.name)}</div><div class="score">${c.weight}%<span class="bar"><i style="width:${Math.min(100, c.weight * 2)}%"></i></span></div></div><div class="meta">${esc(c.description)}</div></div>`).join("")}</div>
        <div class="card"><h2>What the email offers</h2><p style="margin:0">${esc(t.pitch)}</p><p class="meta" style="margin-bottom:0">Sent as ${esc(t.sender_name || "—")} from ${esc(t.sender_org)}</p></div></div>`);
      $("#edit").onclick = edit;
    };
    const edit = () => {
      app.querySelector("#tv").remove();
      const stages = ["pre-seed", "seed", "series-a"];
      app.insertAdjacentHTML("beforeend", `<form id="tv" class="card form" autocomplete="off">
        <h2>Edit thesis</h2>
        <label>Description <small>What the accelerator looks for. The scorer reads this.</small><textarea name="description" rows="5" required>${esc(t.description)}</textarea></label>
        <fieldset><legend>Stages</legend>${stages.map((s) => `<label class="chk"><input type="checkbox" name="stage" value="${s}" ${t.stages.includes(s) ? "checked" : ""}> ${s}</label>`).join("")}</fieldset>
        <label>Sectors <small>Comma separated. Leave empty for any.</small><input name="sectors" value="${esc((t.sectors || []).join(", "))}"></label>
        <label>Geographies <small>Comma separated. Leave empty for anywhere.</small><input name="geographies" value="${esc((t.geographies || []).join(", "))}"></label>
        <label>Excluded <small>Comma separated. Anything matching is auto-rejected. Leave empty for none.</small><input name="exclusions" value="${esc((t.exclusions || []).join(", "))}"></label>
        <label>Minimum score to draft <small>0 to 100</small><input name="min_score" type="number" min="0" max="100" value="${t.min_score}" required></label>
        <fieldset><legend>Scoring rubric <span id="wsum" class="pill"></span></legend><div id="rows"></div><button type="button" class="btn ghost" id="addrow">+ Add criterion</button></fieldset>
        <div class="two"><label>Sender name<input name="sender_name" value="${esc(t.sender_name)}" required></label><label>Organisation<input name="sender_org" value="${esc(t.sender_org)}" required></label></div>
        <label>What the email offers <small>One or two true sentences. The email repeats this.</small><textarea name="pitch" rows="3">${esc(t.pitch)}</textarea></label>
        <label>Admin password<input name="password" type="password" required></label>
        <div id="msg" class="meta"></div>
        <div class="item-h" style="margin-top:12px"><button class="btn" type="submit">Save changes</button><button class="btn ghost" type="button" id="cancel">Cancel</button></div></form>`);
      const rows = $("#rows");
      const sum = () => {
        const total = [...rows.querySelectorAll("[name=w]")].reduce((a, i) => a + (Number(i.value) || 0), 0);
        const el = $("#wsum"); el.textContent = `Weights total ${total}`; el.className = "pill " + (total === 100 ? "ok" : "bad");
      };
      const addRow = (c = { name: "", weight: 0, description: "" }) => {
        rows.insertAdjacentHTML("beforeend", `<div class="rrow"><input name="n" placeholder="Criterion" value="${esc(c.name)}" required><input name="w" type="number" min="0" max="100" value="${c.weight}" required title="Weight %"><input name="d" placeholder="What good looks like" value="${esc(c.description)}"><button type="button" class="x" title="Remove">×</button></div>`);
        sum();
      };
      rubric.forEach(addRow);
      rows.oninput = sum;
      rows.onclick = (e) => { if (e.target.classList.contains("x") && rows.children.length > 1) { e.target.parentElement.remove(); sum(); } };
      $("#addrow").onclick = () => rows.children.length < 8 && addRow();
      $("#cancel").onclick = () => { $("#tv").remove(); view(); };
      $("#tv").onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const csv = (k) => String(f.get(k) || "").split(",").map((x) => x.trim()).filter(Boolean);
        const body = { password: f.get("password"), thesis: {
          description: f.get("description"), stages: f.getAll("stage"), sectors: csv("sectors"), geographies: csv("geographies"),
          exclusions: csv("exclusions"), min_score: f.get("min_score"), sender_name: f.get("sender_name"), sender_org: f.get("sender_org"), pitch: f.get("pitch"),
          rubric: [...rows.children].map((r) => ({ name: r.querySelector("[name=n]").value, weight: Number(r.querySelector("[name=w]").value), description: r.querySelector("[name=d]").value })),
        } };
        const msg = $("#msg"); msg.className = "meta"; msg.textContent = "Saving…";
        try {
          const r = await fetch("/api/thesis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || "Could not save");
          msg.className = "meta ok"; msg.textContent = `Saved as version ${j.version}. Applies from the next run.`;
          setTimeout(() => location.reload(), 1200);
        } catch (err) { msg.className = "meta bad"; msg.textContent = err.message; }
      };
    };
    view();
  },

  async runs() {
    head("Run history", "Each run scans the feeds, skips known startups, and drafts for new fits.");
    loading();
    const d = await api("view=runs");
    done();
    app.insertAdjacentHTML("beforeend", `<div class="card scroll"><table><tr><th>Started</th><th>Articles</th><th>Funding</th><th>Duplicates</th><th>Rejected</th><th>Drafted</th><th>Status</th></tr>${
      d.runs.map((r) => { const x = r.stats || {}; const s = r.error ? '<span class="pill bad">failed</span>' : r.finished_at ? '<span class="pill ok">ok</span>' : '<span class="pill acc">running</span>';
        return `<tr><td>${when(r.started_at)}</td><td>${x.articles ?? "—"}</td><td>${x.funding ?? "—"}</td><td>${x.duplicates ?? "—"}</td><td>${x.rejected ?? "—"}</td><td>${x.drafted ?? "—"}</td><td>${s}</td></tr>`; }).join("")}</table></div>`);
  },
};

(views[page] || views.home)().catch(fail);
