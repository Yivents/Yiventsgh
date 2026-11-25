'use client';

/** User-owned Storage uploads with client compression and logo colour sampling. */
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '@/lib/firebase/client';

const MAX_EDGE = 1400;
const JPEG_QUALITY = 0.82;

async function loadImage(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return bitmap;
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('That image could not be opened.'));
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Shrink before upload: Storage rules cap images at 6 MB. */
export async function compressImage(file: File): Promise<Blob> {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image compression is not supported in this browser.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('That image could not be compressed.'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

/** Every upload stays under uploads/{uid}/… as required by storage.rules. */
export async function uploadImage(
  uid: string,
  programId: string,
  kind: string,
  file: File,
): Promise<{ path: string; url: string }> {
  const blob = await compressImage(file);
  const safeKind = kind.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'image';
  const path = `uploads/${uid}/programs/${programId}/${safeKind}-${Date.now()}.jpg`;
  const target = ref(storage, path);
  await uploadBytes(target, blob, { contentType: 'image/jpeg' });
  const url = await getDownloadURL(target);
  return { path, url };
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Sample the logo on a small canvas and suggest on-brand colours. */
export async function suggestLogoColors(file: File): Promise<{ primaryColor: string; accentColor: string; backgroundColor: string }> {
  const image = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Colour sampling is not supported in this browser.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 48, 48);
  context.drawImage(image, 0, 0, 48, 48);
  const pixels = context.getImageData(0, 0, 48, 48).data;

  let dark = [0, 0, 0, 0];
  let bright = [0, 0, 0, 0];
  let light = [0, 0, 0, 0];
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    if (a < 160) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const lightness = (max + min) / 510;
    if (saturation > 0.25 && lightness < 0.6) dark = [dark[0] + r, dark[1] + g, dark[2] + b, dark[3] + 1];
    if (saturation > 0.2 && lightness >= 0.4) bright = [bright[0] + r, bright[1] + g, bright[2] + b, bright[3] + 1];
    if (lightness > 0.8 && saturation < 0.2) light = [light[0] + r, light[1] + g, light[2] + b, light[3] + 1];
  }
  const average = (bucket: number[], fallback: string) =>
    bucket[3] ? toHex(bucket[0] / bucket[3], bucket[1] / bucket[3], bucket[2] / bucket[3]) : fallback;

  return {
    primaryColor: average(dark, '#104080'),
    accentColor: average(bright, '#F2A93B'),
    backgroundColor: average(light, '#FFFFFF'),
  };
}
