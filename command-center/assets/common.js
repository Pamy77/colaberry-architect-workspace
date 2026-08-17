/**
 * Shared shell for every Command Center page: topbar, tab nav, and the
 * global Sample/Real switch. Each page's own script calls CC.init(tabId,
 * render) once on DOMContentLoaded; `render` re-runs on every mode change.
 */
window.CC = (function () {
  "use strict";

  var DATA = window.KPI_COPILOT_DATA;
  var MODE_KEY = "kpicc_mode";
  var onRender = null;

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
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
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
      buildTopbar();
      buildTabNav(tabId);
      applyMode();
    });
  }

  return {
    DATA: DATA,
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
    init: init,
  };
})();
