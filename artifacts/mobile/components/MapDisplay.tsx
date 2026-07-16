import React from "react";
import type { CareReceiver } from "@/contexts/CareDataContext";
import { MapFallbackList } from "@/components/MapFallbackList";

interface MapDisplayProps {
  receivers: CareReceiver[];
}

// Web build — react-native-maps is native-only, so web always shows the
// coordinate list fallback.
export function MapDisplay({ receivers }: MapDisplayProps) {
  return (
    <MapFallbackList
      receivers={receivers}
      notice="Interactive GPS map is available on the iOS app."
    />
  );
}
