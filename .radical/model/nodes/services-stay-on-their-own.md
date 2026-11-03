---
id: "90d477d5-f2a7-4883-9860-05370e8a7e80"
type: "fitness-fn"
label: "Services stay on their own"
cadence: "triggered"
characteristic: "maintainability"
invocation: "automated"
max_age: "14d"
measure: "boundaries"
metrics: "boundaries.exit_code == 0"
scope: "atomic"
trigger: "pull-request"
---

Each repository's sensor boundaries reads every import in the element's paths and fails on one that leaves them, other than its system's shared types.
