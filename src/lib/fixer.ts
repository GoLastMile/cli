/**
 * Fix application service
 *
 * Handles applying fixes to the filesystem.
 * Separated from the API calls for testability.
 */

import fs from 'fs';
import path from 'path';

export interface FixResult {
  success: boolean;
  filesWritten: string[];
  errors: string[];
}

/**
 * Write fix files to disk
 * Creates directories as needed
 */
export function applyFixes(
  projectDir: string,
  filesWritten: Record<string, string>
): FixResult {
  const result: FixResult = {
    success: true,
    filesWritten: [],
    errors: [],
  };

  for (const [filePath, content] of Object.entries(filesWritten)) {
    try {
      const fullPath = path.join(projectDir, filePath);
      const dir = path.dirname(fullPath);

      // Create directory if it doesn't exist
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, content, 'utf-8');
      result.filesWritten.push(filePath);
    } catch (error) {
      result.success = false;
      result.errors.push(
        `Failed to write ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  return result;
}

/**
 * Merge new files into an existing files map
 * Used to keep the files map up to date after applying fixes
 */
export function mergeFiles(
  existingFiles: Record<string, string>,
  newFiles: Record<string, string>
): Record<string, string> {
  return { ...existingFiles, ...newFiles };
}
