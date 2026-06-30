/**
 * Big-int string arithmetic helpers.
 *
 * Prisma 5.22 does not expose `String`-typed columns through the `_sum`
 * aggregate input — typing `prisma.payment.groupBy({ _sum: { amountUsdc:
 * true } })` collapses the result type to `never` for that field, and
 * the resulting `string | undefined` becomes unreachable in practice.
 *
 * The pattern below is the workaround used across packages:
 *   - select minimal rows
 *   - sum the string column in memory using bigint math
 *
 * Centralized here so that we have ONE audited conversion routine
 * shared by repositories, workers, and route handlers. Decimal precision
 * is preserved by working in base units (USDC = 6 decimals on Arc).
 */

type StringLike = string | null | undefined;
type Row = Record<string, unknown>;

/**
 * Sum a string column across multiple rows.
 * Empty / null values are treated as 0. Non-numeric strings throw.
 */
export function sumStrings<K extends string>(
  rows: readonly Row[],
  key: K,
): bigint {
  let total = 0n;
  for (const row of rows) {
    const v = row[key] as StringLike;
    if (v == null) continue;
    total += BigInt(v);
  }
  return total;
}

/**
 * Sum and convert to a fixed decimal string (base-units → USDC).
 * Use this at the API boundary so the wire format stays a string and
 * bigint never bleeds into `JSON.stringify`.
 */
export function sumStringsToUsdc<K extends string>(
  rows: readonly Row[],
  key: K,
  decimals = 6,
): string {
  const base = sumStrings(rows, key);
  if (decimals <= 0) return base.toString();
  const neg = base < 0n;
  const abs = neg ? -base : base;
  const factor = 10n ** BigInt(decimals);
  const whole = abs / factor;
  const frac = abs % factor;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole.toString()}${fracStr ? '.' + fracStr : ''}`;
}

/**
 * Sum a numeric field via in-memory aggregation. Like `sumStrings` but
 * for Int/BigInt columns.
 */
export function sumBigints<K extends string>(
  rows: readonly Row[],
  key: K,
): bigint {
  let total = 0n;
  for (const row of rows) {
    const v = row[key];
    if (v == null) continue;
    if (typeof v === 'bigint') total += v;
    else if (typeof v === 'number') total += BigInt(Math.trunc(v));
    else if (typeof v === 'string') total += BigInt(v);
  }
  return total;
}

/**
 * Coerce a Prisma JsonValue or numeric-ish value to a base-units string.
 * Useful when reading back persisted IndexerCursor or analytics rows.
 */
export function coerceStringAmount(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return BigInt(Math.trunc(value)).toString();
  if (typeof value === 'string') return value;
  throw new TypeError(`Cannot coerce ${typeof value} to base-units string`);
}

/**
 * Build a typed "select" payload alias that round-trips Prisma's
 * `Prisma.XGetPayload<{ select: {...} }>` flow without leaking the
 * Prisma namespace into application code.
 */
export type SelectPayload<
  TSelect extends Record<string, unknown>,
  TCompute extends (args: TSelect) => unknown,
> = ReturnType<TCompute>;
