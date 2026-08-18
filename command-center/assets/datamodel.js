(function () {
  "use strict";

  var DATA;

  function render() {
    DATA = CC.DATA;
    var entitiesEl = document.getElementById("entities-grid");
    entitiesEl.innerHTML = DATA.dataModel.entities
      .map(function (e) {
        return (
          '<a class="link-card" href="' + CC.detailLink("entity", e.name, "datamodel") + '">' +
          '<div class="link-card__title">' + e.name + "</div>" +
          '<div class="link-card__meta">' + CC.escapeHtml(e.purpose) + "</div>" +
          "</a>"
        );
      })
      .join("");

    document.getElementById("relationships-body").innerHTML = DATA.dataModel.relationships
      .map(function (r) {
        return "<tr><td>" + r.from + "</td><td>" + r.cardinality + "</td><td>" + r.to + "</td><td>" + (r.note ? CC.escapeHtml(r.note) : "") + "</td></tr>";
      })
      .join("");
  }

  CC.init("datamodel", render);
})();
