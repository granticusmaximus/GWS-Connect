# Error Logging Implementation Examples

This document shows all the places where error logging has been implemented in GWS Connect.

## Files Modified

### 1. `server/src/utils/logger.js` (NEW)

**Location**: Enhanced logging utility module

**Key Functions**:

- `logError()` - Main error logging function with email notification
- `withErrorLogging()` - Wrap functions for automatic error handling
- `errorLoggingMiddleware` - Express middleware for catching all route errors
- `logSocketError()` - Specialized socket.io error logging
- `sanitizeData()` - Automatically redacts sensitive fields

**Usage**: Import and use in any server file

```javascript
import {
	logError,
	logSocketError,
	errorLoggingMiddleware,
} from '../utils/logger.js';
```

---

### 2. `server/src/services/errorReporter.js` (MODIFIED)

**Changes**: Enhanced email template with location information

**Improvements**:

- Added file location, line number, column number to email header
- Added operation description to email
- More detailed visual formatting
- Better readability with horizontal separators

**Email shows**:

```
❌ GWS Connect Error: TypeError
📍 Location: server/src/index.js:252:10
📍 Operation: Processing and saving message
```

---

### 3. `server/src/index.js` (MODIFIED)

**Changes**: Updated all error handlers to use new logging system

**Updated Handlers**:

1. **Initial Connection Error** (line ~109)
   - Event: `io.on('connection')`
   - Function: Loading channels on socket connect
   - Logs: socketId, userId, username, loading action

2. **Message Error** (line ~252)
   - Event: `socket.on('message')`
   - Function: Processing and saving messages
   - Logs: userId, socketId, channelId, message content details, encryption info

3. **GIF Message Error** (line ~332)
   - Event: `socket.on('gif-message')`
   - Function: Processing and sending GIF
   - Logs: userId, socketId, GIF URL, file type

4. **Poll Creation Error** (line ~434)
   - Event: `socket.on('poll-create')`
   - Function: Creating poll and options
   - Logs: userId, question preview, option count, duration

5. **Poll Vote Error** (line ~530)
   - Event: `socket.on('poll-vote')`
   - Function: Recording poll vote
   - Logs: userId, pollId, optionId

6. **Message Edit Error** (line ~591)
   - Event: `socket.on('message-edit')`
   - Function: Updating message content
   - Logs: userId, messageId

7. **Message Delete Error** (line ~649)
   - Event: `socket.on('message-delete')`
   - Function: Marking message deleted
   - Logs: userId, messageId

8. **Message Archive Error** (line ~704)
   - Event: `socket.on('message-archive')`
   - Function: Archiving message
   - Logs: userId, messageId

9. **Reaction Toggle Error** (line ~795)
   - Event: `socket.on('reaction-toggle')`
   - Function: Toggling message reaction
   - Logs: userId, messageId, reaction emoji

10. **Unhandled Rejection** (line ~825)
    - Process: Handles promise rejections
    - Logs: Process PID, Node version

11. **Uncaught Exception** (line ~835)
    - Process: Handles unhandled exceptions
    - Logs: Process PID, Node version

---

## Error Information Captured

For each error, these details are automatically logged:

### Location Data

```javascript
{
  file: "server/src/index.js",        // File path
  function: "socket.on(message)",     // Function name
  line: "252",                        // Line number
  column: "10"                        // Column number
}
```

### User/Context Data

```javascript
{
  userId: "abc123",                   // User UUID
  socketId: "socket_xyz",             // Socket ID
  channelId: "channel_456",           // Channel UUID
  username: "alice"                   // Username
}
```

### Operation Data

```javascript
{
  eventName: "message",               // Socket event or route
  operation: "Processing and saving message",  // What was happening
  additionalInfo: {
    isEncrypted: true,
    messageLength: 256,
    targetType: "channel"             // channel or direct-message
  }
}
```

### Error Stack

```javascript
{
  errorType: "TypeError",
  message: "Cannot read property 'x' of undefined",
  stackTrace: [
    "at socket.on (/app/src/index.js:252:10)",
    "at async processMessage (/app/src/handlers.js:45:15)",
    // ... up to 10 frames
  ]
}
```

---

## Email Notification Example

When an error occurs, an email is sent with:

**Subject**: `GWS Connect Error: TypeError`

**Body**:

```
❌ GWS Connect Error: TypeError

📍 Location: server/src/index.js:252:10
📍 Operation: Processing and saving message

💬 Message: Cannot read property 'senderId' of undefined

Full Context:
{
  "timestamp": "2026-02-17T14:23:45.123Z",
  "errorType": "TypeError",
  "message": "Cannot read property 'senderId' of undefined",
  "location": {
    "file": "server/src/index.js",
    "function": "socket.on(message)",
    "line": "252",
    "column": "10"
  },
  "operation": "Processing and saving message",
  "context": {
    "userId": "user-123",
    "socketId": "socket_xyz",
    "channelId": "channel-456",
    "requestData": {
      "content": "Hello world",
      "isEncrypted": false,
      "messageLength": 11
    },
    "additionalInfo": {
      "username": "alice",
      "isEncrypted": false,
      "hasCipherText": false,
      "messagePreview": "Hello world",
      "targetType": "channel"
    }
  }
}

Active Users:
[
  { "id": "user-123", "username": "alice" },
  { "id": "user-456", "username": "bob" },
  { "id": "user-789", "username": "charlie" }
]
```

