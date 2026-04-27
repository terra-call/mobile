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
import { logAudit } from "@/services/audit";

export type UserRole = "care-receiver" | "caregiver" | "family" | "admin";

// Founder/admin email — automatically promoted to "admin" role on login.
const ADMIN_EMAILS = new Set(["mike@terra-call.com"]);

function resolveRole(email: string, currentRole: UserRole | undefined): UserRole {
  if (ADMIN_EMAILS.has(email.toLowerCase())) return "admin";
  return currentRole ?? "caregiver";
}

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

export interface PendingRecovery {
  uid: string;
  email: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  pendingRecovery: PendingRecovery | null;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  recoverProfile: (data: { name: string; role: UserRole; phone?: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_KEY = "@terra:session";
const PROFILE_CACHE_KEY = "@terra:profiles";
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
  const [pendingRecovery, setPendingRecovery] = useState<PendingRecovery | null>(null);

  // Restore session on app launch via onAuthStateChanged
  useEffect(() => {
    if (isFirebaseConfigured && auth) {
      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          // Try Firestore first
          if (db) {
            try {
              const snap = await getDoc(doc(db, "users", firebaseUser.uid));
              if (snap.exists()) {
                const data = snap.data();
                const email = firebaseUser.email ?? "";
                const role = resolveRole(email, data.role as UserRole);
                // Persist role upgrade for admin emails so it's stable across sessions
                if (role === "admin" && data.role !== "admin") {
                  try { await setDoc(doc(db, "users", firebaseUser.uid), { role: "admin" }, { merge: true }); } catch { /* ignore */ }
                }
                const userData: User = {
                  id: firebaseUser.uid,
                  email,
                  name: data.name ?? "",
                  role,
                  phone: data.phone ?? undefined,
                };
                await writeProfileCache(firebaseUser.uid, userData);
                setUser(userData);
                setLoading(false);
                return;
              }
            } catch {
              // permission-denied or network — fall through
            }
          }

          // Try the persistent profile cache
          const cache = await readProfileCache();
          const cachedUser = cache[firebaseUser.uid];
          if (cachedUser) {
            setUser(cachedUser);
          } else {
            // Firebase Auth session exists but no profile anywhere.
            // Set pendingRecovery so the app can prompt the user to complete setup.
            setPendingRecovery({ uid: firebaseUser.uid, email: firebaseUser.email ?? "" });
            setUser(null);
          }
        } else {
          setUser(null);
        }
        setLoading(false);
      });
      return unsubscribe;
    } else {
      AsyncStorage.getItem(SESSION_KEY)
        .then((val) => { if (val) setUser(JSON.parse(val)); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    if (isFirebaseConfigured && auth) {
      // Step 1: Authenticate — throws on wrong credentials
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const firebaseUser = cred.user;

      // Step 2: Load profile immediately (don't rely on onAuthStateChanged callback)
      let userData: User | null = null;

      if (db) {
        try {
          const snap = await getDoc(doc(db, "users", firebaseUser.uid));
          if (snap.exists()) {
            const data = snap.data();
            const userEmail = firebaseUser.email ?? "";
            const role = resolveRole(userEmail, data.role as UserRole);
            if (role === "admin" && data.role !== "admin") {
              try { await setDoc(doc(db, "users", firebaseUser.uid), { role: "admin" }, { merge: true }); } catch { /* ignore */ }
            }
            userData = {
              id: firebaseUser.uid,
              email: userEmail,
              name: data.name ?? "",
              role,
              phone: data.phone ?? undefined,
            };
            await writeProfileCache(firebaseUser.uid, userData);
          }
        } catch (fsErr) {
          console.warn("[Terra] Firestore fetch during login failed:", fsErr);
        }
      }

      // Step 3: Fall back to persistent cache
      if (!userData) {
        const cache = await readProfileCache();
        userData = cache[firebaseUser.uid] ?? null;
      }

      // Step 4: Profile missing — keep Firebase Auth session alive so recovery
      // can write the Firestore document without re-authenticating.
      if (!userData) {
        setPendingRecovery({ uid: firebaseUser.uid, email: firebaseUser.email ?? email.trim() });
        throw Object.assign(new Error("profile-missing"), { code: "terra/profile-missing" });
      }

      setPendingRecovery(null);
      setUser(userData);

      // HIPAA audit — successful login
      logAudit({
        userId: userData.id,
        action: "login",
        details: `User signed in (${userData.email})`,
      }).catch(() => {});
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

  const recoverProfile = useCallback(async ({
    name,
    role,
    phone,
  }: {
    name: string;
    role: UserRole;
    phone?: string;
  }) => {
    if (!pendingRecovery) throw new Error("No pending recovery session");
    const { uid, email } = pendingRecovery;

    const userData: User = { id: uid, email, name, role, phone: phone || undefined };

    // Write to Firestore (rules are now fixed)
    if (db) {
      await setDoc(doc(db, "users", uid), {
        email,
        name,
        role,
        phone: phone ?? "",
        status: role === "care-receiver" ? "unknown" : null,
        lastCheckIn: null,
        location: null,
        createdAt: serverTimestamp(),
        // FUTURE — Organization/Medicaid support (v1.1)
        // Optional fields for new user documents going forward.
        // Existing user documents are not touched.
        organizationId: null,
        organizationRole: null,
        hipaaConsentSigned: false,
        hipaaConsentDate: null,
        npiNumber: null,
      });
    }

    await writeProfileCache(uid, userData);
    setPendingRecovery(null);
    setUser(userData);

    // HIPAA audit — profile recovered (counts as account_created for the doc)
    logAudit({
      userId: uid,
      action: "account_created",
      details: `Profile recovered for ${email} (role=${role})`,
    }).catch(() => {});
  }, [pendingRecovery]);

  const register = useCallback(async ({ email, password, name, role, phone }: RegisterData) => {
    if (isFirebaseConfigured && auth && db) {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);

      const userData: User = {
        id: cred.user.uid,
        email: email.trim(),
        name,
        role,
        phone: phone || undefined,
      };

      await writeProfileCache(cred.user.uid, userData);

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
          // FUTURE — Organization/Medicaid support (v1.1)
          // Optional fields for new user documents going forward.
          // Existing user documents are not touched.
          organizationId: null,
          organizationRole: null,
          hipaaConsentSigned: false,
          hipaaConsentDate: null,
          npiNumber: null,
        });
      } catch (fsErr) {
        console.warn("[Terra] Firestore profile write failed — using cache:", fsErr);
      }

      setPendingRecovery(null);
      setUser(userData);

      // HIPAA audit — new account created
      logAudit({
        userId: cred.user.uid,
        action: "account_created",
        details: `New ${role} account registered (${email.trim()})`,
      }).catch(() => {});
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
    // HIPAA audit — fire BEFORE signOut so request.auth.uid is still valid,
    // but DO NOT await: logout must remain instantaneous from the user's
    // perspective even if the audit write is slow.
    if (user) {
      logAudit({
        userId: user.id,
        action: "logout",
        details: `User signed out (${user.email})`,
      }).catch(() => {});
    }

    setPendingRecovery(null);
    if (isFirebaseConfigured && auth) {
      await AsyncStorage.removeItem(SESSION_KEY);
      setUser(null);
      await signOut(auth);
    } else {
      await AsyncStorage.removeItem(SESSION_KEY);
      setUser(null);
    }
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, pendingRecovery, login, register, recoverProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
