import type { Config } from './config.js';

const DEFAULT_API_URL = 'http://localhost:3001';

interface Gap {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  filePath?: string;
  line?: number;
  description: string;
}

interface AnalyzeResponse {
  id: string;
  gaps: Gap[];
  stack: { framework?: string; language: string; database?: string };
  readinessScore: number;
}

interface Fix {
  id: string;
  gapId: string;
  gapTitle: string;
  filePath: string;
  originalContent: string;
  newContent: string;
  description: string;
}

interface Deployment {
  id: string;
  status: 'pending' | 'building' | 'success' | 'failed';
  url?: string;
  error?: string;
}

export function createApiClient(config: Config) {
  const baseUrl = process.env.LASTMILE_API_URL || DEFAULT_API_URL;
  const apiKey = config.apiKey;

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...options.headers,
      },
    });

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

    async generateFixes(data: { analysisId: string; gapIds?: string[] }): Promise<Fix[]> {
      // For now, return empty array
      // In production: return request('/v1/fixes', { method: 'POST', body: JSON.stringify(data) });
      return [];
    },

    async deploy(data: { platform: string; token: string; files: Record<string, string> }): Promise<Deployment> {
      // For now, return mock data
      // In production: return request('/v1/deploy', { method: 'POST', body: JSON.stringify(data) });
      return {
        id: crypto.randomUUID(),
        status: 'success',
        url: 'https://your-app.railway.app',
      };
    },

    async getDeployment(id: string): Promise<Deployment> {
      // For now, return mock data
      // In production: return request(`/v1/deployments/${id}`);
      return {
        id,
        status: 'success',
        url: 'https://your-app.railway.app',
      };
    },
  };
}
