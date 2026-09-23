/**
 * Finds every module specifier a source file depends on. It is a scanner,
 * not a parser: it errs on the side of reporting too much (an import-like
 * string inside a comment still counts) rather than missing a real import.
 */
const IMPORT_PATTERNS: readonly RegExp[] = [
  // import x from 'y' · import type { X } from 'y' · import 'y' · export * from 'y' · export { x } from'y'
  /\b(?:import|export)\b\s*(?:[^'"`;]*?\bfrom\s*)?['"]([^'"]+)['"]/g,
  // import('y') · import(`y`) · import ( /* @vite-ignore */ 'y')
  /\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)*[`'"]([^`'"]+)[`'"]/g,
  // import.meta.glob('y') · import.meta.glob<T>(['y', ...])
  /\bimport\.meta\.glob\s*(?:<[^>]*>\s*)?\(\s*\[?\s*[`'"]([^`'"]+)[`'"]/g,
];

export function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) {
        specifiers.push(match[1]);
      }
    }
  }
  return specifiers;
}
