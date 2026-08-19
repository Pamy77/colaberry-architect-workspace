(function () {
  "use strict";

  var DATA;

  function stat(value, label, sublabel, isSample) {
    return (
      '<div class="stat"><div class="stat__value">' +
      value +
      (isSample ? '<span class="stat__tag">SAMPLE</span>' : "") +
      "</div>" +
      '<div class="stat__label">' + label + (sublabel ? " · " + sublabel : "") + "</div></div>"
    );
  }

  function renderOverview(mode) {
    DATA = CC.DATA;
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var cur = CC.currentRelease(today);
    var release = cur.release;
    var noDates = cur.state === "no_dates";
    var total, elapsed, pct;
    if (!noDates) {
      total = CC.daysBetween(CC.parseDate(release.start), CC.parseDate(release.end)) || 1;
      elapsed = Math.max(0, Math.min(total, CC.daysBetween(CC.parseDate(release.start), today)));
      pct = Math.round((elapsed / total) * 100);
    }

    var stateLabel = noDates
      ? "Schedule not yet set"
      : { in_progress: "In progress", not_started: "Not started", complete: "Complete" }[cur.state];
    var subtitle = release.storyCount + " stories · " + (
      noDates
        ? "Weeks " + release.weekStart + "–" + release.weekEnd + " (exact dates not set yet)"
        : CC.fmtDate(release.start) + " → " + CC.fmtDate(release.end)
    );

    document.getElementById("release-state").innerHTML =
      '<div class="hero">' +
      "<div>" +
      "<h1>" + release.id.toUpperCase() + " — " + release.name + "</h1>" +
      "<p>" + subtitle + "</p>" +
      "</div>" +
      '<div class="hero__meta">' +
      '<span class="pill">' + stateLabel + "</span><br/>" +
      (!noDates && cur.state === "in_progress" ? "Day " + elapsed + " of " + total + " (" + pct + "%)" : "") +
      "</div>" +
      "</div>";

    var reqSafe = DATA.requirements.filter(function (r) {
      return r.type === "SAFE";
    }).length;
    var totalStories = DATA.stories.length;
    var systemsTotal = DATA.systems.length;
    var systemsConnected =
      mode === "sample" ? DATA.sample.systemsConnected : DATA.systems.filter(function (s) { return s.status === "connected"; }).length;

    document.getElementById("stat-grid").innerHTML =
      stat(DATA.releases.length, "Releases planned") +
      stat(totalStories, "Stories across all releases") +
      stat(DATA.requirements.length, "Requirements", reqSafe + " safety-critical") +
      stat(systemsConnected + " / " + systemsTotal, "Systems connected", null, mode === "sample");

    var liveEl = document.getElementById("live-list");
    var notLiveEl = document.getElementById("not-live-list");

    if (mode === "sample") {
      liveEl.innerHTML = DATA.sample.live
        .map(function (item) {
          return '<li><span class="dot dot--connected"></span>' + item + '<span class="stat__tag">SAMPLE</span></li>';
        })
        .join("");
    } else if (DATA.liveReal && DATA.liveReal.length > 0) {
      liveEl.innerHTML = DATA.liveReal
        .map(function (item) {
          return '<li><span class="dot dot--connected"></span>' + CC.escapeHtml(item) + "</li>";
        })
        .join("");
    } else {
      liveEl.innerHTML =
        '<li class="empty-state">Nothing is live yet. This Command Center is the first thing built — the KPI Copilot system itself has not started.</li>';
    }

    var notLiveItems = DATA.releases
      .filter(function (r) {
        return r.id !== release.id || cur.state !== "complete";
      })
      .map(function (r) {
        return r.id.toUpperCase() + " — " + r.name;
      });
    notLiveEl.innerHTML = notLiveItems
      .map(function (item) {
        return '<li><span class="dot"></span>' + item + "</li>";
      })
      .join("");

    document.getElementById("timeline").innerHTML = DATA.releases
      .map(function (r) {
        var isCurrent = !noDates && r.id === release.id && cur.state === "in_progress";
        var dates = noDates ? "Weeks " + r.weekStart + "–" + r.weekEnd : CC.fmtDate(r.start) + " – " + CC.fmtDate(r.end);
        return (
          '<div class="timeline__block' +
          (isCurrent ? " is-current" : "") +
          '">' +
          '<div class="timeline__block-id">' + r.id + "</div>" +
          '<div class="timeline__block-dates">' + dates + "</div>" +
          "</div>"
        );
      })
      .join("");

    var lastRelease = DATA.releases[DATA.releases.length - 1];
    document.getElementById("timeline-markers").textContent = noDates
      ? "Build-end and demo-day dates have not been set for this build yet."
      : "Last release (" + lastRelease.id.toUpperCase() + ") ends " + CC.fmtDate(lastRelease.end) + ".";
  }

  CC.init("overview", renderOverview);
})();
