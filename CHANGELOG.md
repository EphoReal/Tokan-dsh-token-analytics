# Changelog

## v0.37.1 - Real-time Saturation Sync Fix

### Problem

The saturation sync between my-skin and token-analytics only worked when reopening the settings panel. The `storage` event only fires in **other tabs/windows**, not the same tab, so dragging the saturation slider in the same tab didn't trigger a re-render.

### Solution

Added a low-frequency polling mechanism (100ms interval) that checks localStorage for saturation changes while the dashboard is active. This provides smooth, real-time color updates as the slider moves.

### Technical Details

- Added `startSaturationPolling()` / `stopSaturationPolling()` functions
- Polling starts when the plugin is applied and stops when disposed
- Only polls while the dashboard is mounted (zero cost when closed)
- 100ms interval provides smooth visual feedback without performance impact

---

## v0.37.0 - my-skin Saturation Sync

### New Feature

Token Analytics now synchronizes with my-skin's global saturation slider. When my-skin is installed, all thematic colors in the dashboard (severity indicators, chart bars, status badges, confidence levels) automatically adjust their saturation to match.

### How It Works

1. **Automatic Detection**: Token Analytics reads the saturation value from my-skin's localStorage (`my-skin:saturation`)
2. **Real-time Sync**: When the saturation slider changes, the dashboard re-renders with updated colors
3. **Graceful Fallback**: If my-skin is not installed, Token Analytics works normally with no saturation adjustment (factor = 1.0)

### Technical Details

- Added `adjustSaturation()` function (same HSL algorithm as my-skin)
- Added `palette()` function that returns colors with current saturation applied
- Added `storage` event listener for real-time synchronization
- All hardcoded colors replaced with dynamic palette references

### Color Coverage

The following elements now respond to saturation changes:
- Severity indicators (OPPORTUNITY/WARNING/CRITICAL)
- Chart colors (bar charts, donut charts)
- Status colors (cache hit rate, cost)
- Confidence level indicators (HIGH/MEDIUM/LOW)
- Token usage breakdown bars

### Compatibility

- ✅ Works with my-skin installed (syncs saturation)
- ✅ Works without my-skin (no adjustment, factor = 1.0)
- ✅ Backward compatible with existing configurations

---

## v0.35.1 - Friendly Reminder Tone

### Design Principles

核心原则：我们是在帮助用户发现可能值得注意的地方，而不是判断用户做错了。

### 主要修改

#### 1. 标题和状态（更友好的表达）

| 之前 | 之后 |
|------|------|
| 效率分析 | 优化提示 |
| 存在异常操作 / 🔴 | 发现一些明显不同于平常的操作 / 🔍 |
| 值得关注的操作 / 🟡 | 有一些操作值得看看 / 👀 |
| 存在优化空间 / 💡 | 发现一些优化空间 / 💡 |

#### 2. 百分比文案

| 之前 | 之后 |
|------|------|
| 19% 涉及优化信号的 token | 19% 的 Token 涉及优化提示 |

#### 3. Summary Line（自然中文）

| 之前 | 之后 |
|------|------|
| 14 个工具涉及 · 12,400 tokens · 15 个信号 | 涉及 14 个工具 · 12,400 Tokens · 15 个提示 |

#### 4. Recommendation（客观描述，不武断建议）

| 之前 | 之后 |
|------|------|
| 这次操作消耗的 Token 比平时多，可以尝试把任务拆得更小一些。 | 这次操作的 Token 使用量比本次会话的常见水平高一些。 |
| 这次操作消耗了较多 Token，可以检查任务是否可以更简单地完成。 | 这次操作的 Token 使用量明显高于本次会话的常见水平。 |
| 这次操作消耗了大量 Token，建议把任务拆成几个更小的步骤。 | 这次操作的 Token 使用量非常高。 |

#### 5. Info Tooltip（中英双语）

**关于优化提示：**
> 这个百分比表示与优化提示相关的 token 占比。这些 token 不一定是浪费的——某些操作可能是完成复杂任务所必需的。

**关于归因置信度：**
> 这表示分析结果的可信程度。置信度越高，结果越可靠。

**关于这些数字：**
> 涉及工具：触发优化提示的不同工具数量。
> 涉及 Token：这些工具消耗的 token 总量。
> 提示数：检测到的优化提示数量。

### 避免的措辞

