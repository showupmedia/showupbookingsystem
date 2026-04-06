-- ============================================================
-- SHOW UP — SUPABASE SCHEMA
-- Paste this entire file into Supabase → SQL Editor → Run
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- BUSINESSES
-- ============================================================
CREATE TABLE businesses (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id                UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  name                    TEXT NOT NULL,
  type                    TEXT NOT NULL,
  slug                    TEXT UNIQUE NOT NULL,
  welcome_msg             TEXT,

  color                   TEXT DEFAULT '#2D8EFF',
  logo_url                TEXT,

  email                   TEXT NOT NULL,
  phone                   TEXT NOT NULL,
  address                 TEXT NOT NULL,
  website                 TEXT,

  advance_weeks           INT DEFAULT 2,

  stripe_customer_id      TEXT UNIQUE,
  stripe_subscription_id  TEXT UNIQUE,
  stripe_plan             TEXT CHECK (stripe_plan IN ('monthly','annual')),
  stripe_status           TEXT DEFAULT 'incomplete',

  stripe_connect_id       TEXT,
  stripe_connect_active   BOOLEAN DEFAULT FALSE,

  is_live                 BOOLEAN DEFAULT FALSE,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER businesses_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SERVICES
-- ============================================================
CREATE TABLE services (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  duration_mins INT NOT NULL,
  price         NUMERIC(10,2) NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TEAM MEMBERS
-- ============================================================
CREATE TABLE team_members (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  role          TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AVAILABILITY
-- ============================================================
CREATE TABLE availability (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day_of_week   TEXT NOT NULL CHECK (day_of_week IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  is_open       BOOLEAN DEFAULT TRUE,
  open_time     TIME DEFAULT '09:00',
  close_time    TIME DEFAULT '17:00',
  UNIQUE (business_id, day_of_week)
);

-- ============================================================
-- CUSTOMERS
-- People who book with a business
-- ============================================================
CREATE TABLE customers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  notes         TEXT,
  total_bookings INT DEFAULT 0,
  total_spent   NUMERIC(10,2) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (business_id, email)
);

-- ============================================================
-- BOOKINGS
-- ============================================================
CREATE TABLE bookings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id     UUID REFERENCES customers(id),
  service_id      UUID REFERENCES services(id),
  team_member_id  UUID REFERENCES team_members(id),

  -- Customer snapshot (in case they're not in customers table yet)
  customer_name   TEXT NOT NULL,
  customer_email  TEXT NOT NULL,
  customer_phone  TEXT,
  customer_notes  TEXT,

  -- Booking details
  service_name    TEXT NOT NULL,
  service_price   NUMERIC(10,2) NOT NULL,
  duration_mins   INT NOT NULL,
  booked_date     DATE NOT NULL,
  booked_time     TIME NOT NULL,

  -- Status flow: pending → confirmed → completed | cancelled
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','completed','cancelled','no_show')),

  -- Payment
  payment_method  TEXT CHECK (payment_method IN ('online','at_appointment')),
  payment_status  TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded')),
  stripe_payment_intent_id TEXT,

  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- Businesses can only see their own data
-- ============================================================
ALTER TABLE businesses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE services      ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability  ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings      ENABLE ROW LEVEL SECURITY;

-- Businesses: owner sees only their own
CREATE POLICY "owner_access" ON businesses
  FOR ALL USING (owner_id = auth.uid());

-- Services: owner sees only their business's
CREATE POLICY "owner_access" ON services
  FOR ALL USING (
    business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  );

CREATE POLICY "owner_access" ON team_members
  FOR ALL USING (
    business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  );

CREATE POLICY "owner_access" ON availability
  FOR ALL USING (
    business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  );

CREATE POLICY "owner_access" ON customers
  FOR ALL USING (
    business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  );

CREATE POLICY "owner_access" ON bookings
  FOR ALL USING (
    business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  );

-- Public can READ availability and services for a live business (for booking page)
CREATE POLICY "public_read_services" ON services
  FOR SELECT USING (
    business_id IN (SELECT id FROM businesses WHERE is_live = TRUE)
  );

CREATE POLICY "public_read_availability" ON availability
  FOR SELECT USING (
    business_id IN (SELECT id FROM businesses WHERE is_live = TRUE)
  );

CREATE POLICY "public_read_team" ON team_members
  FOR SELECT USING (
    business_id IN (SELECT id FROM businesses WHERE is_live = TRUE)
    AND is_active = TRUE
  );

-- Public can INSERT a booking (customer submitting)
CREATE POLICY "public_insert_booking" ON bookings
  FOR INSERT WITH CHECK (
    business_id IN (SELECT id FROM businesses WHERE is_live = TRUE)
  );

-- Public can INSERT a customer record
CREATE POLICY "public_insert_customer" ON customers
  FOR INSERT WITH CHECK (
    business_id IN (SELECT id FROM businesses WHERE is_live = TRUE)
  );

-- ============================================================
-- USEFUL VIEWS
-- ============================================================

-- Dashboard summary per business
CREATE VIEW booking_stats AS
SELECT
  b.id AS business_id,
  COUNT(*) FILTER (WHERE bk.status = 'pending')   AS pending_count,
  COUNT(*) FILTER (WHERE bk.status = 'confirmed') AS confirmed_count,
  COUNT(*) FILTER (WHERE bk.status = 'completed') AS completed_count,
  COUNT(*) FILTER (WHERE bk.booked_date = CURRENT_DATE) AS today_count,
  SUM(bk.service_price) FILTER (WHERE bk.payment_status = 'paid') AS total_revenue,
  SUM(bk.service_price) FILTER (
    WHERE bk.payment_status = 'paid'
    AND DATE_TRUNC('month', bk.created_at) = DATE_TRUNC('month', NOW())
  ) AS monthly_revenue
FROM businesses b
LEFT JOIN bookings bk ON bk.business_id = b.id
GROUP BY b.id;

-- ============================================================
-- STRIPE PRODUCTS — Create these in Stripe Dashboard
-- or via the Stripe CLI:
--
--   stripe products create --name="Show Up Monthly"
--   stripe prices create --product=prod_xxx --unit-amount=1500 \
--     --currency=gbp --recurring-interval=month
--
--   stripe products create --name="Show Up Annual"
--   stripe prices create --product=prod_xxx --unit-amount=9900 \
--     --currency=gbp --recurring-interval=year
--
-- Then paste the price IDs into your .env file.
-- ============================================================
