# Secure Remote PTZ Camera Control System

## Project Initialization
- [x] Create project directory structure <!-- id: 0 -->
- [x] Create `package.json` for Electron app <!-- id: 1 -->

## Firebase Setup
- [x] Define Firebase Data Structure (JSON Schema) <!-- id: 3 -->
- [x] Create Firebase Security Rules (`database.rules.json`) <!-- id: 4 -->

## Electron App Development
- [x] **Main Process:** Setup Electron, Tray, and IPC <!-- id: 5 -->
- [x] **Renderer Process:** Create Dashboard UI (HTML/CSS) <!-- id: 6 -->
- [x] **Integration:** PTZ Logic & Auto-Discovery in Main Process <!-- id: 7 -->
- [x] **Web GUI:** Express Server integration in Main Process <!-- id: 8 -->
- [x] **Security:** Watchdog, Allowlist & Password Logic <!-- id: 9 -->

## Remote Web App (Firebase Hosting)
- [x] Create `hosting/public` directory <!-- id: 12 -->
- [x] Implement Mobile-Friendly Control Interface (`index.html`) <!-- id: 13 -->
- [x] Implement Firebase Client SDK Logic (`app.js`) <!-- id: 14 -->
- [x] Configure `firebase.json` for Hosting <!-- id: 15 -->

## Packaging & Deployment
- [x] Configure `electron-builder` for Windows .exe (Client) <!-- id: 10 -->
- [x] Create usage documentation <!-- id: 11 -->
- [x] Deploy Web App to Firebase Hosting <!-- id: 16 -->

## Recent Updates
- [x] Implement Server Logic for Stop/Quit
- [x] Add Start/Stop Toggle to Local GUI
- [x] Local Web Debug Console
- [x] Add Speed Slider to Mobile Remote (Horizontal Zoom Buttons)
- [x] Refine Local Web UI Layout (Grid System)
- [x] Mobile UI Refinement (Responsive Joystick, Layout Overflow Fix, Global Scroll Lock, Logout)
