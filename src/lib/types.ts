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
 * Comprehensive project analysis from LLM
 */
export interface ProjectAnalysis {
  languages: Array<{ name: string; percentage: number }>;
  framework?: {
    name: string;
    version?: string;
    variant?: string;
    metaFramework?: string;
  };
  architecture: {
    type: string;
    hasBackend: boolean;
    hasFrontend: boolean;
    hasDatabase: boolean;
    isMonorepo: boolean;
    monorepoTool?: string;
  };
  database?: {
    type: string;
    provider?: string;
    orm?: string;
  };
  auth?: {
    provider?: string;
    strategy: string[];
  };
  api?: {
    style: string;
    validationLibrary?: string;
  };
  ui?: {
    library?: string;
    styling?: string;
    componentLibrary?: string;
  };
  testing?: {
    hasUnitTests: boolean;
    hasE2ETests: boolean;
    unitFramework?: string;
    e2eFramework?: string;
    estimatedCoverage: string;
  };
  tooling: {
    packageManager: string;
    bundler?: string;
    hasTypeScript: boolean;
    typeScriptStrictness?: string;
  };
  deployment: {
    targetPlatform?: string;
    hasDockerfile: boolean;
    hasCI: boolean;
    ciPlatform?: string;
    isServerless: boolean;
    isEdgeCompatible: boolean;
  };
  externalServices: Array<{ name: string; category: string }>;
  codeQuality: {
    hasLinter: boolean;
    hasFormatter: boolean;
    hasPreCommitHooks: boolean;
  };
  maturity: {
    stage: string;
    readinessScore: number;
    blockers: string[];
  };
  productType?: {
    type: string;
    confidence: number;
    description?: string;
    signals: string[];
    businessModel?: string;
    audience?: string;
  };
  confidence: number;
  signals: string[];
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
  gaps: Gap[];
  stack: Stack;
  readinessScore: number;
  projectAnalysis?: ProjectAnalysis;
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
