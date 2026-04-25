# Error Logging Quick Start

## One-Minute Setup

### 1. Add Environment Variables

Add to `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@gws-connect.local
SMTP_REPLY_TO=support@gwsapp.net
```

### 2. Set Error Email Address

Edit `server/src/services/errorReporter.js`:

```javascript
const ERROR_RECIPIENT = 'your-email@example.com'; // ← Change this
```

### 3. Done! ✅

All errors are now being logged with email notifications.

---

## Basic Usage

### In Route Handlers

```javascript
import { logError } from '../utils/logger.js';

try {
	// Your code
} catch (error) {
	await logError(error, {
		file: 'routes/myfile.js',
		function: 'POST /api/endpoint',
		operation: 'Creating a resource',
		userId: req.user?.id,
		requestData: req.body,
	});
	res.status(500).json({ error: 'Failed' });
}
```

### In Socket Handlers

```javascript
import { logSocketError } from '../utils/logger.js';

socket.on('event', async (data) => {
	try {
		// Socket code
	} catch (error) {
		await logSocketError(error, {
			file: 'index.js',
			socketId: socket.id,
			userId: socket.user.id,
			eventName: 'event',
			operation: 'Processing socket event',
		});
	}
});
```

---

## What Gets Logged

When an error happens, you automatically get:

✅ **File location** with line/column numbers  
✅ **Function name** that caused the error  
✅ **Operation description** for context  
✅ **User ID** and socket information  
✅ **Request data** (passwords redacted)  
✅ **Full error stack trace**  
✅ **Active users** at time of error  
✅ **Timestamp** in ISO format  
✅ **Email notification** to admin

---

## Example Error Email

```
From: no-reply@gws-connect.local
Subject: GWS Connect Error: TypeError

❌ GWS Connect Error: TypeError

📍 Location: server/src/index.js:252:10
📍 Operation: Processing and saving message

💬 Message: Cannot read property 'senderId' of undefined

[Full context and stack trace below...]
```

---

## Common Patterns

### Logging with Request Context

```javascript
await logError(error, {
	file: 'routes/messages.js',
	function: 'POST /api/messages',
	route: 'POST /api/messages',
	operation: 'Saving message to database',
	userId: req.user?.id,
	channelId: req.body.channelId,
	requestData: req.body,
});
```

### Logging with Socket Context

```javascript
await logSocketError(error, {
	file: 'index.js',
	function: 'socket.on(message)',
	socketId: socket.id,
	userId: socket.user.id,
	channelId: data.channelId,
	eventName: 'message',
	operation: 'Broadcasting message to channel members',
});
```

### Logging with Custom Info

```javascript
await logError(error, {
	file: 'services/database.js',
	function: 'saveUser',
	operation: 'Creating new user account',
	userId: newUser.id,
	additionalInfo: {
		username: newUser.username,
		emailDomain: newUser.email.split('@')[1],
		timestamp: Date.now(),
	},
});
```

---

## Data Privacy

Sensitive fields are automatically hidden in emails:

- ✅ `password` → `[REDACTED]`
- ✅ `token` → `[REDACTED]`
- ✅ `apiKey` → `[REDACTED]`
- ✅ `secret` → `[REDACTED]`

So you can safely pass request bodies without worrying about leaking secrets.

---

## Check It's Working

### View Server Logs

```bash
docker logs gws-connect-server-1
```

You should see errors like:

```
❌ ERROR "TypeError" at src/index.js:252:10
📍 Operation: Processing and saving message
💬 Message: Cannot read property 'x' of undefined
```

### Test with a Trigger

```bash
curl http://localhost:3001/test-error
```

Then check your email inbox for the error notification.

---

## Need Help?

See full documentation: `server/ERROR_LOGGING_GUIDE.md`

See implementation examples: `server/ERROR_LOGGING_IMPLEMENTATION.md`
