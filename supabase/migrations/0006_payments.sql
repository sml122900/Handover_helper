-- Phase 2-1 결제: payments 테이블 + projects.plan 컬럼

-- projects에 plan 추가 (free|paid, 기본 free)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free', 'paid'));

-- 결제 내역 테이블
CREATE TABLE IF NOT EXISTS payments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       TEXT        NOT NULL UNIQUE,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id     UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  amount         INTEGER     NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'failed')),
  payment_key    TEXT,
  toss_response  JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS payments_user_id_idx    ON payments(user_id);
CREATE INDEX IF NOT EXISTS payments_project_id_idx ON payments(project_id);
CREATE INDEX IF NOT EXISTS payments_order_id_idx   ON payments(order_id);

-- RLS: 본인 결제만 SELECT. INSERT/UPDATE는 service_role(서버 액션)만
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_select_own" ON payments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

