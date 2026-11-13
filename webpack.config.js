// Copyright (C) 2017-2023 Smart code 203358507

const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const webpack = require('webpack');
const threadLoader = require('thread-loader');
const HtmlWebPackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const WorkboxPlugin = require('workbox-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const packageJson = require('./package.json');

const BUILD_ID = Date.now().toString(36);
let gitHash = '';
try {
    gitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch (_) {}
const COMMIT_HASH = gitHash ? `v5.0.0-hb-${gitHash}-${BUILD_ID}` : `v5.0.0-hb-${BUILD_ID}`;

const THREAD_LOADER = {
    loader: 'thread-loader',
    options: {
        name: 'shared-pool',
        workers: os.cpus().length,
    },
};

threadLoader.warmup(
    THREAD_LOADER.options,
    [
        'babel-loader',
        'ts-loader',
        'css-loader',
        'postcss-loader',
        'less-loader',
    ],
);

module.exports = (env, argv) => ({
    mode: argv.mode,
    // production maps stay local for debugging (no sourceMappingURL) and are deleted from the Docker image
    devtool: argv.mode === 'production' ? 'hidden-source-map' : 'eval-source-map',
    entry: {
        main: './src/index.js',
        worker: './node_modules/@stremio/stremio-core-web/worker.js'
    },
    output: {
        path: path.join(__dirname, 'build'),
        filename: `${COMMIT_HASH}/scripts/[name].js`,
        clean: true,
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: [
                    THREAD_LOADER,
                    {
                        loader: 'babel-loader',
                        options: {
                            presets: [
                                '@babel/preset-env',
                                '@babel/preset-react'
                            ],
                        }
                    }
                ]
            },
            {
                test: /\.(ts|tsx)$/,
                exclude: /node_modules/,
                use: [
                    THREAD_LOADER,
                    {
                        loader: 'ts-loader',
                        options: {
                            happyPackMode: true,
                        }
                    }
                ]
            },
            {
                test: /\.less$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: MiniCssExtractPlugin.loader,
                        options: {
                            esModule: false
                        }
                    },
                    THREAD_LOADER,
                    {
                        loader: 'css-loader',
                        options: {
                            esModule: false,
                            importLoaders: 2,
                            modules: {
                                namedExport: false,
                                localIdentName: '[local]-[hash:base64:5]'
                            }
                        }
                    },
                    {
                        loader: 'postcss-loader',
                        options: {
                            postcssOptions: {
                                plugins: [
                                    ['cssnano', {
                                        preset: [
                                            'advanced',
                                            {
                                                autoprefixer: {
                                                    add: true,
                                                    remove: true,
                                                    flexbox: false,
                                                    grid: false
                                                },
                                                cssDeclarationSorter: true,
                                                calc: false,
                                                colormin: false,
                                                convertValues: false,
                                                discardComments: {
                                                    removeAll: true,
                                                },
                                                discardOverridden: false,
                                                discardUnused: false,
                                                mergeIdents: false,
                                                normalizeDisplayValues: false,
                                                normalizePositions: false,
                                                normalizeRepeatStyle: false,
                                                normalizeUnicode: false,
                                                normalizeUrl: false,
                                                reduceIdents: false,
                                                reduceInitial: false,
                                                zindex: false
                                            }
                                        ]
                                    }]
                                ]
                            }
                        }
                    },
                    {
                        loader: 'less-loader',
                        options: {
                            lessOptions: {
                                strictMath: true,
                                ieCompat: false
                            }
                        }
                    }
                ]
            },
            {
                test: /\.(ttf|woff2)$/,
                exclude: /node_modules/,
                type: 'asset/resource',
                generator: {
                    filename: 'fonts/[name][ext][query]'
                }
            },
            {
                test: /\.(png|jpe?g|svg)$/,
                exclude: /node_modules/,
                resourceQuery: /inline/,
                type: 'asset/inline'
            },
            {
                test: /\.(png|jpe?g|svg)$/,
                exclude: /node_modules/,
                resourceQuery: { not: [/inline/] },
                type: 'asset/resource',
                generator: {
                    filename: 'images/[name][ext][query]'
                }
            },
            {
                test: /\.wasm$/,
                type: 'asset/resource',
                generator: {
                    filename: `${COMMIT_HASH}/binaries/[name][ext][query]`
                }
            }
        ]
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js', '.json', '.less', '.wasm'],
        alias: {
            'stremio': path.resolve(__dirname, 'src'),
            'stremio-router': path.resolve(__dirname, 'src', 'router'),
            '@stremio/stremio-colors/less/stremio-colors.less': path.resolve(__dirname, 'src/styles/homebot-colors.less')
        }
    },
    devServer: {
        host: '0.0.0.0',
        static: false,
        hot: false,
        server: 'https',
        liveReload: false
    },
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({
                test: /\.js$/,
                extractComments: false,
                terserOptions: {
                    ecma: 5,
                    mangle: true,
                    warnings: false,
                    output: {
                        comments: false,
                        beautify: false,
                        wrap_iife: true
                    }
                }
            })
        ]
    },
    plugins: [
        new webpack.ProgressPlugin(),
        // larger forward buffer for HLS playback (src/common/hlsConfig.js wraps the library's own config)
        new webpack.NormalModuleReplacementPlugin(/^\.\/hlsConfig$/, (resource) => {
            if (/stremio-video/.test(resource.context || '')) resource.request = path.resolve(__dirname, 'src/common/hlsConfig.js');
        }),
        new webpack.EnvironmentPlugin({
            SENTRY_DSN: null,
            ...env,
            SERVICE_WORKER_DISABLED: false,
            DEBUG: argv.mode !== 'production',
            VERSION: packageJson.version,
            COMMIT_HASH
        }),
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer']
        }),
        argv.mode === 'production' &&
            new WorkboxPlugin.GenerateSW({
                maximumFileSizeToCacheInBytes: 25000000,
                clientsClaim: true,
                skipWaiting: true,
                cleanupOutdatedCaches: true,
                exclude: [/\.map$/, /index\.html$/],
            }),
        new CopyWebpackPlugin({
            patterns: [
                { from: 'assets/favicons', to: 'favicons' },
                { from: 'assets/images', to: 'images' },
                { from: 'assets/screenshots/*.webp', to: 'screenshots/[name][ext]', noErrorOnMissing: true },
                { from: 'manifest.json', to: 'manifest.json' },
            ]
        }),
        new MiniCssExtractPlugin({
            filename: `${COMMIT_HASH}/styles/[name].css`
        }),
        new HtmlWebPackPlugin({
            template: './src/index.html',
            inject: false,
            scriptLoading: 'blocking',
            faviconsPath: 'favicons',
            imagesPath: 'images',
        }),
    ].filter(Boolean)
});
