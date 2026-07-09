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

  // Entries and images are read straight from the GitHub repository,
  // not from the deployed site. This means a new post is visible
  // seconds after publishing — no Netlify redeploy needed — and the
  // site keeps showing fresh data even when deploys are paused.
  //
  // The API endpoint is tried first because it is never CDN-cached:
  // raw.githubusercontent.com holds files for up to 5 minutes, which
  // made fresh posts and deletes look like they hadn't happened.
  // The API allows 60 requests/hour per visitor IP — far more than a
  // reader needs — and everything falls back to raw, then to the
  // copy bundled with the deployed site.
  var RAW_BASE = "https://raw.githubusercontent.com/majkopoprad/marian-archive/main";
  var DATA_API_URL = "https://api.github.com/repos/majkopoprad/marian-archive/contents/thoughts.json";
  var DATA_URL = RAW_BASE + "/thoughts.json";
  var DATA_FALLBACK_URL = "/thoughts.json"; // deployed copy, if GitHub is unreachable
  var POST_URL = "/.netlify/functions/post";
  var DELETE_URL = "/.netlify/functions/delete";

  // Resolve an entry's media (image or audio) to a URL the browser
  // can load. Repo paths ("/images/…", "/audio/…") are served from
  // GitHub; data URLs (fresh optimistic posts) pass through untouched.
  function mediaUrl(path) {
    if (!path) return null;
    if (path.indexOf("data:") === 0) return path;
    if (path.indexOf("/images/") === 0 || path.indexOf("/audio/") === 0) {
      return RAW_BASE + path;
    }
    return path;
  }

  /* ---- State ------------------------------------------------------------ */

  var entries = [];        // all entries, newest first
  var activeFilter = "all"; // "all" | "text" | "images"
  var attachedImage = null; // { name, data } — base64 payload for upload
  var attachedAudio = null; // { name, data } — same, for audio
  var playingAudio = null;  // the <audio> currently playing, if any

  /* ---- Elements ---------------------------------------------------------- */

  var archiveEl = document.getElementById("archive");
  var emptyEl = document.getElementById("archive-empty");
  var pills = document.querySelectorAll(".pill");

  var textEl = document.getElementById("composer-text");
  var imageEl = document.getElementById("composer-image");
  var imageLabelEl = document.getElementById("composer-image-label");
  var audioEl = document.getElementById("composer-audio");
  var audioLabelEl = document.getElementById("composer-audio-label");
  var passwordEl = document.getElementById("composer-password");
  var saveBtn = document.getElementById("composer-save");
  var clearBtn = document.getElementById("composer-clear");
  var previewEl = document.getElementById("composer-preview");
  var statusEl = document.getElementById("composer-status");

  var lightboxEl = document.getElementById("lightbox");
  var lightboxImgEl = document.getElementById("lightbox-image");

  /* ---- Loading ----------------------------------------------------------- */

  // Freshest source first: the GitHub API is never CDN-cached, so
  // posts and deletes are visible immediately. If it fails (rate
  // limit, outage), fall back to raw (up to 5 min stale), and
  // finally to the copy bundled with the deployed site.
  function loadEntries() {
    fetch(DATA_API_URL + "?t=" + Date.now(), {
      headers: { Accept: "application/vnd.github.raw+json" },
    })
      .then(function (res) {
        if (!res.ok) throw new Error("api fetch failed");
        return res.json();
      })
      .catch(function () {
        return fetch(DATA_URL + "?t=" + Date.now()).then(function (res) {
          if (!res.ok) throw new Error("raw fetch failed");
          return res.json();
        });
      })
      .catch(function () {
        return fetch(DATA_FALLBACK_URL + "?t=" + Date.now()).then(function (res) {
          if (!res.ok) throw new Error("Could not load the archive.");
          return res.json();
        });
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
      // Text means text only — entries carrying an image or audio
      // belong to their media, not here.
      return entries.filter(function (e) {
        return e.text && e.text.trim() && !e.image && !e.audio;
      });
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
      var src = mediaUrl(entry.image);
      var img = document.createElement("img");
      img.className = "entry__image";
      img.src = src;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("click", function () {
        openLightbox(src);
      });
      article.appendChild(img);
    }

    if (entry.audio) {
      article.appendChild(renderPlayer(mediaUrl(entry.audio)));
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

  // A quiet audio player in the site's own style: the word
  // "play" / "pause", a thin progress line, and the time.
  // The native browser player would be far too loud here.
  function renderPlayer(src) {
    var wrap = document.createElement("div");
    wrap.className = "entry__player";

    var audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = src;

    var btn = document.createElement("button");
    btn.className = "entry__player-btn";
    btn.type = "button";
    btn.textContent = "play";

    var track = document.createElement("div");
    track.className = "entry__player-track";
    var fill = document.createElement("div");
    fill.className = "entry__player-fill";
    track.appendChild(fill);

    var time = document.createElement("span");
    time.className = "entry__player-time";
    time.textContent = "0:00";

    function fmt(s) {
      if (!isFinite(s)) return "0:00";
      var m = Math.floor(s / 60);
      var r = Math.floor(s % 60);
      return m + ":" + (r < 10 ? "0" : "") + r;
    }

    btn.addEventListener("click", function () {
      if (audio.paused) {
        // Only one voice at a time in the archive.
        if (playingAudio && playingAudio !== audio) playingAudio.pause();
        audio.play();
      } else {
        audio.pause();
      }
    });

    audio.addEventListener("play", function () {
      playingAudio = audio;
      btn.textContent = "pause";
    });

    audio.addEventListener("pause", function () {
      btn.textContent = "play";
    });

    audio.addEventListener("ended", function () {
      btn.textContent = "play";
      fill.style.width = "0%";
      time.textContent = fmt(audio.duration);
    });

    audio.addEventListener("loadedmetadata", function () {
      time.textContent = fmt(audio.duration);
    });

    audio.addEventListener("timeupdate", function () {
      if (audio.duration) {
        fill.style.width = (audio.currentTime / audio.duration) * 100 + "%";
        time.textContent = fmt(audio.currentTime);
      }
    });

    // Click the line to seek.
    track.addEventListener("click", function (e) {
      if (!audio.duration) return;
      var rect = track.getBoundingClientRect();
      audio.currentTime =
        ((e.clientX - rect.left) / rect.width) * audio.duration;
    });

    wrap.appendChild(audio);
    wrap.appendChild(btn);
    wrap.appendChild(track);
    wrap.appendChild(time);
    return wrap;
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
    audioEl.value = "";
    attachedAudio = null;
    audioLabelEl.textContent = "Attach audio";
    previewEl.hidden = true;
    previewEl.src = "";
    setStatus("");
  }

  // Netlify Functions reject request bodies over ~6 MB, and base64
  // inflates data by a third — so the payload must stay under about
  // 3.5 MB of raw image. Rather than rejecting bigger files, large
  // images are automatically downscaled in the browser to fit.
  var MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

  // Approximate decoded size of a data URL (base64 → bytes).
  function dataUrlBytes(dataUrl) {
    return Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
  }

  // Draw the image onto a canvas and re-encode as JPEG, shrinking
  // quality and dimensions step by step until it fits.
  function compressImage(file, callback) {
    var url = URL.createObjectURL(file);
    var img = new Image();

    img.onload = function () {
      URL.revokeObjectURL(url);

      var maxSide = 2600; // plenty for full-screen viewing
      var quality = 0.85;
      var result = null;

      while (maxSide >= 800) {
        var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

        result = canvas.toDataURL("image/jpeg", quality);
        if (dataUrlBytes(result) <= MAX_IMAGE_BYTES) break;

        // Still too big: lower quality first, then dimensions.
        if (quality > 0.6) {
          quality -= 0.1;
        } else {
          maxSide -= 400;
        }
      }

      callback(result && dataUrlBytes(result) <= MAX_IMAGE_BYTES ? result : null);
    };

    img.onerror = function () {
      URL.revokeObjectURL(url);
      callback(null);
    };

    img.src = url;
  }

  function attachImage(name, dataUrl) {
    attachedImage = { name: name, data: dataUrl };
    imageLabelEl.textContent = name;
    previewEl.src = dataUrl;
    previewEl.hidden = false;
  }

  imageEl.addEventListener("change", function () {
    var file = imageEl.files[0];
    if (!file) return;

    // Small enough already — send the original file untouched.
    if (file.size <= MAX_IMAGE_BYTES) {
      var reader = new FileReader();
      reader.onload = function () {
        attachImage(file.name, reader.result);
        setStatus("");
      };
      reader.readAsDataURL(file);
      return;
    }

    // Re-encoding a GIF would freeze its animation, so those
    // must simply be under the platform limit.
    if (file.type === "image/gif") {
      setStatus("Animated GIFs must be under 3.5 MB.", true);
      imageEl.value = "";
      return;
    }

    setStatus("Large image — compressing…");
    compressImage(file, function (dataUrl) {
      if (!dataUrl) {
        setStatus("This image could not be processed.", true);
        imageEl.value = "";
        return;
      }
      attachImage(file.name.replace(/\.\w+$/, "") + ".jpg", dataUrl);
      setStatus("Compressed to fit. Ready to publish.");
    });
  });

  // Audio attachments. Unlike images, audio cannot be recompressed
  // in the browser, so the platform's payload ceiling is a hard
  // limit — an MP3 keeps ~3.5 minutes at 128 kbps under it.
  audioEl.addEventListener("change", function () {
    var file = audioEl.files[0];
    if (!file) return;

    if (file.size > MAX_IMAGE_BYTES) {
      setStatus("Audio must be under 3.5 MB — export a smaller MP3.", true);
      audioEl.value = "";
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      attachedAudio = { name: file.name, data: reader.result };
      audioLabelEl.textContent = file.name;
      setStatus("");
    };
    reader.readAsDataURL(file);
  });

  clearBtn.addEventListener("click", clearComposer);

  saveBtn.addEventListener("click", function () {
    var text = textEl.value.trim();
    var password = passwordEl.value;

    if (!text && !attachedImage && !attachedAudio) {
      setStatus("Write something or attach an image or audio first.", true);
      return;
    }

    // Both attachments must fit in one function request together.
    if (attachedImage && attachedAudio) {
      var combined =
        dataUrlBytes(attachedImage.data) + dataUrlBytes(attachedAudio.data);
      if (combined > MAX_IMAGE_BYTES) {
        setStatus("Image and audio together are too large for one entry.", true);
        return;
      }
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
        audio: attachedAudio, // null when no audio is attached
      }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.error || "Publishing failed.");
          return body;
        });
      })
      .then(function (body) {
        // Show the new entry immediately. Until GitHub's CDN picks
        // up the freshly committed files (moments), display the
        // local copies (base64); the real URLs take over on next load.
        if (attachedImage) {
          body.entry.image = attachedImage.data;
        }
        if (attachedAudio) {
          body.entry.audio = attachedAudio.data;
        }
        entries.unshift(body.entry);
        render();
        clearComposer();
        setStatus("Saved.");
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
        setStatus("Deleted.");
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
