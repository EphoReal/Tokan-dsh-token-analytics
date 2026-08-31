// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 fthuu
// Browser half of the independent Token Analytics plugin v0.37.1.
// Reads per-session data via Connection RPC; no imports from ../src.
console.log('[token-analytics-client] bundle loaded');
window.__ModuleLoader__.load({
  id: 'tokan-dsh-token-analytics',
  factory: (require) => {
    console.log('[token-analytics-client] factory called');
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var h = React.createElement;

    exports.name = 'tokan-dsh-token-analytics';
    exports.inject = ['theme', 'slots', 'connection'];

    // ---- Per-session data store (fed by RPC from host) --------------------
    var sessionReports = {};     // sessionId -> report object
    var sessionList = [];        // [{sessionId, hasReport, provider, model, title}]
    var selectedSessionId = null; // null = first available session
    var listeners = [];          // React forceUpdate callbacks
    var rpcBusy = false;
    var rpcHandle = null;
    var historicalProgress = { total: 0, restored: 0, complete: false };

    var crossSessionData = null;
    var crossSessionBusy = false;
    function notifyListeners() {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](); } catch (e) { console.error('[token-analytics-client] listener error:', e); }
      }
    }

    async function refreshFromRpc() {
      if (!rpcHandle || rpcBusy) return;
      rpcBusy = true;
      try {
        var sessionsResult = await rpcHandle.getSessions();
        console.log('[token-analytics-client] RPC get-sessions:', JSON.stringify(sessionsResult).slice(0, 200));
        if (sessionsResult && sessionsResult.ok) {
          sessionList = sessionsResult.value || [];
          if (selectedSessionId === null && sessionList.length > 0) {
            for (var i = 0; i < sessionList.length; i++) {
              if (sessionList[i].hasReport) {
                selectedSessionId = sessionList[i].sessionId;
                break;
              }
            }
            if (selectedSessionId === null) {
              selectedSessionId = sessionList[0].sessionId;
            }
          }
          if (selectedSessionId) {
            var reportResult = await rpcHandle.getReport(selectedSessionId);
            console.log('[token-analytics-client] RPC get-report:', reportResult && reportResult.ok ? 'ok, hasReport:' + (reportResult.value !== null) : 'fail');
            if (reportResult && reportResult.ok && reportResult.value) {
              sessionReports[selectedSessionId] = reportResult.value;
            }
          }
          notifyListeners();
        }
      } catch (e) { console.error('[token-analytics-client] RPC error:', e); }
      rpcBusy = false;
    }

    function onUpdate(event) {
      try {
        var detail = event.detail || {};
        if (detail.sessionId && detail.report) {
          sessionReports[detail.sessionId] = detail.report;
          if (selectedSessionId === null) selectedSessionId = detail.sessionId;
          notifyListeners();
        }
      } catch (e) { console.error('[token-analytics-client] onUpdate error:', e); }
    }


    async function fetchCrossSessionSummary() {
      if (!rpcHandle || crossSessionBusy) return;
      crossSessionBusy = true;
      try {
        var result = await rpcHandle.getCrossSessionSummary();
        if (result && result.ok) {
          crossSessionData = result.value;
          notifyListeners();
        }
      } catch (e) { console.error("[token-analytics-client] cross-session RPC error:", e); }
      crossSessionBusy = false;
    }

    window.addEventListener('dsh:token-analytics:update', onUpdate);

    // Listen for my-skin saturation changes so the dashboard re-renders
    // with the updated colour palette.
    // NOTE: The `storage` event only fires in OTHER tabs/windows, not the
    // same tab.  To catch real-time slider changes within the same tab we
    // also poll localStorage at a low frequency while the dashboard is open.
    window.addEventListener('storage', function (e) {
      if (e.key === 'my-skin:saturation') notifyListeners();
    });

    // Polling for same-tab saturation changes (only while dashboard is mounted)
    var saturationPollTimer = null;
    var lastKnownSaturation = getMySkinSaturation();
    function startSaturationPolling() {
      if (saturationPollTimer !== null) return;
      saturationPollTimer = setInterval(function () {
        var current = getMySkinSaturation();
        if (current !== lastKnownSaturation) {
          lastKnownSaturation = current;
          notifyListeners();
        }
      }, 100); // 100ms polling — fast enough for smooth slider feedback
    }
    function stopSaturationPolling() {
      if (saturationPollTimer !== null) {
        clearInterval(saturationPollTimer);
        saturationPollTimer = null;
      }
    }

    // ---- Presentation helpers (independent styles via host theme tokens) ---
    function fmtTokens(n) { return n === null || n === undefined ? '\u2014' : String(n); }
    function fmtCost(n) {
      if (n === null || n === undefined || typeof n !== 'number' || !isFinite(n)) return '\u2014';
      return '$' + n.toFixed(6).replace(/\.?0+$/, '');
    }
    function compactId(id) {
      var s = String(id || '');
      if (s.length <= 22) return s;
      return s.slice(0, 10) + '\u2026' + s.slice(-8);
    }
    function humanizeKey(value) {
      var s = String(value || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
      return s.replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); });
    }
    function badgeStyle(kind) {
      var base = { fontSize: '11px', padding: '1px 6px', borderRadius: '9px', fontWeight: 600 };
      var p = palette();
      var badgePalette = {
        priced:   { color: p.good,         background: paletteRgba('good', 0.14) },
        unpriced: { color: p.unpriced,     background: paletteRgba('unpriced', 0.15) },
        info:     { color: p.info,         background: paletteRgba('info', 0.13) },
        provider: { color: p.provider,     background: paletteRgba('provider', 0.14) },
        estimated:{ color: p.estimated,    background: paletteRgba('estimated', 0.15) },
      };
      return Object.assign({}, base, badgePalette[kind] || {});
    }
    function statusBadge(kind, label) {
      return h('span', { style: badgeStyle(kind) }, label);
    }
    function severityBadge(severity) {
      var p = palette();
      var sevPalette = {
        CRITICAL: { color: p.critical, background: paletteRgba('critical', 0.15) },
        WARNING:  { color: p.warning,  background: paletteRgba('warning', 0.14) },
        INFO:     { color: p.good,     background: paletteRgba('good', 0.12) },
      };
      return h('span', { style: Object.assign({}, badgeStyle('info'), sevPalette[severity] || {}) }, severity);
    }
    function cardStyle() {
      return {
        boxSizing: 'border-box',
        padding: '10px 12px',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-secondary, rgba(128,128,128,0.08))',
        border: '1px solid var(--dsw-alias-border, rgba(128,128,128,0.18))',
      };
    }
    function tableStyle() {
      return { width: '100%', borderCollapse: 'collapse', fontSize: '12px' };
    }
    function tableFrameStyle() {
      return {
        border: '1px solid var(--dsw-alias-border, rgba(128,128,128,0.18))',
        borderRadius: '8px',
        overflow: 'hidden',
      };
    }
    function thStyle() {
      return { textAlign: 'left', padding: '6px 8px', color: 'var(--dsw-alias-label-secondary, #9ca3af)', fontWeight: 600, borderBottom: '1px solid var(--dsw-alias-border, rgba(128,128,128,0.18))' };
    }
    function tdStyle() {
      return { padding: '6px 8px', borderBottom: '1px solid var(--dsw-alias-border, rgba(128,128,128,0.10))', verticalAlign: 'top' };
    }
    function numericCellStyle() {
      return { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
    }
    function rowStyle(index) {
      return { background: index % 2 === 1 ? 'rgba(128,128,128,0.04)' : 'transparent' };
    }
    function emptySectionStyle() {
      return { fontSize: '12px', color: '#9ca3af', padding: '6px 0' };
    }

    // ---- my-skin saturation sync -------------------------------------------
    // Reads the global saturation factor from my-skin's localStorage.
    // Returns 1.0 (no adjustment) when my-skin is not installed or no value
    // is stored, so token-analytics always works independently.
    function getMySkinSaturation() {
      try {
        var stored = localStorage.getItem('my-skin:saturation');
        if (stored === null) return 1.0;
        var val = parseFloat(stored);
        return isNaN(val) ? 1.0 : Math.max(0, Math.min(2, val));
      } catch (_e) { return 1.0; }
    }

    // Convert "#rrggbb" → {r, g, b} (0-255 each).
    function hexToRgb(hex) {
      var h = hex.replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return {
        r: parseInt(h.substring(0, 2), 16),
        g: parseInt(h.substring(2, 4), 16),
        b: parseInt(h.substring(4, 6), 16),
      };
    }

    // Convert (r, g, b) → "#rrggbb".
    function rgbToHex(r, g, b) {
      var clamp = function (v) { return Math.max(0, Math.min(255, Math.round(v))); };
      return '#' + [clamp(r), clamp(g), clamp(b)].map(function (v) {
        return v.toString(16).padStart(2, '0');
      }).join('');
    }

    // Scale a color's saturation. factor 0 = grayscale, 1 = original, >1 = boost.
    // This is the same HSL-based algorithm used by my-skin so both plugins
    // produce identical results for the same input and factor.
    function adjustSaturation(hex, factor) {
      if (factor === 1.0) return hex; // fast path – no change
      var rgb = hexToRgb(hex);
      var r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b);
      var l = (max + min) / 2;
      var hue = 0, d = max - min;
      if (d !== 0) {
        if (max === r) hue = 60 * (((g - b) / d) % 6);
        else if (max === g) hue = 60 * ((b - r) / d + 2);
        else hue = 60 * ((r - g) / d + 4);
        if (hue < 0) hue += 360;
      }
      var baseSat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      var s = Math.max(0, Math.min(1, baseSat * factor));
      var c = (1 - Math.abs(2 * l - 1)) * s;
      var x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
      var m = l - c / 2;
      var outR, outG, outB;
      if (hue < 60)       { outR = c; outG = x; outB = 0; }
      else if (hue < 120) { outR = x; outG = c; outB = 0; }
      else if (hue < 180) { outR = 0; outG = c; outB = x; }
      else if (hue < 240) { outR = 0; outG = x; outB = c; }
      else if (hue < 300) { outR = x; outG = 0; outB = c; }
      else                { outR = c; outG = 0; outB = x; }
      return rgbToHex((outR + m) * 255, (outG + m) * 255, (outB + m) * 255);
    }

    // Apply saturation to a colour that may be a plain "#hex" or an
    // "rgba(...)" string.  rgba colours have their RGB channels adjusted;
    // hex colours are adjusted directly.
    function saturateColor(color, factor) {
      if (factor === 1.0) return color;
      if (color.charAt(0) === '#') return adjustSaturation(color, factor);
      var rgba = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
      if (rgba) {
        var r = parseInt(rgba[1], 10), g = parseInt(rgba[2], 10), b = parseInt(rgba[3], 10);
        var adj = hexToRgb(adjustSaturation(rgbToHex(r, g, b), factor));
        return rgba[4] !== undefined
          ? 'rgba(' + adj.r + ',' + adj.g + ',' + adj.b + ',' + rgba[4] + ')'
          : 'rgb(' + adj.r + ',' + adj.g + ',' + adj.b + ')';
      }
      return color;
    }

    // ---- Dynamic colour palette (saturation-aware) -------------------------
    // Base colours used across the dashboard.  Every colour that should
    // respond to the my-skin saturation slider is defined here once.
    var BASE_PALETTE = {
      // Severity / signal
      opportunity:    '#3b82f6',
      warning:        '#f59e0b',
      critical:       '#f87171',
      duplicate:      '#8b5cf6',
      // Status
      good:           '#10b981',
      info:           '#1d4ed8',
      provider:       '#0f766e',
      estimated:      '#b45309',
      unpriced:       '#9ca3af',
      // Chart bars (8 colours)
      chart1:         '#3b82f6',
      chart2:         '#10b981',
      chart3:         '#f59e0b',
      chart4:         '#ef4444',
      chart5:         '#8b5cf6',
      chart6:         '#ec4899',
      chart7:         '#06b6d4',
      chart8:         '#84cc16',
    };

    // Return the palette with current saturation applied.
    // Call this inside render functions so it re-reads on every paint.
    function palette() {
      var sat = getMySkinSaturation();
      var out = {};
      for (var key in BASE_PALETTE) {
        out[key] = adjustSaturation(BASE_PALETTE[key], sat);
      }
      return out;
    }

    // Convenience: build the rgba variant a few callers need.
    function paletteRgba(key, alpha) {
      var hex = palette()[key] || '#888888';
      var rgb = hexToRgb(hex);
      return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
    }

    var DISPLAY_LIMIT = 20;
    function toggleButtonStyle() {
      return { fontSize: '11px', color: palette().opportunity, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontWeight: 600 };
    }

    // ---- Session selector ---------------------------------------------------
    function SessionSelector() {
      if (sessionList.length <= 1) return null;
      var options = sessionList.map(function (s) {
        var label = s.title || compactId(s.sessionId);
        if (s.model) label += ' \u00b7 ' + s.model;
        var title = s.sessionId + (s.provider && s.model ? ' (' + s.provider + '/' + s.model + ')' : '');
        return h('option', { key: s.sessionId, value: s.sessionId, title: title, style: { color: 'var(--dsw-alias-label-primary, #e5e7eb)', background: 'var(--dsw-alias-bg-surface, #1e293b)' } }, label);
      });
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
        h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #9ca3af)' } }, 'Session:'),
        h('select', {
          value: selectedSessionId || '',
          onChange: function (e) {
            selectedSessionId = e.target.value || null;
            refreshFromRpc();
          },
          style: {
            fontSize: '12px',
            padding: '4px 8px',
            borderRadius: '6px',
            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
            background: 'var(--dsw-alias-bg-base, rgba(128,128,128,0.08))',
            color: 'var(--dsw-alias-label-primary, #1f2937)',
            maxWidth: '400px',
            appearance: 'none',
            WebkitAppearance: 'none',
            MozAppearance: 'none',
            backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%236b7280\'/%3E%3C/svg%3E")',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 8px center',
            paddingRight: '24px',
            cursor: 'pointer',
          },
        }, options)
      );
    }

    // ---- Timeline (Token / Cost bars from report order) --------------------
    function TimelineSection(props) {
      var report = props.report;
      var units = report.units.flat;
      if (units.length === 0) return h('div', { style: emptySectionStyle() }, 'No tool calls for this session.');
      var expandedState = React.useState(false);
      var setExpanded = expandedState[1];
      var expandedVal = expandedState[0];
      var visibleUnits = expandedVal ? units : units.slice(0, DISPLAY_LIMIT);
      var truncated = units.length > DISPLAY_LIMIT;
      var maxTokens = Math.max.apply(null, units.map(function (u) { return u.attributedTokens || 0; })) || 1;
      var maxCost = Math.max.apply(null, units.map(function (u) { return u.attributedCost || 0; })) || 1;
      var priced = report.cost.status === 'PRICED';
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        visibleUnits.map(function (unit, index) {
        var tokenWidth = Math.max(2, Math.round(((unit.attributedTokens || 0) / maxTokens) * 100));
        var costWidth = priced ? Math.max(2, Math.round(((unit.attributedCost || 0) / maxCost) * 100)) : 0;
        var pUnit = palette();
        return h('div', { key: unit.unitId },
          h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #9ca3af)' } },
            h('span', null, '#' + (index + 1) + ' \u00b7 step ' + (unit.step === null ? '?' : unit.step) + ' \u00b7 ' + (unit.toolName || '?')),
            h('span', { style: { color: pUnit.opportunity, fontWeight: 600 } }, fmtTokens(unit.attributedTokens) + ' tokens')),
          h('div', { style: { height: '8px', borderRadius: '4px', background: 'rgba(128,128,128,0.12)', overflow: 'hidden', marginTop: '4px' } },
            h('div', { style: { height: '100%', width: tokenWidth + '%', background: pUnit.opportunity } })),
          priced ? h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #9ca3af)', marginTop: '8px' } },
            h('span', null, 'Cost'),
            h('span', { style: { color: pUnit.good, fontWeight: 600 } }, fmtCost(unit.attributedCost))) : null,
          priced ? h('div', { style: { height: '8px', borderRadius: '4px', background: 'rgba(128,128,128,0.12)', overflow: 'hidden', marginTop: '4px' } },
            h('div', { style: { height: '100%', width: costWidth + '%', background: pUnit.good } })) : null
        );
      }),
        truncated ? h('button', { style: toggleButtonStyle(), onClick: function () { setExpanded(function (v) { return !v; }); } },
          expandedVal ? 'Show latest ' + DISPLAY_LIMIT : 'Show all ' + units.length) : null
      );
    }

    // ---- Waste section (empty state included) ------------------------------
    function WasteSection(props) {
      var report = props.report;
      var events = report.waste.events;
      if (!events || events.length === 0) {
        return h('div', { style: { fontSize: '12px', color: '#9ca3af', padding: '10px 0' } }, '当前会话没有发现优化提示');
      }

      var typeLabels = {
        'CONTEXT_SPIKE': 'Context Growth',
        'TOKEN_ANOMALY': 'Token Usage',
        'COST_ANOMALY': 'Cost',
        'DUPLICATE_RESULT': 'Duplicate'
      };

      var p = palette();
      var severityColors = {
        'OPPORTUNITY': p.opportunity,
        'WARNING': p.warning,
        'CRITICAL': p.critical,
      };

      // Sort events: CRITICAL first, then WARNING, then OPPORTUNITY
      var severityOrder = { 'CRITICAL': 0, 'WARNING': 1, 'OPPORTUNITY': 2 };
      var sortedEvents = events.slice().sort(function(a, b) {
        return (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3);
      });

      var expandedState = React.useState(false);
      var setExpanded = expandedState[1];
      var expandedVal = expandedState[0];
      var visibleEvents = expandedVal ? sortedEvents : sortedEvents.slice(0, DISPLAY_LIMIT);
      var truncated = sortedEvents.length > DISPLAY_LIMIT;

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        visibleEvents.map(function (event, index) {
          var evidence = event.evidence || [];
          var primaryEvidence = evidence[0] || {};
          var sevColor = severityColors[event.severity] || '#3b82f6';

          return h('div', { key: 'waste-' + index, style: { padding: '10px', borderRadius: '6px', background: 'var(--dsw-alias-bg-base, rgba(128,128,128,0.04))', borderLeft: '3px solid ' + sevColor } },
            // Header row
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                severityBadge(event.severity),
                h('span', { style: { fontSize: '10px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2937)' } }, typeLabels[event.type] || event.type),
                h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, '\u00b7'),
                h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, event.toolName || '\u2014')
              ),
              h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, (event.tokens || 0).toLocaleString() + ' tokens')
            ),
            // Evidence row
            primaryEvidence.metric ? h('div', { style: { display: 'flex', gap: '12px', fontSize: '10px', color: 'var(--dsw-alias-label-tertiary, #9ca3af)', marginBottom: '4px' } },
              h('span', null, primaryEvidence.metric + ': ' + (primaryEvidence.value !== null ? primaryEvidence.value.toLocaleString() : '\u2014')),
              primaryEvidence.baseline !== null ? h('span', null, 'baseline: ' + primaryEvidence.baseline.toLocaleString()) : null,
              primaryEvidence.ratio !== null ? h('span', { style: { fontWeight: 600, color: sevColor } }, 'x' + primaryEvidence.ratio.toFixed(2)) : null
            ) : null,
            // Supporting detections
            event.supportingDetections && event.supportingDetections.length > 0 ? h('div', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-tertiary, #9ca3af)', marginBottom: '4px' } },
              'Also detected: ' + event.supportingDetections.join(', ')
            ) : null,
            // Cause and recommendation
            h('div', { style: { fontSize: '10px', lineHeight: 1.4 } },
              event.possibleCause ? h('div', { style: { color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, 'Possible cause: ', h('span', { style: { color: 'var(--dsw-alias-label-primary, #1f2937)' } }, event.possibleCause)) : null,
              event.recommendation ? h('div', { style: { color: 'var(--dsw-alias-label-secondary, #6b7280)', marginTop: '2px' } }, 'Recommendation: ', h('span', { style: { color: palette().opportunity } }, event.recommendation)) : null
            )
          );
        }),
        truncated ? h('button', { style: toggleButtonStyle(), onClick: function () { setExpanded(function (v) { return !v; }); } },
          expandedVal ? 'Show latest ' + DISPLAY_LIMIT : 'Show all ' + sortedEvents.length) : null
      );
    }

    // ---- Visual Charts Section ---------------------------------------------
    // Tool name mapping: internal name → user-friendly display name
    var TOOL_DISPLAY_NAMES = {
      'glob': 'File Search',
      'grep': 'Content Search',
      'read': 'File Reading',
      'read_file': 'File Reading',
      'write': 'File Writing',
      'write_file': 'File Writing',
      'edit': 'File Editing',
      'pwsh': 'Shell Command',
      'bash': 'Shell Command',
      'ask_user_question': 'User Input',
      'todo_write': 'Task Management',
      'subagent': 'Sub-agent',
      'web_search': 'Web Search',
      'code_analysis': 'Code Analysis',
      'search': 'Search',
      'unknown': 'Other',
    };

    function getToolDisplayName(name) {
      return TOOL_DISPLAY_NAMES[name] || name;
    }

    function VisualCharts(props) {
      var report = props.report;
      var units = report.units.flat;
      if (units.length === 0) return null;

      // Aggregate by tool
      var toolStats = {};
      units.forEach(function (u) {
        var name = u.toolName || 'unknown';
        if (!toolStats[name]) toolStats[name] = { tokens: 0, cost: 0, count: 0 };
        toolStats[name].tokens += u.attributedTokens || 0;
        if (u.attributedCost !== null && typeof u.attributedCost === 'number') toolStats[name].cost += u.attributedCost;
        toolStats[name].count++;
      });

      var toolNames = Object.keys(toolStats).sort(function (a, b) { return toolStats[b].count - toolStats[a].count; });
      var totalTokens = units.reduce(function (s, u) { return s + (u.attributedTokens || 0); }, 0);
      var maxTokens = Math.max.apply(null, toolNames.map(function (n) { return toolStats[n].tokens; })) || 1;

      // Color palette for tools (saturation-aware)
      var pp = palette();
      var colors = [pp.chart1, pp.chart2, pp.chart3, pp.chart4, pp.chart5, pp.chart6, pp.chart7, pp.chart8];

      // Info content - explain what this section shows
      var toolInfoContent = [
        { name: 'What This Shows', desc: 'Token consumption breakdown by operation type. Each bar represents the total tokens used by that category of operations.' },
        { name: 'Why It Matters', desc: 'Understanding which operations consume the most tokens helps identify potential optimization opportunities.' },
        { name: 'How to Read', desc: 'Longer bars = more tokens consumed. The percentage shows the share of total session tokens.' },
      ];

      // Tool Info Button Component
      function ToolInfoButton() {
        var showToolInfo = React.useState(false);
        var toolInfoVisible = showToolInfo[0];
        var setToolInfoVisible = showToolInfo[1];
        return h('div', {
          style: { position: 'relative' },
          onClick: function(e) { e.stopPropagation(); setToolInfoVisible(!toolInfoVisible); }
        },
          h('div', {
            style: {
              width: '14px', height: '14px', borderRadius: '50%',
              background: 'var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '9px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #6b7280)',
              cursor: 'pointer'
            }
          }, 'i'),
          toolInfoVisible ? h('div', {
            style: {
              position: 'absolute', right: 0, top: '100%', marginTop: '4px',
              width: '280px', padding: '10px', borderRadius: '8px',
              background: 'var(--dsw-alias-bg-base, #fff)',
              border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100
            }
          },
            h('div', { style: { fontSize: '11px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2937)', marginBottom: '6px' } }, 'Tool Reference'),
            toolInfoList.map(function(info, idx) {
              return h('div', { key: idx, style: { marginBottom: '6px', paddingBottom: '4px', borderBottom: idx < toolInfoList.length - 1 ? '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.1))' : 'none' } },
                h('div', { style: { fontSize: '10px', fontWeight: 600, color: palette().opportunity, fontFamily: 'monospace' } }, info.name),
                h('div', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary, #6b7280)', lineHeight: 1.3 } }, info.desc)
              );
            })
          ) : null
        );
      }

      return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' } },
        // Token Distribution - Horizontal Bar Chart
        h('div', { style: cardStyle() },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' } },
            h('div', { style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2937)' } }, 'Token Distribution by Tool'),
            h(ToolInfoButton, null)
          ),
          toolNames.slice(0, 8).map(function (name, idx) {
            var stat = toolStats[name];
            var pct = totalTokens > 0 ? Math.round((stat.tokens / totalTokens) * 100) : 0;
            var barWidth = Math.max(2, Math.round((stat.tokens / maxTokens) * 100));
            var displayName = getToolDisplayName(name);
            return h('div', { key: name, style: { marginBottom: '6px' } },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' } },
                h('span', { title: name, style: { color: 'var(--dsw-alias-label-primary, #1f2937)', fontWeight: 500 } }, displayName),
                h('span', { style: { color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, stat.tokens.toLocaleString() + ' (' + pct + '%)')
              ),
              h('div', { style: { height: '8px', borderRadius: '4px', background: 'var(--dsw-alias-border-l2, rgba(128,128,128,0.15))', overflow: 'hidden' } },
                h('div', { style: { height: '100%', width: barWidth + '%', background: colors[idx % colors.length], borderRadius: '4px', transition: 'width 0.3s' } })
              )
            );
          })
        ),

        // Tool Usage - Donut-style visualization
        h('div', { style: cardStyle() },
          h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--dsw-alias-label-primary, #1f2937)' } }, 'Tool Usage Summary'),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '16px' } },
            // Simple donut representation using stacked bars
            h('div', { style: { width: '80px', height: '80px', borderRadius: '50%', background: 'conic-gradient(' + toolNames.slice(0, 8).map(function (n, i) {
              var pct = totalTokens > 0 ? (toolStats[n].tokens / totalTokens) * 100 : 0;
              var start = toolNames.slice(0, i).reduce(function (s, x) { return s + (totalTokens > 0 ? (toolStats[x].tokens / totalTokens) * 100 : 0); }, 0);
              return colors[i % colors.length] + ' ' + start + '% ' + (start + pct) + '%';
            }).join(', ') + ', var(--dsw-alias-border-l2, #e5e7eb) ' + toolNames.slice(0, 8).reduce(function (s, x) { return s + (totalTokens > 0 ? (toolStats[x].tokens / totalTokens) * 100 : 0); }, 0) + '% 100%)', position: 'relative' } },
              h('div', { style: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '50px', height: '50px', borderRadius: '50%', background: 'var(--dsw-alias-bg-base, #fff)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } },
                h('div', { style: { fontSize: '14px', fontWeight: 700, color: 'var(--dsw-alias-label-primary, #1f2937)' } }, toolNames.length),
                h('div', { style: { fontSize: '8px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, 'tools')
              )
            ),
            // Legend - show all tools
            h('div', { style: { flex: 1, fontSize: '10px', maxHeight: '200px', overflowY: 'auto' } },
              toolNames.map(function (name, idx) {
                var displayName = getToolDisplayName(name);
                return h('div', { key: name, style: { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' } },
                  h('div', { style: { width: '8px', height: '8px', borderRadius: '2px', background: colors[idx % colors.length] } }),
                  h('span', { title: name, style: { color: 'var(--dsw-alias-label-primary, #1f2937)' } }, displayName),
                  h('span', { style: { color: 'var(--dsw-alias-label-secondary, #6b7280)', marginLeft: 'auto' } }, toolStats[name].count + ' calls')
                );
              })
            )
          )
        ),

      );
    }

    // ---- Attribution Confidence Component ------------------------------------
    function AttributionConfidence(props) {
      var units = props.units || [];
      var confidenceCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
      units.forEach(function (u) { confidenceCounts[u.confidence] = (confidenceCounts[u.confidence] || 0) + 1; });
      var total = units.length || 1;
      var ppc = palette();
      var confColors = { HIGH: ppc.good, MEDIUM: ppc.warning, LOW: ppc.critical };

      // Confidence Info Button Component
      function ConfidenceInfoButton() {
        var showConfInfo = React.useState(false);
        var confInfoVisible = showConfInfo[0];
        var setConfInfoVisible = showConfInfo[1];
        return h('div', {
          style: { position: 'relative' },
          onClick: function(e) { e.stopPropagation(); setConfInfoVisible(!confInfoVisible); }
        },
          h('div', {
            style: {
              width: '14px', height: '14px', borderRadius: '50%',
              background: 'var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '9px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #6b7280)',
              cursor: 'pointer'
            }
          }, 'i'),
          confInfoVisible ? h('div', {
            style: {
              position: 'absolute', right: 0, top: '100%', marginTop: '4px',
              width: '260px', padding: '10px', borderRadius: '8px',
              background: 'var(--dsw-alias-bg-base, #fff)',
              border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100
            }
          },
            h('div', { style: { fontSize: '11px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2937)', marginBottom: '6px' } }, '关于归因置信度'),
            h('div', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary, #6b7280)', lineHeight: 1.4, marginBottom: '8px' } },
              '这表示分析结果的可信程度。置信度越高，结果越可靠。/ How reliable the analysis results are.'
            ),
            h('div', { style: { marginBottom: '4px' } },
              h('span', { style: { fontSize: '9px', fontWeight: 600, color: palette().good } }, 'HIGH'),
              h('span', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, ' - 精确匹配，结果可靠 / Exact match, reliable')
            ),
            h('div', { style: { marginBottom: '4px' } },
              h('span', { style: { fontSize: '9px', fontWeight: 600, color: palette().warning } }, 'MEDIUM'),
              h('span', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, ' - 基于上下文估算 / Estimated from context')
            ),
            h('div', null,
              h('span', { style: { fontSize: '9px', fontWeight: 600, color: palette().critical } }, 'LOW'),
              h('span', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, ' - 难以准确归因 / Hard to attribute accurately')
            )
          ) : null
        );
      }

      return h('div', { style: cardStyle() },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' } },
          h('div', { style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2937)' } }, 'Attribution Confidence'),
          h(ConfidenceInfoButton, null)
        ),
        h('div', { style: { display: 'flex', gap: '8px' } },
          Object.keys(confidenceCounts).map(function (level) {
            var count = confidenceCounts[level];
            var pct = Math.round((count / total) * 100);
            return h('div', { key: level, style: { flex: 1, textAlign: 'center', padding: '8px', borderRadius: '6px', background: confColors[level] + '15' } },
              h('div', { style: { fontSize: '20px', fontWeight: 700, color: confColors[level] } }, count),
              h('div', { style: { fontSize: '10px', color: confColors[level] } }, level),
              h('div', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, pct + '%')
            );
          })
        )
      );
    }

    // ---- Collapsible Details Panel ----------------------------------------
    function CollapsibleDetails(props) {
      var children = props.children;
      var title = props.title || 'Details';
      var defaultOpen = props.defaultOpen || false;
      var isOpenState = React.useState(defaultOpen);
      var isOpen = isOpenState[0];
      var setIsOpen = isOpenState[1];

      return h('div', { style: { border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))', borderRadius: '8px', overflow: 'hidden' } },
        // Header - always visible, clickable to toggle
        h('div', {
          onClick: function() { setIsOpen(!isOpen); },
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', cursor: 'pointer',
            background: 'var(--dsw-alias-bg-base, rgba(128,128,128,0.04))',
            borderBottom: isOpen ? '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))' : 'none',
          }
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2937)' } }, title),
            // Event count badge if provided
            props.badge ? h('span', { style: { fontSize: '10px', padding: '1px 6px', borderRadius: '9px', background: 'var(--dsw-alias-brand-primary, #3b82f6)', color: '#fff', fontWeight: 600 } }, props.badge) : null
          ),
          h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #6b7280)', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' } }, '▼')
        ),
        // Content - collapsible
        isOpen ? h('div', { style: { padding: '12px' } }, children) : null
      );
    }

    // ---- Summary Info Line Component ---------------------------------------
    function SummaryInfoLine(props) {
      var flaggedUnits = props.flaggedUnits || [];
      var totalFlaggedTokens = props.totalFlaggedTokens || 0;
      var events = props.events || [];
      var showSummaryInfo = React.useState(false);
      var summaryInfoVisible = showSummaryInfo[0];
      var setSummaryInfoVisible = showSummaryInfo[1];
      return h('div', { style: { marginBottom: '12px' } },
        h('div', { style: { display: 'flex', gap: '12px', fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #6b7280)', alignItems: 'center' } },
          h('span', null, '涉及 ' + flaggedUnits.length + ' 个工具'),
          h('span', null, '\u00b7'),
          h('span', null, totalFlaggedTokens.toLocaleString() + ' Tokens'),
          h('span', null, '\u00b7'),
          h('span', null, events.length + ' 个提示'),
          h('div', {
            style: { position: 'relative' },
            onClick: function(e) { e.stopPropagation(); setSummaryInfoVisible(!summaryInfoVisible); }
          },
            h('div', {
              style: {
                width: '12px', height: '12px', borderRadius: '50%',
                background: 'var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '8px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #6b7280)',
                cursor: 'pointer'
              }
            }, 'i'),
            summaryInfoVisible ? h('div', {
              style: {
                position: 'absolute', left: 0, top: '100%', marginTop: '4px',
                width: '300px', padding: '10px', borderRadius: '8px',
                background: 'var(--dsw-alias-bg-base, #fff)',
                border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100
              }
            },
              h('div', { style: { fontSize: '10px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2937)', marginBottom: '6px' } }, '关于这些数字'),
              h('div', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary, #6b7280)', lineHeight: 1.4, marginBottom: '4px' } },
                h('span', { style: { fontWeight: 600 } }, '涉及工具'),
                '：触发优化提示的不同工具数量 / Unique tools with optimization hints'
              ),
              h('div', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary, #6b7280)', lineHeight: 1.4, marginBottom: '4px' } },
                h('span', { style: { fontWeight: 600 } }, '涉及 Token'),
                '：这些工具消耗的 token 总量 / Tokens consumed by these tools'
              ),
              h('div', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary, #6b7280)', lineHeight: 1.4 } },
                h('span', { style: { fontWeight: 600 } }, '提示数'),
                '：检测到的优化提示数量 / Number of optimization hints'
              )
            ) : null
          )
        )
      );
    }

    // ---- Signal Info Button Component ---------------------------------------
    function SignalInfoButton(props) {
      var infoContent = props.infoContent || [];
      var typeColors = props.typeColors || {};
      var showInfo = React.useState(false);
      var infoVisible = showInfo[0];
      var setInfoVisible = showInfo[1];
      return h('div', {
        style: { position: 'relative' },
        onClick: function(e) { e.stopPropagation(); setInfoVisible(!infoVisible); }
      },
        h('div', {
          style: {
            width: '16px', height: '16px', borderRadius: '50%',
            background: 'var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '10px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #6b7280)',
            cursor: 'pointer'
          }
        }, 'i'),
        infoVisible ? h('div', {
          style: {
            position: 'absolute', right: 0, top: '100%', marginTop: '4px',
            width: '300px', padding: '12px', borderRadius: '8px',
            background: 'var(--dsw-alias-bg-base, #fff)',
            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100
          }
        },
          h('div', { style: { fontSize: '11px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2937)', marginBottom: '8px' } }, '关于优化提示'),
          h('div', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary, #6b7280)', marginBottom: '8px', lineHeight: 1.4 } },
            '这个百分比表示与优化提示相关的 token 占比。',
            h('span', { style: { fontWeight: 600 } }, '这些 token 不一定是浪费的'),
            '——某些操作可能是完成复杂任务所必需的。'
          ),
          h('div', { style: { fontSize: '10px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2937)', marginBottom: '4px' } }, '提示类型：'),
          infoContent.map(function(info, idx) {
            return h('div', { key: idx, style: { marginBottom: '6px' } },
              h('div', { style: { fontSize: '10px', fontWeight: 600, color: typeColors[Object.keys(typeColors)[idx]] } }, info.name),
              h('div', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary, #6b7280)', lineHeight: 1.3 } }, info.desc)
            );
          }),
          h('div', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary, #6b7280)', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))' } },
            '优化提示帮助你发现可能有优化空间的操作，但不代表这些操作一定是低效的。'
          )
        ) : null
      );
    }

    // ---- Waste Overview Panel (v0.9 - Optimization Signals) ----------------
    function WasteOverview(props) {
      var report = props.report;
      var summary = report.summary;
      var waste = report.waste || {};
      var events = waste.events || [];
      var flaggedUnits = waste.flaggedUnits || [];
      var typeTokenMap = waste.typeTokenMap || {};
      var typeCountMap = waste.typeCountMap || {};
      var severityTokenMap = waste.severityTokenMap || {};
      var severityCountMap = waste.severityCountMap || {};
      var totalFlaggedTokens = waste.totalFlaggedTokens || 0;

      // Use same total as TOKEN USAGE
      var inputNew = summary.totalInputTokens || 0;
      var cacheRead = summary.cacheReadTokens || 0;
      var outputTokens = summary.totalOutputTokens || 0;
      var inputAll = inputNew + cacheRead;
      var totalTokens = inputAll + outputTokens || 1;

      // Optimization signals percentage
      var signalPct = totalTokens > 0 ? Math.round((totalFlaggedTokens / totalTokens) * 100) : 0;

      // Count signals by severity
      var opportunityCount = severityCountMap.OPPORTUNITY || 0;
      var warningCount = severityCountMap.WARNING || 0;
      var criticalCount = severityCountMap.CRITICAL || 0;
      var hasAnySignals = events.length > 0;
      var hasHighSeverity = warningCount > 0 || criticalCount > 0;

      // Find highest severity for recommendation
      var highestSeverity = 'OPPORTUNITY';
      if (criticalCount > 0) highestSeverity = 'CRITICAL';
      else if (warningCount > 0) highestSeverity = 'WARNING';

      // Find dominant type by token amount
      var dominantType = null;
      var maxTokens = 0;
      Object.keys(typeTokenMap).forEach(function(type) {
        if (typeTokenMap[type] > maxTokens) {
          maxTokens = typeTokenMap[type];
          dominantType = type;
        }
      });

      // Bilingual recommendations
      var recommendations = {
        CONTEXT_SPIKE: {
          OPPORTUNITY: '提示词可以更具体一些，减少不必要的内容读取。\nTry making your prompt more specific to avoid reading unnecessary content.',
          WARNING: '这次操作产生了较多内容，可以检查是否读取了不必要的信息。\nThis operation produced a large amount of content. Check whether some of it was unnecessary.',
          CRITICAL: '这次操作产生了异常多的内容，建议检查提示词或读取范围是否过大。\nThis operation produced an unusually large amount of content. Check whether the prompt or reading scope is too large.',
        },
        TOKEN_ANOMALY: {
          OPPORTUNITY: '这次操作消耗的 Token 比平时多，可以尝试把任务拆得更小一些。\nThis operation used more tokens than usual. Try breaking the task into smaller steps.',
          WARNING: '这次操作消耗了较多 Token，可以检查任务是否可以更简单地完成。\nThis operation used a large number of tokens. Check whether the task could be completed more simply.',
          // CRITICAL: 不显示 recommendation，避免武断建议
        },
        COST_ANOMALY: {
          OPPORTUNITY: '类似请求可以尽量复用已有上下文，减少重复消耗。\nReuse existing context when possible to avoid unnecessary repeated usage.',
          WARNING: '这次操作成本较高，可以检查是否有可以优化的地方。\nThis operation had high cost. Check whether there are optimization opportunities.',
          CRITICAL: '这次操作成本异常高，建议检查是否可以优化。\nThis operation had unusually high cost. Consider optimization.',
        },
        DUPLICATE_RESULT: {
          OPPORTUNITY: '可以考虑复用之前的结果，避免重复请求。\nConsider reusing previous results to avoid repeated requests.',
          WARNING: '检测到重复操作，建议避免重复请求。\nDuplicate operations detected. Consider avoiding repeated requests.',
          CRITICAL: '检测到多次重复操作，建议检查使用模式。\nMultiple duplicate operations detected. Review usage patterns.',
        },
      };

      // Status and recommendation based on severity
      var status, suggestion, icon, color;
      if (!hasAnySignals) {
        status = '使用模式正常';
        icon = '✨';
        color = '#10b981';
        suggestion = null;
      } else if (criticalCount > 0) {
        status = '发现一些明显不同于平常的操作';
        icon = '🔍';
        color = '#f87171';
        if (dominantType && recommendations[dominantType]) {
          suggestion = recommendations[dominantType].CRITICAL;
        }
      } else if (warningCount > 0) {
        status = '有一些操作值得看看';
        icon = '👀';
        color = '#f59e0b';
        if (dominantType && recommendations[dominantType]) {
          suggestion = recommendations[dominantType].WARNING;
        }
      } else {
        status = '发现一些优化空间';
        icon = '💡';
        color = '#3b82f6';
        if (dominantType && recommendations[dominantType]) {
          suggestion = recommendations[dominantType].OPPORTUNITY;
        }
      }

      // Type labels and colors
      var typeLabels = {
        'CONTEXT_SPIKE': 'Context Growth',
        'TOKEN_ANOMALY': 'Token Usage',
        'COST_ANOMALY': 'Cost',
        'DUPLICATE_RESULT': 'Duplicate'
      };
      var ppp = palette();
      var typeColors = {
        'CONTEXT_SPIKE': ppp.opportunity,
        'TOKEN_ANOMALY': ppp.warning,
        'COST_ANOMALY': ppp.critical,
        'DUPLICATE_RESULT': ppp.duplicate
      };

      // Severity colors (softened for less anxiety)
      var severityColors = {
        'OPPORTUNITY': ppp.opportunity,
        'WARNING': ppp.warning,
        'CRITICAL': ppp.critical,
      };

      // Empty state
      var pEmpty = palette();
      if (!hasAnySignals) {
        return h('div', { style: Object.assign({}, cardStyle(), { display: 'flex', alignItems: 'center', gap: '12px', background: paletteRgba('good', 0.05), border: '1px solid ' + paletteRgba('good', 0.2) }) },
          h('div', { style: { fontSize: '24px' } }, '✨'),
          h('div', null,
            h('div', { style: { fontSize: '12px', fontWeight: 600, color: pEmpty.good } }, '使用模式正常'),
            h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, '当前会话没有发现需要留意的操作')
          )
        );
      }

      // Info content
      var infoContent = [
        { name: 'Context Growth', desc: 'A tool result caused larger-than-typical context growth. May indicate broad file retrieval or search results.' },
        { name: 'Token Usage', desc: 'A tool consumed more tokens than the session baseline. May indicate complex operations or large outputs.' },
        { name: 'Cost', desc: 'Higher cost than typical. Often correlated with token volume—review for cache optimization.' },
        { name: 'Duplicate', desc: 'Identical content returned by multiple tool calls. Consider whether repeated requests were necessary.' },
      ];

      return h('div', { style: cardStyle() },
        // Header
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('div', { style: { fontSize: '20px' } }, icon),
            h('div', null,
              h('div', { style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2937)' } }, '优化提示'),
              h('div', { style: { fontSize: '10px', color: color, fontWeight: 500 } }, status)
            )
          ),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('div', { style: { textAlign: 'right' } },
              h('div', { style: { fontSize: '18px', fontWeight: 700, color: color } }, signalPct + '%'),
              h('div', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, '的 Token 涉及优化提示')
            ),
            h(SignalInfoButton, { infoContent: infoContent, typeColors: typeColors })
          )
        ),
        // Summary line with info tooltip
        h(SummaryInfoLine, { flaggedUnits: flaggedUnits, totalFlaggedTokens: totalFlaggedTokens, events: events }),
        // Severity breakdown
        h('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } },
          opportunityCount > 0 ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: severityColors.OPPORTUNITY } },
            h('span', { style: { width: '8px', height: '8px', borderRadius: '2px', background: severityColors.OPPORTUNITY } }),
            opportunityCount + ' opportunity' + (opportunityCount !== 1 ? 's' : '')
          ) : null,
          warningCount > 0 ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: severityColors.WARNING } },
            h('span', { style: { width: '8px', height: '8px', borderRadius: '2px', background: severityColors.WARNING } }),
            warningCount + ' warning' + (warningCount !== 1 ? 's' : '')
          ) : null,
          criticalCount > 0 ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: severityColors.CRITICAL } },
            h('span', { style: { width: '8px', height: '8px', borderRadius: '2px', background: severityColors.CRITICAL } }),
            criticalCount + ' critical'
          ) : null
        ),
        // Two visualizations
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' } },
          // Left: Tokens by detection type
          h('div', null,
            h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #6b7280)', marginBottom: '6px' } }, 'Tokens by Signal Type'),
            h('div', { style: { display: 'flex', gap: '3px', height: '24px', borderRadius: '4px', overflow: 'hidden' } },
              Object.keys(typeTokenMap).map(function(type) {
                var pct = totalFlaggedTokens > 0 ? Math.round((typeTokenMap[type] / totalFlaggedTokens) * 100) : 0;
                return h('div', {
                  key: type,
                  title: typeLabels[type] + ': ' + typeTokenMap[type].toLocaleString() + ' tokens (' + pct + '%)',
                  style: { width: pct + '%', background: typeColors[type] || '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#fff', fontWeight: 600 }
                }, pct > 15 ? pct + '%' : '');
              })
            ),
            h('div', { style: { display: 'flex', gap: '6px', marginTop: '4px', fontSize: '9px', color: 'var(--dsw-alias-label-tertiary, #9ca3af)' } },
              Object.keys(typeTokenMap).map(function(type) {
                return h('span', { key: type, style: { display: 'flex', alignItems: 'center', gap: '3px' } },
                  h('span', { style: { width: '6px', height: '6px', borderRadius: '2px', background: typeColors[type] } }),
                  typeLabels[type]
                );
              })
            )
          ),
          // Right: Units by signal type
          h('div', null,
            h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #6b7280)', marginBottom: '6px' } }, 'Units by Signal Type'),
            h('div', { style: { display: 'flex', gap: '3px', height: '24px', borderRadius: '4px', overflow: 'hidden' } },
              Object.keys(typeCountMap).map(function(type) {
                var count = typeCountMap[type] || 0;
                var pct = flaggedUnits.length > 0 ? Math.round((count / flaggedUnits.length) * 100) : 0;
                return h('div', {
                  key: type,
                  title: typeLabels[type] + ': ' + count + ' units (' + pct + '%)',
                  style: { width: pct + '%', background: typeColors[type] || '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#fff', fontWeight: 600 }
                }, pct > 15 ? pct + '%' : '');
              })
            ),
            h('div', { style: { display: 'flex', gap: '6px', marginTop: '4px', fontSize: '9px', color: 'var(--dsw-alias-label-tertiary, #9ca3af)' } },
              Object.keys(typeCountMap).map(function(type) {
                return h('span', { key: type, style: { display: 'flex', alignItems: 'center', gap: '3px' } },
                  h('span', { style: { width: '6px', height: '6px', borderRadius: '2px', background: typeColors[type] } }),
                  typeLabels[type] + ': ' + (typeCountMap[type] || 0)
                );
              })
            )
          )
        ),
        // Recommendation (bilingual: Chinese first, English second)
        suggestion ? h('div', { style: { padding: '8px 10px', borderRadius: '6px', background: color + '10', borderLeft: '3px solid ' + color } },
          (function() {
            var parts = suggestion.split('\n');
            var chinese = parts[0] || '';
            var english = parts[1] || '';
            return h('div', null,
              h('div', { style: { fontSize: '11px', fontWeight: 500, color: 'var(--dsw-alias-label-primary, #1f2937)', marginBottom: english ? '4px' : '0' } }, chinese),
              english ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, english) : null
            );
          })()
        ) : null
      );
    }

    // ---- Tool attribution section (click to expand detail) -----------------
    function ToolAttributionSection(props) {
      var report = props.report;
      var units = report.units.flat;
      if (units.length === 0) return h('div', { style: emptySectionStyle() }, 'No tool calls for this session.');
      var expandedState = React.useState(false);
      var setExpanded = expandedState[1];
      var expandedVal = expandedState[0];
      var visibleUnits = expandedVal ? units : units.slice(0, DISPLAY_LIMIT);
      var truncated = units.length > DISPLAY_LIMIT;
      return h('div', { style: tableFrameStyle() },
        h('table', { style: tableStyle() },
          h('thead', null, h('tr', null,
            h('th', { style: thStyle() }, 'Tool'),
            h('th', { style: Object.assign({}, thStyle(), numericCellStyle()) }, 'Tokens'),
            h('th', { style: Object.assign({}, thStyle(), numericCellStyle()) }, 'Cost'),
            h('th', { style: Object.assign({}, thStyle(), numericCellStyle()) }, 'Context'),
            h('th', { style: Object.assign({}, thStyle(), { whiteSpace: 'nowrap' }) }, 'Confidence'))),
          h('tbody', null, visibleUnits.map(function (unit, index) {
            var methodBadge = unit.allocationMethod === 'PROPORTIONAL_CONTEXT'
              ? statusBadge('estimated', 'Estimated')
              : statusBadge('info', unit.allocationMethod === 'DIRECT' ? 'Direct' : 'INFO');
            var costCell = report.cost.status === 'UNPRICED'
              ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' } },
                h('span', null, '\u2014'),
                statusBadge('unpriced', 'UNPRICED'))
              : h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' } },
                fmtCost(unit.attributedCost),
                methodBadge);
            return h('tr', {
              key: unit.unitId,
              'data-unit': unit.unitId,
              style: Object.assign({ cursor: 'pointer' }, rowStyle(index)),
              onClick: function () { var el = document.getElementById('detail-' + unit.unitId); if (el) el.style.display = el.style.display === 'none' ? '' : 'none'; },
            },
              h('td', { style: tdStyle() },
                h('span', { style: { fontWeight: 600 } }, unit.toolName || '\u2014'),
                unit.callId ? h('div', { title: unit.callId, style: { fontSize: '10px', color: '#9ca3af', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, compactId(unit.callId)) : null),
              h('td', { style: Object.assign({}, tdStyle(), numericCellStyle()) }, fmtTokens(unit.attributedTokens)),
              h('td', { style: Object.assign({}, tdStyle(), numericCellStyle()) }, costCell),
              h('td', { style: Object.assign({}, tdStyle(), numericCellStyle()) }, fmtTokens(unit.contextCharsDelta) + ' chars'),
              h('td', { style: Object.assign({}, tdStyle(), { whiteSpace: 'nowrap' }) }, unit.confidence || '\u2014')
            );
          })),
          h('tbody', null, visibleUnits.map(function (unit, index) {
            return h('tr', { key: 'detail-' + unit.unitId, id: 'detail-' + unit.unitId, style: Object.assign({ display: 'none' }, rowStyle(index)) },
              h('td', { colSpan: 5, style: Object.assign({}, tdStyle(), { background: 'rgba(128,128,128,0.05)' }) },
                h('div', { style: { fontSize: '12px', lineHeight: 1.6 } },
                  'unitId: ' + unit.unitId,
                  h('br'), 'status: ' + unit.attributionStatus + ' \u00b7 method: ' + (unit.allocationMethod || '\u2014'),
                  h('br'), 'resultSizeChars: ' + fmtTokens(unit.resultSizeChars),
                  h('br'), 'nextRequestInputTokens: ' + fmtTokens(unit.nextRequestInputTokens),
                  h('br'), 'attributedCost: ' + fmtCost(unit.attributedCost)
                )
              )
            );
          }))
        )
        ,
        truncated ? h('button', { style: toggleButtonStyle(), onClick: function () { setExpanded(function (v) { return !v; }); } },
          expandedVal ? 'Show latest ' + DISPLAY_LIMIT : 'Show all ' + units.length) : null
      );
    }

    // ---- Summary cards and session header ----------------------------------
    function SummaryCard(props) {
      var item = props.item;
      var valueSize = item.emphasis ? '20px' : '17px';
      return h('div', { key: item.label, style: cardStyle() },
        h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #9ca3af)' } }, item.label),
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap', margin: '2px 0' } },
          h('span', { title: item.title, style: { fontSize: valueSize, fontWeight: 700, lineHeight: 1.2 } }, item.value),
          item.badge),
        h('div', { style: { fontSize: '11px', color: '#9ca3af' } }, item.sub));
    }

    // ---- Core Metrics Dashboard (Token Breakdown) -------------------------
    function CoreMetrics(props) {
      var report = props.report;
      var summary = report.summary;
      var cost = report.cost;

      // IMPORTANT: DeepSeek API returns:
      // - inputTokens = prompt_tokens - cacheReadTokens (new input only, NOT including cache)
      // - cacheReadTokens = cached tokens
      // - outputTokens = completion tokens
      //
      // So the correct breakdown is:
      var inputNew = summary.totalInputTokens || 0;      // New input (already excludes cache)
      var cacheRead = summary.cacheReadTokens || 0;      // Cache hit tokens
      var outputTokens = summary.totalOutputTokens || 0;
      var inputAll = inputNew + cacheRead;               // Total input = new + cache
      var totalTokens = inputAll + outputTokens;         // Grand total
      var cacheWrite = summary.cacheWriteTokens || 0;
      var priced = summary.costStatus === 'PRICED' && typeof summary.totalCost === 'number';

      // Cache hit rate: cacheRead / total input
      var cacheHitRate = inputAll > 0
        ? Math.round((cacheRead / inputAll) * 100)
        : 0;

      // Bar proportions (of grand total)
      var inNewPct = totalTokens > 0 ? Math.round((inputNew / totalTokens) * 100) : 0;
      var inCachePct = totalTokens > 0 ? Math.round((cacheRead / totalTokens) * 100) : 0;
      var outPct = totalTokens > 0 ? Math.round((outputTokens / totalTokens) * 100) : 0;

      var pStats = palette();
      return h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', alignItems: 'stretch' } },
        // Left: Token Usage with breakdown
        h('div', { style: Object.assign({}, cardStyle(), { display: 'flex', flexDirection: 'column', justifyContent: 'center' }) },
          h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #9ca3af)', marginBottom: '4px' } }, 'TOKEN USAGE'),
          h('div', { style: { fontSize: '24px', fontWeight: 700, lineHeight: 1, color: 'var(--dsw-alias-label-primary, #1f2937)' } }, totalTokens.toLocaleString()),
          // Three-part breakdown
          h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', fontSize: '10px' } },
            h('span', { style: { color: pStats.opportunity } }, 'in (new): ' + inputNew.toLocaleString()),
            h('span', { style: { color: pStats.chart7 } }, 'in (cache): ' + cacheRead.toLocaleString()),
            h('span', { style: { color: pStats.good } }, 'out: ' + outputTokens.toLocaleString())
          ),
          // Stacked bar
          h('div', { style: { height: '6px', borderRadius: '3px', background: 'var(--dsw-alias-border-l2, rgba(128,128,128,0.15))', marginTop: '8px', overflow: 'hidden', display: 'flex' } },
            h('div', { style: { width: inNewPct + '%', background: pStats.opportunity } }),
            h('div', { style: { width: inCachePct + '%', background: pStats.chart7 } }),
            h('div', { style: { width: outPct + '%', background: pStats.good } })
          )
        ),

        // Middle: Cache Performance
        h('div', { style: Object.assign({}, cardStyle(), { display: 'flex', flexDirection: 'column', justifyContent: 'center' }) },
          h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #9ca3af)', marginBottom: '4px' } }, 'CACHE'),
          h('div', { style: { fontSize: '24px', fontWeight: 700, lineHeight: 1, color: cacheHitRate >= 50 ? pStats.good : pStats.warning } }, cacheHitRate + '%'),
          h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #9ca3af)', marginTop: '2px' } }, 'hit rate'),
          h('div', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-tertiary, #9ca3af)', marginTop: '4px' } },
            cacheRead.toLocaleString() + ' / ' + inputAll.toLocaleString() + ' input'
          )
        ),

        // Right: Cost
        h('div', { style: Object.assign({}, cardStyle(), { display: 'flex', flexDirection: 'column', justifyContent: 'center' }) },
          h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #9ca3af)', marginBottom: '4px' } }, 'COST'),
          h('div', { style: { fontSize: '24px', fontWeight: 700, lineHeight: 1, color: priced ? 'var(--dsw-alias-label-primary, #1f2937)' : '#9ca3af' } },
            priced ? fmtCost(summary.totalCost) : '—'
          ),
          h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #9ca3af)', marginTop: '2px' } },
            priced ? (summary.requestCount || 0) + ' requests' : 'pricing unavailable'
          ),
          priced ? h('div', { style: { display: 'flex', gap: '8px', marginTop: '4px', fontSize: '9px', color: 'var(--dsw-alias-label-tertiary, #9ca3af)' } },
            h('span', null, 'in: ' + fmtCost(cost.inputCost)),
            h('span', null, 'out: ' + fmtCost(cost.outputCost))
          ) : null
        )
      );
    }

    function SessionMeta(props) {
      var report = props.report;
      var provider = report.session.provider;
      var model = report.session.model;
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '13px', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-secondary, rgba(128,128,128,0.06))', border: '1px solid var(--dsw-alias-border, rgba(128,128,128,0.14))' } },
        h('span', { title: report.session.id, style: { fontWeight: 700, fontVariantNumeric: 'tabular-nums' } }, compactId(report.session.id)),
        provider ? statusBadge('provider', 'Provider') : statusBadge('info', 'INFO'),
        h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #9ca3af)' } },
          provider && model
            ? humanizeKey(provider) + ' \u00b7 ' + model
            : (provider ? humanizeKey(provider) : 'no provider/model info')));
    }

    // ---- Dashboard root ----------------------------------------------------
    // ---- Waste Config Panel (Simplified) ------------------------------------
    // ---- Export Panel -------------------------------------------------------
    function ExportPanel() {
      var exportState = React.useState({ format: 'json', scope: 'session', exporting: false, lastExport: null });
      var exportConfig = exportState[0];
      var setExportConfig = exportState[1];

      function downloadExport(data, filename) {
        var blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      async function handleExport() {
        if (!rpcHandle || exportConfig.exporting) return;
        setExportConfig(Object.assign({}, exportConfig, { exporting: true }));
        try {
          var result = null;
          var filename = '';
          var timestamp = new Date().toISOString().slice(0, 10);

          if (exportConfig.scope === 'session' && selectedSessionId) {
            result = await rpcHandle.exportSession(selectedSessionId, exportConfig.format);
            filename = 'token-analytics-session-' + selectedSessionId.slice(0, 8) + '-' + timestamp + '.' + exportConfig.format;
          } else if (exportConfig.scope === 'all') {
            result = await rpcHandle.exportAll(exportConfig.format);
            filename = 'token-analytics-all-sessions-' + timestamp + '.' + exportConfig.format;
          } else if (exportConfig.scope === 'summary') {
            result = await rpcHandle.exportSummary(exportConfig.format);
            filename = 'token-analytics-summary-' + timestamp + '.' + exportConfig.format;
          }

          if (result && result.ok) {
            var exportData = exportConfig.format === 'csv' && result.value.csv ? result.value.csv : result.value;
            downloadExport(exportData, filename);
            setExportConfig(Object.assign({}, exportConfig, { exporting: false, lastExport: { success: true, filename: filename } }));
          } else {
            setExportConfig(Object.assign({}, exportConfig, { exporting: false, lastExport: { success: false, error: result ? result.error : 'Unknown error' } }));
          }
        } catch (e) {
          console.error('[token-analytics-client] export error:', e);
          setExportConfig(Object.assign({}, exportConfig, { exporting: false, lastExport: { success: false, error: e.message } }));
        }
      }

      var btnStyle = {
        fontSize: '11px', padding: '4px 12px', borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border, rgba(128,128,128,0.2))',
        background: 'var(--dsw-alias-bg-secondary, rgba(128,128,128,0.08))',
        color: 'var(--dsw-alias-label-primary, #1f2937)', cursor: 'pointer', fontWeight: 600,
      };

      return h('div', { style: cardStyle() },
        h('div', { style: { fontSize: '11px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #9ca3af)', marginBottom: '8px' } }, 'Export Data'),
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h('label', { style: { fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' } },
            'Format:',
            h('select', {
              value: exportConfig.format,
              onChange: function(e) { setExportConfig(Object.assign({}, exportConfig, { format: e.target.value })); },
              style: { fontSize: '11px', padding: '2px 4px', borderRadius: '4px', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))', background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #1f2937)' }
            },
              h('option', { value: 'json' }, 'JSON'),
              h('option', { value: 'csv' }, 'CSV')
            )
          ),
          h('label', { style: { fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' } },
            'Scope:',
            h('select', {
              value: exportConfig.scope,
              onChange: function(e) { setExportConfig(Object.assign({}, exportConfig, { scope: e.target.value })); },
              style: { fontSize: '11px', padding: '2px 4px', borderRadius: '4px', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))', background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #1f2937)' }
            },
              h('option', { value: 'session' }, 'Current Session'),
              h('option', { value: 'all' }, 'All Sessions'),
              h('option', { value: 'summary' }, 'Summary')
            )
          ),
          h('button', {
            style: Object.assign({}, btnStyle, { opacity: exportConfig.exporting ? 0.6 : 1 }),
            disabled: exportConfig.exporting,
            onClick: handleExport,
          }, exportConfig.exporting ? 'Exporting...' : 'Export')
        ),
        exportConfig.lastExport
          ? h('div', { style: { fontSize: '10px', marginTop: '4px', color: exportConfig.lastExport.success ? palette().good : palette().critical } },
              exportConfig.lastExport.success
                ? 'Exported: ' + exportConfig.lastExport.filename
                : 'Export failed: ' + (exportConfig.lastExport.error || 'Unknown error'))
          : null
      );
    }

    // ---- Historical restore progress bar -----------------------------------
    function HistoricalProgressBar() {
      if (historicalProgress.complete && historicalProgress.total === 0) return null;
      if (historicalProgress.complete) return null;
      var pct = historicalProgress.total > 0 ? Math.round((historicalProgress.restored / historicalProgress.total) * 100) : 0;
      return h('div', { style: { padding: '6px 0' } },
        h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #9ca3af)', marginBottom: '4px' } },
          'Loading historical sessions: ' + historicalProgress.restored + ' / ' + historicalProgress.total + ' (' + pct + '%)'),
        h('div', { style: { height: '6px', borderRadius: '3px', background: 'rgba(128,128,128,0.12)', overflow: 'hidden' } },
          h('div', { style: { height: '100%', width: pct + '%', background: '#3b82f6', transition: 'width 0.3s' } }))
      );
    }


    // ---- Cross-session summary view ---------------------------------------
    // ---- Cross Session Core Metrics ----------------------------------------
    function CrossSessionCoreMetrics(props) {
      var data = props.data;
      if (!data || !data.totals) return null;

      var totals = data.totals;
      var inputTokens = totals.inputTokens || 0;
      var cacheRead = totals.cacheRead || 0;
      var outputTokens = totals.outputTokens || 0;
      var sessionCount = totals.sessionCount || 0;

      // Total tokens includes all three parts
      var totalTokens = inputTokens + cacheRead + outputTokens || 1;

      // Cache hit rate: cacheRead / (inputTokens + cacheRead)
      var inputAll = inputTokens + cacheRead;
      var cacheHitRate = inputAll > 0 ? Math.round((cacheRead / inputAll) * 100) : 0;

      var pCross = palette();
      return h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', alignItems: 'stretch' } },
        // Left: Token Usage
        h('div', { style: cardStyle() },
          h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #9ca3af)', marginBottom: '4px' } }, 'TOKEN USAGE (' + sessionCount + ' sessions)'),
          h('div', { style: { fontSize: '24px', fontWeight: 700, lineHeight: 1, color: 'var(--dsw-alias-label-primary, #1f2937)' } }, totalTokens.toLocaleString()),
          h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', fontSize: '10px' } },
            h('span', { style: { color: pCross.opportunity } }, 'in (new): ' + inputTokens.toLocaleString()),
            h('span', { style: { color: pCross.chart7 } }, 'in (cache): ' + cacheRead.toLocaleString()),
            h('span', { style: { color: pCross.good } }, 'out: ' + outputTokens.toLocaleString())
          )
        ),

        // Right: Cache Performance
        h('div', { style: cardStyle() },
          h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #9ca3af)', marginBottom: '4px' } }, 'CACHE'),
          h('div', { style: { fontSize: '24px', fontWeight: 700, lineHeight: 1, color: cacheHitRate >= 50 ? pCross.good : pCross.warning } }, cacheHitRate + '%'),
          h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #9ca3af)', marginTop: '2px' } }, 'hit rate'),
          h('div', { style: { fontSize: '9px', color: 'var(--dsw-alias-label-tertiary, #9ca3af)', marginTop: '4px' } },
            cacheRead.toLocaleString() + ' cached / ' + inputAll.toLocaleString() + ' total input'
          )
        )
      );
    }

    // ---- Cross Session Visual Charts ----------------------------------------
    function CrossSessionVisualCharts(props) {
      var data = props.data;
      if (!data || !data.byTool) return null;

      var byTool = data.byTool;
      var toolNames = Object.keys(byTool).sort(function (a, b) { return (byTool[b].count || 0) - (byTool[a].count || 0); });
      var totalTokens = Object.values(byTool).reduce(function (s, t) { return s + (t.tokens || 0); }, 0) || 1;
      var maxTokens = Math.max.apply(null, toolNames.map(function (n) { return byTool[n].tokens || 0; })) || 1;

      var pppp = palette();
      var colors = [pppp.chart1, pppp.chart2, pppp.chart3, pppp.chart5, pppp.chart6, pppp.chart7, pppp.chart8, pppp.chart4];

      return h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } },
        // Token Distribution
        h('div', { style: cardStyle() },
          h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--dsw-alias-label-primary, #1f2937)' } }, 'Token Distribution by Tool'),
          toolNames.slice(0, 8).map(function (name, idx) {
            var stat = byTool[name];
            var pct = totalTokens > 0 ? Math.round(((stat.tokens || 0) / totalTokens) * 100) : 0;
            var barWidth = Math.max(2, Math.round(((stat.tokens || 0) / maxTokens) * 100));
            var displayName = getToolDisplayName(name);
            return h('div', { key: name, style: { marginBottom: '6px' } },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' } },
                h('span', { title: name, style: { color: 'var(--dsw-alias-label-primary, #1f2937)', fontWeight: 500 } }, displayName),
                h('span', { style: { color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, (stat.tokens || 0).toLocaleString() + ' (' + pct + '%)')
              ),
              h('div', { style: { height: '8px', borderRadius: '4px', background: 'var(--dsw-alias-border-l2, rgba(128,128,128,0.15))', overflow: 'hidden' } },
                h('div', { style: { height: '100%', width: barWidth + '%', background: colors[idx % colors.length], borderRadius: '4px', transition: 'width 0.3s' } })
              )
            );
          })
        ),

        // Tool Usage Summary
        h('div', { style: cardStyle() },
          h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--dsw-alias-label-primary, #1f2937)' } }, 'Tool Usage Summary'),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '16px' } },
            // Donut
            h('div', { style: { width: '80px', height: '80px', borderRadius: '50%', background: 'conic-gradient(' + toolNames.slice(0, 8).map(function (n, i) {
              var pct = totalTokens > 0 ? ((byTool[n].tokens || 0) / totalTokens) * 100 : 0;
              var start = toolNames.slice(0, i).reduce(function (s, x) { return s + (totalTokens > 0 ? ((byTool[x].tokens || 0) / totalTokens) * 100 : 0); }, 0);
              return colors[i % colors.length] + ' ' + start + '% ' + (start + pct) + '%';
            }).join(', ') + ', var(--dsw-alias-border-l2, #e5e7eb) ' + toolNames.slice(0, 8).reduce(function (s, x) { return s + (totalTokens > 0 ? ((byTool[x].tokens || 0) / totalTokens) * 100 : 0); }, 0) + '% 100%)', position: 'relative' } },
              h('div', { style: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '50px', height: '50px', borderRadius: '50%', background: 'var(--dsw-alias-bg-base, #fff)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } },
                h('div', { style: { fontSize: '14px', fontWeight: 700, color: 'var(--dsw-alias-label-primary, #1f2937)' } }, toolNames.length),
                h('div', { style: { fontSize: '8px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, 'tools')
              )
            ),
            // Legend - show all tools
            h('div', { style: { flex: 1, fontSize: '10px', maxHeight: '200px', overflowY: 'auto' } },
              toolNames.map(function (name, idx) {
                var displayName = getToolDisplayName(name);
                return h('div', { key: name, style: { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' } },
                  h('div', { style: { width: '8px', height: '8px', borderRadius: '2px', background: colors[idx % colors.length] } }),
                  h('span', { title: name, style: { color: 'var(--dsw-alias-label-primary, #1f2937)' } }, displayName),
                  h('span', { style: { color: 'var(--dsw-alias-label-secondary, #6b7280)', marginLeft: 'auto' } }, (byTool[name].count || 0) + ' calls')
                );
              })
            )
          )
        )
      );
    }

    // ---- Cross Session Summary (kept for data fetching) --------------------
    function CrossSessionSummary() {
      var dataState = React.useState(crossSessionData);
      var data = dataState[0];
      var setData = dataState[1];
      var loadingState = React.useState(false);
      var setLoading = loadingState[1];

      React.useEffect(function () {
        fetchCrossSessionSummary();
      }, []);

      React.useEffect(function () {
        setData(crossSessionData);
      });

      function handleRefresh() {
        setLoading(true);
        crossSessionData = null;
        fetchCrossSessionSummary().then(function() {
          setData(crossSessionData);
          setLoading(false);
        });
      }

      if (!data) {
        return h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #9ca3af)', padding: '10px 0' } }, 'Loading cross-session summary\u2026');
      }

      // Debug: log data structure
      console.log('[token-analytics] CrossSession data:', data);
      console.log('[token-analytics] byModel:', data.byModel);

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        // Refresh button
        h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
          h('button', {
            onClick: handleRefresh,
            disabled: loadingState[0],
            style: {
              fontSize: '10px', padding: '4px 8px', borderRadius: '4px',
              border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))',
              background: 'var(--dsw-alias-bg-base, rgba(128,128,128,0.08))',
              color: 'var(--dsw-alias-label-primary, #1f2937)',
              cursor: 'pointer'
            }
          }, loadingState[0] ? 'Refreshing...' : 'Refresh')
        ),
        h(CrossSessionCoreMetrics, { data: data }),
        h(CrossSessionVisualCharts, { data: data })
      );
    }

    function ObservabilityDashboard() {
      var viewModeState = React.useState("per-session");
      var viewMode = viewModeState[0];
      var setViewMode = viewModeState[1];
      var forceUpdate = React.useState(0)[1];
      React.useEffect(function () {
        var cb = function () { forceUpdate(function (n) { return n + 1; }); };
        listeners.push(cb);
        return function () {
          var idx = listeners.indexOf(cb);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      }, []);

      var report = null;
      if (selectedSessionId && sessionReports[selectedSessionId]) {
        report = sessionReports[selectedSessionId];
      } else if (selectedSessionId === null && sessionList.length > 0) {
        for (var i = 0; i < sessionList.length; i++) {
          if (sessionList[i].hasReport && sessionReports[sessionList[i].sessionId]) {
            report = sessionReports[sessionList[i].sessionId];
            break;
          }
        }
      }


      // ---- View-mode toggle ----------------------------------------------
      function ViewToggle() {
        var btnStyle = function(active) {
          return {
            fontSize: "12px", padding: "4px 12px", borderRadius: "6px", border: "1px solid var(--dsw-alias-border, rgba(128,128,128,0.2))",
            background: active ? "var(--dsw-alias-bg-secondary, rgba(128,128,128,0.16))" : "none",
            color: active ? "var(--dsw-alias-label-primary, #1f2937)" : "var(--dsw-alias-label-secondary, #9ca3af)",
            cursor: "pointer", fontWeight: active ? 600 : 400,
          };
        };
        return h("div", { style: { display: "flex", gap: "4px", marginBottom: "8px" } },
          h("button", { style: btnStyle(viewMode === "per-session"), onClick: function() { setViewMode("per-session"); } }, "Per Session"),
          h("button", { style: btnStyle(viewMode === "cross-session"), onClick: function() { setViewMode("cross-session"); fetchCrossSessionSummary(); } }, "Cross Session")
        );
      }

      var viewToggle = h(ViewToggle, null);

      var selector = h(SessionSelector, null);

      if (report === null) {
        var emptyTitle = 'Token Analytics is active.';
        var emptyBody = sessionList.length === 0
          ? 'No sessions are tracked yet. Start a conversation to generate analysis.'
          : 'No analysis data is available yet. Start a conversation to generate attribution and cost analysis.';
        return h('div', { 'data-token-analytics': 'empty', style: { padding: '12px 0', fontSize: '13px', color: 'var(--dsw-alias-label-secondary, #9ca3af)' } },
          viewToggle,
          selector,
          h(HistoricalProgressBar, null),
          h('div', { style: { lineHeight: 1.6 } },
            h('div', { style: { fontWeight: 600 } }, emptyTitle),
            h('div', null, emptyBody))
        );
      }

      var summary = report.summary;
      var priced = summary.costStatus === 'PRICED' && typeof summary.totalCost === 'number';
      if (viewMode === 'cross-session') {
        return h('div', { 'data-token-analytics': 'dashboard', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
          viewToggle,
          h(CrossSessionSummary, null),
          h(ExportPanel, null)
        );
      }
      // Count waste events for badge
      var wasteEventCount = summary.wasteCount || 0;
      var unitCount = report.units.flat.length;

      return h('div', { 'data-token-analytics': 'dashboard', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        viewToggle,
        selector,
        h(SessionMeta, { report: report }),
        h(HistoricalProgressBar, null),
        // Core metrics
        h(CoreMetrics, { report: report }),
        // Visual Charts - on main level
        h(VisualCharts, { report: report }),
        // Waste Overview - after charts
        h(WasteOverview, { report: report }),
        // Collapsible Details Panel - no badge
        h(CollapsibleDetails, { title: '📋 Detailed Breakdown' },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
            // Attribution Confidence
            h(AttributionConfidence, { units: report.units.flat }),
            // Tool Attribution
            h('div', null,
              h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--dsw-alias-label-primary, #1f2937)' } }, 'Tool Attribution'),
              h(ToolAttributionSection, { report: report })
            ),
            // Timeline
            h('div', null,
              h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--dsw-alias-label-primary, #1f2937)' } }, 'Token / Cost Timeline'),
              h(TimelineSection, { report: report })
            ),
            // Signal Details (if any)
            wasteEventCount > 0 ? h('div', null,
              h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } }, 'Signal Details (' + wasteEventCount + ')'),
              h(WasteSection, { report: report })
            ) : null,
            // Export
            h(ExportPanel, null)
          )
        )
      );
    }

    // ---- Registration (independent slot id + namespace) --------------------
    function apply(ctx) {
      console.log('[token-analytics-client] apply() called, ctx.connection:', !!ctx.connection);

      // Set up RPC data channel
      rpcHandle = {
        getSessions: function() {
          return ctx.connection.rpc.call('/token-analytics', 'get-sessions', {});
        },
        getReport: function(sessionId) {
          return ctx.connection.rpc.call('/token-analytics', 'get-report', { sessionId: sessionId });
        },
        getWasteConfig: function() {
          // Waste thresholds are fixed in v0.36+; return defaults
          return Promise.resolve({ ok: true, value: { opportunity: { ratio: 1.5, minAbsoluteDelta: 200 }, warning: { ratio: 3.0, minAbsoluteDelta: 800 }, critical: { ratio: 6.0, minAbsoluteDelta: 3000 }, minBaselineSamples: 5 } });
        },
        setWasteConfig: function(config) {
          // Waste thresholds are fixed in v0.36+; no-op
          return Promise.resolve({ ok: true, value: null });
        },
        getHistoricalStatus: function() {
          return ctx.connection.rpc.call('/token-analytics', 'get-historical-status', {});
        },
        loadHistorical: function(sessionId) {
          return ctx.connection.rpc.call('/token-analytics', 'load-historical', { sessionId: sessionId });
        },
        getCrossSessionSummary: function() {
          return ctx.connection.rpc.call('/token-analytics', 'get-cross-session-summary', {});
        },
        exportSession: function(sessionId, format) {
          return ctx.connection.rpc.call('/token-analytics', 'export-session', { sessionId: sessionId, format: format });
        },
        exportAll: function(format) {
          return ctx.connection.rpc.call('/token-analytics', 'export-all', { format: format });
        },
        exportSummary: function(format) {
          return ctx.connection.rpc.call('/token-analytics', 'export-summary', { format: format });
        }
      };

      // Immediate fetch
      console.log('[token-analytics-client] calling refreshFromRpc');
      refreshFromRpc();

      // SSE push channel (host -> browser)
      var eventSource = new EventSource('/ta-events');
      eventSource.addEventListener('report', function (e) {
        try {
          var d = JSON.parse(e.data);
          if (d.sessionId && rpcHandle) {
            rpcHandle.getReport(d.sessionId).then(function (r) {
              if (r && r.ok && r.value) {
                sessionReports[d.sessionId] = r.value;
                if (d.sessionId === selectedSessionId) notifyListeners();
              }
            });
          }
        } catch (_e) { /* ignore parse errors */ }
      });
      eventSource.addEventListener('sessions', function () {
        if (rpcHandle) refreshFromRpc();
        fetchCrossSessionSummary();
      });
      eventSource.addEventListener('historical-progress', function (e) {
        try {
          var d = JSON.parse(e.data);
          historicalProgress.total = d.total || 0;
          historicalProgress.restored = d.restored || 0;
          historicalProgress.complete = !!d.complete;
          notifyListeners();
        } catch (_e) { /* ignore */ }
      });
      eventSource.onerror = function () { /* EventSource auto-reconnects */ };

      var slotDisposer = ctx.slots.inject('settings.general.item', function () {
        return ctx.slots.register({
          name: 'settings.general.item',
          id: 'token-analytics-dashboard',
          order: 30,
          label: 'Token Analytics',
        }, ObservabilityDashboard);
      });

      // Start polling for same-tab saturation changes while the plugin is active
      lastKnownSaturation = getMySkinSaturation();
      startSaturationPolling();

      window.__DSH_TOKEN_ANALYTICS__ = {
        getSessions: function () { return sessionList.slice(); },
        getReport: function (sessionId) { return sessionId ? sessionReports[sessionId] || null : null; },
        getAllReports: function () { return Object.assign({}, sessionReports); },
        selectSession: function (sessionId) {
          selectedSessionId = sessionId;
          refreshFromRpc();
        },
        getSelectedSession: function () { return selectedSessionId; },
        refresh: function () { refreshFromRpc(); },
      };

      return function () {
        stopSaturationPolling();
        eventSource.close();
        rpcHandle = null;
        slotDisposer();
        window.removeEventListener('dsh:token-analytics:update', onUpdate);
        delete window.__DSH_TOKEN_ANALYTICS__;
      };
    }
    exports.apply = apply;

    return module.exports;
  },
});