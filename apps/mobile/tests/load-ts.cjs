// Loads a TypeScript source file for a Node test, with optional stubbed imports.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

module.exports = function loadTs(relativePath, stubs = {}) {
  const file = path.join(__dirname, '..', relativePath);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const loaded = new Module(file);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  const realRequire = loaded.require.bind(loaded);
  loaded.require = (id) => {
    if (id in stubs) return stubs[id];
    // A sibling TypeScript module that the test did not stub is loaded for real.
    if (id.startsWith('.')) {
      const target = path.resolve(path.dirname(file), id);
      for (const extension of ['.ts', '.tsx']) {
        if (fs.existsSync(target + extension)) {
          return loadTs(path.relative(path.join(__dirname, '..'), target + extension), stubs);
        }
      }
    }
    return realRequire(id);
  };
  loaded._compile(output, file);
  return loaded.exports;
};
