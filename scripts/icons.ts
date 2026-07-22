/**
 * Rasterise `assets/icon.svg` into the PNG sizes the stores require.
 *
 *   pnpm icons
 *
 * Uses the Chromium that Playwright already installs rather than adding sharp
 * or resvg. That is not only one fewer dependency: the icon then renders
 * through the *same* engine that will draw it in the toolbar, so what the
 * store sees and what a user sees cannot disagree about antialiasing or how a
 * stroke lands on a half-pixel.
 *
 * Regenerate after any change to the SVG — the PNGs are committed, because a
 * store build must not depend on a browser download.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

/**
 * 16 toolbar · 32 Windows taskbar and Firefox · 48 extensions page ·
 * 128 Chrome Web Store. Chrome derives nothing it is not given, so every one
 * is emitted rather than left to be scaled by the browser.
 */
const SIZES = [16, 32, 48, 128];

const root = new URL('..', import.meta.url);
const source = fileURLToPath(new URL('assets/icon.svg', root));
const outDir = fileURLToPath(new URL('public/icon/', root));

async function main(): Promise<void> {
  const svg = await readFile(source, 'utf8');
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();

  try {
    for (const size of SIZES) {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
        // Render at 4x and let the encoder downsample: rasterising a curve
        // directly at 16 px produces visibly chunkier edges than scaling one
        // rendered at 64.
        deviceScaleFactor: 4,
      });

      // Transparent, because the toolbar supplies its own background — and a
      // white tile would show as a white square in dark mode.
      await page.setContent(
        `<!doctype html><style>
           html,body{margin:0;padding:0;background:transparent}
           svg{display:block;width:${String(size)}px;height:${String(size)}px}
         </style>${svg}`,
      );

      const shot = await page.screenshot({
        omitBackground: true,
        scale: 'css',
      });
      await writeFile(
        new URL(`icon-${String(size)}.png`, `file://${outDir}`),
        shot,
      );
      await page.close();

      console.log(`icon-${String(size)}.png`);
    }
  } finally {
    await browser.close();
  }
}

await main();
