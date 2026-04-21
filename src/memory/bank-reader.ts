import * as fs from 'fs';
import * as path from 'path';

const BANK_DIR = path.resolve(process.cwd(), 'memory', 'bank');

export interface BankFile {
  /** Relative path from memory/bank/ (e.g. "world.md", "platform/reddit.md") */
  relativePath: string;
  content: string;
}

/** Read all Markdown files under memory/bank/ recursively. */
export function readBankFiles(bankDir: string = BANK_DIR): BankFile[] {
  if (!fs.existsSync(bankDir)) return [];

  const results: BankFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push({
          relativePath: path.relative(bankDir, fullPath),
          content: fs.readFileSync(fullPath, 'utf-8'),
        });
      }
    }
  };
  walk(bankDir);
  return results;
}

/**
 * Format all bank files into a single context block suitable for injection
 * into a Claude system prompt or user turn.
 */
export function formatBankContext(bankDir: string = BANK_DIR): string {
  const files = readBankFiles(bankDir);
  if (files.length === 0) return '';

  const sections = files.map(f => {
    const heading = `## ${f.relativePath}`;
    return `${heading}\n\n${f.content.trim()}`;
  });

  return `# Memory Bank\n\n${sections.join('\n\n---\n\n')}`;
}

/** Read a single named bank file (path relative to memory/bank/). */
export function readBankFile(relativePath: string, bankDir: string = BANK_DIR): string | null {
  const fullPath = path.join(bankDir, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8');
}
