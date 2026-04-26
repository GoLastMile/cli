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
     * Generate fixes using the multi-agent orchestration system (recommended)
     *
     * This method uses the new orchestration system which:
     * - Groups related fixes together
     * - Handles dependencies between fixes
     * - Properly deletes duplicate files
     * - Uses specialized agents for different fix types
     * - Validates fixes after generation
     */
    async generateOrchestratedFixes(data: {
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
      usedOrchestration: boolean;
      fallbackReason?: string;
      orchestration?: {
        status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
        summary: string;
        plan: {
          fixSetsCount: number;
          batchesCount: number;
          warnings: string[];
          estimatedCost: {
            inputTokens: number;
            outputTokens: number;
            estimatedCostUsd: number;
            llmCalls: number;
          };
        };
        validation: {
          resolvedCount: number;
          unresolvedCount: number;
          regressionsCount: number;
          recommendation: 'COMPLETE' | 'RETRY_PARTIAL' | 'MANUAL_REVIEW';
        } | null;
        fileOperations: Array<{ type: string; path: string }>;
      };
    }> {
      // Orchestration can take longer due to multiple specialist agents
      const FIFTEEN_MINUTES = 15 * 60 * 1000;
      return request('/v1/fixes/generate-orchestrated', { method: 'POST', body: JSON.stringify(data) }, FIFTEEN_MINUTES);
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

    // =========================================================================
    // LastMile Cloud (Managed Hosting)
    // =========================================================================

    /**
     * Check if LastMile Cloud is configured on the backend
     */
    async getCloudStatus(): Promise<{
      configured: boolean;
      services: { railway: boolean; cloudflare: boolean };
    }> {
      return request('/v1/cloud/status');
    },

    /**
     * Deploy to LastMile Cloud
     * No user tokens required - uses LastMile's infrastructure
     */
    async deployToCloud(data: {
      projectName: string;
      repoUrl: string;
      branch?: string;
      envVars?: Record<string, string>;
      withDatabase?: boolean;
      rootDirectory?: string;
      framework?: string;
    }): Promise<{
      id: string;
      status: string;
      url: string;
      subdomain: string;
      databaseUrl?: string;
      error?: string;
    }> {
      // Cloud deployments can take a while
      const FIVE_MINUTES = 5 * 60 * 1000;
      return request('/v1/cloud/deploy', { method: 'POST', body: JSON.stringify(data) }, FIVE_MINUTES);
    },

    /**
     * Get a LastMile Cloud deployment status
     */
    async getCloudDeployment(id: string): Promise<{
      id: string;
      status: string;
      url: string;
      subdomain: string;
      databaseUrl?: string;
      railwayProjectId?: string;
      createdAt: string;
      updatedAt: string;
      error?: string;
    }> {
      return request(`/v1/cloud/deploy/${id}`);
    },

    /**
     * List user's LastMile Cloud deployments
     */
    async listCloudDeployments(): Promise<{
      deployments: Array<{
        id: string;
        projectName: string;
        status: string;
        url: string;
        subdomain: string;
        createdAt: string;
      }>;
    }> {
      return request('/v1/cloud/deployments');
    },

    /**
     * Delete a LastMile Cloud deployment
     */
    async deleteCloudDeployment(id: string): Promise<{ success: boolean }> {
      return request(`/v1/cloud/deploy/${id}`, { method: 'DELETE' });
    },

    /**
     * Redeploy a LastMile Cloud deployment
     */
    async redeployCloud(id: string): Promise<{
      id: string;
      status: string;
      url: string;
    }> {
      return request(`/v1/cloud/deploy/${id}/redeploy`, { method: 'POST' });
    },

    /**
     * Stream deployment logs via SSE
     * Returns an async iterator of deployment events
     */
    async *streamDeploymentLogs(id: string): AsyncGenerator<{
      type: 'status' | 'log' | 'complete' | 'error';
      status?: string;
      logs?: string[];
      message?: string;
      error?: string;
    }> {
      const url = `${baseUrl}/v1/cloud/deploy/${id}/logs`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'text/event-stream',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      // Check if it's a JSON response (deployment already complete)
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        yield {
          type: 'complete',
          status: data.status,
          logs: data.logs,
          message: 'Deployment complete',
        };
        return;
      }

      // Parse SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data) {
              try {
                const event = JSON.parse(data);
                yield event;

                if (event.type === 'complete' || event.type === 'error') {
                  return;
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }
      }
    },

    /**
     * Get deployment logs (non-streaming)
     */
    async getDeploymentLogs(id: string): Promise<{
      deploymentId: string;
      status: string;
      logs: string[];
      logCount: number;
    }> {
      return request(`/v1/cloud/deploy/${id}/logs/all`);
    },

    // =========================================================================
    // Auth
    // =========================================================================

    /**
     * Get current authenticated user
     */
    async getMe(): Promise<{
      user: {
        id: string;
        email: string;
        name?: string;
      };
    }> {
      return request('/v1/auth/me');
    },
  };
}
