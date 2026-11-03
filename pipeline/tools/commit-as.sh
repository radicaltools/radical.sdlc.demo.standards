#!/usr/bin/env bash
# Commits what an agent changed, under its name: commit-as.sh <agent> <message>.
# Says on GITHUB_OUTPUT whether there was anything to commit.
set -euo pipefail
agent="$1"; message="$2"
author="radical-${agent}"
git config user.name "$author"
git config user.email "${author}@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then
  echo "${agent} changed nothing."
  echo "changed=false" >> "${GITHUB_OUTPUT:-/dev/null}"
  exit 0
fi
git commit -q -m "$message"
git show --stat --format='%h %an: %s' HEAD
echo "changed=true" >> "${GITHUB_OUTPUT:-/dev/null}"
