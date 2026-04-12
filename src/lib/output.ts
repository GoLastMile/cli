import chalk from 'chalk';
import boxen from 'boxen';
import gradient from 'gradient-string';
import ora, { Ora } from 'ora';
import type { Gap, Classification } from './types.js';

// Check for NO_COLOR environment variable (accessibility)
const noColor = process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb';

// Safe chalk wrapper that respects NO_COLOR
// Note: We use a custom wrapper instead of chalk.level=0 for more granular control
const c = noColor ? {
  red: (s: string) => s,
  yellow: (s: string) => s,
  green: (s: string) => s,
  blue: (s: string) => s,
  cyan: (s: string) => s,
  magenta: (s: string) => s,
  white: (s: string) => s,
  gray: (s: string) => s,
  dim: (s: string) => s,
  bold: (s: string) => s,
  bgRed: { white: { bold: (s: string) => s } },
  bgYellow: { black: { bold: (s: string) => s } },
  bgBlue: { white: { bold: (s: string) => s } },
  bgGray: { white: (s: string) => s },
} : chalk;

interface AnalysisStats {
  fileCount: number;
  durationMs: number;
  gapCount: number;
  fixableCount: number;
}

// Get terminal width with fallback
function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

// Custom gradient for LastMile branding
const lastmileGradient = noColor
  ? { multiline: (s: string) => s }
  : gradient(['#667eea', '#764ba2']);

/**
 * Create a clickable file link (supported by many terminals)
 * Format: \e]8;;file://path\e\\text\e]8;;\e\\
 */
function fileLink(filePath: string, lineNumber?: number): string {
  const displayPath = filePath;
  const fullPath = filePath.startsWith('/') ? filePath : `${process.cwd()}/${filePath}`;
  const lineStr = lineNumber ? `:${lineNumber}` : '';

  // OSC 8 hyperlink format (supported by iTerm2, Windows Terminal, many others)
  if (process.stdout.isTTY && !noColor) {
    return `\x1b]8;;file://${fullPath}${lineStr}\x1b\\${chalk.dim(displayPath)}${lineNumber ? chalk.dim(`:${lineNumber}`) : ''}\x1b]8;;\x1b\\`;
  }
  return chalk.dim(`${displayPath}${lineStr}`);
}

/**
 * Print the LastMile header banner
 */
export function printHeader(): void {
  const title = lastmileGradient.multiline(`
  _              _   __  __ _ _
 | |    __ _ ___| |_|  \\/  (_) | ___
 | |   / _\` / __| __| |\\/| | | |/ _ \\
 | |__| (_| \\__ \\ |_| |  | | | |  __/
 |_____\\__,_|___/\\__|_|  |_|_|_|\\___|
`);

  // Center the taglines within the box (ASCII art is ~37 chars wide)
  const line1 = 'You build the product.';
  const line2 = 'We handle the tedious parts.';
  const boxWidth = 37;
  const pad1 = ' '.repeat(Math.floor((boxWidth - line1.length) / 2));
  const pad2 = ' '.repeat(Math.floor((boxWidth - line2.length) / 2));

  if (noColor) {
    console.log(title);
    console.log(`${pad1}${line1}\n${pad2}${line2}\n`);
  } else {
    const tagline = chalk.dim(`${pad1}${line1}`) + '\n' + chalk.cyan(`${pad2}${line2}`);
    console.log(boxen(title + '\n' + tagline, {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      borderStyle: 'round',
      borderColor: 'magenta',
    }));
    console.log();
  }
}

/**
 * Create a visual progress bar
 */
function createProgressBar(score: number, width: number = 30): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;

  if (noColor) {
    return '[' + '='.repeat(filled) + '-'.repeat(empty) + ']';
  }

  let color: (text: string) => string;
  if (score >= 80) {
    color = chalk.green;
  } else if (score >= 50) {
    color = chalk.yellow;
  } else {
    color = chalk.red;
  }

  const filledBar = color('█'.repeat(filled));
  const emptyBar = chalk.gray('░'.repeat(empty));

  return `${filledBar}${emptyBar}`;
}

/**
 * Print the readiness score with a progress bar
 */
