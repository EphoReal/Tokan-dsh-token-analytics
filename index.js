// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 fthuu
// DSH Token Analytics v0.37.0 — Live Bridge + Historical Session Replay + Export + my-skin Saturation Sync.
// No imports from ../src. All logic lives in lib/.
export const name = 'token-analytics';
export const inject = ['commands', 'connection', 'webServer', 'sessions', 'sessionQuery'];

import { AttributionEngine } from './lib/engine.js';
import { detectWaste, THRESHOLDS } from './lib/waste.js';
import { buildObservabilityReport } from './lib/report.js';

console.log('[token-analytics] host plugin module loaded');

// ---------------------------------------------------------------------------
// Per-session state
// ---------------------------------------------------------------------------
var sessions = new Map(); // sessionId -> { engine, report, provider, model }
var historicalRestore = { total: 0, restored: 0, complete: false, pending: [] };

// --- SSE push channel (host -> browser) ---
var sseClients = [];

function pushSseEvent(eventType, data) {
  var payload = 'event: ' + eventType + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (var i = sseClients.length - 1; i >= 0; i--) {
    try { sseClients[i].write(payload); } catch (_e) { sseClients.splice(i, 1); }
  }
}

function getOrCreate(sessionId) {
  var entry = sessions.get(sessionId);
  if (entry) return entry;
  entry = { engine: null, report: null, provider: null, model: null, title: null };
  sessions.set(sessionId, entry);
  console.log('[token-analytics] new session entry:', sessionId);
  return entry;
}

function readSessionTitle(ctx, sessionId) {
  if (!ctx.sessionQuery || typeof ctx.sessionQuery.readTitleSnapshot !== 'function') {
    return Promise.resolve(null);
  }
  return ctx.sessionQuery.readTitleSnapshot(sessionId).then(function (obs) {
    if (obs && obs.title && typeof obs.title.title === 'string' && obs.title.title !== '') {
      return obs.title.title;
    }
    return null;
  });
}

function refreshSessionTitle(ctx, sessionId) {
  readSessionTitle(ctx, sessionId).then(function (title) {
    var entry = sessions.get(sessionId);
    if (entry && title !== null) {
      entry.title = title;
      pushSseEvent('sessions', {});
    } else if (entry && title === null && !entry._titleRetried) {
      entry._titleRetried = true;
      setTimeout(function () { refreshSessionTitle(ctx, sessionId); }, 2000);
    }
  }).catch(function (e) {
    console.error('[token-analytics] readTitleSnapshot error:', e);
  });
}

function patchPureChatUsage(entry, attribution) {
  if (!entry.report || !entry.engine) return;
  var units = (attribution.units || []);
  if (units.length > 0) return;
  if (entry.engine.usageByStep.size === 0) return;
  var totalInput = 0, totalOutput = 0, cacheRead = 0, cacheWrite = 0;
  entry.engine.usageByStep.forEach(function (u) {
    totalInput += u.inputTokens || 0;
    totalOutput += u.outputTokens || 0;
    cacheRead += u.cacheReadTokens || 0;
    cacheWrite += u.cacheWriteTokens || 0;
  });
  var s = entry.report.summary;
  s.totalInputTokens = totalInput;
  s.totalOutputTokens = totalOutput;
  s.totalTokens = totalInput + totalOutput;
  s.cacheReadTokens = cacheRead;
  s.cacheWriteTokens = cacheWrite;
  s.requestCount = entry.engine.usageByStep.size;
}

function rebuildReport(entry, sessionId) {
  if (!entry.engine) return;
  try {
    var units = entry.engine.getUnits();
    for (var i = 0; i < units.length; i++) {
      units[i].notes = [];
    }
    entry.engine.finalize();
    var attribution = entry.engine.toJSON();
    var waste = detectWaste(attribution);
    entry.report = buildObservabilityReport({
      attribution: attribution,
      waste: waste,
      provider: entry.provider,
      model: entry.model,
    });
    patchPureChatUsage(entry, attribution);
    pushSseEvent('report', { sessionId: sessionId });
    console.log('[token-analytics] report rebuilt:', sessionId, 'units:', (attribution.units || []).length);
  } catch (e) {
    console.error('[token-analytics] rebuildReport error:', e);
  }
}

