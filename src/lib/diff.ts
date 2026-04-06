import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import chalk from 'chalk';
import { diffLines } from 'diff';

interface Fix {
  id: string;
  filePath: string;
  originalContent: string;
  newContent: string;
}

export function displayDiff(original: string, updated: string): void {
  const changes = diffLines(original, updated);

  for (const change of changes) {
    const lines = change.value.split('\n').filter(l => l !== '');
    for (const line of lines) {
      if (change.added) {
        console.log(chalk.green(`+ ${line}`));
      } else if (change.removed) {
        console.log(chalk.red(`- ${line}`));
      } else {
        console.log(chalk.dim(`  ${line}`));
      }
    }
  }
}

export async function applyFixes(fixes: Fix[]): Promise<void> {
  for (const fix of fixes) {
    const dir = dirname(fix.filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(fix.filePath, fix.newContent, 'utf-8');
  }
}
