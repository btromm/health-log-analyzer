# Changelog

## Version 1.0.0

### New Features

#### Narrative Format Support
The plugin now supports a low-friction narrative format that makes logging effortless:

```markdown
## Health log
- Ate eggs, feta, dried mango, bread, and pistachios — migraine symptoms 30min later
- Had coffee — headache after
- Exercised for 30 minutes — felt great
```

**How it works:**
- Detects food consumption verbs: "ate", "had", "drank", "consumed", "eating", "drinking"
- Extracts comma-separated food lists, handling "and" gracefully
- Identifies temporal separators: `—`, `--`, `-`, "after", "later", "then", "followed by"
- Recognizes symptom keywords in the outcome portion
- Links foods/behaviors to symptoms that appear in the same entry

#### Enhanced Symptom Detection
Expanded symptom keyword detection to include:
- migraine, sore throat, reflux, malaise
- bloating, discomfort, joint pain
- acid reflux, stomach pain
- and many more common symptoms

#### Backward Compatibility
All existing formats continue to work:
- Categorized lists (Foods:, Behaviors:, Symptoms:)
- Inline categories (- Food: X)
- Italic category headers (*Foods*)
- Free-form text with keyword detection

### Technical Changes

**New Methods:**
- `parseNarrativeEntry()` - Parses narrative format entries
- `extractItemList()` - Extracts comma-separated food items

**Enhanced Methods:**
- `parseHealthLogContent()` - Now tries narrative parsing first for list items
- `categorizeAndAddItem()` - Expanded symptom and behavior keyword patterns
- Category label regex now supports italic markers (`*Food*`)

**Supported Temporal Indicators:**
- Em dash: `—`
- En dash: `–`
- Hyphen: `-`, `--`, `---`
- Words: "after", "afterward", "later", "then", "followed by", "resulting in", "caused", "led to"

**Supported Food Verbs:**
- ate, had, consumed, drank
- eating, drinking, ingested

**Supported Behavior Verbs:**
- exercised, worked out, slept, ran, walked
- meditated, yoga, stressed, climbed
- hiit, lifted, cycled, swam

### Documentation Updates
- README now features narrative format as Format 1 (recommended)
- Settings tab shows narrative format example first
- Added `example-narrative-format.md` demonstrating usage
- Updated QUICKSTART guide

### Usage Tips

**Best practices for narrative format:**
1. Use clear separators (em dash `—` works best)
2. List foods with commas: "eggs, feta, bread"
3. Use "and" before the last item naturally: "eggs, feta, and bread"
4. Include temporal context: "30min later", "after", "2 hours later"
5. Be specific with symptoms: "migraine symptoms" vs just "pain"

**Example patterns that work well:**
```markdown
- Ate X — symptom later
- Had X and Y — symptom after
- Drank X — symptom 30min later
- Exercised for X minutes — felt great
```

## Future Enhancements

Potential improvements for future versions:
- Multi-day symptom tracking (symptoms that appear the next day)
- Severity scoring based on descriptive words
- Time-of-day analysis (morning vs evening symptoms)
- Export analysis results to CSV/JSON
- Visualization graphs and charts
- Custom synonym support for foods (e.g., "java" = "coffee")
