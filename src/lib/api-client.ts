import type { Config } from './config.js';
import type { AnalyzeResponse, Deployment, GeneratedFix, FileChange } from './types.js';

// Re-export types for backwards compatibility
export type { AnalyzeResponse, Deployment, Gap, Stack, Classification, GeneratedFix, FileChange } from './types.js';

const DEFAULT_API_URL = 'http://localhost:3001';

export function createApiClient(config: Config) {
  const baseUrl = process.env.LASTMILE_API_URL || DEFAULT_API_URL;
  const apiKey = config.apiKey;

  async function request<T>(path: string, options: RequestInit = {}, timeoutMs?: number): Promise<T> {
    let response: Response;

    // Set up abort controller for timeout
    const controller = new AbortController();
    const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...options.headers,
        },
      });
    } catch (err) {
      if (timeout) clearTimeout(timeout);
      // Handle network errors (server not running, connection refused, etc.)
      const error = err as Error & { cause?: { code?: string }; name?: string };
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after ${(timeoutMs || 0) / 1000}s`);
      }
      if (error.cause?.code === 'ECONNREFUSED') {
        throw new Error(
          `Cannot connect to LastMile API at ${baseUrl}\n` +
          `Make sure the backend server is running: cd backend && pnpm dev`
        );
      }
      throw new Error(`Network error: ${error.message}`);
    }

    if (timeout) clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.message || error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  return {
    async analyze(data: { files: Record<string, string> }): Promise<AnalyzeResponse> {
      return request('/v1/analyze', { method: 'POST', body: JSON.stringify(data) });
    },

    /**
     * Generate a fix for a specific gap
     */
    async generateFix(data: { gapId: string; files: Record<string, string> }): Promise<GeneratedFix> {
      return request('/v1/fixes/generate', { method: 'POST', body: JSON.stringify(data) });
    },

    /**
     * Generate fixes for all auto-fixable gaps in an analysis (requires DB)
     * @deprecated Use generateStatelessFixes instead for CLI usage
     */
    async generateBatchFixes(data: {
      analysisId: string;
      files: Record<string, string>;
      gapIds?: string[];
    }): Promise<{
      analysisId: string;
      totalGaps: number;
      fixesGenerated: number;
      fixes: GeneratedFix[];
      skipped: Array<{ gapId: string; reason: string }>;
    }> {
      return request('/v1/fixes/generate-batch', { method: 'POST', body: JSON.stringify(data) });
    },

    /**
     * Generate fixes for gaps - stateless, no DB required
     * Accepts gap data directly instead of looking it up from an analysis ID
     */
    async generateStatelessFixes(data: {
      gaps: Array<{
        id: string;
        category: string;
        severity: 'critical' | 'warning' | 'info';
        title: string;
        description?: string;
        filePath?: string;
        lineNumber?: number;
        autoFixable: boolean;
        suggestedFix?: string;
      }>;
      stack: {
        language: string | null;
        framework: string | null;
        database: string | null;
        orm?: string | null;
        buildTool?: string | null;
        packageManager?: string | null;
      };
      files: Record<string, string>;
    }): Promise<{
      totalGaps: number;
      fixesGenerated: number;
      fixes: GeneratedFix[];
      skipped: Array<{ gapId: string; reason: string }>;
    }> {
      // LLM fix generation can take several minutes for many gaps
      const TEN_MINUTES = 10 * 60 * 1000;
      return request('/v1/fixes/generate-stateless', { method: 'POST', body: JSON.stringify(data) }, TEN_MINUTES);
    },

    /**
     * Get supported fix categories
     */
    async getSupportedFixCategories(): Promise<{ categories: string[] }> {
      return request('/v1/fixes/supported-categories');
    },

    async deploy(data: { platform: string; token: string; files: Record<string, string> }): Promise<Deployment> {
      // TODO: Implement real deployment API
      // return request('/v1/deploy', { method: 'POST', body: JSON.stringify(data) });
      void data; // Suppress unused parameter warning
      return {
        id: crypto.randomUUID(),
        status: 'success',
        url: 'https://your-app.railway.app',
      };
    },

    async getDeployment(id: string): Promise<Deployment> {
      // TODO: Implement real deployment status API
      // return request(`/v1/deployments/${id}`);
      return {
        id,
        status: 'success',
        url: 'https://your-app.railway.app',
      };
    },
  };
}
