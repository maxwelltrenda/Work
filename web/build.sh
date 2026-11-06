#!/bin/sh
# Vercel build: copy the site to dist/ and stamp every file reference with this
# deploy's version, so browsers (including Dock / Home Screen apps) can't keep
# running an old copy of the app's scripts and styles.
set -e
V=$(printf '%s' "${VERCEL_GIT_COMMIT_SHA:-$(date +%s)}" | cut -c1-8)
rm -rf dist
mkdir dist
for f in *; do [ "$f" = dist ] || cp -R "$f" dist/; done
sed -i "s/__V__/$V/g" dist/index.html dist/*.js
echo "Built version $V"
