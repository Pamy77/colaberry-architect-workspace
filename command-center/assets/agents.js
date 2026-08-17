(function () {
  "use strict";

  var DATA = CC.DATA;

  function render() {
    var el = document.getElementById("owners-grid");
    el.innerHTML = DATA.owners
      .map(function (owner) {
        return (
          '<a class="link-card" href="' + CC.detailLink("owner", owner.name, "agents") + '">' +
          '<div class="link-card__title">' + CC.escapeHtml(owner.name) + "</div>" +
          '<div class="link-card__meta">' + owner.stories.length + " stor" + (owner.stories.length === 1 ? "y" : "ies") + " owned · no skills registered yet</div>" +
          "</a>"
        );
      })
      .join("");
  }

  CC.init("agents", render);
})();
