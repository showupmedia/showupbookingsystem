# Show Up — Full Backend Setup Guide

Complete instructions to go from zero to live on Netlify with Stripe, Supabase, and Resend.

---

## What This Gives You

When a business owner completes onboarding and pays:
1. ✅ Stripe subscription created (£15/mo or £99/yr recurring)
2. ✅ Supabase account + business record created automatically  
3. ✅ Welcome email sent via Resend with login credentials
4. ✅ Business goes live at `showup.io/book/their-slug`
5. ✅ Customers can book → business gets email → accepts/declines
6. ✅ Customer gets confirmed email with appointment details
7. ✅ Payment options: online (Stripe) or at appointment

---

## File Structure

```
showup/
├── netlify.toml                        # Netlify config + redirects
├── package.json                        # Dependencies
├── .env.example                        # All env vars (copy to .env locally)
├── supabase-schema.sql                 # Run this in Supabase SQL editor
│
├── netlify/functions/
│   ├── _supabase.js                    # Shared Supabase client + helpers
│   ├── _email.js                       # All Resend email templates
│   ├── create-subscription.js          # Business pays → account created
│   ├── stripe-webhook.js               # Stripe events → activate account
│   ├── create-booking.js               # Customer submits booking
│   ├── accept-booking.js               # Business accepts → confirm email
│   ├── decline-booking.js              # Business declines → notify customer
│   ├── get-business.js                 # Public: load business for booking page
│   └── get-dashboard.js                # Auth: load all dashboard data
│
└── public/
    ├── showup-landing.html             # Marketing page
    ├── showup-onboarding.html          # Business setup wizard
    ├── showup-booking.html             # Customer booking page
    ├── showup-dashboard.html           # Business dashboard
    └── showup-login.html               # Business login
```

---

## Step 1 — Supabase Setup

