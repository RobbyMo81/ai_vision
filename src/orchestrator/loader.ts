/**
 * Loaders for YAML workflow definitions and Markdown instruction files.
 *
 * YAML workflows are validated against WorkflowDefinitionSchema (zod) and
 * automatically tagged with `source: 'yaml'` so the engine delegates them to
 * the orchestrator loop instead of executing steps deterministically.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as jsYaml from 'js-yaml';
import { parseWorkflowDefinition, WorkflowDefinition } from '../workflow/types';

const WORKFLOWS_DIR = path.resolve(process.cwd(), 'workflows');
const INSTRUCTIONS_DIR = path.resolve(process.cwd(), 'instructions');

/** Parse and validate a YAML workflow file; tags it as source: 'yaml'. */
export function loadYamlWorkflow(filePath: string): WorkflowDefinition {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = jsYaml.load(content);
  const result = parseWorkflowDefinition(parsed);
  return { ...result, source: 'yaml' };
}

/** Load a workflow by name from the workflows/ directory. */
export function loadWorkflowByName(name: string): WorkflowDefinition {
  const yamlPath = path.join(WORKFLOWS_DIR, `${name}.yaml`);
  return loadYamlWorkflow(yamlPath);
}

/** List all YAML workflow names available in the workflows/ directory. */
export function listYamlWorkflows(): string[] {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => f.replace(/\.(yaml|yml)$/, ''));
}

/** Read a single instruction markdown file by name (without .md extension). */
export function loadInstruction(name: string, instrDir: string = INSTRUCTIONS_DIR): string | null {
  const filePath = path.join(instrDir, `${name}.md`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

/** Read all instruction markdown files from the instructions/ directory. */
export function loadAllInstructions(instrDir: string = INSTRUCTIONS_DIR): Record<string, string> {
  if (!fs.existsSync(instrDir)) return {};
  const result: Record<string, string> = {};
  for (const file of fs.readdirSync(instrDir)) {
    if (file.endsWith('.md')) {
      const name = file.replace(/\.md$/, '');
      result[name] = fs.readFileSync(path.join(instrDir, file), 'utf-8');
    }
  }
  return result;
}
