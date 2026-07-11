// Hand-written config-access helpers shared by the notify/impl/* adapters. `cfg` is
// `Readonly<Record<string, string>>` (see NotifyAdapter in
// src/generated/notify/registry.data.ts) — with `noUncheckedIndexedAccess` on (tsconfig.json),
// indexing it always types as `string | undefined`, so every adapter needs the same
// present-and-non-empty check `missingAdapterConfig` already uses for its own absent/empty rule.

/** Look up `key` in `cfg`, throwing if it's absent or empty (same "empty counts as
 *  missing" rule as `missingAdapterConfig`). Adapters call this for @requiredConfig keys. */
export function requireConfig(cfg: Readonly<Record<string, string>>, key: string): string {
  const value = cfg[key];
  if (value === undefined || value === "") {
    throw new Error(`notify: missing required config "${key}"`);
  }
  return value;
}

/** Look up an @optionalConfig key in `cfg`, falling back to `fallback` when absent/empty. */
export function optionalConfig(cfg: Readonly<Record<string, string>>, key: string, fallback: string): string {
  const value = cfg[key];
  return value === undefined || value === "" ? fallback : value;
}
