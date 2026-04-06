import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, extname } from 'path';

interface CollectOptions {
  ignorePaths?: string[];
  maxFileSize?: number;
  maxTotalSize?: number;
}

const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  'dist',
  'build',
  '.turbo',
  '.vercel',
  '.output',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  'vendor',
  'target',
  '.lastmile',
  // Lock files - contain transitive deps that cause false positives
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'poetry.lock',
  'composer.lock',
];

const ANALYZABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx',
  '.html', '.css', '.scss', '.sass',
  '.sql',
  '.env', '.env.example', '.env.local',
]);

const ANALYZABLE_FILES = new Set([
  '.gitignore', '.dockerignore',
  'Dockerfile', 'docker-compose.yml',
  'package.json', 'tsconfig.json', 'pyproject.toml',
  'Gemfile', 'Cargo.toml', 'go.mod',
]);

export async function collectFiles(
  dir: string,
  options: CollectOptions = {}
): Promise<Map<string, string>> {
  const {
    ignorePaths = [],
    maxFileSize = 1024 * 1024, // 1MB
    maxTotalSize = 50 * 1024 * 1024, // 50MB
  } = options;

  const allIgnore = [...DEFAULT_IGNORE, ...ignorePaths];
  const files = new Map<string, string>();
  let totalSize = 0;

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      const relativePath = relative(dir, fullPath);

      // Check ignore patterns - match full path segments, not substrings
      // This prevents ".gitignore" from being ignored due to ".git" pattern
      const shouldIgnore = allIgnore.some(pattern => {
        // Exact match at root level
        if (relativePath === pattern) return true;
        // Match at start of path (e.g., "node_modules/..." matches "node_modules")
        if (relativePath.startsWith(pattern + '/')) return true;
        // Match as a path segment (e.g., "foo/node_modules/bar" matches "node_modules")
        if (relativePath.includes('/' + pattern + '/')) return true;
        // Match at end as a directory (e.g., "foo/node_modules" matches "node_modules")
        if (relativePath.endsWith('/' + pattern)) return true;
        return false;
      });
      if (shouldIgnore) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        const isAnalyzable = ANALYZABLE_EXTENSIONS.has(ext) || ANALYZABLE_FILES.has(entry.name);

        if (!isAnalyzable) continue;

        try {
          const stats = await stat(fullPath);
          if (stats.size > maxFileSize) continue;
          if (totalSize + stats.size > maxTotalSize) {
            console.warn(`Skipping ${relativePath}: would exceed total size limit`);
            continue;
          }

          const content = await readFile(fullPath, 'utf-8');
          files.set(relativePath, content);
          totalSize += stats.size;
        } catch {
          // Skip files we can't read
        }
      }
    }
  }

  await walk(dir);
  return files;
}
