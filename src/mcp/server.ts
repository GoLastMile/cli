#!/usr/bin/env node
/**
 * LastMile MCP Server
 *
 * Provides tools for AI assistants to analyze and deploy projects via LastMile.
 * Uses the Model Context Protocol (MCP) specification.
 *
 * Tools:
 * - analyze_project: Analyze a project for production gaps
 * - deploy_to_cloud: Deploy a project to LastMile Cloud
 * - get_deployment_status: Check deployment status
 * - list_deployments: List all deployments
 *
 * Usage with Claude Code:
 *   Add to ~/.claude/settings.json:
 *   {
 *     "mcpServers": {
 *       "lastmile": {
 *         "command": "lastmile-mcp"
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from '../lib/config.js';
import { createApiClient } from '../lib/api-client.js';
import fs from 'fs';
import path from 'path';

// =============================================================================
// Tool Definitions
// =============================================================================

const TOOLS: Tool[] = [
  {
    name: 'analyze_project',
    description:
      'Analyze a project directory for production-readiness gaps. Returns issues like missing error handling, security vulnerabilities, no CI/CD setup, missing tests, etc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Absolute path to the project directory to analyze',
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional: Filter by categories (security, testing, error-handling, database, deployment, logging, performance)',
        },
      },
      required: ['directory'],
    },
  },
  {
    name: 'deploy_to_cloud',
    description:
      'Deploy a project to LastMile Cloud. Requires the project to be a git repository with a GitHub remote. Returns the deployment URL.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Absolute path to the project directory',
        },
        projectName: {
          type: 'string',
          description: 'Name for the deployment (optional, auto-detected from package.json)',
        },
        branch: {
          type: 'string',
          description: 'Git branch to deploy (default: main)',
        },
        withDatabase: {
          type: 'boolean',
          description: 'Provision a Postgres database (auto-detected if not specified)',
        },
      },
      required: ['directory'],
    },
  },
  {
    name: 'get_deployment_status',
    description: 'Get the status of a LastMile Cloud deployment by ID',
    inputSchema: {
      type: 'object' as const,
      properties: {
        deploymentId: {
          type: 'string',
          description: 'The deployment ID to check',
        },
      },
      required: ['deploymentId'],
    },
  },
  {
    name: 'list_deployments',
    description: 'List all LastMile Cloud deployments for the current user',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'generate_fixes',
    description:
      'Generate automatic fixes for production gaps found during analysis. Returns file changes that can be applied.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Absolute path to the project directory',
        },
        gapIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: Specific gap IDs to fix (from analyze_project results)',
        },
      },
      required: ['directory'],
    },
  },
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Collect project files for analysis
 */
function collectProjectFiles(
  projectDir: string,
  extensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.yaml', '.yml']
): Record<string, string> {
  const files: Record<string, string> = {};
  const maxFileSize = 100 * 1024; // 100KB limit per file
  const maxTotalSize = 2 * 1024 * 1024; // 2MB total limit
  let totalSize = 0;

  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.turbo'];

  function walk(dir: string, basePath = '') {
    if (totalSize > maxTotalSize) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (totalSize > maxTotalSize) break;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(basePath, entry.name);

      if (entry.isDirectory()) {
        if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
          walk(fullPath, relativePath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext) || entry.name === 'Dockerfile' || entry.name === '.env.example') {
          try {
            const stats = fs.statSync(fullPath);
            if (stats.size <= maxFileSize) {
              const content = fs.readFileSync(fullPath, 'utf-8');
              files[relativePath] = content;
              totalSize += stats.size;
            }
          } catch {
            // Skip files we can't read
          }
        }
      }
    }
  }

  walk(projectDir);
  return files;
}

/**
 * Detect GitHub repository from git remote
 */
