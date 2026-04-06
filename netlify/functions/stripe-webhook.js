// netlify/functions/stripe-webhook.js
// Stripe sends events here after payment succeeds, fails, renews, or cancels
// Set up in Stripe Dashboard → Developers → Webhooks
// URL: https://showupbooking.netlify.app/webhooks/stripe
// Events to listen for:
//   invoice.payment_succeeded
//   invoice.payment_failed
//   customer.subscription.deleted
//   customer.subscription.updated

const Stripe = require('stripe');
const { getSupabaseAdmin } = require('./_supabase');
const { sendBusinessWelcome } = require('./_email');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (e) {
    console.error('Webhook signature verification failed:', e.message);
    return { statusCode: 400, body: `Webhook Error: ${e.message}` };
  }

  const supabase = getSupabaseAdmin();
  console.log('Stripe webhook event:', stripeEvent.type);

  try {
    switch (stripeEvent.type) {

      // ── PAYMENT SUCCEEDED ────────────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = stripeEvent.data.object;
        const customerId = invoice.customer;
        const subscriptionId = invoice.subscription;

        // Update business to active + live
        const { data: business, error } = await supabase
          .from('businesses')
          .update({
            stripe_status: 'active',
            is_live: true,
          })
          .eq('stripe_customer_id', customerId)
          .select()
          .single();

        if (error) {
          console.error('Failed to activate business:', error);
          break;
        }

        // Only send welcome email on FIRST payment (not renewals)
        // Check if this is the first invoice by looking at billing_reason
        if (invoice.billing_reason === 'subscription_create' && business) {
          // Get temp password from subscription metadata (set at creation)
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const tempPassword = subscription.metadata?.temp_password || '(check your signup email)';

          await sendBusinessWelcome({
            business,
            loginEmail: business.email,
            tempPassword,
          });
          console.log('Welcome email sent to:', business.email);
        }
        break;
      }

      // ── PAYMENT FAILED ───────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        await supabase
          .from('businesses')
          .update({ stripe_status: 'past_due' })
          .eq('stripe_customer_id', invoice.customer);
        // TODO: send payment failed email
        break;
      }

      // ── SUBSCRIPTION CANCELLED ───────────────────────────
      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object;
        await supabase
          .from('businesses')
          .update({ stripe_status: 'canceled', is_live: false })
          .eq('stripe_subscription_id', sub.id);
        // TODO: send cancellation email + 30-day data retention notice
        break;
      }

      // ── SUBSCRIPTION UPDATED (e.g. plan change) ──────────
      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object;
        const plan = sub.items.data[0]?.price?.id === process.env.STRIPE_PRICE_ANNUAL
          ? 'annual' : 'monthly';
        await supabase
          .from('businesses')
          .update({
            stripe_status: sub.status,
            stripe_plan: plan,
          })
          .eq('stripe_subscription_id', sub.id);
        break;
      }

      default:
        console.log('Unhandled event type:', stripeEvent.type);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (e) {
    console.error('Webhook handler error:', e);
    return { statusCode: 500, body: 'Internal error' };
  }
};
