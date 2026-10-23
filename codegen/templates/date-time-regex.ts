// Canonical Zod emission for the calendar/clock subtypes on the WRITE side
// (insert / update / preserving schemas, and a value object's jsonb members).
//
// 1.0.8 emitted a bare `z.string()` for `field.date`, `field.time` and a string-mode
// `field.timestamp`, so a request body of `{"dueDate": "next tuesday"}` validated and
// the text reached the column (SQLite stores it verbatim; Postgres rejects it with a
// 500). These are anchored regexes rather than Zod's own `z.string().date()` /
// `.datetime()` / `z.iso.*`, because those differ between Zod 3 and Zod 4 (`z.iso` is
// Zod-4-only, and `.datetime()` rejects the space-separated spelling the databases
// emit), and the codegen peer range is `zod >=3.23.0 <5`. `.regex()` behaves
// identically on both — the same reasoning as `net-regex.ts`.
//
// The date part is CALENDAR-exact: month lengths and the Gregorian leap rule (every 4th
// year, not every 100th, but every 400th) are spelled out in the regex, so `2020-02-30`,
// `2026-04-31` and `2023-02-29` are refused while `2024-02-29` and `2000-02-29` pass. It
// stays a regex rather than a `.refine()` so the emitted expression remains a plain
// `ZodString` on Zod 3 as well as Zod 4 (a Zod 3 refine is a `ZodEffects`, which the
// chains appended after it — `.max()`, `.nullable()` — do not all accept). Before 1.0.9
// this was a shape check only, and `POST {"birthDate": "2020-02-30"}` was a 201.
//
// Every spelling the runtime ITSELF produces must pass, or the check breaks round-trips:
//   - `new Date().toISOString()`       — the @autoSet stamp, and JSON.stringify(Date);
//   - `YYYY-MM-DD HH:MM:SS`            — SQLite CURRENT_TIMESTAMP / CURRENT_TIME text;
//   - `YYYY-MM-DD HH:MM:SS.ffffff+00`  — Postgres string-mode timestamptz output;
//   - `YYYY-MM-DDTHH:MM`               — an `<input type="datetime-local">` value, which
//                                        the generated React form submits;
//   - `HH:MM[:SS[.f]]` (+ an offset)   — Postgres time / timetz, `<input type="time">`.

const TIME_OF_DAY = "(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?";
const UTC_OFFSET = "(?:[Zz]|[+-](?:[01]\\d|2[0-3])(?::?[0-5]\\d)?)?";
// 31-day months, 30-day months, February 1–28 in any year, and February 29 in a leap
// year: `YY` + a multiple of 4 other than `00`, or a multiple-of-4 century + `00`.
const DAY_IN_MONTH =
  "(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|02-(?:0[1-9]|1\\d|2[0-8]))";
const LEAP_YEAR = "(?:\\d{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)";
const CALENDAR_DATE = `(?:\\d{4}-${DAY_IN_MONTH}|${LEAP_YEAR}-02-29)`;

// Each check carries its own short message. Without one, Zod 4 answers
// "Invalid string: must match pattern /…/" — the whole calendar regex, ~300 characters,
// in every API 400 for a bad date. A string second argument to `.regex()` is the issue
// message on Zod 3 and Zod 4 alike.
export const DATE_FORMAT_MESSAGE = "must be an ISO date (YYYY-MM-DD)";
export const TIME_FORMAT_MESSAGE = "must be a time of day (HH:MM[:SS[.fff]], optional offset)";
export const TIMESTAMP_FORMAT_MESSAGE =
  "must be an ISO 8601 timestamp (YYYY-MM-DD[THH:MM[:SS[.fff]]][Z|±HH:MM])";

/** `field.date` — an ISO calendar date, `YYYY-MM-DD`, and nothing else. */
export const ZOD_DATE_EXPR =
  `z.string().regex(/^${CALENDAR_DATE}$/, ${JSON.stringify(DATE_FORMAT_MESSAGE)})`;

/** `field.time` — a time of day, `HH:MM[:SS[.fraction]]`, optionally zoned. */
export const ZOD_TIME_EXPR =
  `z.string().regex(/^${TIME_OF_DAY}${UTC_OFFSET}$/, ${JSON.stringify(TIME_FORMAT_MESSAGE)})`;

/** `field.time` on a MySQL column — a time of day with NO offset. MySQL's `TIME` has no
 *  zone and refuses one (`'12:30:00+05:00'` is ERROR 1292, Incorrect time value), so the
 *  portable check above would pass a body the database then rejects with a 500. */
export const TIME_NO_OFFSET_FORMAT_MESSAGE = "must be a time of day (HH:MM[:SS[.fff]]), without an offset";
export const ZOD_TIME_NO_OFFSET_EXPR =
  `z.string().regex(/^${TIME_OF_DAY}$/, ${JSON.stringify(TIME_NO_OFFSET_FORMAT_MESSAGE)})`;

