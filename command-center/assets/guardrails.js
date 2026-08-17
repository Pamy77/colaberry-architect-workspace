(function () {
  "use strict";

  var DATA = CC.DATA;

  function render() {
    var el = document.getElementById("guardrails-list");
    if (DATA.guardrails.length === 0) {
      el.innerHTML = '<div class="card"><p class="empty-state">The plan has no SAFE requirement. This tab has nothing to show until one is added.</p></div>';
      return;
    }
    el.innerHTML = DATA.guardrails
      .map(function (id) {
        var req = CC.reqById(id);
        return (
          '<a class="link-card" href="' + CC.detailLink("requirement", id, "guardrails") + '" style="margin-bottom:12px;display:block">' +
          '<div class="link-card__title">' + req.id + ' <span class="badge badge--safe">GUARDRAIL</span></div>' +
          "<p style=\"font-size:13px;margin:6px 0 8px;color:var(--color-text)\">" + CC.escapeHtml(req.text) + "</p>" +
          '<div class="link-card__meta"><span class="dot"></span> Not enforced yet — no code has shipped</div>' +
          "</a>"
        );
      })
      .join("");
  }

  CC.init("guardrails", render);
})();
