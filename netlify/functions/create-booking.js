// netlify/functions/create-booking.js
// Called from showup-booking.html when a customer submits their booking
// Saves booking to Supabase, emails both customer and business owner

const { getSupabaseAdmin, ok, err, options } = require('./_supabase');
const {
  sendNewBookingToBusiness,
  sendBookingReceivedToCustomer,
} = require('./_email');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

  const supabase = getSupabaseAdmin();

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return err('Invalid JSON');
  }

  const {
    businessSlug,
    serviceId,
    teamMemberId,
    customerName,
    customerEmail,
    customerPhone,
    customerNotes,
    bookedDate,     // 'YYYY-MM-DD'
    bookedTime,     // 'HH:MM'
    paymentMethod,  // 'online' | 'at_appointment'
  } = body;

  // ── Validate required fields ──────────────────────────────
  if (!businessSlug || !customerName || !customerEmail || !bookedDate || !bookedTime || !serviceId) {
    return err('Missing required booking fields');
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(customerEmail)) return err('Invalid email address');

  try {
    // ── 1. Look up business ───────────────────────────────
    const { data: business, error: bizErr } = await supabase
      .from('businesses')
      .select('*')
      .eq('slug', businessSlug)
      .eq('is_live', true)
      .single();

    if (bizErr || !business) return err('Business not found or not active', 404);

    // ── 2. Look up service ────────────────────────────────
    const { data: service, error: svcErr } = await supabase
      .from('services')
      .select('*')
      .eq('id', serviceId)
      .eq('business_id', business.id)
      .eq('is_active', true)
      .single();

    if (svcErr || !service) return err('Service not found', 404);

    // ── 3. Check for double-booking at same time ──────────
    const { data: clash } = await supabase
      .from('bookings')
      .select('id')
      .eq('business_id', business.id)
      .eq('booked_date', bookedDate)
      .eq('booked_time', bookedTime)
      .in('status', ['pending', 'confirmed'])
      .single();

    if (clash) return err('That time slot is no longer available. Please choose another time.', 409);

    // ── 4. Upsert customer record ─────────────────────────
    const { data: customer } = await supabase
      .from('customers')
      .upsert(
        {
          business_id: business.id,
          name: customerName,
          email: customerEmail,
          phone: customerPhone || null,
          notes: customerNotes || null,
        },
        { onConflict: 'business_id,email', ignoreDuplicates: false }
      )
      .select()
      .single();

    // ── 5. Create booking record ──────────────────────────
    const { data: booking, error: bkErr } = await supabase
      .from('bookings')
      .insert({
        business_id: business.id,
        customer_id: customer?.id || null,
        service_id: serviceId,
        team_member_id: teamMemberId || null,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone || null,
        customer_notes: customerNotes || null,
        service_name: service.name,
        service_price: service.price,
        duration_mins: service.duration_mins,
        booked_date: bookedDate,
        booked_time: bookedTime,
        status: 'pending',
        payment_method: paymentMethod || 'at_appointment',
        payment_status: 'unpaid',
      })
      .select()
      .single();

    if (bkErr) {
      console.error('Booking insert error:', bkErr);
      return err('Failed to save booking', 500);
    }

    // ── 6. Send emails concurrently ───────────────────────
    await Promise.allSettled([
      sendNewBookingToBusiness({ business, booking }),
      sendBookingReceivedToCustomer({ business, booking }),
    ]);

    return ok({
      bookingId: booking.id,
      status: 'pending',
      message: 'Booking request submitted. You will receive a confirmation email shortly.',
    });

  } catch (e) {
    console.error('create-booking error:', e);
    return err(e.message || 'Internal server error', 500);
  }
};
