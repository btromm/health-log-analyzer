import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, Modal } from 'obsidian';

interface HealthLogSettings {
	dailyNoteTag: string;
	useDateRegex: boolean;
	dateRegexPattern: string;
	healthLogHeading: string;
}

const DEFAULT_SETTINGS: HealthLogSettings = {
	dailyNoteTag: '#daily',
	useDateRegex: true,
	dateRegexPattern: '\\d{4}-\\d{2}-\\d{2}',
	healthLogHeading: 'Health log'
}

interface HealthEntry {
	date: string;
	fileName: string;
	foods: string[];
	behaviors: string[];
	symptoms: string[];
	rawContent: string;
}

interface Association {
	item: string;
	type: 'food' | 'behavior';
	symptoms: Map<string, number>;
	totalOccurrences: number;
}

export default class HealthLogAnalyzerPlugin extends Plugin {
	settings: HealthLogSettings;

	async onload() {
		await this.loadSettings();

		// Add ribbon icon
		this.addRibbonIcon('activity', 'Analyze Health Logs', () => {
			this.analyzeHealthLogs();
		});

		// Add command
		this.addCommand({
			id: 'analyze-health-logs',
			name: 'Analyze health logs',
			callback: () => {
				this.analyzeHealthLogs();
			}
		});

		// Add settings tab
		this.addSettingTab(new HealthLogSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async analyzeHealthLogs() {
		try {
			new Notice('Analyzing health logs...');

			// Find all daily notes
			const dailyNotes = await this.findDailyNotes();

			if (dailyNotes.length === 0) {
				new Notice('No daily notes found!');
				return;
			}

			// Extract health log entries
			const healthEntries = await this.extractHealthEntries(dailyNotes);

			if (healthEntries.length === 0) {
				new Notice(`No "${this.settings.healthLogHeading}" sections found in daily notes!`);
				return;
			}

			// Analyze associations
			const associations = this.analyzeAssociations(healthEntries);

			// Display results
			new HealthLogResultsModal(this.app, healthEntries, associations).open();

		} catch (error) {
			console.error('Error analyzing health logs:', error);
			new Notice('Error analyzing health logs. Check console for details.');
		}
	}

	async findDailyNotes(): Promise<TFile[]> {
		const files = this.app.vault.getMarkdownFiles();
		const dailyNotes: TFile[] = [];

		for (const file of files) {
			if (this.settings.useDateRegex) {
				// Match files by date regex pattern
				const regex = new RegExp(this.settings.dateRegexPattern);
				if (regex.test(file.basename)) {
					dailyNotes.push(file);
				}
			} else {
				// Match files by tag
				const cache = this.app.metadataCache.getFileCache(file);
				if (cache?.tags?.some(tag => tag.tag === this.settings.dailyNoteTag)) {
					dailyNotes.push(file);
				}
			}
		}

		return dailyNotes.sort((a, b) => a.basename.localeCompare(b.basename));
	}

	async extractHealthEntries(files: TFile[]): Promise<HealthEntry[]> {
		const entries: HealthEntry[] = [];

		for (const file of files) {
			const content = await this.app.vault.read(file);
			const healthLogContent = this.extractHealthLogSection(content);

			if (healthLogContent) {
				const entry = this.parseHealthLogContent(healthLogContent, file);
				if (entry) {
					entries.push(entry);
				}
			}
		}

		return entries;
	}

	extractHealthLogSection(content: string): string | null {
		// Find the health log heading and extract content until next heading of same or higher level
		const lines = content.split('\n');
		let inHealthLog = false;
		let healthLogLines: string[] = [];
		let headingLevel = 0;

		for (const line of lines) {
			// Check if this is a heading
			const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

			if (headingMatch) {
				const level = headingMatch[1].length;
				const title = headingMatch[2].trim();

				if (title.toLowerCase() === this.settings.healthLogHeading.toLowerCase()) {
					inHealthLog = true;
					headingLevel = level;
					continue;
				} else if (inHealthLog && level <= headingLevel) {
					// We've hit another heading of the same or higher level, stop
					break;
				}
			}

			if (inHealthLog) {
				healthLogLines.push(line);
			}
		}

		return healthLogLines.length > 0 ? healthLogLines.join('\n') : null;
	}

	parseHealthLogContent(content: string, file: TFile): HealthEntry | null {
		const foods: string[] = [];
		const behaviors: string[] = [];
		const symptoms: string[] = [];

		// Parse different formats:
		// - Narrative format: "Ate X, Y, Z — symptom later"
		// - Lists (bullet points, numbered)
		// - Labeled items (Food:, Behavior:, Symptom:)
		// - Free text (we'll try to categorize)

		const lines = content.split('\n');
		let currentCategory: 'food' | 'behavior' | 'symptom' | null = null;

		for (let line of lines) {
			line = line.trim();
			if (!line) continue;

			// Check for category labels (including italic markers)
			const categoryMatch = line.match(/^[*_]?(Foods?|Behaviors?|Symptoms?)[*_]?[\s:]*(.*)$/i);
			if (categoryMatch) {
				const category = categoryMatch[1].toLowerCase();
				if (category.startsWith('food')) currentCategory = 'food';
				else if (category.startsWith('behavior')) currentCategory = 'behavior';
				else if (category.startsWith('symptom')) currentCategory = 'symptom';

				// If there's content after the colon, process it
				const remaining = categoryMatch[2].trim();
				if (remaining && currentCategory) {
					this.addItem(remaining, currentCategory, foods, behaviors, symptoms);
				}
				continue;
			}

			// Check for list items
			const listMatch = line.match(/^[-*+]\s+(.+)$/) || line.match(/^\d+\.\s+(.+)$/);
			if (listMatch) {
				const item = listMatch[1].trim();

				// First, try to parse as narrative format (e.g., "Ate X, Y — symptom")
				const narrativeResult = this.parseNarrativeEntry(item);
				if (narrativeResult) {
					narrativeResult.foods.forEach(f => {
						if (!foods.includes(f)) foods.push(f);
					});
					narrativeResult.behaviors.forEach(b => {
						if (!behaviors.includes(b)) behaviors.push(b);
					});
					narrativeResult.symptoms.forEach(s => {
						if (!symptoms.includes(s)) symptoms.push(s);
					});
					continue;
				}

				// Check if item has inline category
				const inlineCategoryMatch = item.match(/^(food|behavior|symptom)[\s:]+(.+)$/i);
				if (inlineCategoryMatch) {
					const cat = inlineCategoryMatch[1].toLowerCase() as 'food' | 'behavior' | 'symptom';
					this.addItem(inlineCategoryMatch[2].trim(), cat, foods, behaviors, symptoms);
				} else if (currentCategory) {
					this.addItem(item, currentCategory, foods, behaviors, symptoms);
				} else {
					// Try to infer category from keywords
					this.categorizeAndAddItem(item, foods, behaviors, symptoms);
				}
				continue;
			}

			// Handle comma-separated lists
			if (currentCategory && line.includes(',')) {
				const items = line.split(',').map(s => s.trim()).filter(s => s);
				items.forEach(item => this.addItem(item, currentCategory!, foods, behaviors, symptoms));
				continue;
			}

			// Plain text line - try narrative parsing first
			const narrativeResult = this.parseNarrativeEntry(line);
			if (narrativeResult) {
				narrativeResult.foods.forEach(f => {
					if (!foods.includes(f)) foods.push(f);
				});
				narrativeResult.behaviors.forEach(b => {
					if (!behaviors.includes(b)) behaviors.push(b);
				});
				narrativeResult.symptoms.forEach(s => {
					if (!symptoms.includes(s)) symptoms.push(s);
				});
			} else if (currentCategory) {
				this.addItem(line, currentCategory, foods, behaviors, symptoms);
			} else {
				this.categorizeAndAddItem(line, foods, behaviors, symptoms);
			}
		}

		// Only return entry if we found at least something
		if (foods.length === 0 && behaviors.length === 0 && symptoms.length === 0) {
			return null;
		}

		return {
			date: file.basename,
			fileName: file.path,
			foods,
			behaviors,
			symptoms,
			rawContent: content
		};
	}

	parseNarrativeEntry(text: string): { foods: string[], behaviors: string[], symptoms: string[] } | null {
		// Parse narrative format like:
		// "Ate eggs, feta, dried mango, bread, and pistachios — migraine symptoms 30min later"
		// "Had coffee — headache after"
		// "Exercised for 30 minutes — felt great"

		const foods: string[] = [];
		const behaviors: string[] = [];
		const symptoms: string[] = [];

		// Split on temporal indicators that separate cause from effect
		const separators = /\s*[—–-]{1,3}\s*|\s+(?:then|after(?:ward)?|later|followed by|resulting in|caused|led to)\s+/i;
		const parts = text.split(separators);

		if (parts.length === 0) return null;

		// First part: usually contains foods/behaviors
		const firstPart = parts[0].trim();

		// Check for food consumption verbs
		const foodVerbMatch = firstPart.match(/^(?:ate|had|consumed|drank|eating|drinking|ingested)\s+(.+)/i);
		if (foodVerbMatch) {
			// Extract food items from the list
			const foodList = foodVerbMatch[1];
			const extractedFoods = this.extractItemList(foodList);
			foods.push(...extractedFoods);
		}

		// Check for behavior/activity verbs
		const behaviorVerbMatch = firstPart.match(/^(?:exercised|worked out|slept|ran|walked|meditated|yoga|stressed|climbed|hiit|lifted|cycled|swam)\s*(?:for)?\s*(.+)/i);
		if (behaviorVerbMatch) {
			behaviors.push(this.cleanItem(firstPart));
		}

		// If we have multiple parts, the later parts likely contain symptoms/effects
		if (parts.length > 1) {
			for (let i = 1; i < parts.length; i++) {
				const part = parts[i].trim();
				if (!part) continue;

				// Check if this part contains symptom keywords
				const symptomKeywords = /\b(pain|ache|nausea|tired|fatigue|bloat|bloating|cramp|rash|itch|headache|migraine|dizzy|dizziness|swelling|sore|throat|reflux|discomfort|malaise|joint|stomach|acid|sick|ill)\b/i;

				if (symptomKeywords.test(part)) {
					// This is likely a symptom description
					symptoms.push(this.cleanItem(part));
				}
			}
		}

		// Only return if we found foods/behaviors AND symptoms (the point of narrative format)
		// or if we found clear food consumption patterns
		if ((foods.length > 0 || behaviors.length > 0) && (symptoms.length > 0 || foodVerbMatch)) {
			return { foods, behaviors, symptoms };
		}

		return null;
	}

	extractItemList(text: string): string[] {
		// Extract comma-separated items, handling "and" before last item
		// "eggs, feta, dried mango, bread, and pistachios"

		// Replace "and" with comma for easier splitting
		text = text.replace(/\s+and\s+/gi, ', ');

		// Split by comma and clean
		const items = text.split(',')
			.map(item => this.cleanItem(item))
			.filter(item => item.length > 0);

		return items;
	}

	addItem(item: string, category: 'food' | 'behavior' | 'symptom', foods: string[], behaviors: string[], symptoms: string[]) {
		item = this.cleanItem(item);
		if (!item) return;

		switch (category) {
			case 'food':
				if (!foods.includes(item)) foods.push(item);
				break;
			case 'behavior':
				if (!behaviors.includes(item)) behaviors.push(item);
				break;
			case 'symptom':
				if (!symptoms.includes(item)) symptoms.push(item);
				break;
		}
	}

	categorizeAndAddItem(item: string, foods: string[], behaviors: string[], symptoms: string[]) {
		item = this.cleanItem(item);
		if (!item) return;

		const lowerItem = item.toLowerCase();

		// Common symptom keywords - expanded to catch more symptoms
		const symptomPattern = /\b(pain|ache|nausea|tired|fatigue|bloat|bloating|cramp|rash|itch|itching|headache|migraine|dizzy|dizziness|swelling|sore|throat|reflux|discomfort|malaise|joint|stomach|acid|sick|ill|nasty|hurt|suffer)/i;

		if (symptomPattern.test(lowerItem)) {
			if (!symptoms.includes(item)) symptoms.push(item);
		}
		// Common behavior keywords
		else if (lowerItem.match(/\b(exercise|exercised|walk|walked|run|ran|sleep|slept|stress|stressed|anxiety|workout|meditation|meditated|yoga|climb|climbed|lift|lifted|hiit|cycle|cycled|swim|swam)\b/i)) {
			if (!behaviors.includes(item)) behaviors.push(item);
		}
		// Default to food if unclear
		else {
			if (!foods.includes(item)) foods.push(item);
		}
	}

	cleanItem(item: string): string {
		// Remove markdown formatting and extra whitespace
		return item
			.replace(/\*\*/g, '')
			.replace(/\*/g, '')
			.replace(/^[-*+]\s+/, '')
			.replace(/^\d+\.\s+/, '')
			.trim();
	}

	analyzeAssociations(entries: HealthEntry[]): Association[] {
		const associationMap = new Map<string, Association>();

		// For each entry, link foods/behaviors to symptoms that occurred
		for (const entry of entries) {
			// Process foods
			for (const food of entry.foods) {
				if (!associationMap.has(food)) {
					associationMap.set(food, {
						item: food,
						type: 'food',
						symptoms: new Map(),
						totalOccurrences: 0
					});
				}
				const assoc = associationMap.get(food)!;
				assoc.totalOccurrences++;

				// Link to symptoms in same entry
				for (const symptom of entry.symptoms) {
					const count = assoc.symptoms.get(symptom) || 0;
					assoc.symptoms.set(symptom, count + 1);
				}
			}

			// Process behaviors
			for (const behavior of entry.behaviors) {
				if (!associationMap.has(behavior)) {
					associationMap.set(behavior, {
						item: behavior,
						type: 'behavior',
						symptoms: new Map(),
						totalOccurrences: 0
					});
				}
				const assoc = associationMap.get(behavior)!;
				assoc.totalOccurrences++;

				// Link to symptoms in same entry
				for (const symptom of entry.symptoms) {
					const count = assoc.symptoms.get(symptom) || 0;
					assoc.symptoms.set(symptom, count + 1);
				}
			}
		}

		return Array.from(associationMap.values())
			.sort((a, b) => b.totalOccurrences - a.totalOccurrences);
	}
}

class HealthLogResultsModal extends Modal {
	entries: HealthEntry[];
	associations: Association[];

	constructor(app: App, entries: HealthEntry[], associations: Association[]) {
		super(app);
		this.entries = entries;
		this.associations = associations;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Health Log Analysis Results' });

		// Summary stats
		const statsDiv = contentEl.createDiv({ cls: 'health-log-stats' });
		statsDiv.createEl('p', { text: `Total entries analyzed: ${this.entries.length}` });

		const totalFoods = new Set(this.entries.flatMap(e => e.foods)).size;
		const totalBehaviors = new Set(this.entries.flatMap(e => e.behaviors)).size;
		const totalSymptoms = new Set(this.entries.flatMap(e => e.symptoms)).size;

		statsDiv.createEl('p', { text: `Unique foods: ${totalFoods}` });
		statsDiv.createEl('p', { text: `Unique behaviors: ${totalBehaviors}` });
		statsDiv.createEl('p', { text: `Unique symptoms: ${totalSymptoms}` });

		// Associations
		contentEl.createEl('h3', { text: 'Associations Found' });

		if (this.associations.length === 0) {
			contentEl.createEl('p', { text: 'No associations found. Make sure your health logs contain symptoms.' });
			return;
		}

		for (const assoc of this.associations) {
			if (assoc.symptoms.size === 0) continue;

			const assocDiv = contentEl.createDiv({ cls: 'health-association' });

			const title = assocDiv.createEl('h4', {
				text: `${assoc.item} (${assoc.type})`
			});
			title.style.marginBottom = '8px';

			const occurrences = assocDiv.createEl('p', {
				text: `Logged ${assoc.totalOccurrences} times`
			});
			occurrences.style.fontSize = '0.9em';
			occurrences.style.color = 'var(--text-muted)';

			if (assoc.symptoms.size > 0) {
				const symptomsList = assocDiv.createEl('ul');
				symptomsList.style.marginLeft = '20px';

				const sortedSymptoms = Array.from(assoc.symptoms.entries())
					.sort((a, b) => b[1] - a[1]);

				for (const [symptom, count] of sortedSymptoms) {
					const percentage = ((count / assoc.totalOccurrences) * 100).toFixed(1);
					symptomsList.createEl('li', {
						text: `${symptom}: ${count}/${assoc.totalOccurrences} times (${percentage}%)`
					});
				}
			}

			assocDiv.style.marginBottom = '20px';
			assocDiv.style.padding = '10px';
			assocDiv.style.border = '1px solid var(--background-modifier-border)';
			assocDiv.style.borderRadius = '5px';
		}

		// Add close button
		const buttonDiv = contentEl.createDiv();
		buttonDiv.style.marginTop = '20px';
		buttonDiv.style.textAlign = 'right';

		const closeButton = buttonDiv.createEl('button', { text: 'Close' });
		closeButton.addEventListener('click', () => this.close());
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class HealthLogSettingTab extends PluginSettingTab {
	plugin: HealthLogAnalyzerPlugin;

	constructor(app: App, plugin: HealthLogAnalyzerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Health Log Analyzer Settings' });

		new Setting(containerEl)
			.setName('Detection method')
			.setDesc('How to identify daily notes')
			.addDropdown(dropdown => dropdown
				.addOption('regex', 'Date regex pattern')
				.addOption('tag', 'Tag')
				.setValue(this.plugin.settings.useDateRegex ? 'regex' : 'tag')
				.onChange(async (value) => {
					this.plugin.settings.useDateRegex = value === 'regex';
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide relevant settings
				}));

		if (this.plugin.settings.useDateRegex) {
			new Setting(containerEl)
				.setName('Date regex pattern')
				.setDesc('Regular expression to match daily note filenames (e.g., \\d{4}-\\d{2}-\\d{2} for YYYY-MM-DD)')
				.addText(text => text
					.setPlaceholder('\\d{4}-\\d{2}-\\d{2}')
					.setValue(this.plugin.settings.dateRegexPattern)
					.onChange(async (value) => {
						this.plugin.settings.dateRegexPattern = value;
						await this.plugin.saveSettings();
					}));
		} else {
			new Setting(containerEl)
				.setName('Daily note tag')
				.setDesc('Tag used to identify daily notes (include the #)')
				.addText(text => text
					.setPlaceholder('#daily')
					.setValue(this.plugin.settings.dailyNoteTag)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteTag = value;
						await this.plugin.saveSettings();
					}));
		}

		new Setting(containerEl)
			.setName('Health log heading')
			.setDesc('The heading to look for in daily notes (case-insensitive)')
			.addText(text => text
				.setPlaceholder('Health log')
				.setValue(this.plugin.settings.healthLogHeading)
				.onChange(async (value) => {
					this.plugin.settings.healthLogHeading = value;
					await this.plugin.saveSettings();
				}));

		// Add usage instructions
		containerEl.createEl('h3', { text: 'Usage Instructions' });

		const instructions = containerEl.createDiv();
		instructions.createEl('p', { text: 'Format your health log sections like this (narrative format - easiest):' });

		const example1 = instructions.createEl('pre');
		example1.style.backgroundColor = 'var(--background-secondary)';
		example1.style.padding = '10px';
		example1.style.borderRadius = '5px';
		example1.style.marginBottom = '15px';
		example1.textContent = `## Health log
- Ate eggs, feta, and bread — migraine 30min later
- Had coffee — headache after
- Exercised for 30 minutes — felt great`;

		instructions.createEl('p', { text: 'Or use structured categories:' });

		const example2 = instructions.createEl('pre');
		example2.style.backgroundColor = 'var(--background-secondary)';
		example2.style.padding = '10px';
		example2.style.borderRadius = '5px';
		example2.textContent = `## Health log

Foods:
- Pizza
- Coffee
- Chocolate

Behaviors:
- Exercised for 30 minutes
- Stressed at work
- Slept 7 hours

Symptoms:
- Stomach pain
- Headache`;

		instructions.createEl('p', {
			text: 'The plugin supports multiple formats and will automatically extract associations between what you consume/do and how you feel.'
		});
	}
}