function restoreOneHistorical(ctx, sessionId) {
  if (sessions.has(sessionId)) return Promise.resolve(true);
  return ctx.sessionQuery.readSession(sessionId).then(function (loaded) {
    if (!loaded || !loaded.events || loaded.events.length === 0) return false;
    if (sessions.has(sessionId)) return false;
    var session;
    try { session = ctx.sessions.prepare(sessionId); } catch (e) {
      console.warn('[token-analytics] prepare failed for', sessionId, e.message);
      return false;
    }
    var entry = getOrCreate(sessionId);
    entry.historical = true;
    return readSessionTitle(ctx, sessionId).then(function (title) {
      if (title !== null) entry.title = title;
      entry.engine = new AttributionEngine(ctx, session, { noListener: true });
      // Replay events with per-event error handling — one bad event must not kill the whole session
      var replayed = 0;
      for (var j = 0; j < loaded.events.length; j++) {
        try {
          var ev = loaded.events[j];
          var appended;
          if (ev.surfaceOp !== undefined || ev.sourceEventSeqs !== undefined) {
            var opts = {};
            if (ev.surfaceOp !== undefined) opts.surfaceOp = ev.surfaceOp;
            if (ev.sourceEventSeqs !== undefined) opts.sourceEventSeqs = ev.sourceEventSeqs;
            appended = session.append(ev.type, ev.data, opts);
          } else {
            appended = session.append(ev.type, ev.data);
          }
          entry.engine.handleEvent(appended);
          replayed++;
        } catch (evErr) {
          console.warn('[token-analytics] skip event', j, 'in session', sessionId, evErr.message);
          // Continue with next event — partial attribution is better than no data
        }
      }
      entry.provider = entry.engine.lastProvider;
      entry.model = entry.engine.lastModel;
      entry.engine.setPricing(getPricing(entry.provider, entry.model));
      rebuildReport(entry, sessionId);
      console.log('[token-analytics] historical session rebuilt:', sessionId, 'events:', replayed + '/' + loaded.events.length);
      return true;
    });
  }).catch(function (e) {
    console.error('[token-analytics] readSession failed for', sessionId, e.message);
    return false;
  });
}

function getSessionList() {
  var list = [];
  sessions.forEach(function (entry, id) {
    list.push({
      sessionId: id,
      hasReport: entry.report !== null,
      provider: entry.provider,
      model: entry.model,
      title: entry.title,
    });
  });
  console.log('[token-analytics] getSessionList:', list.length, 'sessions');
  return list;
}

