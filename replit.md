# Terra Call — Emergency Caregiver Monitoring

## Overview
Terra Call is a React Native mobile application built with Expo designed to facilitate emergency care monitoring. It allows care recipients to easily check in with a prominent "I'M OK" button, while providing caregivers with a real-time dashboard displaying statuses, location tracking, and an emergency call interface. The project aims to enhance safety and provide peace of mind for both care recipients and their caregivers, with future expansion into B2B solutions for organizations like home health agencies and Medicaid providers.

## User Preferences
- I want iterative development.
- I want detailed explanations.
- Ask before making major changes.
- Do not make changes to folder `Z`.
- Do not make changes to file `Y`.

## System Architecture

### Design System
The application uses a dark theme with a `deep space` background and `card` elements. Key interactive elements are highlighted with `neon green` (primary) and `electric blue` (accent). Emergency indicators are `red`, and muted text uses a `grayish blue`.

### Project Structure
The project is organized into three main artifacts:
- **`artifacts/mobile`**: The Expo React Native mobile application.
- **`artifacts/api-server`**: An Express.js API server running on port 8080, with all routes under `/api`.
- **`artifacts/mockup-sandbox`**: A Vite component preview server for UI development.

### Core Features and Technologies
- **Authentication**: Firebase Authentication (email/password).
- **Database**: Firestore for real-time data storage, managing user profiles, statuses, and configurations.
  - `users` collection stores user details, roles (`care-recipient`, `caregiver`, `admin`), check-in status, location, notification settings, and `smsConsent` (HIPAA — gates whether caregiver SMS alerts are sent).
  - `invites` collection handles caregiver-care recipient linking via invite codes.
  - `events` collection logs user actions like check-ins, missed alerts, and emergencies.
  - `organizations` collection supports B2B accounts with fields for Medicaid contracts.
  - `auditLogs` collection provides an append-only audit trail for HIPAA compliance.
  - `careReports` collection stores periodic care activity rollups.
- **User Roles**: Supports "care-receiver", "caregiver", and "admin" roles.
- **Status Monitoring**: Care recipients' check-in status (`checked-in`, `missed`, `emergency`, `unknown`) is dynamically calculated based on configurable time windows (`missedWindowMin`, `escalationWindowMin`) stored in Firestore.
- **Push Notifications**: Utilizes `expo-notifications` for both local reminders on the care recipient's device and push notifications to caregivers when status windows are exceeded. The API server includes endpoints for scheduling, check-in recording, and direct push sending.
- **Video Conferencing (Scaffolding)**: Integration with Twilio Video for camera activation (Phase A complete, Phase B pending Twilio API keys and native build). This includes server-side routes for initiating camera activation and generating access tokens, and client-side components for consent and stream display.
- **Admin Dashboard**: Provides an administrative interface for managing users, organizations, care reports, and audit logs. It includes features like user metrics, activity metrics, system health, and recent activity, with extensive B2B functionalities.

### Key Architectural Decisions
- **Real-time Data**: Extensive use of Firestore for real-time updates across the application, especially for caregiver dashboards and status monitoring.
- **Offline Fallback**: Contexts like `AuthContext` and `CareDataContext` incorporate `AsyncStorage` for potential offline data access or demo data.
- **Modular Design**: Services (`firebase.ts`, `invites.ts`, `notifications.ts`, `video.ts`, `organizations.ts`, `audit.ts`, `careReports.ts`, `reportExport.ts`, `users.ts`) encapsulate specific functionalities.
- **UI/UX**: Consistent design system using color tokens and reusable components. Responsive mapping with `react-native-maps` for mobile and a coordinate list fallback for web.
- **Security**: Firestore security rules are crucial for managing data access based on user roles and relationships. Rules are defined for `users`, `invites`, `events`, `organizations`, `auditLogs`, and `careReports` collections.
- **Firestore Indexes**: Composite indexes required by code are tracked in `firestore.indexes.json` (repo root). Care report generation needs the `events` index on (`userId` ASC, `createdAt` ASC) — must be deployed via Firebase Console or `firebase deploy --only firestore:indexes` before that flow works.
- **Auditability**: Implementation of an append-only audit log for HIPAA compliance, tracking user actions and data access.
- **PHI hygiene**: The care recipient's OWN name is never placed in push notification titles/bodies — it is sent in the `data` payload only, visible to the app once unlocked. Exception (intentional, not PHI): the caregiver-initiated incoming-call push (`/api/video/initiate`) shows the CAREGIVER's name in the title/body (e.g. "Pat is calling") so the recipient can recognize/answer the call from a locked screen — this is the caregiver's identity, not the recipient's health info. SMS bodies still contain names but are gated by `smsConsent` per care recipient. Server logs no longer include receiver names or full phone numbers (last-4 digits only).
- **Report Generation**: Care report generation includes client-side aggregation of events, secure export options (CSV/PDF), and PHI hygiene for temporary files.
- **Mobile Runtime Versioning (manual bump)**: `artifacts/mobile/app.json` uses `runtimeVersion.policy = "appVersion"`, so the OTA runtime version equals `expo.version` (currently `1.1.0`). This prevents JS-only OTA updates from being served onto a native build they don't match (the drift that caused the camera placeholder/flicker bug). The `fingerprint` policy was tried but cannot produce matching fingerprints in this pnpm monorepo with CNG (EAS's `expo prebuild` adds a generated `android/` dir + pnpm autolinking paths the local fingerprint never sees), so EAS aborts every build. **Manual bump rule: whenever the native layer changes (add/remove/upgrade a native module or config plugin, change `app.json` native config, or bump SDK), bump `expo.version` (e.g. `1.1.0` → `1.2.0`) before building.** That single field is the runtime-partitioning control — it guarantees a stale OTA built for the old runtime can't load on the new binary. (Note: `eas.json` sets `appVersionSource: "remote"`, so EAS manages `android.versionCode`/`ios.buildNumber` itself; the values in `app.json` are ignored — no need to bump them by hand.) JS-only changes shipped via `eas update` do NOT need a version bump. After bumping, run a fresh `eas build`; only publish `eas update` for JS-only changes that target the matching runtime.

## External Dependencies

- **Firebase**:
  - **Firebase Authentication**: User authentication.
  - **Firestore**: Primary NoSQL database for real-time data.
- **Expo**:
  - **`expo-notifications`**: For managing push notifications and local reminders.
  - **`expo-print`**, **`expo-sharing`**, **`expo-file-system/legacy`**: Used for generating and exporting care reports (CSV/PDF).
- **Twilio**:
  - **Twilio Video**: For real-time video streaming (scaffolding in place, full integration pending).
  - **Twilio SMS**: Potentially used for sending invite codes (rate-limited).
- **Express.js**: For the API server backend.
- **React Native Maps**: For map display functionality on mobile devices.