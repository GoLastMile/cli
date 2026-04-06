import chalk from 'chalk';
import boxen from 'boxen';
import gradient from 'gradient-string';
import Table from 'cli-table3';
import ora, { Ora } from 'ora';

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

interface Classification {
  architecture: { type: string; confidence: number };
  purpose: { type: string; confidence: number };
  features: string[];
  confidence: number;
  signals?: string[];
}

// Analysis step definition
interface AnalysisStep {
  label: string;
  category: string;
}

// Spinner frames for a nicer look
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

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

  // Get confidence color
  const getConfidenceColor = (conf: number) => {
    if (conf >= 80) return chalk.green;
    if (conf >= 50) return chalk.yellow;
    return chalk.dim;
  };

  const archConf = getConfidenceColor(classification.architecture.confidence);
  const purposeConf = getConfidenceColor(classification.purpose.confidence);

  // Architecture and Purpose line
  const archLabel = chalk.cyan.bold(formatType(classification.architecture.type));
  const purposeLabel = chalk.magenta.bold(formatType(classification.purpose.type));

  console.log(
    chalk.dim('  Detected: ') +
    archLabel + chalk.dim(` (${classification.architecture.confidence}%)`) +
    chalk.dim(' + ') +
    purposeLabel + chalk.dim(` (${classification.purpose.confidence}%)`)
  );

  // Features as tags
  if (classification.features.length > 0) {
    const featureTags = classification.features
      .slice(0, 8) // Limit to 8 features to avoid wrapping
      .map(f => chalk.bgGray.white(` ${f} `))
      .join(' ');

    const moreCount = classification.features.length - 8;
    const moreText = moreCount > 0 ? chalk.dim(` +${moreCount} more`) : '';

    console.log(chalk.dim('  Features: ') + featureTags + moreText);
  }

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
 * Print analysis steps (for animated progress) - DEPRECATED, use AnalysisProgress
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

/**
 * Analysis steps with categories for enhanced progress display
 */
const ANALYSIS_STEPS: AnalysisStep[] = [
  { label: 'Scanning project structure', category: 'files' },
  { label: 'Analyzing security patterns', category: 'security' },
  { label: 'Checking security headers', category: 'security-headers' },
  { label: 'Reviewing authentication setup', category: 'auth' },
  { label: 'Analyzing API patterns', category: 'api' },
  { label: 'Reviewing error handling', category: 'errors' },
  { label: 'Analyzing logging patterns', category: 'logging' },
  { label: 'Scanning test coverage', category: 'testing' },
  { label: 'Inspecting dependencies', category: 'dependencies' },
  { label: 'Validating CI/CD pipeline', category: 'cicd' },
  { label: 'Checking build configuration', category: 'build' },
  { label: 'Evaluating observability', category: 'observability' },
  { label: 'Checking environment config', category: 'configuration' },
  { label: 'Validating deployment setup', category: 'deployment' },
  { label: 'Checking health endpoints', category: 'monitoring' },
  { label: 'Analyzing database config', category: 'database' },
  { label: 'Reviewing git configuration', category: 'git' },
  { label: 'Calculating readiness score', category: 'score' },
];

/**
 * Simple analysis progress display using ora spinner
 */
export class AnalysisProgress {
  private spinner: Ora | null = null;
  private completedSteps: string[] = [];
  private currentStepIndex: number = -1;
  private fileCount: number = 0;

  constructor() {}

  /**
   * Start the progress display
   */
  start(fileCount: number = 0): void {
    this.fileCount = fileCount;

    // Print file count header
    if (fileCount > 0) {
      console.log(chalk.dim(`  Found ${fileCount} files to analyze\n`));
    }
  }

  /**
   * Move to next step
   */
  async nextStep(): Promise<void> {
    // Mark current step as done if we have one
    if (this.currentStepIndex >= 0 && this.currentStepIndex < ANALYSIS_STEPS.length) {
      const doneStep = ANALYSIS_STEPS[this.currentStepIndex];
      this.completedSteps.push(doneStep.label);

      // Show completed step
      if (this.spinner) {
        this.spinner.stopAndPersist({
          symbol: chalk.green('✓'),
          text: chalk.dim(doneStep.label),
        });
      }
    }

    // Move to next step
    this.currentStepIndex++;

    if (this.currentStepIndex < ANALYSIS_STEPS.length) {
      const nextStep = ANALYSIS_STEPS[this.currentStepIndex];

      // Start new spinner for this step
      this.spinner = ora({
        text: chalk.white(nextStep.label),
        color: 'magenta',
        spinner: 'dots',
      }).start();
    }

    // Add realistic delay per step (150-350ms)
    const delay = 150 + Math.random() * 200;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Complete all remaining steps quickly (for when API returns)
   */
  async finishRemaining(): Promise<void> {
    while (this.currentStepIndex < ANALYSIS_STEPS.length - 1) {
      await this.nextStep();
      // Faster completion for remaining steps
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Mark last step as done
    if (this.currentStepIndex >= 0 && this.currentStepIndex < ANALYSIS_STEPS.length) {
      const lastStep = ANALYSIS_STEPS[this.currentStepIndex];
      if (this.spinner) {
        this.spinner.stopAndPersist({
          symbol: chalk.green('✓'),
          text: chalk.dim(lastStep.label),
        });
        this.spinner = null;
      }
    }
  }

  /**
   * Stop the progress display
   */
  stop(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }
}

/**
 * Print a quick summary of findings before detailed table
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
      const icon = getCategoryIcon(cat);
      parts.push(`${icon} ${count} ${cat}`);
    }
  }

  // Any remaining categories
  for (const [cat, count] of categories) {
    if (!orderedCategories.includes(cat)) {
      parts.push(`${count} ${cat}`);
    }
  }

  console.log(chalk.dim('  Found: ') + parts.join(chalk.dim(' · ')));
  console.log();
}

/**
 * Get an icon for a category
 */
function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    security: '🔒',
    auth: '🔑',
    testing: '🧪',
    observability: '📊',
    cicd: '🚀',
    dependencies: '📦',
    git: '📝',
    errors: '⚠️',
  };
  return icons[category] || '•';
}