export function printScore(score: number): void {
  const progressBar = createProgressBar(score);

  let scorePaint: (s: string) => string;
  let emoji: string;
  let status: string;

  if (score >= 80) {
    scorePaint = noColor ? (s: string) => s : chalk.green.bold;
    emoji = noColor ? '[OK]' : '🎉';
    status = 'Production Ready!';
  } else if (score >= 50) {
    scorePaint = noColor ? (s: string) => s : chalk.yellow.bold;
    emoji = noColor ? '[!!]' : '🔧';
    status = 'Needs Work';
  } else {
    scorePaint = noColor ? (s: string) => s : chalk.red.bold;
    emoji = noColor ? '[XX]' : '🚨';
    status = 'Not Ready';
  }

  if (noColor) {
    console.log(`${emoji} Readiness Score: ${score}/100 - ${status}`);
    console.log(`   ${progressBar}`);
    console.log();
  } else {
    const scoreBox = boxen(
      `${emoji}  Readiness Score: ${scorePaint(`${score}/100`)}  ${chalk.dim(status)}\n\n   ${progressBar}`,
      {
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        borderStyle: 'round',
        borderColor: score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red',
      }
    );
    console.log(scoreBox);
    console.log();
  }
}

/**
 * Print analysis stats summary line
 */
export function printStats(stats: AnalysisStats): void {
  const duration = (stats.durationMs / 1000).toFixed(1);
  const fixableText = stats.fixableCount > 0
    ? (noColor ? `, ${stats.fixableCount} auto-fixable` : `, ${chalk.cyan(stats.fixableCount.toString())} auto-fixable`)
    : '';

  const line = noColor
    ? `  ${stats.fileCount} files analyzed in ${duration}s | ${stats.gapCount} issues found${fixableText}`
    : chalk.dim(`  ${stats.fileCount} files analyzed in ${duration}s`) +
      chalk.dim(' | ') +
      chalk.white(`${stats.gapCount} issues found`) +
      fixableText;

  console.log(line);
  // Extra spacing after stats before findings
  console.log();
  console.log();
}

/**
 * Print the app classification info
 */
