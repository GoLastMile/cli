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
  packageManager?: string | null;
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

/**
 * A file change in a generated fix
 */
export interface FileChange {
  filePath: string;
  originalContent: string;
  newContent: string;
  operation: 'create' | 'modify' | 'append' | 'delete';
  description: string;
}

/**
 * Risk level of a fix
 */
export type FixRisk = 'safe' | 'review' | 'careful';

/**
 * Generated fix from the backend
 */
export interface GeneratedFix {
  gapId: string;
  strategy: 'template' | 'transform' | 'llm';
  risk: FixRisk;
  canAutoApply: boolean;
  changes: FileChange[];
  installCommands: string[];
  summary: string;
  notes?: string[];
}
