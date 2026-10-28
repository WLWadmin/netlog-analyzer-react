// Validate skipped JSON literals/numbers without retaining their text. Large
// metadata values must not force a second read or an unbounded token buffer.
export function createJsonPrimitiveGuard() {
  let state: 'start' | 'minus' | 'zero' | 'integer' | 'dot' | 'fraction' | 'exponent' | 'sign' | 'digits' | 'literal' | 'after' = 'start';
  let literal = '';
  let literalOffset = 0;
  const complete = (): boolean => state === 'zero' || state === 'integer' || state === 'fraction'
    || state === 'digits' || state === 'after' || (state === 'literal' && literalOffset === literal.length);
  return {
    complete,
    accept(byte: number): boolean {
      const digit = byte >= 48 && byte <= 57;
      if (byte === 32 || byte === 10 || byte === 13 || byte === 9) {
        if (!complete()) return false;
        state = 'after';
        return true;
      }
      if (state === 'after') return false;
      if (state === 'literal') {
        if (byte !== literal.charCodeAt(literalOffset)) return false;
        literalOffset += 1;
        return true;
      }
      if (state === 'start' && (byte === 116 || byte === 102 || byte === 110)) {
        literal = byte === 116 ? 'true' : byte === 102 ? 'false' : 'null';
        literalOffset = 1;
        state = 'literal';
        return true;
      }
      if (state === 'start' && byte === 45) {
        state = 'minus';
        return true;
      }
      if (state === 'start' || state === 'minus') {
        if (!digit) return false;
        state = byte === 48 ? 'zero' : 'integer';
        return true;
      }
      if ((state === 'integer' || state === 'fraction' || state === 'digits') && digit) return true;
      if ((state === 'zero' || state === 'integer') && byte === 46) {
        state = 'dot';
        return true;
      }
      if (state === 'dot' && digit) {
        state = 'fraction';
        return true;
      }
      if ((state === 'zero' || state === 'integer' || state === 'fraction') && (byte === 101 || byte === 69)) {
        state = 'exponent';
        return true;
      }
      if (state === 'exponent' && (byte === 43 || byte === 45)) {
        state = 'sign';
        return true;
      }
      if ((state === 'exponent' || state === 'sign') && digit) {
        state = 'digits';
        return true;
      }
      return false;
    },
  };
}