---

## How Each Error is Logged

### 1. Socket Connection Error

```javascript
await logSocketError(error, {
	file: 'index.js',
	function: 'io.on(connection)',
	socketId: socket.id,
	userId: socket.user.id,
	eventName: 'initial-channel-load',
	operation: 'Loading visible channels for user on connection',
	additionalInfo: {
		username: socket.user.username,
		action: 'Finding visible channels and auto-joining general',
	},
});
```

### 2. Message Sending Error

```javascript
await logSocketError(error, {
	file: 'index.js',
	function: 'socket.on(message)',
	socketId: socket.id,
	userId: socket.user.id,
	channelId,
	eventName: 'message',
	operation: 'Processing and saving message',
	additionalInfo: {
		username: socket.user.username,
		isEncrypted,
		messageLength: content?.length || 0,
		targetType: channelId ? 'channel' : 'direct-message',
	},
});
```

### 3. Poll Creation Error

```javascript
await logSocketError(error, {
	file: 'index.js',
	function: 'socket.on(poll-create)',
	socketId: socket.id,
	userId: socket.user.id,
	channelId,
	eventName: 'poll-create',
	operation: 'Creating poll and poll options',
	additionalInfo: {
		username: socket.user.username,
		questionPreview: question.substring(0, 100),
		optionCount: options.length,
		durationMinutes: Number(durationMinutes),
		targetType: channelId ? 'channel' : 'direct-message',
	},
});
```

### 4. Reaction Toggle Error

```javascript
await logSocketError(error, {
	file: 'index.js',
	function: 'socket.on(reaction-toggle)',
	socketId: socket.id,
	userId: socket.user.id,
	eventName: 'reaction-toggle',
	operation: 'Toggling message reaction and broadcasting update',
	additionalInfo: {
		username: socket.user.username,
		messageId,
		reaction, // e.g., "👍"
	},
});
```

### 5. Process-Level Errors

```javascript
process.on('unhandledRejection', (error) => {
	const logMessage = async () => {
		await logSocketError(error, {
			file: 'index.js',
			function: 'process.on(unhandledRejection)',
			operation: 'Handling unhandled promise rejection at process level',
			additionalInfo: {
				eventType: 'unhandledRejection',
				processId: process.pid,
				nodeVersion: process.version,
			},
		});
	};
	void logMessage();
});
```

---

## Configuration

### Environment Variables Required

```env
# SMTP Server Configuration
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=your-app-password
SMTP_FROM=errors@gws-connect.local
SMTP_REPLY_TO=support@gwsapp.net
```

### Error Recipient Email

Edit `server/src/services/errorReporter.js`:

```javascript
const ERROR_RECIPIENT = 'your-admin-email@example.com';
```

---

## Key Features

✅ **Specific Location Tracking**: Every error shows exact file, function, line, and column
✅ **Automatic Sanitization**: Passwords, tokens, and secrets are redacted
✅ **User Context**: Always logs who was affected by the error
✅ **Operation Details**: Shows what operation was being performed
✅ **Active Users**: Lists who was online when the error occurred
✅ **Stack Traces**: Full error stack (first 10 frames)
✅ **Email Alerts**: Immediate notification of critical errors
✅ **Development-Friendly**: Console output + emails for production
✅ **Comprehensive Data**: Request data, user ID, socket ID, channel ID, etc.

---

## Testing the Error Logger

To test the error logging system without causing a real error:

```javascript
import { logError } from './utils/logger.js';

// Test endpoint
router.get('/test-error', async (req, res) => {
	try {
		throw new Error('Intentional test error');
	} catch (error) {
		await logError(error, {
			file: 'routes/test.js',
			function: 'GET /test-error',
			operation: 'Testing error logging system',
			additionalInfo: 'This is a manual test',
		});
		res.json({ status: 'Error logged and email sent' });
	}
});
```

Then visit: `http://localhost:3001/test-error`

---

## Files Related to Error Logging

- `server/src/utils/logger.js` - Main logging utility (NEW)
- `server/src/services/errorReporter.js` - Email delivery service (MODIFIED)
- `server/src/index.js` - Socket and process handlers (MODIFIED)
- `server/ERROR_LOGGING_GUIDE.md` - Detailed usage guide (NEW)

---

## Next Steps for Implementation

To add error logging to additional route files:

1. Import the logger at the top of the file:

   ```javascript
   import { logError } from '../utils/logger.js';
   ```

2. Wrap route handlers in try-catch:

   ```javascript
   try {
   	// Route logic
   } catch (error) {
   	await logError(error, {
   		file: 'routes/filename.js',
   		function: 'ROUTE_METHOD /api/path',
   		route: 'METHOD /api/path',
   		operation: 'What was being done',
   		userId: req.user?.id,
   		requestData: req.body,
   	});
   	res.status(500).json({ error: 'Operation failed' });
   }
   ```

3. Test by triggering an error - check SMTP inbox
