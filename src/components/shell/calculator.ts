export interface CalculatorEvaluation {
  value: number;
  error: boolean;
}

/**
 * Small expression parser used by the global scratchpad calculator.
 * Supports +, -, *, /, parentheses, x/×/÷ aliases, and calculator-style %.
 * No eval() or Function() is used.
 */
export function evaluateCalculatorExpression(expression: string): CalculatorEvaluation {
  let source = String(expression || '').trim();
  if (!source) return { value: 0, error: false };

  source = source.replace(/,/g, '').replace(/[×xX]/g, '*').replace(/÷/g, '/');
  let position = 0;

  function peek(): string {
    return source.charAt(position);
  }

  function skipSpace(): void {
    while (source.charAt(position) === ' ') position += 1;
  }

  function parseExpression(): number {
    const first = parseTerm();
    let value = first.value;

    while (true) {
      skipSpace();
      const operator = peek();
      if (operator !== '+' && operator !== '-') break;

      position += 1;
      const left = value;
      const right = parseTerm();
      const rightValue = right.percent ? left * right.value : right.value;
      value = operator === '+' ? value + rightValue : value - rightValue;
    }

    return value;
  }

  function parseTerm(): { value: number; percent: boolean } {
    const first = parseFactor();
    let value = first.value;
    let percent = first.percent;

    while (true) {
      skipSpace();
      const operator = peek();
      if (operator !== '*' && operator !== '/') break;

      position += 1;
      const right = parseFactor();
      value = operator === '*' ? value * right.value : value / right.value;
      percent = false;
    }

    return { value, percent };
  }

  function parseFactor(): { value: number; percent: boolean } {
    skipSpace();
    const current = peek();

    if (current === '+') {
      position += 1;
      return parseFactor();
    }

    if (current === '-') {
      position += 1;
      const factor = parseFactor();
      return { value: -factor.value, percent: factor.percent };
    }

    if (current === '(') {
      position += 1;
      const value = parseExpression();
      skipSpace();
      if (peek() !== ')') throw new Error('Invalid expression');
      position += 1;
      return applyPercentSuffix(value);
    }

    return applyPercentSuffix(parseNumber());
  }

  function applyPercentSuffix(value: number): { value: number; percent: boolean } {
    skipSpace();
    if (peek() === '%') {
      position += 1;
      return { value: value / 100, percent: true };
    }
    return { value, percent: false };
  }

  function parseNumber(): number {
    skipSpace();
    const start = position;
    while (/[0-9.]/.test(source.charAt(position))) position += 1;
    if (position === start) throw new Error('Invalid expression');

    const raw = source.slice(start, position);
    // Reject malformed decimals such as 1.2.3 instead of silently parsing 1.2.
    if ((raw.match(/\./g) || []).length > 1) throw new Error('Invalid expression');

    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error('Invalid expression');
    return value;
  }

  try {
    const value = parseExpression();
    skipSpace();
    if (position !== source.length || !Number.isFinite(value)) throw new Error('Invalid expression');
    return { value, error: false };
  } catch {
    return { value: 0, error: true };
  }
}

export function formatCalculatorNumber(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
