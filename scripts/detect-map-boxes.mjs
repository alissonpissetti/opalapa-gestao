import fs from 'fs';
import jpeg from 'jpeg-js';

function decodeImage(path) {
  const buf = fs.readFileSync(path);
  const { width, height, data } = jpeg.decode(buf, { useTArray: true });
  return { width, height, pixels: data };
}

function isBlue(r, g, b) {
  return g > 235 && b > 235 && r > 155 && r < 215;
}

function findComponents(width, height, pixels) {
  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx]) continue;
      const oi = idx * 4;
      if (!isBlue(pixels[oi], pixels[oi + 1], pixels[oi + 2])) continue;

      const stack = [[x, y]];
      const pts = [];
      visited[idx] = 1;

      while (stack.length) {
        const [cx, cy] = stack.pop();
        pts.push([cx, cy]);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (visited[ni]) continue;
          const no = ni * 4;
          if (!isBlue(pixels[no], pixels[no + 1], pixels[no + 2])) continue;
          visited[ni] = 1;
          stack.push([nx, ny]);
        }
      }

      if (pts.length > 300) components.push(pts);
    }
  }
  return components;
}

function erode(pts, radius) {
  const set = new Set(pts.map(([x, y]) => `${x},${y}`));
  return pts.filter(([x, y]) => {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (!set.has(`${x + dx},${y + dy}`)) return false;
      }
    }
    return true;
  });
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

function quadFromComponent(pts) {
  const inner = erode(pts, 3);
  return minAreaRectCorners(inner.length > 80 ? inner : erode(pts, 1));
}

function centroid(corners) {
  return [
    corners.reduce((s, p) => s + p[0], 0) / corners.length,
    corners.reduce((s, p) => s + p[1], 0) / corners.length,
  ];
}

function fmt(corners) {
  return corners.map(([x, y]) => `${x},${y}`).join(' ');
}

function detect(path, ids, rowThreshold) {
  const { width, height, pixels } = decodeImage(path);
  const boxes = findComponents(width, height, pixels).map((pts) => ({
    corners: quadFromComponent(pts),
    c: centroid(quadFromComponent(pts)),
  }));

  boxes.sort((a, b) => {
    if (Math.abs(a.c[1] - b.c[1]) > rowThreshold) return a.c[1] - b.c[1];
    return a.c[0] - b.c[0];
  });

  console.log(`\n// ${path} — ${boxes.length} boxes`);
  boxes.forEach((box, i) => {
    const id = ids[i];
    if (id == null) return;
    console.log(`  { id: ${id}, label: 'Espaço ${id}', points: '${fmt(box.corners)}' },`);
  });
}

detect('public/map-feira-comercial-1.jpg', Array.from({ length: 16 }, (_, i) => i + 1), 35);
detect('public/map-feira-comercial-2.jpg', [17, 18, 19, 20, 21, 22, 23], 28);
