import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { auth, db, isFirebaseConfigured } from "@/services/firebase";

export type UserRole = "care-receiver" | "caregiver" | "family";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone?: string;
}

interface RegisterData {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  phone?: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Current session key (cleared on logout)
const SESSION_KEY = "@terra:session";
// Persistent UID-indexed profile cache (survives logout so re-login works
// even when Firestore rules haven't been configured yet)
const PROFILE_CACHE_KEY = "@terra:profiles";
// Fallback user store for when Firebase is not configured
const USERS_KEY = "@terra:users";
type StoredUser = User & { password: string };

async function readProfileCache(): Promise<Record<string, User>> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function writeProfileCache(uid: string, userData: User): Promise<void> {
  try {
    const cache = await readProfileCache();
    cache[uid] = userData;
    await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // non-fatal
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isFirebaseConfigured && auth) {
      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          // 1. Try Firestore first
          if (db) {
            try {
              const snap = await getDoc(doc(db, "users", firebaseUser.uid));
              if (snap.exists()) {
                const data = snap.data();
                const userData: User = {
                  id: firebaseUser.uid,
                  email: firebaseUser.email ?? "",
                  name: data.name ?? "",
                  role: (data.role as UserRole) ?? "caregiver",
                  phone: data.phone ?? undefined,
                };
                // Keep the persistent cache fresh
                await writeProfileCache(firebaseUser.uid, userData);
                setUser(userData);
                setLoading(false);
                return;
              }
            } catch {
              // permission-denied or network — fall through to cache
            }
          }

          // 2. Fall back to the persistent profile cache
          const cache = await readProfileCache();
          const cachedUser = cache[firebaseUser.uid];
          if (cachedUser) {
            setUser(cachedUser);
          } else {
            setUser(null);
          }
        } else {
          setUser(null);
        }
        setLoading(false);
      });
      return unsubscribe;
    } else {
      // No Firebase — use local session
      AsyncStorage.getItem(SESSION_KEY)
        .then((val) => { if (val) setUser(JSON.parse(val)); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    if (isFirebaseConfigured && auth) {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // onAuthStateChanged takes over from here and calls setUser
    } else {
      const raw = await AsyncStorage.getItem(USERS_KEY);
      const users: StoredUser[] = raw ? JSON.parse(raw) : [];
      const found = users.find(
        (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
      );
      if (!found) throw new Error("Invalid email or password");
      const { password: _p, ...userData } = found;
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(userData));
      setUser(userData);
    }
  }, []);

  const register = useCallback(async ({ email, password, name, role, phone }: RegisterData) => {
    if (isFirebaseConfigured && auth && db) {
      // Step 1: Create Firebase Auth account
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);

      const userData: User = {
        id: cred.user.uid,
        email: email.trim(),
        name,
        role,
        phone: phone || undefined,
      };

      // Step 2: Persist to the profile cache immediately (survives logout)
      await writeProfileCache(cred.user.uid, userData);

      // Step 3: Write Firestore profile — non-fatal if rules not configured yet
      try {
        await setDoc(doc(db, "users", cred.user.uid), {
          email: email.trim(),
          name,
          role,
          phone: phone ?? "",
          status: role === "care-receiver" ? "unknown" : null,
          lastCheckIn: null,
          location: null,
          createdAt: serverTimestamp(),
        });
      } catch (fsErr) {
        console.warn("[Terra] Firestore profile write failed — using cache:", fsErr);
      }

      // Step 4: Set user state immediately (avoids onAuthStateChanged race)
      setUser(userData);
    } else {
      const raw = await AsyncStorage.getItem(USERS_KEY);
      const users: StoredUser[] = raw ? JSON.parse(raw) : [];
      if (users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
        throw new Error("Email already registered");
      }
      const newUser: User = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
        email,
        name,
        role,
        phone,
      };
      users.push({ ...newUser, password });
      await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(newUser));
      setUser(newUser);
    }
  }, []);

  const logout = useCallback(async () => {
    if (isFirebaseConfigured && auth) {
      // Clear the session marker but keep the profile cache so
      // the user can sign back in without Firestore being available
      await AsyncStorage.removeItem(SESSION_KEY);
      setUser(null);
      await signOut(auth);
    } else {
      await AsyncStorage.removeItem(SESSION_KEY);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
