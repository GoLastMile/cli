/**
 * Shared types for the LastMile CLI
 */

/**
 * A gap detected during project analysis
 */
export interface Gap {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  filePath?: string;
  line?: number;
  lineNumber?: number;
  description: string;
  autoFixable?: boolean;
  suggestedFix?: string;
}

/**
 * Project classification result
 */
export interface Classification {
  architecture: { type: string; confidence: number };
  purpose: { type: string; confidence: number };
  features: string[];
  confidence: number;
  signals?: string[];
}

/**
 * Tech stack detection result
 */
export interface Stack {
  framework?: string;
  language: string | null;
  database?: string | null;
  orm?: string | null;
}

/**
 * Deployment status
 */
export interface Deployment {
  id: string;
  status: 'pending' | 'building' | 'success' | 'failed';
  url?: string;
  error?: string;
}

/**
 * Analysis response from the API
 */
export interface AnalyzeResponse {
  id: string;
  gaps: Gap[];
  stack: Stack;
  readinessScore: number;
  classification?: Classification;
}
