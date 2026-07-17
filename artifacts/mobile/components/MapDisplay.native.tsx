import Constants from "expo-constants";
import React from "react";
import { Platform, StyleSheet } from "react-native";
import MapView, { Marker } from "react-native-maps";
import type { CareReceiver } from "@/contexts/CareDataContext";
import { MapFallbackList } from "@/components/MapFallbackList";

const STATUS_COLORS: Record<string, string> = {
  "checked-in": "#22FF6E",
  missed: "#FFB347",
  emergency: "#FF3B30",
  unknown: "#8892B0",
};

interface MapDisplayProps {
  receivers: CareReceiver[];
}

export function MapDisplay({ receivers }: MapDisplayProps) {
  const withLocation = receivers.filter((r) => r.location);

  // Android's map requires a Google Maps API key baked into the native build.
  // app.config.js injects it (from GOOGLE_MAPS_ANDROID_API_KEY) and sets
  // extra.androidMapsKeyConfigured accordingly. On a binary built WITHOUT the
  // key, rendering MapView hard-crashes the app natively ("Terra Call closed
  // because this app has a bug") — so gate on the flag and show the list
  // fallback instead. iOS uses Apple Maps (no key needed).
  const androidMapsKeyConfigured =
    (Constants.expoConfig?.extra as { androidMapsKeyConfigured?: boolean } | undefined)
      ?.androidMapsKeyConfigured === true;
  if (Platform.OS === "android" && !androidMapsKeyConfigured) {
    return (
      <MapFallbackList
        receivers={receivers}
        notice="The interactive map view is temporarily unavailable on this device. Locations are listed above."
      />
    );
  }

  const initialRegion =
    withLocation.length > 0
      ? {
          latitude:
            withLocation.reduce((s, r) => s + r.location!.lat, 0) / withLocation.length,
          longitude:
            withLocation.reduce((s, r) => s + r.location!.lng, 0) / withLocation.length,
          latitudeDelta: 0.025,
          longitudeDelta: 0.025,
        }
      : { latitude: 37.7749, longitude: -122.4194, latitudeDelta: 0.05, longitudeDelta: 0.05 };

  return (
    <MapView
      style={styles.map}
      initialRegion={initialRegion}
      userInterfaceStyle="dark"
    >
      {withLocation.map((r) => (
        <Marker
          key={r.id}
          coordinate={{ latitude: r.location!.lat, longitude: r.location!.lng }}
          title={r.name}
          description={
            r.status === "emergency"
              ? "EMERGENCY"
              : r.status === "missed"
              ? "Missed check-in"
              : "Safe"
          }
          pinColor={STATUS_COLORS[r.status]}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
