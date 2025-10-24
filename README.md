# Health Log Analyzer

An Obsidian plugin that analyzes health logs from your daily notes to identify associations between foods, behaviors, and symptoms.

## Features

- Automatically finds daily notes using either:
  - Date regex pattern (e.g., YYYY-MM-DD)
  - Custom tags (e.g., #daily)
- Extracts health log information from a specific heading
- Parses foods, behaviors, and symptoms
- Identifies associations between items and symptoms
- Shows correlation percentages
- Clean, easy-to-read results modal

## Installation

### Manual Installation

1. Copy the `health-log-plugin` folder to your vault's `.obsidian/plugins/` directory
2. Make sure the folder contains `manifest.json`, `main.js`, and `styles.css`
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

### Development Installation

1. Clone this repository into your vault's `.obsidian/plugins/` directory
2. Run `npm install` to install dependencies
3. Run `npm run dev` to start compilation in watch mode
4. Reload Obsidian
5. Enable the plugin in Settings → Community Plugins

## Usage

### Setting Up Your Daily Notes

Add a "Health log" section to your daily notes. The plugin supports multiple formats:

#### Format 1: Narrative Format (Recommended for Low Friction)

The easiest way to log - just describe what you ate/did and what happened:

\`\`\`markdown
## Health log
- Ate eggs, feta, dried mango, bread, and pistachios — migraine symptoms 30min later
- Had coffee — headache after
- Exercised for 30 minutes — felt great
- Drank milk — stomach bloating 2 hours later
\`\`\`

The plugin automatically detects:
- **Foods** after verbs like "ate", "had", "drank", "consumed"
- **Symptoms** after separators like `—`, `-`, "after", "later"
- **Behaviors** like "exercised", "ran", "slept", etc.

#### Format 2: Categorized Lists

\`\`\`markdown
## Health log

Foods:
- Pizza
- Coffee with milk
- Dark chocolate

Behaviors:
- Exercised for 30 minutes
- High stress at work
- Only slept 5 hours

Symptoms:
- Stomach pain (moderate)
- Headache in afternoon
\`\`\`

#### Format 3: Inline Categories

\`\`\`markdown
## Health log

- Food: Pizza
- Food: Coffee with milk
- Behavior: Exercised for 30 minutes
- Behavior: High stress
- Symptom: Stomach pain
- Symptom: Headache
\`\`\`

#### Format 4: Free-form Text

\`\`\`markdown
## Health log

Ate pizza and coffee for lunch. Did a 30-minute workout in the morning.
Felt stomach pain in the afternoon and had a headache.
\`\`\`

Note: Free-form text uses keyword detection and may not be as accurate as the narrative format with clear separators.

### Running the Analysis

1. Click the activity icon in the left ribbon, or
2. Open Command Palette (Cmd/Ctrl + P) and search for "Analyze health logs"

The plugin will:
- Find all your daily notes
- Extract health log sections
- Parse foods, behaviors, and symptoms
- Calculate associations and show results in a modal

### Understanding the Results

The results modal shows:
- Total number of entries analyzed
- Unique counts of foods, behaviors, and symptoms
- For each food/behavior:
  - How many times it was logged
  - Which symptoms appeared alongside it
  - The correlation percentage (how often that symptom occurred when the item was present)

Example result:
```
Coffee (food)
Logged 15 times
- Headache: 8/15 times (53.3%)
- Anxiety: 5/15 times (33.3%)
```

This means coffee appeared in 15 health logs, and 8 of those times you also noted a headache.

## Configuration

Go to Settings → Health Log Analyzer to configure:

- **Detection method**: Choose between date regex or tag-based note detection
- **Date regex pattern**: Customize the pattern to match your daily note naming convention
- **Daily note tag**: Specify which tag identifies daily notes (if using tag detection)
- **Health log heading**: Change the heading name the plugin looks for (default: "Health log")

## Tips

1. **Be consistent**: Use the same format across all your daily notes for best results
2. **Be specific**: "Stomach pain after lunch" is more helpful than just "pain"
3. **Track regularly**: The more data you have, the better the associations
4. **Include null data**: Note when you DON'T have symptoms too - this helps identify patterns
5. **Use subheadings**: You can organize your health log with subheadings, and the plugin will still find it

## Limitations

- Associations are based on co-occurrence, not causation
- The plugin analyzes same-day associations only
- Free-form text parsing may miscategorize items
- Results should be used as insights, not medical advice

## Development

### Building the Plugin

```bash
# Install dependencies
npm install

# Development mode (watch for changes)
npm run dev

# Production build
npm run build
```

### File Structure

- `main.ts` - Plugin source code
- `manifest.json` - Plugin metadata
- `styles.css` - Custom styles
- `package.json` - Dependencies
- `tsconfig.json` - TypeScript configuration
- `esbuild.config.mjs` - Build configuration

## License

MIT

## Support

If you find this plugin helpful, consider:
- Reporting issues on GitHub
- Contributing improvements
- Sharing with others who might benefit

## Disclaimer

This plugin is for informational purposes only and is not a substitute for professional medical advice, diagnosis, or treatment.
