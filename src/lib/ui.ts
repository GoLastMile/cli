/**
 * Premium CLI UI
 *
 * Clean, minimal design with visual polish
 */

import * as p from '@clack/prompts';
import { checkbox, confirm as inquirerConfirm, Separator } from '@inquirer/prompts';
import chalk from 'chalk';
import gradient from 'gradient-string';
import boxen from 'boxen';

// Brand colors
const brand = {
  primary: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  dim: chalk.dim,
  bold: chalk.bold,
  white: chalk.white,
};

// Brand gradient
const brandGradient = gradient(['#00d4ff', '#7c3aed']);

// Symbols
const sym = {
  dot: '·',
  arrow: '→',
  check: '✓',
  cross: '✗',
  warning: '!',
  bullet: '●',
  circle: '○',
  line: '─',
  bar: '│',
};

/**
 * Print the header with version
 */
export function header(version: string = '0.1.0') {
  console.log();
  console.log(`  ${brandGradient('▲ LastMile')}  ${brand.dim(`v${version}`)}`);
  console.log();
}

/**
 * Print a section divider
 */
export function divider() {
  console.log(brand.dim(`  ${sym.line.repeat(50)}`));
}

/**
 * Print detected stack in a nice format
 */
export function stack(info: {
  framework?: string | null;
  language?: string | null;
  database?: string | null;
  orm?: string | null;
}) {
  const parts: string[] = [];

  if (info.framework) parts.push(info.framework);
  if (info.language && !info.framework?.toLowerCase().includes(info.language.toLowerCase())) {
    parts.push(info.language);
  }
  if (info.orm) parts.push(info.orm);
  else if (info.database) parts.push(info.database);

  if (parts.length > 0) {
    console.log(`  ${brand.bold(parts.join(` ${brand.dim(sym.dot)} `))}`);
    console.log();
  }
}

/**
 * Analyzer status display - updates in place
 */
export interface AnalyzerStatus {
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  message?: string;
  issueCount?: number;
}

export class AnalyzerDisplay {
  private analyzers: Map<string, AnalyzerStatus> = new Map();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lineCount = 0;
  private startTime = Date.now();

  add(id: string, name: string) {
    this.analyzers.set(id, { name, status: 'pending' });
  }

  update(id: string, update: Partial<AnalyzerStatus>) {
    const analyzer = this.analyzers.get(id);
    if (analyzer) {
      Object.assign(analyzer, update);
    }
  }

  start() {
    this.startTime = Date.now();
    this.render();
    this.intervalId = setInterval(() => this.render(), 150);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.render(true);
  }

  private render(final = false) {
    // Clear previous output
    if (this.lineCount > 0) {
      process.stdout.write(`\x1b[${this.lineCount}A\x1b[0J`);
    }

    const lines: string[] = [];

    for (const [, analyzer] of this.analyzers) {
      const icon = this.getIcon(analyzer.status);
      const name = this.formatName(analyzer);
      const status = this.formatStatus(analyzer);

      lines.push(`  ${icon} ${name}${status}`);
    }

    // Add elapsed time if still running
    if (!final) {
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      lines.push('');
      lines.push(brand.dim(`  ${elapsed}s`));
    }

    const output = lines.join('\n');
    console.log(output);
    this.lineCount = lines.length;
  }

  private getIcon(status: AnalyzerStatus['status']): string {
    switch (status) {
      case 'done':
        return brand.success(sym.check);
      case 'error':
        return brand.error(sym.cross);
      case 'running':
        return brand.primary(sym.bullet);
      default:
        return brand.dim(sym.circle);
    }
  }

  private formatName(analyzer: AnalyzerStatus): string {
    const width = 16;
    const name = analyzer.name.padEnd(width);

    switch (analyzer.status) {
      case 'running':
        return brand.white(name);
      case 'done':
      case 'error':
        return brand.dim(name);
      default:
        return brand.dim(name);
    }
  }

  private formatStatus(analyzer: AnalyzerStatus): string {
    switch (analyzer.status) {
      case 'running':
        return brand.dim(analyzer.message || 'analyzing...');
      case 'done':
        if (analyzer.issueCount !== undefined) {
          if (analyzer.issueCount === 0) {
            return brand.success('no issues');
          }
          return brand.warning(`${analyzer.issueCount} issue${analyzer.issueCount !== 1 ? 's' : ''}`);
        }
        return brand.success('done');
      case 'error':
        return brand.error(analyzer.message || 'failed');
      default:
        return '';
    }
  }
}

/**
 * Results summary with score box
 */
