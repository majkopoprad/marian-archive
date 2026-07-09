/* ==========================================================================
   POST /.netlify/functions/post — publish a new entry

   Security model:
   - The real password lives ONLY in the Netlify environment variable
     ARCHIVE_PASSWORD. It never appears in frontend code or in the repo.
   - Every request must carry the password; it is compared here, on the
     server, with a constant-time comparison.

   Storage model (GitHub):
   - The site's own repository is the database. This function commits
     the updated thoughts.json (and the image, if any) via the GitHub
     Contents API. The commit triggers a Netlify redeploy, so the
     static site always serves the latest data.

   Required environment variables (set in Netlify UI):
     ARCHIVE_PASSWORD  — the publishing password
     GITHUB_TOKEN      — fine-grained token with Contents read/write
     GITHUB_REPO       — e.g. "mariankalavsky/archive"
     GITHUB_BRANCH     — optional, defaults to "main"
   ========================================================================== */

const crypto = require("crypto");

const GITHUB_API = "https://api.github.com";

/* ---- Helpers -------------------------------------------------------------- */

// Constant-time password check. Hashing both sides first makes the
// buffers equal length, which timingSafeEqual requires, and avoids
// leaking the password length through timing.
function passwordMatches(candidate) {
  const secret = process.env.ARCHIVE_PASSWORD;
  if (!secret || typeof candidate !== "string") return false;
  const a = crypto.createHash("sha256").update(candidate).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

// Minimal wrapper around the GitHub Contents API.
async function github(method, path, body) {
  const res = await fetch(`${GITHUB_API}/repos/${process.env.GITHUB_REPO}/contents/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "marian-archive",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === "GET") return null;
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`GitHub ${method} ${path} failed (${res.status}): ${detail}`);
  }
  return res.json();
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

// Only a few safe media types are accepted; the extension is derived
// from the data URL's MIME type, never from the client's filename.
const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

const AUDIO_TYPES = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "weba",
};

/* ---- Handler --------------------------------------------------------------- */

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON." });
  }

  // ---- Authentication: everything below this line is trusted. ----
  if (!passwordMatches(payload.password)) {
    return json(401, { error: "Wrong password." });
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const image = payload.image; // { name, data } or null
  const audio = payload.audio; // { name, data } or null

  if (!text && !image && !audio) {
    return json(400, { error: "An entry needs text, an image, or audio." });
  }

  const branch = process.env.GITHUB_BRANCH || "main";
  const now = new Date();

  // Ids are sortable and unique: timestamp plus a short random suffix.
  const id =
    now.toISOString().replace(/[:.]/g, "-") +
    "-" +
    crypto.randomBytes(3).toString("hex");

  try {
    // 1. Commit the image first (if any), so the entry never points
    //    at a file that failed to upload.
    let imagePath = null;
    if (image && typeof image.data === "string") {
      const match = image.data.match(/^data:(image\/[\w+.-]+);base64,(.+)$/s);
      if (!match || !IMAGE_TYPES[match[1]]) {
        return json(400, { error: "Unsupported image type." });
      }
      const filename = `images/${id}.${IMAGE_TYPES[match[1]]}`;
      await github("PUT", filename, {
        message: `archive: add image ${id}`,
        content: match[2], // already base64 — exactly what GitHub expects
        branch,
      });
      imagePath = `/${filename}`;
    }

    // 1b. Same for audio, committed into /audio/.
    let audioPath = null;
    if (audio && typeof audio.data === "string") {
      const match = audio.data.match(/^data:(audio\/[\w+.-]+);base64,(.+)$/s);
      if (!match || !AUDIO_TYPES[match[1]]) {
        return json(400, { error: "Unsupported audio type." });
      }
      const filename = `audio/${id}.${AUDIO_TYPES[match[1]]}`;
      await github("PUT", filename, {
        message: `archive: add audio ${id}`,
        content: match[2],
        branch,
      });
      audioPath = `/${filename}`;
    }

    // 2. Read the current thoughts.json (we need its blob sha to update it).
    const current = await github("GET", `thoughts.json?ref=${branch}`);
    const entries = current
      ? JSON.parse(Buffer.from(current.content, "base64").toString("utf8"))
      : [];

    // 3. Prepend the new entry — the file is always newest-first.
    const entry = {
      id,
      date: now.toISOString(),
      text,
      image: imagePath,
      audio: audioPath,
    };
    entries.unshift(entry);

    // 4. Commit the updated file. This triggers the Netlify redeploy.
    await github("PUT", "thoughts.json", {
      message: `archive: new entry ${id}`,
      content: Buffer.from(JSON.stringify(entries, null, 2) + "\n").toString("base64"),
      sha: current ? current.sha : undefined,
      branch,
    });

    return json(200, { entry });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Could not save the entry. Check the function logs." });
  }
};
