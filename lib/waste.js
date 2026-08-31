// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 fthuu
// DSH Waste Detection v0.36 — standalone JS, zero ../src imports.
// v0.10: Recalibrated severity, absolute thresholds, no user config.

/**
 * Fixed thresholds - not user-configurable.
 * Designed to be stable, comparable across sessions, and conservative.
 */
var THRESHOLDS = {
  // OPPORTUNITY:轻度偏离，可能值得关注
  opportunity: {
    ratio: 1.5,           // 1.5x baseline
    minAbsoluteDelta: 200, // 最少 200 tokens/chars 绝对差异
  },
  // WARNING: 明显异常，应当较少出现
  warning: {
    ratio: 3.0,           // 3x baseline
    minAbsoluteDelta: 800, // 最少 800 tokens/chars 绝对差异（从 500 提高）
  },
  // CRITICAL: 极端异常，只用于真正罕见的大幅异常
  critical: {
    ratio: 6.0,           // 6x baseline
    minAbsoluteDelta: 3000, // 最少 3000 tokens/chars 绝对差异（从 2000 提高）
  },
  // Minimum baseline samples before any detection
  minBaselineSamples: 5,
};

/**
 * Robust baseline: median for small samples, trimmed mean for larger.
 */
function robustBaseline(values) {
  var numeric = values.filter(function (v) { return v !== null && v !== undefined && typeof v === 'number'; });
  if (numeric.length === 0) return null;
  var sorted = numeric.slice().sort(function (a, b) { return a - b; });
  if (sorted.length < 6) {
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  var trimCount = Math.max(1, Math.floor(sorted.length * 0.2));
  var trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  return trimmed.reduce(function (s, v) { return s + v; }, 0) / trimmed.length;
}

/**
 * Determine if a value qualifies for a severity level.
 * Requires BOTH ratio AND absolute delta thresholds to be met.
 */
function qualifiesSeverity(value, baseline, level) {
  if (baseline === null || baseline <= 0 || value === null) return false;
  var ratio = value / baseline;
  var absoluteDelta = value - baseline;
  var config = THRESHOLDS[level];
  return ratio >= config.ratio && absoluteDelta >= config.minAbsoluteDelta;
}

/**
 * Determine severity level for a detection.
 * Returns: 'INFO', 'OPPORTUNITY', 'WARNING', or 'CRITICAL'
 */
function determineSeverity(value, baseline) {
  if (qualifiesSeverity(value, baseline, 'critical')) return 'CRITICAL';
  if (qualifiesSeverity(value, baseline, 'warning')) return 'WARNING';
  if (qualifiesSeverity(value, baseline, 'opportunity')) return 'OPPORTUNITY';
  return 'INFO';
}

/**
 * Detection info with severity-specific recommendations.
 */
var DETECTION_INFO = {
  CONTEXT_SPIKE: {
    label: '读取量',
    possibleCauses: [
      'Large tool output or file retrieval',
      'Broad search results',
      'Multiple files read in sequence',
    ],
    recommendations: {
      OPPORTUNITY: '这次操作读取的内容量比本次会话的常见水平高一些。\nThis operation read more content than typical for this session.',
      WARNING: '这次操作读取了较多内容，可以看看是否有可以精简的地方。\nThis operation read a lot of content—see if anything could be refined.',
      CRITICAL: '这次操作读取了明显多于平常的内容。\nThis operation read significantly more content than usual.',
    },
  },
  TOKEN_ANOMALY: {
    label: 'Token 使用',
    possibleCauses: [
      'Complex operation or large file processing',
      'Multi-step tool execution',
      'Detailed code analysis',
    ],
    recommendations: {
      OPPORTUNITY: '这次操作的 Token 使用量比本次会话的常见水平高一些。\nThis operation used more tokens than typical for this session.',
      WARNING: '这次操作的 Token 使用量明显高于本次会话的常见水平。\nThis operation used significantly more tokens than typical.',
      // CRITICAL: 不显示 recommendation，避免武断建议
    },
  },
  COST_ANOMALY: {
    label: '成本',
    possibleCauses: [
      'High token volume',
      'Expensive model usage',
      'Lack of cache reuse',
    ],
    recommendations: {
      OPPORTUNITY: '这次操作的成本比本次会话的常见水平高一些。\nThis operation cost more than typical for this session.',
      WARNING: '这次操作的成本明显高于本次会话的常见水平。\nThis operation cost significantly more than typical.',
      CRITICAL: '这次操作的成本非常高。\nThis operation had very high cost.',
    },
  },
  DUPLICATE_RESULT: {
    label: '重复',
    possibleCauses: [
      'Repeated identical tool requests',
      'Previous result still available',
    ],
    recommendations: {
      OPPORTUNITY: '检测到与之前相似的操作。\nA similar operation was detected.',
      WARNING: '检测到重复的操作。\nA duplicate operation was detected.',
      CRITICAL: '检测到多次重复操作。\nMultiple duplicate operations detected.',
    },
  },
};

var eventCounter = 0;

export function detectWaste(report) {
  var minBaseline = THRESHOLDS.minBaselineSamples;
  var units = report.units.slice().sort(function (a, b) { return a.toolResult.eventSeq - b.toolResult.eventSeq; });
  var events = [];
  eventCounter = 0;

  var priorContext = [];
  var priorTokens = [];
  var priorCost = [];

  // Track flagged units for unique token counting
  var flaggedUnits = {};

  // Track consecutive detections to avoid duplicate alarms
  var lastContextDetection = null;
  var lastTokenDetection = null;

  for (var j = 0; j < units.length; j++) {
    var unit = units[j];
    var contextDelta = unit.context.contextCharsDelta;
    var tokens = unit.attributedTokens;
    var cost = unit.cost.attributedCost;

    var unitDetections = [];

    // CONTEXT_SPIKE detection
    if (priorContext.length >= minBaseline && contextDelta !== null) {
      var contextBaseline = robustBaseline(priorContext);
      if (contextBaseline !== null && contextBaseline > 0) {
        var cSeverity = determineSeverity(contextDelta, contextBaseline);
        if (cSeverity !== 'INFO') {
          // Avoid consecutive duplicate alarms for same pattern
          var isConsecutive = lastContextDetection &&
            lastContextDetection.severity === cSeverity &&
            (j - lastContextDetection.index) <= 2;
          
          if (!isConsecutive) {
            unitDetections.push({
              type: 'CONTEXT_SPIKE',
              severity: cSeverity,
              ratio: contextDelta / contextBaseline,
              value: contextDelta,
              baseline: contextBaseline,
            });
            lastContextDetection = { severity: cSeverity, index: j };
          }
        }
      }
    }

    // TOKEN_ANOMALY detection
    if (priorTokens.length >= minBaseline && tokens !== null) {
      var tokenBaseline = robustBaseline(priorTokens);
      if (tokenBaseline !== null && tokenBaseline > 0) {
        var tSeverity = determineSeverity(tokens, tokenBaseline);
        if (tSeverity !== 'INFO') {
          var isConsecutiveToken = lastTokenDetection &&
            lastTokenDetection.severity === tSeverity &&
            (j - lastTokenDetection.index) <= 2;
          
          if (!isConsecutiveToken) {
            unitDetections.push({
              type: 'TOKEN_ANOMALY',
              severity: tSeverity,
              ratio: tokens / tokenBaseline,
              value: tokens,
              baseline: tokenBaseline,
            });
            lastTokenDetection = { severity: tSeverity, index: j };
          }
        }
      }
    }

    // COST_ANOMALY detection (only as supporting evidence, not independent)
    // Skip if TOKEN_ANOMALY already detected for this unit
    var hasTokenAnomaly = unitDetections.some(function(d) { return d.type === 'TOKEN_ANOMALY'; });
    // Cost Anomaly only generates independent signal if no Token Anomaly and absolute cost is significant
    if (!hasTokenAnomaly && priorCost.length >= minBaseline && cost !== null && cost > 0.001) {
      var costBaseline = robustBaseline(priorCost);
      if (costBaseline !== null && costBaseline > 0) {
        var coSeverity = determineSeverity(cost, costBaseline);
        if (coSeverity !== 'INFO') {
          unitDetections.push({
            type: 'COST_ANOMALY',
            severity: coSeverity,
            ratio: cost / costBaseline,
            value: cost,
            baseline: costBaseline,
          });
        }
      }
    }

    // Generate events for this unit
    if (unitDetections.length > 0) {
      // Determine highest severity for the unit
      var severityOrder = { 'CRITICAL': 4, 'WARNING': 3, 'OPPORTUNITY': 2 };
      var highestSeverity = 'OPPORTUNITY';
      var highestSeverityNum = 0;

      var detectionTypes = [];
      var primaryDetection = null;
      var supportingDetections = [];

      for (var d = 0; d < unitDetections.length; d++) {
        var det = unitDetections[d];
        detectionTypes.push(det.type);

        if (severityOrder[det.severity] > highestSeverityNum) {
          highestSeverityNum = severityOrder[det.severity];
          highestSeverity = det.severity;
        }

        // Primary = TOKEN_ANOMALY or first detection
        if (det.type === 'TOKEN_ANOMALY' && !primaryDetection) {
          primaryDetection = det;
        } else if (!primaryDetection) {
          primaryDetection = det;
        } else {
          supportingDetections.push(det);
        }
      }

      // Track this unit (unique counting)
      if (!flaggedUnits[unit.unitId]) {
        flaggedUnits[unit.unitId] = {
          unitId: unit.unitId,
          toolName: unit.toolCall.name,
          tokens: tokens || 0,
          contextDelta: contextDelta,
          severity: highestSeverity,
          detectionTypes: detectionTypes,
        };
      } else {
        // Update severity if current is higher
        if (severityOrder[highestSeverity] > severityOrder[flaggedUnits[unit.unitId].severity]) {
          flaggedUnits[unit.unitId].severity = highestSeverity;
        }
      }

      // Generate events for each detection
      for (var e = 0; e < unitDetections.length; e++) {
        var detection = unitDetections[e];
        var info = DETECTION_INFO[detection.type];
        var recommendation = info.recommendations[highestSeverity] || info.recommendations.OPPORTUNITY;

        events.push({
          eventId: 'waste-' + (++eventCounter),
          type: detection.type,
          severity: highestSeverity,
          unitId: unit.unitId,
          toolName: unit.toolCall.name,
          tokens: tokens || 0,
          contextDelta: contextDelta,
          ratio: detection.ratio,
          baseline: detection.baseline,
          primaryDetection: primaryDetection ? primaryDetection.type : detection.type,
          supportingDetections: supportingDetections.map(function(s) { return s.type; }),
          possibleCause: info.possibleCauses[0],
          recommendation: recommendation,
          evidence: [{
            metric: detection.type === 'CONTEXT_SPIKE' ? 'contextCharsDelta' :
                    detection.type === 'TOKEN_ANOMALY' ? 'attributedTokens' : 'attributedCost',
            value: detection.value,
            baseline: detection.baseline,
            ratio: detection.ratio,
          }],
        });
      }
    }

    // Add to baselines (current unit does NOT participate in its own baseline)
    if (contextDelta !== null) priorContext.push(contextDelta);
    if (tokens !== null) priorTokens.push(tokens);
    if (cost !== null) priorCost.push(cost);
  }

  // Build unique flagged units list
  var uniqueFlaggedUnits = Object.keys(flaggedUnits).map(function (uid) {
    return flaggedUnits[uid];
  });

  // Aggregate by detection type
  var typeTokenMap = {};
  var typeCountMap = {};
  var severityTokenMap = { OPPORTUNITY: 0, WARNING: 0, CRITICAL: 0 };
  var severityCountMap = { OPPORTUNITY: 0, WARNING: 0, CRITICAL: 0 };

  uniqueFlaggedUnits.forEach(function (fu) {
    fu.detectionTypes.forEach(function (detType) {
      typeTokenMap[detType] = (typeTokenMap[detType] || 0) + fu.tokens;
      typeCountMap[detType] = (typeCountMap[detType] || 0) + 1;
    });
    severityTokenMap[fu.severity] = (severityTokenMap[fu.severity] || 0) + fu.tokens;
  });

  events.forEach(function (e) {
    severityCountMap[e.severity] = (severityCountMap[e.severity] || 0) + 1;
  });

  // Calculate total flagged tokens (unique units only)
  var totalFlaggedTokens = uniqueFlaggedUnits.reduce(function (s, fu) { return s + fu.tokens; }, 0);

  return {
    engine: 'dsh-waste-detector',
    version: 'v0.36',
    thresholds: THRESHOLDS,
    analyzedUnits: units.length,
    flaggedUnits: uniqueFlaggedUnits,
    events: events,
    typeTokenMap: typeTokenMap,
    typeCountMap: typeCountMap,
    severityTokenMap: severityTokenMap,
    severityCountMap: severityCountMap,
    totalFlaggedTokens: totalFlaggedTokens,
  };
}

export { THRESHOLDS, DETECTION_INFO };
