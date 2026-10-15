import sharp from 'sharp';

export async function processImageMetadata(buffer, mimeType) {
  try {
    if (mimeType === 'image/svg+xml') {
      return {
        width: 800,
        height: 600,
        thumbnailBuffer: null,
      };
    }

    const image = sharp(buffer);
    const metadata = await image.metadata();

    // Generate responsive thumbnail preview (max 360x360 webp)
    const thumbnailBuffer = await sharp(buffer)
      .resize(360, 360, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();

    return {
      width: metadata.width || null,
      height: metadata.height || null,
      thumbnailBuffer,
      thumbnailMime: 'image/webp',
    };
  } catch (err) {
    console.warn('[MediaProcess] Could not process image metadata/thumbnail:', err.message);
    return {
      width: null,
      height: null,
      thumbnailBuffer: null,
    };
  }
}

export function estimateVideoMetadata(filename, sizeBytes) {
  // Safe default estimation if server does not have ffmpeg installed
  return {
    width: 1920,
    height: 1080,
    durationSeconds: Math.max(1, Math.round(sizeBytes / (1024 * 512))), // rough estimate
  };
}
