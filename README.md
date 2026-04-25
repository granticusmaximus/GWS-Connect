# GWS Connect

A full-featured instant messaging application similar to Discord, Slack, and Mattermost. Built with React, Node.js, Socket.io, and MongoDB.

## Features

- 🔐 **Authentication** - Secure JWT-based login and registration
- 💬 **Real-time Chat** - Instant messaging in channels and direct messages
- 🎥 **Audio/Video Calls** - Group calls in channels and 1-on-1 calls in DMs using WebRTC
- 📎 **File Sharing** - Drag-and-drop file uploads for all media types
- 👤 **Rich User Profiles** - Customizable profiles with avatar, banner, bio, interests, and social links
- 🎨 **Theme Support** - Light and dark mode with red/maroon color palette
- ⚡ **Real-time Updates** - Powered by Socket.io for instant communication

## Tech Stack

### Frontend

- React 18 with TypeScript
- Vite for fast builds
- Tailwind CSS for styling
- Zustand for state management
- Socket.io-client for real-time communication
- Simple-peer for WebRTC audio/video
- React Dropzone for file uploads
- React Router for navigation

### Backend

- Node.js with Express
- Socket.io for WebSocket communication
- MongoDB with Mongoose ODM
- JWT for authentication
- Bcrypt for password hashing

## Prerequisites

Before running this application, make sure you have the following installed:

- Node.js (v18 or higher)
- npm or yarn package manager

## Installation

1. **Clone the repository**

   ```bash
   cd /path/to/GWS-Connect
   ```

2. **Install dependencies**

   For the client:

   ```bash
   cd client
   npm install
   ```

   For the server:

   ```bash
   cd server
   npm install
   ```

3. **Configure environment variables**

   Client (.env in client directory):

   ```
   VITE_API_URL=http://localhost:3001/api
   VITE_SOCKET_URL=http://localhost:3001
   ```

   Server (.env in server directory):

   ```
   PORT=3001
   MONGODB_URI=mongodb://localhost:27017/gws-connect
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   CLIENT_URL=http://localhost:5173
   ```

4. **Start MongoDB**

   Make sure MongoDB is running on your system:

   ```bash
   # macOS with Homebrew
   brew services start mongodb-community

   # Linux with systemd
   sudo systemctl start mongod

   # Or run manually
   mongod
   ```

## Running the Application

You'll need to run both the client and server concurrently. The SQLite database will be automatically created on first run.

### Terminal 1 - Start the backend server:

```bash
cd server
npm run dev
```

The server will start on http://localhost:3001

### Terminal 2 - Start the frontend client:

```bash
cd client
npm run dev
```

The client will start on http://localhost:5173

## Usage

1. Open your browser and navigate to http://localhost:5173
2. Create a new account using the registration page
3. Log in with your credentials
4. Start chatting in channels or create direct messages
5. Click the video/audio icons to start calls
6. Drag and drop files to share them in conversations
7. Visit your profile to customize your information
8. Toggle between light and dark themes using the theme switcher

## Project Structure

```
GWS-Connect/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── pages/         # Page components
│   │   ├── store/         # Zustand state management
│   │   ├── App.tsx        # Main app component
│   │   └── main.tsx       # Entry point
│   ├── public/            # Static assets
│   └── package.json
│
├── server/                # Node.js backend
│   ├── src/
│   │   ├── models/       # MongoDB models
│   │   ├── routes/       # Express routes
│   │   ├── middleware/   # Custom middleware
│   │   └── index.js      # Server entry point
│   └── package.json
│
└── README.md
```

## Future Plans

- 📱 React Native mobile apps for iOS and Android
- ☁️ Cloudflare tunnel hosting on custom port
- 🔔 Push notifications
- 🔍 Advanced search functionality
- 📊 Message analytics
- 🎮 Rich media embeds
- 🤖 Bot integration support

## Color Scheme

The application uses a red-based color palette:

- **Light Mode**: Bright reds (#DC2626, #B91C1C, #991B1B)
- **Dark Mode**: Maroon tones (#7F1D1D, #450A0A)

## Development Guidelines

- Use TypeScript for type safety
- Follow React best practices and hooks patterns
- Use functional components throughout
- Implement proper error handling
- Keep components modular and reusable
- Follow RESTful API conventions
- Use Socket.io events for real-time features

## Contributing

This is a personal project, but suggestions and feedback are welcome!

## License

Private project - All rights reserved

## Support

For questions or issues, please contact the development team.

---

Built with ❤️ for seamless communication
