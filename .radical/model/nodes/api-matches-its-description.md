---
id: "af6ef5a8-e222-492d-8427-2fb929b3a8ea"
type: "fitness-fn"
label: "API matches its description"
cadence: "triggered"
characteristic: "compatibility"
invocation: "automated"
max_age: "14d"
measure: "openapi"
metrics: "openapi.exit_code == 0"
scope: "atomic"
trigger: "pull-request"
---

Each repository's sensor openapi starts the element's service and compares its routes with its OpenAPI description, both ways.
