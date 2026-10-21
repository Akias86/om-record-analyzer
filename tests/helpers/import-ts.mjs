import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const compiled = new Map();

// Transpile a small dependency graph with the project's existing compiler.
// Relative TS imports become data URLs, so tests need no extra runtime loader.
async function moduleUrl(url) {
  if (!compiled.has(url.href)) compiled.set(url.href, (async () => {
    // Component tests exercise DOM behavior, not stylesheet loading.
    if (url.pathname.endsWith('.css')) return 'data:text/javascript,export{}';
    let source;
    try { source = await readFile(url, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT' || /\.tsx?$/.test(url.pathname)) throw error;
      const tsUrl = new URL(`${url.href}.ts`);
      try { await readFile(tsUrl); }
      catch (missing) {
        if (missing.code !== 'ENOENT') throw missing;
        return moduleUrl(new URL(`${url.href}.tsx`));
      }
      return moduleUrl(tsUrl);
    }
    const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX}});
    let output = outputText.replaceAll('import.meta.url', JSON.stringify(url.href));
    const imports = [...output.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)];
    for (const match of imports) {
      const dependency = match[1].startsWith('.')
        ? await moduleUrl(new URL(match[1], url))
        : import.meta.resolve(match[1]);
      output = output.replace(match[0], match[0].replace(match[1], dependency));
    }
    return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${encodeURIComponent(url.href)}`;
  })());
  return compiled.get(url.href);
}

export async function importTs(url) {
  return import(await moduleUrl(url));
}
