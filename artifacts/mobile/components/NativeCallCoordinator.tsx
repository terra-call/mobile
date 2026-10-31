import React, { useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { deleteField, doc, onSnapshot, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/services/firebase";
import { stopRingtone } from "@/services/ringtone";
import {
  finishNativeCall, getCallKeep, nativeCallSnapshot, setupNativeCalls,
  setNativeCallOwner, subscribeNativeCalls, subscribeVoipToken, type NativeCall,
  disableNativeCallRegistration,
} from "@/services/nativeCalls";

// Owns only native Answer/Decline -> authenticated Firestore -> navigation.
// Existing Twilio screen remains the sole owner of video/media.
export function NativeCallCoordinator() {
  const { user, loading } = useAuth();
  const [calls, setCalls] = useState<NativeCall[]>(nativeCallSnapshot);
  const navigating = useRef(new Set<string>());
  const userId = user?.id;

  useEffect(() => subscribeNativeCalls(() => setCalls(nativeCallSnapshot())), []);

  useEffect(() => {
    if (!userId || user?.role === "admin" || !db || !getCallKeep()) return;
    let cancelled = false;
    let registering = false;
    let unsubscribeToken: (() => void) | undefined;
    const save = async (token: string) => {
      if (cancelled) return;
      await updateDoc(doc(db!, "users", userId), {
        nativeCallPushToken: token,
        nativeCallPlatform: Platform.OS,
        nativeCallApnsEnvironment: Constants.expoConfig?.extra?.nativeCallApnsEnvironment ?? "production",
      });
    };
    const register = async () => {
      if (registering || cancelled) return;
      registering = true;
      try {
        const ready = await setupNativeCalls();
        if (cancelled) return;
        if (!ready || (Platform.OS === "android" &&
          (await Notifications.getPermissionsAsync()).status !== "granted")) {
          await disableNativeCallRegistration();
          await updateDoc(doc(db!, "users", userId), {
            nativeCallPushToken: deleteField(),
            nativeCallPlatform: deleteField(),
            nativeCallApnsEnvironment: deleteField(),
          });
          return;
        }
        await setNativeCallOwner(userId);
        if (Platform.OS === "ios") {
          if (!unsubscribeToken) unsubscribeToken = subscribeVoipToken((token) => {
            save(token).catch(() => console.warn("[NativeCalls] VoIP token registration failed"));
          });
        } else if (Platform.OS === "android") {
          const messaging = require("@react-native-firebase/messaging").default as
            typeof import("@react-native-firebase/messaging").default;
          await save(await messaging().getToken());
          if (!unsubscribeToken) {
            const subscription = Notifications.addPushTokenListener((token) => {
              if (token.type === "android" && typeof token.data === "string") {
                save(token.data).catch(() => console.warn("[NativeCalls] FCM token refresh failed"));
              }
            });
            unsubscribeToken = () => subscription.remove();
          }
        }
      } catch {
        console.warn("[NativeCalls] Native calling setup incomplete; legacy calls remain available");
      } finally {
        registering = false;
      }
    };
    void register();
    const resume = AppState.addEventListener("change", (state) => {
      if (state === "active") void register();
    });
    return () => {
      cancelled = true;
      unsubscribeToken?.();
      resume.remove();
    };
  }, [userId, user?.role]);

  const call = calls[0];
  useEffect(() => {
    if (loading || !call || !db) return;
    if (!userId || userId !== call.targetUid) {
      finishNativeCall(call.callUUID, 1);
      return;
    }
    let cancelled = false;
    let processing = false;
    let navigationTimer: ReturnType<typeof setTimeout> | undefined;
    let resume: { remove: () => void } | undefined;
    const ref = doc(db, "cameraActivations", call.signalDocId);
    const unsubscribe = onSnapshot(ref, async (snapshot) => {
      if (cancelled || processing) return;
      const data = snapshot.data();
      const isRecipientCall = data?.initiatedBy === "recipient";
      const target = isRecipientCall ? data?.caregiverId : data?.receiverUid;
      const roleMatches = isRecipientCall ? user?.role === "caregiver" : user?.role === "care-receiver";
      if (!data || data.callUUID?.toLowerCase() !== call.callUUID || target !== userId || !roleMatches) {
        finishNativeCall(call.callUUID, 1);
        return;
      }
      if (["declined", "cancelled", "ended", "processed"].includes(data.status)) {
        finishNativeCall(call.callUUID, 2);
        return;
      }
      if (call.action === "ringing") {
        if (data.status !== "pending") finishNativeCall(call.callUUID, 4);
        return;
      }
      if (call.action === "connected") return;
      if (navigating.current.has(call.callUUID) && call.action === "answer") return;
      processing = true;
      try {
        const won = await runTransaction(db!, async (tx) => {
          const latest = (await tx.get(ref)).data();
          if (!latest) return false;
          if (call.action === "end") {
            if (latest.status === "pending") {
              tx.update(ref, { status: "declined", respondedAt: serverTimestamp() });
            } else if (latest.status === "answered") {
              tx.update(ref, { status: "ended", endedAt: serverTimestamp() });
            }
            return true;
          }
          if (latest.status !== "pending" || call.expiresAt <= Date.now()) return false;
          tx.update(ref, { status: "answered", respondedAt: serverTimestamp() });
          return true;
        });
        if (cancelled) return;
        if (!won || call.action === "end") {
          finishNativeCall(call.callUUID, won ? 2 : 4);
          return;
        }
        navigating.current.add(call.callUUID);
        stopRingtone();
        // The system can answer while locked, but iOS will not permit camera
        // capture there. Wait for unlock/foreground, then let camera-stream's
        // existing permission gate run. Never bypass camera/mic permission.
        const navigate = () => {
          if (cancelled || AppState.currentState !== "active" || navigationTimer) return;
          navigationTimer = setTimeout(() => {
            if (cancelled) return;
            if (AppState.currentState !== "active") {
              navigationTimer = undefined;
              return;
            }
            router.push({
              pathname: "/camera-stream",
              params: {
                mode: "publish",
                roomName: data.roomName,
                receiverId: isRecipientCall ? data.recipientId : data.receiverUid,
                otherPartyName: isRecipientCall
                  ? data.recipientName ?? "Care recipient" : data.callerName ?? "Caregiver",
                activationDocId: call.signalDocId,
                nativeCallUUID: call.callUUID,
              },
            });
          }, 1200);
        };
        navigate();
        resume = AppState.addEventListener("change", () => navigate());
      } catch {
        if (cancelled) return;
        finishNativeCall(call.callUUID, 1);
        Alert.alert("Could not answer", "The call could not be connected. Please try again.");
      } finally {
        processing = false;
      }
    }, () => finishNativeCall(call.callUUID, 1));
    return () => {
      cancelled = true;
      unsubscribe();
      resume?.remove();
      if (navigationTimer) clearTimeout(navigationTimer);
    };
  }, [loading, userId, user?.role, call?.callUUID, call?.action]);

  return null;
}
