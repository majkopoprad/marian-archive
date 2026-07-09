/* ==========================================================================
   POST /.netlify/functions/delete — remove an entry

   Same security model as post.js: the password is verified here on
   the server against the ARCHIVE_PASSWORD environment variable, in
   constant time. Nothing in the frontend can bypass this.

   The function removes the entry from thoughts.json and, if the entry
   carried an image, deletes the image file from the repository too.
   ========================================================================== */

const crypto = require("crypto");

const GITHUB_API = "https://api.github.com";

/* ---- Helpers (mirrored from post.js so each function is self-contained) --- */

function passwordMatches(candidate) {
  const secret = process.env.ARCHIVE_PASSWORD;
  if (!secret || typeof candidate !== "string") return false;
  const a = crypto.createHash("sha256").update(candidate).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

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

/* ---- Handler ---------------------------------------------------------------- */

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

  // ---- Authentication ----
  if (!passwordMatches(payload.password)) {
    return json(401, { error: "Wrong password." });
  }

  const id = typeof payload.id === "string" ? payload.id : "";
  if (!id) {
    return json(400, { error: "Missing entry id." });
  }

  const branch = process.env.GITHUB_BRANCH || "main";

  try {
    // 1. Load the current archive.
    const current = await github("GET", `thoughts.json?ref=${branch}`);
    if (!current) {
      return json(404, { error: "Archive file not found." });
    }
    const entries = JSON.parse(
      Buffer.from(current.content, "base64").toString("utf8")
    );

    const entry = entries.find((e) => e.id === id);
    if (!entry) {
      return json(404, { error: "Entry not found." });
    }

    // 2. Commit thoughts.json without the entry.
    const remaining = entries.filter((e) => e.id !== id);
    await github("PUT", "thoughts.json", {
      message: `archive: delete entry ${id}`,
      content: Buffer.from(JSON.stringify(remaining, null, 2) + "\n").toString("base64"),
      sha: current.sha,
      branch,
    });

    // 3. Delete the entry's media files (image and/or audio). A
    //    failure here is logged but not fatal — the entry itself
    //    is already gone.
    for (const media of [entry.image, entry.audio]) {
      if (!media) continue;
      try {
        const mediaPath = media.replace(/^\//, "");
        const file = await github("GET", `${mediaPath}?ref=${branch}`);
        if (file) {
          await github("DELETE", mediaPath, {
            message: `archive: delete media for ${id}`,
            sha: file.sha,
            branch,
          });
        }
      } catch (err) {
        console.error("Media cleanup failed:", err);
      }
    }

    return json(200, { deleted: id });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Could not delete the entry. Check the function logs." });
  }
};
