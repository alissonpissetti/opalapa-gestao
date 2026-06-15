import fs from 'fs';
import jpeg from 'jpeg-js';

const path =
  'C:/Users/Alisson/.cursor/projects/c-Users-Alisson-projetos-Opalapa-gestao/assets/c__Users_Alisson_AppData_Roaming_Cursor_User_workspaceStorage_a0ae89b225cf70c4512591062a990210_images_expositores1-053af838-8089-47bb-b4fe-e338ffabcfd1.png';
const buf = fs.readFileSync(path);
const { width, height, data } = jpeg.decode(buf, { useTArray: true });

function isTent(r, g, b) {
  return r > 200 && g > 185 && b > 160 && r < 255 && !(g > 110 && g > r + 25);
}

function collectPts(x0, y0, x1, y1) {
  const pts = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      if (isTent(data[i], data[i + 1], data[i + 2])) pts.push([x, y]);
    }
  }
  return pts;
}

function minAreaRectCorners(pts) {
  const n = pts.length;
  let mx = 0;
  let my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    const dx = x - mx;
    const dy = y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  sxx /= n;
  sxy /= n;
  syy /= n;

  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  for (const [x, y] of pts) {
    const dx = x - mx;
    const dy = y - my;
    const u = dx * cos + dy * sin;
    const v = -dx * sin + dy * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }

  return [
    [minU, minV],
    [maxU, minV],
    [maxU, maxV],
    [minU, maxV],
  ].map(([u, v]) => [
    Math.round(mx + u * cos - v * sin),
    Math.round(my + u * sin + v * cos),
  ]);
}

function splitBlock(corners, count) {
  const [tl, tr, br, bl] = corners;
  const polys = [];
  for (let i = 0; i < count; i++) {
    const t0 = i / count;
    const t1 = (i + 1) / count;
    polys.push([
      [
        Math.round(tl[0] + (tr[0] - tl[0]) * t0),
        Math.round(tl[1] + (tr[1] - tl[1]) * t0),
      ],
      [
        Math.round(tl[0] + (tr[0] - tl[0]) * t1),
        Math.round(tl[1] + (tr[1] - tl[1]) * t1),
      ],
      [
        Math.round(bl[0] + (br[0] - bl[0]) * t1),
        Math.round(bl[1] + (br[1] - bl[1]) * t1),
      ],
      [
        Math.round(bl[0] + (br[0] - bl[0]) * t0),
        Math.round(bl[1] + (br[1] - bl[1]) * t0),
      ],
    ]);
  }
  return polys;
}

function fmt(c) {
  return c.map(([x, y]) => `${x},${y}`).join(' ');
}

const blocks = [
  { idStart: 1, x0: 0, y0: 360, x1: 355, y1: 420, count: 4 },
  { idStart: 5, x0: 420, y0: 355, x1: 980, y1: 420, count: 10 },
  { idStart: 15, x0: 356, y0: 355, x1: 419, y1: 420, count: 1 },
];

for (const b of blocks) {
  const pts = collectPts(b.x0, b.y0, b.x1, b.y1);
  console.log('pixels', pts.length, 'region', b);
  const corners = minAreaRectCorners(pts);
  console.log('corners', fmt(corners));
  const polys = splitBlock(corners, b.count);
  polys.forEach((poly, i) => {
    const id = b.idStart + i;
    console.log(`  { id: ${id}, label: 'Tenda ${id}', points: '${fmt(poly)}' },`);
  });
}