// ---------------------------------------------------------------------------
// Plugin apply
// ---------------------------------------------------------------------------
export function apply(ctx) {
  console.log('[token-analytics] apply() called');

  ctx.effect(function () {
    return ctx.webServer.register({
      kind: 'prefix',
      path: '/ta-events',
      handler: function (req, res) {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(': connected\n\n');
        sseClients.push(res);
        req.on('close', function () {
          var idx = sseClients.indexOf(res);
          if (idx >= 0) sseClients.splice(idx, 1);
        });
      },
    });
  }, 'token-analytics sse');


  // 1. Register /analytics command
  ctx.effect(function* () {
    yield ctx.commands.register({
      name: 'analytics',
      description: 'Token Analytics dashboard status (UI: Settings -> Token Analytics)',
      handler: function () {
        return {
          kind: 'success',
          text: 'Token Analytics v0.36: ' + sessions.size + ' sessions tracked. Dashboard: Settings -> Token Analytics.',
        };
      },
    });
  }, 'token-analytics command lifecycle');

  // 2. Handle existing agents at startup
  ctx.effect(function* () {
    var agents = resolveAgents(ctx);
    if (agents && typeof agents.list === 'function') {
      try {
        var existing = agents.list();
        console.log('[token-analytics] existing agents:', existing.length);
        for (var i = 0; i < existing.length; i++) {
          handleAgent(existing[i], ctx);
        }
      } catch (e) { console.error('[token-analytics] agent-scan error:', e); }
    }
  }, 'token-analytics agent-scan');

  // 3. Listen to agent lifecycle
  ctx.effect(function* () {
    yield ctx.on('agent/created', function (payload) {
      console.log('[token-analytics] agent/created');
      if (payload && payload.agent) handleAgent(payload.agent, ctx);
      pushSseEvent('sessions', {});
    });
    yield ctx.on('agent/disposed', function (payload) {
      console.log('[token-analytics] agent/disposed');
      if (payload && payload.agent) {
        var sessionId = String(payload.agent.id || payload.agent.session?.id || '');
        if (sessionId) {
          var entry = sessions.get(sessionId);
          if (entry && entry.engine) {
            try {
              var units = entry.engine.getUnits();
              for (var i = 0; i < units.length; i++) { units[i].notes = []; }
              entry.engine.finalize();
              var attribution = entry.engine.toJSON();
              var waste = detectWaste(attribution);
              entry.report = buildObservabilityReport({
                attribution: attribution,
                waste: waste,
                provider: entry.provider,
                model: entry.model,
              });
              patchPureChatUsage(entry, attribution);
            } catch (e) { console.error('[token-analytics] dispose-finalize error:', e); }
            entry.engine.detach();
            entry.engine = null;
            pushSseEvent('sessions', {});
          }
        }
      }
    });
  }, 'token-analytics agent-lifecycle');

  // 4. Listen to session events — the core live bridge
  ctx.effect(function* () {
    console.log('[token-analytics] registering session/event listener');
    yield ctx.on('session/event', function (session, event) {
      try {
        var sessionId = String(session.id || '');
        console.log('[token-analytics] session/event:', event.type, 'sid:', sessionId);
        if (!sessionId) return;
        var isNew = !sessions.has(sessionId);
        var entry = getOrCreate(sessionId);
        if (isNew) pushSseEvent('sessions', {});
        if (isNew || event.type === 'session/title') {
          refreshSessionTitle(ctx, sessionId);
        }

        if (event.type === 'request/header') {
          var header = event.data && event.data.header;
          var config = header && header.config;
          if (config) {
            if (typeof config.provider === 'string' && config.provider) entry.provider = config.provider;
            if (typeof config.model === 'string' && config.model) entry.model = config.model;
          }
          if (entry.engine) {
            entry.engine.setPricing(getPricing(entry.provider, entry.model));
          }
        }

        if (!entry.engine && event.type !== 'request/header') {
          entry.engine = new AttributionEngine(ctx, session, { noListener: true });
          if (entry.provider) {
            entry.engine.setPricing(getPricing(entry.provider, entry.model));
          }
          console.log('[token-analytics] created engine for session:', sessionId);
        }

        if (entry.engine) {
          entry.engine.handleEvent(event);
        }

        if (event.type === 'step/end' || event.type === 'turn/end' || event.type === 'assistant/message') {
          rebuildReport(entry, sessionId);
        }
      } catch (e) { console.error('[token-analytics] session/event error:', e); }
    });
  }, 'token-analytics session-events');

  // 5. RPC channel for browser-side data access
  ctx.effect(function* () {
    console.log('[token-analytics] registering RPC handler');
    yield ctx.connection.rpc.handle('/token-analytics', function (endpoint, payload, signal) {
      if (endpoint === 'get-sessions') {
        return { ok: true, value: getSessionList() };
      }
      if (endpoint === 'get-report') {
        var sid = payload && payload.sessionId;
        var entry = sessions.get(sid);
        return { ok: true, value: entry ? entry.report : null };
      }
      if (endpoint === 'get-historical-status') {
        return { ok: true, value: { total: historicalRestore.total, restored: historicalRestore.restored, complete: historicalRestore.complete } };
      }
      if (endpoint === 'load-historical') {
        var hsId = payload && payload.sessionId;
        if (!hsId || typeof hsId !== 'string') {
          return { ok: false, error: { code: 'bad-request', message: 'sessionId required', details: { issues: [] } } };
        }
        return restoreOneHistorical(ctx, hsId).then(function (hOk) {
          if (hOk) pushSseEvent('sessions', {});
          return { ok: true, value: { loaded: hOk, hasReport: sessions.has(hsId) && sessions.get(hsId).report !== null } };
        });
      }
      if (endpoint === 'get-cross-session-summary') {
        var totals = { tokens: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, cost: 0, wasteCount: 0, sessionCount: 0, priced: false };
        var byModel = {};
        var byTool = {};
        sessions.forEach(function (entry, sid) {
          if (!entry.report) return;
          totals.sessionCount++;
          var s = entry.report.summary;
          totals.tokens += s.totalTokens || 0;
          totals.inputTokens += s.totalInputTokens || 0;
          totals.outputTokens += s.totalOutputTokens || 0;
          totals.cacheRead += s.cacheReadTokens || 0;
          totals.cacheWrite += s.cacheWriteTokens || 0;
          totals.wasteCount += s.wasteCount || 0;
          if (s.totalCost !== null && typeof s.totalCost === 'number') { totals.cost += s.totalCost; totals.priced = true; }
          var modelKey = (entry.model || 'unknown');
          if (!byModel[modelKey]) byModel[modelKey] = { tokens: 0, inputTokens: 0, cacheRead: 0, outputTokens: 0, cost: 0, sessions: 0 };
          byModel[modelKey].tokens += s.totalTokens || 0;
          byModel[modelKey].inputTokens += s.totalInputTokens || 0;
          byModel[modelKey].cacheRead += s.cacheReadTokens || 0;
          byModel[modelKey].outputTokens += s.totalOutputTokens || 0;
          if (s.totalCost !== null && typeof s.totalCost === 'number') byModel[modelKey].cost += s.totalCost;
          byModel[modelKey].sessions++;
          var units = entry.report.units.flat;
          for (var u = 0; u < units.length; u++) {
            var tn = units[u].toolName || 'unknown';
            if (!byTool[tn]) byTool[tn] = { tokens: 0, cost: 0, count: 0 };
            byTool[tn].tokens += units[u].attributedTokens || 0;
            if (units[u].attributedCost !== null && typeof units[u].attributedCost === 'number') byTool[tn].cost += units[u].attributedCost;
            byTool[tn].count++;
          }
        });
        return { ok: true, value: { totals: totals, byModel: byModel, byTool: byTool } };
      }
      // Export endpoints
      if (endpoint === 'export-session') {
        var exportSid = payload && payload.sessionId;
        var exportFormat = payload && payload.format || 'json';
        if (!exportSid || typeof exportSid !== 'string') {
          return { ok: false, error: { code: 'bad-request', message: 'sessionId required', details: { issues: [] } } };
        }
        var exportEntry = sessions.get(exportSid);
        if (!exportEntry || !exportEntry.report) {
          return { ok: false, error: { code: 'not-found', message: 'Session not found or no report available', details: { issues: [] } } };
        }
        var exportData = generateSessionExport(exportEntry, exportSid, exportFormat);
        return { ok: true, value: exportData };
      }
      if (endpoint === 'export-all') {
        var allExportFormat = payload && payload.format || 'json';
        var allExportData = generateAllExport(allExportFormat);
        return { ok: true, value: allExportData };
      }
      if (endpoint === 'export-summary') {
        var summaryExportFormat = payload && payload.format || 'json';
        var summaryExportData = generateSummaryExport(summaryExportFormat);
        return { ok: true, value: summaryExportData };
      }
      return { ok: false, error: { code: 'bad-request', message: 'Unknown endpoint: ' + endpoint, details: { issues: [] } } };
    });
  }, 'token-analytics rpc');

  // 6. Rebuild persisted historical sessions — batched with progress SSE
  ctx.effect(async function () {
    console.log('[token-analytics] historical restore starting');
    try {
      var records = await ctx.sessionQuery.listSessions();
      var pending = [];
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (!record.persisted || record.live) continue;
        var sessionId = String(record.header && record.header.id || '');
        if (!sessionId || sessions.has(sessionId)) continue;
        pending.push(sessionId);
      }
      historicalRestore.total = pending.length;
      historicalRestore.restored = 0;
      historicalRestore.pending = pending;
      historicalRestore.complete = false;
      pushSseEvent('historical-progress', { total: historicalRestore.total, restored: 0, complete: false });
      console.log('[token-analytics] historical restore:', pending.length, 'sessions to rebuild');
      for (var j = 0; j < pending.length; j++) {
        try {
          var ok = await restoreOneHistorical(ctx, pending[j]);
          if (ok) {
            historicalRestore.restored++;
          }
        } catch (sessionErr) {
          console.error('[token-analytics] failed to restore session', pending[j], sessionErr.message);
          // Continue with next session — partial load is better than no load
        }
        // Push progress periodically (every 5 sessions) to reduce SSE overhead
        if ((j + 1) % 5 === 0 || j === pending.length - 1) {
          pushSseEvent('historical-progress', { total: historicalRestore.total, restored: historicalRestore.restored, complete: false });
          pushSseEvent('sessions', {});
        }
      }
      historicalRestore.complete = true;
      historicalRestore.pending = [];
      pushSseEvent('historical-progress', { total: historicalRestore.total, restored: historicalRestore.restored, complete: true });
      pushSseEvent('sessions', {});
      console.log('[token-analytics] historical restore complete:', historicalRestore.restored, 'sessions');
    } catch (e) {
      historicalRestore.complete = true;
      pushSseEvent('historical-progress', { total: historicalRestore.total, restored: historicalRestore.restored, complete: true });
      console.error('[token-analytics] historical restore error:', e);
    }
  }, 'token-analytics historical-restore');
}

