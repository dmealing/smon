// Shared field-level metadata helpers — consumed by entity-constants.ts,
// projection-decl.ts, and any future generator that needs per-field inference.
//
// All helpers take a MetaField node.

import { MetaField } from "@metaobjectsdev/metadata";
import type { MetaObject, MetaRoot } from "@metaobjectsdev/metadata";
import { stripPackage } from "@metaobjectsdev/metadata";
import {
  FIELD_SUBTYPE_STRING,
  FIELD_SUBTYPE_INT,
  FIELD_SUBTYPE_LONG,
  FIELD_SUBTYPE_DOUBLE,
  FIELD_SUBTYPE_FLOAT,
  FIELD_SUBTYPE_DECIMAL,
  FIELD_SUBTYPE_BOOLEAN,
  FIELD_SUBTYPE_DATE,
  FIELD_SUBTYPE_TIME,
  FIELD_SUBTYPE_TIMESTAMP,
  FIELD_SUBTYPE_CURRENCY,
  FIELD_SUBTYPE_ENUM,
  FIELD_SUBTYPE_UUID,
  FIELD_SUBTYPE_URI,
  FIELD_SUBTYPE_INET,
  FIELD_SUBTYPE_OBJECT,
  FIELD_ATTR_OBJECT_REF,
  FIELD_ATTR_STRING_FORMAT,
  FIELD_ATTR_LENIENT,
  STRING_FORMAT_EMAIL,
  STRING_FORMAT_HOSTNAME,
  VIEW_SUBTYPE_TEXT,
  VIEW_SUBTYPE_DATE,
  VIEW_SUBTYPE_NUMBER,
  VIEW_SUBTYPE_CHECKBOX,
  VIEW_SUBTYPE_CURRENCY,
  VIEW_SUBTYPE_DROPDOWN,
  FIELD_ATTR_CURRENCY,
  FIELD_ATTR_CURRENCY_DEFAULT,
  VIEW_CURRENCY_ATTR_LOCALE,
  VIEW_CURRENCY_ATTR_LOCALE_DEFAULT,
} from "@metaobjectsdev/metadata";
import { enumValues } from "@metaobjectsdev/codegen-ts/engine";
import { zodEnumExpr } from "./zod-enum.js";
import { viewForContext } from "@metaobjectsdev/codegen-ts/engine";
import { ZOD_INET_EXPR } from "./net-regex.js";

// ---------------------------------------------------------------------------
// inferViewKind
// ---------------------------------------------------------------------------

/**
 * Resolve the cell-renderer key (view kind) for a field, for the surface named
 * by `context`.
 *
 * An explicit view declared for THAT surface wins; field subType determines the
 * default. #356: `context` is required rather than defaulting, because a caller
 * that omits it is exactly the caller that renders somebody else's view.
 */
export function inferViewKind(field: MetaField, context: string): string {
  // Explicit view for this surface (own or inherited via extends) has highest priority.
  const viewChild = viewForContext(field, context);
  if (viewChild) return viewChild.subType;
  // Field subtype → default view.
  return defaultViewForSubType(field.subType);
}

function defaultViewForSubType(subType: string): string {
  switch (subType) {
    case FIELD_SUBTYPE_BOOLEAN:
      return VIEW_SUBTYPE_CHECKBOX;
    case FIELD_SUBTYPE_INT:
    case FIELD_SUBTYPE_LONG:
    case FIELD_SUBTYPE_DOUBLE:
    case FIELD_SUBTYPE_FLOAT:
    case FIELD_SUBTYPE_DECIMAL:
      return VIEW_SUBTYPE_NUMBER;
    case FIELD_SUBTYPE_DATE:
    case FIELD_SUBTYPE_TIME:
    case FIELD_SUBTYPE_TIMESTAMP:
      return VIEW_SUBTYPE_DATE;
    case FIELD_SUBTYPE_CURRENCY:
      return VIEW_SUBTYPE_CURRENCY;
    case FIELD_SUBTYPE_ENUM:
      // A closed member set is a CHOICE, and the generated form has always rendered it as
      // one: `codegen-ts-react`'s `viewKindFor` returns `dropdown` for an enum declaring no
      // view, and emits a `<select>` with an `<option>` per member.
      //
      // This branch was missing, so the same question had two answers. The emitted
      // `<Entity>` descriptor — which `useEntityForm` reads at RUNTIME — fell through to
      // `text` and told every consumer the control was a free-text input, for the one field
      // subtype where free text is exactly what the model forbids. The form was right and
      // the descriptor describing it was wrong.
      //
      // Fixed HERE rather than in the react tier because this is the shared resolver: the
      // descriptor, the `agent/ui.md` page and the form must give one answer, and pinning
      // the agreement in the tier that renders it would leave the two other readers still
      // computing their own.
      return VIEW_SUBTYPE_DROPDOWN;
    default:
      return VIEW_SUBTYPE_TEXT;
  }
}

// ---------------------------------------------------------------------------
// zodTypeFor
// ---------------------------------------------------------------------------

