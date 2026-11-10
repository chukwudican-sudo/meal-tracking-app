// Meal photos in cloud storage (Nov 9). The phone's own photo path points into
// its temporary folder (iOS can empty it, and it never exists on another phone
// or after a reinstall), so when a meal syncs its photo is compressed and
// uploaded to the private `meal-photos` bucket, like mainstream food apps do.
// meal_logs.image_url / MealEntry.photoPath hold "meal-photos/<uid>/<file>".
// Display: the local file when this phone still has it, else a signed URL
// (private bucket) that expo-image caches on disk by the stable path.

import { Image } from 'expo-image';

import { supabase } from '@/lib/supabase';
import { stableId } from '@/lib/sync/uuid';
import { withTimeout } from '@/lib/timeoutSignal';
import { compressPhotoToBase64 } from './compressPhoto';

export const MEAL_PHOTO_BUCKET = 'meal-photos';
const PREFIX = `${MEAL_PHOTO_BUCKET}/`;

// ~1080px long edge at 0.6 JPEG lands around 150–250 KB.
const UPLOAD_MAX_DIMENSION = 1080;
const UPLOAD_COMPRESS = 0.6;
const SIGNED_URL_SECONDS = 60 * 60;

export function isCloudPhotoPath(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(PREFIX) && v.length > PREFIX.length;
}

function objectPath(cloudPath: string): string {
  return cloudPath.slice(PREFIX.length);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Compress + upload. Returns the cloud path, or null when the local photo is
// gone (iOS emptied the temp folder, or it came from another phone): the meal
// still syncs, just without a photo. A network/storage failure throws, so the
// outbox retries the whole meal write later.
export async function uploadMealPhoto(userId: string, mealId: string, localUri: string): Promise<string | null> {
  let base64: string;
  try {
    ({ base64 } = await compressPhotoToBase64(localUri, {
      maxDimension: UPLOAD_MAX_DIMENSION,
      compress: UPLOAD_COMPRESS,
    }));
  } catch (e) {
    console.warn('[photos] local photo unreadable, syncing meal without it:', e);
    return null;
  }
  if (!base64) return null;
  // Name from the local photo: a retry of the same photo overwrites the same
  // file (no orphan per attempt), a replaced photo gets a new name (so no
  // cached old image is ever shown for it).
  const path = `${userId}/${mealId}-${stableId(localUri).slice(0, 8)}.jpg`;
  // Time-limited: a stalled upload must not hold up the whole sync queue.
  const { error } = await withTimeout(
    supabase.storage
      .from(MEAL_PHOTO_BUCKET)
      .upload(path, base64ToBytes(base64), { contentType: 'image/jpeg', upsert: true }),
    30_000,
    'photo upload timed out',
  );
  if (error) throw new Error(`photo upload: ${error.message}`);
  return `${PREFIX}${path}`;
}

// Removing a photo that's already gone is fine (Storage returns no error).
export async function removeMealPhoto(cloudPath: string): Promise<void> {
  if (!isCloudPhotoPath(cloudPath)) return;
  const { error } = await supabase.storage.from(MEAL_PHOTO_BUCKET).remove([objectPath(cloudPath)]);
  if (error) throw new Error(`photo remove: ${error.message}`);
}

// Signed URLs, cached until shortly before they expire; one request per path
// at a time.
const urlCache = new Map<string, { url: string; expiresAt: number }>();
const inFlight = new Map<string, Promise<string | null>>();

export function getMealPhotoUrl(cloudPath: string): Promise<string | null> {
  const hit = urlCache.get(cloudPath);
  if (hit && hit.expiresAt - Date.now() > 5 * 60_000) return Promise.resolve(hit.url);
  const pending = inFlight.get(cloudPath);
  if (pending) return pending;
  const p = (async () => {
    try {
      const { data, error } = await supabase.storage
        .from(MEAL_PHOTO_BUCKET)
        .createSignedUrl(objectPath(cloudPath), SIGNED_URL_SECONDS);
      if (error || !data?.signedUrl) {
        console.warn('[photos] signed URL failed:', error?.message);
        return null;
      }
      urlCache.set(cloudPath, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_URL_SECONDS * 1000 });
      return data.signedUrl;
    } catch (e) {
      console.warn('[photos] signed URL failed:', e);
      return null;
    } finally {
      inFlight.delete(cloudPath);
    }
  })();
  inFlight.set(cloudPath, p);
  return p;
}

// Sign-out: links and expo-image's caches (best effort; never blocks logout).
export function clearMealPhotoCaches(): void {
  urlCache.clear();
  Image.clearMemoryCache().catch(() => {});
  Image.clearDiskCache().catch(() => {});
}