export function results(data: {
  score: number;
  critical: number;
  warnings: number;
  info: number;
  fixable: number;
}) {
  console.log();
  divider();
  console.log();

  // Score bar
  const scoreWidth = 20;
  const filled = Math.round((data.score / 100) * scoreWidth);
  const empty = scoreWidth - filled;
  const bar = brand.primary('█'.repeat(filled)) + brand.dim('░'.repeat(empty));

  const scoreColor = data.score >= 80 ? brand.success :
                     data.score >= 50 ? brand.warning :
                     brand.error;

  console.log(`  ${brand.dim('SCORE')}  ${bar}  ${scoreColor(data.score + '%')}`);
  console.log();

  // Issue counts
  const parts: string[] = [];
  if (data.critical > 0) parts.push(brand.error(`${data.critical} critical`));
  if (data.warnings > 0) parts.push(brand.warning(`${data.warnings} warnings`));
  if (data.info > 0) parts.push(brand.dim(`${data.info} info`));

  if (parts.length > 0) {
    console.log(`  ${parts.join(brand.dim(` ${sym.dot} `))}`);
  }

  if (data.fixable > 0) {
    console.log(`  ${brand.success(`${data.fixable} auto-fixable`)}`);
  }

  console.log();
}

/**
 * Issue list grouped by category
 */
export function issues(gaps: Array<{
  category: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  filePath?: string;
  autoFixable?: boolean;
}>) {
  // Group by category
  const byCategory = new Map<string, typeof gaps>();
  for (const gap of gaps) {
    const existing = byCategory.get(gap.category) || [];
    existing.push(gap);
    byCategory.set(gap.category, existing);
  }

  for (const [category, categoryGaps] of byCategory) {
    console.log(`  ${brand.bold(category)}`);

    for (const gap of categoryGaps.slice(0, 5)) {
      const icon = gap.severity === 'critical' ? brand.error(sym.cross) :
                   gap.severity === 'warning' ? brand.warning(sym.warning) :
                   brand.dim(sym.dot);

      const title = gap.title.length > 55 ? gap.title.slice(0, 52) + '...' : gap.title;
      const fixable = gap.autoFixable ? brand.dim(' [fix]') : '';

      console.log(`    ${icon} ${title}${fixable}`);

      if (gap.filePath) {
        console.log(brand.dim(`      ${gap.filePath}`));
      }
    }

    if (categoryGaps.length > 5) {
      console.log(brand.dim(`    ... and ${categoryGaps.length - 5} more`));
    }
    console.log();
  }
}

/**
 * Call to action
 */
export function cta(message: string, command?: string) {
  console.log();
  if (command) {
    console.log(`  ${brand.dim(sym.arrow)} ${message}  ${brand.primary(command)}`);
  } else {
    console.log(`  ${brand.dim(sym.arrow)} ${message}`);
  }
  console.log();
}

/**
 * Success message
 */
export function success(message: string) {
  console.log(`  ${brand.success(sym.check)} ${message}`);
}

/**
 * Error message
 */
export function error(message: string) {
  console.log(`  ${brand.error(sym.cross)} ${message}`);
}

/**
 * Warning message
 */
export function warning(message: string) {
  console.log(`  ${brand.warning(sym.warning)} ${message}`);
}

/**
 * Info message
 */
export function info(message: string) {
  console.log(`  ${brand.dim(sym.dot)} ${message}`);
}

/**
 * Progress spinner for single operations
 */
export function spinner() {
  return p.spinner();
}

/**
 * Fix progress display
 */
export class FixProgress {
  private current = 0;
  private total = 0;
  private currentGap = '';
  private lineCount = 0;

  constructor(total: number) {
    this.total = total;
  }

  start(gapTitle: string) {
    this.current++;
    this.currentGap = gapTitle.length > 45 ? gapTitle.slice(0, 42) + '...' : gapTitle;
    this.render();
  }

  update(message: string) {
    this.render(message);
  }

  done(filesWritten: number) {
    this.clearLine();
    const files = filesWritten === 1 ? '1 file' : `${filesWritten} files`;
    console.log(`  ${brand.success(sym.check)} ${brand.dim(`[${this.current}/${this.total}]`)} ${this.currentGap} ${brand.dim(`(${files})`)}`);
  }

  fail(error?: string) {
    this.clearLine();
    console.log(`  ${brand.error(sym.cross)} ${brand.dim(`[${this.current}/${this.total}]`)} ${this.currentGap}`);
    if (error) {
      console.log(brand.dim(`      ${error}`));
    }
  }

  private render(message?: string) {
    this.clearLine();
    const status = message || 'analyzing...';
    console.log(`  ${brand.primary(sym.bullet)} ${brand.dim(`[${this.current}/${this.total}]`)} ${this.currentGap}`);
    console.log(brand.dim(`      ${status}`));
    this.lineCount = 2;
  }

  private clearLine() {
    if (this.lineCount > 0) {
      process.stdout.write(`\x1b[${this.lineCount}A\x1b[0J`);
      this.lineCount = 0;
    }
  }
}

/**
 * Issue selector with grouped checkboxes
 */
export interface GapChoice {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  filePath?: string;
}

