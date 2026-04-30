/**
 * CLI UI using @clack/prompts
 *
 * Inspired by PostHog wizard patterns but using clack for simplicity.
 */

import * as p from '@clack/prompts';
import chalk from 'chalk';

// Icons (Unicode)
const Icons = {
  check: '✔',
  cross: '✘',
  warning: '⚠',
  info: 'ℹ',
  arrow: '▶',
  bullet: '•',
  diamond: '◆',
  square: '■',
  squareOpen: '□',
};

// Colors
const Colors = {
  primary: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  dim: chalk.dim,
  bold: chalk.bold,
};

export interface AgentStatus {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  message?: string;
  gapCount?: number;
  iterations?: number;
  tokensUsed?: number;
}

/**
 * Format agent status for display
 */
function formatAgentLine(agent: AgentStatus): string {
  const icon = agent.status === 'done' ? Colors.success(Icons.check) :
               agent.status === 'error' ? Colors.error(Icons.cross) :
               agent.status === 'running' ? Colors.primary(Icons.arrow) :
               Colors.dim(Icons.squareOpen);

  const name = agent.status === 'running' ? Colors.primary(agent.name) :
               agent.status === 'done' ? Colors.success(agent.name) :
               agent.status === 'error' ? Colors.error(agent.name) :
               Colors.dim(agent.name);

  let suffix = '';
  if (agent.status === 'done' && agent.gapCount !== undefined) {
    suffix = Colors.dim(` (${agent.gapCount} gaps)`);
  } else if (agent.status === 'running' && agent.message) {
    suffix = Colors.dim(` ${agent.message}`);
  } else if (agent.status === 'error' && agent.message) {
    suffix = Colors.error(` ${agent.message}`);
  }

  return `${icon} ${name}${suffix}`;
}

/**
 * Intro banner
 */
export function intro(title: string) {
  console.log();
  p.intro(Colors.bold(title));
}

/**
 * Outro message
 */
export function outro(message: string) {
  p.outro(message);
}

/**
 * Log messages
 */
export const log = {
  info: (message: string) => p.log.info(message),
  success: (message: string) => p.log.success(message),
  warning: (message: string) => p.log.warning(message),
  error: (message: string) => p.log.error(message),
  step: (message: string) => p.log.step(message),
  message: (message: string) => p.log.message(message),
};

/**
 * Spinner for single operations
 */
export function spinner() {
  return p.spinner();
}

/**
 * Display analysis results
 */
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
  projectAnalysis?: {
    framework?: { name: string };
    architecture?: { type: string };
    database?: { type: string };
  };
}) {
  console.log();

  // Stack detection
  if (analysis.projectAnalysis?.framework?.name) {
    const framework = analysis.projectAnalysis.framework.name;
    const arch = analysis.projectAnalysis.architecture?.type || 'unknown';
    const db = analysis.projectAnalysis.database?.type || 'none';
    p.log.info(`${Colors.bold('Stack:')} ${framework} | ${arch} | DB: ${db}`);
  }

  // Score
  const score = analysis.readinessScore;
  const scoreColor = score >= 80 ? Colors.success :
                     score >= 50 ? Colors.warning :
                     Colors.error;
  const bar = renderProgressBar(score, 20);
  p.log.message(`${Colors.bold('Readiness:')} ${bar} ${scoreColor(`${score}/100`)}`);

  // Gaps summary
  const critical = analysis.gaps.filter(g => g.severity === 'critical').length;
  const warnings = analysis.gaps.filter(g => g.severity === 'warning').length;
  const info = analysis.gaps.filter(g => g.severity === 'info').length;
  const fixable = analysis.gaps.filter(g => g.autoFixable).length;

  console.log();
  p.log.message(Colors.bold('Issues Found:'));

  if (critical > 0) {
    p.log.error(`  ${critical} critical`);
  }
  if (warnings > 0) {
    p.log.warning(`  ${warnings} warnings`);
  }
  if (info > 0) {
    p.log.info(`  ${info} info`);
  }

  // List gaps by category
  const byCategory = new Map<string, typeof analysis.gaps>();
  for (const gap of analysis.gaps) {
    const existing = byCategory.get(gap.category) || [];
    existing.push(gap);
    byCategory.set(gap.category, existing);
  }

  console.log();
  for (const [category, gaps] of byCategory) {
    console.log(Colors.bold(`  ${category}`));
    for (const gap of gaps.slice(0, 5)) {
      const icon = gap.severity === 'critical' ? Colors.error(Icons.cross) :
                   gap.severity === 'warning' ? Colors.warning(Icons.warning) :
                   Colors.dim(Icons.info);
      const fixableTag = gap.autoFixable ? Colors.success(' [fixable]') : '';
      console.log(`    ${icon} ${gap.title}${fixableTag}`);
      if (gap.filePath) {
        console.log(Colors.dim(`      ${gap.filePath}`));
      }
    }
    if (gaps.length > 5) {
      console.log(Colors.dim(`    ... and ${gaps.length - 5} more`));
    }
  }

  // Next steps
  if (fixable > 0) {
    console.log();
    p.log.success(`${fixable} issue(s) can be auto-fixed`);
    console.log(Colors.dim(`  Run: ${Colors.primary('lastmile fix')}`));
  }
}

