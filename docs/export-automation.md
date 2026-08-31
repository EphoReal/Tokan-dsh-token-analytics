# Export and Automated Regression Testing

## Export Functionality

### Data Formats

1. **JSON Export**: Complete report data with all attribution details
2. **CSV Export**: Tabular format for spreadsheet analysis
3. **Summary Export**: High-level metrics only

### Export Scope Options

1. **Current Session**: Export data for the selected session
2. **All Sessions**: Export data for all tracked sessions
3. **Cross-Session Summary**: Export aggregated data across sessions

### Export Data Structure

#### JSON Export Format
```json
{
  "metadata": {
    "exportDate": "2026-08-18T12:00:00Z",
    "pluginVersion": "0.11.0",
    "exportScope": "session"
  },
  "session": {
    "id": "session-123",
    "provider": "deepseek-official",
    "model": "deepseek-v3",
    "title": "Session Title"
  },
  "summary": {
    "totalTokens": 15000,
    "inputTokens": 12000,
    "outputTokens": 3000,
    "cacheRead": 5000,
    "cacheWrite": 1000,
    "totalCost": 0.025,
    "wasteCount": 3
  },
  "units": [
    {
      "unitId": "unit-1",
      "toolName": "bash",
      "attributedTokens": 2500,
      "attributedCost": 0.004,
      "allocationMethod": "PROPORTIONAL_TOKEN",
      "confidence": "HIGH"
    }
  ],
  "waste": {
    "events": [...],
    "config": {...}
  }
}
```

#### CSV Export Format
```csv
unitId,toolName,attributedTokens,attributedCost,allocationMethod,confidence,step,turn
unit-1,bash,2500,0.004,PROPORTIONAL_TOKEN,HIGH,2,1
unit-2,read_file,1800,0.003,PROPORTIONAL_TOKEN,HIGH,2,1
```

### API Endpoints

Add to RPC handler:

```javascript
// Export single session
if (endpoint === 'export-session') {
  const sid = payload && payload.sessionId;
  const format = payload && payload.format || 'json';
  const data = generateExport(sid, format);
  return { ok: true, value: data };
}

// Export all sessions
if (endpoint === 'export-all') {
  const format = payload && payload.format || 'json';
  const data = generateAllExport(format);
  return { ok: true, value: data };
}

// Export cross-session summary
if (endpoint === 'export-summary') {
  const format = payload && payload.format || 'json';
  const data = generateSummaryExport(format);
  return { ok: true, value: data };
}
```

## Automated Regression Testing

### Test Scenarios

1. **Attribution Accuracy**: Verify token allocation matches expected values
2. **Waste Detection**: Ensure thresholds correctly trigger events
3. **Cost Calculation**: Validate cost computation with known pricing
4. **Session Replay**: Test historical session reconstruction
5. **Tokenizer Integration**: Verify tokenizer-aware attribution

### Test Data

1. **Synthetic Sessions**: Pre-generated sessions with known outcomes
2. **Real Session Recordings**: Captured sessions for regression testing
3. **Edge Cases**: Empty sessions, single tool, many tools, etc.

### Test Implementation

```javascript
// Example regression test
describe('Token Analytics Regression', () => {
  it('should allocate tokens correctly for single tool', () => {
    const engine = createEngine({ tokenizer: { enabled: true } });
    const session = createSyntheticSession('single-tool');
    // ... test assertions
  });

  it('should detect waste events at correct thresholds', () => {
    const report = createSyntheticReport({ wasteEvents: 3 });
    const waste = detectWaste(report, { config: { contextSpikeRatio: 2 } });
    expect(waste.events.length).toBe(3);
  });
});
```

### Test Runner

1. **Unit Tests**: Vitest for individual components
2. **Integration Tests**: End-to-end with mock sessions
3. **Snapshot Tests**: Compare output against expected results

## Implementation Plan

### Phase 1: Export Functionality
1. Add export RPC endpoints
2. Implement JSON export generator
3. Implement CSV export generator
4. Add export UI controls

### Phase 2: Automated Testing
1. Create synthetic test data
2. Implement regression test suite
3. Add test runner integration
4. Document test procedures

### Phase 3: Integration
1. Connect export to UI
2. Add export progress indicators
3. Handle large data exports
4. Add export validation

## UI Controls

### Export Panel
- Format selector (JSON/CSV)
- Scope selector (Current/All/Summary)
- Export button with progress indicator
- Download trigger

### Settings
- Default export format
- Auto-export option
- Export location preference

## Performance Considerations

1. **Streaming Export**: For large datasets, stream data instead of loading all into memory
2. **Compression**: Add gzip compression for large exports
3. **Caching**: Cache export data for repeated downloads
4. **Background Processing**: Move heavy exports to background

## Security Considerations

1. **Data Sanitization**: Remove sensitive data from exports
2. **Access Control**: Limit export functionality to authorized users
3. **Audit Logging**: Log export activities
4. **Size Limits**: Prevent excessively large exports

## Success Metrics

1. **Export Speed**: <1s for single session, <5s for all sessions
2. **Data Accuracy**: 100% fidelity to original data
3. **Format Compliance**: Valid JSON/CSV output
4. **User Adoption**: Export used for analysis and reporting
