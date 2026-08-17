(function () {
  "use strict";

  var DATA = CC.DATA;
  var TAB_LABELS = {};
  DATA.tabs.forEach(function (t) {
    TAB_LABELS[t.id] = t.label;
  });

  function statusDot(status) {
    var cls = status === "connected" ? "dot dot--connected" : status === "error" ? "dot dot--error" : "dot";
    return '<span class="' + cls + '"></span>';
  }

  function renderRequirement(id) {
    var req = CC.reqById(id);
    if (!req) return notFound("requirement", id);
    var isGuardrail = DATA.guardrails.indexOf(id) !== -1;
    var relatedStories = DATA.stories.filter(function (s) {
      return s.relatedRequirements.some(function (r) { return r.id === id; });
    });

    var html =
      '<div class="page-header"><h1>' + req.id + "</h1>" +
      '<p><span class="badge badge--type">' + req.type + "</span> " +
      (isGuardrail ? '<span class="badge badge--safe">GUARDRAIL</span> ' : "") +
      req.priority + "</p></div>" +
      '<div class="card"><h2 class="card__title">Requirement text</h2><p>' + CC.escapeHtml(req.text) + "</p></div>";

    if (isGuardrail) {
      html +=
        '<div class="card"><h2 class="card__title">Enforcement status</h2>' +
        '<ul class="status-list"><li>' + statusDot("not_connected") +
        "Not enforced yet — no code has shipped for this requirement.</li></ul></div>";
      html += '<div class="card"><h2 class="card__title">Expected implementation</h2><p style="font-size:13px;color:var(--color-text-muted)">' +
        CC.escapeHtml(DATA.guardrailNotes[id] || "") + "</p></div>";
    }

    html += '<div class="card"><h2 class="card__title">Stories related to this requirement</h2>';
    if (relatedStories.length === 0) {
      html += '<p class="empty-state">No story in the plan is explicitly linked to this requirement yet.</p>';
    } else {
      html += '<ul class="status-list">' + relatedStories
        .map(function (s) {
          var conf = s.relatedRequirements.filter(function (r) { return r.id === id; })[0].confidence;
          return '<li><a href="' + CC.detailLink("story", s.id, "guardrails") + '">' + s.id + " — " + s.title + "</a> " + CC.confidenceBadge(conf) + "</li>";
        })
        .join("") + "</ul>";
    }
    html += "</div>";
    return html;
  }

  function renderStory(id) {
    var story = CC.storyById(id);
    if (!story) return notFound("story", id);
    var release = CC.releaseById(story.release);
    var html =
      '<div class="page-header"><h1>' + story.id + " — " + story.title + "</h1>" +
      "<p>Due " + CC.fmtDate(story.due) + " · Owner: " + CC.escapeHtml(story.owner) + "</p></div>" +
      '<div class="card"><h2 class="card__title">Release</h2><p><a href="' + CC.detailLink("release", release.id, "pm") + '">' +
      release.id.toUpperCase() + " — " + release.name + "</a></p></div>";

    html += '<div class="card"><h2 class="card__title">Related requirements</h2>';
    if (story.relatedRequirements.length === 0) {
      html += '<p class="empty-state">No requirement is linked to this story yet.</p>';
    } else {
      html += '<ul class="status-list">' + story.relatedRequirements
        .map(function (r) {
          var req = CC.reqById(r.id);
          return '<li><a href="' + CC.detailLink("requirement", r.id, "guardrails") + '">' + r.id + " — " + CC.escapeHtml(req.text) + "</a> " + CC.confidenceBadge(r.confidence) + "</li>";
        })
        .join("") + "</ul>";
    }
    html += "</div>";
    return html;
  }

  function renderRelease(id) {
    var release = CC.releaseById(id);
    if (!release) return notFound("release", id);
    var stories = release.stories.map(CC.storyById);
    var html =
      '<div class="page-header"><h1>' + release.id.toUpperCase() + " — " + release.name + "</h1>" +
      "<p>" + release.storyCount + " stories · " + CC.fmtDate(release.start) + " → " + CC.fmtDate(release.end) + "</p></div>";
    html += '<div class="card"><h2 class="card__title">Stories in this release</h2><ul class="status-list">' +
      stories.map(function (s) {
        return '<li><a href="' + CC.detailLink("story", s.id, "pm") + '">' + s.id + " — " + s.title + "</a> · due " + CC.fmtDate(s.due) + "</li>";
      }).join("") + "</ul></div>";
    return html;
  }

  function renderSystem(name) {
    var system = DATA.systems.filter(function (s) { return s.name === name; })[0];
    if (!system) return notFound("system", name);
    var html =
      '<div class="page-header"><h1>' + CC.escapeHtml(system.name) + "</h1></div>" +
      '<div class="card"><h2 class="card__title">Connection status</h2><ul class="status-list"><li>' +
      statusDot(system.status) + (system.status === "connected" ? "Connected" : "Not connected") +
      "</li></ul><p style=\"font-size:12px;color:var(--color-text-faint);margin-top:8px\">Last checked: " +
      (system.lastChecked ? CC.fmtDate(system.lastChecked) : "Never") + "</p></div>";
    html += '<div class="card"><h2 class="card__title">Governing requirement</h2><p><a href="' +
      CC.detailLink("requirement", "REQ-006", "systems") + '">REQ-006</a> names all eight systems as one integration constraint — the plan does not break integration work down system-by-system.</p></div>';
    html += '<div class="card"><h2 class="card__title">Planned work</h2><p style="font-size:13px;color:var(--color-text-muted)">Based on its name, release <a href="' +
      CC.detailLink("release", "r2", "pm") + '">R2 — Integrations and Subscription Management</a> is where integration work is scoped. The plan does not name which system(s) R2 covers first.</p></div>';
    return html;
  }

  function renderRole(role) {
    var link = DATA.roleLinks[role];
    var html = '<div class="page-header"><h1>' + CC.escapeHtml(role) + "</h1><p>One of the six roles named in the project's user stories.</p></div>";
    if (!link || (link.stories.length === 0 && link.requirements.length === 0)) {
      html += '<div class="card"><p class="empty-state">No story or requirement in the plan explicitly names this role yet. It may still be a real user of the product described in the plan — nothing here ties a specific story or requirement to it by name.</p></div>';
      return html;
    }
    if (link.stories.length) {
      html += '<div class="card"><h2 class="card__title">Stories owned by this role</h2><ul class="status-list">' +
        link.stories.map(function (sid) {
          var s = CC.storyById(sid);
          return '<li><a href="' + CC.detailLink("story", sid, "users") + '">' + sid + " — " + s.title + '</a> <span class="badge badge--explicit">owner field match</span></li>';
        }).join("") + "</ul></div>";
    }
    if (link.requirements.length) {
      html += '<div class="card"><h2 class="card__title">Requirements that name this role</h2><ul class="status-list">' +
        link.requirements.map(function (rid) {
          var r = CC.reqById(rid);
          return '<li><a href="' + CC.detailLink("requirement", rid, "users") + '">' + rid + " — " + CC.escapeHtml(r.text) + "</a></li>";
        }).join("") + "</ul></div>";
    }
    return html;
  }

  function renderOwner(name) {
    var owner = DATA.owners.filter(function (o) { return o.name === name; })[0];
    if (!owner) return notFound("owner", name);
    var html = '<div class="page-header"><h1>' + CC.escapeHtml(owner.name) + '</h1><p>Owner, not a scoped AI agent — see the AI agents tab.</p></div>';
    html += '<div class="card"><h2 class="card__title">Stories owned</h2><ul class="status-list">' +
      owner.stories.map(function (sid) {
        var s = CC.storyById(sid);
        return '<li><a href="' + CC.detailLink("story", sid, "agents") + '">' + sid + " — " + s.title + "</a></li>";
      }).join("") + "</ul></div>";
    html += '<div class="card"><h2 class="card__title">Skills</h2><p class="empty-state">No skills registered yet.</p></div>';
    return html;
  }

  function renderEntity(name) {
    var entity = DATA.dataModel.entities.filter(function (e) { return e.name === name; })[0];
    if (!entity) return notFound("entity", name);
    var rels = DATA.dataModel.relationships.filter(function (r) { return r.from === name || r.to === name; });
    var html = '<div class="page-header"><h1>' + entity.name + "</h1><p>" + CC.escapeHtml(entity.purpose) + "</p></div>";
    html += '<div class="card"><h2 class="card__title">Fields (draft)</h2><ul class="field-list">' +
      entity.fields.map(function (f) {
        return '<li><span class="field-name">' + f.name + "</span><span class=\"field-type\">" + f.type + (f.note ? " — " + CC.escapeHtml(f.note) : "") + "</span></li>";
      }).join("") + "</ul></div>";
    html += '<div class="card"><h2 class="card__title">Related requirements</h2><ul class="status-list">' +
      entity.relatedRequirements.map(function (r) {
        var req = CC.reqById(r.id);
        return '<li><a href="' + CC.detailLink("requirement", r.id, "datamodel") + '">' + r.id + " — " + CC.escapeHtml(req.text) + "</a> " + CC.confidenceBadge(r.confidence) + "</li>";
      }).join("") + "</ul></div>";
    if (rels.length) {
      html += '<div class="card"><h2 class="card__title">Relationships</h2><ul class="status-list">' +
        rels.map(function (r) {
          return "<li>" + r.from + " " + r.cardinality + " " + r.to + (r.note ? " — " + CC.escapeHtml(r.note) : "") + "</li>";
        }).join("") + "</ul></div>";
    }
    return html;
  }

  function renderOutcomesEmpty() {
    return (
      '<div class="page-header"><h1>Outcomes — not defined yet</h1><p>The plan carries no numeric target for this project.</p></div>' +
      '<div class="card"><h2 class="card__title">What has to happen before this tab has real cards</h2>' +
      "<ol style=\"font-size:13px;color:var(--color-text-muted);padding-left:18px\">" +
      "<li>Agree on the north-star metric(s) this project has to move, with a number and a timeframe.</li>" +
      "<li>Add each one to <code>assets/data.js</code> as an outcome with a baseline, a target, and how it's measured.</li>" +
      "<li>Wire the outcome to whichever story or release is meant to move it.</li>" +
      "</ol></div>"
    );
  }

  function notFound(type, id) {
    return '<div class="page-header"><h1>Not found</h1><p>No ' + CC.escapeHtml(type) + ' with id "' + CC.escapeHtml(id) + '" exists in the data.</p></div>';
  }

  function render() {
    var params = CC.qs();
    var type = params.get("type");
    var id = params.get("id");
    var from = params.get("from");

    var backLink = document.getElementById("back-link");
    if (from && TAB_LABELS[from]) {
      var tab = DATA.tabs.filter(function (t) { return t.id === from; })[0];
      backLink.href = tab ? tab.href : "index.html";
      backLink.textContent = "← Back to " + TAB_LABELS[from];
    }

    var body = document.getElementById("detail-body");
    var renderers = {
      requirement: renderRequirement,
      story: renderStory,
      release: renderRelease,
      system: renderSystem,
      role: renderRole,
      owner: renderOwner,
      entity: renderEntity,
      "outcomes-empty": renderOutcomesEmpty,
    };
    var fn = renderers[type];
    body.innerHTML = fn ? fn(id) : notFound(type || "unknown", id || "");
  }

  CC.init(null, render);
})();
