// netlify/functions/_email.js
// All Resend email templates — imported by other functions

const { Resend } = require('resend');

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM = `${process.env.RESEND_FROM_NAME || 'Show Up'} <${process.env.RESEND_FROM_EMAIL || 'hello@showupmedia.org'}>`;

// ── HELPER: format date nicely ──────────────────────────────
function fmtDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

// ── BASE EMAIL WRAPPER ──────────────────────────────────────
function baseHtml(content, color = '#2D8EFF') {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#f4f4f4;margin:0;padding:0;}
  .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);}
  .header{background:${color};padding:28px 32px;text-align:center;}
  .header h1{color:#fff;font-size:22px;margin:0;font-weight:800;letter-spacing:-0.3px;}
  .header p{color:rgba(255,255,255,0.85);font-size:13px;margin:6px 0 0;}
  .body{padding:28px 32px;}
  .body p{color:#444;font-size:15px;line-height:1.6;margin:0 0 16px;}
  .detail-box{background:#f8f8f8;border:1px solid #eee;border-radius:8px;padding:18px 20px;margin:20px 0;}
  .detail-row{display:flex;justify-content:space-between;padding:7px 0;font-size:14px;border-bottom:1px solid #eee;}
  .detail-row:last-child{border-bottom:none;}
  .detail-label{color:#888;font-weight:500;}
  .detail-val{color:#111;font-weight:600;text-align:right;}
  .btn{display:inline-block;background:${color};color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;font-size:15px;margin:8px 0;}
  .btn-outline{display:inline-block;background:#fff;color:${color};text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:700;font-size:15px;margin:8px 0;border:2px solid ${color};}
  .footer{background:#f8f8f8;padding:18px 32px;text-align:center;font-size:12px;color:#aaa;border-top:1px solid #eee;}
  .footer a{color:#aaa;}
  .status-badge{display:inline-block;padding:5px 14px;border-radius:999px;font-size:12px;font-weight:700;}
</style>
</head>
<body><div class="wrap">${content}<div class="footer">
  Powered by <strong>Show Up</strong> · <a href="https://showupmedia.org">showupmedia.org</a><br>
  Show Up Media · hello@showupmedia.org
</div></div></body>
</html>`;
}

// ── 1. BUSINESS WELCOME (sent after successful payment) ─────
async function sendBusinessWelcome({ business, loginEmail, tempPassword }) {
  const resend = getResend();
  const color = business.color || '#2D8EFF';
  const html = baseHtml(`
    <div class="header">
      <h1>Welcome to Show Up! 🎉</h1>
      <p>Your booking system is live and ready</p>
    </div>
    <div class="body">
      <p>Hi ${business.name},</p>
      <p>Your account is set up and your booking page is live. Here are your details:</p>
      <div class="detail-box">
        <div class="detail-row"><span class="detail-label">Booking Page</span><span class="detail-val">showup.io/book/${business.slug}</span></div>
        <div class="detail-row"><span class="detail-label">Dashboard Login</span><span class="detail-val">${loginEmail}</span></div>
        <div class="detail-row"><span class="detail-label">Temporary Password</span><span class="detail-val">${tempPassword}</span></div>
        <div class="detail-row"><span class="detail-label">Plan</span><span class="detail-val">${business.stripe_plan === 'annual' ? 'Annual — £99/yr' : 'Monthly — £15/mo'}</span></div>
      </div>
      <p>⚠️ Please log in and change your password immediately.</p>
      <p style="text-align:center;margin-top:24px;">
        <a href="${process.env.APP_URL}/dashboard" class="btn">Go to Your Dashboard →</a>
      </p>
      <p style="margin-top:20px;">Share your booking link with clients:</p>
      <div class="detail-box" style="text-align:center;">
        <strong style="color:${color};font-size:16px;">${process.env.APP_URL}/book/${business.slug}</strong>
      </div>
      <p>Any questions? Just reply to this email — we're here to help.</p>
    </div>
  `, color);

  return resend.emails.send({
    from: FROM,
    to: loginEmail,
    subject: `🎉 Your Show Up booking system is live — ${business.name}`,
    html,
  });
}

// ── 2. NEW BOOKING REQUEST (sent to business owner) ─────────
async function sendNewBookingToBusiness({ business, booking }) {
  const resend = getResend();
  const color = business.color || '#2D8EFF';
  const appUrl = process.env.APP_URL;

  const html = baseHtml(`
    <div class="header">
      <h1>New Booking Request 📅</h1>
      <p>${business.name}</p>
    </div>
    <div class="body">
      <p>You have a new booking request! Review the details below and accept or decline.</p>
      <div class="detail-box">
        <div class="detail-row"><span class="detail-label">Customer</span><span class="detail-val">${booking.customer_name}</span></div>
        <div class="detail-row"><span class="detail-label">Email</span><span class="detail-val">${booking.customer_email}</span></div>
        <div class="detail-row"><span class="detail-label">Phone</span><span class="detail-val">${booking.customer_phone || 'Not provided'}</span></div>
        <div class="detail-row"><span class="detail-label">Service</span><span class="detail-val">${booking.service_name}</span></div>
        <div class="detail-row"><span class="detail-label">Date</span><span class="detail-val">${fmtDate(booking.booked_date)}</span></div>
        <div class="detail-row"><span class="detail-label">Time</span><span class="detail-val">${booking.booked_time}</span></div>
        <div class="detail-row"><span class="detail-label">Duration</span><span class="detail-val">${booking.duration_mins} mins</span></div>
        <div class="detail-row"><span class="detail-label">Price</span><span class="detail-val">£${parseFloat(booking.service_price).toFixed(2)}</span></div>
        <div class="detail-row"><span class="detail-label">Payment</span><span class="detail-val">${booking.payment_method === 'online' ? '💳 Paying Online' : '💵 Paying at Appointment'}</span></div>
        ${booking.customer_notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span class="detail-val">${booking.customer_notes}</span></div>` : ''}
      </div>
      <p style="text-align:center;margin-top:24px;">
        <a href="${appUrl}/api/accept-booking?id=${booking.id}&token=${booking.id}" class="btn">✓ Accept Booking</a>
        &nbsp;&nbsp;
        <a href="${appUrl}/api/decline-booking?id=${booking.id}&token=${booking.id}" class="btn-outline">✕ Decline</a>
      </p>
      <p style="text-align:center;font-size:13px;color:#aaa;margin-top:12px;">Or manage this in your <a href="${appUrl}/dashboard">dashboard</a></p>
    </div>
  `, color);

  return resend.emails.send({
    from: FROM,
    to: business.email,
    subject: `📅 New booking request — ${booking.customer_name} · ${booking.service_name}`,
    html,
  });
}

// ── 3. BOOKING RECEIVED (sent to customer immediately) ──────
async function sendBookingReceivedToCustomer({ business, booking }) {
  const resend = getResend();
  const color = business.color || '#2D8EFF';

  const html = baseHtml(`
    <div class="header">
      <h1>Booking Request Received ✓</h1>
      <p>${business.name}</p>
    </div>
    <div class="body">
      <p>Hi ${booking.customer_name},</p>
      <p>We've received your booking request at <strong>${business.name}</strong>. The business will confirm shortly and you'll receive another email as soon as it's accepted.</p>
      <div class="detail-box">
        <div class="detail-row"><span class="detail-label">Service</span><span class="detail-val">${booking.service_name}</span></div>
        <div class="detail-row"><span class="detail-label">Date</span><span class="detail-val">${fmtDate(booking.booked_date)}</span></div>
        <div class="detail-row"><span class="detail-label">Time</span><span class="detail-val">${booking.booked_time}</span></div>
        <div class="detail-row"><span class="detail-label">Duration</span><span class="detail-val">${booking.duration_mins} mins</span></div>
        <div class="detail-row"><span class="detail-label">Price</span><span class="detail-val">£${parseFloat(booking.service_price).toFixed(2)}</span></div>
        <div class="detail-row"><span class="detail-label">Payment</span><span class="detail-val">${booking.payment_method === 'online' ? '💳 Online (once confirmed)' : '💵 At appointment'}</span></div>
        <div class="detail-row"><span class="detail-label">Status</span><span class="detail-val"><span class="status-badge" style="background:#fff3cd;color:#856404;">⏳ Awaiting Confirmation</span></span></div>
      </div>
      <p style="font-size:13px;color:#888;">Business address: ${business.address}</p>
    </div>
  `, color);

  return resend.emails.send({
    from: FROM,
    to: booking.customer_email,
    subject: `Booking request received — ${booking.service_name} at ${business.name}`,
    html,
  });
}

// ── 4. BOOKING CONFIRMED (sent to customer when business accepts) ──
async function sendBookingConfirmedToCustomer({ business, booking }) {
  const resend = getResend();
  const color = business.color || '#2D8EFF';
  const payOnline = booking.payment_method === 'online';

  const html = baseHtml(`
    <div class="header">
      <h1>Booking Confirmed! 🎉</h1>
      <p>${business.name}</p>
    </div>
    <div class="body">
      <p>Hi ${booking.customer_name},</p>
      <p>Great news — <strong>${business.name}</strong> has confirmed your booking!</p>
      <div class="detail-box">
        <div class="detail-row"><span class="detail-label">Service</span><span class="detail-val">${booking.service_name}</span></div>
        <div class="detail-row"><span class="detail-label">Date</span><span class="detail-val">${fmtDate(booking.booked_date)}</span></div>
        <div class="detail-row"><span class="detail-label">Time</span><span class="detail-val">${booking.booked_time}</span></div>
        <div class="detail-row"><span class="detail-label">Duration</span><span class="detail-val">${booking.duration_mins} mins</span></div>
        <div class="detail-row"><span class="detail-label">Price</span><span class="detail-val">£${parseFloat(booking.service_price).toFixed(2)}</span></div>
        <div class="detail-row"><span class="detail-label">Status</span><span class="detail-val"><span class="status-badge" style="background:#d4edda;color:#155724;">✓ Confirmed</span></span></div>
      </div>
      <p><strong>📍 Where to go:</strong><br>${business.address}</p>
      <p><strong>📞 Contact:</strong><br>${business.phone}</p>
      ${payOnline ? `
      <p style="text-align:center;margin-top:24px;">
        <a href="${process.env.APP_URL}/pay/${booking.id}" class="btn">💳 Complete Payment — £${parseFloat(booking.service_price).toFixed(2)}</a>
      </p>` : `
      <p style="background:#f8f8f8;padding:14px;border-radius:8px;font-size:14px;">💵 <strong>Payment at appointment</strong> — Please bring cash or card on the day.</p>`}
      <p style="font-size:13px;color:#888;margin-top:20px;">Need to cancel or reschedule? Please contact <a href="mailto:${business.email}">${business.email}</a> as soon as possible.</p>
    </div>
  `, color);

  return resend.emails.send({
    from: FROM,
    to: booking.customer_email,
    subject: `✅ Confirmed — ${booking.service_name} at ${business.name} on ${fmtDate(booking.booked_date)}`,
    html,
  });
}

// ── 5. BOOKING DECLINED (sent to customer) ─────────────────
async function sendBookingDeclinedToCustomer({ business, booking }) {
  const resend = getResend();
  const color = business.color || '#2D8EFF';

  const html = baseHtml(`
    <div class="header">
      <h1>Booking Update</h1>
      <p>${business.name}</p>
    </div>
    <div class="body">
      <p>Hi ${booking.customer_name},</p>
      <p>Unfortunately <strong>${business.name}</strong> is unable to take your booking for <strong>${booking.service_name}</strong> on <strong>${fmtDate(booking.booked_date)}</strong> at <strong>${booking.booked_time}</strong>.</p>
      <p>This may be due to availability. Please contact the business directly or try a different date:</p>
      <p style="text-align:center;margin-top:20px;">
        <a href="${process.env.APP_URL}/book/${business.slug}" class="btn">Try Another Date →</a>
      </p>
      <p style="font-size:13px;color:#888;">Contact: <a href="mailto:${business.email}">${business.email}</a> · ${business.phone}</p>
    </div>
  `, color);

  return resend.emails.send({
    from: FROM,
    to: booking.customer_email,
    subject: `Booking update — ${business.name}`,
    html,
  });
}

// ── 6. 24HR REMINDER (sent to customer) ────────────────────
async function sendBookingReminder({ business, booking }) {
  const resend = getResend();
  const color = business.color || '#2D8EFF';

  const html = baseHtml(`
    <div class="header">
      <h1>Reminder — Appointment Tomorrow 🔔</h1>
      <p>${business.name}</p>
    </div>
    <div class="body">
      <p>Hi ${booking.customer_name},</p>
      <p>Just a reminder that you have an appointment tomorrow!</p>
      <div class="detail-box">
        <div class="detail-row"><span class="detail-label">Service</span><span class="detail-val">${booking.service_name}</span></div>
        <div class="detail-row"><span class="detail-label">Date</span><span class="detail-val">${fmtDate(booking.booked_date)}</span></div>
        <div class="detail-row"><span class="detail-label">Time</span><span class="detail-val">${booking.booked_time}</span></div>
        <div class="detail-row"><span class="detail-label">Address</span><span class="detail-val">${business.address}</span></div>
      </div>
      <p style="font-size:13px;color:#888;">Need to reschedule? Contact <a href="mailto:${business.email}">${business.email}</a></p>
    </div>
  `, color);

  return resend.emails.send({
    from: FROM,
    to: booking.customer_email,
    subject: `Reminder — ${booking.service_name} at ${business.name} tomorrow`,
    html,
  });
}

module.exports = {
  sendBusinessWelcome,
  sendNewBookingToBusiness,
  sendBookingReceivedToCustomer,
  sendBookingConfirmedToCustomer,
  sendBookingDeclinedToCustomer,
  sendBookingReminder,
};
