import { Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "@/contexts/AuthContext";

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#22FF6E" />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;
  if (user.role === "admin") return <Redirect href="/(admin)/" />;
  if (user.role === "care-receiver") return <Redirect href="/(care-receiver)/" />;
  return <Redirect href="/(caregiver)/" />;
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    backgroundColor: "#060a18",
    alignItems: "center",
    justifyContent: "center",
  },
});
