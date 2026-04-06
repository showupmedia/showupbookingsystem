// netlify/functions/accept-booking.js
// Business clicks "Accept" in email or dashboard
// Updates booking to confirmed, emails customer

const { getSupabaseAdmin, ok, err, options } = require('./_supabase');
const { sendBookingConfirmedToCustomer } = require('./_email');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const supabase = getSupabaseAdmin();

  // Support both GET (email link) and POST (dashboard button)
  const bookingId = event.httpMethod === 'GET'
    ? event.queryStringParameters?.id
    : JSON.parse(event.body || '{}').bookingId;

  if (!bookingId) return err('Missing booking ID');

  try {
    // ── 1. Get booking + business ─────────────────────────
    const { data: booking, error: bkErr } = await supabase
      .from('bookings')
      .select('*, businesses(*)')
      .eq('id', bookingId)
      .single();

    if (bkErr || !booking) return err('Booking not found', 404);
    if (booking.status === 'confirmed') {
      // Already confirmed — if GET request, show friendly page
      if (event.httpMethod === 'GET') {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: successPage('Already Confirmed', 'This booking was already confirmed.', booking.businesses?.color),
        };
      }
      return ok({ message: 'Already confirmed' });
    }

    // ── 2. Update to confirmed ────────────────────────────
    await supabase
      .from('bookings')
      .update({ status: 'confirmed' })
      .eq('id', bookingId);

    // ── 3. Update customer stats ──────────────────────────
    if (booking.customer_id) {
      await supabase.rpc('increment_customer_stats', {
        p_customer_id: booking.customer_id,
        p_amount: booking.service_price,
      }).catch(() => {}); // non-critical
    }

    // ── 4. Send confirmation email to customer ────────────
    const business = booking.businesses;
    await sendBookingConfirmedToCustomer({ business, booking });

    // ── 5. Return response ────────────────────────────────
    if (event.httpMethod === 'GET') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: successPage(
          '✓ Booking Accepted',
          `You've confirmed the booking for <strong>${booking.customer_name}</strong> — ${booking.service_name} on ${booking.booked_date} at ${booking.booked_time}. A confirmation email has been sent to the customer.`,
          business?.color
        ),
      };
    }

    return ok({ success: true, bookingId });

  } catch (e) {
    console.error('accept-booking error:', e);
    return err(e.message || 'Internal server error', 500);
  }
};

function successPage(title, message, color = '#2D8EFF') {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>${title} — Show Up</title>
  <style>body{font-family:sans-serif;background:#f4f4f4;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
  .box{background:#fff;border-radius:12px;padding:48px 40px;max-width:460px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.1);}
  .icon{font-size:3rem;margin-bottom:16px;}
  h1{font-size:1.6rem;color:#111;margin-bottom:12px;}
  p{color:#555;line-height:1.6;font-size:0.95rem;}
  a{display:inline-block;margin-top:24px;background:${color};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;}
  </style></head>
  <body><div class="box">
    <div class="icon">✅</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/dashboard">Go to Dashboard</a>
  </div></body></html>`;
}
