---
id: "996b436b-319f-4973-b5f1-19eddcc2a631"
type: "adr"
label: "Services talk over HTTP"
alternatives: "Shared libraries between systems: rejected, a fix in one waits for the releases of all. A shared database: rejected, its tables become an API nobody described."
consequences: "A service can be built, tested and deployed alone. A call needs a client and a test double. A shared need becomes an API or a copy, never a library between systems."
context: "Each system has its own repository and its own team, and a system is still split into services. Code reached across a boundary makes the split exist only on the diagram, and ties the releases of whoever shares it."
date: "2026-11-03"
decision: "Services talk over HTTP only, inside a system and between systems. A service imports its own files and its system's shared types, which hold no behaviour. No service imports another service's code, and no system imports another system's."
status: "accepted"
---
