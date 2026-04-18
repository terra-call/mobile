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
- `artifacts/api-server` — Express API server (port 8080, all routes mounted under `/api`)
- `artifacts/mockup-sandbox` — Vite component preview server

### Caregiver Linking (Invite Code System)
Caregivers generate a 6-digit invite code in their Settings screen. The code is stored in Firestore as `invites/{code}` with `caregiverId`, `caregiverName`, `caregiverEmail`, `expiresAt` (24h TTL), and `redeemedBy` (null until used). Caregivers can optionally text the code to a phone number via Twilio (POST `/api/invites/sms`, rate-limited to 10/IP/hour). Care receivers enter the code in their Settings → Caregivers section; redemption uses a Firestore transaction (`runTransaction`) to atomically link the caregiver to `permittedCaregivers` and mark the invite as redeemed (single-use). Service: `artifacts/mobile/services/invites.ts`.

#### Required Firestore Security Rules
The `invites` collection is new and needs explicit rules. Add this block alongside the existing `users` rules in the Firebase Console (Firestore → Rules):

```
match /invites/{code} {
  // Anyone signed in can look up an invite by its code (needed for redeem)
  allow read: if request.auth != null;

  // Only the caregiver themselves can create their invite
  allow create: if request.auth != null
    && request.resource.data.caregiverId == request.auth.uid
    && request.resource.data.redeemedBy == null;

  // Updates allowed only to mark redeemed (by the redeemer themselves)
  allow update: if request.auth != null
    && resource.data.redeemedBy == null
    && request.resource.data.redeemedBy == request.auth.uid
    && request.resource.data.caregiverId == resource.data.caregiverId;
}
```

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
- Status windows are now **configurable per care receiver** (stored in Firestore as `missedWindowMin` / `escalationWindowMin`)
- Defaults: `< 30 min` → `checked-in`, `30–120 min` → `missed`, `> 120 min` → `emergency`, no check-in → `unknown`
- Caregiver dashboard uses each receiver's personal window settings

### Firestore fields added to `users/{uid}` for care receivers
```
notificationsEnabled: boolean
checkInScheduleType: "4h" | "8h" | "12h" | "24h" | "custom"
checkInCustomHour: number
checkInCustomMinute: number
missedWindowMin: number
escalationWindowMin: number
expoPushToken: string (Expo push token, set on login)
```

### Push Notifications Architecture
- **`expo-notifications` v0.32.16** installed — handles local reminders + push token registration
- **Local reminders**: Scheduled on care receiver's device at configured interval (works in Expo Go on real device; requires native build for reliable background delivery)
- **Caregiver alerts**: Care receiver's app monitors status every 60s; if missed/emergency window exceeded, sends push notification to caregivers' Expo push tokens via `https://exp.host/--/api/v2/push/send`
- **API server scheduler**: Runs every 60s; receives schedules via `POST /api/notify/schedule`, check-ins via `POST /api/notify/checkin`, sends direct pushes via `POST /api/notify/send`
- **Token registration**: Occurs at login for care receivers; token saved to `users/{uid}.expoPushToken`
- **Native build required** for: reliable background delivery, Expo push token issuance from EAS

### API Server Notification Endpoints
- `POST /api/notify/send` — Send push to arbitrary token list
- `POST /api/notify/schedule` — Register care receiver's check-in schedule
- `POST /api/notify/checkin` — Record check-in (resets notification state)
- `GET /api/notify/schedule/:userId` — Debug: view schedule state

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