| 避免使用 | 替换为 |
|----------|--------|
| 异常、错误 | 明显不同于平常 |
| 严重问题、警告 | 值得看看 |
| 浪费、低效 | 优化提示 |
| 应该、必须、建议 | 客观描述事实 |

---

## v0.35.0 - UX Wording Optimization

### Design Principles

1. **主 UI 使用中文**：避免中英混排造成的视觉拥挤
2. **Info Tooltip 使用中英双语**：解释技术概念时提供双语
3. **推荐文案客观化**：先描述事实，再给出温和建议
4. **避免武断建议**：不告诉用户"应该怎么做"
5. **保持 Signals ≠ Waste 定位**：信号不等于浪费

### 主要修改

#### 1. 状态标题（中文单语）

| 之前 | 之后 |
|------|------|
| No Significant Inefficiency Detected / 未检测到明显低效 | 使用模式正常 |
| Optimization Warnings / 优化提醒 | 值得关注的操作 |
| Optimization Opportunities / 优化建议 | 存在优化空间 |
| Critical Issues | 存在异常操作 |

#### 2. 百分比文案

| 之前 | 之后 |
|------|------|
| affected by signals | 涉及优化信号的 token |

#### 3. Summary Line

| 之前 | 之后 |
|------|------|
| 14 flagged tools · 12,400 tokens · 15 signals | 14 个工具涉及 · 12,400 tokens · 15 个信号 |

#### 4. Recommendation 文案（客观化）

**之前（武断建议）：**
- "这次操作消耗的 Token 比平时多，可以尝试把任务拆得更小一些。"

**之后（客观描述）：**
- "这次操作消耗的 Token 高于常见水平。"

#### 5. Info Tooltip（中英双语）

**About Optimization Signals:**
> 这个百分比表示与优化信号相关的 token 占比。这些 token 不一定是浪费的——某些操作可能是完成复杂任务所必需的。

**About Attribution Confidence:**
> 这表示 Token Analytics 对 token 归因结果的可信程度。置信度越高，分析结果越可靠。

**About These Numbers:**
> 涉及工具：触发优化信号的不同工具数量。
> 涉及 Token：这些工具消耗的 token 总量。
> 信号数：检测到的优化信号数量。

### 完整 Recommendation 列表

| Severity | Type | 推荐 |
|----------|------|------|
| OPPORTUNITY | Context | 这次操作读取的内容量高于常见水平。 |
| OPPORTUNITY | Token | 这次操作消耗的 Token 高于常见水平。 |
| OPPORTUNITY | Cost | 这次操作的成本高于常见水平。 |
| OPPORTUNITY | Duplicate | 检测到与之前相似的操作。 |
| WARNING | Context | 这次操作读取了较多内容。 |
| WARNING | Token | 这次操作消耗了较多 Token。 |
| WARNING | Cost | 这次操作的成本较高。 |
| WARNING | Duplicate | 检测到重复操作。 |
| CRITICAL | Context | 这次操作读取了异常多的内容。 |
| CRITICAL | Token | 这次操作消耗了大量 Token。 |
| CRITICAL | Cost | 这次操作的成本异常高。 |
| CRITICAL | Duplicate | 检测到多次重复操作。 |

---

## v0.34.2 - Bilingual Recommendations

### Changes

All Optimization Signals recommendations are now bilingual (Chinese first, English second).

#### Status Titles

| Status | Display |
|--------|---------|
| No signals | "未检测到明显低效 / No Significant Inefficiency Detected" |
| OPPORTUNITY only | "优化建议 / Optimization Opportunities" |
| Has WARNING | "优化提醒 / Optimization Warnings" |
| Has CRITICAL | "需要关注的问题 / Critical Issues" |

#### Recommendations by Severity and Type

**CRITICAL:**

| Type | Recommendation |
|------|----------------|
| Context Growth | 这次操作产生了异常多的内容，建议检查提示词或读取范围是否过大。<br>This operation produced an unusually large amount of content. Check whether the prompt or reading scope is too large. |
| Token Usage | 这次操作消耗了大量 Token，建议把任务拆成几个更小的步骤。<br>This operation used a very large number of tokens. Consider breaking the task into smaller steps. |
| Cost | 这次操作成本异常高，建议检查是否可以优化。<br>This operation had unusually high cost. Consider optimization. |
| Duplicate | 检测到多次重复操作，建议检查使用模式。<br>Multiple duplicate operations detected. Review usage patterns. |