/**
 * Resolve the Zod validator expression for a field's storage type.
 *
 * `timestampMode` (default "string") mirrors zod-validators.ts's zodFieldExpr:
 * a "date"-mode FIELD_SUBTYPE_TIMESTAMP column (view/projection read schemas —
 * see view-decl.ts's renderViewReadZodObject, which sources its column TYPE from
 * `mapColumnType(..., timestampMode)`) must agree with the Zod line built here or
 * `z.infer<>` disagrees with the Drizzle column and callers fail to typecheck.
 * FIELD_SUBTYPE_DATE / FIELD_SUBTYPE_TIME are NOT governed by timestampMode —
 * calendar date / time-of-day stay ISO-string-shaped always (verified correct;
 * see zodFieldExpr's identical DATE/TIME case).
 */
export function zodTypeFor(field: MetaField, timestampMode: "date" | "string" = "string"): string {
  switch (field.subType) {
    case FIELD_SUBTYPE_STRING: {
      // ADR-0036/0037 Wave 3: @stringFormat narrows a plain string. Codegen owns
      // the canonical matcher (mirrors zod-validators.ts).
      const fmt = field.attr(FIELD_ATTR_STRING_FORMAT);
      if (fmt === STRING_FORMAT_EMAIL) return "z.string().email()";
      if (fmt === STRING_FORMAT_HOSTNAME) {
        return "z.string().regex(/^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/)";
      }
      return "z.string()";
    }
    case FIELD_SUBTYPE_UUID:
      return "z.string()";
    case FIELD_SUBTYPE_URI:
      // ADR-0036/0037 Wave 3: a URI string — codegen owns the URL matcher.
      // #234: @lenient opts out of well-formedness — bind a plain string.
      return field.attr(FIELD_ATTR_LENIENT) === true ? "z.string()" : "z.string().url()";
    case FIELD_SUBTYPE_INET:
      // ADR-0036/0037 Wave 3 + #234: an IP string — codegen owns the IP matcher
      // (v4 or v6 literal). Zod-version-agnostic regex union (Zod 4 removed
      // `z.string().ip()`); see net-regex.ts. @lenient → a plain string.
      return field.attr(FIELD_ATTR_LENIENT) === true ? "z.string()" : ZOD_INET_EXPR;
    case FIELD_SUBTYPE_BOOLEAN:
      return "z.boolean()";
    case FIELD_SUBTYPE_DATE:
    case FIELD_SUBTYPE_TIME:
      // Calendar date / time-of-day — always ISO-string-shaped, not governed by
      // timestampMode (verified correct; mirrors zodFieldExpr).
      return "z.string()";
    case FIELD_SUBTYPE_TIMESTAMP:
      // CRITICAL 3 (#281 sweep miss): must agree with the Drizzle view/projection
      // column's mode (mapColumnType via ViewDeclOpts.timestampMode) — a
      // hardcoded z.string() here disagreed with a "date"-mode column (Date-typed),
      // producing the same TS2322 cascade Critical 1 fixed for insert/update.
      // z.coerce.date() (not z.date()) for uniformity with zodFieldExpr: it
      // passes a DB-driver Date through unchanged (the read case this function
      // serves) and would equally accept an ISO string if ever reused for a
      // wire-parsing schema.
      return timestampMode === "date" ? "z.coerce.date()" : "z.string()";
    case FIELD_SUBTYPE_INT:
    case FIELD_SUBTYPE_LONG:
    case FIELD_SUBTYPE_CURRENCY:
      return "z.number().int()";
    case FIELD_SUBTYPE_DOUBLE:
    case FIELD_SUBTYPE_FLOAT:
      return "z.number()";
    case FIELD_SUBTYPE_DECIMAL:
      // A view column of this subtype is Drizzle's `numeric`, which READS a string (the
      // driver does not parse an arbitrary-precision value into a lossy double), and
      // `field.decimal` is a `string` in TypeScript everywhere else. `z.number()` here
      // disagreed with the view's own inferred row type and did not compile.
      return "z.string()";
    case FIELD_SUBTYPE_ENUM: {
      const values = enumValues(field);
      return values !== undefined ? zodEnumExpr(values) : "z.string()";
    }
    default:
      return "z.unknown()";
  }
}

// ---------------------------------------------------------------------------
// currencyMetaFor
// ---------------------------------------------------------------------------

/**
 * Resolve currency code + locale for a currency-subtype field, for the surface
 * named by `context`. Returns null for non-currency fields.
 */
export function currencyMetaFor(
  field: MetaField,
  context: string,
): { currency: string; locale: string } | null {
  if (field.subType !== FIELD_SUBTYPE_CURRENCY) return null;
  const currency =
    (field.attr(FIELD_ATTR_CURRENCY) as string | undefined) ?? FIELD_ATTR_CURRENCY_DEFAULT;
  // #356: the surface's own view carries the @locale for that surface — two
  // currency views with different locales must not be resolved by position.
  // When the surface's view is NOT a currency view (or there is none), keep the
  // pre-#356 scan: an authored @locale anywhere on the field beats the default.
  const contextView = viewForContext(field, context);
  const viewChild =
    contextView?.subType === VIEW_SUBTYPE_CURRENCY
      ? contextView
      : field.views().find((c) => c.subType === VIEW_SUBTYPE_CURRENCY);
  // ADR-0039: resolving — a view may inherit @locale via extends.
  const locale =
    (viewChild?.attr(VIEW_CURRENCY_ATTR_LOCALE) as string | undefined) ??
    VIEW_CURRENCY_ATTR_LOCALE_DEFAULT;
  return { currency, locale };
}

