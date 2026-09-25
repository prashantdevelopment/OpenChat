# OpenChat

## Overview


OpenChat is a real-time open-world communication platform where registered users can directly communicate with each other without a traditional friend request system.

The goal of OpenChat is to provide a modern communication experience with real-time messaging, media sharing, voice calls, video calls, and secure communication.

## Project Goals

This project is being built to strengthen my fundamentals and gain practical experience in building a production-oriented full-stack application.

The main learning goals are:

- Frontend architecture
- Backend architecture
- REST API design
- Database design
- Real-time communication
- WebRTC
- Authentication and authorization
- Security
- Performance optimization
- Testing
- Scalable system design

## Core Features

- User registration and login
- User discovery
- State-level user presence across India
- Online and offline status
- One-to-one messaging
- Message delivery and read status
- Image sharing
- Video sharing
- File sharing
- Audio recording
- Voice calling
- Video calling
- Secure and encrypted communication

## Planned Technology Stack

### Frontend

- React.js
- Framer Motion
- GSAP

### Backend

- Node.js
- Express.js


### Database

- MongoDB

### Media Storage

- Cloudinary

### Real-time Communication

- WebRTC
- Socket.IO

## Local Setup

Requirements: Node.js 22.22+ and MongoDB running locally (or a MongoDB Atlas URI).

1. Install dependencies from the project root:
   ```bash
   npm install
   ```
2. Create the environment files from the examples and fill in the values:
   - `server/.env.example` → `server/.env` (set `JWT_SECRET` to at least 32 random characters)
   - `client/.env.example` → `client/.env`
3. Start the client and the server together:
   ```bash
   npm run dev
   ```
   The app runs at http://localhost:5173 and the API at http://localhost:5000.

## Testing

```bash
npm test
```

Runs the server test suite (Vitest + supertest + socket.io-client): REST endpoints, validation and error responses, and a two-user real-time Socket.IO flow. MongoDB must be running. Tests use a separate `openchat_test` database (derived from `MONGO_URI`) and drop it after each run, so development data is never touched. Use `npm run test:watch --workspace=server` to re-run tests on every change.

## Project Status

Phase 0 — Engineering Foundation

Status: In Progress
