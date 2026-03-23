#!/usr/bin/env node
'use strict';

/**
 * pack.js — Build and/or distribute a smartCARS plugin.
 *
 * Usage:
 *   node pack.js                        # create <id>-<version>.zip in the plugin directory
 *   node pack.js --out ./dist           # create ZIP in ./dist/
 *   node pack.js --build                # run npm builds, then create ZIP
 *   node pack.js --install              # copy built files to the smartCARS plugins directory
 *   node pack.js --build --install      # build, then install into smartCARS
 *
 * Prerequisites (unless --build is passed):
 *   - background/build/index.js must already exist
 *   - ui/dist/ must already exist (if the plugin has a UI)
 *
 * No external dependencies — uses only Node.js built-in modules.
 * Requires Node.js >= 16.
 */

const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const PLUGIN_DIR = __dirname;

// Populated automatically when your plugin is scaffolded via the Dev Center.
// To configure manually: replace the value with the absolute path to the
// smartCARS plugins output directory (e.g. /path/to/smartcars/app/out/plugins).
const SMARTCARS_PLUGINS_DIR = '__SMARTCARS_PLUGINS_DIR__';

// On Windows, npm is a batch file (npm.cmd), not a plain executable.
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// ─── CRC-32 ───────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
    }
    return table;
})();

function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// ─── ZIP builder ──────────────────────────────────────────────────────────────

class ZipBuilder {
    constructor() {
        this._entries = [];
        this._offset = 0;
        this._localParts = [];
    }

    /** Add a file entry to the ZIP. */
    addFile(name, data) {
        const nameBuffer = Buffer.from(name, 'utf-8');
        const compressed = zlib.deflateRawSync(data, { level: 6 });
        const checksum = crc32(data);

        // Local file header (30 bytes fixed + filename)
        const local = Buffer.alloc(30 + nameBuffer.length);
        local.writeUInt32LE(0x04034b50, 0);          // Local file header signature
        local.writeUInt16LE(20, 4);                   // Version needed to extract (2.0)
        local.writeUInt16LE(0, 6);                    // General purpose bit flag
        local.writeUInt16LE(8, 8);                    // Compression method: deflate
        local.writeUInt16LE(0, 10);                   // Last mod file time
        local.writeUInt16LE(0, 12);                   // Last mod file date
        local.writeUInt32LE(checksum, 14);            // CRC-32
        local.writeUInt32LE(compressed.length, 18);   // Compressed size
        local.writeUInt32LE(data.length, 22);         // Uncompressed size
        local.writeUInt16LE(nameBuffer.length, 26);   // Filename length
        local.writeUInt16LE(0, 28);                   // Extra field length
        nameBuffer.copy(local, 30);

        this._entries.push({
            nameBuffer,
            checksum,
            compressedSize: compressed.length,
            uncompressedSize: data.length,
            offset: this._offset,
        });

        this._localParts.push(local, compressed);
        this._offset += local.length + compressed.length;
    }

    /** Finalize and return the ZIP file as a Buffer. */
    build() {
        const centralDirOffset = this._offset;
        const centralParts = [];

        for (const entry of this._entries) {
            const { nameBuffer, checksum, compressedSize, uncompressedSize, offset } = entry;

            // Central directory file header (46 bytes fixed + filename)
            const central = Buffer.alloc(46 + nameBuffer.length);
            central.writeUInt32LE(0x02014b50, 0);        // Central directory file header signature
            central.writeUInt16LE(20, 4);                 // Version made by
            central.writeUInt16LE(20, 6);                 // Version needed to extract
            central.writeUInt16LE(0, 8);                  // General purpose bit flag
            central.writeUInt16LE(8, 10);                 // Compression method: deflate
            central.writeUInt16LE(0, 12);                 // Last mod file time
            central.writeUInt16LE(0, 14);                 // Last mod file date
            central.writeUInt32LE(checksum, 16);          // CRC-32
            central.writeUInt32LE(compressedSize, 20);    // Compressed size
            central.writeUInt32LE(uncompressedSize, 24);  // Uncompressed size
            central.writeUInt16LE(nameBuffer.length, 28); // Filename length
            central.writeUInt16LE(0, 30);                 // Extra field length
            central.writeUInt16LE(0, 32);                 // File comment length
            central.writeUInt16LE(0, 34);                 // Disk number start
            central.writeUInt16LE(0, 36);                 // Internal file attributes
            central.writeUInt32LE(0, 38);                 // External file attributes
            central.writeUInt32LE(offset, 42);            // Relative offset of local file header
            nameBuffer.copy(central, 46);

            centralParts.push(central);
        }

        const centralDirSize = centralParts.reduce((sum, p) => sum + p.length, 0);

        // End of central directory record (22 bytes)
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);              // End of central directory signature
        eocd.writeUInt16LE(0, 4);                        // Number of this disk
        eocd.writeUInt16LE(0, 6);                        // Disk where central directory starts
        eocd.writeUInt16LE(this._entries.length, 8);     // Central directory records on this disk
        eocd.writeUInt16LE(this._entries.length, 10);    // Total central directory records
        eocd.writeUInt32LE(centralDirSize, 12);          // Size of central directory (bytes)
        eocd.writeUInt32LE(centralDirOffset, 16);        // Offset of start of central directory
        eocd.writeUInt16LE(0, 20);                       // Comment length

