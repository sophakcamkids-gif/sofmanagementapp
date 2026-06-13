-- =====================================================================================
-- SUPABASE POSTGRESQL SCHEMA FOR SAVINGS & LOAN MANAGEMENT SYSTEM 
-- ប្រព័ន្ធគ្រប់គ្រងប្រាក់សន្សំ និងកម្ចី
-- =====================================================================================

-- 1. Enable UUID Extension (Supabase requires this for UUID generation)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- TABLE: members (បញ្ជីសមាជិក)
-- ==========================================
CREATE TABLE members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Link to Supabase Auth system
    member_code VARCHAR(50) UNIQUE NOT NULL, -- លេខកូដសមាជិក (ex: MEM-001)
    full_name VARCHAR(100) NOT NULL, -- ឈ្មោះពេញ
    phone VARCHAR(20), -- លេខទូរស័ព្ទ
    email VARCHAR(100), -- អ៊ីមែល
    role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('admin', 'member')), -- តួនាទី
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')), -- ស្ថានភាព
    join_date DATE DEFAULT CURRENT_DATE, -- ថ្ងៃចូលជាសមាជិក
    avatar_url TEXT, -- រូបថតប្រវត្តិរូប
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================
-- TABLE: savings (ប្រាក់សន្សំ)
-- ==========================================
CREATE TABLE savings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE, -- ថ្ងៃបង់ប្រាក់
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0), -- ចំនួនទឹកប្រាក់
    savings_category VARCHAR(50) NOT NULL, -- ប្រភេទសន្សំ (ប្រចាំខែ, ស្ម័គ្រចិត្ត, ភាគហ៊ុន)
    description TEXT, -- បរិយាយ
    status VARCHAR(20) DEFAULT 'completed', -- completed, pending, cancelled
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================
-- TABLE: loans (ប្រាក់កម្ចី)
-- ==========================================
CREATE TABLE loans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    loan_code VARCHAR(50) UNIQUE, -- លេខកូដកម្ចី
    principal_amount NUMERIC(15, 2) NOT NULL CHECK (principal_amount > 0), -- ប្រាក់ដើម
    interest_rate_percent NUMERIC(5, 2) NOT NULL, -- អត្រាការប្រាក់ (%)
    duration_months INTEGER NOT NULL CHECK (duration_months > 0), -- រយៈពេលកម្ចី (ខែ)
    start_date DATE NOT NULL, -- ថ្ងៃចាប់ផ្តើម
    end_date DATE, -- ថ្ងៃបញ្ចប់ការសង
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('pending', 'active', 'paid', 'defaulted')), -- ស្ថានភាព
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================
-- TABLE: loan_repayments (ការសងប្រាក់កម្ចីប្រចាំខែ)
-- ==========================================
CREATE TABLE loan_repayments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    repayment_date DATE NOT NULL DEFAULT CURRENT_DATE, -- ថ្ងៃបង់ប្រាក់
    principal_paid NUMERIC(15, 2) DEFAULT 0, -- ប្រាក់ដើមដែលបានបង់
    interest_paid NUMERIC(15, 2) DEFAULT 0, -- ការប្រាក់ដែលបានបង់
    penalty_paid NUMERIC(15, 2) DEFAULT 0, -- ប្រាក់ផាកពិន័យដែលបានបង់
    total_paid NUMERIC(15, 2) GENERATED ALWAYS AS (principal_paid + interest_paid + penalty_paid) STORED, -- សរុបប្រាក់បានបង់
    receipt_number VARCHAR(50), -- លេខវិក្កយបត្រ
    notes TEXT, -- ចំណាំ
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================
-- TABLE: expenses (ការចំណាយផ្សេងៗ)
-- ==========================================
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE, -- ថ្ងៃខែចំណាយ
    supplier_name VARCHAR(100), -- អ្នកផ្គត់ផ្គង់ / ស្ថាប័ន
    category VARCHAR(100) NOT NULL, -- ប្រភេទចំណាយ (ចំណាយប្រតិបត្តិការ, ទុនសង្គម, ...)
    description TEXT NOT NULL, -- មុខចំណាយ / ពិពណ៌នា
    quantity NUMERIC(10, 2) DEFAULT 1, -- ចំនួនឯកតា
    unit_price NUMERIC(15, 2) DEFAULT 0, -- តម្លៃឯកតា
    total_amount NUMERIC(15, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED, -- សរុបចំណាយ
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================
-- TABLE: system_settings (ការកំណត់ប្រព័ន្ធ)
-- ==========================================
CREATE TABLE system_settings (
    setting_key VARCHAR(50) PRIMARY KEY, -- ឈ្មោះការកំណត់ (ex: system_interest_rate, telegram_alerts)
    setting_value TEXT NOT NULL, -- តម្លៃ
    description TEXT, -- ពិពណ៌នាពីមុខងារ
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================
-- TABLE: app_state (key/value cloud cache for the live app)
-- Mirrors the browser LocalStorage so data syncs across devices.
-- Used by src/lib/cloudStore.ts (loadAllCloudState / saveCloudState).
-- ==========================================
CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,                -- LocalStorage key (ex: sof_live_profile_data)
    value JSONB NOT NULL,                -- the stored JSON value
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- The app talks to Supabase with the anon key (no Supabase Auth login), so the
-- anon role needs full access to this table. Acceptable for an internal admin tool.
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon full access - app_state" ON app_state;
CREATE POLICY "Allow anon full access - app_state" ON app_state FOR ALL TO anon USING (true) WITH CHECK (true);

-- =====================================================================================
-- ROW LEVEL SECURITY (RLS) - SUPABASE BEST PRACTICES
-- =====================================================================================

-- Turn on RLS for all tables to ensure data safety
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Default Policies (Allow anyone authenticated to read, but you can restrict further later)
CREATE POLICY "Allow authenticated read - members" ON members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read - savings" ON savings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read - loans" ON loans FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read - loan_repayments" ON loan_repayments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read - expenses" ON expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read - settings" ON system_settings FOR SELECT TO authenticated USING (true);

-- =====================================================================================
-- AUTO_UPDATE TRIGGER FOR 'updated_at' COLUMNS
-- =====================================================================================

-- Create reusable trigger function for assigning updated_at on modify
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = extract(epoch from now());
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to tables
CREATE TRIGGER set_timestamp_members BEFORE UPDATE ON members FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER set_timestamp_savings BEFORE UPDATE ON savings FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER set_timestamp_loans BEFORE UPDATE ON loans FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER set_timestamp_expenses BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER set_timestamp_settings BEFORE UPDATE ON system_settings FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
