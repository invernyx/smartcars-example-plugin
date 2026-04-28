const esbuild = require('esbuild');

esbuild.build({
    entryPoints: ['index.ts'],
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'cjs',
    outfile: 'build/index.js',
    external: ['effect', 'axios'],
}).catch(() => process.exit(1));
