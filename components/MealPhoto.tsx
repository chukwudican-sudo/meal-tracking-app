// Shows a meal's photo: this phone's own file when it still exists, otherwise
// the cloud copy (private bucket → signed URL, cached on disk by its stable
// path, so it loads once). Falls back to `fallback` when there's neither.

import { Image } from 'expo-image';
import { type ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';

import { COLORS } from '@/constants/theme';
import { getMealPhotoUrl, isCloudPhotoPath } from '@/lib/media/mealPhotos';

interface Props {
  photoUri?: string;
  photoPath?: string;
  style: StyleProp<ImageStyle>;
  // No photo at all.
  fallback?: ReactNode;
  // There is a cloud photo but it can't be loaded now (offline, not cached).
  unavailable?: ReactNode;
}

export function MealPhoto({ photoUri, photoPath, style, fallback = null, unavailable = null }: Props) {
  // The local file can be gone (iOS empties the temp folder): then use the cloud copy.
  const [localFailed, setLocalFailed] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const [cacheMissed, setCacheMissed] = useState(false);
  const useLocal = !!photoUri && !localFailed;
  const cloud = isCloudPhotoPath(photoPath) ? photoPath : undefined;

  useEffect(() => setLocalFailed(false), [photoUri]);

  useEffect(() => {
    setRemoteUrl(null);
    setRemoteFailed(false);
    setCacheMissed(false);
    if (useLocal || !cloud) return;
    let alive = true;
    getMealPhotoUrl(cloud).then(url => {
      if (!alive) return;
      if (url) setRemoteUrl(url);
      else setRemoteFailed(true);
    });
    return () => { alive = false; };
  }, [useLocal, cloud]);

  if (useLocal) {
    return (
      <Image
        source={{ uri: photoUri }}
        style={style}
        contentFit="cover"
        onError={() => setLocalFailed(true)}
      />
    );
  }
  if (!cloud) return <>{fallback}</>;
  if (remoteFailed) {
    // No link (offline): a photo seen before is still in expo-image's disk
    // cache under its path, so try that before giving up.
    if (cacheMissed) return <>{unavailable ?? fallback}</>;
    return (
      <Image
        source={{ uri: `https://offline.invalid/${cloud}`, cacheKey: cloud }}
        style={style}
        contentFit="cover"
        cachePolicy="disk"
        onError={() => setCacheMissed(true)}
      />
    );
  }
  if (!remoteUrl) {
    return (
      <View style={[style as StyleProp<object>, styles.loading]}>
        <ActivityIndicator color={COLORS.textSecondary} />
      </View>
    );
  }
  return (
    <Image
      // cacheKey = the stable path: the signed URL changes each hour, the photo doesn't.
      source={{ uri: remoteUrl, cacheKey: cloud }}
      style={style}
      contentFit="cover"
      transition={150}
      onError={() => setRemoteFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.card },
});
