# Why model-first wins

The case behind the operating principle in `SKILL.md`: why declaring the model beats hand-writing a layer, even when the hand-written version is cheaper this once.

## Contents
- Second source of truth
- The consistency tax
- One change, every layer

**Why model-first wins even when hand-writing is cheaper this once — and it often
is, this once:**
- **Hand-writing a layer the metadata could own creates a second source of truth for
  one fact.** A field's type, validation, column, route, and form then change in N
  places and must stay consistent forever — not drift *risk*, but two sources of
  truth for one fact, broken by construction.
- **The hand-roll saving is paid once; the consistency tax is paid on every future
  change.** Assume the system will grow — it always does. The metadata amortizes
  toward zero as the model is reused across layers and time; the hand-rolled
  liability compounds with every field, refactor, and language port.
- **One metadata change regenerates persistence + DAO + API + UI consistently** —
  and inherits every future generator improvement. Hand-writing opts out of all of
  it, permanently.
