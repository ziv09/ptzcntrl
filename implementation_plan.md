# Secure Remote PTZ Camera Control System - Implementation Plan

## Goal Description
Develop a secure, remote PTZ camera control system using Firebase Realtime Database as a bridge. The system features a Node.js local client (compiled to Windows .exe) that connects Panasonic cameras to the cloud without port forwarding.
**Key Features:**
- **Room-Based Access:** Unique Room ID and Password for authentication (Zero-Knowledge: Password verified locally).
- **Security:** Strict Command Allowlist, Anti-Malware protection, and Watchdog timer (Auto-Stop on connection loss).
- **Ease of Use:** Local GUI for initial setup and Single Executable packaging.

## User Review Required
> [!IMPORTANT]
> **Password Handling:** Passwords are **never** stored in the cloud. The Client verifies passwords locally for every command.
>
> **Firebase Credentials:** You will need to provide:
> 1. **Database URL:** (e.g., `https://your-project.firebaseio.com`)
> 2. **Service Account JSON:** The private key file from Firebase Console -> Project Settings -> Service Accounts.
> *The app will ask you to select this file or paste its content during the first run.*

## Proposed Changes

### Directory Structure
```
/
├── server/                 # Node.js Local Client
│   ├── index.js            # Main Logic (Auto-Discovery, Firebase Listener)
│   ├── gui.js              # Local Configuration Interface (Express)
│   ├── ptz.js              # Panasonic Camera Control Logic
│   ├── security.js         # Password Verification & Command Allowlist
│   ├── config.json         # Configuration Template
│   ├── package.json        # Dependencies & pkg Config
│   └── public/             # HTML/CSS for Local GUI
└── firebase/               # Firebase Configuration
    ├── database.rules.json # Security Rules
    └── schema_example.json # Data Structure Example
```

### [server] Node.js Client
### [server] Desktop Client (Electron)
#### [NEW] [main.js](file:///server/main.js)
- **App Lifecycle:** Create Tray icon, handle window visibility (show/hide).
- **Background Services:**
    - Run Express Server for Local Web GUI (kept separate for cleanliness).
    - Manage Firebase Connection & Watchdog.
    - Perform Camera Auto-Discovery.
- **IPC Communication:** Bridge status updates (IP, Device Count, Online Users) to the Dashboard Window.

#### [NEW] [dashboard.html](file:///server/dashboard.html)
- **Design:** Compact "Bitfocus Companion" style window.
- **Metrics:** Display Local IP, PTZ Count, Connection Status (Green/Red), Online Users.
- **Controls:**
    - [Open GUI]: Launches system default browser to `http://localhost:{port}`.
    - [Hide]: Minimizes window to System Tray.

#### [NEW] [gui.js](file:///server/gui.js)
- Express server logic remains largely the same.
- Serves the configuration page (`index.html`) to the external browser.
- **In-Memory Config:** Variables stored in `main.js` Global State, accessible via IPC.

#### [NEW] [security.js](file:///server/security.js)
- Logic unchanged: `verifyCommand`, `sanitizeCommand`, `watchdog`.
- Integrated into `main.js` flow.

### [firebase] Configuration
#### [NEW] [database.rules.json](file:///firebase/database.rules.json)
- Rules to allow any authenticated user (or public, if relying entirely on Room ID knowledge + Local Pass) to write to `commands` but strictly validate structure.
- **Decision:** Use Firebase Anonymous Auth for basic rate limiting, but rely on Local Client for "Access Control" via Password.

### [UI] Interface Refinements
#### [MODIFY] [server/public/index.html](file:///server/public/index.html)
- **Grid Layout:** 2-column dashboard design for better large-screen usability.
- **Debug Console:** Collapsible bottom panel for real-time logs.

#### [MODIFY] [hosting/public/index.html](file:///hosting/public/index.html)
- **Mobile Opt-in:**
    - **Layout:** Responsive Joystick (`50vmin`) to prevent overflow on small screens.
    - **Scroll Lock:** Global `touchmove` prevention (Always On) to ensure "App-like" feel.
    - **Logout:** Added to Drawer menu.
    - **Logout:** Added to Drawer menu.

## Verification Plan

### Automated Tests
- **Unit Tests (`server/test/security.test.js`):**
    - Test `verifyCommand` with correct/incorrect passwords.
    - Test `sanitizeCommand` with valid/malicious payloads.
- **Integration Test (`server/test/mock_firebase.js`):**
    - Simulate Firebase messages and verify Client triggers Camera HTTP requests (mocked).

### Manual Verification
1.  **Setup:**
    - Run `npm start` (Electron).
    - Verify Dashboard Window appears with status indicators.
    - Click [Open GUI], verify Browser opens to config page.
2.  **Configuration:**
    - Enter Room `TEST01`, Pass `1234` in Browser.
    - Verify Dashboard updates status to "Connected".
3.  **System Tray:**
    - Click [Hide]. Verify window disappears and Tray Icon appears.
    - Double-click Tray Icon. Verify Dashboard reappears.
4.  **Control & Security:**
    - Same steps as before (Command execution, Watchdog, Invalid Password).

