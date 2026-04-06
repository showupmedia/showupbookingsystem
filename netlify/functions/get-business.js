// netlify/functions/get-business.js
// Public endpoint — loads business data by slug for the booking page
// Also used by dashboard (authenticated)

const { getSupabaseAdmin, ok, err, options } = require('./_supabase');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();

  const supabase = getSupabaseAdmin();
  const slug = event.queryStringParameters?.slug;

  if (!slug) return err('Missing slug');

  try {
    const { data: business, error } = await supabase
      .from('businesses')
      .select('id, name, type, slug, welcome_msg, color, logo_url, address, phone, email, website, advance_weeks, is_live')
      .eq('slug', slug)
      .eq('is_live', true)
      .single();

    if (error || !business) return err('Business not found', 404);

    // Load services
    const { data: services } = await supabase
      .from('services')
      .select('id, name, description, duration_mins, price')
      .eq('business_id', business.id)
      .eq('is_active', true)
      .order('sort_order');

    // Load team
    const { data: team } = await supabase
      .from('team_members')
      .select('id, name, role')
      .eq('business_id', business.id)
      .eq('is_active', true);

    // Load availability
    const { data: availability } = await supabase
      .from('availability')
      .select('day_of_week, is_open, open_time, close_time')
      .eq('business_id', business.id);

    return ok({ business, services: services || [], team: team || [], availability: availability || [] });

  } catch (e) {
    console.error('get-business error:', e);
    return err('Internal server error', 500);
  }
};
