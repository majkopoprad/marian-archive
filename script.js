/* ==========================================================================
   Marian Kalavsky archive — frontend

   Responsibilities:
   1. Load thoughts.json and render entries (newest first).
   2. Filter: All / Text / Images (gallery).
   3. Publish and delete through Netlify Functions.

   There are NO secrets in this file. The password typed into the
   composer is sent to the backend over HTTPS, where it is compared
   against an environment variable. This file could be read line by
   line by anyone and would reveal nothing useful.
   ========================================================================== */

(function () {
  "use strict";

  /* ---- Configuration ---------------------------------------------------- */

  var DATA_URL = "/thoughts.json";
  var POST_URL = "/.netlify/functions/post";
  var DELETE_URL = "/.netlify/functions/delete";

  /* ---- State ------------------------------------------------------------ */

  var entries = [];        // all entries, newest first
  var activeFilter = "all"; // "all" | "text" | "images"
  var attachedImage = null; // { name, data } — base64 payload for upload

  /* ---- Elements ---------------------------------------------------------- */

  var archiveEl = document.getElementById("archive");
  var emptyEl = document.getElementById("archive-empty");
  var pills = document.querySelectorAll(".pill");

  var textEl = document.getElementById("composer-text");
  var imageEl = document.getElementById("composer-image");
  var imageLabelEl = document.getElementById("composer-image-label");
  var passwordEl = document.getElementById("composer-password");
  var saveBtn = document.getElementById("composer-save");
  var clearBtn = document.getElementById("composer-clear");
  var previewEl = document.getElementById("composer-preview");
  var statusEl = document.getElementById("composer-status");

  var lightboxEl = document.getElementById("lightbox");
  var lightboxImgEl = document.getElementById("lightbox-image");

  /* ---- Loading ----------------------------------------------------------- */

  // A timestamp query defeats stale caches so a fresh deploy
  // is visible immediately.
  function loadEntries() {
    fetch(DATA_URL + "?t=" + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error("Could not load the archive.");
        return res.json();
      })
      .then(function (data) {
        entries = Array.isArray(data) ? data : [];
        // Guarantee newest-first order regardless of file order.
        entries.sort(function (a, b) {
          return new Date(b.date) - new Date(a.date);
        });
        render();
      })
      .catch(function () {
        emptyEl.textContent = "The archive could not be loaded.";
        emptyEl.hidden = false;
      });
  }

  /* ---- Rendering ---------------------------------------------------------- */

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function visibleEntries() {
    if (activeFilter === "text") {
      return entries.filter(function (e) { return e.text && e.text.trim(); });
    }
    if (activeFilter === "images") {
      return entries.filter(function (e) { return e.image; });
    }
    return entries;
  }

  function render() {
    var list = visibleEntries();

    // Gallery layout only for the Images filter.
    archiveEl.classList.toggle("archive--gallery", activeFilter === "images");

    archiveEl.textContent = ""; // clear previous render
    emptyEl.hidden = list.length > 0;
    if (!list.length) emptyEl.textContent = "Nothing here yet.";

    list.forEach(function (entry) {
      archiveEl.appendChild(renderEntry(entry));
    });
  }

  // Entries are built with DOM methods, never innerHTML, so text
  // content can never be interpreted as markup (XSS-safe).
  function renderEntry(entry) {
    var article = document.createElement("article");
    article.className = "entry";

    var date = document.createElement("p");
    date.className = "entry__date";
    date.textContent = formatDate(entry.date);
    article.appendChild(date);

    if (entry.text && entry.text.trim()) {
      var text = document.createElement("p");
      text.className = "entry__text";
      text.textContent = entry.text;
      article.appendChild(text);
    }

    if (entry.image) {
      var img = document.createElement("img");
      img.className = "entry__image";
      img.src = entry.image;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("click", function () {
        openLightbox(entry.image);
      });
      article.appendChild(img);
    }

    var del = document.createElement("button");
    del.className = "entry__delete";
    del.type = "button";
    del.textContent = "delete";
    del.addEventListener("click", function () {
      deleteEntry(entry, del);
    });
    article.appendChild(del);

    return article;
  }

  /* ---- Filters ------------------------------------------------------------ */

  pills.forEach(function (pill) {
    pill.addEventListener("click", function () {
      pills.forEach(function (p) { p.classList.remove("is-active"); });
      pill.classList.add("is-active");
      activeFilter = pill.dataset.filter;
      render();
    });
  });

  /* ---- Composer ------------------------------------------------------------ */

  function setStatus(message, isError) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function clearComposer() {
    textEl.value = "";
    imageEl.value = "";
    attachedImage = null;
    imageLabelEl.textContent = "Attach image";
    previewEl.hidden = true;
    previewEl.src = "";
    setStatus("");
  }

  // Read the chosen file as a base64 data URL. The backend strips
  // the prefix and commits the raw bytes into /images/.
  imageEl.addEventListener("change", function () {
    var file = imageEl.files[0];
    if (!file) return;

    if (file.size > 4 * 1024 * 1024) {
      setStatus("Image is too large — 4 MB at most.", true);
      imageEl.value = "";
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      attachedImage = { name: file.name, data: reader.result };
      imageLabelEl.textContent = file.name;
      previewEl.src = reader.result;
      previewEl.hidden = false;
    };
    reader.readAsDataURL(file);
  });

  clearBtn.addEventListener("click", clearComposer);

  saveBtn.addEventListener("click", function () {
    var text = textEl.value.trim();
    var password = passwordEl.value;

    if (!text && !attachedImage) {
      setStatus("Write something or attach an image first.", true);
      return;
    }
    if (!password) {
      setStatus("Password required.", true);
      return;
    }

    saveBtn.disabled = true;
    setStatus("Publishing…");

    fetch(POST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: password,
        text: text,
        image: attachedImage, // null when no image is attached
      }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.error || "Publishing failed.");
          return body;
        });
      })
      .then(function (body) {
        // Show the new entry immediately. The committed version
        // becomes permanent once Netlify finishes redeploying.
        entries.unshift(body.entry);
        render();
        clearComposer();
        setStatus("Saved. It becomes permanent when the site redeploys (about a minute).");
      })
      .catch(function (err) {
        setStatus(err.message, true);
      })
      .finally(function () {
        saveBtn.disabled = false;
      });
  });

  /* ---- Delete --------------------------------------------------------------- */

  function deleteEntry(entry, button) {
    var password = passwordEl.value;
    if (!password) {
      setStatus("Type the password in the composer, then press delete again.", true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (!window.confirm("Remove this entry from the archive?")) return;

    button.disabled = true;
    setStatus("Deleting…");

    fetch(DELETE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password, id: entry.id }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.error || "Delete failed.");
        });
      })
      .then(function () {
        entries = entries.filter(function (e) { return e.id !== entry.id; });
        render();
        setStatus("Deleted. Permanent after the next redeploy.");
      })
      .catch(function (err) {
        button.disabled = false;
        setStatus(err.message, true);
      });
  }

  /* ---- Lightbox ---------------------------------------------------------------- */

  function openLightbox(src) {
    lightboxImgEl.src = src;
    lightboxEl.hidden = false;
  }

  lightboxEl.addEventListener("click", function () {
    lightboxEl.hidden = true;
    lightboxImgEl.src = "";
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") lightboxEl.hidden = true;
  });

  /* ---- Go ------------------------------------------------------------------------ */

  loadEntries();
})();
