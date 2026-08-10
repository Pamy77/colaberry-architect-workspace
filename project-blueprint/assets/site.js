/* Shared rendering, navigation, search, illustrations, and the Ask agent.
   Reads everything from the bare BLUEPRINT identifier (see blueprint.js). */
(function () {
  "use strict";

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var escapeHtml = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // ---------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------
  function initTheme() {
    var saved = localStorage.getItem("gato-theme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
  }
  function currentTheme() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr) return attr;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function toggleTheme() {
    var next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("gato-theme", next);
    reRenderMermaidTheme();
  }

  // ---------------------------------------------------------------------
  // Search index — plain JS, no model, no network, works offline
  // ---------------------------------------------------------------------
  var STOPWORDS = {};
  "the a an and or of to in on for is are it this that with as by be at from which who what when where how why not no its their them they he she we you your our if then than so but was were will would can could should do does did has have had".split(" ").forEach(function (w) { STOPWORDS[w] = true; });

  function tokenize(str) {
    return (str.toLowerCase().match(/[a-z0-9]+/g) || []).filter(function (t) { return t.length > 1 && !STOPWORDS[t]; });
  }
  function stem(word) {
    var w = word;
    if (w.length > 4 && /ing$/.test(w)) w = w.slice(0, -3);
    else if (w.length > 4 && /ies$/.test(w)) w = w.slice(0, -3) + "y";
    else if (w.length > 4 && /es$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 4 && /ed$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && /s$/.test(w)) w = w.slice(0, -1);
    return w;
  }

  var SEARCH_INDEX = null;
  function buildIndex() {
    var entries = [];
    var idCounter = 0;
    function add(sectionId, title, text) {
      if (!text) return;
      var section = BLUEPRINT.sections.filter(function (s) { return s.id === sectionId; })[0];
      var tokens = tokenize(title + " " + text);
      var stems = tokens.map(stem);
      entries.push({
        id: "e" + (idCounter++),
        sectionId: sectionId,
        file: section ? section.file : "index.html",
        sectionTitle: section ? section.title : "Command Center",
        title: title,
        titleLower: title.toLowerCase(),
        text: text,
        raw: (title + " " + text).toLowerCase(),
        tokens: tokens,
        stems: stems
      });
    }

    add("summary", "The Idea", BLUEPRINT.idea.text);
    add("summary", "Day-One Priority", BLUEPRINT.idea.dayOnePriority);
    BLUEPRINT.idea.users.forEach(function (u) { add("summary", u.name, u.role); });

    BLUEPRINT.components.forEach(function (c) { add("components", c.name, c.sentence + " " + c.words + " " + c.category); });

    add("architecture", "How It Fits Together", "flowchart of Dispatch Console, Driver App, Dispatch and Assignment API, Fleet and Load Database, Load Board Sync Worker, Broker and Load Board APIs");

    BLUEPRINT.dataFlow.forEach(function (d) { add("dataflow", "Step " + d.step, d.text); });

    BLUEPRINT.buildPhases.forEach(function (p) { add("buildorder", p.name, p.scope + " " + p.proves); });

    BLUEPRINT.assumptions.forEach(function (a) { add("assumptions", a.assumption, a.impact); });
    add("assumptions", BLUEPRINT.openQuestion.question, BLUEPRINT.openQuestion.branchA.detail + " " + BLUEPRINT.openQuestion.branchB.detail);

    BLUEPRINT.notCovered.forEach(function (n) { add("coverage", "Not covered", n); });
    BLUEPRINT.coverage.forEach(function (c) {
      var phase = BLUEPRINT.buildPhases.filter(function (p) { return p.id === c.phase; })[0];
      add("coverage", c.component, "introduced in " + (phase ? phase.name : c.phase));
    });

    return entries;
  }
  function getIndex() {
    if (!SEARCH_INDEX) SEARCH_INDEX = buildIndex();
    return SEARCH_INDEX;
  }

  function scoreEntry(entry, queryTokens, queryRaw) {
    var score = 0;
    queryTokens.forEach(function (qt) {
      var qs = stem(qt);
      if (entry.tokens.indexOf(qt) !== -1) score += 3;
      else if (entry.stems.indexOf(qs) !== -1) score += 1;
      if (entry.titleLower.indexOf(qt) !== -1) score += 2;
    });
    if (queryRaw.trim().length > 2 && entry.raw.indexOf(queryRaw.trim().toLowerCase()) !== -1) score += 5;
    return score;
  }
  function search(query, opts) {
    opts = opts || {};
    var qTokens = tokenize(query);
    if (!qTokens.length) return [];
    var results = getIndex()
      .filter(function (e) { return !opts.excludeSection || e.sectionId !== opts.excludeSection; })
      .map(function (e) { return { entry: e, score: scoreEntry(e, qTokens, query) }; })
      .filter(function (r) { return r.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, opts.limit || 8);
  }
  function highlightSnippet(entry, query) {
    var qTokens = tokenize(query);
    var text = entry.text;
    var lower = text.toLowerCase();
    var idx = -1;
    qTokens.forEach(function (t) { if (idx === -1) { var i = lower.indexOf(t); if (i !== -1) idx = i; } });
    if (idx === -1) idx = 0;
    var start = Math.max(0, idx - 40);
    var snippet = (start > 0 ? "…" : "") + text.slice(start, start + 140) + (start + 140 < text.length ? "…" : "");
    var safe = escapeHtml(snippet);
    qTokens.forEach(function (t) {
      var re = new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
      safe = safe.replace(re, "<mark>$1</mark>");
    });
    return safe;
  }

  // ---------------------------------------------------------------------
  // On-page "narrow what's visible" filter
  // ---------------------------------------------------------------------
  function filterPageContent(query) {
    var blocks = $$("[data-searchable]");
    if (!blocks.length) return;
    var qTokens = tokenize(query);
    blocks.forEach(function (b) {
      if (!qTokens.length) { b.style.display = ""; return; }
      var hay = b.getAttribute("data-searchable");
      var match = qTokens.some(function (t) { return hay.indexOf(t) !== -1; });
      b.style.display = match ? "" : "none";
    });
  }

  // ---------------------------------------------------------------------
  // Illustrations — inline SVG, generated from BLUEPRINT
  // ---------------------------------------------------------------------
  function svgTag(inner, viewBox) {
    return '<svg viewBox="' + viewBox + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="illustration" style="width:100%;height:auto">' + inner + "</svg>";
  }
  function ilBox(x, y, w, hgt, label, fillVar) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + hgt + '" rx="8" style="fill:var(--card);stroke:' + (fillVar || "var(--accent)") + ';stroke-width:2"/>' +
      '<text x="' + (x + w / 2) + '" y="' + (y + hgt / 2 + 4) + '" text-anchor="middle" style="fill:var(--text);font:600 11px \'Segoe UI\',sans-serif">' + escapeHtml(label) + "</text>";
  }
  function ilArrow(x1, y1, x2, y2) {
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" style="stroke:var(--muted);stroke-width:2" marker-end="url(#gatoArrow)"/>';
  }
  var ARROW_DEF = '<defs><marker id="gatoArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" style="fill:var(--muted)"/></marker></defs>';

  function illustrationSummary() {
    var inner = ARROW_DEF +
      ilBox(10, 40, 150, 60, "The Idea", "var(--info)") +
      ilArrow(160, 70, 200, 70) +
      ilBox(200, 20, 190, 100, "Day-One Priority", "var(--warn)") +
      ilArrow(390, 70, 430, 70) +
      ilBox(430, 40, 160, 60, BLUEPRINT.idea.users.length + " user groups", "var(--accent)");
    return svgTag(inner, "0 0 610 140");
  }

  function illustrationComponents() {
    var comps = BLUEPRINT.components;
    var cols = 3, w = 170, h = 54, gapx = 20, gapy = 26, startX = 10, startY = 10;
    var boxes = "", positions = {};
    comps.forEach(function (c, i) {
      var col = i % cols, row = Math.floor(i / cols);
      var x = startX + col * (w + gapx), y = startY + row * (h + gapy);
      positions[c.id] = { x: x + w / 2, y: y + h / 2, x1: x, y1: y };
      var stroke = c.category.indexOf("Third") !== -1 ? "var(--neutral)" : c.category.indexOf("Data") !== -1 ? "var(--info)" : "var(--accent)";
      boxes += ilBox(x, y, w, h, c.name, stroke);
    });
    var links = [["console", "api"], ["driverapp", "api"], ["api", "db"], ["worker", "brokers"], ["worker", "db"]];
    var lines = links.map(function (l) {
      var a = positions[l[0]], b = positions[l[1]];
      if (!a || !b) return "";
      return ilArrow(a.x, a.y, b.x, b.y);
    }).join("");
    var rows = Math.ceil(comps.length / cols);
    return svgTag(ARROW_DEF + lines + boxes, "0 0 " + (startX * 2 + cols * w + (cols - 1) * gapx) + " " + (startY * 2 + rows * h + (rows - 1) * gapy));
  }

  function illustrationDataflow() {
    var steps = BLUEPRINT.dataFlow;
    var w = 56, gap = 8, y = 30, r = 16;
    var groupColor = function (n) { return n <= 2 ? "var(--info)" : n <= 6 ? "var(--accent)" : "var(--warn)"; };
    var inner = "";
    steps.forEach(function (s, i) {
      var x = 20 + i * (w + gap);
      inner += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" style="fill:' + groupColor(s.step) + '"/>';
      inner += '<text x="' + x + '" y="' + (y + 4) + '" text-anchor="middle" style="fill:#fff;font:700 12px sans-serif">' + s.step + "</text>";
      if (i < steps.length - 1) inner += '<line x1="' + (x + r) + '" y1="' + y + '" x2="' + (x + w + gap - r) + '" y2="' + y + '" style="stroke:var(--border);stroke-width:3"/>';
    });
    var totalW = 20 + steps.length * (w + gap);
    return svgTag(inner, "0 0 " + totalW + " 60");
  }

  function illustrationBuildorder() {
    var phases = BLUEPRINT.buildPhases;
    var maxDays = Math.max.apply(null, phases.map(function (p) { return p.days; }));
    var barMax = 380, y = 10, rh = 24, gap = 14;
    var inner = "";
    phases.forEach(function (p, i) {
      var w = Math.round((p.days / maxDays) * barMax);
      var yy = y + i * (rh + gap);
      inner += '<rect x="140" y="' + yy + '" width="' + w + '" height="' + rh + '" rx="5" style="fill:' + (p.critical ? "var(--warn)" : "var(--accent)") + '"/>';
      inner += '<text x="135" y="' + (yy + rh / 2 + 4) + '" text-anchor="end" style="fill:var(--text);font:600 11px \'Segoe UI\',sans-serif">' + escapeHtml(p.name.replace(/^Phase \d+ — /, "")) + "</text>";
      inner += '<text x="' + (145 + w) + '" y="' + (yy + rh / 2 + 4) + '" style="fill:var(--muted);font:11px \'Segoe UI\',sans-serif">' + p.days + "d</text>";
    });
    return svgTag(inner, "0 0 520 " + (y + phases.length * (rh + gap)));
  }

  function illustrationAssumptions() {
    var oq = BLUEPRINT.openQuestion;
    var inner = ARROW_DEF +
      '<polygon points="230,10 300,45 230,80 160,45" style="fill:var(--card);stroke:var(--info);stroke-width:2"/>' +
      '<text x="230" y="49" text-anchor="middle" style="fill:var(--text);font:700 10px sans-serif">open question</text>' +
      ilArrow(200, 70, 130, 110) + ilArrow(260, 70, 330, 110) +
      ilBox(20, 110, 220, 60, oq.branchA.label, "var(--accent)") +
      ilBox(280, 110, 220, 60, oq.branchB.label, "var(--risk)");
    return svgTag(inner, "0 0 520 180");
  }

  function illustrationCoverage() {
    var comps = BLUEPRINT.coverage;
    var phases = BLUEPRINT.buildPhases;
    var cellW = 70, cellH = 26, labelW = 180, top = 24;
    var inner = "";
    phases.forEach(function (p, ci) {
      inner += '<text x="' + (labelW + ci * cellW + cellW / 2) + '" y="14" text-anchor="middle" style="fill:var(--muted);font:700 10px sans-serif">P' + (ci + 1) + "</text>";
    });
    comps.forEach(function (row, ri) {
      var y = top + ri * cellH;
      inner += '<text x="0" y="' + (y + cellH / 2 + 4) + '" style="fill:var(--text);font:11px \'Segoe UI\',sans-serif">' + escapeHtml(row.component) + "</text>";
      var introducedIdx = phases.findIndex(function (p) { return p.id === row.phase; });
      phases.forEach(function (p, ci) {
        var active = ci >= introducedIdx;
        var x = labelW + ci * cellW;
        inner += '<rect x="' + x + '" y="' + y + '" width="' + (cellW - 6) + '" height="' + (cellH - 6) + '" rx="4" style="fill:' + (active ? "var(--accent)" : "var(--border)") + ';opacity:' + (active ? "0.85" : "0.35") + '"/>';
      });
    });
    return svgTag(inner, "0 0 " + (labelW + phases.length * cellW) + " " + (top + comps.length * cellH));
  }

  var ILLUSTRATIONS = {
    summary: illustrationSummary,
    components: illustrationComponents,
    architecture: illustrationComponents,
    dataflow: illustrationDataflow,
    buildorder: illustrationBuildorder,
    assumptions: illustrationAssumptions,
    coverage: illustrationCoverage
  };

  // ---------------------------------------------------------------------
  // Mermaid
  // ---------------------------------------------------------------------
  function renderMermaidBlocks() {
    if (!window.mermaid) { setTimeout(renderMermaidBlocks, 150); return; }
    window.mermaid.initialize({ startOnLoad: false, theme: currentTheme() === "dark" ? "dark" : "default", securityLevel: "strict" });
    $$(".mermaid").forEach(function (el) {
      if (!el.getAttribute("data-src")) el.setAttribute("data-src", el.textContent);
    });
    window.mermaid.run({ querySelector: ".mermaid" }).catch(function (e) { console.error("mermaid render error", e); });
  }
  function reRenderMermaidTheme() {
    if (!window.mermaid) return;
    window.mermaid.initialize({ startOnLoad: false, theme: currentTheme() === "dark" ? "dark" : "default", securityLevel: "strict" });
    $$(".mermaid").forEach(function (el) {
      el.removeAttribute("data-processed");
      el.textContent = el.getAttribute("data-src") || el.textContent;
    });
    window.mermaid.run({ querySelector: ".mermaid" }).catch(function (e) { console.error("mermaid re-render error", e); });
  }

  // ---------------------------------------------------------------------
  // Fullscreen zoom modal (diagrams + illustrations)
  // ---------------------------------------------------------------------
  var zoomLevel = 1;
  function initModal() {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.id = "gatoModal";
    backdrop.innerHTML =
      '<div class="modal-box"><div class="modal-controls">' +
      '<button class="iconbtn" data-act="zoomout" aria-label="Zoom out">−</button>' +
      '<button class="iconbtn" data-act="zoomreset" aria-label="Reset zoom">Reset</button>' +
      '<button class="iconbtn" data-act="zoomin" aria-label="Zoom in">+</button>' +
      '<button class="iconbtn" data-act="close" aria-label="Close">Esc ✕</button>' +
      '</div><div class="modal-zoom-target" id="gatoModalTarget"></div></div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeModal(); });
    backdrop.addEventListener("click", function (e) {
      var act = e.target.getAttribute("data-act");
      if (act === "close") closeModal();
      if (act === "zoomin") setZoom(zoomLevel + 0.2);
      if (act === "zoomout") setZoom(zoomLevel - 0.2);
      if (act === "zoomreset") setZoom(1);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && backdrop.classList.contains("open")) closeModal();
    });
  }
  function setZoom(z) {
    zoomLevel = Math.max(0.4, Math.min(3, z));
    var t = $("#gatoModalTarget");
    if (t) t.style.transform = "scale(" + zoomLevel + ")";
  }
  function openModal(html) {
    zoomLevel = 1;
    var t = $("#gatoModalTarget");
    t.style.transform = "scale(1)";
    t.innerHTML = html;
    $("#gatoModal").classList.add("open");
    if (window.mermaid && t.querySelector(".mermaid")) {
      window.mermaid.run({ nodes: [t.querySelector(".mermaid")] }).catch(function () {});
    }
  }
  function closeModal() { $("#gatoModal").classList.remove("open"); }

  function wireExpandButtons() {
    $$("[data-expand]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = document.getElementById(btn.getAttribute("data-expand"));
        if (target) openModal(target.innerHTML);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Header / breadcrumbs / footer nav / scroll progress
  // ---------------------------------------------------------------------
  function renderHeader(isIndex) {
    var header = document.createElement("header");
    header.className = "topnav";
    header.innerHTML =
      '<div class="topnav-inner">' +
      '<div class="brand"><a href="' + (isIndex ? "#" : "index.html") + '">Gato LLC Blueprint</a></div>' +
      '<div id="searchbox">' +
      '<input id="searchinput" type="search" placeholder="Search the blueprint…" aria-label="Search the blueprint" autocomplete="off"/>' +
      '<div id="searchresults" role="listbox"></div>' +
      "</div>" +
      '<button class="iconbtn" id="themeBtn" aria-label="Toggle theme">🌓 Theme</button>' +
      '<button class="iconbtn" id="printBtn" aria-label="Print this page">🖨 Print</button>' +
      "</div>";
    document.body.insertBefore(header, document.body.firstChild);

    var bar = document.createElement("div");
    bar.id = "progressbar";
    document.body.insertBefore(bar, document.body.firstChild);

    $("#themeBtn").addEventListener("click", toggleTheme);
    $("#printBtn").addEventListener("click", function () { window.print(); });

    var input = $("#searchinput");
    var results = $("#searchresults");
    input.addEventListener("input", function () {
      var q = input.value.trim();
      filterPageContent(q);
      if (!q) { results.classList.remove("open"); results.innerHTML = ""; return; }
      var currentSection = document.body.dataset.page;
      var hits = search(q, { excludeSection: currentSection });
      if (!hits.length) {
        results.innerHTML = '<div class="result-card"><span class="ask-hint">No matches in other sections.</span></div>';
      } else {
        results.innerHTML = hits.map(function (r) {
          return '<a class="result-card" href="' + r.entry.file + '">' +
            '<div class="result-section">' + escapeHtml(r.entry.sectionTitle) + "</div>" +
            '<div><strong>' + escapeHtml(r.entry.title) + "</strong></div>" +
            '<div class="result-snippet">' + highlightSnippet(r.entry, q) + "</div>" +
            "</a>";
        }).join("");
      }
      results.classList.add("open");
    });
    document.addEventListener("click", function (e) {
      if (!$("#searchbox").contains(e.target)) results.classList.remove("open");
    });
  }

  function renderBreadcrumb(section) {
    var el = document.createElement("div");
    el.className = "breadcrumbs";
    el.innerHTML = '<a href="index.html">Command Center</a> / ' + escapeHtml(section.title);
    $("main") ? document.body.insertBefore(el, $("main")) : document.body.appendChild(el);
  }

  function renderFooterNav(section) {
    var idx = BLUEPRINT.sections.findIndex(function (s) { return s.id === section.id; });
    var prev = BLUEPRINT.sections[idx - 1];
    var next = BLUEPRINT.sections[idx + 1];
    var foot = document.createElement("footer");
    foot.className = "pagefoot";
    foot.innerHTML =
      '<div class="foot-nav">' +
      (prev ? '<a class="foot-link" href="' + prev.file + '"><small>← Previous</small>' + escapeHtml(prev.title) + "</a>" : '<span class="foot-link" style="visibility:hidden"></span>') +
      '<a class="foot-link center" href="index.html"><small>Home</small>Command Center</a>' +
      (next ? '<a class="foot-link next" href="' + next.file + '"><small>Next →</small>' + escapeHtml(next.title) + "</a>" : '<span class="foot-link" style="visibility:hidden"></span>') +
      "</div>";
    document.body.appendChild(foot);
  }

  function initScrollProgressAndTop() {
    var bar = $("#progressbar");
    var top = document.createElement("button");
    top.id = "backtotop";
    top.className = "iconbtn";
    top.setAttribute("aria-label", "Back to top");
    top.textContent = "↑";
    document.body.appendChild(top);
    top.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });
    window.addEventListener("scroll", function () {
      var h = document.documentElement;
      var pct = (h.scrollTop / (h.scrollHeight - h.clientHeight || 1)) * 100;
      if (bar) bar.style.width = pct + "%";
      top.classList.toggle("show", h.scrollTop > 400);
    });
  }

  // ---------------------------------------------------------------------
  // Ask panel — Search mode (no key) + Claude mode (needs key)
  // ---------------------------------------------------------------------
  var MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];

  function renderAskPanel() {
    var fab = document.createElement("button");
    fab.id = "askfab";
    fab.textContent = "Ask the blueprint";
    document.body.appendChild(fab);

    var panel = document.createElement("div");
    panel.id = "askpanel";
    panel.innerHTML =
      '<div class="ask-head"><strong>Ask</strong>' +
      '<div class="ask-modes">' +
      '<button class="ask-mode-btn active" data-mode="search">Search · no key</button>' +
      '<button class="ask-mode-btn" data-mode="claude">Claude · needs key</button>' +
      "</div>" +
      '<button class="iconbtn" id="askClose" aria-label="Close ask panel" style="margin-left:6px">✕</button>' +
      "</div>" +
      '<div class="ask-body" id="askBody"></div>' +
      '<div class="ask-foot"><textarea id="askInput" rows="2" placeholder="Ask about this blueprint…"></textarea>' +
      '<button class="iconbtn" id="askSend">Send</button></div>';
    document.body.appendChild(panel);

    var mode = localStorage.getItem("gato-ask-mode") || "search";
    setAskMode(mode);

    fab.addEventListener("click", function () { panel.classList.add("open"); });
    $("#askClose").addEventListener("click", function () { panel.classList.remove("open"); });
    $$(".ask-mode-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { setAskMode(btn.getAttribute("data-mode")); });
    });
    $("#askSend").addEventListener("click", handleAskSend);
    $("#askInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAskSend(); }
    });
  }

  function setAskMode(mode) {
    localStorage.setItem("gato-ask-mode", mode);
    $$(".ask-mode-btn").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-mode") === mode); });
    var body = $("#askBody");
    if (mode === "search") {
      body.innerHTML = '<p class="ask-hint">Answers come from the same local index as the nav search. No API key, no network, no model — works offline.</p><div id="askResults"></div>';
    } else {
      var storedKey = localStorage.getItem("gato-anthropic-key") || "";
      body.innerHTML =
        '<div class="ask-config">' +
        '<input type="password" id="askKey" placeholder="Paste your Anthropic API key" value="' + escapeHtml(storedKey) + '"/>' +
        '<select id="askModel">' + MODELS.map(function (m) { return '<option value="' + m + '">' + m + "</option>"; }).join("") + "</select>" +
        '<select id="askScope"><option value="section">This section only</option><option value="all">Whole blueprint</option></select>' +
        '<p class="ask-hint">Your key is stored only in this browser (localStorage) and sent directly to Anthropic — never to us.</p>' +
        "</div><div id=\"askResults\"></div>";
      $("#askKey").addEventListener("change", function () { localStorage.setItem("gato-anthropic-key", $("#askKey").value); });
    }
  }

  function handleAskSend() {
    var q = $("#askInput").value.trim();
    if (!q) return;
    var mode = localStorage.getItem("gato-ask-mode") || "search";
    if (mode === "search") { askSearchMode(q); }
    else { askClaudeMode(q); }
  }

  function askSearchMode(query) {
    var results = $("#askResults");
    var hits = search(query, { limit: 6 });
    if (!hits.length) {
      results.innerHTML = '<div class="ask-answer-card">No matches found. That gap may itself be the answer — check the <a href="07-coverage.html">What This Doesn\'t Cover</a> page.</div>';
      return;
    }
    results.innerHTML = hits.map(function (r) {
      return '<a class="result-card" href="' + r.entry.file + '">' +
        '<div class="result-section">' + escapeHtml(r.entry.sectionTitle) + "</div>" +
        '<div><strong>' + escapeHtml(r.entry.title) + "</strong></div>" +
        '<div class="result-snippet">' + highlightSnippet(r.entry, query) + "</div>" +
        "</a>";
    }).join("");
  }

  function buildSystemPrompt(scope) {
    var data = scope === "section"
      ? { section: document.body.dataset.page, blueprint: BLUEPRINT }
      : BLUEPRINT;
    return "You are answering questions about the Gato LLC system blueprint below. " +
      "Answer ONLY using this data. If the answer isn't covered, say so plainly and point at the notCovered list or assumptions.\n\n" +
      JSON.stringify(data);
  }

  function askClaudeMode(question) {
    var results = $("#askResults");
    var key = $("#askKey") ? $("#askKey").value.trim() : "";
    var model = $("#askModel") ? $("#askModel").value : MODELS[0];
    var scope = $("#askScope") ? $("#askScope").value : "all";
    if (!key) { results.innerHTML = '<div class="ask-err">Paste an API key first, or switch to Search mode (no key needed).</div>'; return; }

    results.innerHTML = '<div class="ask-hint">Asking Claude…</div>';
    var body = { model: model, max_tokens: 16000, system: buildSystemPrompt(scope), messages: [{ role: "user", content: question }] };
    if (model !== "claude-haiku-4-5") body.output_config = { effort: "low" };

    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) {
        var msg = "Request failed (" + res.status + ").";
        if (res.status === 401) msg = "Invalid API key.";
        if (res.status === 429) msg = "Rate limited — try again shortly.";
        throw new Error(msg);
      }
      return res.json();
    }).then(function (data) {
      if (data.stop_reason === "refusal") {
        results.innerHTML = '<div class="ask-err">Claude declined to answer that. Try rephrasing, or switch to Search mode.</div>';
        return;
      }
      var text = (data.content || []).filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n\n");
      results.innerHTML = '<div class="ask-answer-card">' + escapeHtml(text || "(no text content returned)").replace(/\n/g, "<br/>") + "</div>";
    }).catch(function (err) {
      results.innerHTML = '<div class="ask-err">' + escapeHtml(err.message || "Network error.") + " You can fall back to Search mode (no key needed).</div>";
    });
  }

  // ---------------------------------------------------------------------
  // Page content renderers
  // ---------------------------------------------------------------------
  function sectionIllustration(sectionId) {
    var fn = ILLUSTRATIONS[sectionId];
    if (!fn) return "";
    var id = "il-" + sectionId + "-" + Math.random().toString(36).slice(2, 7);
    return '<div class="card"><div class="illustration" id="' + id + '">' + fn() + '</div>' +
      '<button class="iconbtn" data-expand="' + id + '">⤢ Expand</button></div>';
  }

  function renderSummary(main) {
    var idea = BLUEPRINT.idea;
    main.innerHTML =
      '<h1 class="page-title">The Idea</h1><p class="page-desc">Who this is for, what it does, and the one thing it must get right on day one.</p>' +
      sectionIllustration("summary") +
      '<div class="card" data-searchable="' + escapeHtml(idea.text.toLowerCase()) + '"><h3>Project</h3><p>' + escapeHtml(idea.text) + "</p></div>" +
      '<div class="card" data-searchable="' + escapeHtml(idea.dayOnePriority.toLowerCase()) + '"><h3>Day-One Priority</h3><p><strong>' + escapeHtml(idea.dayOnePriority) + '</strong></p>' +
      '<p class="diagram-caption">The component that exists specifically to guarantee this: <span class="tag">' + escapeHtml(idea.guarantorComponent) + "</span></p></div>" +
      '<div class="card"><h3>Who Uses This</h3><table><thead><tr><th>User</th><th>Role</th></tr></thead><tbody>' +
      idea.users.map(function (u) {
        return '<tr data-searchable="' + escapeHtml((u.name + " " + u.role).toLowerCase()) + '"><td>' + escapeHtml(u.name) + "</td><td>" + escapeHtml(u.role) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function renderComponents(main) {
    main.innerHTML =
      '<h1 class="page-title">Components</h1><p class="page-desc">' + BLUEPRINT.components.length + ' components — each one traced back to the words in the idea that required it.</p>' +
      sectionIllustration("components") +
      '<div class="card"><table><thead><tr><th>Component</th><th>Category</th><th>What it does</th><th>Why it exists</th></tr></thead><tbody>' +
      BLUEPRINT.components.map(function (c) {
        return '<tr data-searchable="' + escapeHtml((c.name + " " + c.sentence + " " + c.words).toLowerCase()) + '">' +
          "<td><strong>" + escapeHtml(c.name) + "</strong></td>" +
          '<td><span class="tag ' + (c.category.indexOf("Third") !== -1 ? "neutral" : "") + '">' + escapeHtml(c.category) + "</span></td>" +
          "<td>" + escapeHtml(c.sentence) + "</td>" +
          "<td>" + escapeHtml(c.words) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function renderArchitecture(main) {
    main.innerHTML =
      '<h1 class="page-title">How It Fits Together</h1><p class="page-desc">Every arrow is data or an action crossing a boundary.</p>' +
      '<div class="diagram-wrap"><button class="iconbtn expand-btn" data-expand="archDiagram">⤢ Expand</button>' +
      '<div id="archDiagram"><div class="mermaid">' + BLUEPRINT.diagrams.flowchart + "</div></div>" +
      '<p class="diagram-caption">Rectangles are things Gato builds, the cylinder is the permanent data store, and the hexagon is an outside party Gato does not control.</p></div>';
  }

  function renderDataflow(main) {
    main.innerHTML =
      '<h1 class="page-title">Data Flow</h1><p class="page-desc">A single load, walked from broker to delivery, in ' + BLUEPRINT.dataFlow.length + ' steps.</p>' +
      sectionIllustration("dataflow") +
      '<div class="card"><ol class="flow-list">' +
      BLUEPRINT.dataFlow.map(function (d) {
        return '<li data-searchable="' + escapeHtml(d.text.toLowerCase()) + '">' + escapeHtml(d.text) + "</li>";
      }).join("") + "</ol></div>" +
      '<div class="diagram-wrap"><button class="iconbtn expand-btn" data-expand="seqDiagram">⤢ Expand</button>' +
      '<div id="seqDiagram"><div class="mermaid">' + BLUEPRINT.diagrams.sequence + "</div></div>" +
      '<p class="diagram-caption">Same walkthrough, shown as a sequence of messages between the actors and services above.</p></div>';
  }

  function renderBuildorder(main) {
    var maxDays = Math.max.apply(null, BLUEPRINT.buildPhases.map(function (p) { return p.days; }));
    main.innerHTML =
      '<h1 class="page-title">Build Order</h1><p class="page-desc">What ships first, and what each phase proves — the make-or-break phase is highlighted.</p>' +
      sectionIllustration("buildorder") +
      '<div class="card">' +
      BLUEPRINT.buildPhases.map(function (p) {
        var pct = Math.round((p.days / maxDays) * 100);
        return '<div class="phase-row" data-searchable="' + escapeHtml((p.name + " " + p.scope + " " + p.proves).toLowerCase()) + '">' +
          '<div class="phase-name">' + escapeHtml(p.name) + (p.critical ? ' <span class="tag" style="background:color-mix(in srgb, var(--warn) 18%, transparent);color:var(--warn)">make-or-break</span>' : "") + "</div>" +
          '<div class="phase-bar-track"><div class="phase-bar-fill' + (p.critical ? " critical" : "") + '" style="width:' + pct + '%"></div></div>' +
          "<div><strong>Scope:</strong> " + escapeHtml(p.scope) + "</div>" +
          "<div><strong>Proves:</strong> " + escapeHtml(p.proves) + "</div></div>";
      }).join("") + "</div>" +
      '<div class="diagram-wrap"><button class="iconbtn expand-btn" data-expand="ganttDiagram">⤢ Expand</button>' +
      '<div id="ganttDiagram"><div class="mermaid">' + BLUEPRINT.diagrams.gantt + "</div></div></div>";
  }

  function renderAssumptions(main) {
    var oq = BLUEPRINT.openQuestion;
    main.innerHTML =
      '<h1 class="page-title">Assumptions</h1><p class="page-desc">What we guessed to move forward, and what breaks if we guessed wrong.</p>' +
      '<div class="card"><h3>The Question That Would Most Change This Design</h3><p>' + escapeHtml(oq.question) + "</p></div>" +
      sectionIllustration("assumptions") +
      '<div class="card">' +
      BLUEPRINT.assumptions.map(function (a) {
        return '<div class="assumption-row" data-searchable="' + escapeHtml((a.assumption + " " + a.impact).toLowerCase()) + '">' +
          "<div>" + escapeHtml(a.assumption) + '</div><div class="assumption-impact">Impact: ' + escapeHtml(a.impact) + "</div></div>";
      }).join("") + "</div>";
  }

  function renderCoverage(main) {
    main.innerHTML =
      '<h1 class="page-title">What This Design Does Not Cover</h1><p class="page-desc">Honest gaps, plus where each component enters the build.</p>' +
      sectionIllustration("coverage") +
      '<div class="card"><h3>Out of Scope Today</h3>' +
      BLUEPRINT.notCovered.map(function (n) {
        return '<div class="notcovered-row" data-searchable="' + escapeHtml(n.toLowerCase()) + '">' + escapeHtml(n) + "</div>";
      }).join("") + "</div>" +
      '<div class="card"><h3>Component Coverage by Phase</h3><table><thead><tr><th>Component</th><th>Introduced In</th></tr></thead><tbody>' +
      BLUEPRINT.coverage.map(function (c) {
        var phase = BLUEPRINT.buildPhases.filter(function (p) { return p.id === c.phase; })[0];
        return '<tr data-searchable="' + escapeHtml((c.component + " " + (phase ? phase.name : "")).toLowerCase()) + '"><td>' + escapeHtml(c.component) + "</td><td>" + escapeHtml(phase ? phase.name : c.phase) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function tilePreview(sectionId) {
    var fn = ILLUSTRATIONS[sectionId];
    return fn ? fn() : "";
  }
  function tileCount(sectionId) {
    switch (sectionId) {
      case "summary": return BLUEPRINT.idea.users.length + " user groups";
      case "components": return BLUEPRINT.components.length + " components";
      case "architecture": return BLUEPRINT.components.length + " nodes";
      case "dataflow": return BLUEPRINT.dataFlow.length + " steps";
      case "buildorder": return BLUEPRINT.buildPhases.length + " phases";
      case "assumptions": return BLUEPRINT.assumptions.length + " assumptions";
      case "coverage": return BLUEPRINT.notCovered.length + " deferred";
      default: return "";
    }
  }

  function renderIndex(main) {
    main.innerHTML =
      '<h1 class="page-title">Gato LLC — Blueprint Command Center</h1>' +
      '<p class="page-desc">' + escapeHtml(BLUEPRINT.idea.text) + "</p>" +
      '<div class="tiles">' +
      BLUEPRINT.sections.map(function (s) {
        return '<a class="tile" href="' + s.file + '">' +
          '<div class="tile-preview">' + tilePreview(s.id) + "</div>" +
          '<div class="tile-body"><div class="tile-title">' + escapeHtml(s.title) + '</div>' +
          '<div class="tile-desc">' + escapeHtml(s.desc) + '</div>' +
          '<div class="tile-count">' + escapeHtml(tileCount(s.id)) + "</div></div></a>";
      }).join("") + "</div>";
  }

  var PAGE_RENDERERS = {
    summary: renderSummary,
    components: renderComponents,
    architecture: renderArchitecture,
    dataflow: renderDataflow,
    buildorder: renderBuildorder,
    assumptions: renderAssumptions,
    coverage: renderCoverage
  };

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    var page = document.body.dataset.page;
    var main = $("#app");

    if (page === "index") {
      renderHeader(true);
      renderIndex(main);
    } else {
      renderHeader(false);
      var section = BLUEPRINT.sections.filter(function (s) { return s.id === page; })[0];
      renderBreadcrumb(section);
      PAGE_RENDERERS[page](main);
      renderFooterNav(section);
    }

    renderAskPanel();
    initScrollProgressAndTop();
    initModal();
    wireExpandButtons();
    renderMermaidBlocks();
  });
})();
