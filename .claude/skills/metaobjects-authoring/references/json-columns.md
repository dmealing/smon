# A JSON column — the rest of the ladder

> Part of the `metaobjects-authoring` skill. The skill carries the ladder itself ("A JSON column"). Read this for the objections that are not reasons to take the bag, per-port coverage, `field.map` runtime support, version caveats, and migrating a bag to a native array.

Two things that read as reasons to take the bag, and are not:

- **"There is no value object for it."** Declaring one IS the work — an `object.value` carrying
  the members the writer's class has, a few lines beside the entity. `field.object` *requires*
  `@objectRef` precisely so a shape cannot be half-declared; the loader's pointer at
  `@dbColumnType: jsonb` on that error is for the genuinely open case, not the missing-VO case.
- **"A partial VO would strip unknown keys."** Only if the VO is partial — declare the keys the
  writer sends. A genuinely unbounded key set over a typed value is the `field.map` row, still
  not the bag.

**Port coverage, stated plainly.** The `isArray` and `object.value` rungs round-trip on every
port through the persistence and api-contract corpora. `field.map` now emits the typed handle on
**all five ports** — Java types it `java.util.Map<String, V>` and reaches a map's `@objectRef`
value object in the emission walk; C# emits the `Dictionary<string, V>` property *and* the EF
jsonb storage mapping. **But that is CODEGEN only: no persistence- or api-contract-conformance
fixture exercises `field.map` on any port, and the runtime persistence tier is uneven** — only
Python's `ObjectManager` encodes a map today; `runtime-ts`, Java's OMDB and the Kotlin Exposed
lane carry no map handling at all. So a map you intend to read back through a PORT RUNTIME is
still better declared as a value object, and a genuinely dynamic key set stays a bag.

**One more version question, if a JAVA caller CONSTRUCTS the value object.** Kotlin's default
arguments are a compiler feature, not a bytecode one, so a generated data class used to offer
Java only the full N-arg constructor and a no-arg one yielding an all-null instance of an
immutable class — a caller setting 3 of 14 members had to pass 14 arguments with 11 nulls. A
generated VO replacing a hand-written builder therefore made its Java call sites *worse*.
Generated entities and value objects now emit a nested `Builder` plus a `@JvmStatic builder()`
(`Money.builder().currency("USD").build()`), so partial construction from Java works — **from
8.0.2** on Maven Central (the npm line's 1.0.2). Check the adopter's pinned version: 8.0.1 and
earlier have no builder. The Java port's own generated records (`codegen-spring`: an entity's
`<Name>Dto`, a value object, a prompt payload) gain a builder in the same release. Its `build()`
passes nulls through, because `@NotNull` on a record component is enforced at validation. Reading is unaffected on every version (Kotlin `val` emits Java
getters), so a bag that is only READ converts safely today; it is construction that was blocked.
`object.projection` deliberately gets no builder — it is derived and read-only, and nothing
constructs one.

**One sharp edge where generated code IS the consumer, and it is now a VERSION question rather
than a port question: nested map values.** As of **1.0.1** every port validates them on every
write path ([#362](https://github.com/metaobjectsdev/metaobjects/issues/362)). On **1.0.0 the
hole is open**, so check the adopter's pinned version before recommending this rung to a Java
or C# consumer: Java validated nested map values on its vanilla create/PATCH handlers but not
on TPH (discriminator-rooted) write paths, which validate field-by-field with `validateValue`
and do not cascade `@Valid`; C# validated them on no write path at all — the map never reached
the recursively-validating value-object arms (they admit `field.object` only), and
`ValueObjectValidator` treated a `Dictionary` as a plain `IEnumerable`, validating
`KeyValuePair` structs instead of the values. TypeScript and Python were never affected, and
Kotlin writes no map column. Scalar-valued maps (`@valueType`) carry no nested bean and were
never affected on any version. **The failure mode was silent acceptance, not an error** — a
POST or PATCH carrying an invalid nested value returned 201/200 and wrote the row — so an
adopter still on 1.0.0 needs their own boundary check, and one written while this was open is
now redundant rather than load-bearing. Every rung but the first keeps the
column jsonb, so moving a column up the ladder is a codegen/contract change rather than a
migration — read the emitted DDL before promising that.

**The first rung IS a migration, and it has a version question of its own.** jsonb → a native
array is a lossy type change to `meta migrate`, so it is refused until you pass
`--allow type-change`. The emitted migration converts the rows in place: a `USING` clause unpacks
each jsonb array, keeps element order, maps a JSON `null` to NULL, and FAILS on a row that is not
an array rather than nulling it. That conversion ships in **1.0.2**. On 1.0.1 and earlier the emitted `ALTER … TYPE TEXT[]` carries
no `USING`, and Postgres refuses it ("cannot be cast automatically"), so add the conversion by hand
before applying. On every version the WRITER changes in the same deploy: a writer that sent
`json.dumps(xs)` or a JSON-encoded string must now send the list itself.