function detectGitHubRepo(projectDir: string): { url: string; owner: string; repo: string } | null {
  try {
    const gitConfigPath = path.join(projectDir, '.git', 'config');
    if (!fs.existsSync(gitConfigPath)) return null;

    const gitConfig = fs.readFileSync(gitConfigPath, 'utf-8');
    const remoteMatch = gitConfig.match(/\[remote "origin"\][^[]*url\s*=\s*(.+)/);
    if (!remoteMatch) return null;

    const remoteUrl = remoteMatch[1].trim();
    const match = remoteUrl.match(/github\.com[/:]([\\w-]+)\/([\\w.-]+?)(\\.git)?$/);
    if (match) {
      return {
        url: `https://github.com/${match[1]}/${match[2]}`,
        owner: match[1],
        repo: match[2],
      };
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Detect project name from package.json
 */
function detectProjectName(projectDir: string): string {
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (pkg.name && !pkg.name.startsWith('@')) {
        return pkg.name;
      }
    } catch {
      // Ignore
    }
  }
  return path.basename(projectDir);
}

/**
 * Detect if project uses a database
 */
function detectDatabaseUsage(projectDir: string): boolean {
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const dbPackages = [
        'prisma',
        '@prisma/client',
        'drizzle-orm',
        'typeorm',
        'sequelize',
        'knex',
        'pg',
        'mysql2',
        'mongoose',
      ];
      return dbPackages.some((p) => deps[p]);
    } catch {
      // Ignore
    }
  }
  return false;
}

// =============================================================================
// Tool Handlers
// =============================================================================

async function handleAnalyzeProject(
  args: { directory: string; categories?: string[] },
  api: ReturnType<typeof createApiClient>
): Promise<string> {
  const projectDir = args.directory;

  if (!fs.existsSync(projectDir)) {
    return JSON.stringify({ error: `Directory not found: ${projectDir}` });
  }

  // Collect files
  const files = collectProjectFiles(projectDir);
  const fileCount = Object.keys(files).length;

  if (fileCount === 0) {
    return JSON.stringify({ error: 'No analyzable files found in directory' });
  }

  // Call API
  const result = await api.analyze({ files });

  // Filter by categories if specified
  let gaps = result.gaps;
  if (args.categories && args.categories.length > 0) {
    gaps = gaps.filter((g) => args.categories!.includes(g.category));
  }

  return JSON.stringify({
    filesAnalyzed: fileCount,
    stack: result.stack,
    projectAnalysis: result.projectAnalysis,
    totalGaps: gaps.length,
    gapsBySeverity: {
      critical: gaps.filter((g) => g.severity === 'critical').length,
      warning: gaps.filter((g) => g.severity === 'warning').length,
      info: gaps.filter((g) => g.severity === 'info').length,
    },
    gaps: gaps.map((g) => ({
      id: g.id,
      category: g.category,
      severity: g.severity,
      title: g.title,
      description: g.description,
      filePath: g.filePath,
      autoFixable: g.autoFixable,
    })),
  });
}

async function handleDeployToCloud(
  args: { directory: string; projectName?: string; branch?: string; withDatabase?: boolean },
  api: ReturnType<typeof createApiClient>
): Promise<string> {
  const projectDir = args.directory;

  if (!fs.existsSync(projectDir)) {
    return JSON.stringify({ error: `Directory not found: ${projectDir}` });
  }

  // Check cloud status
  const status = await api.getCloudStatus();
  if (!status.configured) {
    return JSON.stringify({ error: 'LastMile Cloud is not configured on the backend' });
  }

  // Detect GitHub repo
  const repoInfo = detectGitHubRepo(projectDir);
  if (!repoInfo) {
    return JSON.stringify({
      error: 'No GitHub repository detected. LastMile Cloud deploys from GitHub.',
      suggestion: 'Initialize git, create a GitHub repo, and push your code first.',
    });
  }

  // Get project name
  const projectName = args.projectName || detectProjectName(projectDir);
  const branch = args.branch || 'main';
  const withDatabase = args.withDatabase ?? detectDatabaseUsage(projectDir);

  // Deploy
  const deployment = await api.deployToCloud({
    projectName,
    repoUrl: repoInfo.url,
    branch,
    withDatabase,
  });

  if (deployment.error || deployment.status === 'failed') {
    return JSON.stringify({
      success: false,
      error: deployment.error,
    });
  }

  return JSON.stringify({
    success: true,
    deploymentId: deployment.id,
    url: deployment.url,
    subdomain: deployment.subdomain,
    status: deployment.status,
    databaseProvisioned: !!deployment.databaseUrl,
  });
}

