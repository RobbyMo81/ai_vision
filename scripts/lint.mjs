#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = process.cwd();
const errors = [];

function fail(message) {
  errors.push(message);
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function walk(dir, files = []) {
  if (!exists(dir)) return files;
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git', '.venv', 'sessions'].includes(entry.name)) continue;
      walk(rel, files);
    } else {
      files.push(rel);
    }
  }
  return files;
}

function lintJson(relativePath) {
  try {
    JSON.parse(readText(relativePath));
  } catch (err) {
    fail(`${relativePath}: invalid JSON (${err.message})`);
  }
}

function lintYaml(relativePath) {
  try {
    yaml.load(readText(relativePath));
  } catch (err) {
    fail(`${relativePath}: invalid YAML (${err.message})`);
  }
}

function lintNoTabs(relativePath) {
  const text = readText(relativePath);
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (line.includes('\t')) fail(`${relativePath}:${index + 1}: tab character found`);
  });
}

function lintNoTrailingWhitespace(relativePath) {
  const text = readText(relativePath);
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (/[ \t]$/.test(line)) fail(`${relativePath}:${index + 1}: trailing whitespace`);
  });
}

function lintRequiredScripts() {
  const pkg = JSON.parse(readText('package.json'));
  for (const script of ['lint', 'typecheck', 'test', 'build', 'forge']) {
    if (!pkg.scripts?.[script]) fail(`package.json: missing scripts.${script}`);
  }
}

function lintForgeGates() {
  if (!exists('forge.gates.sh')) fail('forge.gates.sh: missing root Forge quality gate file');
  if (!exists('.github/workflows/forge.yml')) fail('.github/workflows/forge.yml: missing Forge GitHub Actions workflow');
  if (!readText('ForgeMP/forge.sh').includes('run_quality_gates')) {
    fail('ForgeMP/forge.sh: run_quality_gates hook missing');
  }
}

for (const file of ['package.json', 'prd.json']) lintJson(file);
for (const file of walk('.github').filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))) lintYaml(file);
for (const file of walk('docs/artifacts').filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))) lintYaml(file);
for (const file of walk('workflows').filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))) lintYaml(file);

for (const file of [
  ...walk('scripts').filter((f) => /\.(mjs|js|sh)$/.test(f)),
  ...walk('ForgeMP').filter((f) => /\.(ts|sh)$/.test(f)),
  ...walk('.github').filter((f) => /\.(yml|yaml)$/.test(f)),
]) {
  lintNoTabs(file);
  lintNoTrailingWhitespace(file);
}

lintRequiredScripts();
lintForgeGates();

if (errors.length > 0) {
  console.error('[lint] failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('[lint] passed');
