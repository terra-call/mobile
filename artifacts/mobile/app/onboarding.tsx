import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { STORAGE_KEYS } from "@/constants/storage";
const ONBOARDING_KEY = STORAGE_KEYS.ONBOARDING_SEEN;

const { width } = Dimensions.get("window");

interface Slide {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  iconColor: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    key: "monitor",
    icon: "shield",
    iconColor: "#00C8FF",
    title: "Real-Time Monitoring",
    body: "Caregivers see the live status of every care recipient at a glance — checked in, missed, or in need of help.",
  },
  {
    key: "checkin",
    icon: "check-circle",
    iconColor: "#22FF6E",
    title: "One-Tap Check-Ins",
    body: "Care recipients tap \"I'M OK\" on a schedule you set. It takes one second and gives everyone peace of mind.",
  },
  {
    key: "alerts",
    icon: "bell",
    iconColor: "#FF3B30",
    title: "Instant Alerts",
    body: "If a check-in is missed, caregivers are notified by push notification and SMS backup — automatically.",
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;

  const topPadding = Platform.OS === "web" ? 80 : insets.top + 40;
  const bottomPadding = Platform.OS === "web" ? 40 : insets.bottom + 24;

  const handleNext = async () => {
    if (currentIndex < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    } else {
      await AsyncStorage.setItem(ONBOARDING_KEY, "true");
      router.replace("/login");
    }
  };

  const handleSkip = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "true");
    router.replace("/login");
  };

  const renderSlide = ({ item }: { item: Slide }) => (
    <View style={[styles.slide, { width }]}>
      <View style={[styles.iconRing, { borderColor: item.iconColor + "44", backgroundColor: item.iconColor + "18" }]}>
        <View style={[styles.iconInner, { backgroundColor: item.iconColor + "28" }]}>
          <Feather name={item.icon} size={48} color={item.iconColor} />
        </View>
      </View>
      <Text style={styles.slideTitle}>{item.title}</Text>
      <Text style={styles.slideBody}>{item.body}</Text>
    </View>
  );

  const isLast = currentIndex === SLIDES.length - 1;

  return (
    <View style={[styles.root, { paddingTop: topPadding, paddingBottom: bottomPadding }]}>
      {/* Skip */}
      {!isLast && (
        <Pressable onPress={handleSkip} style={styles.skipBtn}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      )}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.appName}>TERRA CALL</Text>
        <View style={styles.accentLine} />
      </View>

      {/* Slides */}
      <Animated.FlatList
        ref={listRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false }
        )}
        onMomentumScrollEnd={(e) => {
          setCurrentIndex(Math.round(e.nativeEvent.contentOffset.x / width));
        }}
        style={styles.list}
      />

      {/* Dots */}
      <View style={styles.dots}>
        {SLIDES.map((_, i) => {
          const opacity = scrollX.interpolate({
            inputRange: [(i - 1) * width, i * width, (i + 1) * width],
            outputRange: [0.3, 1, 0.3],
            extrapolate: "clamp",
          });
          const w = scrollX.interpolate({
            inputRange: [(i - 1) * width, i * width, (i + 1) * width],
            outputRange: [8, 24, 8],
            extrapolate: "clamp",
          });
          return (
            <Animated.View
              key={i}
              style={[styles.dot, { opacity, width: w, backgroundColor: SLIDES[currentIndex]?.iconColor ?? "#22FF6E" }]}
            />
          );
        })}
      </View>

      {/* CTA */}
      <Pressable
        onPress={handleNext}
        style={[styles.btn, { backgroundColor: SLIDES[currentIndex]?.iconColor ?? "#22FF6E" }]}
      >
        <Text style={[styles.btnText, { color: isLast ? "#060a18" : "#060a18" }]}>
          {isLast ? "Get Started" : "Next"}
        </Text>
        {!isLast && <Feather name="arrow-right" size={18} color="#060a18" style={{ marginLeft: 8 }} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#060a18",
    alignItems: "center",
  },
  skipBtn: {
    position: "absolute",
    top: Platform.OS === "web" ? 24 : 56,
    right: 24,
    zIndex: 10,
    padding: 8,
  },
  skipText: {
    color: "#8892B0",
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  header: {
    alignItems: "center",
    marginBottom: 32,
    gap: 8,
  },
  appName: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 5,
    fontFamily: "Inter_700Bold",
  },
  accentLine: {
    width: 36,
    height: 2,
    backgroundColor: "#22FF6E",
    borderRadius: 1,
  },
  list: {
    flexGrow: 0,
  },
  slide: {
    alignItems: "center",
    paddingHorizontal: 40,
    gap: 24,
  },
  iconRing: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconInner: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
  },
  slideTitle: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  slideBody: {
    color: "#8892B0",
    fontSize: 16,
    lineHeight: 26,
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 32,
    marginBottom: 24,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingVertical: 17,
    width: width - 48,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  btnText: {
    fontSize: 17,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
});