export function printClassification(classification: Classification): void {
  // Format architecture type (e.g., "api-only" -> "API Only")
  const formatType = (type: string): string => {
    return type
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const archLabel = noColor
    ? formatType(classification.architecture.type)
    : chalk.cyan.bold(formatType(classification.architecture.type));
  const purposeLabel = noColor
    ? formatType(classification.purpose.type)
    : chalk.magenta.bold(formatType(classification.purpose.type));

  const line = noColor
    ? `  Detected: ${archLabel} (${classification.architecture.confidence}%) + ${purposeLabel} (${classification.purpose.confidence}%)`
    : chalk.dim('  Detected: ') +
      archLabel + chalk.dim(` (${classification.architecture.confidence}%)`) +
      chalk.dim(' + ') +
      purposeLabel + chalk.dim(` (${classification.purpose.confidence}%)`);

  console.log(line);

  // Features as tags with intelligent wrapping
  if (classification.features.length > 0) {
    const termWidth = getTerminalWidth();
    const prefixText = '  Features: ';
    const prefix = noColor ? prefixText : chalk.dim(prefixText);
    const indent = '            '; // Same width as "  Features: "
    const maxFeatures = 12;
    const displayFeatures = classification.features.slice(0, maxFeatures);

    let currentLine = prefix;
    const lines: string[] = [];

    displayFeatures.forEach((f, i) => {
      const tag = noColor ? `[${f}]` : chalk.bgGray.white(` ${f} `);
      const tagLen = f.length + 3; // Account for brackets/padding

      // Estimate current line length (strip ANSI codes)
      const currentLen = currentLine.replace(/\x1b\[[0-9;]*m/g, '').length;
      const isFirstTag = currentLen === prefixText.length;

      if (currentLen + tagLen + 1 > termWidth - 2 && !isFirstTag) {
        lines.push(currentLine);
        currentLine = indent + tag;
      } else {
        currentLine += (isFirstTag ? '' : ' ') + tag;
      }
    });

    // Add "+N more" if needed
    const moreCount = classification.features.length - maxFeatures;
    if (moreCount > 0) {
      const moreText = noColor ? `+${moreCount} more` : chalk.dim(`+${moreCount} more`);
      currentLine += ' ' + moreText;
    }

    if (currentLine.trim()) {
      lines.push(currentLine);
    }

    console.log(lines.join('\n'));
  }

  // Extra spacing after classification block
  console.log();
  console.log();
}

/**
 * Format gaps in a clean list format (replaces table)
 */
export function formatGaps(gaps: Gap[]): string {
  const termWidth = getTerminalWidth();

  // Group by severity
  const critical = gaps.filter(g => g.severity === 'critical');
  const warnings = gaps.filter(g => g.severity === 'warning');
  const info = gaps.filter(g => g.severity === 'info');

  const sections: string[] = [];

  if (critical.length > 0) {
    sections.push(formatGapSection(critical, 'critical', termWidth));
  }
  if (warnings.length > 0) {
    sections.push(formatGapSection(warnings, 'warning', termWidth));
  }
  if (info.length > 0) {
    sections.push(formatGapSection(info, 'info', termWidth));
  }

  return sections.join('\n\n');
}

/**
 * Format a section of gaps with compact, scannable layout
 * Inspired by ESLint's stylish formatter
 */
function formatGapSection(gaps: Gap[], severity: 'critical' | 'warning' | 'info', termWidth: number): string {
  const config = {
    critical: {
      label: noColor ? 'CRITICAL' : chalk.red.bold('CRITICAL'),
      color: noColor ? (s: string) => s : chalk.red,
      icon: noColor ? 'x' : '✗',
    },
    warning: {
      label: noColor ? 'WARNING' : chalk.yellow.bold('WARNING'),
      color: noColor ? (s: string) => s : chalk.yellow,
      icon: noColor ? '!' : '⚠',
    },
    info: {
      label: noColor ? 'INFO' : chalk.blue.bold('INFO'),
      color: noColor ? (s: string) => s : chalk.blue,
      icon: noColor ? 'i' : '●',
    },
  };

  const cfg = config[severity];
  const lines: string[] = [];

  // Compact header: "CRITICAL (1)" or "WARNING (9)"
  const countText = noColor
    ? `(${gaps.length})`
    : chalk.dim(`(${gaps.length})`);
  lines.push(`${cfg.label} ${countText}`);
  lines.push(''); // blank line after header

  // Calculate max title length for alignment (cap at reasonable width)
  const maxTitleLen = Math.min(
    Math.max(...gaps.map(g => g.title.length)),
    termWidth - 40 // leave room for file path
  );

  // Each gap on 1-2 lines max
  gaps.forEach((gap) => {
    const icon = noColor ? cfg.icon : cfg.color(cfg.icon);
    const title = noColor ? gap.title : cfg.color(gap.title);
    const categoryTag = noColor ? `[${gap.category}]` : chalk.dim(`[${gap.category}]`);
    const fixableTag = gap.autoFixable ? (noColor ? ' [fixable]' : chalk.green(' [fixable]')) : '';

    if (gap.filePath) {
      // With file: title on line 1, file + category on line 2
      const fileStr = gap.lineNumber ? `${gap.filePath}:${gap.lineNumber}` : gap.filePath;
      const filePart = noColor ? fileStr : chalk.dim(fileStr);
      lines.push(`  ${icon} ${title}`);
      lines.push(`    ${filePart} ${categoryTag}${fixableTag}`);
    } else {
      // No file: title + category on same line
      lines.push(`  ${icon} ${title} ${categoryTag}${fixableTag}`);
    }

    // Suggested fix (shorter, more actionable)
    if (gap.suggestedFix) {
      const arrow = noColor ? '->' : chalk.dim('→');
      const fix = noColor ? gap.suggestedFix : chalk.cyan(gap.suggestedFix);
      lines.push(`    ${arrow} ${fix}`);
    }
  });

  return lines.join('\n');
}

/**
 * Print a quick summary of findings before detailed list
 */
export function printSummary(gaps: Gap[]): void {
  const categories = new Map<string, number>();

  for (const gap of gaps) {
    categories.set(gap.category, (categories.get(gap.category) || 0) + 1);
  }

  if (categories.size === 0) return;

  const parts: string[] = [];

  // Order: security first, then alphabetical
  const orderedCategories = ['security', 'auth', 'testing', 'observability', 'cicd', 'dependencies', 'git', 'errors'];

  for (const cat of orderedCategories) {
    const count = categories.get(cat);
    if (count) {
      const icon = noColor ? '' : getCategoryIcon(cat);
      parts.push(`${icon}${count} ${cat}`);
    }
  }

  // Any remaining categories
  for (const [cat, count] of categories) {
    if (!orderedCategories.includes(cat)) {
      const icon = noColor ? '' : getCategoryIcon(cat);
      parts.push(`${icon}${count} ${cat}`);
    }
  }

  // Display vertically for better readability
  const header = noColor ? '  Found:' : chalk.dim('  Found:');
  console.log(header);

  parts.forEach(part => {
    const line = noColor ? `    ${part}` : chalk.dim(`    ${part}`);
    console.log(line);
  });

  console.log();
}

/**
 * Get an icon for a category
 * Returns empty string - emojis removed due to inconsistent terminal rendering
 */
function getCategoryIcon(_category: string): string {
  // Emojis disabled - they have inconsistent widths across terminals
  // causing alignment issues that can't be reliably fixed
  return '';
}

/**
 * Print a summary footer
 */
export function printFooter(gapCount: number): void {
  console.log();
  if (gapCount > 0) {
    if (noColor) {
      console.log('  Run `lastmile fix` to auto-fix issues');
      console.log('  Run `lastmile fix --interactive` for guided fixes');
    } else {
      console.log(boxen(
        chalk.dim('Run ') + chalk.cyan.bold('lastmile fix') + chalk.dim(' to auto-fix issues\n') +
        chalk.dim('Run ') + chalk.cyan.bold('lastmile fix --interactive') + chalk.dim(' for guided fixes'),
        {
          padding: { top: 0, bottom: 0, left: 1, right: 1 },
          borderStyle: 'round',
          borderColor: 'cyan',
          dimBorder: true,
        }
      ));
    }
  } else {
    if (noColor) {
      console.log('  [OK] Your project is production-ready!');
    } else {
      console.log(boxen(
        chalk.green.bold('🎉 Your project is production-ready!'),
        {
          padding: { top: 0, bottom: 0, left: 1, right: 1 },
          borderStyle: 'round',
          borderColor: 'green',
        }
      ));
    }
  }
  console.log();
}

// Analysis phases (reduced from 18 to 5)
const ANALYSIS_PHASES = [
  { label: 'Scanning project structure', items: ['files', 'structure'] },
  { label: 'Analyzing security & auth', items: ['security', 'auth', 'headers'] },
  { label: 'Checking code quality', items: ['errors', 'testing', 'logging'] },
  { label: 'Reviewing infrastructure', items: ['cicd', 'dependencies', 'build'] },
  { label: 'Evaluating production readiness', items: ['observability', 'deployment', 'score'] },
];

/**
 * Simplified analysis progress display with X/Y pattern
 */
export class AnalysisProgress {
  private spinner: Ora | null = null;
  private currentPhase: number = 0;
  private fileCount: number = 0;
  private startTime: number = 0;
  private totalPhases: number = ANALYSIS_PHASES.length;

  constructor() {}

  /**
   * Start the progress display
   */
  start(fileCount: number = 0): number {
    this.fileCount = fileCount;
    this.startTime = Date.now();
    this.currentPhase = 0;

    // Print file count header
    if (fileCount > 0) {
      const msg = noColor
        ? `  Found ${fileCount} files to analyze\n`
        : chalk.dim(`  Found ${fileCount} files to analyze\n`);
      console.log(msg);
    }

    return this.startTime;
  }

  /**
   * Move to next phase
   */
  async nextPhase(): Promise<void> {
    // Mark current phase as done if we have one
    if (this.currentPhase > 0 && this.currentPhase <= this.totalPhases) {
      const donePhase = ANALYSIS_PHASES[this.currentPhase - 1];

      if (this.spinner) {
        this.spinner.stopAndPersist({
          symbol: noColor ? '[OK]' : chalk.green('✓'),
          text: noColor ? donePhase.label : chalk.dim(donePhase.label),
        });
      }
    }

    // Move to next phase
    this.currentPhase++;

    if (this.currentPhase <= this.totalPhases) {
      const nextPhase = ANALYSIS_PHASES[this.currentPhase - 1];
      const progress = noColor
        ? `[${this.currentPhase}/${this.totalPhases}]`
        : chalk.dim(`[${this.currentPhase}/${this.totalPhases}]`);

      // Start new spinner for this phase
      this.spinner = ora({
        text: noColor
          ? `${nextPhase.label} ${progress}`
          : chalk.white(nextPhase.label) + ' ' + progress,
        color: noColor ? undefined : 'magenta',
        spinner: noColor ? 'line' : 'dots',
      }).start();
    }

    // Add realistic delay per phase (200-400ms)
    const delay = 200 + Math.random() * 200;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Complete all remaining phases quickly (for when API returns)
   */
  async finishRemaining(): Promise<void> {
    while (this.currentPhase < this.totalPhases) {
      await this.nextPhase();
      // Faster completion for remaining phases
      await new Promise(resolve => setTimeout(resolve, 80));
    }

    // Mark last phase as done
    if (this.currentPhase === this.totalPhases && this.spinner) {
      const lastPhase = ANALYSIS_PHASES[this.totalPhases - 1];
      this.spinner.stopAndPersist({
        symbol: noColor ? '[OK]' : chalk.green('✓'),
        text: noColor ? lastPhase.label : chalk.dim(lastPhase.label),
      });
      this.spinner = null;
    }
  }

  /**
   * Stop the progress display and return duration
   */
  stop(): number {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
    return Date.now() - this.startTime;
  }

  /**
   * Get elapsed time in ms
   */
  getElapsedTime(): number {
    return Date.now() - this.startTime;
  }
}

// Legacy exports for backwards compatibility
export function getAnalysisSteps(): string[] {
  return ANALYSIS_PHASES.map(p => p.label + '...');
}
