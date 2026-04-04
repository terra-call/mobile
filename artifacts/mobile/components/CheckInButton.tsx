import * as Haptics from "expo-haptics";
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";

interface CheckInButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

export function CheckInButton({ onPress, disabled }: CheckInButtonProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pressAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.1, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const handlePress = async () => {
    Animated.sequence([
      Animated.timing(pressAnim, { toValue: 0.9, duration: 80, useNativeDriver: true }),
      Animated.timing(pressAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    onPress();
  };

  return (
    <Pressable onPress={handlePress} disabled={disabled} style={styles.wrapper}>
      <Animated.View style={[styles.outerGlow, { transform: [{ scale: pulseAnim }] }]} />
      <Animated.View style={[styles.middleGlow, { transform: [{ scale: pulseAnim }] }]} />
      <Animated.View
        style={[
          styles.button,
          { transform: [{ scale: pressAnim }], opacity: disabled ? 0.5 : 1 },
        ]}
      >
        <Text style={styles.text}>I'M OK</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: 280,
    height: 280,
    alignItems: "center",
    justifyContent: "center",
  },
  outerGlow: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(34, 255, 110, 0.07)",
  },
  middleGlow: {
    position: "absolute",
    width: 234,
    height: 234,
    borderRadius: 117,
    backgroundColor: "rgba(34, 255, 110, 0.12)",
  },
  button: {
    width: 188,
    height: 188,
    borderRadius: 94,
    backgroundColor: "#22FF6E",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#22FF6E",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 32,
    elevation: 20,
  },
  text: {
    fontSize: 28,
    fontWeight: "800",
    color: "#060a18",
    letterSpacing: 2,
    fontFamily: "Inter_700Bold",
  },
});
