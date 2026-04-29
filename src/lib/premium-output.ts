/**
 * Premium CLI Output
 *
 * Extravagant, polished terminal UI for LastMile
 */

import chalk from 'chalk';
import cfonts from 'cfonts';
import chalkAnimation from 'chalk-animation';
import gradient from 'gradient-string';
import type { Gap, ProjectAnalysis } from './types.js';

// Check for NO_COLOR environment variable (accessibility)
const noColor = process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb';

// LastMile Brand Colors (from web/src/app/globals.css)
const BRAND = {
  primary: '#5ae88a',        // Green - main accent, success
  primaryDim: '#45d478',     // Darker green
  secondary: '#ffc640',      // Gold/Yellow - warnings, secondary
  error: '#ffb4ab',          // Coral - errors
  surface: '#131314',        // Dark background
  onSurface: '#e5e2e3',      // Light text
  outline: '#869486',        // Borders, dim elements
  surfaceVariant: '#353436', // Slightly lighter surface
};

// Chalk with brand colors
const brand = {
  primary: chalk.hex(BRAND.primary),
  primaryBold: chalk.hex(BRAND.primary).bold,
  secondary: chalk.hex(BRAND.secondary),
  secondaryBold: chalk.hex(BRAND.secondary).bold,
  error: chalk.hex(BRAND.error),
  errorBold: chalk.hex(BRAND.error).bold,
  text: chalk.hex(BRAND.onSurface),
  dim: chalk.hex(BRAND.outline),
  muted: chalk.dim,
};

// Get terminal width with fallback
function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

// Box drawing characters
const BOX = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  teeRight: '├',
  teeLeft: '┤',
  cornerBottomRight: '└',
};

const ICONS = {
  success: brand.primary('✓'),
  running: brand.secondary('●'),
  pending: brand.dim('◌'),
  error: brand.error('✗'),
  warning: brand.secondary('⚠'),
  info: brand.primary('●'),
  arrow: brand.primary('→'),
  tree: brand.dim('├─'),
  treeLast: brand.dim('└─'),
};

// Helper to apply color by name (maps to brand colors)
function applyColor(text: string, color: string, bold: boolean = false): string {
  if (color === 'primary' || color === 'green' || color === 'cyan') {
    return bold ? brand.primaryBold(text) : brand.primary(text);
  }
  if (color === 'secondary' || color === 'yellow' || color === 'warning') {
    return bold ? brand.secondaryBold(text) : brand.secondary(text);
  }
  if (color === 'error' || color === 'red') {
    return bold ? brand.errorBold(text) : brand.error(text);
  }
  return bold ? brand.text(text) : brand.text(text);
}

/**
 * Print a section header with underline
 */
function sectionHeader(title: string, color: (s: string) => string = brand.primary): void {
  console.log();
  console.log(color(`  ${title}`));
  console.log(brand.dim(`  ${'─'.repeat(title.length)}`));
}

/**
 * Print animated header with cfonts
 */
export async function printPremiumHeader(): Promise<void> {
  if (noColor) {
    console.log('\n  LASTMILE\n  Vibe-code to Production\n');
    return;
  }

  // Use cfonts with brand colors (green to gold gradient)
  cfonts.say('LastMile', {
    font: 'tiny',
    colors: [BRAND.primary, BRAND.secondary],
    background: 'transparent',
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    gradient: [BRAND.primary, BRAND.secondary],
    transitionGradient: true,
  });

  // Animated tagline
  const animation = chalkAnimation.rainbow('  Vibe-code to Production');
  await new Promise(resolve => setTimeout(resolve, 1500));
  animation.stop();

  // Replace with static gradient using brand colors
  const lastmileGradient = gradient([BRAND.primary, BRAND.secondary]);
  console.log(lastmileGradient('  Vibe-code to Production'));
  console.log();
}

/**
 * Print simple header (non-animated, for when streaming starts)
 */
export function printHeader(): void {
  if (noColor) {
    console.log('\n  LASTMILE\n');
    return;
  }

  cfonts.say('LastMile', {
    font: 'tiny',
    colors: [BRAND.primary, BRAND.secondary],
    background: 'transparent',
    letterSpacing: 1,
    lineHeight: 1,
    space: false,
    gradient: [BRAND.primary, BRAND.secondary],
    transitionGradient: true,
  });
}