// ---------------------------------------------------------------------------
// Export Functions
// ---------------------------------------------------------------------------

function generateSessionExport(entry, sessionId, format) {
  var report = entry.report;
  var metadata = {
    exportDate: new Date().toISOString(),
    pluginVersion: '0.36.0',
    exportScope: 'session',
    format: format,
  };
  var session = {
    id: sessionId,
    provider: entry.provider,
    model: entry.model,
    title: entry.title,
  };
  var summary = report.summary;
  var units = report.units.flat.map(function (u) {
    return {
      unitId: u.unitId,
      toolName: u.toolName,
      callId: u.callId,
      turn: u.turn,
      step: u.step,
      attributedTokens: u.attributedTokens,
      attributedCost: u.attributedCost,
      allocationMethod: u.allocationMethod,
      confidence: u.confidence,
      attributionStatus: u.attributionStatus,
      contextCharsDelta: u.contextCharsDelta,
      resultSizeChars: u.resultSizeChars,
    };
  });
  var waste = {
    events: report.waste.events,
    config: THRESHOLDS,
  };

  if (format === 'csv') {
    return generateCSV(units, metadata, session);
  }
  return { metadata: metadata, session: session, summary: summary, units: units, waste: waste };
}

function generateAllExport(format) {
  var allSessions = [];
  sessions.forEach(function (entry, sid) {
    if (entry.report) {
      allSessions.push(generateSessionExport(entry, sid, 'json'));
    }
  });

  if (format === 'csv') {
    var allUnits = [];
    allSessions.forEach(function (s) {
      allUnits = allUnits.concat(s.units.map(function (u) {
        u.sessionId = s.session.id;
        return u;
      }));
    });
    return generateCSV(allUnits, {
      exportDate: new Date().toISOString(),
      pluginVersion: '0.36.0',
      exportScope: 'all',
      format: format,
    });
  }
  return {
    metadata: {
      exportDate: new Date().toISOString(),
      pluginVersion: '0.36.0',
      exportScope: 'all',
      format: format,
    },
    sessions: allSessions,
  };
}

