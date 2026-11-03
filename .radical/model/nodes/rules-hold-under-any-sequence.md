---
id: "0e7b8def-f0a4-49d2-892d-27a20fa4d56a"
type: "adr"
label: "Rules hold under any sequence"
alternatives: "More scenarios: rejected, they only cover what someone thought of. Only exploration by agents: rejected, its results are not repeatable."
consequences: "A sequence nobody thought of can fail, and it shrinks to the shortest one that does. A known bug is listed as a known failure until it is fixed, or the check stays red."
context: "A scenario proves one sequence of requests. The rules of a system have to hold whatever a client sends, in whatever order."
date: "2026-11-03"
decision: "The rules of each system are written as invariants and checked after every step of random sequences of requests across its services, on fixed seeds with every change and on a random seed every night."
status: "accepted"
---
