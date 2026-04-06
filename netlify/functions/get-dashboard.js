// netlify/functions/get-dashboard.js
// Authenticated — returns all dashboard data for logged-in business owner

const { createClient } = require('@supabase/supabase-js');
const { getSupabaseAdmin, ok, err, options } = require('./_supabase');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();

  // ── Authenticate via Supabase JWT ─────────────────────────
  const authHeader = event.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return err('Unauthorised', 401);

  // Verify token with Supabase
  const supabaseUser = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
  const { data: { user }, error: userErr } = await supabaseUser.auth.getUser(token);
  if (userErr || !user) return err('Unauthorised', 401);

  const supabase = getSupabaseAdmin();

  try {
    // ── Load business ─────────────────────────────────────
    const { data: business, error: bizErr } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', user.id)
      .single();

    if (bizErr || !business) return err('Business not found', 404);

    // ── Load bookings (last 50, most recent first) ────────
    const { data: bookings } = await supabase
      .from('bookings')
      .select('*')
      .eq('business_id', business.id)
      .order('booked_date', { ascending: false })
      .order('booked_time', { ascending: false })
      .limit(50);

    // ── Load services ─────────────────────────────────────
    const { data: services } = await supabase
      .from('services')
      .select('*')
      .eq('business_id', business.id)
      .order('sort_order');

    // ── Load team ─────────────────────────────────────────
    const { data: team } = await supabase
      .from('team_members')
      .select('*')
      .eq('business_id', business.id);

    // ── Load availability ─────────────────────────────────
    const { data: availability } = await supabase
      .from('availability')
      .select('*')
      .eq('business_id', business.id);

    // ── Load customers ────────────────────────────────────
    const { data: customers } = await supabase
      .from('customers')
      .select('*')
      .eq('business_id', business.id)
      .order('created_at', { ascending: false })
      .limit(100);

    // ── Compute stats ─────────────────────────────────────
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

    const allBookings = bookings || [];
    const stats = {
      pending:        allBookings.filter(b => b.status === 'pending').length,
      confirmed:      allBookings.filter(b => b.status === 'confirmed').length,
      today:          allBookings.filter(b => b.booked_date === today).length,
      totalRevenue:   allBookings
                        .filter(b => b.payment_status === 'paid')
                        .reduce((s, b) => s + parseFloat(b.service_price), 0),
      monthRevenue:   allBookings
                        .filter(b => b.payment_status === 'paid' && b.booked_date >= monthStart)
                        .reduce((s, b) => s + parseFloat(b.service_price), 0),
      totalCustomers: (customers || []).length,
    };

    return ok({
      business,
      bookings: allBookings,
      services: services || [],
      team: team || [],
      availability: availability || [],
      customers: customers || [],
      stats,
    });

  } catch (e) {
    console.error('get-dashboard error:', e);
    return err('Internal server error', 500);
  }
};
