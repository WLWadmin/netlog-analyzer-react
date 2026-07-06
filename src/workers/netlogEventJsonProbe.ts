export function extractTopLevelNumericField(json: string, fieldName: string): number | undefined {
  return extractTopLevelNumberLikeField(json, fieldName, false);
}

export function extractTopLevelNumberLikeField(json: string, fieldName: string, allowQuoted = true): number | undefined {
  let depth = 0;
  let inString = false;
  let escape = false;
  let readingKey = false;
  let keyBuffer = '';
  let expectingColonForKey: string | null = null;
  let expectingNumberForKey: string | null = null;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];

    if (readingKey) {
      if (escape) {
        keyBuffer += ch;
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        readingKey = false;
        if (depth === 1 && keyBuffer === fieldName) {
          expectingColonForKey = keyBuffer;
        }
        keyBuffer = '';
      } else {
        keyBuffer += ch;
      }
      continue;
    }

    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (expectingColonForKey) {
      if (/\s/.test(ch)) continue;
      if (ch === ':') {
        expectingNumberForKey = expectingColonForKey;
      }
      expectingColonForKey = null;
      continue;
    }

    if (expectingNumberForKey) {
      if (/\s/.test(ch)) continue;
      if (allowQuoted && ch === '"') {
        const match = json.slice(i + 1).match(/^-?\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : undefined;
      }
      const match = json.slice(i).match(/^-?\d+/);
      return match ? Number(match[0]) : undefined;
    }

    if (ch === '"') {
      inString = true;
      if (depth === 1) {
        readingKey = true;
        inString = false;
        keyBuffer = '';
      }
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return undefined;
}

export function extractSourceTypeId(json: string): number | undefined {
  const sourceMatch = json.match(/"source"\s*:\s*\{[^}]*"type"\s*:\s*(\d+)/);
  return sourceMatch ? Number(sourceMatch[1]) : undefined;
}

export function extractSourceId(json: string): number | undefined {
  const sourceMatch = json.match(/"source"\s*:\s*\{[^}]*"id"\s*:\s*(\d+)/);
  return sourceMatch ? Number(sourceMatch[1]) : undefined;
}
