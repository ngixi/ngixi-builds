/**
 * Version comparison and parsing utilities.
 */

/**
 * Compares two version strings.
 * @param {string} actual - The actual version
 * @param {string} expected - The expected version
 * @returns {number} -1 if actual < expected, 0 if equal, 1 if actual > expected
 */
export function compareVersions(actual, expected) {
  const actualParts = normalizeVersion(actual);
  const expectedParts = normalizeVersion(expected);
  const maxLength = Math.max(actualParts.length, expectedParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const actualPart = actualParts[index] ?? 0;
    const expectedPart = expectedParts[index] ?? 0;
    if (actualPart > expectedPart) {
      return 1;
    }
    if (actualPart < expectedPart) {
      return -1;
    }
  }
  return 0;
}

/**
 * Normalizes a version string into an array of numeric segments.
 * @param {string} version - The version string
 * @returns {number[]} Array of version segments as numbers
 */
export function normalizeVersion(version) {
  const cleaned = stripVersionPrefix(String(version).trim());
  const segments = cleaned.split('.');
  const normalized = [];
  for (const segment of segments) {
    const numeric = parseLeadingInteger(segment);
    if (Number.isFinite(numeric)) {
      normalized.push(numeric);
    }
  }
  return normalized;
}

/**
 * Default version parser that extracts version from command output.
 * @param {string} stdout - Standard output
 * @param {string} stderr - Standard error output
 * @returns {string|null} Parsed version or null
 */
export function defaultVersionParser(stdout, stderr) {
  const tokens = tokenizeWhitespace(`${stdout} ${stderr}`);
  for (const token of tokens) {
    const candidate = extractVersionCandidate(token);
    if (candidate) {
      return stripVersionPrefix(candidate);
    }
  }
  return null;
}

/**
 * Strips 'v' or 'V' prefix from version string.
 * @param {string} value - The version string
 * @returns {string} Version without prefix
 */
export function stripVersionPrefix(value) {
  if (!value) {
    return '';
  }
  if (value[0] === 'v' || value[0] === 'V') {
    return value.slice(1);
  }
  return value;
}

/**
 * Parses the leading integer from a string.
 * @param {string} value - The string to parse
 * @returns {number} The parsed integer or NaN
 */
export function parseLeadingInteger(value) {
  let digits = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (isDigit(char)) {
      digits += char;
    } else {
      break;
    }
  }
  if (!digits) {
    return Number.NaN;
  }
  return Number.parseInt(digits, 10);
}

/**
 * Extracts a version candidate from a token.
 * @param {string} token - The token to extract from
 * @returns {string|null} The version candidate or null
 */
function extractVersionCandidate(token) {
  let buffer = '';
  let hasDigit = false;
  const candidates = [];
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (isDigit(char) || char === '.') {
      buffer += char;
      if (isDigit(char)) {
        hasDigit = true;
      }
    } else if (buffer) {
      if (hasDigit) {
        candidates.push(buffer);
      }
      buffer = '';
      hasDigit = false;
    }
  }
  if (buffer && hasDigit) {
    candidates.push(buffer);
  }
  for (const candidate of candidates) {
    if (candidate.includes('.')) {
      return candidate;
    }
  }
  return candidates.length > 0 ? candidates[0] : null;
}

/**
 * Tokenizes a string by whitespace.
 * @param {string} value - The string to tokenize
 * @returns {string[]} Array of tokens
 */
function tokenizeWhitespace(value) {
  const tokens = [];
  let current = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (isWhitespace(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * Checks if a character is a digit.
 * @param {string} char - The character to check
 * @returns {boolean} True if digit
 */
function isDigit(char) {
  return char >= '0' && char <= '9';
}

/**
 * Checks if a character is whitespace.
 * @param {string} char - The character to check
 * @returns {boolean} True if whitespace
 */
function isWhitespace(char) {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f';
}
