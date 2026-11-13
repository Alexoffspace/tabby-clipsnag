// Tabby plugins are loaded by the host app's webpack bundle, so Tabby's own
// API packages must be marked `externals` — otherwise each plugin would ship a
// second copy of tabby-core / Angular / rxjs and break DI and instanceof checks.
//
// Everything else (our own source, strip-ansi) is bundled into dist/index.js.

const path = require('path')

/** @type {import('webpack').Configuration} */
module.exports = {
    target: 'electron-renderer',
    entry: './src/index.ts',
    devtool: false,
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        // Tabby loads plugins as CommonJS modules and expects the NgModule as
        // the `default` export of the module object.
        library: {
            type: 'commonjs2',
        },
        clean: false,
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: 'ts-loader',
                exclude: /node_modules/,
                options: {
                    // Type errors are surfaced by `npm run typecheck`; the build
                    // only needs transpilation to stay fast in watch mode.
                    transpileOnly: false,
                },
            },
        ],
    },
    externals: {
        // Tabby core API surface.
        'tabby-core': 'commonjs2 tabby-core',
        'tabby-terminal': 'commonjs2 tabby-terminal',
        'tabby-settings': 'commonjs2 tabby-settings',
        // Angular + rxjs are singletons inside the host app.
        '@angular/core': 'commonjs2 @angular/core',
        '@angular/common': 'commonjs2 @angular/common',
        '@angular/forms': 'commonjs2 @angular/forms',
        '@angular/platform-browser': 'commonjs2 @angular/platform-browser',
        '@ng-bootstrap/ng-bootstrap': 'commonjs2 @ng-bootstrap/ng-bootstrap',
        'rxjs': 'commonjs2 rxjs',
        'rxjs/operators': 'commonjs2 rxjs/operators',
    },
    stats: {
        errorDetails: true,
    },
}