/**
 * Print file count
 */
export function printFileCount(count: number): void {
  console.log(brand.dim(`  Scanning ${brand.text(count.toString())} files...\n`));
}

/**
 * Print stack detection results
 */
export function printStackDetection(analysis: ProjectAnalysis): void {
  sectionHeader('Stack Detected', brand.primary);

  const labelWidth = 12;
  const pad = (label: string) => label.padEnd(labelWidth);

  // Framework
  if (analysis.framework) {
    let fw = analysis.framework.name;
    if (analysis.framework.variant) fw += ` (${analysis.framework.variant})`;
    console.log(`  ${brand.dim(pad('Framework'))}${brand.primaryBold(fw)}`);
  }

  // Languages
  if (analysis.languages.length > 0) {
    const langs = analysis.languages.slice(0, 2).map(l => l.name).join(' + ');
    console.log(`  ${brand.dim(pad('Languages'))}${brand.text(langs)}`);
  }

  // Database - keep it concise
  if (analysis.database) {
    const parts: string[] = [];
    // Only show provider if it's a known hosted service
    const knownProviders = ['Supabase', 'Neon', 'PlanetScale', 'Railway', 'Vercel Postgres'];
    if (analysis.database.provider && knownProviders.some(p => analysis.database!.provider!.includes(p))) {
      parts.push(analysis.database.provider);
    } else if (analysis.database.type) {
      parts.push(analysis.database.type);
    }
    if (analysis.database.orm) {
      parts.push(analysis.database.orm);
    }
    const db = parts.join(' + ') || 'Unknown';
    console.log(`  ${brand.dim(pad('Database'))}${brand.primary(db)}`);
  }

  // Auth
  if (analysis.auth?.provider) {
    console.log(`  ${brand.dim(pad('Auth'))}${brand.secondary(analysis.auth.provider)}`);
  }

  // API style
  if (analysis.api?.style) {
    console.log(`  ${brand.dim(pad('API'))}${brand.text(analysis.api.style.toUpperCase())}`);
  }

  // Deployment
  const deployFeatures: string[] = [];
  if (analysis.deployment.hasDockerfile) deployFeatures.push('Docker');
  if (analysis.deployment.hasCI) deployFeatures.push('CI/CD');
  if (deployFeatures.length > 0) {
    console.log(`  ${brand.dim(pad('Deploy'))}${brand.text(deployFeatures.join(', '))}`);
  }

  console.log();
}

interface AnalyzerStatus {
  name: string;
  status: 'pending' | 'running' | 'done';
  gapCount: number;
  batchIndex: number;
  totalBatches: number;
}

/**
 * Build the analyzer progress display
 */
export function buildAnalyzerDisplay(analyzers: Map<string, AnalyzerStatus>): string {
  const lines: string[] = [];
  const barWidth = 24;

  for (const [id, status] of analyzers) {
    let icon: string;
    let progressBar: string;
    let statusText: string;
    let nameStyle: (s: string) => string;

    const name = status.name.padEnd(14);

    if (status.status === 'done') {
      icon = ICONS.success;
      progressBar = brand.primary('━'.repeat(barWidth));
      statusText = status.gapCount > 0
        ? brand.secondary(`${status.gapCount} issues`)
        : brand.primary('clean');
      nameStyle = brand.primary;
    } else if (status.status === 'running') {
      icon = ICONS.running;
      const progress = status.totalBatches > 0
        ? Math.round((status.batchIndex / status.totalBatches) * barWidth)
        : 0;
      progressBar = brand.secondary('━'.repeat(progress)) + brand.dim('─'.repeat(barWidth - progress));
      statusText = status.totalBatches > 0
        ? brand.dim(`${status.batchIndex + 1}/${status.totalBatches}`)
        : brand.dim('analyzing...');
      nameStyle = chalk.white.bold;
    } else {
      icon = ICONS.pending;
      progressBar = brand.dim('─'.repeat(barWidth));
      statusText = brand.dim('queued');
      nameStyle = brand.dim;
    }

    lines.push(`${icon} ${nameStyle(name)} ${progressBar}  ${statusText}`);
  }

  return lines.join('\n');
}

/**
 * Print the production readiness score
 */
