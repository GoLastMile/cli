import { resolve } from 'path';
import type { AnalyzeResponse } from './api-client.js';

export interface LocalFix {
  id: string;
  gapId: string;
  gapTitle: string;
  filePath: string;
  originalContent: string;
  newContent: string;
  description: string;
  operation?: 'create' | 'modify' | 'append' | 'delete';
}

type Stack = AnalyzeResponse['stack'];

function defaultGitignore(stack: Stack): string {
  const lines: string[] = [
    '# Added by LastMile',
    '.DS_Store',
    '.env',
    '.env.local',
    '.env.*.local',
    '',
  ];

  const lang = stack.language?.toLowerCase();
  if (lang === 'javascript' || lang === 'typescript') {
    lines.push(
      'node_modules/',
      'dist/',
      'build/',
      '.next/',
      '*.log',
      'npm-debug.log*',
      'pnpm-debug.log*',
      '.turbo/',
      '',
    );
  }

  if (lang === 'python') {
    lines.push('__pycache__/', '*.py[cod]', '.venv/', 'venv/', '.pytest_cache/', '');
  }

  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trimEnd() + '\n';
}

function parseGitignoreAppendList(suggestedFix: string | undefined): string[] {
  if (!suggestedFix) return [];
  const m = suggestedFix.match(/Add the following to \.gitignore:\s*(.+)$/i);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Build apply-able file patches for a subset of auto-fixable gaps (local engine).
 */
export function buildLocalFixes(
  projectRoot: string,
  files: Map<string, string>,
  analysis: AnalyzeResponse
): LocalFix[] {
  const fixes: LocalFix[] = [];

  for (const gap of analysis.gaps) {
    if (!gap.autoFixable) continue;

    if (gap.title === 'Missing .gitignore file') {
      const rel = '.gitignore';
      const abs = resolve(projectRoot, rel);
      const originalContent = files.get(rel) ?? '';
      if (originalContent !== '') continue;

      fixes.push({
        id: `local-${gap.id}`,
        gapId: gap.id,
        gapTitle: gap.title,
        filePath: abs,
        originalContent,
        newContent: defaultGitignore(analysis.stack),
        description: 'Create a starter .gitignore for your stack',
      });
      continue;
    }

    if (gap.title === 'Incomplete .gitignore' && gap.filePath) {
      const rel = gap.filePath;
      const abs = resolve(projectRoot, rel);
      const originalContent = files.get(rel) ?? '';
      const toAdd = parseGitignoreAppendList(gap.suggestedFix);
      if (toAdd.length === 0) continue;

      const needsNl = originalContent.length > 0 && !originalContent.endsWith('\n');
      const block = `${needsNl ? '\n' : ''}# Added by LastMile\n${toAdd.join('\n')}\n`;
      fixes.push({
        id: `local-${gap.id}`,
        gapId: gap.id,
        gapTitle: gap.title,
        filePath: abs,
        originalContent,
        newContent: originalContent + block,
        description: `Append ${toAdd.length} entries to .gitignore`,
      });
    }
  }

  return fixes;
}
