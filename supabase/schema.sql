-- VoltVisuals — запустите в Supabase → SQL Editor → New query → Run

-- Профили (расширение auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  hwid TEXT,
  subscription_plan TEXT,
  subscription_expires TEXT,
  banned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx ON public.profiles (LOWER(username));
CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (email);

-- Ключи активации (коды хранятся только как hash)
CREATE TABLE IF NOT EXISTS public.activation_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT UNIQUE NOT NULL,
  plan_id TEXT NOT NULL,
  duration_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id),
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES public.profiles(id),
  key_expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_activation_keys_hash ON public.activation_keys (code_hash);

-- Сессии мода
CREATE TABLE IF NOT EXISTS public.mod_sessions (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  hwid TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mod_sessions_user ON public.mod_sessions (user_id);

-- Пароли регистрации (для админки, зашифрованы Edge Function)
CREATE TABLE IF NOT EXISTS public.registration_credentials (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  password_enc TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Логи скачиваний
CREATE TABLE IF NOT EXISTS public.download_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip TEXT
);

-- Автосоздание профиля при регистрации
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username TEXT;
BEGIN
  v_username := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'username'), ''), split_part(NEW.email, '@', 1));
  INSERT INTO public.profiles (id, username, email, role)
  VALUES (NEW.id, v_username, NEW.email, 'user');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Вход по нику: получить email (для signInWithPassword)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM public.profiles WHERE LOWER(username) = LOWER(TRIM(p_username)) LIMIT 1;
  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_email_by_username(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE LOWER(username) = LOWER(TRIM(p_username))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_username_available(TEXT) TO anon, authenticated;

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activation_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mod_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_logs ENABLE ROW LEVEL SECURITY;

-- Пользователь читает только свой профиль
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Админ читает все профили (через SECURITY DEFINER — без рекурсии RLS)
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Пользователь обновляет только свой hwid (опционально) — через Edge Function безопаснее, блокируем direct update
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()));

-- Ключи/мод-сессии/credentials — только service role (Edge Functions)
CREATE POLICY "deny_all_activation_keys" ON public.activation_keys FOR ALL TO authenticated, anon USING (false);
CREATE POLICY "deny_all_mod_sessions" ON public.mod_sessions FOR ALL TO authenticated, anon USING (false);
CREATE POLICY "deny_all_registration_credentials" ON public.registration_credentials FOR ALL TO authenticated, anon USING (false);
CREATE POLICY "deny_all_download_logs" ON public.download_logs FOR ALL TO authenticated, anon USING (false);

-- Storage: создайте bucket mod-releases (private) в Dashboard → Storage
-- Загрузите voltvisuals-1.6.1.jar в корень bucket

-- После регистрации админа выполните (замените email):
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'ваш@email.com';
