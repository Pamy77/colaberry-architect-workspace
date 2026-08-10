/* Shared rendering, navigation, search, illustrations, copy buttons, and the Ask
   agent for the Gato LLC tech-stack knowledge base. Reads everything from the
   bare STACK identifier (see stack.js). Mirrors ../assets/site.js's shape. */
(function () {
  "use strict";

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var escapeHtml = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var FIT_WORD = { green: "great fit", amber: "good fit", red: "consider carefully" };
  var FIT_ICON = { green: "🟢", amber: "🟡", red: "🔴" };

  // ---------------------------------------------------------------------
  // Theme (shared storage key with the architecture site, so it stays in sync)
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
      var section = STACK.sections.filter(function (s) { return s.id === sectionId; })[0];
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

    add("summary", "Headline", STACK.headline);
    STACK.ratingKey.forEach(function (r) { add("summary", r.icon + " " + r.word, r.desc); });
    STACK.leastConfident.forEach(function (lc) {
      var item = itemById(lc.itemId);
      add("summary", "Least confident: " + (item ? item.component : lc.itemId), lc.reason);
    });

    STACK.items.forEach(function (it) {
      add("recommendations", it.component + " — " + it.recommendation, it.why + " " + it.caveat);
    });

    STACK.items.forEach(function (it) { add("prompts", it.component + " prompt", it.prompt); });

    STACK.items.slice().sort(function (a, b) { return a.learnOrder - b.learnOrder; }).forEach(function (it) {
      add("learning", "#" + it.learnOrder + " " + it.recommendation, it.why);
    });

    STACK.items.forEach(function (it) {
      (it.alternatives || []).forEach(function (alt) { add("alternatives", alt.name + " (instead of " + it.recommendation + ")", alt.whyNot); });
    });

    STACK.items.forEach(function (it) { add("lockin", it.component + " lock-in: " + it.undo.level, it.undo.note); });

    STACK.notCovered.forEach(function (n) { add("notcovered", "Not covered", n); });

    STACK.items.forEach(function (it) { add("appendix", it.component + " → " + it.recommendation, (it.fromDataFlow || "") + " " + it.why); });

    return entries;
  }
  function getIndex() {
    if (!SEARCH_INDEX) SEARCH_INDEX = buildIndex();
    return SEARCH_INDEX;
  }
  function itemById(id) { return STACK.items.filter(function (i) { return i.id === id; })[0]; }

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
  // Illustrations — inline SVG, generated from STACK
  // ---------------------------------------------------------------------
  function svgTag(inner, viewBox) {
    return '<svg viewBox="' + viewBox + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="illustration" style="width:100%;height:auto">' + inner + "</svg>";
  }
  function fitColorVar(fit) { return fit === "green" ? "var(--good)" : fit === "amber" ? "var(--warn)" : "var(--risk)"; }

  // Proportional bar of 🟢/🟡/🔴 — the reds called out
  function illustrationRatioBar() {
    var counts = { green: 0, amber: 0, red: 0 };
    STACK.items.forEach(function (it) { counts[it.fit]++; });
    var total = STACK.items.length;
    var barW = 560, x = 10, y = 40, h = 40;
    var inner = "";
    ["green", "amber", "red"].forEach(function (fit) {
      var w = (counts[fit] / total) * barW;
      inner += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" style="fill:' + fitColorVar(fit) + '"/>';
      if (counts[fit] > 0) {
        inner += '<text x="' + (x + w / 2) + '" y="' + (y + h / 2 + 5) + '" text-anchor="middle" style="fill:#fff;font:700 13px \'Segoe UI\',sans-serif">' + counts[fit] + "</text>";
      }
      x += w;
    });
    inner += '<rect x="10" y="' + y + '" width="' + barW + '" height="' + h + '" style="fill:none;stroke:var(--border);stroke-width:1"/>';
    var legend = "";
    ["green", "amber", "red"].forEach(function (fit, i) {
      var lx = 10 + i * 190;
      legend += '<rect x="' + lx + '" y="95" width="14" height="14" rx="3" style="fill:' + fitColorVar(fit) + '"/>' +
        '<text x="' + (lx + 20) + '" y="106" style="fill:var(--text);font:600 11px \'Segoe UI\',sans-serif">' + counts[fit] + " " + FIT_ICON[fit] + " " + FIT_WORD[fit] + "</text>";
    });
    return svgTag(inner + legend, "0 0 580 125");
  }

  // Whole stack as horizontal bands, coloured by fit rating
  function illustrationBands() {
    var w = 560, rowH = 30, gap = 8, x = 10, y = 10;
    var inner = "";
    STACK.items.forEach(function (it, i) {
      var yy = y + i * (rowH + gap);
      var labelW = 250;
      inner += '<rect x="' + x + '" y="' + yy + '" width="' + labelW + '" height="' + rowH + '" rx="6" style="fill:var(--card);stroke:var(--border);stroke-width:1"/>';
      inner += '<text x="' + (x + 10) + '" y="' + (yy + rowH / 2 + 4) + '" style="fill:var(--text);font:600 11px \'Segoe UI\',sans-serif">' + escapeHtml(it.component) + "</text>";
      var barX = x + labelW + 10, barW = w - labelW - 10;
      inner += '<rect x="' + barX + '" y="' + yy + '" width="' + barW + '" height="' + rowH + '" rx="6" style="fill:' + fitColorVar(it.fit) + ';opacity:0.85"/>';
      inner += '<text x="' + (barX + 10) + '" y="' + (yy + rowH / 2 + 4) + '" style="fill:#fff;font:600 11px \'Segoe UI\',sans-serif">' + escapeHtml(it.recommendation) + "</text>";
    });
    return svgTag(inner, "0 0 " + (x * 2 + w) + " " + (y * 2 + STACK.items.length * (rowH + gap)));
  }

  // Topology — what runs on Gato's own infrastructure vs. somebody else's
  function illustrationTopology() {
    var selfRun = STACK.items.filter(function (it) { return it.group !== "depend"; });
    var thirdParty = STACK.items.filter(function (it) { return it.group === "depend"; });
    var boxW = 260, gap = 40, y = 40, rowH = 24;
    var leftX = 10, rightX = leftX + boxW + gap;
    var maxRows = Math.max(selfRun.length, thirdParty.length);
    var boxH = 40 + maxRows * rowH;
    var inner = "";
    inner += '<rect x="' + leftX + '" y="' + y + '" width="' + boxW + '" height="' + boxH + '" rx="10" style="fill:var(--card);stroke:var(--accent);stroke-width:2"/>';
    inner += '<text x="' + (leftX + boxW / 2) + '" y="' + (y + 22) + '" text-anchor="middle" style="fill:var(--accent);font:700 12px \'Segoe UI\',sans-serif">Gato runs and controls</text>';
    selfRun.forEach(function (it, i) {
      inner += '<text x="' + (leftX + 14) + '" y="' + (y + 42 + i * rowH) + '" style="fill:var(--text);font:11px \'Segoe UI\',sans-serif">• ' + escapeHtml(it.component) + "</text>";
    });
    inner += '<rect x="' + rightX + '" y="' + y + '" width="' + boxW + '" height="' + boxH + '" rx="10" style="fill:var(--card);stroke:var(--risk);stroke-width:2"/>';
    inner += '<text x="' + (rightX + boxW / 2) + '" y="' + (y + 22) + '" text-anchor="middle" style="fill:var(--risk);font:700 12px \'Segoe UI\',sans-serif">Somebody else runs</text>';
    thirdParty.forEach(function (it, i) {
      inner += '<text x="' + (rightX + 14) + '" y="' + (y + 42 + i * rowH) + '" style="fill:var(--text);font:11px \'Segoe UI\',sans-serif">• ' + escapeHtml(it.recommendation) + "</text>";
    });
    return svgTag(inner, "0 0 " + (rightX + boxW + 10) + " " + (y + boxH + 10));
  }

  // Learning ladder — rungs in learnOrder
  function illustrationLadder() {
    var ordered = STACK.items.slice().sort(function (a, b) { return a.learnOrder - b.learnOrder; });
    var rungW = 520, rungH = 28, gap = 10, x = 40, y = 10;
    var inner = "";
    ordered.forEach(function (it, i) {
      var yy = y + i * (rungH + gap);
      var indent = i * 8;
      inner += '<line x1="20" y1="' + (yy + rungH / 2) + '" x2="' + (30 + indent) + '" y2="' + (yy + rungH / 2) + '" style="stroke:var(--muted);stroke-width:2"/>';
      inner += '<circle cx="' + (16) + '" cy="' + (yy + rungH / 2) + '" r="12" style="fill:var(--accent)"/>';
      inner += '<text x="16" y="' + (yy + rungH / 2 + 4) + '" text-anchor="middle" style="fill:#fff;font:700 11px sans-serif">' + it.learnOrder + "</text>";
      inner += '<rect x="' + (32 + indent) + '" y="' + yy + '" width="' + (rungW - indent) + '" height="' + rungH + '" rx="6" style="fill:var(--card);stroke:var(--border);stroke-width:1"/>';
      inner += '<text x="' + (44 + indent) + '" y="' + (yy + rungH / 2 + 4) + '" style="fill:var(--text);font:600 11px \'Segoe UI\',sans-serif">' + escapeHtml(it.recommendation) + "</text>";
    });
    return svgTag(inner, "0 0 " + (x + rungW + 20) + " " + (y + ordered.length * (rungH + gap)));
  }

  // Lock-in scale — easy → hard, points offset by index within the same level
  function illustrationLockScale() {
    var levels = ["easy", "medium", "hard"];
    var levelX = { easy: 90, medium: 300, hard: 510 };
    var w = 580, y = 34, trackY = 40;
    var inner = '<line x1="40" y1="' + trackY + '" x2="' + (w - 20) + '" y2="' + trackY + '" style="stroke:var(--border);stroke-width:4"/>';
    levels.forEach(function (lvl) {
      inner += '<text x="' + levelX[lvl] + '" y="20" text-anchor="middle" style="fill:var(--muted);font:700 11px \'Segoe UI\',sans-serif;text-transform:uppercase">' + lvl + "</text>";
    });
    var counters = { easy: 0, medium: 0, hard: 0 };
    STACK.items.forEach(function (it) {
      var lvl = it.undo.level;
      var idx = counters[lvl]++;
      var cx = levelX[lvl] + (idx % 2 === 0 ? -idx * 4 : idx * 4);
      var cy = trackY + 26 + Math.floor(idx / 2) * 26;
      var color = lvl === "hard" ? "var(--risk)" : lvl === "medium" ? "var(--warn)" : "var(--good)";
      inner += '<circle cx="' + cx + '" cy="' + cy + '" r="6" style="fill:' + color + '"/>';
      inner += '<text x="' + (cx + 10) + '" y="' + (cy + 4) + '" style="fill:var(--text);font:10px \'Segoe UI\',sans-serif">' + escapeHtml(it.component) + "</text>";
    });
    var maxCount = Math.max(counters.easy, counters.medium, counters.hard);
    var h = trackY + 26 + Math.ceil(maxCount / 2) * 26 + 20;
    return svgTag(inner, "0 0 " + w + " " + h);
  }

  var ILLUSTRATIONS = {
    summary: illustrationRatioBar,
    recommendations: illustrationBands,
    learning: illustrationLadder,
    lockin: illustrationLockScale,
    appendix: illustrationTopology
  };

  // ---------------------------------------------------------------------
  // Fullscreen zoom modal (shared with the architecture site's pattern)
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
  // Copy-to-clipboard buttons (navigator.clipboard, textarea+execCommand fallback
  // because the clipboard API is often blocked on file:// URLs)
  // ---------------------------------------------------------------------
  function copyText(text, btn) {
    function done() {
      var original = btn.textContent;
      btn.textContent = "✓ Copied";
      btn.classList.add("copied");
      setTimeout(function () { btn.textContent = original; btn.classList.remove("copied"); }, 1600);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* clipboard unavailable */ }
    document.body.removeChild(ta);
  }
  function wireCopyButtons() {
    $$("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () { copyText(btn.getAttribute("data-copy"), btn); });
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
      '<div class="brand"><a href="' + (isIndex ? "#" : "index.html") + '">Gato LLC Stack<span class="subbrand">tech-stack recommendation</span></a></div>' +
      '<div id="searchbox">' +
      '<input id="searchinput" type="search" placeholder="Search the stack…" aria-label="Search the stack" autocomplete="off"/>' +
      '<div id="searchresults" role="listbox"></div>' +
      "</div>" +
      '<a class="iconbtn" href="../index.html">← Blueprint</a>' +
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
    var idx = STACK.sections.findIndex(function (s) { return s.id === section.id; });
    var prev = STACK.sections[idx - 1];
    var next = STACK.sections[idx + 1];
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
    fab.textContent = "Ask the stack";
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
      '<div class="ask-foot"><textarea id="askInput" rows="2" placeholder="Ask about this tech stack…"></textarea>' +
      '<button class="iconbtn" id="askSend">Send</button></div>';
    document.body.appendChild(panel);

    var mode = localStorage.getItem("gato-stack-ask-mode") || "search";
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
    localStorage.setItem("gato-stack-ask-mode", mode);
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
        '<select id="askScope"><option value="section">This section only</option><option value="all">Whole stack recommendation</option></select>' +
        '<p class="ask-hint">Your key is stored only in this browser (localStorage) and sent directly to Anthropic — never to us.</p>' +
        "</div><div id=\"askResults\"></div>";
      $("#askKey").addEventListener("change", function () { localStorage.setItem("gato-anthropic-key", $("#askKey").value); });
    }
  }

  function handleAskSend() {
    var q = $("#askInput").value.trim();
    if (!q) return;
    var mode = localStorage.getItem("gato-stack-ask-mode") || "search";
    if (mode === "search") { askSearchMode(q); }
    else { askClaudeMode(q); }
  }

  function askSearchMode(query) {
    var results = $("#askResults");
    var hits = search(query, { limit: 6 });
    if (!hits.length) {
      results.innerHTML = '<div class="ask-answer-card">No matches found. That gap may itself be the answer — check <a href="07-notcovered.html">What This Doesn\'t Tell You</a>.</div>';
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
      ? { section: document.body.dataset.page, stack: STACK }
      : STACK;
    return "You are answering questions about the Gato LLC tech-stack recommendation below. " +
      "Answer ONLY using this data. If the answer isn't covered, say so plainly and point at the notCovered list. " +
      "Never talk the user out of a 🔴 (red, \"consider carefully\") rating — your job is to explain the tradeoff, not to soften it.\n\n" +
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

  function fitChip(fit) {
    return '<span class="fit ' + fit + '">' + FIT_ICON[fit] + " " + FIT_WORD[fit] + "</span>";
  }

  function renderSummary(main) {
    main.innerHTML =
      '<h1 class="page-title">Summary</h1><p class="page-desc">' + escapeHtml(STACK.project.oneLiner) + "</p>" +
      sectionIllustration("summary") +
      '<div class="card"><h3>Fit-Rating Key</h3><table><thead><tr><th>Icon</th><th>Rating</th><th>What it means</th></tr></thead><tbody>' +
      STACK.ratingKey.map(function (r) {
        return '<tr data-searchable="' + escapeHtml((r.word + " " + r.desc).toLowerCase()) + '"><td style="font-size:1.3rem">' + r.icon + "</td><td><strong>" + escapeHtml(r.word) + "</strong></td><td>" + escapeHtml(r.desc) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="card" data-searchable="' + escapeHtml(STACK.headline.toLowerCase()) + '"><h3>Where This Stack Is Most Likely to Break</h3><p>' + escapeHtml(STACK.headline) + "</p></div>" +
      '<div class="card"><h3>Least Confident Calls</h3>' +
      STACK.leastConfident.map(function (lc) {
        var item = itemById(lc.itemId);
        return '<div class="assumption-row" style="border-left:3px solid var(--warn);padding:10px 14px;margin-bottom:12px;background:color-mix(in srgb, var(--warn) 6%, transparent);border-radius:0 8px 8px 0" data-searchable="' + escapeHtml(((item ? item.component : "") + " " + lc.reason).toLowerCase()) + '">' +
          "<div>" + fitChip(item ? item.fit : "amber") + " <strong>" + escapeHtml(item ? item.component : lc.itemId) + '</strong></div><div style="color:var(--muted);font-size:0.88rem;margin-top:4px">' + escapeHtml(lc.reason) + "</div></div>";
      }).join("") + "</div>";
  }

  function groupTable(group) {
    var items = STACK.items.filter(function (it) { return it.group === group.id; });
    if (!items.length) return "";
    return '<div class="card"><h3>' + escapeHtml(group.title) + '</h3><p class="diagram-caption" style="border-top:none;padding-top:0;margin-top:-6px">' + escapeHtml(group.desc) + "</p>" +
      items.map(function (it) {
        return '<div style="padding:14px 0;border-top:1px solid var(--border)" data-searchable="' + escapeHtml((it.component + " " + it.recommendation + " " + it.why + " " + it.caveat).toLowerCase()) + '">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
          "<div><strong>" + escapeHtml(it.component) + "</strong> → " + escapeHtml(it.recommendation) +
          (it.fromDataFlow ? ' <span class="tag neutral">from data flow</span>' : "") + "</div>" +
          fitChip(it.fit) + "</div>" +
          '<p style="margin:8px 0 0">' + escapeHtml(it.why) + "</p>" +
          (it.caveat ? '<div class="caveat-block"><strong>Caveat:</strong> ' + escapeHtml(it.caveat) + "</div>" : "") +
          (it.fromDataFlow ? '<p class="diagram-caption">Why this isn\'t in the component list: ' + escapeHtml(it.fromDataFlow) + "</p>" : "") +
          "</div>";
      }).join("") + "</div>";
  }

  function renderRecommendations(main) {
    main.innerHTML =
      '<h1 class="page-title">Recommendations</h1><p class="page-desc">One technology per component from <code>architecture.md</code>, plus what the data flow needs that the component list never named.</p>' +
      sectionIllustration("recommendations") +
      STACK.groups.map(groupTable).join("");
  }

  function renderPrompts(main) {
    main.innerHTML =
      '<h1 class="page-title">Learning Prompts</h1><p class="page-desc">Copy any of these into a new Claude conversation — each already names Gato LLC so the answer is about this system, not a textbook.</p>' +
      '<div class="card">' +
      STACK.items.map(function (it) {
        return '<div style="padding:12px 0;border-top:1px solid var(--border)" data-searchable="' + escapeHtml((it.recommendation + " " + it.prompt).toLowerCase()) + '">' +
          '<div style="font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px">' + escapeHtml(it.recommendation) + "</div>" +
          '<div class="prompt-row"><span class="prompt-text">' + escapeHtml(it.prompt) + '</span>' +
          '<button class="iconbtn copybtn" data-copy="' + escapeHtml(it.prompt) + '">📋 Copy</button></div></div>';
      }).join("") + "</div>";
  }

  function renderLearning(main) {
    var ordered = STACK.items.slice().sort(function (a, b) { return a.learnOrder - b.learnOrder; });
    main.innerHTML =
      '<h1 class="page-title">Learning Path</h1><p class="page-desc">What to learn first, in order, and why that order.</p>' +
      sectionIllustration("learning") +
      '<div class="card">' +
      ordered.map(function (it) {
        return '<div class="ladder-row" data-searchable="' + escapeHtml((it.recommendation + " " + it.why).toLowerCase()) + '">' +
          '<div class="ladder-num">' + it.learnOrder + "</div>" +
          "<div><strong>" + escapeHtml(it.recommendation) + "</strong> — for the " + escapeHtml(it.component) +
          '<div style="color:var(--muted);font-size:0.88rem;margin-top:2px">' + escapeHtml(it.why) + "</div></div></div>";
      }).join("") + "</div>";
  }

  function renderAlternatives(main) {
    main.innerHTML =
      '<h1 class="page-title">Alternatives Considered</h1><p class="page-desc">What else we looked at for each component, and why it lost.</p>' +
      '<div class="card">' +
      STACK.items.map(function (it) {
        return (it.alternatives || []).map(function (alt) {
          return '<div class="alt-row" data-searchable="' + escapeHtml((it.component + " " + alt.name + " " + alt.whyNot).toLowerCase()) + '">' +
            '<div class="alt-name">' + escapeHtml(it.component) + ": chose " + escapeHtml(it.recommendation) + " over " + escapeHtml(alt.name) + "</div>" +
            '<div style="color:var(--muted);font-size:0.88rem;margin-top:4px">' + escapeHtml(alt.whyNot) + "</div></div>";
        }).join("");
      }).join("") + "</div>";
  }

  function undoDots(level) {
    var map = { easy: "●○○", medium: "●●○", hard: "●●●" };
    return '<span class="lock-dots ' + level + '">' + map[level] + "</span>";
  }

  function renderLockin(main) {
    var order = { hard: 0, medium: 1, easy: 2 };
    var sorted = STACK.items.slice().sort(function (a, b) { return order[a.undo.level] - order[b.undo.level]; });
    main.innerHTML =
      '<h1 class="page-title">Lock-In</h1><p class="page-desc">How hard each decision is to undo later — hardest first.</p>' +
      sectionIllustration("lockin") +
      '<div class="card">' +
      sorted.map(function (it) {
        return '<div class="lock-row" data-searchable="' + escapeHtml((it.component + " " + it.undo.note).toLowerCase()) + '">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
          "<strong>" + escapeHtml(it.component) + "</strong>" + undoDots(it.undo.level) + "</div>" +
          '<div style="color:var(--muted);font-size:0.88rem;margin-top:4px">' + escapeHtml(it.undo.note) + "</div></div>";
      }).join("") + "</div>";
  }

  function renderNotCovered(main) {
    main.innerHTML =
      '<h1 class="page-title">What This Doesn\'t Tell You</h1><p class="page-desc">Honest gaps — things this recommendation deliberately leaves out.</p>' +
      '<div class="card">' +
      STACK.notCovered.map(function (n) {
        return '<div class="notcovered-row" data-searchable="' + escapeHtml(n.toLowerCase()) + '">' + escapeHtml(n) + "</div>";
      }).join("") + "</div>";
  }

  function renderAppendix(main) {
    main.innerHTML =
      '<h1 class="page-title">Appendix</h1><p class="page-desc">Full cross-reference against <code>architecture.md</code>, and what runs on Gato\'s own infrastructure versus somebody else\'s.</p>' +
      sectionIllustration("appendix") +
      '<div class="card"><h3>Component Coverage</h3><table><thead><tr><th>Architecture Component</th><th>Recommended Technology</th><th>Fit</th><th>Source</th></tr></thead><tbody>' +
      STACK.items.map(function (it) {
        return '<tr data-searchable="' + escapeHtml((it.component + " " + it.recommendation).toLowerCase()) + '"><td>' + escapeHtml(it.component) + "</td><td>" + escapeHtml(it.recommendation) + "</td><td>" + fitChip(it.fit) + "</td><td>" +
          (it.fromDataFlow ? '<span class="tag neutral">data flow</span>' : '<span class="tag">component list</span>') + "</td></tr>";
      }).join("") + "</tbody></table>" +
      '<p class="diagram-caption">Every one of the 6 components in architecture.md has a row above, plus 2 rows the data-flow walkthrough required but never named.</p></div>';
  }

  function tilePreview(sectionId) {
    var fn = ILLUSTRATIONS[sectionId];
    return fn ? fn() : "";
  }
  function tileCount(sectionId) {
    switch (sectionId) {
      case "summary": return STACK.items.length + " recommendations, " + STACK.leastConfident.length + " to watch";
      case "recommendations": return STACK.items.length + " recommendations";
      case "prompts": return STACK.items.length + " prompts";
      case "learning": return STACK.items.length + " steps";
      case "alternatives": return STACK.items.reduce(function (n, it) { return n + (it.alternatives || []).length; }, 0) + " alternatives";
      case "lockin": return STACK.items.filter(function (it) { return it.undo.level === "hard"; }).length + " hard to undo";
      case "notcovered": return STACK.notCovered.length + " gaps";
      case "appendix": return STACK.items.length + " rows";
      default: return "";
    }
  }

  function renderIndex(main) {
    main.innerHTML =
      '<h1 class="page-title">Gato LLC — Stack Command Center</h1>' +
      '<p class="page-desc">' + escapeHtml(STACK.project.oneLiner) + "</p>" +
      '<div class="tiles">' +
      STACK.sections.map(function (s) {
        return '<a class="tile" href="' + s.file + '">' +
          '<div class="tile-preview">' + tilePreview(s.id) + "</div>" +
          '<div class="tile-body"><div class="tile-title">' + escapeHtml(s.title) + '</div>' +
          '<div class="tile-desc">' + escapeHtml(s.desc) + '</div>' +
          '<div class="tile-count">' + escapeHtml(tileCount(s.id)) + "</div></div></a>";
      }).join("") + "</div>";
  }

  var PAGE_RENDERERS = {
    summary: renderSummary,
    recommendations: renderRecommendations,
    prompts: renderPrompts,
    learning: renderLearning,
    alternatives: renderAlternatives,
    lockin: renderLockin,
    notcovered: renderNotCovered,
    appendix: renderAppendix
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
      var section = STACK.sections.filter(function (s) { return s.id === page; })[0];
      renderBreadcrumb(section);
      PAGE_RENDERERS[page](main);
      renderFooterNav(section);
    }

    renderAskPanel();
    initScrollProgressAndTop();
    initModal();
    wireExpandButtons();
    wireCopyButtons();
  });
})();
