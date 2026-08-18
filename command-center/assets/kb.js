(function () {
  "use strict";

  var DATA;
  var NOTES_KEY = "kpicc_notes";
  var STOPWORDS = ["what", "does", "the", "is", "are", "a", "an", "of", "for", "to", "in", "on", "how", "do", "did", "this",
    "system", "must", "and", "with", "about", "tell", "me"];

  function buildIndex() {
    var items = [];
    DATA.requirements.forEach(function (r) {
      items.push({ type: "requirement", id: r.id, title: r.id, text: r.text, tab: "guardrails", tabLabel: "Guardrails / Systems" });
    });
    DATA.stories.forEach(function (s) {
      items.push({ type: "story", id: s.id, title: s.id + " " + s.title, text: s.title + " owned by " + s.owner, tab: "pm", tabLabel: "Project management" });
    });
    DATA.releases.forEach(function (r) {
      items.push({ type: "release", id: r.id, title: r.id + " " + r.name, text: r.name, tab: "pm", tabLabel: "Project management" });
    });
    DATA.systems.forEach(function (sys) {
      items.push({ type: "system", id: sys.name, title: sys.name, text: sys.name + " integration", tab: "systems", tabLabel: "Systems" });
    });
    DATA.roles.forEach(function (role) {
      items.push({ type: "role", id: role, title: role, text: role + " role user", tab: "users", tabLabel: "Users and use case" });
    });
    return items;
  }

  function tokenize(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(function (w) { return w && STOPWORDS.indexOf(w) === -1; });
  }

  function search(index, query) {
    var qWords = tokenize(query);
    if (qWords.length === 0) return [];
    var scored = index.map(function (item) {
      var itemWords = tokenize(item.title + " " + item.text);
      var score = qWords.reduce(function (acc, w) {
        return acc + (itemWords.some(function (iw) { return iw.indexOf(w) !== -1 || w.indexOf(iw) !== -1; }) ? 1 : 0);
      }, 0);
      return { item: item, score: score };
    });
    return scored
      .filter(function (s) { return s.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 4)
      .map(function (s) { return s.item; });
  }

  function appendMsg(role, html) {
    var log = document.getElementById("chat-log");
    var div = document.createElement("div");
    div.className = "chat-msg";
    div.innerHTML = '<div class="chat-msg__role">' + role + '</div><div class="chat-msg__body">' + html + "</div>";
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function handleAsk(index, question) {
    appendMsg("You", CC.escapeHtml(question));
    var results = search(index, question);
    if (results.length === 0) {
      appendMsg("Knowledge base", "I can't answer that from the data on this page.");
      return;
    }
    var html = results
      .map(function (r) {
        return (
          "<div>" + CC.escapeHtml(r.title) + (r.type === "requirement" || r.type === "story" ? " — " + CC.escapeHtml(r.text) : "") +
          '<br/><a class="chat-cite" href="' + (r.type === "system" || r.type === "role" ? CC.detailLink(r.type, r.id, r.tab) : CC.detailLink(r.type, r.id, r.tab)) +
          '">found in: ' + r.tabLabel + "</a></div>"
        );
      })
      .join("<hr style=\"border:none;border-top:1px solid var(--color-border);margin:8px 0\"/>");
    appendMsg("Knowledge base", html);
  }

  function loadNotes() {
    try {
      return JSON.parse(localStorage.getItem(NOTES_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveNotes(notes) {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  }

  function renderNotes() {
    var notes = loadNotes();
    document.getElementById("notes-count-row").innerHTML =
      '<span>' + notes.length + " note" + (notes.length === 1 ? "" : "s") + " added</span>";
    var list = document.getElementById("notes-list");
    if (notes.length === 0) {
      list.innerHTML = '<p class="empty-state">No notes yet. Add the first one above.</p>';
      return;
    }
    list.innerHTML = notes
      .map(function (n, i) {
        return (
          '<div class="note-item"><span class="note-item__remove" data-idx="' + i + '">remove</span>' +
          CC.escapeHtml(n.text) + '<div class="note-item__meta">' + new Date(n.at).toLocaleString() + "</div></div>"
        );
      })
      .join("");
    list.querySelectorAll(".note-item__remove").forEach(function (el) {
      el.addEventListener("click", function () {
        var notes = loadNotes();
        notes.splice(Number(el.dataset.idx), 1);
        saveNotes(notes);
        renderNotes();
      });
    });
  }

  function render() {
    renderNotes();
  }

  CC.whenReady(function () {
    DATA = CC.DATA;
    var index = buildIndex();

    appendMsg("Knowledge base", "Ask about any requirement, story, release, system, or role on this page. I only answer from that data.");

    document.getElementById("chat-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = document.getElementById("chat-input");
      var q = input.value.trim();
      if (!q) return;
      handleAsk(index, q);
      input.value = "";
    });

    document.getElementById("note-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = document.getElementById("note-input");
      var text = input.value.trim();
      if (!text) return;
      var notes = loadNotes();
      notes.push({ text: text, at: new Date().toISOString() });
      saveNotes(notes);
      input.value = "";
      renderNotes();
    });
  });

  CC.init("kb", render);
})();
