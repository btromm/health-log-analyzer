import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, Modal } from 'obsidian';

interface HealthLogSettings {
	dailyNoteTag: string;
	useDateRegex: boolean;
	dateRegexPattern: string;
	healthLogHeading: string;
	// Ollama settings
	useOllama: boolean;
	ollamaHost: string;
	ollamaModel: string;
}

const DEFAULT_SETTINGS: HealthLogSettings = {
	dailyNoteTag: '#daily',
	useDateRegex: true,
	dateRegexPattern: '\\d{4}-\\d{2}-\\d{2}',
	healthLogHeading: 'Health log',
	useOllama: true,
	ollamaHost: 'http://localhost:11434',
	ollamaModel: 'llama3.2'
}

interface TimedItem {
	name?: string;
	description?: string; // For symptoms
	activity?: string; // For exercise
	time?: string;
	dose?: string;
	duration?: string;
	severity?: string;
	onset?: string; // e.g., "30min later", "2 hours after"
}

interface ParsedHealthData {
	foods: TimedItem[];
	supplements: TimedItem[];
	exercise: TimedItem[];
	symptoms: TimedItem[];
}

interface HealthEntry {
	date: string;
	fileName: string;
	parsed: ParsedHealthData;
	rawContent: string;
}

interface CachedEntry {
	fileName: string;
	mtime: number; // File modification time
	parsed: ParsedHealthData;
}

interface CacheData {
	version: string; // Cache format version
	entries: Record<string, CachedEntry>; // Keyed by file path
}

interface TemporalAssociation {
	trigger: {
		type: 'food' | 'supplement' | 'exercise';
		name: string;
	};
	symptom: string;
	occurrences: Array<{
		date: string;
		triggerTime?: string;
		symptomTime?: string;
		timeLag?: string;
	}>;
	totalCount: number;
	percentage: number;
}

export default class HealthLogAnalyzerPlugin extends Plugin {
	settings: HealthLogSettings;
	cache: CacheData;
	cancelAnalysis: boolean = false;

