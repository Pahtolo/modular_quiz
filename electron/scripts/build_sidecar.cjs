#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const electronDir = path.resolve(__dirname, '..');
const outDir = path.join(electronDir, 'build', 'backend');
const workDir = path.join(electronDir, 'build', 'pyinstaller-work');
const specDir = path.join(electronDir, 'build', 'pyinstaller-spec');
const entrypoint = path.join(rootDir, 'run_api.py');

const platform = process.platform;
const isWindows = platform === 'win32';
const pythonBin = process.env.PYTHON_BIN || (isWindows ? 'python' : 'python3');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(workDir, { recursive: true });
fs.mkdirSync(specDir, { recursive: true });

const args = [
  '-m',
  'PyInstaller',
  '--noconfirm',
  '--clean',
  '--onefile',
  '--name',
  'modular-quiz-api',
  '--distpath',
  outDir,
  '--workpath',
  workDir,
  '--specpath',
  specDir,
  entrypoint,
];

const result = spawnSync(pythonBin, args, { stdio: 'inherit' });
if (result.error) {
  console.error(`Failed to execute '${pythonBin}': ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status || 1);
}

const sidecarFile = path.join(outDir, isWindows ? 'modular-quiz-api.exe' : 'modular-quiz-api');
if (!fs.existsSync(sidecarFile)) {
  console.error(`PyInstaller completed, but sidecar was not found at ${sidecarFile}`);
  process.exit(1);
}

console.log(`Built sidecar: ${sidecarFile}`);
