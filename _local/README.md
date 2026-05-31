# `_local/` — the private drop-zone 🗂️

**Everything in this folder is gitignored** (except this README) — a guaranteed,
never-committed scratch space.

Use it for **for-you / never-publish** material: launch tweets, private notes,
review drafts, throwaway experiments, scratch data — anything an agent (or you)
should hand over for review *without* it ever reaching the public repo or its
history.

- ✅ Drop anything here — `git status` will not show it.
- 🚫 Nothing here is referenced by the build, the site, or the docs.
- 🧹 Delete freely; nothing in `_local/` is load-bearing.

**Convention:** agents place `TWEETS.md`-type, for-the-creator material in
`_local/` rather than in the tracked tree. This README is the *only* tracked file
in the folder (see the `/_local/*` + `!/_local/README.md` rules in the root
[`.gitignore`](../.gitignore)).
