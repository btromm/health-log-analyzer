# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian plugin that analyzes health logs from daily notes to identify associations between foods, behaviors, and symptoms. It uses natural language processing to parse multiple log formats and calculate co-occurrence correlations.

## Build Commands

```bash
# Install dependencies
npm install

# Development mode (watch for changes, auto-rebuild)
npm run dev

# Production build (type check + bundle)
npm run build

# Version bump (updates manifest.json and versions.json)
npm run version
```

## TypeScript Compilation

- The build process runs **type checking first** (`tsc -noEmit -skipLibCheck`) then bundles with esbuild
- If you see TypeScript errors during build, fix them in `main.ts` before the bundled `main.js` will be generated
- Common error: null type issues - add explicit null checks before using nullable variables
- Example: `if (remaining && currentCategory)` before passing to functions that expect non-null

## Plugin Architecture

### Core Parsing Strategy (Multi-Format)

The plugin uses a **priority-based parsing strategy** in `parseHealthLogContent()`:

1. **Narrative format** (highest priority): "Ate X, Y, Z — symptom after"
   - Parsed by `parseNarrativeEntry()`
   - Splits on temporal indicators (`—`, `--`, "after", "later")
   - Extracts foods after verbs ("ate", "had", "drank")
   - Identifies symptoms via keyword matching in later parts

2. **Category labels**: `Foods:`, `*Food*`, `Behaviors:`, `Symptoms:`
   - Regex: `/^[*_]?(Foods?|Behaviors?|Symptoms?)[*_]?[\s:]*(.*)$/i`
   - Sets `currentCategory` context for subsequent lines

3. **Inline labels**: `- Food: pizza`, `- Symptom: headache`
   - Line-by-line category detection

4. **Keyword inference** (fallback): `categorizeAndAddItem()`
   - Uses symptom keyword patterns
   - Behavior keyword patterns
   - Defaults to "food" if unclear

### Key Methods

**`parseNarrativeEntry(text: string)` (lines 280-337)**
- Most important parser for low-friction logging
- Returns `{foods, behaviors, symptoms}` or `null`
- Logic:
  1. Split on temporal separators regex
  2. First part: check for food verbs → extract with `extractItemList()`
  3. Later parts: check for symptom keywords
  4. Only returns if found foods/behaviors AND symptoms (or clear food pattern)

**`extractItemList(text: string)` (lines 339-352)**
- Handles comma-separated lists: "eggs, feta, and bread"
- Replaces "and" with commas, splits, cleans

**`analyzeAssociations(entries: HealthEntry[])` (lines 403-451)**
- Creates association map: item → Map<symptom, count>
- Tracks `totalOccurrences` of each food/behavior
- Links items to symptoms in **same-day entries only**
- Returns sorted by occurrence frequency

### Data Flow

```
TFile (daily note)
  → extractHealthLogSection() → raw content
  → parseHealthLogContent() → HealthEntry {foods, behaviors, symptoms}
  → analyzeAssociations() → Association[] {item, type, symptoms Map, totalOccurrences}
  → HealthLogResultsModal → UI display with percentages
```

### Settings System

Settings are stored in `HealthLogSettings` interface:
- `useDateRegex`: boolean - use regex vs tag detection
- `dateRegexPattern`: string - default `\d{4}-\d{2}-\d{2}`
- `dailyNoteTag`: string - default `#daily`
- `healthLogHeading`: string - default "Health log"

Modified via `HealthLogSettingTab` which extends `PluginSettingTab`.

## Migration Script (migrate-health-logs.py)

One-time migration tool to move consolidated health log to daily notes.

**Usage:**
```bash
python3 migrate-health-logs.py
```

**Behavior:**
- Reads `./Obsidian/Health log.md`
- Parses date markers: `- **YYYY-MM-DD**` or `- ****YYYY-MM-DD****`
- For each date:
  - If daily note exists AND has "## Health log" → skip
  - If daily note exists without health log → append section
  - If no daily note → create new file
- Outputs detailed log to `migration-log.txt`

**Important:** The script uses **append-only** logic - it never deletes or replaces content. Existing daily note content is preserved.

## Code Style Notes

- Clean items with `cleanItem()`: removes markdown formatting (`**`, `*`, bullets, numbers)
- Prevent duplicates: check `if (!array.includes(item))` before pushing
- Case-insensitive heading matching: `.toLowerCase()` comparisons
- Line numbers in comments reference `main.ts` for navigation

## Testing Approach

No automated tests currently. Manual testing workflow:

1. Create test daily notes in vault with different health log formats
2. Run plugin via ribbon icon or command palette
3. Verify modal shows correct associations and percentages
4. Check console for errors

Test formats to cover:
- Narrative: "Ate X — symptom after"
- Categories: `Foods:` / `Behaviors:` / `Symptoms:`
- Inline: `- Food: X`
- Mixed formats in single note
- Edge cases: no symptoms, no foods, empty sections

## Plugin Installation for Development

1. Copy or symlink this directory to `<vault>/.obsidian/plugins/health-log-analyzer/`
2. Run `npm install && npm run build`
3. Ensure `manifest.json`, `main.js`, and `styles.css` exist in plugin folder
4. Reload Obsidian
5. Enable plugin in Settings → Community Plugins

## Common Development Tasks

**Adding new symptom keywords:**
- Edit regex in `parseNarrativeEntry()` line 321
- Edit regex in `categorizeAndAddItem()` line 378

**Adding new food/behavior verbs:**
- Edit regex in `parseNarrativeEntry()` lines 300 (foods) and 309 (behaviors)

**Changing association calculation:**
- Modify `analyzeAssociations()` method
- Current: simple co-occurrence counting
- Potential: time-based windows, severity weighting

**Adding new log format support:**
- Add detection logic in `parseHealthLogContent()`
- Follow existing priority: try specific formats before falling back to keywords
- Return early if confident about format to avoid false categorization
