import { WorkflowDefinition } from '../workflow/types';
import { CorrelationMatch, Story } from './types';
import { longTermMemory } from './long-term';
import { taskMetadata } from './metadata';

function safeDomain(urlText: string): string {
  try {
    return new URL(urlText).hostname;
  } catch {
    return '';
  }
}

function definitionDomains(definition: WorkflowDefinition): string[] {
  return Array.from(
    new Set(
      definition.steps
        .filter((step): step is Extract<WorkflowDefinition['steps'][number], { type: 'navigate' }> => step.type === 'navigate')
        .map(step => safeDomain(step.url))
        .filter(Boolean),
    ),
  );
}

export class MemoryIndexer {
  findCorrelations(definition: WorkflowDefinition): CorrelationMatch[] {
    const stories = longTermMemory.listStories();
    const metadata = taskMetadata.list();
    const domains = definitionDomains(definition);
    const matches = new Map<string, CorrelationMatch>();

    const apply = (
      key: string,
      partial: Omit<CorrelationMatch, 'score'> & { delta: number },
    ): void => {
      const existing = matches.get(key);
      if (existing) {
        existing.score += partial.delta;
        if (!existing.reason.includes(partial.reason)) {
          existing.reason = `${existing.reason}; ${partial.reason}`;
        }
        return;
      }
      matches.set(key, {
        workflowId: partial.workflowId,
        workflowName: partial.workflowName,
        domain: partial.domain,
        score: partial.delta,
        reason: partial.reason,
      });
    };

    for (const story of stories) {
      const domain = domains[0] ?? '';
      const key = `${story.workflowId}:${domain || 'none'}`;
      if (story.workflowId === definition.id) {
        apply(key, {
          workflowId: story.workflowId,
          workflowName: story.workflowName,
          domain,
          delta: 0.7,
          reason: 'prior successful workflow story',
        });
      }
    }

    for (const record of metadata) {
      if (!domains.includes(record.domain)) continue;
      const key = `${record.workflowId}:${record.domain}`;
      apply(key, {
        workflowId: record.workflowId,
        workflowName: record.workflowName,
        domain: record.domain,
        delta: 0.2 + Math.min(record.successCount / 20, 0.1),
        reason: 'matching portal metadata',
      });
    }

    return Array.from(matches.values()).sort((a, b) => b.score - a.score);
  }

  isBespoke(definition: WorkflowDefinition): boolean {
    const best = this.findCorrelations(definition)[0];
    return !best || best.score < 0.7;
  }

  summarize(matches: CorrelationMatch[]): string {
    if (matches.length === 0) return 'No prior correlations found.';
    const top = matches.slice(0, 3);
    return top
      .map(m => `${m.workflowId}@${m.domain || 'unknown'} (${m.score.toFixed(2)}: ${m.reason})`)
      .join(' | ');
  }
}

export const memoryIndexer = new MemoryIndexer();
