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

const USER_KEY = "@terra:user";
const USERS_KEY = "@terra:users";
type StoredUser = User & { password: string };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isFirebaseConfigured && auth) {
      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
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
                // Keep cache fresh for fallback
                await AsyncStorage.setItem(USER_KEY, JSON.stringify(userData));
                setUser(userData);
              } else {
                // Firestore doc missing (rules not configured, or race condition).
                // Fall back to AsyncStorage cache if the UID matches.
                const cached = await AsyncStorage.getItem(USER_KEY);
                if (cached) {
                  const cachedUser: User = JSON.parse(cached);
                  if (cachedUser.id === firebaseUser.uid) {
                    setUser(cachedUser);
                  } else {
                    setUser(null);
                  }
                } else {
                  setUser(null);
                }
              }
            } catch {
              // Firestore read failed (permission denied etc) — try cache fallback
              const cached = await AsyncStorage.getItem(USER_KEY);
              if (cached) {
                const cachedUser: User = JSON.parse(cached);
                if (cachedUser.id === firebaseUser.uid) {
                  setUser(cachedUser);
                } else {
                  setUser(null);
                }
              } else {
                setUser(null);
              }
            }
          } else {
            // Firestore not available — try cache
            const cached = await AsyncStorage.getItem(USER_KEY);
            if (cached) {
              const cachedUser: User = JSON.parse(cached);
              if (cachedUser.id === firebaseUser.uid) {
                setUser(cachedUser);
              } else {
                setUser(null);
              }
            } else {
              setUser(null);
            }
          }
        } else {
          setUser(null);
        }
        setLoading(false);
      });
      return unsubscribe;
    } else {
      AsyncStorage.getItem(USER_KEY)
        .then((val) => { if (val) setUser(JSON.parse(val)); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    if (isFirebaseConfigured && auth) {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // onAuthStateChanged handles setting user state after sign-in
    } else {
      const raw = await AsyncStorage.getItem(USERS_KEY);
      const users: StoredUser[] = raw ? JSON.parse(raw) : [];
      const found = users.find(
        (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
      );
      if (!found) throw new Error("Invalid email or password");
      const { password: _p, ...userData } = found;
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(userData));
      setUser(userData);
    }
  }, []);

  const register = useCallback(async ({ email, password, name, role, phone }: RegisterData) => {
    if (isFirebaseConfigured && auth && db) {
      // Step 1: Create Firebase Auth account — if this throws, registration fails.
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);

      const userData: User = {
        id: cred.user.uid,
        email: email.trim(),
        name,
        role,
        phone: phone || undefined,
      };

      // Step 2: Cache to AsyncStorage immediately so login always works
      // even if the Firestore write fails (rules not yet configured).
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(userData));

      // Step 3: Write Firestore profile — non-fatal.
      if (db) {
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
      }

      // Step 4: Set user state (bypasses onAuthStateChanged race condition).
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
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(newUser));
      setUser(newUser);
    }
  }, []);

  const logout = useCallback(async () => {
    if (isFirebaseConfigured && auth) {
      await AsyncStorage.removeItem(USER_KEY);
      await signOut(auth);
    } else {
      await AsyncStorage.removeItem(USER_KEY);
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
