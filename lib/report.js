// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 fthuu
// DSH Observability Report v0.36 — standalone JS, zero ../src imports.
// Ported from src/observability/report.ts. Pure view layer; no recomputation.

function resultPosition(unit) {
  var same = unit.usage.sameStep;
  if (same !== null) return { turn: same.turn, step: same.step };
  var next = unit.usage.nextStep;
  if (next !== null) return { turn: next.turn, step: Math.max(0, next.step - 1) };
  return { turn: null, step: null };
}

function aggregateUsage(units) {
  var seen = new Set();
  var totalInputTokens = 0, totalOutputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0;
  for (var i = 0; i < units.length; i++) {
    var usageArr = [units[i].usage.sameStep, units[i].usage.nextStep];
    for (var j = 0; j < usageArr.length; j++) {
      var usage = usageArr[j];
      if (usage === null) continue;
      var key = usage.turn + ':' + usage.step;
      if (seen.has(key)) continue;
      seen.add(key);
      totalInputTokens += usage.inputTokens || 0;
      totalOutputTokens += usage.outputTokens || 0;
      cacheReadTokens += usage.cacheReadTokens || 0;
      cacheWriteTokens += usage.cacheWriteTokens || 0;
    }
  }
  return { totalInputTokens: totalInputTokens, totalOutputTokens: totalOutputTokens, cacheReadTokens: cacheReadTokens, cacheWriteTokens: cacheWriteTokens, requestCount: seen.size };
}

function aggregateCost(units) {
  var seen = new Set();
  var inputCost = 0, cachedInputCost = 0, outputCost = 0, cacheWriteCost = 0;
  var any = false, allNonNull = true;
  for (var i = 0; i < units.length; i++) {
    var unit = units[i];
    var usage = unit.usage.attributedFrom === 'next-step' ? unit.usage.nextStep : unit.usage.sameStep;
    if (usage === null || unit.cost.request === null) continue;
    var key = usage.turn + ':' + usage.step;
    if (seen.has(key)) continue;
    seen.add(key);
    var request = unit.cost.request;
    if (request.inputCost === null && request.cachedInputCost === null && request.outputCost === null && request.cacheWriteCost === null) {
      allNonNull = false;
      continue;
    }
    any = true;
    inputCost += request.inputCost || 0;
    cachedInputCost += request.cachedInputCost || 0;
    outputCost += request.outputCost || 0;
    cacheWriteCost += request.cacheWriteCost || 0;
  }
  if (!any || !allNonNull) {
    return { inputCost: null, cachedInputCost: null, outputCost: null, cacheWriteCost: null };
  }
  return { inputCost: inputCost, cachedInputCost: cachedInputCost, outputCost: outputCost, cacheWriteCost: cacheWriteCost };
}

export function buildObservabilityReport(input) {
  var report = input.attribution;
  var units = report.units.slice().sort(function (a, b) { return a.toolResult.eventSeq - b.toolResult.eventSeq; });

  var flat = [];
  for (var i = 0; i < units.length; i++) {
    var unit = units[i];
    var pos = resultPosition(unit);
    flat.push({
      unitId: unit.unitId,
      toolName: unit.toolCall.name,
      callId: unit.toolCall.callId,
      turn: pos.turn,
      step: pos.step,
      resultSizeChars: unit.toolResult.resultSizeChars,
      contextCharsDelta: unit.context.contextCharsDelta,
      attributedTokens: unit.attributedTokens,
      attributedCost: unit.cost.attributedCost,
      confidence: unit.confidence,
      attributionStatus: unit.attributionStatus,
      allocationMethod: unit.allocationMethod,
      nextRequestInputTokens: unit.nextRequestInputTokens,
      attribution: unit,
    });
  }

  var turns = [];
  var turnMap = new Map();
  for (var t = 0; t < flat.length; t++) {
    var uv = flat[t];
    if (uv.turn === null) continue;
    var tv = turnMap.get(uv.turn);
    if (tv === undefined) {
      tv = { turn: uv.turn, steps: [] };
      turnMap.set(uv.turn, tv);
      turns.push(tv);
    }
    var sv = null;
    for (var s = 0; s < tv.steps.length; s++) {
      if (tv.steps[s].step === uv.step) { sv = tv.steps[s]; break; }
    }
    if (sv === null) {
      sv = { step: uv.step || 0, units: [] };
      tv.steps.push(sv);
    }
    sv.units.push(uv);
  }
  turns.sort(function (a, b) { return a.turn - b.turn; });
  for (var ti = 0; ti < turns.length; ti++) {
    turns[ti].steps.sort(function (a, b) { return a.step - b.step; });
  }

  var usageTotals = aggregateUsage(units);
  var costComponents = aggregateCost(units);
  var priced = report.cost.priced;
  var wasteEvents = (input.waste && input.waste.events) ? input.waste.events : [];
  var summary = {
    totalInputTokens: usageTotals.totalInputTokens,
    totalOutputTokens: usageTotals.totalOutputTokens,
    totalTokens: usageTotals.totalInputTokens + usageTotals.totalOutputTokens,
    cacheReadTokens: usageTotals.cacheReadTokens,
    cacheWriteTokens: usageTotals.cacheWriteTokens,
    totalCost: priced ? report.cost.totalCost : null,
    costStatus: priced ? 'PRICED' : 'UNPRICED',
    wasteCount: wasteEvents.length,
    unitCount: units.length,
    requestCount: usageTotals.requestCount,
  };

  return {
    schema: 'dsh-observability-report',
    version: 'v0.36',
    session: {
      id: report.sessionId,
      provider: input.provider || null,
      model: input.model || null,
      engineVersion: report.version,
    },
    summary: summary,
    units: { turns: turns, flat: flat },
    cost: {
      status: priced ? 'PRICED' : 'UNPRICED',
      inputCost: priced ? costComponents.inputCost : null,
      cachedInputCost: priced ? costComponents.cachedInputCost : null,
      outputCost: priced ? costComponents.outputCost : null,
      cacheWriteCost: priced ? costComponents.cacheWriteCost : null,
      totalCost: priced ? report.cost.totalCost : null,
      attributedCost: priced ? report.cost.attributedCost : null,
      unattributedCost: priced ? report.cost.unattributedCost : null,
    },
    waste: {
      // Pass through ALL fields from waste detector
      events: wasteEvents,
      flaggedUnits: input.waste.flaggedUnits || [],
      totalFlaggedTokens: input.waste.totalFlaggedTokens || 0,
      typeTokenMap: input.waste.typeTokenMap || {},
      typeCountMap: input.waste.typeCountMap || {},
      severityTokenMap: input.waste.severityTokenMap || {},
      severityCountMap: input.waste.severityCountMap || {},
    },
    attribution: report,
  };
}
