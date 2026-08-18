(function () {
  "use strict";

  var DATA;

  function pct(date, min, max) {
    return ((date - min) / (max - min)) * 100;
  }

  function render() {
    DATA = CC.DATA;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var cur = CC.currentRelease(today);

    var min = CC.parseDate(DATA.releases[0].start);
    var max = CC.parseDate(DATA.timeline.demoDay);

    var gantt = document.getElementById("gantt");
    gantt.innerHTML = DATA.releases
      .map(function (r) {
        var left = pct(CC.parseDate(r.start), min, max);
        var width = pct(CC.parseDate(r.end), min, max) - left;
        var isCurrent = r.id === cur.release.id && cur.state === "in_progress";
        return (
          '<div class="gantt-row">' +
          '<div class="gantt-row__label">' + r.id.toUpperCase() + "</div>" +
          '<div class="gantt-row__track">' +
          '<div class="gantt-row__bar' + (isCurrent ? " is-current" : "") + '" style="left:' + left + "%;width:" + width + '%"></div>' +
          "</div></div>"
        );
      })
      .join("");

    var buildEndsPct = pct(CC.parseDate(DATA.timeline.buildEnds), min, max);
    var demoDayPct = pct(CC.parseDate(DATA.timeline.demoDay), min, max);
    document.getElementById("gantt-legend").innerHTML =
      "Timeline: " + CC.fmtDate(DATA.releases[0].start) + " → " + CC.fmtDate(DATA.timeline.demoDay) +
      " · Build ends " + CC.fmtDate(DATA.timeline.buildEnds) + " (" + Math.round(buildEndsPct) + "%) · Demo day " +
      CC.fmtDate(DATA.timeline.demoDay) + " (" + Math.round(demoDayPct) + "%)";

    var tasksBody = document.getElementById("tasks-body");
    tasksBody.innerHTML = DATA.stories
      .map(function (s) {
        return (
          '<tr class="is-clickable" onclick="location.href=\'' + CC.detailLink("story", s.id, "pm") + '\'">' +
          "<td>" + s.id + " — " + s.title + "</td>" +
          "<td>" + s.release.toUpperCase() + "</td>" +
          "<td>" + CC.escapeHtml(s.owner) + "</td>" +
          "<td>" + CC.fmtDate(s.due) + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  CC.init("pm", render);
})();