export function printScore(score: number): void {
  const barWidth = 40;
  const filled = Math.round((score / 100) * barWidth);

  let color: (s: string) => string;
  let label: string;

  if (score >= 80) {
    color = brand.primary;
    label = 'Production Ready';
  } else if (score >= 50) {
    color = brand.secondary;
    label = 'Needs Work';
  } else {
    color = brand.error;
    label = 'Not Ready';
  }

  const bar = color('█'.repeat(filled)) + brand.dim('░'.repeat(barWidth - filled));

  console.log();
  console.log(`  ${brand.text('Production Readiness')}  ${color(score.toString())}${brand.dim('/100')}  ${brand.dim(label)}`);
  console.log(`  ${bar}`);
  console.log();
}

/**
 * Print issues grouped by category with tree structure
 */
export function printIssuesSummary(gaps: Gap[]): void {
  // Group by category
  const byCategory = new Map<string, Gap[]>();
  for (const gap of gaps) {
    const list = byCategory.get(gap.category) || [];
    list.push(gap);
    byCategory.set(gap.category, list);
  }

  // Sort categories by severity (count critical/warning)
  const categoryOrder = Array.from(byCategory.entries()).sort((a, b) => {
    const aCritical = a[1].filter(g => g.severity === 'critical').length;
    const bCritical = b[1].filter(g => g.severity === 'critical').length;
    if (aCritical !== bCritical) return bCritical - aCritical;
    return b[1].length - a[1].length;
  });

  sectionHeader('Issues Found', brand.secondary);

  for (const [category, categoryGaps] of categoryOrder) {
    const critical = categoryGaps.filter(g => g.severity === 'critical').length;
    const warning = categoryGaps.filter(g => g.severity === 'warning').length;

    let countStr = brand.dim(`${categoryGaps.length}`);
    if (critical > 0 && warning > 0) {
      countStr = `${brand.error(critical.toString())} critical, ${brand.secondary(warning.toString())} warning`;
    } else if (critical > 0) {
      countStr = `${brand.error(critical.toString())} critical`;
    } else if (warning > 0) {
      countStr = `${brand.secondary(warning.toString())} warning`;
    }

    const categoryName = category.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    console.log(`  ${brand.text(categoryName)} ${brand.dim('·')} ${countStr}`);

    // Show top 3 issues
    const topIssues = categoryGaps.slice(0, 3);
    topIssues.forEach((gap) => {
      const severity = gap.severity === 'critical'
        ? brand.error('●')
        : gap.severity === 'warning'
          ? brand.secondary('●')
          : brand.primary('●');
      console.log(`    ${severity} ${brand.dim(gap.title.substring(0, 55))}`);
    });

    // Show "+X more" if needed
    if (categoryGaps.length > 3) {
      const remaining = categoryGaps.length - 3;
      console.log(`    ${brand.dim(`  +${remaining} more`)}`);
    }

    console.log();
  }
}

/**
 * Print next steps
 */
export function printNextSteps(fixableCount: number, totalCount: number): void {
  sectionHeader('Next Steps', brand.primary);

  console.log(`  ${ICONS.arrow} ${brand.primaryBold('lastmile fix')}       Auto-fix ${brand.primary(fixableCount.toString())} issues`);
  console.log(`  ${ICONS.arrow} ${brand.primaryBold('lastmile fix -i')}    Interactive mode`);
  console.log(`  ${ICONS.arrow} ${brand.primaryBold('lastmile deploy')}    Deploy when ready`);
  console.log();
}

/**
 * Print analysis stats
 */
export function printStats(fileCount: number, duration: number, gapCount: number, fixableCount: number): void {
  const durationStr = (duration / 1000).toFixed(1);
  console.log(brand.dim(`  ${fileCount} files analyzed in ${durationStr}s`));
  console.log(brand.text(`  ${gapCount} issues found`) + brand.dim(` (${fixableCount} auto-fixable)`));
  console.log();
}

/**
 * Print a separator line
 */
export function printSeparator(): void {
  const width = Math.min(getTerminalWidth() - 4, 74);
  console.log(brand.dim('═'.repeat(width)));
  console.log();
}

/**
 * Print completion message (no-op, completion is shown in analyzer display)
 */
export function printComplete(): void {
  // Intentionally empty - "Analysis complete" is shown in the analyzer progress display
}
