#!/bin/bash
set -e

cd /workspaces/bar-app

echo "Finding latest PR..."
PR_NUMBER=$(gh pr list --limit 1 --json number --jq '.[0].number')

if [ -z "$PR_NUMBER" ]; then
  echo "No open PRs found."
  exit 1
fi

echo "Switching to main..."
git checkout main
git pull origin main

echo "Merging PR #$PR_NUMBER into main..."
gh pr merge "$PR_NUMBER" --merge --delete-branch

echo "Pulling updated main..."
git pull origin main

echo "Done."
