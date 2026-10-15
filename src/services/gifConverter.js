import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';

/**
 * Execute a child process and return stdout/stderr promise
 */
function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command ${command} failed with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Convert a Video buffer or file to animated GIF using FFmpeg
 */
export async function convertVideoToGif(inputBuffer, options = {}) {
  const {
    startTime = 0,
    duration = 6,
    fps = 12,
    width = 480,
  } = options;

  const tempDir = path.join(os.tmpdir(), `genz_gif_${crypto.randomBytes(6).toString('hex')}`);
  await fs.promises.mkdir(tempDir, { recursive: true });

  const inputPath = path.join(tempDir, 'input_video.mp4');
  const outputPath = path.join(tempDir, 'output.gif');

  try {
    await fs.promises.writeFile(inputPath, inputBuffer);

    // High quality 2-pass palette generation with FFmpeg
    // Handles video trimming, scaling, and palette optimization for smooth GIF playback
    const scaleFilter = width && width !== 'original' ? `scale=${parseInt(width, 10)}:-1:flags=lanczos` : 'scale=iw:-1';
    const filterGraph = `fps=${Math.min(Math.max(parseInt(fps, 10) || 12, 5), 30)},${scaleFilter},split[s0][s1];[s0]palettegen=max_colors=256:reserve_transparent=1[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`;

    const args = [
      '-y',
      '-ss', String(Math.max(0, parseFloat(startTime) || 0)),
      '-t', String(Math.min(Math.max(1, parseFloat(duration) || 6), 30)),
      '-i', inputPath,
      '-vf', filterGraph,
      '-loop', '0',
      outputPath,
    ];

    await runProcess('ffmpeg', args);

    if (!fs.existsSync(outputPath)) {
      throw new Error('GIF generation failed: output file not created');
    }

    const gifBuffer = await fs.promises.readFile(outputPath);
    const stats = await fs.promises.stat(outputPath);

    return {
      buffer: gifBuffer,
      size: stats.size,
      mimeType: 'image/gif',
      filename: `video_animation_${Date.now()}.gif`,
    };
  } finally {
    // Clean up temporary files
    try {
      if (fs.existsSync(inputPath)) await fs.promises.unlink(inputPath);
      if (fs.existsSync(outputPath)) await fs.promises.unlink(outputPath);
      if (fs.existsSync(tempDir)) await fs.promises.rmdir(tempDir);
    } catch (cleanupErr) {
      console.warn('[GifConverter] Cleanup warning:', cleanupErr.message);
    }
  }
}

/**
 * Convert an array of Image buffers into an animated GIF using Pillow
 */
export async function convertImagesToGif(imageBuffers, options = {}) {
  const {
    delay = 300, // milliseconds per frame
    loop = 0,    // 0 = infinite loop
    width = 480, // optional resize width
  } = options;

  if (!imageBuffers || imageBuffers.length === 0) {
    throw new Error('No images provided for GIF conversion');
  }

  const tempDir = path.join(os.tmpdir(), `genz_img_gif_${crypto.randomBytes(6).toString('hex')}`);
  await fs.promises.mkdir(tempDir, { recursive: true });

  const inputPaths = [];
  const outputPath = path.join(tempDir, 'output.gif');

  try {
    for (let i = 0; i < imageBuffers.length; i++) {
      const p = path.join(tempDir, `frame_${String(i).padStart(4, '0')}.png`);
      await fs.promises.writeFile(p, imageBuffers[i]);
      inputPaths.push(p);
    }

    // Python Pillow conversion script
    // Supports multi-frame animation, resizing, aspect preservation, and single-image pulse animation
    const pythonScript = `
import sys
import os
from PIL import Image

try:
    paths = sys.argv[1:-3]
    frame_delay = int(sys.argv[-3])
    max_w = int(sys.argv[-2])
    out_file = sys.argv[-1]

    imgs = []
    for p in paths:
        im = Image.open(p).convert('RGBA')
        imgs.append(im)

    if not imgs:
        sys.exit(1)

    target_w = imgs[0].width
    target_h = imgs[0].height

    if max_w > 0 and target_w > max_w:
        ratio = max_w / float(target_w)
        target_w = max_w
        target_h = int(target_h * ratio)

    # If only 1 image provided, create a subtle 4-frame breathing/pulse animation so it has motion
    if len(imgs) == 1:
        base = imgs[0].resize((target_w, target_h), Image.Resampling.LANCZOS)
        frames = []
        scales = [1.0, 1.03, 1.06, 1.03]
        for s in scales:
            sw = int(target_w * s)
            sh = int(target_h * s)
            scaled = base.resize((sw, sh), Image.Resampling.LANCZOS)
            # Center crop or pad to target_w, target_h
            left = (sw - target_w) // 2
            top = (sh - target_h) // 2
            cropped = scaled.crop((left, top, left + target_w, top + target_h))
            frames.append(cropped)
        frames[0].save(out_file, save_all=True, append_images=frames[1:], duration=max(150, frame_delay), loop=0, optimize=True)
    else:
        # Normalize all frames to match first frame dimension
        normalized = []
        for im in imgs:
            if im.size != (target_w, target_h):
                resized = im.resize((target_w, target_h), Image.Resampling.LANCZOS)
                normalized.append(resized)
            else:
                normalized.append(im)

        normalized[0].save(
            out_file,
            save_all=True,
            append_images=normalized[1:],
            duration=frame_delay,
            loop=0,
            optimize=True
        )

    print("SUCCESS")
except Exception as e:
    print(f"ERROR: {str(e)}", file=sys.stderr)
    sys.exit(1)
`;

    const scriptPath = path.join(tempDir, 'convert.py');
    await fs.promises.writeFile(scriptPath, pythonScript, 'utf8');

    const targetWidth = parseInt(width, 10) || 480;
    const targetDelay = Math.min(Math.max(50, parseInt(delay, 10) || 300), 2000);

    const args = [
      scriptPath,
      ...inputPaths,
      String(targetDelay),
      String(targetWidth),
      outputPath,
    ];

    await runProcess('python', args);

    if (!fs.existsSync(outputPath)) {
      throw new Error('GIF generation failed: output file was not produced');
    }

    const gifBuffer = await fs.promises.readFile(outputPath);
    const stats = await fs.promises.stat(outputPath);

    return {
      buffer: gifBuffer,
      size: stats.size,
      mimeType: 'image/gif',
      filename: `image_animation_${Date.now()}.gif`,
    };
  } finally {
    // Cleanup temp directory
    try {
      const files = await fs.promises.readdir(tempDir);
      for (const f of files) {
        await fs.promises.unlink(path.join(tempDir, f)).catch(() => {});
      }
      await fs.promises.rmdir(tempDir).catch(() => {});
    } catch (cleanupErr) {
      console.warn('[GifConverter] Cleanup warning:', cleanupErr.message);
    }
  }
}
