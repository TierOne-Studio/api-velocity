// Runs the TS test server under ts-node. ts-node emits decorator metadata
// (tsconfig emitDecoratorMetadata) which Nest DI needs — esbuild/tsx loaders do
// not. The resolve hook maps the repo's `./x.js` import specifiers back to the
// `.ts` sources at runtime (the same job jest's moduleNameMapper does).
require('ts-node').register({ transpileOnly: true, project: 'tsconfig.json' });

const Module = require('module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (/^\.{1,2}\/.*\.js$/.test(request)) {
    try {
      return originalResolve.call(this, request, ...rest);
    } catch {
      return originalResolve.call(this, request.replace(/\.js$/, ''), ...rest);
    }
  }
  return originalResolve.call(this, request, ...rest);
};

require('./test-server.ts');
