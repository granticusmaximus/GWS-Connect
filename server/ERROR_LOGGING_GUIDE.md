# Error Logging & Email Notification System

## Overview

The error logging system provides comprehensive, specific error tracking with automatic email notifications. Every error is logged with:

- **Exact location**: File name, function name, line number, column number
- **Context**: User ID, socket ID, operation description
- **Stack trace**: Full error stack trace (first 10 frames)
- **Request data**: Sanitized request/payload data
- **Timestamps**: With ISO8601 format
- **Active users**: List of active users in the context (for socket errors)

## Setup

### Environment Variables

Add these to your `.env` file:

```env
# SMTP Configuration for error emails
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=your-app-password
SMTP_FROM=errors@gws-connect.local
SMTP_REPLY_TO=support@gwsapp.net
```

### Email Recipient

Edit `server/src/services/errorReporter.js` and set the `ERROR_RECIPIENT`:

```javascript
const ERROR_RECIPIENT = 'your-email@example.com';
```

## Usage

### 1. Basic Error Logging in Route Handlers

```javascript
import { logError } from '../utils/logger.js';

router.post('/api/message', async (req, res) => {
	try {
		// Your code here
		const { content, channelId } = req.body;
		// ... processing
	} catch (error) {
		await logError(error, {
			file: 'routes/messages.js',
			function: 'POST /api/message',
			route: 'POST /api/message',
			operation: 'Creating and saving message to database',
			userId: req.user?.id,
			channelId,
			requestData: req.body,
		});

		res.status(500).json({
			error: 'Failed to send message',
			...(process.env.NODE_ENV === 'development' && { details: error.message }),
		});
	}
});
```

### 2. Socket.io Error Logging

Use `logSocketError` for socket event handlers:

```javascript
import { logSocketError } from '../utils/logger.js';

socket.on('message', async (data) => {
	try {
		// Socket event handling
	} catch (error) {
		await logSocketError(error, {
			file: 'index.js',
			function: 'socket.on(message)',
			socketId: socket.id,
			userId: socket.user.id,
			channelId: data.channelId,
			eventName: 'message',
			operation: 'Processing and saving message',
			additionalInfo: {
				isEncrypted: data.isEncrypted,
				messageLength: data.content.length,
			},
		});
	}
});
```

### 3. Express Error Middleware

The error middleware is automatically registered in `index.js`. It catches all route errors:

```javascript
import { errorLoggingMiddleware } from '../utils/logger.js';

// Added to index.js after all routes
app.use(errorLoggingMiddleware);
```

This will:

- Log the error with full request context (method, path, query, params, body)
- Send email notification
- Return a JSON error response
- Include stack trace in development mode

### 4. Wrapping Functions with Auto-Logging

For functions you want to automatically wrap with error logging:

```javascript
import { withErrorLogging } from '../utils/logger.js';

export const myAsyncFunction = async (data) => {
	// Your code
};

// Wrap it
const wrappedFunction = withErrorLogging(myAsyncFunction, {
	file: 'services/myService.js',
	function: 'myAsyncFunction',
	operation: 'Processing user data',
});

// Usage - all errors automatically logged and re-thrown
await wrappedFunction(data);
```

### 5. Custom Context Configuration

Each logging call accepts a context object with these properties:

```javascript
{
  file: string,                    // File path or module name
  function: string,                // Function name
  route: string,                   // API route (e.g., "POST /api/users")
  operation: string,               // What was being attempted
  userId?: string|number,          // User ID if applicable
  socketId?: string,               // Socket ID for real-time errors
  channelId?: string|number,       // Channel ID if relevant
  recipientId?: string|number,     // DM recipient ID
  requestData?: object,            // Sanitized request body/params
  additionalInfo?: object|string,  // Any extra context
  activeUsers?: array,             // Array of active users (socket context)
}
```

## Data Sanitization

Sensitive fields are automatically redacted in email reports:

- `password`
- `token`
- `jwt`
- `apiKey`
- `secret`
- `auth`

Example output:

```json
{
	"password": "[REDACTED]",
	"token": "[REDACTED]"
}
```

## Email Format

Error emails include:

