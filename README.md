# GWS Connect

A privacy-first instant messaging application similar to Discord and Slack. Built with React, Node.js, Socket.io, and SQLite.

## Features

- 🔐 **Authentication** - JWT-based login/registration with account lockout after repeated failed attempts
- 💬 **Real-time Chat** - Channels, direct messages, threaded replies, reactions, mentions, polls
- 🎥 **Audio/Video Calls** - Mesh WebRTC voice/video calls and screen sharing in channels and DMs
- 📌 **Pinned Messages & Search** - Pin important messages per conversation; search message history
- 🟢 **Presence** - Online/idle status indicators
- 📎 **File Sharing** - Drag-and-drop file uploads for all media types
- 👤 **Rich User Profiles** - Customizable profiles with avatar, banner, bio, interests, and social links
- 🎨 **Theme Support** - Light and dark mode
- ⚡ **Real-time Updates** - Powered by Socket.io

## Tech Stack

### Frontend

- React 19 with TypeScript
- Vite for builds
- Tailwind CSS for styling
- Zustand for state management
- Socket.io-client for real-time communication
- Native WebRTC (`RTCPeerConnection`) for audio/video calls
- React Dropzone for file uploads
- React Router for navigation

### Backend

- Node.js with Express
- Socket.io for WebSocket communication and call signaling
- better-sqlite3 (SQLite) for storage
- JWT for authentication
- Bcrypt for password hashing
- Helmet + express-rate-limit for hardening

## Prerequisites

- Node.js (`20.19+` or `22.12+` recommended)
- npm

Note: the server uses `better-sqlite3` (native module). If your Node version changes, reinstall server dependencies so the native binding matches the active Node runtime.

## Installation

1. **Install dependencies**

   ```bash
   cd client && npm install
   cd ../server && npm install
   ```

2. **Configure environment variables**

   Client (`client/.env`, copy from `client/.env.example`):

   ```
   VITE_API_URL=/api
   VITE_SOCKET_URL=
   VITE_WEBRTC_STUN_URLS=stun:stun.l.google.com:19302
   VITE_WEBRTC_TURN_URLS=
   VITE_WEBRTC_TURN_USERNAME=
   VITE_WEBRTC_TURN_CREDENTIAL=
   ```

   Server (`server/.env`, copy from `server/.env.example`):

   ```
   PORT=3001
   DB_PATH=./data/gws-connect.db
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   CLIENT_URL=http://localhost:5173
   VAPID_PUBLIC_KEY=
   VAPID_PRIVATE_KEY=
   ```

   A TURN server (`VITE_WEBRTC_TURN_URLS`) is required for calls to work reliably across NATs/firewalls in production; STUN alone is enough for local development.

## Running the Application

The SQLite database is created automatically on first run.

```bash
npm run dev   # runs client + server together (from repo root)
```

Or separately:

```bash
cd server && npm run dev   # http://localhost:3001
cd client && npm run dev   # http://localhost:5173
```

If server startup fails with a `better-sqlite3` ABI/binding error, reinstall under the same Node runtime used to run the server:

```bash
cd server
rm -rf node_modules/better-sqlite3
npm install better-sqlite3@9.6.0
```

## Usage

1. Open http://localhost:5173 and register an account
2. Create or join channels, or start a direct message
3. Click the Voice/Video buttons in a conversation header to start a call
4. Use the Pinned tab and the search icon in the header to find messages
5. Drag and drop files to share them in conversations
6. Visit your profile to customize your information

## Encryption Session Notes

- End-to-end encryption private keys are kept in `sessionStorage` after login for security.
- If the browser session is reset (new browser process, tab restore behavior, some PWA launches), encrypted messaging is locked until you unlock it with your account password.
- If an admin reset your password, old encrypted history may be unrecoverable and the app will guide you through key recovery/rotation.

## Project Structure

```
GWS-Connect/
├── client/                 # React frontend
│   └── src/
│       ├── components/    # Reusable UI components
│       ├── pages/         # Page components
│       ├── store/         # Zustand state management (chat, call, auth, ...)
│       └── utils/         # E2EE, mentions, formatting helpers
│
├── server/                # Node.js backend
│   └── src/
│       ├── models/        # SQLite data access
│       ├── routes/        # Express routes
│       ├── middleware/    # Auth/role middleware
│       └── index.js       # Server entry point + Socket.io handlers
│
└── electron/               # Desktop app shell
```

## Known Gaps

- Calls use a peer-to-peer mesh topology (no SFU), so large group calls won't scale well past a handful of participants
- End-to-end encryption is implemented for DMs (ECDH + AES-GCM) but not yet enforced for channels
- No automated test suite yet

## License

Private project - All rights reserved
