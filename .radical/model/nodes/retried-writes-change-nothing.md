---
id: "9e515080-0dc7-486c-8cd3-74cd74e090fe"
type: "adr"
label: "Retried writes change nothing"
alternatives: "Clients ask before they repeat: rejected, the answer can be stale by the time they act. Exactly-once delivery from a queue: rejected, no queue delivers that, and it moves the problem rather than ending it."
consequences: "Clients can retry without asking what happened. A service keeps the names it has seen, for as long as a client may repeat."
context: "A call over a network can fail after it worked, so a client that cares has to repeat it, and the repeat must not do the work twice. A client that timed out repeats while the first call may still be running."
date: "2026-11-03"
decision: "A write another service may repeat names itself: an Idempotency-Key header, or the id of the event it reports. The same name gets the same answer and changes nothing more, whether the repeat comes after the first write or at the same time. The same key with a different body is refused."
status: "accepted"
---
