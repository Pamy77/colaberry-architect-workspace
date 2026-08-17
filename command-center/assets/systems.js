(function () {
  "use strict";

  var DATA = CC.DATA;

  function statusDot(status) {
    var cls = status === "connected" ? "dot dot--connected" : status === "error" ? "dot dot--error" : "dot";
    return '<span class="' + cls + '"></span>';
  }

  function render(mode) {
    var el = document.getElementById("systems-body");
    el.innerHTML = DATA.systems
      .map(function (sys, i) {
        var isSampleConnected = mode === "sample" && i < DATA.sample.systemsConnected;
        var status = isSampleConnected ? "connected" : sys.status;
        var lastChecked = isSampleConnected ? "moments ago" : sys.lastChecked ? CC.fmtDate(sys.lastChecked) : "Never";
        return (
          '<tr class="is-clickable" onclick="location.href=\'' + CC.detailLink("system", sys.name, "systems") + '\'">' +
          "<td>" + CC.escapeHtml(sys.name) + "</td>" +
          "<td>" + statusDot(status) + (status === "connected" ? "Connected" : "Not connected") +
          (isSampleConnected ? '<span class="stat__tag">SAMPLE</span>' : "") + "</td>" +
          "<td>" + lastChecked + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  CC.init("systems", render);
})();