1. Go to [supabase.com](https://supabase.com) and open your project
2. Click **SQL Editor** in the left sidebar
3. Paste the entire contents of `supabase-schema.sql` and click **Run**
4. Go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ Keep this secret

---

## Step 2 — Stripe Setup

### Create your products

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Products**
2. Click **Add product** → Name: `Show Up Monthly`
   - Price: £15.00 / month / recurring
   - Copy the **Price ID** (starts with `price_`) → `STRIPE_PRICE_MONTHLY`
3. Click **Add product** → Name: `Show Up Annual`
   - Price: £99.00 / year / recurring
   - Copy the **Price ID** → `STRIPE_PRICE_ANNUAL`

### Set up webhook

1. Go to **Developers → Webhooks → Add endpoint**
2. URL: `https://showupbooking.netlify.app/webhooks/stripe`
3. Select events:
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
4. Copy the **Webhook signing secret** → `STRIPE_WEBHOOK_SECRET`

### Get your API keys

Go to **Developers → API keys** and copy:
- **Publishable key** → `STRIPE_PUBLISHABLE_KEY`
- **Secret key** → `STRIPE_SECRET_KEY`

---

## Step 3 — Resend Setup

1. Go to [resend.com](https://resend.com) and open your account
2. Go to **API Keys** → copy your key → `RESEND_API_KEY`
3. Make sure `hello@showupmedia.org` is verified under **Domains**

---

## Step 4 — Local Development

```bash
# Install dependencies
npm install

# Copy env file
cp .env.example .env
# Fill in all values in .env

# Start local dev server (runs functions + frontend)
npx netlify dev
```

Visit `http://localhost:8888`

---

## Step 5 — Deploy to Netlify

### Option A — Netlify CLI
```bash
npm install -g netlify-cli
netlify login
netlify init         # Link to your Netlify site
netlify deploy --prod
```

### Option B — GitHub (recommended)
1. Push this folder to a GitHub repo
2. In Netlify → **Add new site → Import from GitHub**
3. Select your repo, build settings auto-detect from `netlify.toml`
4. Click **Deploy**

### Add environment variables to Netlify
1. Netlify → Site → **Site configuration → Environment variables**
2. Add every variable from `.env.example` with your real values
3. Redeploy after adding variables

---

## Step 6 — Wire Up the HTML Files

### showup-onboarding.html
Replace the `processPayment()` function to call the real API:

```javascript
async function processPayment() {
  const btn = document.getElementById('payBtn');
  btn.disabled = true;
  document.getElementById('pay-btn-text').textContent = 'Processing...';

  try {
    // 1. Create subscription + get Stripe client_secret
    const res = await fetch('/api/create-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: currentPlan,
        bizData: biz,
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // 2. Confirm payment with Stripe.js
    const stripe = Stripe('YOUR_STRIPE_PUBLISHABLE_KEY');
    const { error } = await stripe.confirmCardPayment(data.clientSecret, {
      payment_method: {
        card: cardElement, // Stripe Elements card
        billing_details: { name: biz.name, email: biz.email }
      }
    });
    if (error) throw new Error(error.message);

    // 3. Show success
    document.getElementById('successUrl').textContent =
      `showup.io/book/${data.slug}`;
    document.getElementById('paymentModal').classList.remove('show');
    document.getElementById('successScreen').classList.add('show');

  } catch (e) {
    document.getElementById('card-errors').textContent = e.message;
    btn.disabled = false;
    document.getElementById('pay-btn-text').textContent = 'Try Again';
  }
}
```

### showup-booking.html
Replace `submitBooking()`:

```javascript
async function submitBooking() {
  const btn = document.getElementById('submitBookingBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  // Get slug from URL: /book/my-business-slug
  const slug = window.location.pathname.split('/book/')[1]
    || new URLSearchParams(window.location.search).get('slug');

  try {
    const res = await fetch('/api/create-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessSlug: slug,
        serviceId: selectedServiceId,  // from your selection state
        teamMemberId: selectedStaffId || null,
        customerName: document.getElementById('clientName').value,
        customerEmail: document.getElementById('clientEmail').value,
        customerPhone: document.getElementById('clientPhone').value,
        customerNotes: document.getElementById('clientNotes').value,
        bookedDate: selectedDate,      // 'YYYY-MM-DD'
        bookedTime: selectedTime,      // 'HH:MM'
        paymentMethod: document.querySelector('[name=paymentMethod]:checked').value,
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Show confirmation panel
    goPanel(5);
  } catch (e) {
    alert('Booking failed: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Submit Booking Request';
  }
}
```

### showup-dashboard.html
Load real data on page load:

```javascript
// Add to top of dashboard script
async function loadDashboard() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = '/showup-login.html'; return; }

  const res = await fetch('/api/get-dashboard', {
    headers: { 'Authorization': 'Bearer ' + session.access_token }
  });
  const data = await res.json();

  // Populate all dashboard elements with data.business, data.bookings, data.stats, etc.
  document.querySelector('.sb-biz-name').textContent = data.business.name;
  // ... etc
}

document.addEventListener('DOMContentLoaded', loadDashboard);
```

### showup-login.html
Replace the placeholder values:
```javascript
const SUPABASE_URL = 'https://xxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';
```

---

## Email Flow Summary

| Event | Who gets email |
|-------|---------------|
| Business pays | Business owner → welcome + login credentials |
| Customer books | Customer → "request received" · Business → "new booking" with accept/decline buttons |
| Business accepts | Customer → "confirmed" with address + payment info |
| Business declines | Customer → "unavailable" with link to rebook |
| 24hrs before | Customer → reminder (set up as a Netlify scheduled function) |

---

## Test Stripe Cards

| Card | Number |
|------|--------|
| Visa (success) | 4242 4242 4242 4242 |
| Card declined | 4000 0000 0000 0002 |
| Requires auth | 4000 0025 0000 3155 |

Expiry: any future date · CVC: any 3 digits

---

## API Endpoints

| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| POST | `/api/create-subscription` | None | Business signup + payment |
| POST | `/webhooks/stripe` | Stripe sig | Stripe events |
| POST | `/api/create-booking` | None | Customer books |
| GET/POST | `/api/accept-booking?id=xxx` | None* | Accept booking |
| GET/POST | `/api/decline-booking?id=xxx` | None* | Decline booking |
| GET | `/api/get-business?slug=xxx` | None | Load business for booking page |
| GET | `/api/get-dashboard` | JWT | Load dashboard data |

*Accept/decline use booking ID as token — add proper auth in production

---

## Next Steps (after going live)

1. **Stripe Connect** — let businesses take online payments from customers
2. **24hr reminder emails** — Netlify scheduled function (`schedule` in netlify.toml)
3. **Calendar sync** — Google Calendar API on booking confirmation
4. **Password change** — force password change after first login
5. **Custom domains** — `book.yourbusiness.com` pointing to Show Up
