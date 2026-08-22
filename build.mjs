import { build } from 'esbuild';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// IIFE bundle — for <script> tag usage
await build({
  entryPoints: ['src/sdk.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'CanvasWidgetSDK',
  outfile: 'dist/canvas-widget-sdk.js',
  target: 'es2022',
  platform: 'browser',
  minify: false,
  sourcemap: true,
  banner: {
    js: `// @goflowstate/widget-sdk v${pkg.version}\n// https://github.com/goflowstate/goflowstate-sdk\n`,
  },
  footer: {
    js: `\n// Expose CanvasWidget on the global scope\nif (typeof window !== "undefined") { window.CanvasWidget = CanvasWidgetSDK.CanvasWidget; }`,
  },
});

console.log(`Built dist/canvas-widget-sdk.js (v${pkg.version})`);

// ESM bundle — for npm import usage
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/index.mjs',
  target: 'es2020',
  platform: 'browser',
  minify: false,
  sourcemap: true,
  banner: {
    js: `// @goflowstate/widget-sdk v${pkg.version}\n// https://github.com/goflowstate/goflowstate-sdk\n`,
  },
});

console.log(`Built dist/index.mjs (v${pkg.version})`);

// TypeScript declarations — all inputs are static, no injection risk
execFileSync('npx', ['tsc', '--project', 'tsconfig.json'], { stdio: 'inherit' });
console.log('Generated dist/*.d.ts');
