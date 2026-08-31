// Simple test script for Tokenizer-Aware Attribution
// Run with: node test-tokenizer-attribution.js

import { AttributionEngine } from './lib/engine.js';

// Mock context and session for testing
function createMockContext() {
  return {
    on: function(event, handler) {
      return function() { /* disposer */ };
    },
  };
}

function createMockSession(sessionId) {
  return {
    id: sessionId,
    deriveMessages: function() {
      return [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
    },
  };
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`✓ ${message}`);
  } else {
    failed++;
    console.error(`✗ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  const pass = actual === expected;
  assert(pass, `${message} (expected: ${expected}, actual: ${actual})`);
}

function assertIncludes(str, substr, message) {
  const pass = str.includes(substr);
  assert(pass, `${message} (expected to include: ${substr})`);
}

// Test 1: TokenizerService basic functionality
console.log('\nTest 1: TokenizerService basic functionality');
import { TokenizerService } from './lib/engine.js';

const tokenizer = new TokenizerService({ enabled: true, correctionFactor: 3.5 });
assert(tokenizer.enabled, 'Tokenizer is enabled');
assertEqual(tokenizer.correctionFactor, 3.5, 'Correction factor is 3.5');

const tokenCount = tokenizer.countTokens('Hello world test');
assert(tokenCount > 0, 'Token count is positive');
assertEqual(typeof tokenCount, 'number', 'Token count is a number');

// Test 2: Tokenizer estimation
console.log('\nTest 2: Tokenizer estimation');
const estimate = tokenizer.estimateTokens('Hello world test');
assert(estimate > 0, 'Estimation is positive');
assert(estimate <= 10, 'Estimation is reasonable for short text');

// Test 3: Tokenizer cache
console.log('\nTest 3: Tokenizer cache');
tokenizer.clearCache();
const count1 = tokenizer.countTokens('test string');
const count2 = tokenizer.countTokens('test string');
assertEqual(count1, count2, 'Cached results are consistent');
assert(tokenizer.cache.size > 0, 'Cache has entries');

// Test 4: Tokenizer status
console.log('\nTest 4: Tokenizer status');
const status = tokenizer.getStatus();
assert(status.enabled, 'Status shows enabled');
assertEqual(status.type, 'auto', 'Status shows auto type');
assertEqual(status.correctionFactor, 3.5, 'Status shows correction factor');

// Test 5: AttributionEngine with tokenizer enabled
console.log('\nTest 5: AttributionEngine with tokenizer enabled');
const ctx = createMockContext();
const session = createMockSession('test-session');

const engine = new AttributionEngine(ctx, session, {
  noListener: true,
  tokenizer: {
    enabled: true,
    type: 'auto',
    correctionFactor: 3.5,
  },
});

assert(engine.version === 'v0.36', 'Engine version is v0.36');
assert(engine.tokenizer.enabled, 'Engine tokenizer is enabled');

// Test 6: Engine tokenizer status
console.log('\nTest 6: Engine tokenizer status');
const engineTokenizerStatus = engine.getTokenizerStatus();
assert(engineTokenizerStatus.enabled, 'Engine tokenizer status shows enabled');
assertEqual(engineTokenizerStatus.type, 'auto', 'Engine tokenizer type is auto');

// Test 7: Engine toJSON includes tokenizer info
console.log('\nTest 7: Engine toJSON includes tokenizer info');
const json = engine.toJSON();
assert(json.tokenizer !== undefined, 'toJSON includes tokenizer');
assert(json.tokenizer.enabled, 'toJSON tokenizer is enabled');

// Test 8: Disabled tokenizer falls back to character-based
console.log('\nTest 8: Disabled tokenizer falls back to character-based');
const engineDisabled = new AttributionEngine(ctx, session, {
  noListener: true,
  tokenizer: {
    enabled: false,
  },
});

assert(!engineDisabled.tokenizer.enabled, 'Disabled tokenizer is not enabled');
assertEqual(engineDisabled.tokenizer.type, 'auto', 'Disabled tokenizer type is auto');

// Test 9: Tokenizer configuration options
console.log('\nTest 9: Tokenizer configuration options');
const customTokenizer = new TokenizerService({
  enabled: true,
  type: 'generic',
  correctionFactor: 4.0,
  cacheEnabled: false,
});

assert(customTokenizer.enabled, 'Custom tokenizer is enabled');
assertEqual(customTokenizer.type, 'generic', 'Custom type is generic');
assertEqual(customTokenizer.correctionFactor, 4.0, 'Custom correction factor is 4.0');
assert(!customTokenizer.cacheEnabled, 'Custom cache is disabled');

// Test 10: Tokenizer with empty/null text
console.log('\nTest 10: Tokenizer with edge cases');
const edgeTokenizer = new TokenizerService({ enabled: true });
assertEqual(edgeTokenizer.countTokens(''), 0, 'Empty string returns 0');
assertEqual(edgeTokenizer.countTokens(null), null, 'Null returns null');
assertEqual(edgeTokenizer.countTokens(undefined), null, 'Undefined returns null');
assertEqual(edgeTokenizer.countTokens(123), null, 'Number returns null');

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
