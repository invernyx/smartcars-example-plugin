const path = require('path');

module.exports = {
    entry: './index.ts',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        preferRelative: true,
    },
    externals: {
        // Use the host app's Effect runtime to avoid version mismatches
        // and reduce bundle size. The main process provides these at runtime.
        effect: 'commonjs2 effect',
        axios: 'commonjs2 axios',
    },
    output: {
        filename: 'index.js',
        path: path.resolve(__dirname, 'build'),
        library: {
            type: 'commonjs2',
        },
    },
    mode: 'production',
    target: 'node',
};