async function handleGetDeploymentStatus(
  args: { deploymentId: string },
  api: ReturnType<typeof createApiClient>
): Promise<string> {
  const deployment = await api.getCloudDeployment(args.deploymentId);

  return JSON.stringify({
    id: deployment.id,
    status: deployment.status,
    url: deployment.url,
    subdomain: deployment.subdomain,
    createdAt: deployment.createdAt,
    updatedAt: deployment.updatedAt,
    error: deployment.error,
  });
}

async function handleListDeployments(api: ReturnType<typeof createApiClient>): Promise<string> {
  const result = await api.listCloudDeployments();

  return JSON.stringify({
    count: result.deployments.length,
    deployments: result.deployments,
  });
}

async function handleGenerateFixes(
  args: { directory: string; gapIds?: string[] },
  api: ReturnType<typeof createApiClient>
): Promise<string> {
  const projectDir = args.directory;

  if (!fs.existsSync(projectDir)) {
    return JSON.stringify({ error: `Directory not found: ${projectDir}` });
  }

  // First analyze to get gaps
  const files = collectProjectFiles(projectDir);
  const analysis = await api.analyze({ files });

  // Filter to auto-fixable gaps
  let gapsToFix = analysis.gaps.filter((g) => g.autoFixable);
  if (args.gapIds && args.gapIds.length > 0) {
    gapsToFix = gapsToFix.filter((g) => args.gapIds!.includes(g.id));
  }

  if (gapsToFix.length === 0) {
    return JSON.stringify({
      message: 'No auto-fixable gaps found',
      totalGaps: analysis.gaps.length,
      autoFixableCount: 0,
    });
  }

  // Generate fixes
  const result = await api.generateStatelessFixes({
    gaps: gapsToFix.map((g) => ({
      id: g.id,
      category: g.category,
      severity: g.severity,
      title: g.title,
      description: g.description,
      filePath: g.filePath,
      lineNumber: g.lineNumber,
      autoFixable: g.autoFixable ?? false,
      suggestedFix: g.suggestedFix,
    })),
    stack: {
      language: analysis.stack.language,
      framework: analysis.stack.framework ?? null,
      database: analysis.stack.database ?? null,
      orm: analysis.stack.orm ?? null,
      packageManager: analysis.stack.packageManager ?? null,
    },
    files,
  });

  return JSON.stringify({
    totalGaps: gapsToFix.length,
    fixesGenerated: result.fixesGenerated,
    fixes: result.fixes.map((f) => ({
      gapId: f.gapId,
      summary: f.summary,
      risk: f.risk,
      changes: f.changes.map((c) => ({
        filePath: c.filePath,
        operation: c.operation,
        // Include content preview (first 500 chars) to avoid huge responses
        contentPreview: c.newContent?.substring(0, 500) + (c.newContent && c.newContent.length > 500 ? '...' : ''),
      })),
    })),
    skipped: result.skipped,
  });
}

// =============================================================================
// Main Server
// =============================================================================

async function main() {
  const server = new Server(
    {
      name: 'lastmile',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Load config and create API client
  const config = await loadConfig();
  const api = createApiClient(config);

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: string;

      switch (name) {
        case 'analyze_project':
          result = await handleAnalyzeProject(args as { directory: string; categories?: string[] }, api);
          break;
        case 'deploy_to_cloud':
          result = await handleDeployToCloud(
            args as { directory: string; projectName?: string; branch?: string; withDatabase?: boolean },
            api
          );
          break;
        case 'get_deployment_status':
          result = await handleGetDeploymentStatus(args as { deploymentId: string }, api);
          break;
        case 'list_deployments':
          result = await handleListDeployments(api);
          break;
        case 'generate_fixes':
          result = await handleGenerateFixes(args as { directory: string; gapIds?: string[] }, api);
          break;
        default:
          result = JSON.stringify({ error: `Unknown tool: ${name}` });
      }

      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: errorMessage }) }],
        isError: true,
      };
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('MCP server error:', error);
  process.exit(1);
});
