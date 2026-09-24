// Independent test oracle: exact rationals built directly from decimal text.
// It shares no code with src/ so production helpers never grade themselves.

export type Rational = { n: bigint; d: bigint };

export function rational(token: string): Rational {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u.exec(token);
  if (match === null) throw new Error(`oracle cannot parse ${token}`);
  const [, sign, integer = "", fraction = "", exponent = "0"] = match;
  let n = BigInt(`${integer}${fraction}` || "0");
  let d = 10n ** BigInt(fraction.length);
  const e = BigInt(exponent);
  if (e >= 0n) n *= 10n ** e;
  else d *= 10n ** -e;
  if (sign === "-") n = -n;
  return reduce({ n, d });
}

export function reduce(value: Rational): Rational {
  const g = gcd(value.n < 0n ? -value.n : value.n, value.d);
  return g === 0n ? { n: 0n, d: 1n } : { n: value.n / g, d: value.d / g };
}

export function compareRational(a: Rational, b: Rational): -1 | 0 | 1 {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function divideRational(a: Rational, b: Rational): Rational {
  if (b.n === 0n) throw new Error("oracle division by zero");
  const n = a.n * b.d;
  const d = a.d * b.n;
  return reduce(d < 0n ? { n: -n, d: -d } : { n, d });
}

export function addRational(a: Rational, b: Rational): Rational {
  return reduce({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
}

export function multiplyRational(a: Rational, b: Rational): Rational {
  return reduce({ n: a.n * b.n, d: a.d * b.d });
}

export function equalRational(a: Rational, b: Rational): boolean {
  return compareRational(a, b) === 0;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
