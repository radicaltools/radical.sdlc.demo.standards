#!/usr/bin/env bash
# Creates one repository of this demo on GitHub, pushes it, and sets up what the pipeline
# needs: labels, secrets, and the rule that main takes changes only through a pull request
# whose Gate passed.
#
#   pipeline/setup-github.sh <owner/name> <required check>
#
# The check of the standards is "Gate"; a system's, through a reusable workflow, "checks / Gate".
#
# Asks for two secrets:
#   CLAUDE_CODE_OAUTH_TOKEN  from `claude setup-token`
#   AGENT_TOKEN              a fine-grained token on this repository, with Contents,
#                            Pull requests, Issues and Workflows: read and write
set -euo pipefail
repo="$1"; check="$2"

gh repo create "$repo" --public --source . --remote origin --push

gh label create agent:implement --repo "$repo" --color 5319e7 --description "The model and coding agents implement this issue" --force
gh label create agent:fix --repo "$repo" --color d93f0b --description "The coding agent fixes this pull request" --force
gh label create agent:question --repo "$repo" --color fbca04 --description "An agent is waiting for an answer" --force

for name in CLAUDE_CODE_OAUTH_TOKEN AGENT_TOKEN; do
  read -r -s -p "$name: " value; echo
  printf '%s' "$value" | gh secret set "$name" --repo "$repo"
done

# Outsiders cannot open issues or comment. GitHub allows this for six months at most.
gh api -X PUT "repos/$repo/interaction-limits" -f limit=collaborators_only -f expiry=six_months

gh api -X POST "repos/$repo/rulesets" --input - <<JSON
{
  "name": "Protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
      "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false,
      "require_code_owner_review": false, "require_last_push_approval": false,
      "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": false,
      "required_status_checks": [{ "context": "$check" }] } }
  ]
}
JSON
echo "Done: https://github.com/$repo"