/** `field.timestamp` (string mode) — an ISO 8601 / SQL timestamp: a calendar date,
 *  optionally followed by `T` or a space, a time of day, and a UTC offset. */
export const ZOD_TIMESTAMP_EXPR =
  `z.string().regex(/^${CALENDAR_DATE}(?:[Tt ]${TIME_OF_DAY}${UTC_OFFSET})?$/, ${JSON.stringify(TIMESTAMP_FORMAT_MESSAGE)})`;

// An instant timestamp is rewritten to UTC on WRITE.
//
// SQLite and D1 keep a string-mode timestamp as TEXT and compare it as text, so a value
// stored as sent — `2026-09-21T01:00:00+05:00`, which is 20:00Z — sorted after
// `2026-09-20T21:00:00Z` and `filter[tastedAt][gt]=…21:00:00Z` returned it. The rewritten
// form is the canonical wire spelling of an instant (fixtures/persistence-conformance/
// normalization.md): `YYYY-MM-DDTHH:MM:SS[.fff]Z`, millisecond resolution, no trailing
// zeros, no fraction at all when it is zero. Its prefix through the seconds is fixed-width,
// so text order equals instant order down to the second. The runtime filter parser
// rewrites a bound the same way (`utcIsoInstant` in runtime-ts — the two must agree).
// Postgres timestamptz stores the instant either way, so it is unaffected.
//
// A value ALREADY spelled `YYYY-MM-DDTHH:MM:SS[.f…]Z` is kept byte-for-byte: it is in UTC and
// orders correctly as it is, and rc.4 turning `…12:10:00Z` into `…12:10:00.000Z` broke an
// adopter's round-trip of a timestamp inside a jsonb value object.
//
// A value with NO zone is read as UTC, and a date-only value as midnight UTC. A default
// `field.timestamp` is an instant whose wire form is "always UTC"
// (docs/features/api-contract.md, "Type encodings"; ADR-0036 Wave 2); a wall clock is
// what `@localTime` declares, and those fields never reach this helper. Kept as sent,
// `2026-10-06` sorted before `2026-10-06T00:00:00Z` as text, so
// `filter[dueAt][gte]=2026-10-06T00:00:00Z` omitted the row. The string handed to
// `Date.parse` is the ECMAScript date-time format it is REQUIRED to read (seconds and a
// three-digit fraction padded in, the offset as `±HH:MM`), so the result does not depend
// on the engine's tolerance for Postgres' `+00`, a six-digit fraction, or a zoneless string
// (which ECMAScript would read as LOCAL time). It runs after the format check, so it only
// ever sees a well-formed value.
//
// Emitted ONCE per module as a local function (generated model code imports nothing from
// MetaObjects at runtime), and referenced by name from each schema that needs it.

/** Name of the module-local normalizer a timestamp WRITE shape transforms through. */
export const UTC_TIMESTAMP_HELPER = "utcIsoTimestamp";

/** The normalizer's declaration, emitted at the top of a module that uses it. */
export const UTC_TIMESTAMP_HELPER_DECL = [
  "/** A field.timestamp instant in UTC (`YYYY-MM-DDTHH:MM:SS[.fff]Z`): a value already spelled so is kept",
  " *  as sent, an offset is applied, a zoneless value is UTC and a date alone is midnight UTC.",
  " *  SQLite/D1 compare timestamps as text, so instants are stored in UTC. Generated. */",
  `function ${UTC_TIMESTAMP_HELPER}(v: string): string {`,
  "  if (/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$/.test(v)) return v;",
  "  const m = /^(\\d{4}-\\d{2}-\\d{2})(?:[Tt ](\\d{2}:\\d{2})(?::(\\d{2})(?:\\.(\\d+))?)?(?:([Zz])|([+-]\\d{2}):?(\\d{2})?)?)?$/.exec(v);",
  "  if (m === null) return v;",
  '  const t = Date.parse(`${m[1]}T${m[2] ?? "00:00"}:${m[3] ?? "00"}.${(m[4] ?? "").slice(0, 3).padEnd(3, "0")}${m[6] === undefined ? "Z" : `${m[6]}:${m[7] ?? "00"}`}`);',
  '  return Number.isNaN(t) ? v : new Date(t).toISOString().replace(/\\.?0+Z$/, "Z");',
  "}",
].join("\n");

/** `field.timestamp` (string mode, instant — not `@localTime`) on a WRITE shape: the format
 *  check, then the to-UTC rewrite above. A module emitting it must also emit
 *  {@link UTC_TIMESTAMP_HELPER_DECL}. */
export const ZOD_TIMESTAMP_UTC_EXPR = `${ZOD_TIMESTAMP_EXPR}.transform(${UTC_TIMESTAMP_HELPER})`;
