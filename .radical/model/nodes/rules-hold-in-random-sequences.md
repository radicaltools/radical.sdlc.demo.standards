---
id: "dbf9b1ec-94ee-4906-87a4-8a1d140d77bd"
type: "fitness-fn"
label: "Rules hold in random sequences"
cadence: "triggered"
characteristic: "reliability"
invocation: "automated"
max_age: "3d"
measure: "fuzz"
metrics: "fuzz.exit_code == 0"
scope: "holistic"
trigger: "nightly"
---

Each repository's sensor fuzz runs random sequences of requests across the element's system, with the rules checked after every step.
