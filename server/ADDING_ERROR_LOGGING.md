# Adding Error Logging to Your Code

## Template for Route Handlers

Copy and customize this template for any new route:

```javascript
import express from 'express';
import { logError } from '../utils/logger.js';

const router = express.Router();

// Example endpoint
router.post('/api/resource', async (req, res) => {
	const resourceId = req.params.id;
	const userId = req.user?.id;

	try {
		// Your business logic here
		const result = await createResource(req.body);

		res.json({ success: true, data: result });
	} catch (error) {
		// Log the error with full context
		await logError(error, {
			file: 'routes/resource.js', // This file
			function: 'POST /api/resource', // This endpoint
			route: 'POST /api/resource',
			operation: 'Creating new resource from request',
			userId, // Who made the request
			requestData: req.body, // What they sent (auto-sanitized)
			additionalInfo: {
				resourceId,
				action: 'resource.create',
				timestamp: new Date().toISOString(),
			},
		});

		// Return error response
		res.status(500).json({
			error: 'Failed to create resource',
			...(process.env.NODE_ENV === 'development' && {
				details: error.message,
			}),
		});
	}
});

export default router;
```

## Template for Socket Handlers

Copy and customize this for socket.io event handlers:

```javascript
import { logSocketError } from '../utils/logger.js';

socket.on('custom-event', async (data) => {
	const { resourceId, value } = data || {};

	try {
		// Your socket event logic here
		const result = await processEvent(resourceId, value);

		// Emit response back to client
		socket.emit('custom-event-response', { success: true, data: result });
	} catch (error) {
		// Log the socket error with full context
		await logSocketError(error, {
			file: 'index.js', // File name
			function: 'socket.on(custom-event)', // Socket event handler
			socketId: socket.id, // Socket connection ID
			userId: socket.user.id, // User ID
			eventName: 'custom-event', // Event name
			operation: 'Processing custom event and updating resource',
			additionalInfo: {
				username: socket.user.username,
				resourceId,
				value,
				timestamp: new Date().toISOString(),
			},
		});

		// Notify client of error
		socket.emit('error', { message: 'Event processing failed' });
	}
});
```

## Template for Service/Utility Functions

For helper functions and services:

```javascript
import { logError } from '../utils/logger.js';

export const myServiceFunction = async (params) => {
	try {
		// Your service logic here
		const result = await externalCall(params);
		return result;
	} catch (error) {
		// Log the error
		await logError(error, {
			file: 'services/myService.js',
			function: 'myServiceFunction',
			operation: 'Processing service operation',
			additionalInfo: {
				params,
				stage: 'data-validation',
				timestamp: new Date().toISOString(),
			},
		});

		// Re-throw or handle as needed
		throw error;
	}
};
```

## Real-World Examples

### Example 1: User Registration

```javascript
router.post('/register', async (req, res) => {
	const { username, email, password } = req.body;

	try {
		// Validation
		if (!username || !email || !password) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		// Check if user exists
		const existingUser = await findUserByEmail(email);
		if (existingUser) {
			return res.status(400).json({ error: 'Email already registered' });
		}

		// Create user
		const user = await createUser({ username, email, password });

		res.json({ success: true, userId: user.id });
	} catch (error) {
		await logError(error, {
			file: 'routes/auth.js',
			function: 'POST /register',
			route: 'POST /register',
			operation: 'Creating new user account from registration',
			requestData: {
				username,
				email,
				// Note: password intentionally NOT logged
			},
			additionalInfo: {
				action: 'user.register',
				emailDomain: email.split('@')[1],
			},
		});

		res.status(500).json({ error: 'Registration failed' });
	}
});
```

### Example 2: Channel Message Update

```javascript
router.put('/api/channels/:channelId/messages/:messageId', async (req, res) => {
	const { channelId, messageId } = req.params;
	const { content } = req.body;
	const userId = req.user?.id;

	try {
		// Validate
		if (!content?.trim()) {
			return res.status(400).json({ error: 'Message content required' });
		}

		// Check permissions
		const message = await getMessageById(messageId);
		if (!message) {
			return res.status(404).json({ error: 'Message not found' });
		}

		if (String(message.senderId) !== String(userId)) {
			return res.status(403).json({ error: 'Not authorized' });
		}

		// Update message
		await updateMessage(messageId, { content });

		res.json({ success: true });
	} catch (error) {
		await logError(error, {
			file: 'routes/messages.js',
			function: 'PUT /api/channels/:channelId/messages/:messageId',
			route: `PUT /api/channels/${channelId}/messages/${messageId}`,
			operation: 'Updating message content',
			userId,
			channelId,
			requestData: {
				contentLength: content?.length || 0,
			},
			additionalInfo: {
				messageId,
				action: 'message.update',
			},
		});

		res.status(500).json({ error: 'Failed to update message' });
	}
});
```

