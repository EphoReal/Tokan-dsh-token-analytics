# Tokenizer-Aware Attribution Experiment

## Current Approach

The current AttributionEngine v0.6 uses **character-based proportional allocation** for multi-tool attribution:

1. Measures context character deltas before/after each tool result
2. Calculates proportional ratios based on character deltas
3. Allocates next-request tokens proportionally

**Limitations:**
- Character count ≠ token count (different tokenizers have different mappings)
- Unicode, code, and special characters tokenize differently
- Confidence is MEDIUM for proportional allocation (vs HIGH for direct)

## Proposed: Tokenizer-Aware Attribution

### Goal

Provide more accurate multi-tool attribution by using actual token counts instead of character proxies.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AttributionEngine v0.7                   │
├─────────────────────────────────────────────────────────────┤
│  Tokenizer Service (optional)                              │
│  ├── DeepSeek Tokenizer (default)                          │
│  ├── Generic BPE Tokenizer (fallback)                      │
│  └── Character Counter (legacy mode)                       │
├─────────────────────────────────────────────────────────────┤
│  Attribution Methods:                                      │
│  ├── DIRECT (single tool) — unchanged                     │
│  ├── PROPORTIONAL_TOKEN (multi-tool, tokenizer available)  │
│  └── PROPORTIONAL_CONTEXT (multi-tool, no tokenizer)       │
└─────────────────────────────────────────────────────────────┘
```

### New Attribution Method: PROPORTIONAL_TOKEN

When a tokenizer is available:
1. Count actual tokens in each tool result content
2. Use token counts for proportional allocation instead of character deltas
3. Potentially upgrade confidence from MEDIUM to HIGH

### Tokenizer Interface

```javascript
class TokenizerService {
  /**
   * Count tokens in text content
   * @param {string} text - The text to tokenize
   * @returns {number} - Number of tokens
   */
  countTokens(text) {
    throw new Error('Not implemented');
  }

  /**
   * Check if tokenizer is available and loaded
   * @returns {boolean}
   */
  isAvailable() {
    return false;
  }
}
```

### Implementation Options

#### Option 1: Built-in Lightweight Tokenizer
- Implement a simple BPE tokenizer in pure JavaScript
- Pros: No external dependencies, works offline
- Cons: May not perfectly match DeepSeek's tokenizer

#### Option 2: External Tokenizer Package
- Use `@deepseek-kit/tokenizer` or similar
- Pros: Accurate token counting
- Cons: Adds dependency, may have bundle size impact

#### Option 3: Hybrid Approach
- Use character-based estimation with tokenizer correction factor
- Pros: Fast, no dependency
- Cons: Less accurate than true tokenization

### Recommended Approach

**Option 3: Hybrid Approach** with optional tokenizer upgrade

1. Default: Character-based with correction factor (fast, no dependency)
2. Optional: Enable true tokenizer via configuration
3. Graceful fallback if tokenizer unavailable

### Configuration

```javascript
// Engine options
const engine = new AttributionEngine(ctx, session, {
  noListener: true,
  tokenizer: {
    enabled: true,           // Enable tokenizer-aware attribution
    type: 'auto',           // 'auto' | 'deepseek' | 'generic' | 'none'
    correctionFactor: 3.5,  // chars-per-token ratio for fallback
  }
});
```

### Confidence Upgrade Rules

| Method | Current Confidence | With Tokenizer | Condition |
|--------|-------------------|----------------|-----------|
| DIRECT | HIGH | HIGH | Unchanged |
| PROPORTIONAL_CONTEXT | MEDIUM | MEDIUM | No tokenizer |
| PROPORTIONAL_TOKEN | N/A | HIGH | Tokenizer available + reliable counts |

### Testing Strategy

1. **Unit Tests**: Token counting accuracy
2. **Comparison Tests**: Character-based vs token-based allocation
3. **Performance Tests**: Tokenizer overhead measurement
4. **Regression Tests**: Ensure existing behavior preserved when disabled

### Rollout Plan

1. **Phase 1**: Add tokenizer interface and configuration
2. **Phase 2**: Implement hybrid character/token approach
3. **Phase 3**: Add tokenizer selection and UI indicators
4. **Phase 4**: Performance optimization and documentation

### Open Questions

1. Should we bundle a tokenizer or make it optional?
2. How to handle tokenizer loading failures gracefully?
3. What's the acceptable performance overhead?
4. Should we cache tokenizer results?

### Metrics for Success

1. **Accuracy**: Token-based attribution should be ≥10% more accurate than character-based
2. **Performance**: Tokenizer overhead <50ms per tool result
3. **Confidence**: Higher confidence scores for proportional attribution
4. **User Trust**: Clear indicators showing tokenizer usage

## Next Steps

1. Prototype lightweight BPE tokenizer
2. Benchmark character vs token accuracy
3. Design configuration API
4. Implement in AttributionEngine v0.7