**WARNING:**

| Type | Recommendation |
|------|----------------|
| Context Growth | 这次操作产生了较多内容，可以检查是否读取了不必要的信息。<br>This operation produced a large amount of content. Check whether some of it was unnecessary. |
| Token Usage | 这次操作消耗了较多 Token，可以检查任务是否可以更简单地完成。<br>This operation used a large number of tokens. Check whether the task could be completed more simply. |
| Cost | 这次操作成本较高，可以检查是否有可以优化的地方。<br>This operation had high cost. Check whether there are optimization opportunities. |
| Duplicate | 检测到重复操作，建议避免重复请求。<br>Duplicate operations detected. Consider avoiding repeated requests. |

**OPPORTUNITY:**

| Type | Recommendation |
|------|----------------|
| Context Growth | 提示词可以更具体一些，减少不必要的内容读取。<br>Try making your prompt more specific to avoid reading unnecessary content. |
| Token Usage | 这次操作消耗的 Token 比平时多，可以尝试把任务拆得更小一些。<br>This operation used more tokens than usual. Try breaking the task into smaller steps. |
| Cost | 类似请求可以尽量复用已有上下文，减少重复消耗。<br>Reuse existing context when possible to avoid unnecessary repeated usage. |
| Duplicate | 可以考虑复用之前的结果，避免重复请求。<br>Consider reusing previous results to avoid repeated requests. |

#### Design Principles

1. **面向普通用户**: 不使用技术术语 (baseline, anomaly, context growth)
2. **双语显示**: 中文在前，英文在后，语义一致
3. **可操作性**: 直接回答"发生了什么"和"我可以做什么"
4. **温和表达**: 使用"可以尝试""建议检查"等自然表达

---

## v0.34.1 - User Understandability Optimization

### Changes

#### 1. Tool Names → User-Friendly Display Names

Internal tool names are now converted to user-friendly names:

| Internal Name | Display Name |
|---------------|--------------|
| read_file | File Reading |
| write_file | File Writing |
| edit | File Editing |
| bash / pwsh | Shell Command |
| glob | File Search |
| grep | Content Search |
| code_analysis | Code Analysis |
| search | Search |

Original internal names shown in tooltip on hover.

#### 2. Attribution Confidence Info Tooltip

Added info tooltip explaining:
- **HIGH**: Direct attribution with exact pairing
- **MEDIUM**: Estimated from context (multi-tool steps)
- **LOW**: Could not be reliably attributed

#### 3. Optimization Signals Clarification

Updated info tooltip to explicitly state:
- "These are not necessarily wasted tokens"
- "Some operations may be necessary for complex tasks"
- "Signals help identify operations that might benefit from optimization, but they are not definitive indicators of waste"

#### 4. Percentage Text Update

Changed "of session tokens" → "affected by signals" to avoid implying these tokens are waste.

---

## v0.33.1 - Severity Threshold Recalibration

### Problem

CRITICAL signals 过多（真实 session 中有 23 个 CRITICAL）。诊断发现：
- Small operations (edit, search) 建立低 baseline (~130 tokens)
- Large operations (read_file, code_analysis) 被拿去和低 baseline 比较
- 正常的大型操作被误判为 CRITICAL

### Root Cause

混合 baseline 问题：不同 tool 类型的 token 分布差异很大，但 baseline 混在一起计算。

### Fix

提高 WARNING 和 CRITICAL 的 minAbsoluteDelta：

```javascript
warning: {
  ratio: 3.0,
  minAbsoluteDelta: 800,  // 从 500 提高到 800
}
critical: {
  ratio: 6.0,
  minAbsoluteDelta: 3000, // 从 2000 提高到 3000
}
```

### Effect (Diagnostic Session)

| Metric | Before | After |
|--------|--------|-------|
| OPPORTUNITY | 11 | 18 |
| WARNING | 23 | 22 |
| CRITICAL | 8 | **0** |

### Design Principle

- **OPPORTUNITY**: 可以关注（轻度偏离）
- **WARNING**: 明显值得检查（需要较大绝对差异）
- **CRITICAL**: 真正罕见且严重（需要极大绝对差异）

---

## v0.33.0 - Recalibrated Optimization Signals

### Problem Solved

v0.32 修复了数据传递问题，但导致 WARNING/CRITICAL 过多（200+ flagged tools, 100+ warnings）。需要重新校准以提高信号质量。

