import chalk from 'chalk';
import boxen from 'boxen';
import gradient from 'gradient-string';
import Table from 'cli-table3';

interface Gap {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  filePath?: string;
  lineNumber?: number;
  description: string;
  suggestedFix?: string;
}

// Custom gradient for LastMile branding
const lastmileGradient = gradient(['#667eea', '#764ba2']);

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

  console.log(boxen(title + '\n' + chalk.dim('  Production Readiness Analyzer'), {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    borderStyle: 'round',
    borderColor: 'magenta',
  }));
  console.log();
}

/**
 * Create a visual progress bar
 */
function createProgressBar(score: number, width: number = 30): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;

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

  let scorePaint: typeof chalk.green.bold;
  let emoji: string;
  let status: string;

  if (score >= 80) {
    scorePaint = chalk.green.bold;
    emoji = '🎉';
    status = 'Production Ready!';
  } else if (score >= 50) {
    scorePaint = chalk.yellow.bold;
    emoji = '🔧';
    status = 'Needs Work';
  } else {
    scorePaint = chalk.red.bold;
    emoji = '🚨';
    status = 'Not Ready';
  }

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

/**
 * Format gaps grouped by severity with nice visual presentation
 */
export function formatGaps(gaps: Gap[], minSeverity: string = 'info'): string {
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  const minOrder = severityOrder[minSeverity] ?? 2;

  const filtered = gaps.filter(g => severityOrder[g.severity] <= minOrder);

  // Group by severity
  const critical = filtered.filter(g => g.severity === 'critical');
  const warnings = filtered.filter(g => g.severity === 'warning');
  const info = filtered.filter(g => g.severity === 'info');

  const sections: string[] = [];

  if (critical.length > 0) {
    sections.push(formatSection(critical, 'critical'));
  }
  if (warnings.length > 0) {
    sections.push(formatSection(warnings, 'warning'));
  }
  if (info.length > 0) {
    sections.push(formatSection(info, 'info'));
  }

  return sections.join('\n\n');
}

/**
 * Format a section with a colored table
 */
function formatSection(gaps: Gap[], severity: 'critical' | 'warning' | 'info'): string {
  const config = {
    critical: {
      label: chalk.bgRed.white.bold(' CRITICAL '),
      color: chalk.red,
      borderColor: 'red',
      icon: '✗',
    },
    warning: {
      label: chalk.bgYellow.black.bold(' WARNING '),
      color: chalk.yellow,
      borderColor: 'yellow',
      icon: '⚠',
    },
    info: {
      label: chalk.bgBlue.white.bold(' INFO '),
      color: chalk.blue,
      borderColor: 'gray',
      icon: '●',
    },
  };

  const cfg = config[severity];

  // Header with count
  const header = `${cfg.label} ${chalk.white.bold(gaps.length.toString())} ${chalk.dim(gaps.length === 1 ? 'issue' : 'issues')}`;

  // Create table
  const table = new Table({
    chars: {
      'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
      'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
      'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
      'right': '│', 'right-mid': '┤', 'middle': '│'
    },
    style: {
      head: [],
      border: [cfg.borderColor],
      'padding-left': 1,
      'padding-right': 1,
    },
    colWidths: [45, 40],
    wordWrap: true,
  });

  // Add rows
  gaps.forEach(gap => {
    const icon = cfg.color(cfg.icon);
    const title = cfg.color.bold(gap.title);
    const file = gap.filePath ? `\n${chalk.dim(gap.filePath)}` : '';
    const fix = gap.suggestedFix ? chalk.cyan(gap.suggestedFix) : chalk.dim('—');

    table.push([
      `${icon} ${title}${file}`,
      fix,
    ]);
  });

  return `${header}\n${table.toString()}`;
}

/**
 * Print a summary footer
 */
export function printFooter(gapCount: number): void {
  console.log();
  if (gapCount > 0) {
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
  console.log();
}

/**
 * Print analysis steps (for animated progress)
 */
export function getAnalysisSteps(): string[] {
  return [
    'Scanning project files...',
    'Detecting security vulnerabilities...',
    'Checking authentication patterns...',
    'Analyzing error handling...',
    'Reviewing dependencies...',
    'Checking CI/CD configuration...',
    'Evaluating observability setup...',
    'Calculating readiness score...',
  ];
}