function generateSummaryExport(format) {
  var totals = { tokens: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, cost: 0, wasteCount: 0, sessionCount: 0, priced: false };
  var byModel = {};
  var byTool = {};

  sessions.forEach(function (entry, sid) {
    if (!entry.report) return;
    totals.sessionCount++;
    var s = entry.report.summary;
    totals.tokens += s.totalTokens || 0;
    totals.inputTokens += s.totalInputTokens || 0;
    totals.outputTokens += s.totalOutputTokens || 0;
    totals.cacheRead += s.cacheReadTokens || 0;
    totals.cacheWrite += s.cacheWriteTokens || 0;
    totals.wasteCount += s.wasteCount || 0;
    if (s.totalCost !== null && typeof s.totalCost === 'number') { totals.cost += s.totalCost; totals.priced = true; }

    var modelKey = entry.model || 'unknown';
    if (!byModel[modelKey]) byModel[modelKey] = { tokens: 0, cost: 0, sessions: 0 };
    byModel[modelKey].tokens += s.totalTokens || 0;
    if (s.totalCost !== null && typeof s.totalCost === 'number') byModel[modelKey].cost += s.totalCost;
    byModel[modelKey].sessions++;

    var units = entry.report.units.flat;
    for (var u = 0; u < units.length; u++) {
      var tn = units[u].toolName || 'unknown';
      if (!byTool[tn]) byTool[tn] = { tokens: 0, cost: 0, count: 0 };
      byTool[tn].tokens += units[u].attributedTokens || 0;
      if (units[u].attributedCost !== null && typeof units[u].attributedCost === 'number') byTool[tn].cost += units[u].attributedCost;
      byTool[tn].count++;
    }
  });

  var summaryData = {
    metadata: {
      exportDate: new Date().toISOString(),
      pluginVersion: '0.36.0',
      exportScope: 'summary',
      format: format,
    },
    totals: totals,
    byModel: byModel,
    byTool: byTool,
  };

  if (format === 'csv') {
    var csvRows = [];
    csvRows.push(['Model', 'Sessions', 'Tokens', 'Cost'].join(','));
    Object.keys(byModel).forEach(function (key) {
      var m = byModel[key];
      csvRows.push([key, m.sessions, m.tokens, m.cost || 0].join(','));
    });
    csvRows.push('');
    csvRows.push(['Tool', 'Calls', 'Tokens', 'Cost'].join(','));
    Object.keys(byTool).forEach(function (key) {
      var t = byTool[key];
      csvRows.push([key, t.count, t.tokens, t.cost || 0].join(','));
    });
    summaryData.csv = csvRows.join('\n');
  }

  return summaryData;
}

