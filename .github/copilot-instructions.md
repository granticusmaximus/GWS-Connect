# GWS Connect - Project Instructions

## Project Overview
GWS Connect is a full-featured instant messaging application similar to Discord, Slack, and Mattermost. It includes real-time chat, audio/video calling, file sharing, and rich user profiles.

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Node.js + Express + Socket.io
- **Database**: MongoDB
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Real-time**: Socket.io
- **WebRTC**: Simple-peer for audio/video
- **File Upload**: React Dropzone

## Color Scheme
- Primary colors: Red-based (#DC2626, #B91C1C, #991B1B)
- Dark mode: Maroon tones (#7F1D1D, #450A0A)
- Support both light and dark themes

## Key Features
1. **Authentication**: JWT-based login and registration
2. **Channels**: Public channels for group discussions
3. **Direct Messages**: One-on-one private chats
4. **Audio/Video Calls**: Group calls in channels, 1-on-1 calls in DMs
5. **File Sharing**: Drag-and-drop file uploads (all media types)
6. **User Profiles**: Avatar, banner, bio, interests, social links, contact info
7. **Themes**: Light and dark mode with red/maroon color palette

## Development Guidelines
- Use TypeScript for type safety
- Follow React best practices and hooks patterns
- Use functional components throughout
- Implement proper error handling
- Use environment variables for configuration
- Keep components modular and reusable
- Follow RESTful API conventions for HTTP endpoints
- Use Socket.io events for real-time features

## Future Plans
- React Native mobile apps for iOS and Android
- Cloudflare tunnel hosting on custom port
