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
  ["/rejected", "Rejected", "rejected"], ["/sources", "Sources", "sources"], ["/thesis", "Thesis", "thesis"], ["/runs", "Runs", "runs"],
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

const decisionPill = (s, o) =>
  s.status === "drafted" && o?.status === "sent" ? '<span class="pill ok">Sent</span>'
  : s.status === "drafted" && o?.status === "rejected" ? '<span class="pill bad">Rejected</span>'
  : s.status === "drafted" ? '<span class="pill acc">Awaiting approval</span>' : statusPill(s.status);

function startupItem(s, { showDraft = true, rank = null } = {}) {
  const o = Array.isArray(s.outreach) ? s.outreach[0] : s.outreach;
  const score = s.fit_score ?? o?.fit_score;
  const why = s.status === "rejected" && s.fit_rationale ? `<p class="desc"><b>Why not a fit:</b> ${esc(s.fit_rationale)}</p>` : "";
  const bd = Array.isArray(s.fit_breakdown) && s.fit_breakdown.length ? `<details><summary>Score breakdown</summary>${s.fit_breakdown.map((c) => `<div class="row"><b style="min-width:170px">${esc(c.name)} <span class="meta">${c.weight}%</span></b><span class="score">${c.score}<span class="bar"><i style="width:${Math.min(100, c.score)}%"></i></span></span></div>`).join("")}</details>` : "";
  const act = !(showDraft && o) ? "" :
    o.status === "sent" ? `<div class="meta ok" style="margin-top:10px">✓ Sent to ${esc(o.sent_to)} · ${when(o.decided_at)}</div>`
    : o.status === "rejected" ? `<div class="meta bad" style="margin-top:10px">Rejected · ${when(o.decided_at)}</div>`
    : `<div class="acts"><button class="btn go" data-act="approve" data-id="${o.id}">Approve &amp; send</button><button class="btn danger" data-act="reject" data-id="${o.id}">Reject</button></div>`;
  const link = s.source_url ? `<a href="${esc(s.source_url)}" target="_blank" rel="noopener">Read the announcement ↗</a>` : "";
  return `<div class="item"><div class="item-h"><div>
    <div class="name">${rank ? `<span class="rank">#${rank}</span>` : ""}${esc(s.name)} ${decisionPill(s, o)}</div>
    <div class="meta">${roundName(s.round_type)} · ${money(s.amount_usd)}${s.domain ? " · " + esc(s.domain) : ""} · found ${when(s.created_at)}</div></div>
    ${score != null ? `<div class="score">${score}<span class="bar"><i style="width:${Math.min(100, score)}%"></i></span></div>` : ""}</div>
    <p class="desc">${esc(s.description)}</p>${why}
    ${bd}
    ${showDraft && o ? `<details><summary>${esc(o.subject)}</summary><pre class="mail">${esc(o.body)}</pre><div class="meta">Why it fits: ${esc(o.rationale)} · scored on thesis v${o.thesis_version}</div></details>` : ""}
    ${act}
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
    const f = new URLSearchParams(location.search).get("s") || "pending";
    head("Drafts", "Emails that fit the thesis. Approve sends the email through Gmail; Reject discards it. Nothing is sent until someone approves.");
    const chip = (v, l) => `<a href="/drafts?s=${v}" class="${f === v ? "on" : ""}">${l}</a>`;
    app.insertAdjacentHTML("beforeend", `<div id="modebar"></div><div class="chips">${chip("pending", "Awaiting approval")}${chip("sent", "Sent")}${chip("rejected", "Rejected")}${chip("all", "All")}</div>`);
    loading();
    const [d, m] = await Promise.all([api("view=startups&status=drafted"), api("view=mode").catch(() => ({ mode: "test" }))]);
    done();
    $("#modebar").innerHTML = m.mode === "live" ? "" : '<div class="card note"><b>Demo mode.</b> Approve really sends through Gmail, but always to a single test inbox, never to the startup. The sent email is shown here once approved.</div>';
    const list = d.startups.filter((x) => { const o = Array.isArray(x.outreach) ? x.outreach[0] : x.outreach; const st = o?.status || "pending"; return f === "all" || st === f; });
    app.insertAdjacentHTML("beforeend", `<div class="card">${list.length ? list.map((x, i) => startupItem(x, { rank: i + 1 })).join("") : '<div class="empty">Nothing here.</div>'}</div>`);
    app.onclick = async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const action = btn.dataset.act, id = Number(btn.dataset.id);
      if (action === "approve" && !confirm(m.mode === "live" ? "Send this email to the founder now?" : "Send this email now? (Demo mode: it goes to the test inbox, not to the startup.)")) return;
      const call = (pin) => fetch("/api/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, pin }) });
      document.querySelectorAll("[data-act]").forEach((b) => (b.disabled = true));
      btn.textContent = action === "approve" ? "Sending…" : "Rejecting…";
      let r = await call();
      let j = await r.json().catch(() => ({}));
      if (j.error === "pin_required") { const pin = prompt("Enter the approval PIN"); if (pin) { r = await call(pin); j = await r.json().catch(() => ({})); } }
      if (!r.ok) { alert(j.error === "pin_required" ? "Wrong or missing PIN." : j.error || "Something went wrong."); }
      location.reload();
    };
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

    // ---- dropdown building blocks ----
    const canon = (v, presets) => presets.find((p) => p.toLowerCase() === String(v).toLowerCase()) || v;
    const msField = (key, label, hint, presets, selected, allowCustom = true) => {
      const sel = (selected || []).map((v) => canon(v, presets));
      const all = [...new Set([...presets, ...sel])];
      return `<div class="ms-wrap" data-ms="${key}"><div class="lab">${label}<small>${hint}</small></div>
        <details class="ms"><summary><span class="ms-sum"></span></summary><div class="ms-panel">
          ${all.map((o) => `<label class="chk"><input type="checkbox" value="${esc(o)}" ${sel.includes(o) ? "checked" : ""}> ${esc(o)}</label>`).join("")}
          ${allowCustom ? `<div class="ms-add"><input placeholder="Add your own…" maxlength="60"><button type="button" class="btn ghost">Add</button></div>` : ""}
        </div></details></div>`;
    };
    const wireMs = (wrap, emptyText) => {
      const sum = wrap.querySelector(".ms-sum");
      const upd = () => {
        const v = [...wrap.querySelectorAll(".ms-panel input[type=checkbox]:checked")].map((i) => i.value);
        sum.innerHTML = v.length ? `<b>${v.length} selected</b> · ${esc(v.slice(0, 4).join(", "))}${v.length > 4 ? "…" : ""}` : `<span class="meta">${emptyText}</span>`;
      };
      wrap.addEventListener("change", upd);
      const add = wrap.querySelector(".ms-add");
      if (add) {
        const input = add.querySelector("input");
        const go = () => {
          const v = input.value.trim();
          if (!v) return;
          const exists = [...wrap.querySelectorAll(".ms-panel input[type=checkbox]")].find((i) => i.value.toLowerCase() === v.toLowerCase());
          if (exists) exists.checked = true;
          else add.insertAdjacentHTML("beforebegin", `<label class="chk"><input type="checkbox" value="${esc(v)}" checked> ${esc(v)}</label>`);
          input.value = ""; upd();
        };
        add.querySelector("button").onclick = go;
        input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } };
      }
      upd();
    };
    const picked = (key) => [...document.querySelectorAll(`[data-ms="${key}"] .ms-panel input[type=checkbox]:checked`)].map((i) => i.value);
    const selectOf = (name, options, current) => `<select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(current) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;

    const SECTORS = ["SaaS", "AI", "Developer tools", "Fintech", "Climate", "Healthtech", "Biotech", "Edtech", "Cybersecurity", "Enterprise software", "Data and analytics", "Deep tech", "Robotics", "Hardware / IoT", "Logistics and supply chain", "E-commerce", "Marketplaces", "Consumer", "Agritech", "Proptech", "Insurtech", "HR tech", "Legal tech", "Energy", "Mobility", "Gaming", "Media", "Web3 / Crypto"];
    const GEOS = ["India", "United States", "Canada", "United Kingdom", "Europe", "Middle East", "Africa", "Southeast Asia", "China", "Japan", "Australia and NZ", "Latin America"];
    const EXCL = ["Crypto", "Gambling", "Adult", "Agency", "Consulting", "Consumer apps", "Services businesses", "Alcohol", "Tobacco", "Defence and weapons", "Real estate", "Biotech / drug discovery"];
    const STAGES = ["pre-seed", "seed", "series-a"];
    const CRITERIA = {
      "Sector fit": "Does the company operate in a sector the accelerator targets?",
      "Stage and round": "Is it at the right stage, and is the round size typical for it?",
      "Product clarity": "Is there a clear product aimed at a specific customer?",
      "Founder strength": "Do the founders show relevant technical or domain strength?",
      "Need for the programme": "Would go-to-market, hiring and follow-on fundraising help they will soon need be valuable?",
      "Market size": "Is the market large enough to build a venture-scale company?",
      "Traction": "Is there evidence of customers, revenue or usage?",
      "Technical depth": "Is the technology hard to replicate?",
      "Business model": "Is there a clear, scalable way to make money?",
      "Geography fit": "Is the company based where the accelerator operates?",
      "Investor quality": "Is the round backed by credible investors?",
      "Defensibility": "Does the company have a moat such as data, network effects or IP?",
    };
    const TEMPLATES = {
      "B2B software and AI": "Early-stage startups building B2B software, AI infrastructure, fintech or climate technology, led by technical founders, that have just raised a pre-seed or seed round. We want companies with a clear product and a specific customer, who will soon need help with go-to-market, first hires and a Series A.",
      "Fintech": "Early-stage fintech startups (payments, lending infrastructure, insurtech, wealth tools) that have just raised a pre-seed or seed round, with a clear regulatory-aware product and a specific customer segment.",
      "Climate and energy": "Early-stage climate, energy and sustainability startups with a credible technology or business model that have just raised a pre-seed or seed round and need help scaling pilots into customers.",
      "Health and biotech": "Early-stage healthtech and biotech startups with a clear clinical or operational problem, credible founders and a pre-seed or seed round, who would benefit from industry introductions and regulatory guidance.",
      "Generalist": "Early-stage startups in any sector with a clear product, a specific customer and strong founders, that have just raised a pre-seed or seed round and are likely to need help with go-to-market, hiring and follow-on fundraising.",
    };
    const PITCHES = {
      "12-week programme": "A 12-week program with mentorship from experienced operators, customer introductions, and a path to Series A investors.",
      "Funding and mentorship": "Pre-seed funding, hands-on mentorship from founders who have scaled companies, and introductions to our network of investors.",
      "Community and access": "A community of early-stage founders, weekly office hours with industry experts, and warm introductions to design partners and customers.",
    };
    const SCORES = Array.from({ length: 14 }, (_, i) => 30 + i * 5).map((n) => [n, `${n} / 100`]);
    const WEIGHTS = Array.from({ length: 21 }, (_, i) => i * 5).map((n) => [n, `${n}%`]);

    const edit = () => {
      app.querySelector("#tv").remove();
      const scores = SCORES.some(([v]) => v === t.min_score) ? SCORES : [...SCORES, [t.min_score, `${t.min_score} / 100`]].sort((a, b) => a[0] - b[0]);
      app.insertAdjacentHTML("beforeend", `<form id="tv" class="card form" autocomplete="off">
        <h2>Edit thesis</h2>
        <label>Start from a template <small>Optional. Fills the description below, which you can still edit.</small>
          <select id="tpl"><option value="">Choose a template…</option>${Object.keys(TEMPLATES).map((k) => `<option>${esc(k)}</option>`).join("")}</select></label>
        <label>Description <small>What the accelerator looks for. The scorer reads this.</small><textarea name="description" rows="4" required>${esc(t.description)}</textarea></label>
        ${msField("stages", "Stages", "Which rounds to accept.", STAGES, t.stages, false)}
        ${msField("sectors", "Sectors", "Pick any number, or none for every sector.", SECTORS, t.sectors)}
        ${msField("geographies", "Geographies", "Pick any number, or none for anywhere.", GEOS, t.geographies)}
        ${msField("exclusions", "Excluded", "Anything matching is auto-rejected. Pick none to exclude nothing.", EXCL, t.exclusions)}
        <label>Minimum score to create a draft <small>Higher means fewer, stronger matches.</small>${selectOf("min_score", scores, t.min_score)}</label>
        <fieldset><legend>Scoring rubric <span id="wsum" class="pill"></span></legend>
          <div class="meta" style="margin-bottom:8px">Pick the criteria and how much each one counts. Weights must total 100%.</div>
          <div id="rows"></div><button type="button" class="btn ghost" id="addrow">+ Add criterion</button></fieldset>
        <div class="two"><label>Sender name<input name="sender_name" value="${esc(t.sender_name)}" required></label><label>Organisation<input name="sender_org" value="${esc(t.sender_org)}" required></label></div>
        <label>Pitch template <small>Optional. Fills the box below.</small>
          <select id="ptpl"><option value="">Choose a pitch…</option>${Object.keys(PITCHES).map((k) => `<option>${esc(k)}</option>`).join("")}</select></label>
        <label>What the email offers <small>One or two true sentences. The email repeats this.</small><textarea name="pitch" rows="3">${esc(t.pitch)}</textarea></label>
        <div id="msg" class="meta"></div>
        <div class="item-h" style="margin-top:12px"><button class="btn" type="submit">Save changes</button><button class="btn ghost" type="button" id="cancel">Cancel</button></div></form>`);

      document.querySelectorAll(".ms-wrap").forEach((w) => wireMs(w, { stages: "None selected", sectors: "Any sector", geographies: "Anywhere", exclusions: "None excluded" }[w.dataset.ms]));
      $("#tpl").onchange = (e) => { if (e.target.value) document.querySelector("[name=description]").value = TEMPLATES[e.target.value]; };
      $("#ptpl").onchange = (e) => { if (e.target.value) document.querySelector("[name=pitch]").value = PITCHES[e.target.value]; };

      const rows = $("#rows");
      const sum = () => {
        const total = [...rows.querySelectorAll("[name=w]")].reduce((a, i) => a + (Number(i.value) || 0), 0);
        const el = $("#wsum"); el.textContent = `Weights total ${total}%`; el.className = "pill " + (total === 100 ? "ok" : "bad");
      };
      const addRow = (c = { name: "Traction", weight: 0, description: CRITERIA["Traction"] }) => {
        const known = c.name in CRITERIA;
        const nameOpts = [...Object.keys(CRITERIA).map((k) => [k, k]), ["__custom", "Custom…"]];
        rows.insertAdjacentHTML("beforeend", `<div class="rrow">
          <div>${selectOf("n", nameOpts, known ? c.name : "__custom")}<input name="cn" placeholder="Criterion name" maxlength="60" value="${known ? "" : esc(c.name)}" style="${known ? "display:none;" : ""}margin-top:6px"></div>
          ${selectOf("w", WEIGHTS, c.weight)}
          <input name="d" placeholder="What good looks like" maxlength="300" value="${esc(c.description)}">
          <button type="button" class="x" title="Remove">×</button></div>`);
        sum();
      };
      rubric.forEach(addRow);
      rows.onchange = (e) => {
        const row = e.target.closest(".rrow");
        if (e.target.name === "n") {
          const custom = e.target.value === "__custom";
          row.querySelector("[name=cn]").style.display = custom ? "" : "none";
          if (!custom) row.querySelector("[name=d]").value = CRITERIA[e.target.value];
        }
        sum();
      };
      rows.onclick = (e) => { if (e.target.classList.contains("x") && rows.children.length > 1) { e.target.closest(".rrow").remove(); sum(); } };
      $("#addrow").onclick = () => rows.children.length < 8 && addRow();
      $("#cancel").onclick = () => { $("#tv").remove(); view(); };

      $("#tv").onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const body = { thesis: {
          description: f.get("description"), stages: picked("stages"), sectors: picked("sectors"), geographies: picked("geographies"),
          exclusions: picked("exclusions"), min_score: f.get("min_score"), sender_name: f.get("sender_name"), sender_org: f.get("sender_org"), pitch: f.get("pitch"),
          rubric: [...rows.children].map((r) => { const sel = r.querySelector("[name=n]").value;
            return { name: sel === "__custom" ? r.querySelector("[name=cn]").value : sel, weight: Number(r.querySelector("[name=w]").value), description: r.querySelector("[name=d]").value }; }),
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

  async sources() {
    head("Sources", "Everywhere the pipeline looks for funding news. Each run checks every source and records whether it responded and how many funding-related items it returned.");
    loading();
    const d = await api("view=sources");
    done();
    const list = d.sources || [];
    if (!list.length) { app.insertAdjacentHTML("beforeend", '<div class="card empty">Source health will appear after the next run.</div>'); return; }
    const ok = list.filter((x) => x.last_ok).length;
    const items = list.reduce((a, x) => a + (x.last_items || 0), 0);
    const kinds = [...new Set(list.map((x) => x.kind))];
    const rate = (x) => (x.checks ? Math.round((100 * x.ok_checks) / x.checks) + "%" : "—");
    app.insertAdjacentHTML("beforeend", `<div class="grid">
      <div class="card"><div class="num">${list.length}</div><div class="lbl">Sources tracked</div></div>
      <div class="card"><div class="num ok">${ok}</div><div class="lbl">Responding</div></div>
      <div class="card"><div class="num ${list.length - ok ? "bad" : ""}">${list.length - ok}</div><div class="lbl">Not responding</div></div>
      <div class="card"><div class="num">${items}</div><div class="lbl">Funding items last run</div></div></div>`);
    kinds.forEach((k) => {
      const rows = list.filter((x) => x.kind === k);
      app.insertAdjacentHTML("beforeend", `<div class="card scroll"><h2>${esc(k)} · ${rows.length}</h2><table><tr><th>Source</th><th>Status</th><th>Last run</th><th>Total</th><th>Uptime</th><th>Last checked</th></tr>${
        rows.map((x) => `<tr><td><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a></td><td>${x.last_ok ? '<span class="pill ok">ok</span>' : `<span class="pill bad" title="${esc(x.last_error)}">failing</span>`}</td><td>${x.last_items ?? 0}</td><td>${x.total_items ?? 0}</td><td>${rate(x)}</td><td>${when(x.last_checked)}</td></tr>`).join("")}</table></div>`);
    });
  },

  async runs() {
    head("Run history", "Each run scans the sources, skips known startups, and drafts for new fits. Runs happen every hour automatically; you can also start one now.");
    app.insertAdjacentHTML("beforeend", '<div class="acts" style="margin:0 0 20px"><button class="btn" id="runnow">▶ Run now</button><span class="meta" id="runmsg"></span></div>');
    loading();
    const d = await api("view=runs");
    done();
    app.insertAdjacentHTML("beforeend", `<div class="card scroll"><table><tr><th>Started</th><th>Articles</th><th>Funding</th><th>Duplicates</th><th>Rejected</th><th>Drafted</th><th>Status</th></tr>${
      d.runs.map((r) => { const x = r.stats || {}; const s = r.error ? '<span class="pill bad">failed</span>' : r.finished_at ? '<span class="pill ok">ok</span>' : '<span class="pill acc">running</span>';
        return `<tr><td>${when(r.started_at)}</td><td>${x.articles ?? "—"}</td><td>${x.funding ?? "—"}</td><td>${x.duplicates ?? "—"}</td><td>${x.rejected ?? "—"}</td><td>${x.drafted ?? "—"}</td><td>${s}</td></tr>`; }).join("")}</table></div>`);

    const btn = $("#runnow"), msg = $("#runmsg");
    const running = d.runs[0] && !d.runs[0].finished_at && Date.now() - Date.parse(d.runs[0].started_at) < 6 * 60 * 1000;
    const poll = (startedBefore) => {
      btn.disabled = true; btn.textContent = "Running…"; msg.className = "meta"; msg.textContent = "Scanning sources. This takes about a minute.";
      const t = setInterval(async () => {
        try {
          const { runs } = await api("view=runs");
          const latest = runs[0];
          if (latest && latest.finished_at && Date.parse(latest.started_at) >= startedBefore) { clearInterval(t); location.reload(); }
        } catch {}
      }, 5000);
    };
    if (running) poll(Date.parse(d.runs[0].started_at));
    btn.onclick = async () => {
      const t0 = Date.now() - 5000;
      btn.disabled = true; msg.className = "meta"; msg.textContent = "Starting…";
      try {
        const r = await fetch("/api/trigger", { method: "POST" });
        const j = await r.json().catch(() => ({}));
        if (r.status === 202) return poll(t0);
        msg.className = "meta bad"; msg.textContent = j.error || "Could not start a run."; btn.disabled = false;
      } catch { msg.className = "meta bad"; msg.textContent = "Could not reach the server."; btn.disabled = false; }
    };
  },
};

(views[page] || views.home)().catch(fail);
