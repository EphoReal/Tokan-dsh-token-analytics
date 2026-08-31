// Test script for v0.33.0 - Recalibrated Optimization Signals
// Run with: node test-waste-v33.js

import { detectWaste, THRESHOLDS } from './lib/waste.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('✓ ' + message);
  } else {
    failed++;
    console.error('✗ ' + message);
  }
}

function makeUnit(id, tokens, contextDelta, cost) {
  return {
    unitId: 'unit-' + id,
    toolCall: { callId: 'call-' + id, name: 'tool-' + id, eventSeq: id },
    toolResult: { eventSeq: id + 100, resultSizeChars: 1000, isError: null },
    pairing: { method: 'callId', exact: true },
    context: {
      before: { label: 'before', eventIndex: 0, eventSeq: 0, messageCount: 5, contextChars: 1000 },
      after: { label: 'after', eventIndex: 1, eventSeq: 1, messageCount: 6, contextChars: 1000 + (contextDelta || 0) },
      contextCharsDelta: contextDelta || 0,
      messageDelta: 1,
    },
    usage: { sameStep: null, nextStep: { turn: 0, step: 2, inputTokens: 1000, outputTokens: 500 }, attributedFrom: 'next-step' },
    nextRequestInputTokens: 1000,
    allocationMethod: 'PROPORTIONAL_CONTEXT',
    allocationRatio: 0.5,
    attributedTokens: tokens,
    cost: { status: 'PRICED', request: { inputTokens: 1000, outputTokens: 500, inputCost: 0.001, outputCost: 0.001, totalCost: 0.002 }, attributedCost: cost },
    attributionStatus: 'SUPPORTED',
    confidence: 'MEDIUM',
    notes: [],
  };
}

function createReport(units) {
  return { units: units, sessionId: 'test-session' };
}

function generateNormalSession(n) {
  var units = [];
  for (var i = 0; i < n; i++) {
    units.push(makeUnit(i, 200 + Math.random() * 200, 500 + Math.random() * 500, (200 + Math.random() * 200) * 0.000001));
  }
  return units;
}

console.log('=== v0.33.0 Regression Tests ===\n');

// Test 1: Threshold values are fixed
console.log('Test 1: Fixed thresholds');
(function() {
  assert(THRESHOLDS.opportunity.ratio === 1.5, 'OPPORTUNITY ratio = 1.5');
  assert(THRESHOLDS.opportunity.minAbsoluteDelta === 200, 'OPPORTUNITY minAbsoluteDelta = 200');
  assert(THRESHOLDS.warning.ratio === 3.0, 'WARNING ratio = 3.0');
  assert(THRESHOLDS.warning.minAbsoluteDelta === 800, 'WARNING minAbsoluteDelta = 800');
  assert(THRESHOLDS.critical.ratio === 6.0, 'CRITICAL ratio = 6.0');
  assert(THRESHOLDS.critical.minAbsoluteDelta === 3000, 'CRITICAL minAbsoluteDelta = 3000');
  assert(THRESHOLDS.minBaselineSamples === 5, 'minBaselineSamples = 5');
})();

// Test 2: Normal coding session - minimal signals
console.log('\nTest 2: Normal coding session');
(function() {
  var units = generateNormalSession(25);
  var result = detectWaste(createReport(units), {});
  assert(result.events.length <= 5, 'Normal session has few signals: ' + result.events.length);
  assert(result.severityCountMap.WARNING === 0, 'No WARNING in normal session');
  assert(result.severityCountMap.CRITICAL === 0, 'No CRITICAL in normal session');
})();

// Test 3: Small spike - below minAbsoluteDelta
console.log('\nTest 3: Small spike (below minAbsoluteDelta)');
(function() {
  var units = [
    makeUnit(1, 200, 500, 0.0002),
    makeUnit(2, 200, 500, 0.0002),
    makeUnit(3, 200, 500, 0.0002),
    makeUnit(4, 200, 500, 0.0002),
    makeUnit(5, 200, 500, 0.0002),
    makeUnit(6, 250, 600, 0.00025),  // 1.25x tokens, 1.2x context (100 delta < 200 min)
  ];
  var result = detectWaste(createReport(units), {});
  // Should NOT trigger because absolute deltas are below minAbsoluteDelta
  var oppEvents = result.events.filter(function(e) { return e.severity === 'OPPORTUNITY'; });
  assert(oppEvents.length === 0, 'Small absolute delta does not trigger');
})();

// Test 4: Medium spike - OPPORTUNITY
console.log('\nTest 4: Medium spike (1.5x, 300 delta)');
(function() {
  var units = [
    makeUnit(1, 200, 500, 0.0002),
    makeUnit(2, 200, 500, 0.0002),
    makeUnit(3, 200, 500, 0.0002),
    makeUnit(4, 200, 500, 0.0002),
    makeUnit(5, 200, 500, 0.0002),
    makeUnit(6, 350, 800, 0.00035),  // 1.75x ratio, 150 delta
  ];
  var result = detectWaste(createReport(units), {});
  // Should trigger OPPORTUNITY (ratio >= 1.5 AND delta >= 200 for context)
  var oppEvents = result.events.filter(function(e) { return e.severity === 'OPPORTUNITY'; });
  assert(oppEvents.length >= 1, 'Medium spike triggers OPPORTUNITY');
})();

