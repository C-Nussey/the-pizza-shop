/**
 * tools/build-assets.js
 *
 * Bundles assets/svg/*.svg into js/asset-data.js.
 *
 * Why this exists: the shop has to open by double-clicking index.html, and
 * browsers refuse fetch() on file:// URLs, so the artwork cannot be loaded
 * at runtime. Embedding the sources as strings sidesteps that entirely —
 * and it means the whole shop is a folder you can open, zip, or drop into
 * a host page without a web server.
 *
 * It also measures each asset's INK BOUNDS here rather than in the browser.
 * The scene scales artwork to what is actually drawn rather than to its
 * canvas (a "roughen" effect padded the aged tickets, smoke padded the hot
 * ovens), and measuring that needs reading pixels back off a canvas — which
 * a file:// page is not allowed to do. Measuring once at build time removes
 * the problem and makes the result deterministic.
 *
 * Run:  node tools/build-assets.js
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const SVG_DIR = path.join(ROOT, "assets", "svg");
const OUT = path.join(ROOT, "js", "asset-data.js");

// Assets whose alignment is governed by their solid body rather than their
// whole inked area, because something wispy (smoke, a daydream balloon)
// extends above it and would otherwise rescale the body. The number is the
// fraction of the canvas, measured up from the bottom, that is "the body".
const BODY_BAND = {
  Pizza_Oven_idle: 0.98,
  Pizza_oven_just_started: 0.98,
  // Tuned so the measured body lands on the same oven height as the cold
  // ovens (~320). Left at 0.62 the smoke ate into the measurement and a hot
  // oven rendered 15% bigger than a cold one — the oven visibly swelled the
  // moment a pizza went in.
  Pizza_oven_cooking: 0.73,
  Pizza_oven_almost_cooked: 0.73,
  Busy_chef: 0.98,
  Relaxed_chef: 0.68,
};

function viewBoxOf(src) {
  const m = /viewBox="([^"]+)"/.exec(src);
  if (m) {
    const v = m[1].trim().split(/[\s,]+/).map(Number);
    if (v.length === 4 && v.every(Number.isFinite)) {
      return { x: v[0], y: v[1], w: v[2], h: v[3] };
    }
  }
  const w = parseFloat((/\swidth="([\d.]+)"/.exec(src) || [])[1]) || 100;
  const h = parseFloat((/\sheight="([\d.]+)"/.exec(src) || [])[1]) || 100;
  return { x: 0, y: 0, w, h };
}

// Reading pixels back needs a real http origin, so serve the folder briefly.
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<!doctype html><title>measure</title>");
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const measureInPage = async ({ src, viewBox, band }) => {
  const SAMPLE = 320;
  const withSize = src.replace(
    /<svg/,
    `<svg width="${viewBox.w}" height="${viewBox.h}"`
  );
  const url = URL.createObjectURL(new Blob([withSize], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error("image failed"));
    img.src = url;
  });

  const scale = SAMPLE / Math.max(viewBox.w, viewBox.h);
  const cw = Math.max(1, Math.round(viewBox.w * scale));
  const ch = Math.max(1, Math.round(viewBox.h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, cw, ch);
  URL.revokeObjectURL(url);

  const data = ctx.getImageData(0, 0, cw, ch).data;

  function bounds(fromBottomFraction) {
    const startRow = fromBottomFraction ? Math.floor(ch * (1 - fromBottomFraction)) : 0;
    let minX = cw, minY = ch, maxX = -1, maxY = -1;
    for (let y = startRow; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (data[(y * cw + x) * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return {
      x: +(viewBox.x + minX / scale).toFixed(2),
      y: +(viewBox.y + minY / scale).toFixed(2),
      w: +((maxX - minX + 1) / scale).toFixed(2),
      h: +((maxY - minY + 1) / scale).toFixed(2),
    };
  }

  return { ink: bounds(null), body: band ? bounds(band) : null };
};

(async () => {
  const names = fs.readdirSync(SVG_DIR).filter((f) => f.endsWith(".svg"));
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);

  const out = {};
  for (const file of names) {
    const name = file.replace(/\.svg$/, "");
    const src = fs.readFileSync(path.join(SVG_DIR, file), "utf8");
    const viewBox = viewBoxOf(src);
    const band = BODY_BAND[name] || null;
    const measured = await page.evaluate(measureInPage, { src, viewBox, band });
    out[name] = {
      src,
      viewBox,
      ink: measured.ink || viewBox,
      body: measured.body || measured.ink || viewBox,
    };
    const ink = out[name].ink;
    console.log(
      `${name.padEnd(30)} canvas ${viewBox.w}x${viewBox.h}`.padEnd(58) +
      ` ink ${ink.w}x${ink.h}` + (band ? `  body ${out[name].body.h}` : "")
    );
  }

  await browser.close();
  server.close();

  const banner =
    "/**\n" +
    " * asset-data.js — GENERATED, do not edit by hand.\n" +
    " *\n" +
    " * Run `node tools/build-assets.js` after changing anything in\n" +
    " * assets/svg/ to regenerate this file.\n" +
    " *\n" +
    " * The artwork is embedded rather than fetched so the shop opens from a\n" +
    " * plain file:// URL (browsers block fetch() on local files), and the ink\n" +
    " * bounds are measured here rather than in the browser because reading\n" +
    " * pixels back off a canvas is not permitted on a file:// page.\n" +
    " */\n";
  fs.writeFileSync(
    OUT,
    banner + "window.ASSET_DATA = " + JSON.stringify(out) + ";\n",
    "utf8"
  );
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`\nWrote js/asset-data.js — ${names.length} assets, ${kb}KB`);
})();