### Example 3: Socket Event with Broadcast

```javascript
socket.on('start-call', async (data, callback) => {
	const { recipientId } = data || {};
	const callerId = socket.user.id;

	try {
		// Validate
		if (!recipientId) {
			callback?.({ ok: false, message: 'Recipient required' });
			return;
		}

		// Check user exists
		const recipient = await findUserById(recipientId);
		if (!recipient) {
			callback?.({ ok: false, message: 'User not found' });
			return;
		}

		// Send call notification
		io.to(recipientId).emit('incoming-call', {
			from: callerId,
			fromUsername: socket.user.username,
			fromAvatar: socket.user.avatar,
		});

		callback?.({ ok: true });
	} catch (error) {
		await logSocketError(error, {
			file: 'index.js',
			function: 'socket.on(start-call)',
			socketId: socket.id,
			userId: socket.user.id,
			eventName: 'start-call',
			operation: 'Initiating call and notifying recipient',
			additionalInfo: {
				username: socket.user.username,
				recipientId,
				action: 'call.initiate',
			},
		});

		callback?.({ ok: false, message: 'Call failed to start' });
	}
});
```

## Context Fields Explained

| Field            | When to Use             | Example                                          |
| ---------------- | ----------------------- | ------------------------------------------------ |
| `file`           | Always                  | `'routes/auth.js'`, `'services/email.js'`        |
| `function`       | Always                  | `'POST /api/auth/login'`, `'socket.on(message)'` |
| `route`          | HTTP routes only        | `'POST /api/users/register'`                     |
| `socketId`       | Socket events only      | `socket.id`                                      |
| `userId`         | When user is identified | `req.user?.id`, `socket.user.id`                 |
| `channelId`      | When channel-related    | `req.body.channelId`, `data.channelId`           |
| `operation`      | Always                  | Description of what was happening                |
| `requestData`    | Route handlers          | `req.body`, `req.query`                          |
| `additionalInfo` | For extra context       | `{ username, stage, action }`                    |

## Error Email Checklist

When you add new error logging, emails will include:

✅ Exact file location with line/column numbers  
✅ Function name where error occurred  
✅ Operation description from your logging  
✅ User ID and socket ID (if applicable)  
✅ Request data (sanitized - no passwords)  
✅ Full error stack trace  
✅ Timestamp in ISO format  
✅ List of active users at time of error

## Common Mistakes to Avoid

### ❌ Don't: Log passwords or tokens

```javascript
// WRONG - will log sensitive data
requestData: { ...req.body }  // If body has password
```

### ✅ Do: Filter sensitive data

```javascript
// CORRECT - auto-sanitized
requestData: {
  email: req.body.email,
  username: req.body.username,
  // password not included
}
```

### ❌ Don't: Vague operation descriptions

```javascript
// WRONG
operation: 'error';
operation: 'failed';
```

### ✅ Do: Specific operation descriptions

```javascript
// CORRECT
operation: 'Creating user account from registration form';
operation: 'Broadcasting message to channel members';
operation: 'Processing poll vote and updating results';
```

### ❌ Don't: Skip context fields

```javascript
// WRONG - missing important context
await logError(error, {
	operation: 'save message',
});
```

### ✅ Do: Provide complete context

```javascript
// CORRECT - full context for debugging
await logError(error, {
	file: 'socket-handlers.js',
	function: 'socket.on(message)',
	socketId: socket.id,
	userId: socket.user.id,
	channelId: data.channelId,
	operation: 'Saving message and broadcasting to channel',
	additionalInfo: { messageLength: data.content.length },
});
```

## Testing Your Error Logging

### Manual Test Endpoint

Add this to a route file to test:

```javascript
router.get('/test-error', async (req, res) => {
	try {
		throw new Error('Intentional test error for logging');
	} catch (error) {
		await logError(error, {
			file: 'routes/test.js',
			function: 'GET /test-error',
			operation: 'Testing error logging system',
			userId: req.user?.id,
			additionalInfo: 'Manual test triggered',
		});
		res.json({ status: 'Error logged', checkEmail: true });
	}
});
```

Then call: `GET http://localhost:3001/test-error`

Check your email inbox for the error notification!

## Quick Reference

```javascript
// Route handler
import { logError } from '../utils/logger.js';
await logError(error, { file, function, route, operation, userId, requestData });

// Socket event
import { logSocketError } from '../utils/logger.js';
await logSocketError(error, { file, function, socketId, userId, eventName, operation });

// Automatic for all routes
import { errorLoggingMiddleware } from '../utils/logger.js';
app.use(errorLoggingMiddleware);
```

---

**For detailed documentation, see:**

- `ERROR_LOGGING_QUICKSTART.md` - Quick setup
- `ERROR_LOGGING_GUIDE.md` - Complete reference
- `ERROR_LOGGING_IMPLEMENTATION.md` - All examples
