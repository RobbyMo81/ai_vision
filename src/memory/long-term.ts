/**
 * Long-term memory manager.
 *
 * Persists two types of data:
 *
 *   stories/     — One JSON + Markdown narrative per workflow run
 *   FORGE context_store (`sic.improvements.store`) — SIC improvement registry
 *
 * IMPROVEMENTS track specific patterns observed across runs (e.g.
 * "Salesforce dropdowns require a click-wait-select sequence").  Each
 * improvement has an occurrence counter.  At SIC_THRESHOLD occurrences the
 * improvement is promoted to SIC (Standard Improvement Contribution) status
 * and its agentInstruction is automatically prepended to every future
 * agent_task prompt via getSicPromptBlock().
 *
 * STORIES are written at workflow end.  They are human-readable Markdown
 * narratives covering: what happened, lessons learned, and which improvements
 * were identified in that run.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ImprovementCategory,
  ImprovementStore,
  SIC_THRESHOLD,
  Story,
  StepImprovement,
} from './types';
import { forgeSicStore } from './forge-sic';

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------

function memoryDir(): string {
  return (
    process.env.AI_VISION_MEMORY_DIR ??
    path.join(process.env.HOME ?? process.cwd(), '.ai-vision', 'memory')
  );
}

function storiesDir(): string {
  return path.join(memoryDir(), 'stories');
}

function improvementsFile(): string {
  return path.join(memoryDir(), 'improvements.json');
}

function ensureDirs(): void {
  fs.mkdirSync(storiesDir(), { recursive: true });
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class LongTermMemoryManager {
  private _store: ImprovementStore | null = null;

  // ---- Improvement store ---------------------------------------------------

  private loadStore(): ImprovementStore {
    if (this._store) return this._store;
    ensureDirs();

    const forgeStore = forgeSicStore.loadImprovementStore();
    if (forgeStore) {
      this._store = forgeStore;
      return this._store;
    }

    if (forgeSicStore.isStrictMode()) {
      this._store = { improvements: [], lastUpdated: new Date().toISOString() };
      return this._store;
    }

    const file = improvementsFile();
    if (fs.existsSync(file)) {
      try {
        this._store = JSON.parse(fs.readFileSync(file, 'utf8')) as ImprovementStore;
        return this._store;
      } catch {
        // fall through to fresh store
      }
    }
    this._store = { improvements: [], lastUpdated: new Date().toISOString() };
    return this._store;
  }

  private saveStore(): void {
    ensureDirs();
    const store = this.loadStore();
    store.lastUpdated = new Date().toISOString();

    const wroteForge = forgeSicStore.saveImprovementStore(store);
    if (!wroteForge && forgeSicStore.isStrictMode()) {
      throw new Error('FORGE SIC strict mode enabled, but failed to persist improvement store to forge-memory.db');
    }

    const mirrorLegacyFile = process.env.AI_VISION_SIC_MIRROR_FILE === 'true';
    if (!forgeSicStore.isStrictMode() && (!wroteForge || mirrorLegacyFile)) {
      fs.writeFileSync(improvementsFile(), JSON.stringify(store, null, 2), 'utf8');
    }
  }

  /**
   * Record a new observation or increment an existing one.
   * Auto-promotes to SIC when occurrences reach SIC_THRESHOLD.
   * Returns the updated improvement record.
   */
  recordImprovement(params: {
    id: string;
    category: ImprovementCategory;
    title: string;
    description: string;
    agentInstruction: string;
    workflowId: string;
  }): StepImprovement {
    const store = this.loadStore();
    const now = new Date().toISOString();
    let imp = store.improvements.find(i => i.id === params.id);

    if (imp) {
      imp.occurrences += 1;
      imp.lastSeen = now;
      imp.description = params.description; // allow description updates
      imp.agentInstruction = params.agentInstruction;
      if (!imp.workflowIds.includes(params.workflowId)) {
        imp.workflowIds.push(params.workflowId);
      }
      if (!imp.isSic && imp.occurrences >= SIC_THRESHOLD) {
        imp.isSic = true;
        console.log(
          `[memory] ✨ Improvement "${imp.title}" promoted to SIC ` +
          `(${imp.occurrences} occurrences across ${imp.workflowIds.length} workflows)`,
        );
      }
    } else {
      imp = {
        id: params.id,
        category: params.category,
        title: params.title,
        description: params.description,
        agentInstruction: params.agentInstruction,
        occurrences: 1,
        firstSeen: now,
        lastSeen: now,
        isSic: false,
        workflowIds: [params.workflowId],
      };
      store.improvements.push(imp);
    }

    this.saveStore();
    return imp;
  }

  /** All improvements including non-SIC. */
  getAllImprovements(): StepImprovement[] {
    return this.loadStore().improvements;
  }

  /** Only SIC-promoted improvements. */
  getSicEnhancements(): StepImprovement[] {
    return this.loadStore().improvements.filter(i => i.isSic);
  }

  /**
   * Build the SIC block prepended to every agent_task prompt.
   * Empty string when no SIC enhancements exist yet.
   */
  getSicPromptBlock(): string {
    const sics = this.getSicEnhancements();
    if (sics.length === 0) return '';

    const lines: string[] = [
      '=== STANDARD IMPROVEMENT CONTRIBUTIONS (SIC) — proven best practices ===',
    ];
    sics.forEach((sic, i) => {
      lines.push(`${i + 1}. [${sic.category.toUpperCase()}] ${sic.title}`);
      lines.push(`   ${sic.agentInstruction}`);
    });
    lines.push('=== END SIC ===\n');
    return lines.join('\n');
  }

  // ---- Stories -------------------------------------------------------------

  /**
   * Write a story as both JSON (machine-readable) and Markdown (human-readable).
   * Returns the paths of both files.
   */
  writeStory(story: Story): { jsonPath: string; mdPath: string } {
    ensureDirs();
    const base = path.join(storiesDir(), story.id);
    const jsonPath = `${base}.json`;
    const mdPath = `${base}.md`;

    fs.writeFileSync(jsonPath, JSON.stringify(story, null, 2), 'utf8');
    fs.writeFileSync(mdPath, renderStoryMarkdown(story), 'utf8');

    console.log(`[memory] Story written → ${mdPath}`);
    return { jsonPath, mdPath };
  }

  listStories(): Story[] {
    ensureDirs();
    const stories: Story[] = [];
    for (const f of fs.readdirSync(storiesDir())) {
      if (!f.endsWith('.json')) continue;
      try {
        stories.push(
          JSON.parse(fs.readFileSync(path.join(storiesDir(), f), 'utf8')) as Story,
        );
      } catch {
        // skip malformed files
      }
    }
    return stories.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  }

  getStory(id: string): Story | null {
    const file = path.join(storiesDir(), `${id}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Story;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function renderStoryMarkdown(story: Story): string {
  const emoji =
    story.outcome === 'success' ? '✅' :
    story.outcome === 'partial' ? '⚠️' : '❌';
  const durSec = (story.metrics.durationMs / 1000).toFixed(1);

  const lines: string[] = [
    `# Story: ${story.workflowName}`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Session | \`${story.sessionId}\` |`,
    `| Date | ${story.completedAt.slice(0, 10)} |`,
    `| Outcome | ${emoji} ${story.outcome} |`,
    `| Duration | ${durSec}s |`,
    `| Agent Steps | ${story.metrics.totalAgentSteps} |`,
    '',
    '---',
    '',
    '## Summary',
    '',
    story.summary,
    '',
    '---',
    '',
    '## Lessons Learned',
    '',
    ...story.lessonsLearned.map(l => `- ${l}`),
    '',
    '---',
    '',
    '## Step Improvement Review',
    '',
  ];

  if (story.improvements.length === 0) {
    lines.push('_No improvements recorded for this run._');
  } else {
    for (const imp of story.improvements) {
      lines.push(`### [${imp.category.toUpperCase()}] ${imp.title}`);
      lines.push('');
      lines.push(imp.description);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Workflow Steps | ${story.metrics.totalWorkflowSteps} |`);
  lines.push(`| Agent Steps | ${story.metrics.totalAgentSteps} |`);
  lines.push(`| Duration | ${durSec}s |`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const longTermMemory = new LongTermMemoryManager();
