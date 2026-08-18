(function () {
  "use strict";

  var DATA;

  function render() {
    DATA = CC.DATA;
    var el = document.getElementById("roles-grid");
    el.innerHTML = DATA.roles
      .map(function (role) {
        var link = DATA.roleLinks[role] || { stories: [], requirements: [] };
        var count = link.stories.length + link.requirements.length;
        var meta = count === 0 ? "Not yet linked to a story or requirement" : count + " linked item" + (count === 1 ? "" : "s");
        return (
          '<a class="link-card" href="' + CC.detailLink("role", role, "users") + '">' +
          '<div class="link-card__title">' + CC.escapeHtml(role) + "</div>" +
          '<div class="link-card__meta">' + meta + "</div>" +
          "</a>"
        );
      })
      .join("");
  }

  CC.init("users", render);
})();
