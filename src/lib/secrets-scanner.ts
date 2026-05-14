/**
 * Local secrets scanner
 *
 * Fast, regex-based detection of hardcoded secrets.
 * Runs before file upload to fail fast and avoid sending secrets to the server.
 */

export interface SecretMatch {
  file: string;
  type: string;
  line: number;
}

interface Pattern {
  pattern: RegExp;
  type: string;
}

const PATTERNS: Pattern[] = [
  // Database URLs with credentials
  { pattern: /postgres:\/\/[a-zA-Z0-9_]+:[^@\s]+@/i, type: 'PostgreSQL credentials' },
  { pattern: /mysql:\/\/[a-zA-Z0-9_]+:[^@\s]+@/i, type: 'MySQL credentials' },
  { pattern: /mongodb(\+srv)?:\/\/[a-zA-Z0-9_]+:[^@\s]+@/i, type: 'MongoDB credentials' },

  // Stripe
  { pattern: /sk_live_[a-zA-Z0-9]{24,}/i, type: 'Stripe live secret key' },
  { pattern: /sk_test_[a-zA-Z0-9]{24,}/i, type: 'Stripe test secret key' },
  { pattern: /rk_live_[a-zA-Z0-9]{24,}/i, type: 'Stripe restricted key' },

  // AWS
  { pattern: /AKIA[0-9A-Z]{16}/i, type: 'AWS Access Key ID' },

  // Google
  { pattern: /AIza[0-9A-Za-z\-_]{35}/i, type: 'Google API key' },

  // GitHub
  { pattern: /ghp_[a-zA-Z0-9]{36}/i, type: 'GitHub personal access token' },
  { pattern: /gho_[a-zA-Z0-9]{36}/i, type: 'GitHub OAuth token' },
  { pattern: /ghs_[a-zA-Z0-9]{36}/i, type: 'GitHub App token' },
  { pattern: /ghr_[a-zA-Z0-9]{36}/i, type: 'GitHub refresh token' },

  // Twilio
  { pattern: /SK[a-f0-9]{32}/i, type: 'Twilio API key' },

  // SendGrid
  { pattern: /SG\.[a-zA-Z0-9\-_]{22,}\.[a-zA-Z0-9\-_]{22,}/i, type: 'SendGrid API key' },

  // Slack
  { pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}/i, type: 'Slack token' },

  // OpenAI
  { pattern: /sk-[a-zA-Z0-9]{48}/i, type: 'OpenAI API key' },

  // Generic patterns
  { pattern: /['"]password['"]\s*[:=]\s*['"][^'"]{8,}['"]/i, type: 'Hardcoded password' },
  { pattern: /['"]secret['"]\s*[:=]\s*['"][^'"]{8,}['"]/i, type: 'Hardcoded secret' },
  { pattern: /['"]api_key['"]\s*[:=]\s*['"][^'"]{16,}['"]/i, type: 'Hardcoded API key' },
  { pattern: /['"]apiKey['"]\s*[:=]\s*['"][^'"]{16,}['"]/i, type: 'Hardcoded API key' },
  { pattern: /['"]private_key['"]\s*[:=]\s*['"]-----BEGIN/i, type: 'Private key' },
];

function shouldSkipFile(path: string): boolean {
  if (path.includes('node_modules')) return true;
  if (path.includes('.env')) return true;
  if (path.endsWith('.md') || path.endsWith('.txt') || path.endsWith('.lock')) return true;
  if (path.includes('.test.') || path.includes('.spec.')) return true;
  if (path.includes('.example') || path.includes('.sample')) return true;
  return false;
}

function shouldSkipLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) return true;
  if (line.includes('process.env') || line.includes('os.environ') || line.includes('getenv')) return true;
  return false;
}

export function scanForSecrets(files: Map<string, string>): SecretMatch[] {
  const matches: SecretMatch[] = [];

  for (const [path, content] of files) {
    if (shouldSkipFile(path)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (shouldSkipLine(line)) continue;

      for (const { pattern, type } of PATTERNS) {
        if (pattern.test(line)) {
          if (!matches.some(m => m.file === path && m.type === type)) {
            matches.push({ file: path, type, line: i + 1 });
          }
          break;
        }
      }
    }
  }

  return matches;
}

export function formatSecretsReport(matches: SecretMatch[]): string {
  if (matches.length === 0) return '';

  const lines: string[] = ['Hardcoded secrets detected:\n'];

  const byType = new Map<string, SecretMatch[]>();
  for (const match of matches) {
    const existing = byType.get(match.type) || [];
    existing.push(match);
    byType.set(match.type, existing);
  }

  for (const [type, typeMatches] of byType) {
    lines.push(`  ${type}:`);
    for (const match of typeMatches) {
      lines.push(`    - ${match.file}:${match.line}`);
    }
  }

  lines.push('\nMove these to environment variables before deploying.');
  return lines.join('\n');
}
