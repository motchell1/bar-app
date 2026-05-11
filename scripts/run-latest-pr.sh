#!/bin/bash
set -e

cd /workspaces/bar-app

echo "Fetching latest PR..."
git fetch origin

PR_NUMBER=$(gh pr list --limit 1 --json number --jq '.[0].number')

if [ -z "$PR_NUMBER" ]; then
  echo "No open PRs found."
  exit 1
fi

echo "Checking out PR #$PR_NUMBER..."
gh pr checkout "$PR_NUMBER"

echo "Starting mobile app..."
./scripts/start-mobile.sh
