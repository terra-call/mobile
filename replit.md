# Terra Call — Emergency Caregiver Monitoring

## Project Overview
React Native mobile app (Expo) that lets care receivers tap a big "I'M OK" button to check in, while caregivers get a real-time dashboard with statuses, a location map, and an emergency call screen.

## Design System
- Background: `#060a18` (deep space)
- Card: `#0c1628`
- Primary: `#22FF6E` (neon green)
- Accent: `#00C8FF` (electric blue)
- Emergency: `#FF3B30`
- Muted: `#8892B0`
- Logo: `artifacts/mobile/assets/images/terra_logo.jpg`

## Architecture

### Artifacts
- `artifacts/mobile` — Expo React Native app (slug: `mobile`, previewPath: `/`)
- `artifacts/api-server` — Express API server (port 8080)
- `artifacts/mockup-sandbox` — Vite component preview server

### Key Files
```
artifacts/mobile/
  app/
    _layout.tsx              # Root layout (AuthProvider + CareDataProvider)
    index.tsx                # Auth gate / redirect
    (auth)/
      login.tsx              # Sign in screen
      register.tsx           # Role-select registration
    (care-receiver)/
      index.tsx              # Animated "I'M OK" button
    (caregiver)/
      index.tsx              # Dashboard: status cards + stats
      map.tsx                # Location map screen
    emergency-call.tsx       # Fullscreen emergency modal
  contexts/
    AuthContext.tsx           # Firebase Auth + AsyncStorage fallback
    CareDataContext.tsx       # Firestore real-time + AsyncStorage fallback
  services/
    firebase.ts              # Firebase app / auth / db initialization
  components/
    MapDisplay.native.tsx    # react-native-maps (iOS/Android only)
    MapDisplay.tsx           # Coordinates list (web fallback)
  constants/
    colors.ts                # Design tokens
  hooks/
    useColors.ts             # Theme color hook
```

### Firebase (terra-call-9335b)
- **Auth**: Email/password via Firebase Auth
- **Firestore collection `users/{uid}`**:
  ```
  {
    name: string
    email: string
    role: "care-receiver" | "caregiver" | "family"
    phone?: string
    lastCheckIn?: Timestamp | null
    status?: string
    location?: { lat, lng } | null
    createdAt: Timestamp
  }
  ```
- Caregivers see all users where `role == "care-receiver"` in real time
- Care receivers update `lastCheckIn` + `status` on check-in
- Falls back to demo data if Firestore has no real care receivers

### Status Computation
- `< 30 min` since last check-in → `checked-in` (green)
- `30–120 min` → `missed` (orange)
- `> 120 min` → `emergency` (red)
- No check-in ever → `unknown` (muted)

## Environment Variables
| Key | Purpose |
|-----|---------|
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase Web API key |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Firestore project |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Storage |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | FCM sender |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | Firebase app ID |
| `SESSION_SECRET` | API server session secret |

## Known Limitations / Next Steps
- Push notifications (Firebase Messaging) require an EAS native build — not available in Expo Go
- `react-native-maps` pinned to 1.18.0 for Expo Go compatibility (map only works on iOS/Android, not web)
- No caregiver ↔ receiver invitation/linking flow yet — caregivers see all care-receivers in Firestore
- Firestore security rules must be configured in Firebase Console (currently open read/write for auth'd users assumed)

## Firestore Security Rules (recommended)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
