# GWS Connect Error Logging System - Documentation Index

## 📚 Documentation Files

### Start Here

1. **[ERROR_LOGGING_QUICKSTART.md](./ERROR_LOGGING_QUICKSTART.md)** ⭐
   - 1-minute setup guide
   - Basic usage examples
   - Quick reference for developers
   - **Read this first**

### Detailed Guides

2. **[ERROR_LOGGING_GUIDE.md](./ERROR_LOGGING_GUIDE.md)**
   - Complete reference documentation
   - Configuration options
   - Data sanitization details
   - Email format and examples
   - Best practices
   - Troubleshooting

3. **[ERROR_LOGGING_IMPLEMENTATION.md](./ERROR_LOGGING_IMPLEMENTATION.md)**
   - All 11 error handlers documented
   - Implementation details for each
   - Example email notifications
   - Files modified with line numbers

4. **[ADDING_ERROR_LOGGING.md](./ADDING_ERROR_LOGGING.md)**
   - Templates for new error handlers
   - Real-world code examples
   - Common mistakes to avoid
   - Testing your implementation

5. **[../ERROR_LOGGING_SUMMARY.md](../ERROR_LOGGING_SUMMARY.md)**
   - High-level overview
   - What was built and why
   - Benefits summary
   - Next steps

## 🔧 Source Code Files

### New Code

- **`src/utils/logger.js`** - Core logging utility
  - `logError()` - Main error logging function
  - `logSocketError()` - Socket-specific logging
  - `errorLoggingMiddleware` - Express middleware
  - `withErrorLogging()` - Function wrapper

### Modified Code

- **`src/services/errorReporter.js`** - Enhanced email delivery
- **`src/index.js`** - All error handlers updated

## 🚀 Quick Start

### Setup (2 minutes)

1. **Add environment variables** to `.env`:

   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   ```

2. **Set error recipient** in `src/services/errorReporter.js`:

   ```javascript
   const ERROR_RECIPIENT = 'your-email@example.com';
   ```

3. **Done!** All errors are now logged with email notifications.

### Basic Usage

```javascript
import { logError } from '../utils/logger.js';

try {
	// Your code
} catch (error) {
	await logError(error, {
		file: 'routes/myfile.js',
		function: 'POST /api/endpoint',
		operation: 'Describing what was being done',
		userId: req.user?.id,
	});
}
```

## 📋 Error Handlers Implemented

| #   | Type    | Handler                   | Location           |
| --- | ------- | ------------------------- | ------------------ |
| 1   | Socket  | Connection initialization | `src/index.js:109` |
| 2   | Socket  | Message sending           | `src/index.js:252` |
| 3   | Socket  | GIF messages              | `src/index.js:332` |
| 4   | Socket  | Poll creation             | `src/index.js:434` |
| 5   | Socket  | Poll voting               | `src/index.js:530` |
| 6   | Socket  | Message editing           | `src/index.js:591` |
| 7   | Socket  | Message deletion          | `src/index.js:649` |
| 8   | Socket  | Message archiving         | `src/index.js:704` |
| 9   | Socket  | Reaction toggling         | `src/index.js:795` |
| 10  | Process | Unhandled rejections      | `src/index.js:825` |
| 11  | Process | Uncaught exceptions       | `src/index.js:835` |

## ✨ Key Features

✅ **Specific Location** - File, function, line, and column numbers  
✅ **Full Context** - User ID, socket ID, channel ID, operation description  
✅ **Data Sanitization** - Passwords and tokens automatically redacted  
✅ **Stack Traces** - Full error stack (first 10 frames)  
✅ **Email Alerts** - Immediate notification to admin  
✅ **Active Users** - List of connected users at time of error  
✅ **Timestamps** - ISO8601 format for all errors  
✅ **Request Data** - Automatically captured and sanitized

## 📧 Email Notification Format

```
From: noreply@gws-connect.local
Subject: GWS Connect Error: TypeError

❌ GWS Connect Error: TypeError

📍 Location: server/src/index.js:252:10
📍 Operation: Processing and saving message

💬 Message: Cannot read property 'x' of undefined

Full Context:
{...error details, stack trace...}

Active Users:
[...connected users...]
```

## 🔍 How It Works

```
Error Occurs
    ↓
logError() or logSocketError() called
    ↓
Extract stack location (file, line, column)
    ↓
Sanitize sensitive data
    ↓
Create detailed context object
    ↓
Log to console with formatting
    ↓
(if SMTP configured)
Send email to ERROR_RECIPIENT
    ↓