// ---------------------------------------------------------------------------
// valueObjectFor
// ---------------------------------------------------------------------------

/**
 * The `object.value` a `field.object`'s `@objectRef` names, or `undefined` when the
 * field is not an object field, declares no ref, or names one that is not in the run.
 *
 * THIS IS THE "DOES THE FORM NEST THIS FIELD?" PREDICATE, and it lives here because two
 * tiers have to give one answer: `codegen-ts-react`'s form generator recurses into the
 * referenced value object as a `<fieldset>` sub-form (or a `useFieldArray` repeatable
 * group when the field is an array) instead of emitting an input at all, and
 * `agent/ui.md` documents what that form renders. When they answered separately the page
 * printed `text` — the field's resolved `view.*` subtype, which the form never consults
 * for a nested field — as if it were the control.
 *
 * The resolution is BARE-NAME on purpose: it is the same lookup the Zod and
 * inferred-type templates perform, and changing it here would change what the generated
 * form nests. A package-aware resolution is a separate decision with its own blast
 * radius (ADR-0042).
 */
export function valueObjectFor(field: MetaField, root: MetaRoot): MetaObject | undefined {
  if (field.subType !== FIELD_SUBTYPE_OBJECT) return undefined;
  // ADR-0039: resolving — @objectRef may be inherited via extends.
  const ref = field.attr(FIELD_ATTR_OBJECT_REF);
  if (typeof ref !== "string" || ref.length === 0) return undefined;
  const base = stripPackage(ref);
  return root.objects().find((o) => o.name === base);
}

// ---------------------------------------------------------------------------
// labelFor
// ---------------------------------------------------------------------------

/**
 * Resolve the human-readable label for a field, for the surface named by `context`.
 * Uses the registered `@title` common attr — on that surface's view first, else on the
 * field itself; otherwise humanizes the field name.
 *
 * #353 — this read `@label`, which no provider registers on any `view.*` subtype, so the
 * override branch was unreachable: authoring it fails the strict load `meta verify` runs
 * (ERR_UNKNOWN_ATTR). `title` is already a registered common attr on every node and
 * already means "a noun phrase", so nothing was registered for this (ADR-0037 step 0).
 */
export function labelFor(field: MetaField, context: string): string {
  // #356: the label reads the view for THIS surface, not whichever view was
  // declared first — a grid header must not retitle the form's field.
  // ADR-0039: resolving — a view may inherit @title via extends.
  const title = viewForContext(field, context)?.attr("title");
  if (typeof title === "string" && title.length > 0) return title;
  const fieldTitle = field.attr("title");
  if (typeof fieldTitle === "string" && fieldTitle.length > 0) return fieldTitle;
  return humanize(field.name);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Convert a camelCase or PascalCase field name to a human-friendly label.
 *
 * THE one copy in this package: `entity-ui-descriptor.ts` re-exports this rather than
 * keeping a second body, because two spellings of "humanize" is two answers to what a
 * field is CALLED — the label a form renders and the label the docs page prints.
 */
export function humanize(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** The `<input>` attributes a numeric field subtype needs. */
export interface NumericInputControl {
  readonly htmlType: "number" | "text";
  /** `"any"` for a binary float: the browser's implicit step of 1 refuses `12.5`. */
  readonly step?: "any";
  /** `"decimal"` for an exact decimal rendered as a text input. */
  readonly inputMode?: "decimal";
}

/**
 * The one answer both form tiers give for a numeric field subtype (the `<Entity>` meta that
 * `useEntityForm` spreads, and the nested sub-form in codegen-ts-react), or undefined for a
 * non-numeric subtype.
 *
 * `<input type="number">` has an implicit step of 1, so native validation blocks `12.5`.
 * double/float therefore get `step="any"`. A decimal is an exact value that travels as a
 * string: a number input would parse it to a double for validation and min/max (wrong past
 * 15 digits), so it is `type="text" inputmode="decimal"` and RHF/Zod own the validation.
 * int, long and currency keep step 1.
 */
export function numericInputControl(subType: string): NumericInputControl | undefined {
  switch (subType) {
    case FIELD_SUBTYPE_INT:
    case FIELD_SUBTYPE_LONG:
    case FIELD_SUBTYPE_CURRENCY:
      return { htmlType: "number" };
    case FIELD_SUBTYPE_DOUBLE:
    case FIELD_SUBTYPE_FLOAT:
      return { htmlType: "number", step: "any" };
    case FIELD_SUBTYPE_DECIMAL:
      return { htmlType: "text", inputMode: "decimal" };
    default:
      return undefined;
  }
}