### Core Changes

#### 1. 移除用户自定义 Threshold

**Before**: 用户可以通过 Settings 调整 Low/Medium/High 灵敏度
**After**: 使用固定、统一的内部标准

移除的 UI 组件：
- `WasteConfigPanel`
- `sensitivityPresets`
- `wasteConfigDefaults`
- `getSensitivityLevel()`

#### 2. 重新定义 Severity 规则

| Severity | Ratio | Min Absolute Delta | 说明 |
|----------|-------|-------------------|------|
| INFO | < 1.5x | < 200 | 正常波动，不显示 |
| OPPORTUNITY | ≥ 1.5x | ≥ 200 | 轻度偏离，可能值得关注 |
| WARNING | ≥ 3.0x | ≥ 500 | 明显异常，应当较少出现 |
| CRITICAL | ≥ 6.0x | ≥ 1000 | 极端异常，只用于罕见大幅异常 |

**关键改进**: 需要同时满足 ratio 和 absolute delta 两个条件才触发

#### 3. 避免连续重复报警

如果相邻 2 个 unit 因同一种正常增长模式触发 signal，跳过后续重复报警。

#### 4. Cost Anomaly 降级

- 如果 TOKEN_ANOMALY 已触发，COST_ANOMALY 不生成独立 signal
- 只有存在明显独立的 cost 异常时才单独出现

#### 5. Status 文案修正

| 情况 | 显示 |
|------|------|
| 无 signal | "No Significant Inefficiency Detected" |
| 只有 OPPORTUNITY | "Optimization Opportunities" |
| 有 WARNING | "Optimization Warnings" |
| 有 CRITICAL | "Critical Issues" |

#### 6. Recommendation 改进

- 无 signal 时不显示 generic recommendation
- 有 signal 时根据 dominant type 生成具体建议
- 不再对所有 session 显示相同文案

### Fixed Thresholds

```javascript
THRESHOLDS = {
  opportunity: { ratio: 1.5, minAbsoluteDelta: 200 },
  warning: { ratio: 3.0, minAbsoluteDelta: 500 },
  critical: { ratio: 6.0, minAbsoluteDelta: 1000 },
  minBaselineSamples: 5,
}
```

### Before vs After (Typical Session)

| Metric | v0.32 | v0.33 |
|--------|-------|-------|
| Normal session signals | 10-20 | 0-2 |
| WARNING count | 10+ | 0-1 |
| CRITICAL count | 5+ | 0-1 |
| Signal quality | Low (too many) | High (meaningful) |

### Tests

26 tests covering:
- Fixed threshold values
- Normal session minimal signals
- Small/large/extreme spikes
- High ratio + low absolute = no signal
- Consecutive duplicate suppression
- Unique token counting
- Empty/short sessions
- Severity distribution

---

## v0.32.0 - Fix Optimization Signals Aggregation

### Root Cause

`report.js` was stripping waste event fields when building the observability report:

```javascript
// BEFORE (broken) - only passed partial fields
waste: {
  events: wasteEvents.map(function (ev) {
    return {
      type: ev.type, severity: ev.severity, unitId: ev.unitId,
      toolName: ev.toolName, message: ev.message, evidence: ev.evidence,
    };
  }),
}
```

This caused:
- `tokens` field missing from events
- `flaggedUnits` not passed through
- `totalFlaggedTokens` not passed through
- `severityTokenMap` not passed through

### Fix

Pass through ALL waste detector output fields:

```javascript
// AFTER (fixed) - passes complete data
waste: {
  events: wasteEvents,
  flaggedUnits: input.waste.flaggedUnits || [],
  totalFlaggedTokens: input.waste.totalFlaggedTokens || 0,
  typeTokenMap: input.waste.typeTokenMap || {},
  typeCountMap: input.waste.typeCountMap || {},
  severityTokenMap: input.waste.severityTokenMap || {},
  severityCountMap: input.waste.severityCountMap || {},
}
```

### Before vs After

| Metric | Before | After |
|--------|--------|-------|
| signals | 32 | 32 |
| flagged tools | 0 | 8 |
| tokens | 0 | 12,400 |
| percentage | 0% | 15% |

### Tests

23 tests covering:
- Single/multiple OPPORTUNITY events
- WARNING/CRITICAL accumulation
- No double-counting
- Signal > 0 → tokens > 0
- Empty state
- Event field completeness

