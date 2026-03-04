const { execFileSync } = require('node:child_process');

module.exports = async function afterPack(context) {
  if (process.platform !== 'darwin') {
    return;
  }

  try {
    console.log(`[afterPack] clearing xattrs in ${context.appOutDir}`);
    execFileSync('xattr', ['-cr', context.appOutDir], { stdio: 'inherit' });
  } catch (err) {
    console.warn('[afterPack] failed to clear xattr:', err?.message || err);
  }
};
