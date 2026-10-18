import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// These standalone modules have no imports; use the existing compiler so tests
// also work on Node versions without native TypeScript support.
export async function importTs(url) {
  const source = await readFile(url, 'utf8');
  const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023}});
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}#${encodeURIComponent(url.href)}`);
}
