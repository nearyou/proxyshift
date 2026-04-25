/**
 * ProxyShift — Extension Packager
 * Creates a distributable ZIP for Chrome/Firefox.
 * Usage:
 *   node scripts/package.js         # Builds both
 *   node scripts/package.js chrome  # Chrome/Edge/Brave only
 *   node scripts/package.js firefox # Firefox only
 *
 * Requires Node.js 18+ (uses built-in zip support via archiving)
 * OR installs nothing (manual ZIP instructions printed)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const CHROME_FILES = [
  'manifest.json',
  'background/service-worker.js',
  'popup/popup.html',
  'popup/popup.css',
  'popup/popup.js',
  'content/anti-detect.js',
  'options/options.html',
  'options/options.css',
  'options/options.js',
  'lib/browser-polyfill.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

const FIREFOX_FILES = [
  ...CHROME_FILES.filter((f) => f !== 'manifest.json'),
  'manifest.v2.json',
];

function ensureDistDir() {
  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
}

function checkIcons() {
  const iconPath = path.join(ROOT, 'icons', 'icon16.png');
  if (!fs.existsSync(iconPath)) {
    console.log('Icons not found. Generating icons first...');
    execSync('node ' + path.join(__dirname, 'generate-icons.js'), { stdio: 'inherit' });
  }
}

function buildZip(browser) {
  const files = browser === 'firefox' ? FIREFOX_FILES : CHROME_FILES;
  const outFile = path.join(DIST, `proxyshift-${browser}-v1.0.0.zip`);

  // Try to use system zip command
  try {
    const fileArgs = files.map((f) => `"${f}"`).join(' ');
    const manifestFile = browser === 'firefox' ? 'manifest.v2.json' : 'manifest.json';

    if (process.platform === 'win32') {
      // Windows: Use PowerShell Compress-Archive
      const filePaths = files
        .map((f) => {
          const src = path.join(ROOT, f);
          if (!fs.existsSync(src)) {
            console.warn(`  ⚠ Skipping missing file: ${f}`);
            return null;
          }
          return src;
        })
        .filter(Boolean)
        .map((p) => `"${p}"`)
        .join(',');

      execSync(
        `powershell Compress-Archive -Force -Path ${filePaths} -DestinationPath "${outFile}"`,
        { cwd: ROOT, stdio: 'inherit' }
      );
    } else {
      // Unix/Mac: Use zip command
      const validFiles = files.filter((f) => {
        const exists = fs.existsSync(path.join(ROOT, f));
        if (!exists) console.warn(`  ⚠ Skipping missing file: ${f}`);
        return exists;
      });

      if (browser === 'firefox') {
        // Rename manifest.v2.json → manifest.json and produce both a ZIP and an unpacked dir
        const tmpDir = path.join(DIST, `_tmp_${browser}`);
        const unpackedDir = path.join(DIST, 'firefox-unpacked');
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        fs.mkdirSync(tmpDir, { recursive: true });

        for (const f of validFiles) {
          const src = path.join(ROOT, f);
          const destName = f === 'manifest.v2.json' ? 'manifest.json' : f;
          const dest = path.join(tmpDir, destName);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }

        execSync(`zip -r "${outFile}" .`, { cwd: tmpDir, stdio: 'inherit' });

        // Keep an unpacked copy for easy about:debugging loading
        if (fs.existsSync(unpackedDir)) fs.rmSync(unpackedDir, { recursive: true });
        fs.cpSync(tmpDir, unpackedDir, { recursive: true });
        console.log(`✓ Firefox unpacked dir: ${unpackedDir} (load manifest.json in about:debugging)`);

        fs.rmSync(tmpDir, { recursive: true });
      } else {
        // Chrome: build with preserved directory structure via a temp dir
        const tmpDir = path.join(DIST, `_tmp_${browser}`);
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        fs.mkdirSync(tmpDir, { recursive: true });
        for (const f of validFiles) {
          const src = path.join(ROOT, f);
          const dest = path.join(tmpDir, f);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
        if (fs.existsSync(outFile)) fs.rmSync(outFile);
        execSync(`zip -r "${outFile}" .`, { cwd: tmpDir, stdio: 'inherit' });
        fs.rmSync(tmpDir, { recursive: true });
      }
    }
    console.log(`✓ ${browser} package: ${outFile}`);
  } catch (err) {
    console.error(`Failed to create ZIP for ${browser}:`, err.message);
    console.log('\nManual packaging: zip these files from the proxyshift/ folder:');
    files.forEach((f) => console.log('  ' + f));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const target = process.argv[2];
ensureDistDir();
checkIcons();

if (!target || target === 'chrome') buildZip('chrome');
if (!target || target === 'firefox') buildZip('firefox');

console.log('\nDone. Load dist/proxyshift-chrome-v1.0.0.zip in Chrome via chrome://extensions (Developer mode → Load unpacked).');