---

## v0.31.0 - Optimization Signals (Solves 0% Issue)

### Problem Solved

Previous versions showed "0%" in almost all real sessions because:
- Threshold (2.0x) filtered 99% of events
- P95 ratio was only 1.58x, far below threshold
- Normal operations are highly consistent

### Core Changes

#### 1. New Severity Level: OPPORTUNITY

Added intermediate severity between INFO and WARNING:

| Severity | Threshold | Meaning |
|----------|-----------|---------|
| INFO | < 1.25x | Normal operation |
| **OPPORTUNITY** | 1.25x - 2.0x | Potential optimization signal |
| WARNING | 2.0x - 5.0x | Anomaly detected |
| CRITICAL | ≥ 5.0x | Extreme anomaly |

**OPPORTUNITY** uses wording like "Potential optimization opportunity" — never claims confirmed waste.

#### 2. Renamed: Waste → Optimization Signals

- UI: "Efficiency Analysis" → "Optimization Signals"
- Subtitle: "potentially wasteful" → "of session tokens"
- Empty state: "No Significant Inefficiency Detected"
- Info tooltip explains signals are not necessarily waste

#### 3. Severity-Based Token Mapping

New data structure tracks tokens by severity:
```javascript
severityTokenMap: {
  OPPORTUNITY: 1200,  // tokens from opportunity-level signals
  WARNING: 500,       // tokens from warning-level signals
  CRITICAL: 0,        // tokens from critical signals
}
```

#### 4. Improved Recommendation Logic

Recommendations now consider:
1. Highest severity (CRITICAL > WARNING > OPPORTUNITY)
2. Dominant detection type
3. Available evidence

| Severity | Recommendation Style |
|----------|---------------------|
| OPPORTUNITY | "Potential optimization: consider..." |
| WARNING | "An unusually large... detected. Review..." |
| CRITICAL | "An extreme... detected. Review for..." |

#### 5. Cost Anomaly as Supporting Evidence

- If TOKEN_ANOMALY exists for a unit, COST_ANOMALY is not added separately
- Prevents double-counting of the same token volume
- Cost Anomaly only stands alone when not correlated with Token Anomaly

#### 6. Enhanced Event Details

Each event now shows:
- Severity badge with color coding
- Primary detection type
- Supporting detections (if any)
- Evidence with ratio and baseline
- Possible cause (non-definitive wording)
- Recommendation (severity-appropriate)

### Data Structure (v0.9)

```javascript
{
  engine: 'dsh-waste-detector',
  version: 'v0.9',
  config: {
    contextOpportunityRatio: 1.25,  // NEW
    tokenOpportunityRatio: 1.25,    // NEW
    costOpportunityRatio: 1.25,     // NEW
    contextSpikeRatio: 2,           // WARNING threshold
    tokenAnomalyRatio: 2,
    costAnomalyRatio: 2,
    contextCriticalRatio: 5,        // CRITICAL threshold
    tokenCriticalRatio: 5,
    costCriticalRatio: 5,
    minBaselineSamples: 3,
  },
  flaggedUnits: [...],
  events: [...],
  typeTokenMap: {...},
  typeCountMap: {...},
  severityTokenMap: { OPPORTUNITY: N, WARNING: N, CRITICAL: N },
  severityCountMap: { OPPORTUNITY: N, WARNING: N, CRITICAL: N },
  totalFlaggedTokens: number,
}
```

### Tests

19 test scenarios covering:
- Ratio thresholds (INFO, OPPORTUNITY, WARNING, CRITICAL)
- Double-counting prevention
- Baseline sample requirements
- Current unit isolation
- OPPORTUNITY wording
- Empty states
- Severity token mapping

### Comparison: v0.8 vs v0.9

| Metric | v0.8 | v0.9 |
|--------|------|------|
| Detection rate | 1.0% | ~27% (OPPORTUNITY) |
| Threshold | 2.0x fixed | 1.25x / 2.0x / 5.0x |
| Severity levels | 3 (INFO, WARNING, CRITICAL) | 4 (+ OPPORTUNITY) |
| UI label | "Efficiency Analysis" | "Optimization Signals" |
| Empty state | "All Clear" | "No Significant Inefficiency" |

### Compatibility

- ✅ All existing features unchanged
- ✅ Sensitivity presets work with new thresholds
- ✅ Historical replay uses same logic
- ✅ Export includes new severity data
