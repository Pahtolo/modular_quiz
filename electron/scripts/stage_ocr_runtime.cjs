#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const electronDir = path.resolve(__dirname, '..');
const outRoot = path.join(electronDir, 'build', 'ocr-runtime');
const outBin = path.join(outRoot, 'bin');
const outLib = path.join(outRoot, 'lib');
const outTessdata = path.join(outRoot, 'tessdata');

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf-8' }).trim();
}

function exists(candidate) {
  return Boolean(candidate) && fs.existsSync(candidate);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(source, destination) {
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o755);
}

function cleanRuntimeDir() {
  fs.rmSync(outRoot, { recursive: true, force: true });
  ensureDir(outBin);
  ensureDir(outLib);
  ensureDir(outTessdata);
}

function findBinary(names) {
  const candidates = names.filter(Boolean);
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && exists(candidate)) {
      return candidate;
    }
    try {
      const resolved = process.platform === 'win32'
        ? run('where', [candidate]).split(/\r?\n/)[0].trim()
        : run('which', [candidate]);
      if (exists(resolved)) {
        return resolved;
      }
    } catch (_err) {
      // Continue checking additional candidates.
    }
  }
  return '';
}

function copyWindowsRuntimeBinary(binaryPath) {
  const sourceDir = path.dirname(binaryPath);
  const baseName = path.basename(binaryPath);
  copyFile(binaryPath, path.join(outBin, baseName));

  for (const entry of fs.readdirSync(sourceDir)) {
    const source = path.join(sourceDir, entry);
    if (!fs.statSync(source).isFile()) {
      continue;
    }
    if (entry.toLowerCase().endsWith('.dll')) {
      copyFile(source, path.join(outBin, entry));
    }
  }
}

function parseOtoolDependencies(binaryPath) {
  const output = run('otool', ['-L', binaryPath]);
  const lines = output.split(/\r?\n/).slice(1);
  const deps = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const dep = trimmed.split(' (')[0].trim();
    if (!dep || dep.startsWith('/usr/lib/') || dep.startsWith('/System/')) {
      continue;
    }
    deps.push(dep);
  }
  return deps;
}

function parseOtoolRpaths(binaryPath) {
  const output = run('otool', ['-l', binaryPath]);
  const lines = output.split(/\r?\n/);
  const rpaths = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('cmd LC_RPATH')) {
      continue;
    }
    for (let inner = index + 1; inner < Math.min(lines.length, index + 8); inner += 1) {
      const match = lines[inner].trim().match(/^path\s+(.+)\s+\(offset \d+\)$/);
      if (match?.[1]) {
        rpaths.push(match[1]);
        break;
      }
    }
  }
  return rpaths;
}