Re-throw error or return to client
```

## 🛡️ Data Privacy

These fields are automatically redacted in emails:

- `password`
- `token`
- `jwt`
- `apiKey`
- `secret`
- `auth`

Safe to log request bodies - secrets are protected!

## 📱 What Gets Logged

For every error, you'll know:

- ✅ Exact file and line number
- ✅ Function that caused it
- ✅ What operation was happening
- ✅ Who was affected (user ID, username)
- ✅ What request/event triggered it
- ✅ Full error message
- ✅ Complete stack trace
- ✅ When it happened (timestamp)
- ✅ Who else was online

## 🧪 Testing

### Test Endpoint

```bash
curl http://localhost:3001/test-error
```

Then check email for notification.

### Manual Test

```javascript
import { logError } from './utils/logger.js';

await logError(new Error('Test'), {
	file: 'test.js',
	operation: 'Testing error logging',
	additionalInfo: 'Manual test',
});
```

## 📖 Documentation by Task

| I want to...             | Read this                                                            |
| ------------------------ | -------------------------------------------------------------------- |
| Get started quickly      | [ERROR_LOGGING_QUICKSTART.md](./ERROR_LOGGING_QUICKSTART.md)         |
| Configure error logging  | [ERROR_LOGGING_GUIDE.md](./ERROR_LOGGING_GUIDE.md)                   |
| Add logging to new code  | [ADDING_ERROR_LOGGING.md](./ADDING_ERROR_LOGGING.md)                 |
| See what was implemented | [ERROR_LOGGING_IMPLEMENTATION.md](./ERROR_LOGGING_IMPLEMENTATION.md) |
| Understand the system    | [../ERROR_LOGGING_SUMMARY.md](../ERROR_LOGGING_SUMMARY.md)           |

## 🎯 Architecture

```
┌─────────────────────────────────────────┐
│        Your Application Code            │
│  (routes, socket handlers, services)    │
└──────────────────┬──────────────────────┘
                   │ try/catch
                   ↓
┌─────────────────────────────────────────┐
│    logger.js (logError, logSocketError)  │
│  - Extract stack location                │
│  - Sanitize sensitive data               │
│  - Format error context                  │
└──────────────────┬──────────────────────┘
                   │
        ┌──────────┴──────────┐
        ↓                     ↓
   Console Output      errorReporter.js
   (formatted)         (sendErrorNotification)
                            │
                            ↓
                      SMTP Server
                            │
                            ↓
                      Admin Email
```

## 🔗 Related Files

- `src/utils/logger.js` - Logging utility (NEW)
- `src/services/errorReporter.js` - Email service (MODIFIED)
- `src/index.js` - Socket and process handlers (MODIFIED)
- `package.json` - Dependencies (no changes needed)
- `.env` - Environment configuration (needs SMTP settings)

## 📝 Environment Variables

```env
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@gws-connect.local
SMTP_REPLY_TO=support@gwsapp.net

# Error Recipient (set in errorReporter.js)
# ERROR_RECIPIENT=admin@example.com
```

## 🚀 Next Steps

1. ✅ **Setup SMTP** - Configure email in `.env`
2. ✅ **Set recipient** - Update `errorReporter.js`
3. ✅ **Test it** - Trigger a test error
4. ✅ **Monitor** - Check emails for production errors
5. ✅ **Extend** - Add logging to your new code

## 💡 Pro Tips

- **Be specific** in operation descriptions
- **Include request data** for debugging (auto-sanitized)
- **Add additionalInfo** for extra context
- **Test SMTP** before deploying to production
- **Check logs regularly** for patterns

## 🐛 Troubleshooting

### No emails sent?

- Check `.env` has SMTP_HOST
- Verify SMTP credentials
- Ensure ERROR_RECIPIENT email is correct
- Check server logs for SMTP errors

### Need more info in emails?

- Expand the `additionalInfo` object
- Include relevant request data
- Add timestamps and stages

### Want to change recipient?

- Edit `src/services/errorReporter.js` line ~4
- Update the `ERROR_RECIPIENT` constant

## 📞 Support

See the guides for detailed information:

- Setup issues → [ERROR_LOGGING_GUIDE.md](./ERROR_LOGGING_GUIDE.md#troubleshooting)
- Code examples → [ADDING_ERROR_LOGGING.md](./ADDING_ERROR_LOGGING.md)
- Implementation details → [ERROR_LOGGING_IMPLEMENTATION.md](./ERROR_LOGGING_IMPLEMENTATION.md)

---

**Created**: February 17, 2026  
**Version**: 1.0  
**Status**: ✅ Production Ready
