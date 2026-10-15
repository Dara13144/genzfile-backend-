import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function removeBackground() {
  const inputPath = 'C:/Users/rosv2/.gemini/antigravity-ide/brain/5695ceab-b0a3-4dc0-a297-c34dfe04f22c/.user_uploaded/media_1792010274363.jpg';
  const outDir = 'C:/Users/rosv2/Genz file/frontend/public';
  const outputPath = path.join(outDir, 'genz-logo.png');
  const iconPath = path.join(outDir, 'logo.png');
  const faviconSvg = path.join(outDir, 'logo.svg');

  const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Visited array for flood fill
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height * 2);
  let qHead = 0;
  let qTail = 0;

  const push = (x, y) => {
    const idx = y * width + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    queue[qTail++] = x;
    queue[qTail++] = y;
  };

  // Seed with all border pixels
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  // Determine if a pixel belongs to the dark background or subtle embers
  const isBackground = (r, g, b) => {
    // Luminance / max channel
    const maxVal = Math.max(r, g, b);
    const sum = r + g + b;
    // Dark background or faint red smoke
    if (maxVal < 65) return true;
    if (r < 120 && g < 35 && b < 35) return true;
    return false;
  };

  // Perform BFS flood-fill from edges
  while (qHead < qTail) {
    const cx = queue[qHead++];
    const cy = queue[qHead++];
    const pIdx = (cy * width + cx) * channels;
    const r = data[pIdx];
    const g = data[pIdx + 1];
    const b = data[pIdx + 2];

    if (isBackground(r, g, b)) {
      // Mark as transparent
      data[pIdx + 3] = 0;

      // Expand to 4-way neighbors
      const neighbors = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1]
      ];

      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          push(nx, ny);
        }
      }
    } else {
      // Near edge: provide soft feathering if slightly dim
      const maxVal = Math.max(r, g, b);
      if (maxVal < 140 && g < 50 && b < 50) {
        const factor = Math.max(0, Math.min(1, (maxVal - 50) / 90));
        data[pIdx + 3] = Math.round(factor * 255);
      }
    }
  }

  // Save the isolated emblem
  const cleanImage = sharp(data, {
    raw: { width, height, channels }
  });

  // Trim transparent edges around the emblem
  const trimmed = await cleanImage.trim().png({ quality: 100, compressionLevel: 9 }).toBuffer();

  await fs.promises.writeFile(outputPath, trimmed);
  await fs.promises.writeFile(iconPath, trimmed);

  // Also create a resized square navbar icon
  const iconSquare = await sharp(trimmed)
    .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await fs.promises.writeFile(path.join(outDir, 'genz-icon.png'), iconSquare);

  console.log('Successfully generated transparent GenZ File logo!');
}

removeBackground().catch(err => {
  console.error('Error removing background:', err);
  process.exit(1);
});