function generateCSV(units, metadata, session) {
  var headers = ['unitId', 'toolName', 'callId', 'turn', 'step', 'attributedTokens', 'attributedCost', 'allocationMethod', 'confidence', 'attributionStatus', 'contextCharsDelta', 'resultSizeChars'];
  if (session) headers.unshift('sessionId');

  var rows = [headers.join(',')];
  units.forEach(function (u) {
    var values = headers.map(function (h) {
      var val = h === 'sessionId' ? (session ? session.id : '') : u[h];
      if (val === null || val === undefined) return '';
      var str = String(val);
      // RFC 4180: escape double quotes by doubling them, wrap in quotes if contains comma, quote, or newline
      if (str.indexOf(',') >= 0 || str.indexOf('"') >= 0 || str.indexOf('\n') >= 0) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    });
    rows.push(values.join(','));
  });

  return {
    metadata: metadata,
    csv: rows.join('\n'),
    unitCount: units.length,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleAgent(agent, ctx) {
  try {
    var sessionId = String(agent.id || agent.session?.id || '');
    if (!sessionId) return;
    getOrCreate(sessionId);
    if (ctx) refreshSessionTitle(ctx, sessionId);
  } catch (e) { console.error('[token-analytics] handleAgent error:', e); }
}

function resolveAgents(ctx) {
  try {
    var get = ctx.get;
    if (typeof get === 'function') {
      var resolved = get.call(ctx, 'agents');
      if (resolved) return resolved;
    }
  } catch { /* inject may not have agents */ }
  try {
    return ctx.agents;
  } catch { return null; }
}

function getPricing(provider, model) {
  var prices = {
    'deepseek-official': {
      'deepseek-v4-flash': { input: 1.0, cachedInput: 0.25, output: 2.0, cacheWrite: 0.1 },
      'deepseek-v3': { input: 1.0, cachedInput: 0.25, output: 2.0, cacheWrite: 0.1 },
      'deepseek-chat': { input: 1.0, cachedInput: 0.25, output: 2.0, cacheWrite: 0.1 },
      'deepseek-coder': { input: 1.0, cachedInput: 0.25, output: 2.0, cacheWrite: 0.1 },
    },
  };
  if (provider && model && prices[provider] && prices[provider][model]) {
    var result = {};
    result[provider] = {};
    result[provider][model] = prices[provider][model];
    return result;
  }
  return {};
}
