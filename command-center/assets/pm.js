(function () {
  "use strict";

  var DATA;

  function render() {
    DATA = CC.DATA;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var cur = CC.currentRelease(today);
    var noDates = cur.state === "no_dates";

    var minWeek = Math.min.apply(null, DATA.releases.map(function (r) { return r.weekStart; }));
    var maxWeek = Math.max.apply(null, DATA.releases.map(function (r) { return r.weekEnd; }));
    var span = maxWeek - minWeek + 1;

    var gantt = document.getElementById("gantt");
    gantt.innerHTML = DATA.releases
      .map(function (r) {
        var left = ((r.weekStart - minWeek) / span) * 100;
        var width = ((r.weekEnd - r.weekStart + 1) / span) * 100;
        var isCurrent = !noDates && r.id === cur.release.id && cur.state === "in_progress";
        return (
          '<div class="gantt-row">' +
          '<div class="gantt-row__label">' + r.id.toUpperCase() + "</div>" +
          '<div class="gantt-row__track">' +
          '<div class="gantt-row__bar' + (isCurrent ? " is-current" : "") + '" style="left:' + left + "%;width:" + width + '%"></div>' +
          "</div></div>"
        );
      })
      .join("");

    document.getElementById("gantt-legend").innerHTML =
      "Timeline: Week " + minWeek + " – Week " + maxWeek +
      (noDates ? " (exact calendar dates not set yet)" : " · " + CC.fmtDate(DATA.releases[0].start) + " → " + CC.fmtDate(DATA.releases[DATA.releases.length - 1].end));

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
