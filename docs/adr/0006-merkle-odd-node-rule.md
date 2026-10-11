# 0006. Merkle odd-node rule: duplicate the last node

## Context

A binary Merkle tree hashes pairs of children into a parent. At any level built from an odd number
of nodes, exactly one node has no sibling, and the rule for that node is not free: it changes the
root, the proofs, and which leaf sets can share a root.

Three rules are in common use:

1. **Duplicate** the unpaired node and pair it with itself. This is the convention used by Bitcoin.
2. **Promote** the unpaired node unchanged to the next level, deferring the pairing.
3. **Refuse** odd levels entirely, padding the leaf list to a power of two first.

The rule is a security decision, not a formatting one, because it decides whether two *different*
sets of leaves can produce the same root. A root collision would let someone present a proof for a
leaf in a tree that was not the tree that was anchored.

The engine also has to answer a second question: what is the root of a tree with no leaves?

## Decision

**Duplicate the unpaired last node and pair it with itself**, i.e. the parent of an unpaired node
`n` is `SHA-256(domain ‖ n ‖ n)`. The rule is applied at every level. A leaf and an internal node
can never share a preimage because internal nodes are hashed with a domain prefix
(`audit-chain:merkle:node:`) followed by two fixed-width 64-hex hashes, while a leaf is
`SHA-256(canonicalize(...))`.

**The root of an empty tree is the empty string**, a value that is not the hash of any leaf, so an
empty tree can never be confused with a non-empty one.

## Consequences

**What duplication protects against.**

- **Ambiguous tree shapes.** Promotion makes the tree's shape depend on how many unpaired nodes are
  carried up, so the same set of leaves can be laid out in more than one way and two differently
  shaped trees can end up with the same root. Duplication fixes the shape: every node either has a
  real sibling or a copy of itself, and the pairing is fully determined by the leaf list. The proof
  format stays local and uniform — a verifier never needs to know the tree's width, only the sibling
  hash and its side.
- **Undefined behavior at the boundary.** There is no "no sibling" case to special-case in
  `verifyProof`; an unpaired node arrives as an ordinary sibling equal to the node itself.

**What duplication does *not* protect against — and the engine's mitigation.**

- Duplication makes `[a, b, c]` and `[a, b, c, c]` produce the **same root**, so a proof for the last
  leaf is also a valid proof as if there had been an extra copy of it. This is the known
  Bitcoin CVE-2012-2459 ambiguity. It does **not** let anyone forge a proof for a leaf that is not in
  the tree; it only blurs the exact leaf count when the last leaf is repeated.
- In this engine the ambiguity is not reachable in practice. Leaves are entry hashes and two
  identical leaves would require two byte-identical entries, which the canonical serialization makes
  effectively impossible for distinct records. More importantly, the *chain* — not the Merkle tree —
  is what pins the entry count and sequence: `verifyChain` walks every entry and checks its sequence
  and link, and anchors carry an explicit `entryCount` and `atSeq`. A duplicated last leaf cannot be
  used to hide or add an entry, because the tree is only ever asked to prove inclusion into a chain
  whose length is already committed to.
- If leaf duplication ever became possible (for example, if the tree were built over values that can
  legitimately repeat), the fix is to commit to the leaf index and the leaf count inside the leaf
  preimage, so a copy of a leaf is a different leaf.

**Empty tree.** Returning the empty string gives a defined, non-hash answer that no non-empty tree
can match, so an empty anchor or an empty export package fails verification instead of accidentally
matching something.

## Alternatives considered

- **Promote the unpaired node unchanged.** Fewer hashes and a slightly shallower tree, but it makes
  the tree's shape ambiguous and lets two different leaf sets collide on the root, which is the exact
  failure a Merkle root is supposed to prevent. Rejected.
- **Pad the leaf list to a power of two with a fixed value.** Uniform and collision-resistant, but it
  changes the root when a record is merely added, forces the verifier to know the padding width, and
  introduces a value that must never be a real leaf. It buys complexity the duplicate rule avoids.
- **Refuse odd levels (require a perfect binary tree).** Correct and unambiguous, but forces every
  append to repad and recompute a large part of the tree, which is hostile to the append-heavy chain
  this project builds.
- **XOR leftover nodes.** Used by some logs for compactness, but it loses the binary-tree inclusion
  proof guarantee and makes proofs non-local. Rejected.