function resolveMacDependency(sourcePath, dependencyPath) {
  if (dependencyPath.startsWith('/')) {
    return dependencyPath;
  }
  if (dependencyPath.startsWith('@loader_path/')) {
    return path.resolve(path.dirname(sourcePath), dependencyPath.replace('@loader_path/', ''));
  }
  if (dependencyPath.startsWith('@executable_path/')) {
    return path.resolve(path.dirname(sourcePath), dependencyPath.replace('@executable_path/', ''));
  }
  if (dependencyPath.startsWith('@rpath/')) {
    const suffix = dependencyPath.replace('@rpath/', '');
    const rpaths = parseOtoolRpaths(sourcePath);
    for (const rpath of rpaths) {
      let resolvedRpath = rpath;
      if (resolvedRpath.startsWith('@loader_path/')) {
        resolvedRpath = path.resolve(path.dirname(sourcePath), resolvedRpath.replace('@loader_path/', ''));
      } else if (resolvedRpath === '@loader_path') {
        resolvedRpath = path.dirname(sourcePath);
      } else if (resolvedRpath.startsWith('@executable_path/')) {
        resolvedRpath = path.resolve(path.dirname(sourcePath), resolvedRpath.replace('@executable_path/', ''));
      } else if (resolvedRpath === '@executable_path') {
        resolvedRpath = path.dirname(sourcePath);
      }
      const candidate = path.resolve(resolvedRpath, suffix);
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return '';
}

function patchInstallName(targetPath, oldPath, newPath) {
  run('install_name_tool', ['-change', oldPath, newPath, targetPath]);
}

function patchInstallId(targetPath) {
  run('install_name_tool', ['-id', `@loader_path/${path.basename(targetPath)}`, targetPath]);
}

function adHocSign(targetPath) {
  try {
    run('codesign', ['--force', '--sign', '-', targetPath]);
  } catch (error) {
    throw new Error(`Failed to ad-hoc sign ${targetPath}: ${error.message}`);
  }
}

function copyMacRuntimeBinary(binaryPath) {
  const processedBySource = new Map();
  const sourceByBasename = new Map();
  const queue = [];

  const enqueue = (sourcePath, destinationPath, isBinary) => {
    const resolvedSource = fs.realpathSync(sourcePath);
    const key = `${resolvedSource}:${isBinary ? 'bin' : 'lib'}`;
    if (processedBySource.has(key)) {
      return processedBySource.get(key);
    }

    const baseName = path.basename(resolvedSource);
    if (!isBinary) {
      const existing = sourceByBasename.get(baseName);
      if (existing && existing !== resolvedSource) {
        throw new Error(
          `Conflicting macOS library basenames detected: ${baseName} from ${existing} and ${resolvedSource}`
        );
      }
      sourceByBasename.set(baseName, resolvedSource);
    }

    const targetPath = isBinary ? destinationPath : path.join(outLib, baseName);
    processedBySource.set(key, targetPath);
    queue.push({ sourcePath: resolvedSource, targetPath, isBinary });
    return targetPath;
  };

  enqueue(binaryPath, path.join(outBin, path.basename(binaryPath)), true);

  while (queue.length) {
    const { sourcePath, targetPath, isBinary } = queue.shift();
    copyFile(sourcePath, targetPath);

    const dependencies = parseOtoolDependencies(sourcePath);
    for (const dependency of dependencies) {
      const resolvedDependency = resolveMacDependency(sourcePath, dependency);
      if (!exists(resolvedDependency)) {
        throw new Error(`Unable to resolve macOS dependency '${dependency}' for '${sourcePath}'.`);
      }
      const dependencyTarget = enqueue(resolvedDependency, '', false);
      const rewritten = isBinary
        ? `@executable_path/../lib/${path.basename(dependencyTarget)}`
        : `@loader_path/${path.basename(dependencyTarget)}`;
      patchInstallName(targetPath, dependency, rewritten);
    }

    if (!isBinary && targetPath.endsWith('.dylib')) {
      patchInstallId(targetPath);
    }

    adHocSign(targetPath);
  }
}

function findTessdataDir(tesseractPath) {
  const configuredPrefix = String(process.env.TESSDATA_PREFIX || '').trim();
  const candidates = [];
  if (configuredPrefix) {
    candidates.push(path.join(configuredPrefix, 'tessdata'));
    candidates.push(configuredPrefix);
  }

  const tesseractDir = path.dirname(tesseractPath);
  candidates.push(path.join(tesseractDir, 'tessdata'));
  candidates.push(path.resolve(tesseractDir, '..', 'share', 'tessdata'));

  if (process.platform === 'darwin') {
    candidates.push('/opt/homebrew/share/tessdata');
    candidates.push('/usr/local/share/tessdata');
  }
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Tesseract-OCR\\tessdata');
  }

  for (const candidate of candidates) {
    if (!exists(candidate)) {
      continue;
    }
    const engPath = path.join(candidate, 'eng.traineddata');
    const osdPath = path.join(candidate, 'osd.traineddata');
    if (exists(engPath) && exists(osdPath)) {
      return candidate;
    }
  }
  return '';
}

function copyTessdata(tessdataDir) {
  const requiredFiles = ['eng.traineddata', 'osd.traineddata'];
  for (const fileName of requiredFiles) {
    const source = path.join(tessdataDir, fileName);
    if (!exists(source)) {
      throw new Error(`Missing required Tesseract language file: ${source}`);
    }
    copyFile(source, path.join(outTessdata, fileName));
  }
}

function stageOcrRuntime() {
  const tesseractBinary = findBinary([
    process.env.TESSERACT_BIN,
    process.platform === 'win32' ? 'tesseract.exe' : 'tesseract',
    'tesseract',
  ]);
  const pdftoppmBinary = findBinary([
    process.env.PDFTOPPM_BIN,
    process.platform === 'win32' ? 'pdftoppm.exe' : 'pdftoppm',
    'pdftoppm',
  ]);

  if (!tesseractBinary || !pdftoppmBinary) {
    throw new Error(
      `Missing OCR binaries. Found tesseract='${tesseractBinary || ''}', pdftoppm='${pdftoppmBinary || ''}'.`
    );
  }

  const tessdataDir = findTessdataDir(tesseractBinary);
  if (!tessdataDir) {
    throw new Error('Unable to locate Tesseract tessdata directory with eng/osd language files.');
  }

  cleanRuntimeDir();

  if (process.platform === 'win32') {
    copyWindowsRuntimeBinary(tesseractBinary);
    copyWindowsRuntimeBinary(pdftoppmBinary);
  } else if (process.platform === 'darwin') {
    copyMacRuntimeBinary(tesseractBinary);
    copyMacRuntimeBinary(pdftoppmBinary);
  } else {
    throw new Error(`Unsupported platform for OCR runtime staging: ${process.platform}`);
  }

  copyTessdata(tessdataDir);

  console.log(`[stage-ocr-runtime] staged binaries into ${outRoot}`);
  console.log(`[stage-ocr-runtime] tesseract: ${tesseractBinary}`);
  console.log(`[stage-ocr-runtime] pdftoppm: ${pdftoppmBinary}`);
  console.log(`[stage-ocr-runtime] tessdata: ${tessdataDir}`);
}

try {
  stageOcrRuntime();
} catch (error) {
  console.error(`[stage-ocr-runtime] ${error.message}`);
  process.exit(1);
}
