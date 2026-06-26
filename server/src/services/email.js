import sgMail from '@sendgrid/mail';

const getSendGridClient = () => {
	if (!process.env.SENDGRID_API_KEY) {
		throw new Error('SENDGRID_API_KEY is not configured');
	}
	sgMail.setApiKey(process.env.SENDGRID_API_KEY);
	return sgMail;
};

export const getFromAddress = () =>
	process.env.EMAIL_FROM || 'no-reply@gws-connect.local';

export const getReplyToAddress = () => process.env.EMAIL_REPLY_TO || undefined;

export const sendTemporaryPasswordEmail = async ({
	to,
	username,
	tempPassword,
}) => {
	const sgMail = getSendGridClient();

	const subject = 'Your GWS Connect temporary password';
	const loginUrl = 'https://connect.gwsapp.net/login';
	const logoUrl = 'https://connect.gwsapp.net/gws-connect-favicon.svg';
	const text = `Hi ${username},\n\nAn administrator created an account for you on GWS Connect.\n\nTemporary password: ${tempPassword}\n\nThis password is temporary. You will be required to create a new password after you sign in.\n\nSign in at: ${loginUrl}\n\nIf you did not expect this email, please contact your administrator.`;
	const html = `<!DOCTYPE html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>${subject}</title>
	</head>
	<body style="font-family: Arial, Helvetica, sans-serif; color: #111827; background: #f9fafb; padding: 20px;">
		<div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px;">
			<div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
				<img src="${logoUrl}" alt="GWS Connect" width="24" height="24" style="display: block;" />
				<span style="font-size: 18px; font-weight: 700; color: #111827;">GWS Connect</span>
			</div>
			<h2 style="margin: 0 0 10px; color: #b91c1c;">Temporary password</h2>
			<p style="margin: 0 0 12px; color: #374151;">Hi ${username},</p>
			<p style="margin: 0 0 12px; color: #374151;">An administrator created an account for you on GWS Connect.</p>
			<p style="margin: 0 0 12px; color: #111827;"><strong>Temporary password:</strong> ${tempPassword}</p>
			<p style="margin: 0 0 12px; color: #374151;">This password is temporary. You will be required to create a new password after you sign in.</p>
			<p style="margin: 0 0 12px; color: #374151;">Sign in at: <a href="${loginUrl}" style="color: #b91c1c; text-decoration: none;">${loginUrl}</a></p>
			<p style="margin: 0; color: #6b7280;">If you did not expect this email, please contact your administrator.</p>
		</div>
	</body>
</html>`;

	await sgMail.send({
		from: getFromAddress(),
		replyTo: getReplyToAddress(),
		to,
		subject,
		text,
		html,
	});
};

export const sendAdminResetPasswordEmail = async ({
	to,
	username,
	tempPassword,
}) => {
	const sgMail = getSendGridClient();

	const subject = 'Your GWS Connect password reset';
	const loginUrl = 'https://connect.gwsapp.net/login';
	const logoUrl = 'https://connect.gwsapp.net/gws-connect-favicon.svg';
	const text = `Hi ${username},\n\nAn administrator has created a new temporary password for your GWS Connect account.\n\nTemporary password: ${tempPassword}\n\nPlease log in using this temporary password and update your password immediately. Your new password must be at least 8 characters and include at least one number, one uppercase letter, and one special character.\n\nSign in at: ${loginUrl}\n\nIf you did not expect this change, please contact your administrator right away.`;
	const html = `<!DOCTYPE html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>${subject}</title>
	</head>
	<body style="font-family: Arial, Helvetica, sans-serif; color: #111827; background: #f9fafb; padding: 20px;">
		<div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px;">
			<div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
				<img src="${logoUrl}" alt="GWS Connect" width="24" height="24" style="display: block;" />
				<span style="font-size: 18px; font-weight: 700; color: #111827;">GWS Connect</span>
			</div>
			<h2 style="margin: 0 0 10px; color: #b91c1c;">Password reset</h2>
			<p style="margin: 0 0 12px; color: #374151;">Hi ${username},</p>
			<p style="margin: 0 0 12px; color: #374151;">An administrator has created a new temporary password for your GWS Connect account.</p>
			<p style="margin: 0 0 12px; color: #111827;"><strong>Temporary password:</strong> ${tempPassword}</p>
			<p style="margin: 0 0 12px; color: #374151;">Please log in using this temporary password and update your password immediately.</p>
			<p style="margin: 0 0 12px; color: #374151;">Your new password must be at least 8 characters and include at least one number, one uppercase letter, and one special character.</p>
			<p style="margin: 0 0 12px; color: #374151;">Sign in at: <a href="${loginUrl}" style="color: #b91c1c; text-decoration: none;">${loginUrl}</a></p>
			<p style="margin: 0; color: #6b7280;">If you did not expect this change, please contact your administrator right away.</p>
		</div>
	</body>
</html>`;

	await sgMail.send({
		from: getFromAddress(),
		replyTo: getReplyToAddress(),
		to,
		subject,
		text,
		html,
	});
};
