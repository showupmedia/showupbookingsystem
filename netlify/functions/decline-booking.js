// netlify/functions/decline-booking.js
const { getSupabaseAdmin, ok, err, options } = require('./_supabase');
const { sendBookingDeclinedToCustomer } = require('./_email');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const supabase = getSupabaseAdmin();

  const bookingId = event.httpMethod === 'GET'
    ? event.queryStringParameters?.id
    : JSON.parse(event.body || '{}').bookingId;

  if (!bookingId) return err('Missing booking ID');

  try {
    const { data: booking, error: bkErr } = await supabase
      .from('bookings')
      .select('*, businesses(*)')
      .eq('id', bookingId)
      .single();

    if (bkErr || !booking) return err('Booking not found', 404);

    await supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', bookingId);

    const business = booking.businesses;
    await sendBookingDeclinedToCustomer({ business, booking });

    if (event.httpMethod === 'GET') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Booking Declined — Show Up</title>
        <style>body{font-family:sans-serif;background:#f4f4f4;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
        .box{background:#fff;border-radius:12px;padding:48px 40px;max-width:460px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.1);}
        h1{font-size:1.5rem;color:#111;margin-bottom:12px;}p{color:#555;line-height:1.6;}
        a{display:inline-block;margin-top:24px;background:#111;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;}
        </style></head><body><div class="box">
          <div style="font-size:2.5rem;margin-bottom:16px;">❌</div>
          <h1>Booking Declined</h1>
          <p>The booking for <strong>${booking.customer_name}</strong> has been declined. They've been notified by email.</p>
          <a href="/dashboard">Back to Dashboard</a>
        </div></body></html>`,
      };
    }

    return ok({ success: true });

  } catch (e) {
    console.error('decline-booking error:', e);
    return err(e.message || 'Internal server error', 500);
  }
};
