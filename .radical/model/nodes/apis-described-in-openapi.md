---
id: "b28e5aaa-5336-48ae-96f5-00023d2c6288"
type: "adr"
label: "APIs described in OpenAPI"
alternatives: "Consumer-driven contracts with a broker: rejected for now, a broker is one more service for two callers. Types in a shared package: rejected, it ties the releases of both systems."
consequences: "A change that removes or renames anything is a new major version. A client's build can read the pinned description and compare its calls with it, so a mismatch shows before the deploy."
context: "A team changes its API in its own repository, and the team that calls it finds out when a call fails."
date: "2026-11-03"
decision: "Every HTTP API has an OpenAPI description in the repository of its service, released with the repository's version. A client in another system calls only what the description at its pinned version says."
status: "accepted"
---