	async onload() {
		await this.loadSettings();
		await this.loadCache();

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

	async loadCache() {
		const cacheFile = this.app.vault.adapter.getResourcePath('.obsidian/plugins/health-log-analyzer/cache.json');
		try {
			const data = await this.app.vault.adapter.read('.obsidian/plugins/health-log-analyzer/cache.json');
			this.cache = JSON.parse(data);

			// Validate cache version
			if (this.cache.version !== '2.0.0') {
				console.log('Cache version mismatch, resetting cache');
				this.cache = { version: '2.0.0', entries: {} };
			}
		} catch (error) {
			// Cache doesn't exist or is invalid, initialize empty
			this.cache = { version: '2.0.0', entries: {} };
		}
	}

	async saveCache() {
		try {
			await this.app.vault.adapter.write(
				'.obsidian/plugins/health-log-analyzer/cache.json',
				JSON.stringify(this.cache, null, 2)
			);
		} catch (error) {
			console.error('Failed to save cache:', error);
		}
	}

	async callOllama(prompt: string): Promise<string> {
		const url = `${this.settings.ollamaHost}/api/generate`;

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: this.settings.ollamaModel,
					prompt: prompt,
					stream: false,
					format: 'json'
				})
			});

			if (!response.ok) {
				throw new Error(`Ollama API error: ${response.statusText}`);
			}

			const data = await response.json();
			return data.response;
		} catch (error) {
			console.error('Ollama API call failed:', error);
			throw error;
		}
	}

	async parseHealthLogWithLLM(content: string, date: string): Promise<ParsedHealthData> {
		const prompt = `You are analyzing a health log entry. Extract all foods, supplements, exercise, and symptoms with their timing information.

Date: ${date}
Health Log Content:
${content}

Extract the following information and return ONLY a valid JSON object with this exact structure:
{
  "foods": [{"name": "food name", "time": "time if mentioned"}],
  "supplements": [{"name": "supplement name", "dose": "dosage if mentioned", "time": "time if mentioned"}],
  "exercise": [{"activity": "exercise description", "duration": "duration if mentioned", "time": "time if mentioned"}],
  "symptoms": [{"description": "symptom description", "severity": "severity if mentioned", "time": "time if mentioned", "onset": "when it occurred relative to something else, e.g., '30min later', '2 hours after'"}]
}

Rules:
- Extract the actual substance/food name, not the category heading (e.g., "ascorbic acid" not "Morning (food)")
- For supplements, extract the substance name and dosage separately (e.g., "225mg ascorbic acid" → name: "ascorbic acid", dose: "225mg")
- For symptoms, extract the actual symptom phrase (e.g., "feeling slightly fatigued and anxious", "stomach feels quite acidic")
- Include relative timing like "30min later", "after", "2 hours later" in the onset field
- If no timing information is present, omit the time/onset fields
- Return ONLY the JSON object, no additional text or explanation`;

		try {
			const response = await this.callOllama(prompt);
			const parsed = JSON.parse(response);

			// Ensure all arrays exist
			return {
				foods: parsed.foods || [],
				supplements: parsed.supplements || [],
				exercise: parsed.exercise || [],
				symptoms: parsed.symptoms || []
			};
		} catch (error) {
			console.error('Failed to parse health log with LLM:', error);
			// Return empty structure on error
			return {
				foods: [],
				supplements: [],
				exercise: [],
				symptoms: []
			};
		}
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
		let processedCount = 0;
		let cachedCount = 0;
		let parsedCount = 0;

		// Reset cancel flag
		this.cancelAnalysis = false;

		// Create persistent notice with cancel button
		const fragment = document.createDocumentFragment();
		const noticeEl = document.createElement('div');
		noticeEl.style.display = 'flex';
		noticeEl.style.alignItems = 'center';
		noticeEl.style.gap = '10px';
		noticeEl.style.width = '100%';

		const messageEl = document.createElement('span');
		noticeEl.appendChild(messageEl);

		const cancelBtn = document.createElement('button');
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.marginLeft = 'auto';
		cancelBtn.addEventListener('click', () => {
			this.cancelAnalysis = true;
			cancelBtn.disabled = true;
			cancelBtn.textContent = 'Cancelling...';
		});
		noticeEl.appendChild(cancelBtn);

		fragment.appendChild(noticeEl);

		const notice = new Notice(fragment, 0); // 0 = persistent

		const updateNotice = (message: string) => {
			messageEl.textContent = message;
		};

		try {
			for (const file of files) {
				// Check for cancellation
				if (this.cancelAnalysis) {
					updateNotice(`Cancelled after processing ${processedCount}/${files.length} files`);
					await this.saveCache(); // Save what we've processed so far
					setTimeout(() => notice.hide(), 3000);
					return entries;
				}

				const content = await this.app.vault.read(file);
				const healthLogContent = this.extractHealthLogSection(content);

				if (healthLogContent) {
					processedCount++;

					let parsed: ParsedHealthData;
					const filePath = file.path;
					const mtime = file.stat.mtime;

					// Check cache first
					const cachedEntry = this.cache.entries[filePath];
					if (cachedEntry && cachedEntry.mtime === mtime) {
						// Use cached data
						parsed = cachedEntry.parsed;
						cachedCount++;
					} else {
						// Need to parse
						parsedCount++;

						// Update notice with current file
						updateNotice(`Processing ${processedCount}/${files.length}: ${file.basename} (${cachedCount} cached, ${parsedCount} parsed)`);

						if (this.settings.useOllama) {
							try {
								parsed = await this.parseHealthLogWithLLM(healthLogContent, file.basename);
							} catch (error) {
								console.error(`Failed to parse ${file.basename} with LLM:`, error);
								// Fallback to empty data on error
								parsed = {
									foods: [],
									supplements: [],
									exercise: [],
									symptoms: []
								};
							}
						} else {
							// Fallback: use old parser
							parsed = this.parseHealthLogLegacy(healthLogContent);
						}

						// Update cache
						this.cache.entries[filePath] = {
							fileName: filePath,
							mtime: mtime,
							parsed: parsed
						};
					}

					// Only add entry if we found at least something
					if (parsed.foods.length > 0 || parsed.supplements.length > 0 ||
					    parsed.exercise.length > 0 || parsed.symptoms.length > 0) {
						entries.push({
							date: file.basename,
							fileName: file.path,
							parsed: parsed,
							rawContent: healthLogContent
						});
					}
				}
			}

			// Save cache after processing all files
			await this.saveCache();

			updateNotice(`✓ Analysis complete! ${cachedCount} from cache, ${parsedCount} newly parsed.`);
			setTimeout(() => notice.hide(), 3000);

		} catch (error) {
			updateNotice(`❌ Error during analysis: ${error.message}`);
			setTimeout(() => notice.hide(), 5000);
			throw error;
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

	parseHealthLogLegacy(content: string): ParsedHealthData {
		// Simplified fallback parser - just returns empty data
		// The LLM should be the primary parser
		return {
			foods: [],
			supplements: [],
			exercise: [],
			symptoms: []
		};
	}

	analyzeAssociations(entries: HealthEntry[]): TemporalAssociation[] {
		const associationMap = new Map<string, Map<string, TemporalAssociation>>();

		// For each entry, link triggers (foods/supplements/exercise) to symptoms
		for (const entry of entries) {
			const triggers = [
				...entry.parsed.foods.map(f => ({ type: 'food' as const, item: f })),
				...entry.parsed.supplements.map(s => ({ type: 'supplement' as const, item: s })),
				...entry.parsed.exercise.map(e => ({ type: 'exercise' as const, item: e }))
			];

			for (const trigger of triggers) {
				// Extract name from different fields depending on trigger type
				const triggerName = trigger.item.name || trigger.item.activity || trigger.item.description || 'unknown';
				const triggerKey = `${trigger.type}:${triggerName}`;

				if (!associationMap.has(triggerKey)) {
					associationMap.set(triggerKey, new Map());
				}

				const symptomMap = associationMap.get(triggerKey)!;

				// Link to symptoms in same entry
				for (const symptom of entry.parsed.symptoms) {
					const symptomKey = symptom.description || symptom.name || 'unknown';

					if (!symptomMap.has(symptomKey)) {
						symptomMap.set(symptomKey, {
							trigger: {
								type: trigger.type,
								name: triggerName
							},
							symptom: symptomKey,
							occurrences: [],
							totalCount: 0,
							percentage: 0
						});
					}

					const assoc = symptomMap.get(symptomKey)!;
					assoc.occurrences.push({
						date: entry.date,
						triggerTime: trigger.item.time,
						symptomTime: symptom.time,
						timeLag: symptom.onset
					});
					assoc.totalCount++;
				}
			}
		}

		// Flatten the nested maps and calculate percentages
		const associations: TemporalAssociation[] = [];
		for (const [triggerKey, symptomMap] of associationMap) {
			// Count total occurrences of this trigger across all entries
			const totalTriggerOccurrences = Array.from(symptomMap.values())
				.reduce((sum, assoc) => Math.max(sum, assoc.totalCount), 0);

			for (const assoc of symptomMap.values()) {
				// Calculate percentage: how often did this symptom occur when trigger was present?
				assoc.percentage = (assoc.totalCount / totalTriggerOccurrences) * 100;
				associations.push(assoc);
			}
		}

		// Sort by total count (most common associations first)
		return associations.sort((a, b) => b.totalCount - a.totalCount);
	}
}

class HealthLogResultsModal extends Modal {
	entries: HealthEntry[];
	associations: TemporalAssociation[];

	constructor(app: App, entries: HealthEntry[], associations: TemporalAssociation[]) {
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

		const totalFoods = new Set(this.entries.flatMap(e => e.parsed.foods.map(f => f.name))).size;
		const totalSupplements = new Set(this.entries.flatMap(e => e.parsed.supplements.map(s => s.name))).size;
		const totalExercise = new Set(this.entries.flatMap(e => e.parsed.exercise.map(ex => ex.name || ex.activity || 'exercise'))).size;
		const totalSymptoms = new Set(this.entries.flatMap(e => e.parsed.symptoms.map(s => s.description || s.name || 'unknown'))).size;

		statsDiv.createEl('p', { text: `Unique foods: ${totalFoods}` });
		statsDiv.createEl('p', { text: `Unique supplements: ${totalSupplements}` });
		statsDiv.createEl('p', { text: `Unique exercise: ${totalExercise}` });
		statsDiv.createEl('p', { text: `Unique symptoms: ${totalSymptoms}` });

		// Associations
		contentEl.createEl('h3', { text: 'Temporal Associations Found' });

		if (this.associations.length === 0) {
			contentEl.createEl('p', { text: 'No associations found. Make sure your health logs contain both triggers and symptoms.' });
			return;
		}

		for (const assoc of this.associations) {
			const assocDiv = contentEl.createDiv({ cls: 'health-association' });

			const title = assocDiv.createEl('h4', {
				text: `${assoc.trigger.name} (${assoc.trigger.type})`
			});
			title.style.marginBottom = '8px';

			const subtitle = assocDiv.createEl('p', {
				text: `→ ${assoc.symptom}`
			});
			subtitle.style.fontSize = '1em';
			subtitle.style.fontWeight = 'bold';
			subtitle.style.color = 'var(--text-accent)';
			subtitle.style.marginBottom = '8px';

			const stats = assocDiv.createEl('p', {
				text: `Occurred ${assoc.totalCount} times (${assoc.percentage.toFixed(1)}% correlation)`
			});
			stats.style.fontSize = '0.9em';
			stats.style.color = 'var(--text-muted)';

			// Show temporal details if available
			const timeLags = assoc.occurrences
				.map(occ => occ.timeLag)
				.filter(lag => lag && lag.length > 0);

			if (timeLags.length > 0) {
				const lagText = assocDiv.createEl('p', {
					text: `Timing: ${timeLags.slice(0, 3).join(', ')}${timeLags.length > 3 ? '...' : ''}`
				});
				lagText.style.fontSize = '0.85em';
				lagText.style.color = 'var(--text-muted)';
				lagText.style.fontStyle = 'italic';
			}

			// Show sample dates
			const sampleDates = assoc.occurrences.slice(0, 3).map(occ => occ.date).join(', ');
			const datesText = assocDiv.createEl('p', {
				text: `Sample occurrences: ${sampleDates}${assoc.occurrences.length > 3 ? '...' : ''}`
			});
			datesText.style.fontSize = '0.8em';
			datesText.style.color = 'var(--text-faint)';

			assocDiv.style.marginBottom = '20px';
			assocDiv.style.padding = '12px';
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

		// Ollama settings
		containerEl.createEl('h3', { text: 'LLM Parsing Settings' });

		new Setting(containerEl)
			.setName('Use Ollama for parsing')
			.setDesc('Enable LLM-based parsing for better extraction of foods, supplements, and symptoms')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useOllama)
				.onChange(async (value) => {
					this.plugin.settings.useOllama = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide Ollama settings
				}));

		if (this.plugin.settings.useOllama) {
			new Setting(containerEl)
				.setName('Ollama host')
				.setDesc('Ollama API endpoint (default: http://localhost:11434)')
				.addText(text => text
					.setPlaceholder('http://localhost:11434')
					.setValue(this.plugin.settings.ollamaHost)
					.onChange(async (value) => {
						this.plugin.settings.ollamaHost = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Ollama model')
				.setDesc('Model to use for parsing (e.g., llama3.2, mistral, qwen2.5)')
				.addText(text => text
					.setPlaceholder('llama3.2')
					.setValue(this.plugin.settings.ollamaModel)
					.onChange(async (value) => {
						this.plugin.settings.ollamaModel = value;
						await this.plugin.saveSettings();
					}));

			const ollamaNote = containerEl.createDiv();
			ollamaNote.style.fontSize = '0.9em';
			ollamaNote.style.color = 'var(--text-muted)';
			ollamaNote.style.marginTop = '10px';
			ollamaNote.style.marginBottom = '20px';
			ollamaNote.innerHTML = `
				<p><strong>Note:</strong> Make sure Ollama is running with the selected model:</p>
				<code style="background: var(--background-secondary); padding: 2px 6px; border-radius: 3px;">ollama run ${this.plugin.settings.ollamaModel}</code>
			`;
		}

		// Cache management
		containerEl.createEl('h3', { text: 'Cache Management' });

		new Setting(containerEl)
			.setName('Clear cache')
			.setDesc('Clear cached parse results. Use this if you want to force re-parsing all files.')
			.addButton(button => button
				.setButtonText('Clear Cache')
				.onClick(async () => {
					this.plugin.cache = { version: '2.0.0', entries: {} };
					await this.plugin.saveCache();
					new Notice('Cache cleared! Next analysis will re-parse all files.');
				}));

		const cacheSize = Object.keys(this.plugin.cache.entries).length;
		const cacheInfo = containerEl.createDiv();
		cacheInfo.style.fontSize = '0.9em';
		cacheInfo.style.color = 'var(--text-muted)';
		cacheInfo.style.marginTop = '5px';
		cacheInfo.textContent = `Currently cached: ${cacheSize} files`;

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