        return Buffer.concat([...this._localParts, ...centralParts, eocd]);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively add all files under `dir` to the ZIP with the given `zipPrefix`. */
function addDirectory(builder, dir, zipPrefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const zipPath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            addDirectory(builder, fullPath, zipPath);
        } else if (entry.isFile()) {
            builder.addFile(zipPath, fs.readFileSync(fullPath));
        }
    }
}

/** Returns true if background/package.json declares runtime `dependencies`. */
function backgroundHasRuntimeDeps() {
    const pkgPath = path.join(PLUGIN_DIR, 'background', 'package.json');
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.dependencies != null && Object.keys(pkg.dependencies).length > 0;
    } catch {
        return false;
    }
}

function parseArgs(argv) {
    let outDir = PLUGIN_DIR;
    let shouldBuild = false;
    let shouldInstall = false;

    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--out' && argv[i + 1]) {
            outDir = path.resolve(argv[i + 1]);
            i++;
        } else if (argv[i] === '--build') {
            shouldBuild = true;
        } else if (argv[i] === '--install') {
            shouldInstall = true;
        }
    }

    return { outDir, shouldBuild, shouldInstall };
}

// ─── Build step ───────────────────────────────────────────────────────────────

function runBuild(dir, label) {
    console.log(`  Building ${label}...`);
    const result = spawnSync(NPM, ['run', 'build'], { cwd: dir, stdio: 'inherit' });
    if (result.error) {
        throw new Error(`Failed to spawn npm: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`Build failed for ${label} (exit code ${result.status})`);
    }
}

// ─── Install step ─────────────────────────────────────────────────────────────

function installPlugin(manifest, hasBackground, hasUi) {
    if (SMARTCARS_PLUGINS_DIR === '__SMARTCARS_PLUGINS_DIR__') {
        console.error('Error: SMARTCARS_PLUGINS_DIR has not been configured.');
        console.error(
            '  Open pack.js and replace the placeholder with the absolute path to your',
        );
        console.error('  smartCARS plugins directory (e.g. /path/to/app/out/plugins).');
        process.exit(1);
    }

    const { id } = manifest;
    const destDir = path.join(SMARTCARS_PLUGINS_DIR, id);

    if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true });
    }
    fs.mkdirSync(destDir, { recursive: true });

    // plugin.json
    fs.copyFileSync(path.join(PLUGIN_DIR, 'plugin.json'), path.join(destDir, 'plugin.json'));
    console.log('  + plugin.json');

    if (hasBackground) {
        const bgBuildDir = path.join(PLUGIN_DIR, 'background', 'build');
        const bgDestDir = path.join(destDir, 'background');
        fs.mkdirSync(bgDestDir, { recursive: true });

        fs.copyFileSync(path.join(bgBuildDir, 'index.js'), path.join(bgDestDir, 'index.js'));
        console.log('  + background/index.js');

        const openapiPath = path.join(bgBuildDir, 'openapi.json');
        if (fs.existsSync(openapiPath)) {
            fs.copyFileSync(openapiPath, path.join(bgDestDir, 'openapi.json'));
            console.log('  + background/openapi.json');
        }

        if (backgroundHasRuntimeDeps()) {
            const nmDir = path.join(PLUGIN_DIR, 'background', 'node_modules');
            if (fs.existsSync(nmDir)) {
                fs.cpSync(nmDir, path.join(bgDestDir, 'node_modules'), { recursive: true });
                console.log('  + background/node_modules/');
            }
        }
    }

    if (hasUi) {
        const uiDistDir = path.join(PLUGIN_DIR, 'ui', 'dist');
        fs.cpSync(uiDistDir, path.join(destDir, 'ui'), { recursive: true });
        console.log('  + ui/');
    }

    console.log(`\nInstalled: ${destDir}`);
}

// ─── Pack step ────────────────────────────────────────────────────────────────

function packPlugin(manifest, hasBackground, hasUi, outDir) {
    const { id, version } = manifest;
    const builder = new ZipBuilder();

    // plugin.json
    builder.addFile('plugin.json', fs.readFileSync(path.join(PLUGIN_DIR, 'plugin.json')));
    console.log('  + plugin.json');

    if (hasBackground) {
        const bgBuildDir = path.join(PLUGIN_DIR, 'background', 'build');

        builder.addFile('background/index.js', fs.readFileSync(path.join(bgBuildDir, 'index.js')));
        console.log('  + background/index.js');

        const openapiPath = path.join(bgBuildDir, 'openapi.json');
        if (fs.existsSync(openapiPath)) {
            builder.addFile('background/openapi.json', fs.readFileSync(openapiPath));
            console.log('  + background/openapi.json');
        }

        // Only include node_modules if the plugin has runtime dependencies that
        // webpack did not bundle into index.js (i.e. listed under "dependencies",
        // not "devDependencies", in background/package.json).
        if (backgroundHasRuntimeDeps()) {
            const nmDir = path.join(PLUGIN_DIR, 'background', 'node_modules');
            if (fs.existsSync(nmDir)) {
                addDirectory(builder, nmDir, 'background/node_modules');
                console.log('  + background/node_modules/');
            }
        }
    }

    // ui/ — content of ui/dist/ mapped to ui/ in the ZIP
    if (hasUi) {
        addDirectory(builder, path.join(PLUGIN_DIR, 'ui', 'dist'), 'ui');
        console.log('  + ui/');
    }

    const zipBuffer = builder.build();
    const outFileName = `${id}-${version}.zip`;
    const outPath = path.join(outDir, outFileName);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, zipBuffer);

    const sizeKb = (zipBuffer.length / 1024).toFixed(1);
    console.log(`\nDone: ${outPath} (${sizeKb} KB)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
    const { outDir, shouldBuild, shouldInstall } = parseArgs(process.argv.slice(2));

    // Read and validate plugin.json
    const manifestPath = path.join(PLUGIN_DIR, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
        console.error('Error: plugin.json not found');
        process.exit(1);
    }
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
        console.error(`Error: failed to parse plugin.json: ${err.message}`);
        process.exit(1);
    }

    const { id, version } = manifest;
    if (!id || !version) {
        console.error('Error: plugin.json must have "id" and "version" fields');
        process.exit(1);
    }

    const hasBackground = fs.existsSync(path.join(PLUGIN_DIR, 'background', 'package.json'));
    const hasUi = fs.existsSync(path.join(PLUGIN_DIR, 'ui', 'package.json'));

    // ── Build ──────────────────────────────────────────────────────────────────
    if (shouldBuild) {
        console.log(`Building: ${id} v${version}`);
        try {
            if (hasBackground) runBuild(path.join(PLUGIN_DIR, 'background'), 'background');
            if (hasUi) runBuild(path.join(PLUGIN_DIR, 'ui'), 'ui');
        } catch (err) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    }

    // Validate that build artifacts are present
    if (hasBackground && !fs.existsSync(path.join(PLUGIN_DIR, 'background', 'build', 'index.js'))) {
        console.error('Error: background/build/index.js not found.');
        console.error('  Run with --build, or run `npm run build` inside background/ first.');
        process.exit(1);
    }
    if (hasUi && !fs.existsSync(path.join(PLUGIN_DIR, 'ui', 'dist'))) {
        console.error('Error: ui/dist/ not found.');
        console.error('  Run with --build, or run `npm run build` inside ui/ first.');
        process.exit(1);
    }

    // ── Install or Pack ────────────────────────────────────────────────────────
    if (shouldInstall) {
        console.log(`Installing: ${id} v${version}`);
        installPlugin(manifest, hasBackground, hasUi);
    } else {
        console.log(`Packing: ${id} v${version}`);
        packPlugin(manifest, hasBackground, hasUi, outDir);
    }
}

main();
