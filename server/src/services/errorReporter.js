import sgMail from '@sendgrid/mail';
import { getFromAddress, getReplyToAddress } from './email.js';

const ERROR_RECIPIENT = 'grant@gwsapp.net';

const safeStringify = (value) => {
	try {
		return JSON.stringify(value, null, 2);
	} catch (error) {
		return `"[unserializable] ${error?.message || 'unknown error'}"`;
	}
};

const normalizeError = (error) => {
	if (!error) {
		return { name: 'Error', message: 'Unknown error', stack: '' };
	}

	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack || '',
		};
	}

	return {
		name: 'Error',
		message: String(error),
		stack: '',
	};
};

const buildErrorHtml = ({ summary, details, context, activeUsers }) => {
	const contextBlock = safeStringify(context || {});
	const usersBlock = safeStringify(activeUsers || []);

	const locationInfo = context?.location || {};
	const locationStr = locationInfo.file
		? `${locationInfo.file}:${locationInfo.line || '?'}:${locationInfo.column || '?'}`
		: 'unknown';
	const operation = context?.operation || 'unknown';

	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${summary}</title>
</head>
<body style="font-family: Arial, Helvetica, sans-serif; color: #111827; background: #f9fafb; padding: 20px;">
  <div style="max-width: 760px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px;">
    <h2 style="margin: 0 0 8px; color: #b91c1c;">${summary}</h2>
    <p style="margin: 0 0 4px; color: #6b7280;"><strong>Location:</strong> ${locationStr}</p>
    <p style="margin: 0 0 16px; color: #6b7280;"><strong>Operation:</strong> ${operation}</p>
    <p style="margin: 0 0 16px; color: #6b7280;">${details}</p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
    <h3 style="margin: 18px 0 8px; font-size: 14px; text-transform: uppercase; color: #9ca3af;">Full Context</h3>
    <pre style="background: #f3f4f6; padding: 12px; border-radius: 8px; overflow: auto; font-size: 12px; line-height: 1.4;">${contextBlock}</pre>
    <h3 style="margin: 18px 0 8px; font-size: 14px; text-transform: uppercase; color: #9ca3af;">Active Users</h3>
    <pre style="background: #f3f4f6; padding: 12px; border-radius: 8px; overflow: auto; font-size: 12px; line-height: 1.4;">${usersBlock}</pre>
  </div>
</body>
</html>`;
};

export const sendErrorNotification = async ({
	error,
	context,
	activeUsers,
}) => {
	if (!process.env.SENDGRID_API_KEY) {
		console.warn('SENDGRID_API_KEY is not configured. Skipping error email.');
		return;
	}

	const normalized = normalizeError(error);
	const summary = `GWS Connect Error: ${normalized.name}`;
	const details = normalized.message || 'Unknown error';

	const payload = {
		timestamp: new Date().toISOString(),
		environment: process.env.NODE_ENV || 'development',
		context: context || {},
		error: normalized,
	};

	const text = `${summary}

${details}

Context:
${safeStringify(payload)}

Active Users:
${safeStringify(activeUsers || [])}
`;

	const html = buildErrorHtml({
		summary,
		details,
		context: payload,
		activeUsers,
	});
	sgMail.setApiKey(process.env.SENDGRID_API_KEY);

	await sgMail.send({
		from: getFromAddress(),
		replyTo: getReplyToAddress(),
		to: ERROR_RECIPIENT,
		subject: summary,
		text,
		html,
	});
};