// Test 5: Large spike - WARNING
console.log('\nTest 5: Large spike (3x, 600 delta)');
(function() {
  var units = [
    makeUnit(1, 200, 500, 0.0002),
    makeUnit(2, 200, 500, 0.0002),
    makeUnit(3, 200, 500, 0.0002),
    makeUnit(4, 200, 500, 0.0002),
    makeUnit(5, 200, 500, 0.0002),
    makeUnit(6, 600, 1500, 0.0006),  // 3x ratio, 1000 delta
  ];
  var result = detectWaste(createReport(units), {});
  var warnEvents = result.events.filter(function(e) { return e.severity === 'WARNING'; });
  assert(warnEvents.length >= 1, 'Large spike triggers WARNING');
})();

// Test 6: Extreme spike - CRITICAL
console.log('\nTest 6: Extreme spike (6x, 3500 delta)');
(function() {
  var units = [
    makeUnit(1, 200, 500, 0.0002),
    makeUnit(2, 200, 500, 0.0002),
    makeUnit(3, 200, 500, 0.0002),
    makeUnit(4, 200, 500, 0.0002),
    makeUnit(5, 200, 500, 0.0002),
    makeUnit(6, 1500, 4000, 0.0015),  // 7.5x ratio, 3500 delta
  ];
  var result = detectWaste(createReport(units), {});
  var critEvents = result.events.filter(function(e) { return e.severity === 'CRITICAL'; });
  assert(critEvents.length >= 1, 'Extreme spike triggers CRITICAL');
})();

// Test 7: High ratio but low absolute - should not trigger
console.log('\nTest 7: High ratio, low absolute (2x, 50 delta)');
(function() {
  var units = [
    makeUnit(1, 100, 200, 0.0001),
    makeUnit(2, 100, 200, 0.0001),
    makeUnit(3, 100, 200, 0.0001),
    makeUnit(4, 100, 200, 0.0001),
    makeUnit(5, 100, 200, 0.0001),
    makeUnit(6, 200, 250, 0.0002),  // 2x ratio but only 50 delta
  ];
  var result = detectWaste(createReport(units), {});
  assert(result.events.length === 0, 'High ratio + low absolute = no signal');
})();

// Test 8: No consecutive duplicate alarms
console.log('\nTest 8: No consecutive duplicates');
(function() {
  var units = [
    makeUnit(1, 200, 500, 0.0002),
    makeUnit(2, 200, 500, 0.0002),
    makeUnit(3, 200, 500, 0.0002),
    makeUnit(4, 200, 500, 0.0002),
    makeUnit(5, 200, 500, 0.0002),
    makeUnit(6, 500, 1200, 0.0005),  // WARNING
    makeUnit(7, 520, 1250, 0.00052), // Similar - should be suppressed
    makeUnit(8, 510, 1220, 0.00051), // Similar - should be suppressed
  ];
  var result = detectWaste(createReport(units), {});
  // Should have fewer events due to consecutive suppression
  assert(result.events.length <= 3, 'Consecutive duplicates suppressed: ' + result.events.length + ' events');
})();

// Test 9: Unique token counting
console.log('\nTest 9: Unique token counting');
(function() {
  var units = [
    makeUnit(1, 200, 500, 0.0002),
    makeUnit(2, 200, 500, 0.0002),
    makeUnit(3, 200, 500, 0.0002),
    makeUnit(4, 200, 500, 0.0002),
    makeUnit(5, 200, 500, 0.0002),
    makeUnit(6, 600, 1500, 0.0006),  // Triggers both context and token
  ];
  var result = detectWaste(createReport(units), {});
  assert(result.flaggedUnits.length === 1, 'One unique flagged unit');
  assert(result.totalFlaggedTokens === 600, 'Tokens counted once: ' + result.totalFlaggedTokens);
})();

// Test 10: Empty session
console.log('\nTest 10: Empty session');
(function() {
  var result = detectWaste(createReport([]), {});
  assert(result.events.length === 0, 'No events for empty session');
  assert(result.flaggedUnits.length === 0, 'No flagged units');
  assert(result.totalFlaggedTokens === 0, 'No flagged tokens');
})();

// Test 11: Short session (insufficient baseline)
console.log('\nTest 11: Short session (insufficient baseline)');
(function() {
  var units = [
    makeUnit(1, 200, 500, 0.0002),
    makeUnit(2, 200, 500, 0.0002),
    makeUnit(3, 1000, 3000, 0.001),  // Extreme spike but only 2 prior samples
  ];
  var result = detectWaste(createReport(units), {});
  assert(result.events.length === 0, 'No events with insufficient baseline');
})();

// Test 12: Severity distribution
console.log('\nTest 12: Severity distribution');
(function() {
  var units = [
    makeUnit(1, 200, 500, 0.0002),
    makeUnit(2, 200, 500, 0.0002),
    makeUnit(3, 200, 500, 0.0002),
    makeUnit(4, 200, 500, 0.0002),
    makeUnit(5, 200, 500, 0.0002),
    makeUnit(6, 350, 800, 0.00035),   // OPPORTUNITY
    makeUnit(7, 200, 500, 0.0002),    // Reset to normal
    makeUnit(8, 1000, 2000, 0.001),   // WARNING (gap of 1)
    makeUnit(9, 200, 500, 0.0002),    // Reset to normal
    makeUnit(10, 200, 500, 0.0002),   // Reset to normal
    makeUnit(11, 1500, 4000, 0.0015), // CRITICAL (gap > 2, large delta)
  ];
  var result = detectWaste(createReport(units), {});
  assert(result.severityCountMap.OPPORTUNITY >= 1, 'Has OPPORTUNITY signals');
  assert(result.severityCountMap.WARNING >= 1, 'Has WARNING signals');
  assert(result.severityCountMap.CRITICAL >= 1, 'Has CRITICAL signals');
  // Total signals should be reasonable
  var totalSignals = result.events.length;
  assert(totalSignals <= 10, 'Total signals reasonable: ' + totalSignals);
})();

// Summary
console.log('\n' + '='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
