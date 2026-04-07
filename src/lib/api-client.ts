import type { Config } from './config.js';
import type { AnalyzeResponse, Deployment } from './types.js';

// Re-export types for backwards compatibility
export type { AnalyzeResponse, Deployment, Gap, Stack, Classification } from './types.js';

const DEFAULT_API_URL = 'http://localhost:3001';

export function createApiClient(config: Config) {
  const baseUrl = process.env.LASTMILE_API_URL || DEFAULT_API_URL;
  const apiKey = config.apiKey;

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...options.headers,
        },
      });
    } catch (err) {
      // Handle network errors (server not running, connection refused, etc.)
      const error = err as Error & { cause?: { code?: string } };
      if (error.cause?.code === 'ECONNREFUSED') {
        throw new Error(
          `Cannot connect to LastMile API at ${baseUrl}\n` +
          `Make sure the backend server is running: cd backend && pnpm dev`
        );
      }
      throw new Error(`Network error: ${error.message}`);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  return {
    async analyze(data: { files: Record<string, string> }): Promise<AnalyzeResponse> {
      return request('/v1/analyze', { method: 'POST', body: JSON.stringify(data) });
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