/**
 * Render a progress bar
 */
function renderProgressBar(value: number, width: number): string {
  const filled = Math.round((value / 100) * width);
  const empty = width - filled;
  const filledChar = '█'; // Full block
  const emptyChar = '░'; // Light shade

  const color = value >= 80 ? Colors.success :
                value >= 50 ? Colors.warning :
                Colors.error;

  return color(filledChar.repeat(filled)) + Colors.dim(emptyChar.repeat(empty));
}

/**
 * Task list for showing multiple parallel operations
 */
export class TaskList {
  private agents: Map<string, AgentStatus> = new Map();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastOutput: string = '';

  constructor(private title?: string) {}

  addAgent(id: string, name: string) {
    this.agents.set(id, { id, name, status: 'pending' });
  }

  updateAgent(id: string, update: Partial<AgentStatus>) {
    const agent = this.agents.get(id);
    if (agent) {
      Object.assign(agent, update);
    }
  }

  start() {
    this.render();
    this.intervalId = setInterval(() => this.render(), 100);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.render(true);
  }

  private render(final: boolean = false) {
    const lines: string[] = [];

    if (this.title) {
      lines.push(Colors.bold(this.title));
    }

    const done = Array.from(this.agents.values()).filter(a => a.status === 'done').length;
    const total = this.agents.size;

    for (const agent of this.agents.values()) {
      lines.push(formatAgentLine(agent));
    }

    if (!final && done < total) {
      lines.push('');
      lines.push(Colors.dim(`Progress: ${done}/${total} complete`));
    }

    const output = lines.join('\n');

    // Clear previous output and write new
    if (this.lastOutput) {
      const lineCount = this.lastOutput.split('\n').length;
      process.stdout.write(`\x1b[${lineCount}A\x1b[0J`);
    }

    console.log(output);
    this.lastOutput = output;
  }
}

/**
 * Confirm prompt
 */
export async function confirm(message: string, initialValue: boolean = true): Promise<boolean> {
  const result = await p.confirm({ message, initialValue });
  if (p.isCancel(result)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  return result;
}

/**
 * Select prompt
 */
export async function select<T extends string>(
  message: string,
  options: Array<{ value: T; label: string; hint?: string }>
): Promise<T> {
  const result = await p.select({ message, options });
  if (p.isCancel(result)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  return result as T;
}

/**
 * Text input prompt
 */
export async function text(
  message: string,
  options?: { placeholder?: string; defaultValue?: string }
): Promise<string> {
  const result = await p.text({ message, ...options });
  if (p.isCancel(result)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  return result;
}

/**
 * Multi-select prompt
 */
export async function multiselect<T extends string>(
  message: string,
  options: Array<{ value: T; label: string; hint?: string }>
): Promise<T[]> {
  const result = await p.multiselect({ message, options });
  if (p.isCancel(result)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  return result as T[];
}

/**
 * Note box
 */
export function note(message: string, title?: string) {
  p.note(message, title);
}

/**
 * Cancel message
 */
export function cancel(message: string) {
  p.cancel(message);
}
