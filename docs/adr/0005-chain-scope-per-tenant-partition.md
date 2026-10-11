# 0005. Chain scope: one chain per tenant or partition, not one global chain

## Context

A hash chain has a single write path by construction: to append, a writer must read the current
head, hash the new entry against it and publish the new head. That is the property that makes the
log tamper-evident, and it is also the property that makes a single global chain a bottleneck and a
single point of failure.

Three forces pull in different directions:

- **Throughput and contention.** Every append to one chain has to serialize behind the current head.
  Two writers that touch different tenants' data still contend on the same row (or the same
  compare-and-set) if they share one chain. Throughput then does not grow with the number of
  services or tenants; it grows only with how fast one head can be advanced.
- **Blast radius.** One corrupt entry, one bad deploy or one compromised writer taints every entry
  after it. In a single chain, a break in tenant A forces a full re-verification of tenants B..Z and
  makes their proofs unverifiable until the incident is resolved, even though their data was never
  touched. Forensics also have to sift one interleaved log to find the one changed row.
- **Domain boundaries.** Different tenants have different retention, residency, access-control and
  key-rotation requirements. A single chain forces them into one integrity domain and one key.

Against that, a single global chain is dramatically simpler: one head to publish, one root to
anchor, one signature to verify, and a total order over every event in the system.

## Decision

**One chain per tenant (or per partition), each with its own genesis hash and its own anchor
stream.** Partitioning is a deployment decision, not an engine one: the engine models a chain as a
value (`LedgerChain`), and every operation — `append`, `verifyChain`, `merkleRoot`, `anchorRoot`,
`signChain` — takes a chain and knows nothing about other chains. A partition is simply another
chain.

When a global view is required, it is composed *on top of* the partition chains rather than baked
into them: aggregate the partition roots into a separate anchor/manifest chain, and sign that
manifest. The per-partition chains keep their independent write paths; only the thin manifest is
contended, and it is appended far less often.

## Consequences

- **Throughput scales with partitions.** Writers only contend with other writers in the same
  partition, so the number of independent append paths grows with the partitioning key. The cost is
  more chains to operate, monitor and back up.
- **A break is contained.** Corruption in one chain cannot invalidate another chain's proofs. The
  incident is scoped to the tenant or partition whose chain broke, which is exactly the blast
  radius a forensic investigation wants.
- **Verification and anchoring become per-partition.** A verifier checks the chains it cares about,
  which is cheaper than scanning one global log, but there is no longer a single hash to compare
  across the system. The signed export is therefore a package per partition (or a signed manifest of
  partition roots), not one artifact for everything.
- **No free total order.** Two partitions have no defined order between them. If the product needs a
  cross-tenant sequence, the manifest chain supplies it, at the cost of re-introducing a shared
  append path — a much lighter one, since it only records roots.
- **Per-partition keys are possible.** Each tenant can have its own signing key, which improves
  isolation but adds key management. A shared key keeps the export simpler but widens the blast
  radius of a key compromise.

## Alternatives considered

- **One global chain.** The simplest thing that works and the strongest total ordering, and it is
  the right default for a small system. It is rejected here because it serializes every writer on
  one head and makes every tenant share one blast radius and one key, and because nothing in this
  product needs a global order over unrelated tenants' events.
- **Sign each record independently, no chain.** Removes the write bottleneck entirely, but it proves
  only that a row is authentic, not that the log is complete: a deleted or reordered row leaves no
  trace. It is the exact failure this project exists to explain.
- **Shard by time (one chain per day), not by tenant.** Bounds the length of each chain and spreads
  the head, but every shard still mixes all tenants, so the blast radius and the integrity domains
  stay global, and a day boundary becomes another thing to reason about.
- **Shard by writer/service.** Good for throughput and containment of a single broken service, but
  one tenant's evidence is then scattered across several chains, which makes a "prove this tenant's
  log was not altered" claim harder to state.
