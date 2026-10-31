#!/usr/bin/env node
/** Cross-platform CCX packager (zip). Keeps scripts/package.ps1 for Windows. */
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pluginDir = path.join(root, 'plugin');
const distDir = path.join(root, 'dist');

async function* walk(dir, base = dir) {
  for (const name of await readdir(dir)) {
    if (name === '.uxprc') continue;
    const full = path.join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) yield* walk(full, base);
    else yield { full, rel: path.relative(base, full).split(path.sep).join('/') };
  }
}

// Minimal ZIP (store) writer without external deps
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

async function buildZip(files, outPath) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const data = await readFile(file.full);
    const nameBuf = Buffer.from(file.rel, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    chunks.push(local, data);
    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    nameBuf.copy(cen, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  await writeFile(outPath, Buffer.concat([...chunks, centralBuf, end]));
}

const manifest = JSON.parse(await readFile(path.join(pluginDir, 'manifest.json'), 'utf8'));
const version = manifest.version || '0.0.0';
await mkdir(distDir, { recursive: true });
const outName = `局部改图-LK888-${version}.ccx`;
const outPath = path.join(distDir, outName);
const files = [];
for await (const f of walk(pluginDir)) files.push(f);
await buildZip(files, outPath);
const st = await stat(outPath);
console.log(JSON.stringify({ FullName: outPath, Length: st.size, version }, null, 2));
