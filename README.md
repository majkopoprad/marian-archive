# Marian Kalavsky archive

A public digital archive that belongs to one person. Anyone can read
everything; only the owner can publish or delete.

- Static frontend: plain HTML, CSS, vanilla JavaScript. No frameworks.
- Tiny backend: two Netlify Functions (`post`, `delete`).
- Storage: the site's own GitHub repository. Publishing commits
  `thoughts.json` (and images) through the GitHub API; the commit
  triggers a Netlify redeploy, so the live site is always static.
- Security: the password exists **only** as a Netlify environment
  variable and is verified server-side, in constant time. There is no
  password anywhere in the frontend code.

## Project structure

```
index.html                    the page
styles.css                    dark, literary styling
script.js                     rendering, filters, publish/delete calls
thoughts.json                 all entries, newest first
netlify.toml                  Netlify configuration
netlify/functions/post.js     publish (password-protected)
netlify/functions/delete.js   delete (password-protected)
images/                       uploaded images live here
```

Each entry in `thoughts.json`:

```json
{
  "id": "2026-07-09T12-00-00-000Z-a1b2c3",
  "date": "2026-07-09T12:00:00.000Z",
  "text": "…",
  "image": "/images/….jpg"   // or null
}
```

---

## 1. Deploy to Netlify

1. Create a **GitHub repository** (e.g. `mariankalavsky/archive`) and
   push this folder to it:

   ```bash
   git init
   git add .
   git commit -m "archive: first commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/archive.git
   git push -u origin main
   ```

2. Log in to [Netlify](https://app.netlify.com) → **Add new site →
   Import an existing project** → choose the repository.

3. Build settings are read from `netlify.toml` automatically
   (publish directory `.`, functions in `netlify/functions`).
   Leave the build command empty. Deploy.

## 2. Set environment variables

In Netlify: **Site configuration → Environment variables → Add a variable**.
Add all four, then redeploy the site (Deploys → Trigger deploy):

| Variable           | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| `ARCHIVE_PASSWORD` | Your publishing password. Choose a long one.                 |
| `GITHUB_TOKEN`     | A GitHub token that can write to the repo (see below).       |
| `GITHUB_REPO`      | `YOUR_USERNAME/archive` — owner/name of the repository.      |
| `GITHUB_BRANCH`    | Optional. Defaults to `main`.                                |

**Creating the GitHub token:** GitHub → Settings → Developer settings →
Personal access tokens → **Fine-grained tokens** → Generate new token.
Restrict it to the one archive repository, and under *Repository
permissions* grant **Contents: Read and write**. Nothing else. Copy the
token into `GITHUB_TOKEN`.

## 3. Change the password

Netlify → Site configuration → Environment variables → edit
`ARCHIVE_PASSWORD` → save → **Trigger deploy**. That's all — the
password lives nowhere else. No code changes, no commits.

## 4. Publish a new thought

1. Open the site on a **desktop** browser (the composer is hidden on
   mobile).
2. Write in the textarea, and/or attach an image.
3. Type your password in the password field.
4. Press **Save**.

The entry appears immediately in your view. Behind the scenes the
function commits it to GitHub, Netlify redeploys (about a minute), and
after that the entry is permanent and public for everyone.

## 5. Upload images

Images are uploaded through the same composer — click **Attach image**.
Supported: JPEG, PNG, GIF, WebP — any size. Netlify Functions reject
request bodies over ~6 MB (a platform limit), so images larger than
~3.5 MB are automatically downscaled and re-encoded as JPEG in the
browser before upload. The one exception is animated GIFs, which
cannot be recompressed without freezing them and must stay under
3.5 MB. The backend commits the file into `/images/` named after the
entry's id, so images and entries can never get mixed up.

You can also add images manually: commit a file into `images/` and
reference it from an entry in `thoughts.json` as `"/images/name.jpg"`.

## 6. Delete a thought

Type your password into the composer's password field, then press the
small **delete** at the bottom of the entry and confirm. The backend
verifies the password, removes the entry from `thoughts.json`, and
deletes its image from the repository. Permanent after the redeploy.

(Note: git history still remembers deleted content — that is the nature
of an archive stored in git. To erase something from history entirely
you would need to rewrite the repository history.)

## Editing by hand

Because the database is a JSON file in your repo, you can always bypass
the website entirely: edit `thoughts.json` in the GitHub web editor,
commit, and the site redeploys. The archive will outlive any interface.

## Local development

```bash
npm install -g netlify-cli
netlify dev
```

`netlify dev` serves the static site and the functions together at
`http://localhost:8888`. Put the environment variables in a local
`.env` file (never commit it) or link the site with `netlify link` to
use the values configured on Netlify.

## Security notes

- The password is compared **server-side only**, using a constant-time
  comparison (`crypto.timingSafeEqual` over SHA-256 digests).
- The frontend contains no secrets of any kind — hiding the composer on
  mobile is layout, not security.
- Entries are rendered with `textContent`, never `innerHTML`, so posted
  text cannot inject markup or scripts.
- The GitHub token is scoped to a single repository with Contents
  permission only, and also lives exclusively in Netlify's environment.
