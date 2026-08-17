(function () {
  "use strict";

  var DATA = CC.DATA;

  function trendArrow(trend) {
    return { up: "↑", down: "↓", flat: "→" }[trend] || "";
  }

  function render(mode) {
    var el = document.getElementById("outcomes-body");

    if (mode === "sample") {
      el.innerHTML =
        '<div class="card-grid">' +
        DATA.sample.outcomes
          .map(function (m) {
            return (
              '<div class="stat">' +
              '<div class="stat__value">' + m.current + '<span class="stat__tag">SAMPLE</span></div>' +
              '<div class="stat__label">' + CC.escapeHtml(m.name) + " · target " + m.target + " " + trendArrow(m.trend) + "</div>" +
              "</div>"
            );
          })
          .join("") +
        "</div>";
      return;
    }

    el.innerHTML =
      '<a class="link-card" href="' + CC.detailLink("outcomes-empty", "-", "outcomes") + '">' +
      '<div class="link-card__title">No numeric target defined yet</div>' +
      '<div class="link-card__meta">The plan does not carry a north-star metric for this project. Open this card to see what has to happen first.</div>' +
      "</a>" +
      '<div class="card-grid" style="margin-top:14px">' +
      '<div class="ghost-card">Measure not yet defined</div>' +
      '<div class="ghost-card">Measure not yet defined</div>' +
      '<div class="ghost-card">Measure not yet defined</div>' +
      "</div>";
  }

  CC.init("outcomes", render);
})();