1. **Subject**: `GWS Connect Error: {ErrorType}`
2. **Location**: File path with line and column numbers
3. **Operation**: What was being attempted when the error occurred
4. **Message**: The error message
5. **Full Context**: Complete error details in formatted JSON
6. **Active Users**: List of users active during the error (for socket events)
7. **Stack Trace**: Full error stack trace

### Example Email Content:

```
❌ GWS Connect Error: TypeError

📍 Location: server/src/routes/messages.js:127:15
📍 Operation: Creating message record in database
🔗 Route: POST /api/messages/send

💬 Message: Cannot read property 'id' of undefined

Full Context:
{
  "timestamp": "2026-02-17T14:23:45.123Z",
  "errorType": "TypeError",
  "message": "Cannot read property 'id' of undefined",
  "location": {
    "file": "server/src/routes/messages.js",
    "function": "POST /api/messages/send",
    "line": "127",
    "column": "15"
  },
  "operation": "Creating message record in database",
  "context": {
    "userId": "user-123",
    "channelId": "channel-456",
    "requestData": {
      "content": "Hello world",
      "channelId": "channel-456"
    }
  }
}

Active Users:
[
  { "id": "user-123", "username": "alice" },
  { "id": "user-456", "username": "bob" }
]
```

## Best Practices

1. **Always provide context**: Include relevant IDs and operations
2. **Use descriptive operation strings**: "Creating poll option from request" not just "poll"
3. **Include request data**: Helps reproduce issues (sanitized automatically)
4. **Log at the right level**: Use the appropriate logging function for the context
5. **Avoid email spam**: Only set `notifyByEmail: true` for critical errors if needed
6. **Test SMTP**: Verify your SMTP configuration is working

## Example: Comprehensive Route Handler

```javascript
import { logError } from '../utils/logger.js';
import express from 'express';

const router = express.Router();

router.post('/api/channels/:channelId/messages', async (req, res) => {
	const { channelId } = req.params;
	const { content, isEncrypted } = req.body;
	const userId = req.user?.id;

	try {
		// Validation
		if (!content?.trim()) {
			return res.status(400).json({ error: 'Message content required' });
		}

		if (!channelId) {
			return res.status(400).json({ error: 'Channel ID required' });
		}

		// Check permissions
		const hasAccess = await checkChannelAccess(userId, channelId);
		if (!hasAccess) {
			return res.status(403).json({ error: 'Access denied' });
		}

		// Create message
		const message = await createMessage({
			content,
			channelId,
			userId,
			isEncrypted,
		});

		// Success
		res.json({ message });
	} catch (error) {
		// Comprehensive error logging
		await logError(error, {
			file: 'routes/messages.js',
			function: 'POST /api/channels/:channelId/messages',
			route: `POST /api/channels/${channelId}/messages`,
			operation: 'Creating and saving message to database',
			userId,
			channelId,
			requestData: {
				contentLength: content?.length || 0,
				isEncrypted: Boolean(isEncrypted),
			},
			additionalInfo: {
				action: 'message.create',
				timestamp: new Date().toISOString(),
			},
		});

		// Return error response
		res.status(500).json({
			error: 'Failed to create message',
			...(process.env.NODE_ENV === 'development' && {
				details: error.message,
			}),
		});
	}
});

export default router;
```

## Monitoring

To manually trigger error logging (for testing):

```javascript
import { logError } from './utils/logger.js';

// Test the system
await logError(new Error('Test error'), {
	file: 'test.js',
	function: 'testError',
	operation: 'Testing error logging system',
	additionalInfo: 'This is a test message',
});
```

## Troubleshooting

### No emails received?

1. Check `SMTP_HOST` environment variable is set
2. Verify SMTP credentials are correct
3. Check `ERROR_RECIPIENT` email in errorReporter.js
4. Look for errors in server console output
5. Ensure `notifyByEmail` parameter is not set to `false`

### Emails not detailed?

- Ensure you're passing complete context objects to logging functions
- Include relevant IDs and operation descriptions
- Add customized `additionalInfo` for extra context

### Need to change recipient?

Edit `server/src/services/errorReporter.js`:

```javascript
const ERROR_RECIPIENT = 'new-email@example.com';
```
