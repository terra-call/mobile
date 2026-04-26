import { Stack } from "expo-router";
import React from "react";

export default function AdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#060a18" },
      }}
    >
      <Stack.Screen name="index" />
    </Stack>
  );
}