export async function selectGapsToFix(gaps: GapChoice[]): Promise<string[]> {
  const critical = gaps.filter(g => g.severity === 'critical');
  const warnings = gaps.filter(g => g.severity === 'warning');
  const infoGaps = gaps.filter(g => g.severity === 'info');

  // Track group membership for toggle functionality
  const groupIds: Record<string, string[]> = {
    'group:critical': critical.map(g => g.id),
    'group:warnings': warnings.map(g => g.id),
    'group:info': infoGaps.map(g => g.id),
  };

  // Build choices with group headers as selectable items
  const choices: Array<{ name: string; value: string; checked?: boolean } | typeof Separator.prototype> = [];

  if (critical.length > 0) {
    choices.push({
      name: chalk.red.bold(`■ Critical (${critical.length}) — select to toggle all`),
      value: 'group:critical',
      checked: false,
    });
    for (const gap of critical) {
      const title = gap.title.length > 50 ? gap.title.slice(0, 47) + '...' : gap.title;
      const hint = gap.filePath ? chalk.dim(` ${gap.filePath}`) : '';
      choices.push({
        name: `  ${chalk.red('●')} ${title}${hint}`,
        value: gap.id,
        checked: false,
      });
    }
  }

  if (warnings.length > 0) {
    choices.push({
      name: chalk.yellow.bold(`■ Warnings (${warnings.length}) — select to toggle all`),
      value: 'group:warnings',
      checked: false,
    });
    for (const gap of warnings) {
      const title = gap.title.length > 50 ? gap.title.slice(0, 47) + '...' : gap.title;
      const hint = gap.filePath ? chalk.dim(` ${gap.filePath}`) : '';
      choices.push({
        name: `  ${chalk.yellow('●')} ${title}${hint}`,
        value: gap.id,
        checked: false,
      });
    }
  }

  if (infoGaps.length > 0) {
    choices.push({
      name: chalk.gray.bold(`■ Info (${infoGaps.length}) — select to toggle all`),
      value: 'group:info',
      checked: false,
    });
    for (const gap of infoGaps) {
      const title = gap.title.length > 50 ? gap.title.slice(0, 47) + '...' : gap.title;
      const hint = gap.filePath ? chalk.dim(` ${gap.filePath}`) : '';
      choices.push({
        name: `  ${chalk.gray('●')} ${title}${hint}`,
        value: gap.id,
        checked: false,
      });
    }
  }

  console.log();
  console.log(brand.dim('  ↑/↓ navigate • space select • a toggle all • enter confirm'));
  console.log();

  const selected = await checkbox({
    message: 'Select issues to fix',
    choices,
    pageSize: 20,
    loop: false,
    required: true,
  });

  // Expand group selections to individual gap IDs
  const expandedSelection: string[] = [];
  for (const id of selected) {
    if (id.startsWith('group:') && groupIds[id]) {
      expandedSelection.push(...groupIds[id]);
    } else if (!id.startsWith('group:')) {
      expandedSelection.push(id);
    }
  }

  // Dedupe in case user selected both group and individual items
  return [...new Set(expandedSelection)];
}

// Re-export clack prompts for compatibility
export async function confirm(message: string, initialValue = true): Promise<boolean> {
  const result = await p.confirm({ message: `  ${message}`, initialValue });
  if (p.isCancel(result)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  return result;
}

export async function select<T extends string>(
  message: string,
  options: Array<{ value: T; label: string; hint?: string }>
): Promise<T> {
  const result = await p.select({ message: `  ${message}`, options });
  if (p.isCancel(result)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  return result as T;
}

export async function multiselect<T extends string>(
  message: string,
  options: Array<{ value: T; label: string; hint?: string }>
): Promise<T[]> {
  const result = await p.multiselect({ message: `  ${message}`, options, required: true });
  if (p.isCancel(result)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  return result as T[];
}

export async function text(message: string, placeholder?: string): Promise<string> {
  const result = await p.text({
    message: `  ${message}`,
    placeholder,
  });
  if (p.isCancel(result)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  return result || '';
}

export function intro(title: string) {
  console.log();
  p.intro(brand.bold(title));
}

export function outro(message: string) {
  p.outro(message);
}

export function cancel(message: string) {
  p.cancel(message);
}

export function note(message: string, title?: string) {
  p.note(message, title);
}

export const log = {
  info: (msg: string) => p.log.info(msg),
  success: (msg: string) => p.log.success(msg),
  warning: (msg: string) => p.log.warning(msg),
  error: (msg: string) => p.log.error(msg),
  step: (msg: string) => p.log.step(msg),
  message: (msg: string) => p.log.message(msg),
};

// Legacy compatibility - TaskList is now AnalyzerDisplay
export const TaskList = AnalyzerDisplay;

// Legacy compatibility
export function displayResults(analysis: {
  readinessScore: number;
  gaps: Array<{
    id: string;
    category: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    filePath?: string;
    autoFixable?: boolean;
  }>;
  stack: {
    language: string | null;
    framework: string | null;
    database: string | null;
  };
}) {
  const critical = analysis.gaps.filter(g => g.severity === 'critical').length;
  const warnings = analysis.gaps.filter(g => g.severity === 'warning').length;
  const infoCount = analysis.gaps.filter(g => g.severity === 'info').length;
  const fixable = analysis.gaps.filter(g => g.autoFixable).length;

  results({
    score: analysis.readinessScore,
    critical,
    warnings,
    info: infoCount,
    fixable,
  });

  if (analysis.gaps.length > 0) {
    issues(analysis.gaps);
  }
}
