---
id: "a76084a8-7513-4d57-b72d-183f5a52be8b"
type: "fitness-fn"
label: "Repeated write changes nothing"
cadence: "triggered"
characteristic: "reliability"
invocation: "automated"
max_age: "14d"
measure: "idempotency"
metrics: "idempotency.exit_code == 0"
scope: "atomic"
trigger: "pull-request"
---

Each repository's sensor idempotency sends each named write of the element twice and fails when the second answer differs or the state moved.
