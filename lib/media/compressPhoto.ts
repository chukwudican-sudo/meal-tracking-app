// Shared client-side photo compression for the AI vision features (scan-meal,
// scan-kitchen). Camera/library photos come back at full sensor resolution
// (often 3000px+ / several MB); the pickers' own `quality` flag only tunes JPEG
// compression, never pixel dimensions, so an uncompressed photo can still blow
// past the edge functions' payload caps and slow the Gemini call. Resizing the
// long edge is the piece that was missing — do it once here so both capture
// paths get the same treatment.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Long-edge cap in px — plenty of detail for Gemini vision, far below a raw
// camera capture.
const MAX_DIMENSION = 1280;
// JPEG quality (0..1). 0.6 + the resize reliably lands photos well inside the
// ~500KB-1MB spec target.
const JPEG_COMPRESS = 0.6;

export interface CompressedPhoto {
  base64: string;
  mimeType: string;
}

// Resize (long edge -> MAX_DIMENSION, aspect preserved) and re-encode as JPEG,
// returning the bare base64 (no data: prefix) plus its mime type. Accepts a
// local file URI or a base64 data URI.
export async function compressPhotoToBase64(uri: string): Promise<CompressedPhoto> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: MAX_DIMENSION });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    compress: JPEG_COMPRESS,
    format: SaveFormat.JPEG,
    base64: true,
  });
  return { base64: result.base64 ?? '', mimeType: 'image/jpeg' };
}
