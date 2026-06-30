/**
 * JSON value adapters for Prisma `Json?` columns.
 *
 * Prisma 5.22's generated `InputJsonValue` type is a narrow discriminated
 * union — passing plain `unknown` into `prisma.x.create({ data: { meta } })`
 * no longer compiles. Use these helpers everywhere a Json column is set
 * to keep the call sites readable AND the narrow type preserved.
 */
import { Prisma } from '@prisma/client';

type JsonPrimitive = string | number | boolean | null;
type JsonObject = { [k: string]: JsonValue };
type JsonArray = JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * Convert any unknown value (typically a parsed JSON blob, a captured
 * object literal, or a `JSON.parse(JSON.stringify(...))` round-trip)
 * into Prisma's `InputJsonValue` discriminated union.
 *
 * Strings / numbers / booleans / nulls round-trip directly. Anything
 * structured is canonicalized through `JSON.parse(JSON.stringify())`
 * so circular refs / undefined / functions get clipped.
 */
export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null) return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Variant that defaults to `DbNull` when the input is undefined so
 * `data: { meta: optMeta }` can stay terse. Pass `null` explicitly to
 * store `DbNull`; pass `undefined` to leave the column unchanged.
 */
export function toJsonValueOrUnset(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return toJsonValue(value);
}
