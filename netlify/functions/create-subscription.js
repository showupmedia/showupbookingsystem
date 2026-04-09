// netlify/functions/create-subscription.js
// Called from showup-onboarding.html when business owner pays
// Creates: Stripe customer + subscription, Supabase user + business record
// Sends: welcome email via Resend

const Stripe = require('stripe');
const { getSupabaseAdmin, ok, err, options } = require('./_supabase');
const { sendBusinessWelcome } = require('./_email');

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Create test account without Stripe payment - simplified version
async function createTestAccount(bizData, supabase) {
  try {
    console.log('Creating test account for:', bizData.email);
    
    // Generate test data without using external services
    const tempPassword = generatePassword();
    const businessId = 'test-' + Date.now();
    const slug = slugify(bizData.name) + '-' + Date.now().toString().slice(-4);
    
    console.log('Generated test data:', { businessId, slug });

    // Skip all database operations for testing - just return success
    return ok({
      businessId,
      slug,
      tempPassword,
      testMode: true,
      message: 'Test account created successfully! Database operations skipped for testing.',
      bizData: {
        name: bizData.name,
        email: bizData.email,
        type: bizData.type,
        color: bizData.color,
        services: bizData.services?.length || 0,
        team: bizData.team?.length || 0
      }
    });

  } catch (e) {
    console.error('createTestAccount error:', e);
    return err(e.message || 'Internal server error', 500);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = getSupabaseAdmin();

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return err('Invalid JSON');
  }

  const {
    plan,          // 'monthly' | 'annual' | 'test_free'
    cardNumber, cardExpiry, cardCvc, cardName,
    bizData,       // full business object from onboarding
    testMode = false
  } = body;

  // Validate 
  if (!plan || !bizData?.email || !bizData?.name) {
    return err('Missing required fields');
  }

  // Handle test mode - skip Stripe processing
  if (plan === 'test_free' || testMode) {
    return await createTestAccount(bizData, supabase);
  }

  const priceId = plan === 'annual'
    ? process.env.STRIPE_PRICE_ANNUAL
    : process.env.STRIPE_PRICE_MONTHLY;

  if (!priceId) return err('Stripe price not configured', 500);

  try {
    // ── 1. Create Stripe customer ─────────────────────────
    const customer = await stripe.customers.create({
      email: bizData.email,
      name: bizData.name,
      phone: bizData.phone,
      metadata: { business_name: bizData.name, plan },
    });

    // ── 2. Create payment method from card details ────────
    // In production, use Stripe.js on frontend to tokenise the card
    // and send paymentMethodId here instead of raw card details.
    // For now we create a subscription and return a client_secret
    // for the frontend to confirm with Stripe.js.

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: { business_name: bizData.name, plan },
    });

    const clientSecret = subscription.latest_invoice.payment_intent.client_secret;

    // ── 3. Create Supabase auth user ──────────────────────
    const tempPassword = generatePassword();
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: bizData.email,
      password: tempPassword,
      email_confirm: true,
    });

    if (authError && !authError.message.includes('already registered')) {
      console.error('Auth error:', authError);
      return err('Failed to create account: ' + authError.message, 500);
    }

    const userId = authData?.user?.id;

    // ── 4. Generate unique slug ───────────────────────────
    let slug = slugify(bizData.name);
    const { data: existing } = await supabase
      .from('businesses')
      .select('slug')
      .eq('slug', slug)
      .single();
    if (existing) slug = slug + '-' + Date.now().toString().slice(-4);

    // ── 5. Insert business record ─────────────────────────
    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .insert({
        owner_id: userId,
        name: bizData.name,
        type: bizData.type,
        slug,
        welcome_msg: bizData.welcomeMsg || null,
        color: bizData.color,
        logo_url: bizData.logo || null,
        email: bizData.email,
        phone: bizData.phone,
        address: bizData.address,
        website: bizData.website || null,
        advance_weeks: parseInt(bizData.advance) || 2,
        stripe_customer_id: customer.id,
        stripe_subscription_id: subscription.id,
        stripe_plan: plan,
        stripe_status: 'incomplete', // becomes 'active' via webhook
        is_live: false,              // becomes true via webhook
      })
      .select()
      .single();

    if (bizError) {
      console.error('Business insert error:', bizError);
      return err('Failed to save business: ' + bizError.message, 500);
    }

    // ── 6. Insert services ────────────────────────────────
    if (bizData.services?.length) {
      const svcRows = bizData.services.map((s, i) => ({
        business_id: business.id,
        name: s.name,
        description: s.desc || null,
        duration_mins: s.duration,
        price: s.price,
        sort_order: i,
      }));
      await supabase.from('services').insert(svcRows);
    }

    // ── 7. Insert team members ────────────────────────────
    if (bizData.team?.length) {
      const teamRows = bizData.team.map(t => ({
        business_id: business.id,
        name: t.name,
        role: t.role || null,
      }));
      await supabase.from('team_members').insert(teamRows);
    }

    // ── 8. Insert availability ────────────────────────────
    if (bizData.hours) {
      const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
      const availRows = days.map(day => ({
        business_id: business.id,
        day_of_week: day,
        is_open: bizData.hours[day]?.o ?? false,
        open_time: bizData.hours[day]?.s || '09:00',
        close_time: bizData.hours[day]?.e || '17:00',
      }));
      await supabase.from('availability').insert(availRows);
    }

    // ── 9. Return client_secret so frontend confirms payment ──
    // Welcome email is sent by the stripe-webhook after payment succeeds
    return ok({
      clientSecret,
      subscriptionId: subscription.id,
      businessId: business.id,
      slug,
      tempPassword, // shown to user in success screen
    });

  } catch (e) {
    console.error('create-subscription error:', e);
    return err(e.message || 'Internal server error', 500);
  }
};
