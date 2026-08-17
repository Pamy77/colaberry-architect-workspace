(function () {
  "use strict";

  var DATA = CC.DATA;

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
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var cur = CC.currentRelease(today);
    var release = cur.release;
    var total = CC.daysBetween(CC.parseDate(release.start), CC.parseDate(release.end)) || 1;
    var elapsed = Math.max(0, Math.min(total, CC.daysBetween(CC.parseDate(release.start), today)));
    var pct = Math.round((elapsed / total) * 100);

    var stateLabel = { in_progress: "In progress", not_started: "Not started", complete: "Complete" }[cur.state];

    document.getElementById("release-state").innerHTML =
      '<div class="hero">' +
      "<div>" +
      "<h1>" + release.id.toUpperCase() + " — " + release.name + "</h1>" +
      "<p>" + release.storyCount + " stories · " + CC.fmtDate(release.start) + " → " + CC.fmtDate(release.end) + "</p>" +
      "</div>" +
      '<div class="hero__meta">' +
      '<span class="pill">' + stateLabel + "</span><br/>" +
      (cur.state === "in_progress" ? "Day " + elapsed + " of " + total + " (" + pct + "%)" : "") +
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
        var isCurrent = r.id === release.id && cur.state === "in_progress";
        return (
          '<div class="timeline__block' +
          (isCurrent ? " is-current" : "") +
          '">' +
          '<div class="timeline__block-id">' + r.id + "</div>" +
          '<div class="timeline__block-dates">' + CC.fmtDate(r.start) + " – " + CC.fmtDate(r.end) + "</div>" +
          "</div>"
        );
      })
      .join("");

    document.getElementById("timeline-markers").textContent =
      "Build ends " + CC.fmtDate(DATA.timeline.buildEnds) + " · Demo day " + CC.fmtDate(DATA.timeline.demoDay) +
      " (" + CC.daysBetween(today, CC.parseDate(DATA.timeline.demoDay)) + " days from today)";
  }

  CC.init("overview", renderOverview);
})();
