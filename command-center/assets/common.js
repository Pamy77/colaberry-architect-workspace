/**
 * Shared shell for every Command Center page: fetches the live data files,
 * builds the topbar/tab nav/freshness banner, and owns the global
 * Sample/Real switch. Each page's own script calls CC.init(tabId, render)
 * once on DOMContentLoaded; `render` re-runs on every mode change, after
 * the data has loaded. CC.whenReady(fn) is for one-time setup (building a
 * search index, wiring form listeners) that also needs the data loaded
 * first but isn't tied to the mode switch.
 *
 * Content comes from .colaberry/plan.json (structural: requirements,
 * stories, releases, roles, data model — doesn't change with real-world
 * progress) and .colaberry/progress.json (what has actually happened:
 * system connection status, live features), fetched at runtime and merged
 * into CC.DATA. .colaberry/manifest.json carries the generation
 * timestamps used to show how old that data is.
 */
window.CC = (function () {
  "use strict";

  var MODE_KEY = "kpicc_mode";
  var DATA = null;
  var MANIFEST = null;
  var onRender = null;
  var loadPromise = null;
  var isReady = false;
  var readyQueue = [];

  var publicApi = {
    DATA: null,
    MANIFEST: null,
  };

  function fetchJson(path) {
    return fetch(path).then(function (res) {
      if (!res.ok) throw new Error("Failed to load " + path + " (HTTP " + res.status + ")");
      return res.json();
    });
  }

  function mergeData(plan, progress) {
    var merged = Object.assign({}, plan);
    var statusByName = {};
    (progress.systems || []).forEach(function (s) {
      statusByName[s.name] = s;
    });
    merged.systems = (plan.systems || []).map(function (s) {
      var live = statusByName[s.name] || {};
      return { name: s.name, status: live.status || "not_connected", lastChecked: live.lastChecked || null };
    });
    merged.liveReal = progress.live || [];
    return merged;
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([fetchJson("../.colaberry/plan.json"), fetchJson("../.colaberry/progress.json"), fetchJson("../.colaberry/manifest.json")]).then(
      function (results) {
        DATA = mergeData(results[0], results[1]);
        MANIFEST = results[2];
        publicApi.DATA = DATA;
        publicApi.MANIFEST = MANIFEST;
        isReady = true;
        readyQueue.forEach(function (fn) {
          fn();
        });
        readyQueue = [];
      }
    );
    return loadPromise;
  }

  function whenReady(fn) {
    if (isReady) fn();
    else readyQueue.push(fn);
  }

  function getMode() {
    return localStorage.getItem(MODE_KEY) === "sample" ? "sample" : "real";
  }

  function setMode(mode) {
    localStorage.setItem(MODE_KEY, mode);
    applyMode();
  }

  function applyMode() {
    var mode = getMode();
    document.body.classList.toggle("mode-sample", mode === "sample");
    document.querySelectorAll(".mode-switch button").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    });
    if (typeof onRender === "function") onRender(mode);
  }

  function buildTopbar() {
    var el = document.getElementById("topbar");
    if (!el) return;
    el.innerHTML =
      '<div class="topbar__brand">' +
      '<span class="topbar__name">' + DATA.product.name + "</span>" +
      '<span class="topbar__subtitle">Command Center</span>' +
      "</div>" +
      '<div class="mode-switch" role="group" aria-label="Sample or real data">' +
      '<button type="button" data-mode="real">Real</button>' +
      '<button type="button" data-mode="sample">Sample</button>' +
      "</div>";
    el.querySelectorAll(".mode-switch button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setMode(btn.dataset.mode);
      });
    });
  }

  function buildTabNav(activeId) {
    var el = document.getElementById("tabnav");
    if (!el) return;
    el.innerHTML = DATA.tabs
      .map(function (tab) {
        if (tab.built) {
          var cls = "tabnav__item" + (tab.id === activeId ? " is-active" : "");
          return '<a class="' + cls + '" href="' + tab.href + '">' + tab.label + "</a>";
        }
        return '<span class="tabnav__item is-disabled">' + tab.label + "</span>";
      })
      .join("");
  }

  function buildFreshnessBanner() {
    var main = document.querySelector("main.page");
    if (!main || !MANIFEST) return;
    var planAt = parseDate(MANIFEST.planGeneratedAt);
    var progAt = parseDate(MANIFEST.progressGeneratedAt);
    var older = planAt < progAt ? planAt : progAt;
    var ageMs = Date.now() - older.getTime();
    var ageDays = Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)));
    var stale = ageDays > 7;
    var el = document.createElement("div");
    el.className = "freshness-banner" + (stale ? " freshness-banner--stale" : "");
    el.textContent =
      "Data as of " + older.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " · " + ageDays + " day" + (ageDays === 1 ? "" : "s") + " old" +
      (stale ? " — more than a week old, may be out of date" : "");
    main.insertBefore(el, main.firstChild);
  }

  function renderLoadError(err) {
    var main = document.querySelector("main.page") || document.body;
    var el = document.createElement("div");
    el.className = "load-error";
    el.innerHTML =
      "<strong>Could not load project data.</strong><br/>" +
      CC_escapeHtml(err && err.message ? err.message : String(err)) +
      "<br/><br/>If you opened this file directly (double-clicked index.html), browsers block " +
      "fetching local files this way. Serve the repo root over a local web server instead, e.g. from the " +
      "repo root run <code>python -m http.server 8000</code>, then open " +
      "<code>http://localhost:8000/command-center/</code>.";
    main.insertBefore(el, main.firstChild);
  }

  function CC_escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function parseDate(str) {
    return new Date(str + "T00:00:00");
  }

  function fmtDate(str) {
    return parseDate(str).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function daysBetween(a, b) {
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  }

  function byId(list, id) {
    return list.filter(function (item) {
      return item.id === id;
    })[0];
  }

  function reqById(id) {
    return byId(DATA.requirements, id);
  }

  function storyById(id) {
    return byId(DATA.stories, id);
  }

  function releaseById(id) {
    return byId(DATA.releases, id);
  }

  function currentRelease(today) {
    for (var i = 0; i < DATA.releases.length; i++) {
      var r = DATA.releases[i];
      if (today >= parseDate(r.start) && today <= parseDate(r.end)) {
        return { release: r, state: "in_progress" };
      }
    }
    var first = DATA.releases[0];
    if (today < parseDate(first.start)) return { release: first, state: "not_started" };
    for (var j = 0; j < DATA.releases.length - 1; j++) {
      if (today > parseDate(DATA.releases[j].end) && today < parseDate(DATA.releases[j + 1].start)) {
        return { release: DATA.releases[j + 1], state: "not_started" };
      }
    }
    return { release: DATA.releases[DATA.releases.length - 1], state: "complete" };
  }

  function escapeHtml(str) {
    return CC_escapeHtml(str);
  }

  function confidenceBadge(confidence) {
    var cls = confidence === "explicit" ? "badge badge--explicit" : "badge badge--inferred";
    var label = confidence === "explicit" ? "explicit link" : "inferred link";
    return '<span class="' + cls + '">' + label + "</span>";
  }

  function detailLink(type, id, from) {
    return "detail.html?type=" + encodeURIComponent(type) + "&id=" + encodeURIComponent(id) + "&from=" + encodeURIComponent(from || "");
  }

  function qs() {
    return new URLSearchParams(window.location.search);
  }

  function init(tabId, render) {
    onRender = render;
    document.addEventListener("DOMContentLoaded", function () {
      load()
        .then(function () {
          buildTopbar();
          buildTabNav(tabId);
          buildFreshnessBanner();
          applyMode();
        })
        .catch(function (err) {
          renderLoadError(err);
        });
    });
  }

  Object.assign(publicApi, {
    getMode: getMode,
    setMode: setMode,
    parseDate: parseDate,
    fmtDate: fmtDate,
    daysBetween: daysBetween,
    reqById: reqById,
    storyById: storyById,
    releaseById: releaseById,
    currentRelease: currentRelease,
    escapeHtml: escapeHtml,
    confidenceBadge: confidenceBadge,
    detailLink: detailLink,
    qs: qs,
    whenReady: whenReady,
    init: init,
  });

  return publicApi;
})();
