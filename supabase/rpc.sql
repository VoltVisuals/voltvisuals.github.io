-- VoltVisuals RPC — выполните в SQL Editor после schema.sql
-- (Dashboard → SQL → New query → Run)

-- Фикс RLS (если schema.sql уже был без is_admin)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
CREATE POLICY "profiles_select_admin" ON public.profiles FOR SELECT TO authenticated USING (public.is_admin());

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.volt_key_sig(p_payload TEXT, p_secret TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT upper(substr(
    encode(extensions.hmac(p_payload::bytea, p_secret::bytea, 'sha256'::text), 'hex'),
    1, 8
  ));
$$;

CREATE OR REPLACE FUNCTION public.volt_sha256_hex(p_text TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT encode(extensions.digest(p_text::bytea, 'sha256'::text), 'hex');
$$;

CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO app_config (key, value) VALUES
  ('volt_hmac_secret', 'volt_hmac_8f3k2m9x7q1w4e6r5t0y'),
  ('volt_mod_key', 'Vv7K#m0dR3sp')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION public.cfg(p_key TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT value FROM app_config WHERE key = p_key LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.sub_active(p_expires TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_expires IS NULL OR p_expires = '' THEN RETURN FALSE; END IF;
  IF p_expires = 'lifetime' THEN RETURN TRUE; END IF;
  RETURN p_expires::timestamptz > NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.add_subscription_time(p_plan TEXT, p_minutes INT, p_user profiles)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE base TIMESTAMPTZ; result TIMESTAMPTZ;
BEGIN
  IF p_plan = 'lifetime' THEN RETURN 'lifetime'; END IF;
  IF public.sub_active(p_user.subscription_expires) AND p_user.subscription_expires <> 'lifetime' THEN
    base := p_user.subscription_expires::timestamptz;
  ELSE
    base := NOW();
  END IF;
  result := base + (COALESCE(p_minutes, 43200) || ' minutes')::interval;
  RETURN result::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_activation_key(p_code TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_norm TEXT; v_match TEXT[]; v_plan_code TEXT; v_random TEXT; v_sig TEXT; v_expected TEXT;
  v_plan_id TEXT; v_hash TEXT; v_row activation_keys%ROWTYPE; v_user profiles%ROWTYPE; v_expires TEXT;
  v_secret TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('ok', false, 'error', 'Не авторизован'); END IF;
  v_secret := public.cfg('volt_hmac_secret');
  v_norm := upper(regexp_replace(trim(p_code), '\s+', '', 'g'));
  v_match := regexp_match(v_norm, '^VV-(1H|2H|3H|6H|12H|1D|2D|3D|7D|14D|30D|6MO|LIFE)-([A-F0-9]{12})-([A-F0-9]{8})$');
  IF v_match IS NULL THEN RETURN json_build_object('ok', false, 'error', 'Неверный код активации'); END IF;
  v_plan_code := v_match[1]; v_random := v_match[2]; v_sig := v_match[3];
  v_expected := public.volt_key_sig('KEY|' || v_plan_code || '|' || v_random, v_secret);
  IF v_sig <> v_expected THEN RETURN json_build_object('ok', false, 'error', 'Неверный код активации'); END IF;
  v_plan_id := CASE v_plan_code
    WHEN '1H' THEN '1h' WHEN '2H' THEN '2h' WHEN '3H' THEN '3h' WHEN '6H' THEN '6h' WHEN '12H' THEN '12h'
    WHEN '1D' THEN '1d' WHEN '2D' THEN '2d' WHEN '3D' THEN '3d' WHEN '7D' THEN '7d' WHEN '14D' THEN '14d'
    WHEN '30D' THEN '30d' WHEN '6MO' THEN '6m' WHEN 'LIFE' THEN 'lifetime' END;
  v_hash := public.volt_sha256_hex(v_norm);
  SELECT * INTO v_row FROM activation_keys WHERE code_hash = v_hash;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Код не найден'); END IF;
  IF v_row.used_at IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'Код уже использован'); END IF;
  SELECT * INTO v_user FROM profiles WHERE id = auth.uid();
  v_expires := public.add_subscription_time(v_row.plan_id, v_row.duration_minutes, v_user);
  UPDATE profiles SET subscription_plan = v_row.plan_id, subscription_expires = v_expires WHERE id = auth.uid();
  UPDATE activation_keys SET used_at = NOW(), used_by = auth.uid() WHERE id = v_row.id;
  SELECT * INTO v_user FROM profiles WHERE id = auth.uid();
  RETURN json_build_object('ok', true, 'planId', v_row.plan_id, 'user', json_build_object(
    'id', v_user.id, 'username', v_user.username, 'email', v_user.email, 'role', v_user.role,
    'hwid', v_user.hwid, 'subscriptionPlan', v_user.subscription_plan,
    'subscriptionExpires', v_user.subscription_expires, 'createdAt', v_user.created_at, 'banned', v_user.banned
  ));
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_activation_key(TEXT) TO authenticated;

-- Admin RPCs
CREATE OR REPLACE FUNCTION public.admin_list_users(p_q TEXT DEFAULT '')
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rows JSON;
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('ok', false, 'error', 'Доступ запрещён'); END IF;
  SELECT COALESCE(json_agg(json_build_object(
    'id', id, 'username', username, 'email', email, 'role', role, 'hwid', hwid,
    'subscriptionPlan', subscription_plan, 'subscriptionExpires', subscription_expires,
    'createdAt', created_at, 'banned', banned
  ) ORDER BY created_at DESC), '[]'::json)
  INTO rows FROM profiles
  WHERE role = 'user' AND (p_q = '' OR username ILIKE '%' || p_q || '%' OR email ILIKE '%' || p_q || '%');
  RETURN json_build_object('ok', true, 'users', rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_stats()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total INT; v_active INT; v_banned INT;
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('ok', false, 'error', 'Доступ запрещён'); END IF;
  SELECT count(*) INTO v_total FROM profiles WHERE role = 'user';
  SELECT count(*) INTO v_active FROM profiles WHERE role = 'user' AND public.sub_active(subscription_expires);
  SELECT count(*) INTO v_banned FROM profiles WHERE role = 'user' AND banned;
  RETURN json_build_object('ok', true, 'stats', json_build_object('total', v_total, 'active', v_active, 'banned', v_banned));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_keys()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('ok', false, 'error', 'Доступ запрещён'); END IF;
  RETURN json_build_object('ok', true, 'keys', COALESCE((
    SELECT json_agg(json_build_object(
      'id', k.id, 'planId', k.plan_id, 'label', k.plan_id, 'createdAt', k.created_at,
      'usedAt', k.used_at, 'usedBy', p.username, 'status', CASE WHEN k.used_at IS NULL THEN 'active' ELSE 'used' END
    ) ORDER BY k.created_at DESC)
    FROM activation_keys k LEFT JOIN profiles p ON p.id = k.used_by
  ), '[]'::json));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_generate_key(p_plan_id TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_codes JSONB := '{"1h":"1H","2h":"2H","3h":"3H","6h":"6H","12h":"12H","1d":"1D","2d":"2D","3d":"3D","7d":"7D","14d":"14D","30d":"30D","6m":"6MO","lifetime":"LIFE"}'::jsonb;
  v_mins JSONB := '{"1h":60,"2h":120,"3h":180,"6h":360,"12h":720,"1d":1440,"2d":2880,"3d":4320,"7d":10080,"14d":20160,"30d":43200,"6m":259200,"lifetime":null}'::jsonb;
  v_plan_code TEXT; v_random TEXT; v_sig TEXT; v_code TEXT; v_hash TEXT; v_secret TEXT; v_label TEXT;
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('ok', false, 'error', 'Доступ запрещён'); END IF;
  v_plan_code := v_codes ->> p_plan_id;
  IF v_plan_code IS NULL THEN RETURN json_build_object('ok', false, 'error', 'Неизвестный срок'); END IF;
  v_secret := public.cfg('volt_hmac_secret');
  v_random := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_sig := public.volt_key_sig('KEY|' || v_plan_code || '|' || v_random, v_secret);
  v_code := 'VV-' || v_plan_code || '-' || v_random || '-' || v_sig;
  v_hash := public.volt_sha256_hex(v_code);
  INSERT INTO activation_keys (code_hash, plan_id, duration_minutes, created_by)
  VALUES (v_hash, p_plan_id, (v_mins ->> p_plan_id)::int, auth.uid());
  v_label := p_plan_id;
  RETURN json_build_object('ok', true, 'keys', json_build_array(json_build_object('code', v_code, 'planId', p_plan_id, 'label', v_label)));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user(p_id UUID, p_patch JSONB)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_target profiles%ROWTYPE; v_mins INT;
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('ok', false, 'error', 'Доступ запрещён'); END IF;
  SELECT * INTO v_target FROM profiles WHERE id = p_id;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Не найден'); END IF;
  IF v_target.role = 'admin' THEN RETURN json_build_object('ok', false, 'error', 'Нельзя редактировать администратора'); END IF;
  IF p_patch ? 'banned' THEN
    UPDATE profiles SET banned = (p_patch ->> 'banned')::boolean WHERE id = p_id;
    IF (p_patch ->> 'banned')::boolean THEN DELETE FROM mod_sessions WHERE user_id = p_id; END IF;
  END IF;
  IF p_patch ? 'hwid' THEN
    IF p_patch ->> 'hwid' IS NULL OR p_patch ->> 'hwid' = '' THEN
      UPDATE profiles SET hwid = NULL WHERE id = p_id;
      DELETE FROM mod_sessions WHERE user_id = p_id;
    ELSE
      UPDATE profiles SET hwid = trim(p_patch ->> 'hwid') WHERE id = p_id;
    END IF;
  END IF;
  IF p_patch ? 'subscriptionPlan' THEN
    IF p_patch ->> 'subscriptionPlan' IS NULL OR p_patch ->> 'subscriptionPlan' = '' THEN
      UPDATE profiles SET subscription_plan = NULL, subscription_expires = NULL WHERE id = p_id;
    ELSE
      SELECT * INTO v_target FROM profiles WHERE id = p_id;
      v_mins := CASE p_patch ->> 'subscriptionPlan'
        WHEN '1h' THEN 60 WHEN '2h' THEN 120 WHEN '3h' THEN 180 WHEN '6h' THEN 360 WHEN '12h' THEN 720
        WHEN '1d' THEN 1440 WHEN '2d' THEN 2880 WHEN '3d' THEN 4320 WHEN '7d' THEN 10080 WHEN '14d' THEN 20160
        WHEN '30d' THEN 43200 WHEN '6m' THEN 259200 ELSE NULL END;
      UPDATE profiles SET
        subscription_plan = p_patch ->> 'subscriptionPlan',
        subscription_expires = COALESCE(p_patch ->> 'subscriptionExpires', public.add_subscription_time(p_patch ->> 'subscriptionPlan', v_mins, v_target))
      WHERE id = p_id;
    END IF;
  END IF;
  SELECT * INTO v_target FROM profiles WHERE id = p_id;
  RETURN json_build_object('ok', true, 'user', json_build_object(
    'id', v_target.id, 'username', v_target.username, 'email', v_target.email, 'role', v_target.role,
    'hwid', v_target.hwid, 'subscriptionPlan', v_target.subscription_plan,
    'subscriptionExpires', v_target.subscription_expires, 'createdAt', v_target.created_at, 'banned', v_target.banned
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_subscription(p_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('ok', false, 'error', 'Доступ запрещён'); END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_id AND role = 'admin') THEN
    RETURN json_build_object('ok', false, 'error', 'Нельзя изменять администратора');
  END IF;
  UPDATE profiles SET subscription_plan = NULL, subscription_expires = NULL WHERE id = p_id;
  DELETE FROM mod_sessions WHERE user_id = p_id;
  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_users(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_keys() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_generate_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_subscription(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('ok', false, 'error', 'Доступ запрещён'); END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_id AND role = 'admin') THEN
    RETURN json_build_object('ok', false, 'error', 'Нельзя удалить администратора');
  END IF;
  DELETE FROM mod_sessions WHERE user_id = p_id;
  DELETE FROM profiles WHERE id = p_id;
  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;

INSERT INTO storage.buckets (id, name, public) VALUES ('mod-releases', 'mod-releases', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "mod_download_subscribers" ON storage.objects;
CREATE POLICY "mod_download_subscribers" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'mod-releases'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND public.sub_active(p.subscription_expires)
  )
);

-- Mod API (RPC вместо Edge Function)
CREATE OR REPLACE FUNCTION public.mod_sign(p_token TEXT, p_username TEXT, p_expires BIGINT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT upper(substr(encode(extensions.hmac(
    ('Vv1.6.1#volt|' || p_token || '|' || p_username || '|' || p_expires::text)::bytea,
    public.cfg('volt_mod_key')::bytea, 'sha256'::text), 'hex'), 1, 16));
$$;

CREATE OR REPLACE FUNCTION public.mod_login(
  p_login TEXT, p_password TEXT, p_hwid TEXT, p_mod_version TEXT DEFAULT '1.6.1'
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE
  v_email TEXT; v_uid UUID; v_enc TEXT; v_user profiles%ROWTYPE;
  v_token TEXT; v_now BIGINT; v_expires BIGINT; v_sig TEXT; v_hw TEXT;
BEGIN
  v_hw := upper(trim(coalesce(p_hwid, '')));
  IF length(v_hw) < 16 THEN RETURN json_build_object('ok', false, 'error', 'Некорректный HWID'); END IF;
  IF coalesce(trim(p_login), '') = '' OR coalesce(p_password, '') = '' THEN
    RETURN json_build_object('ok', false, 'error', 'Укажите логин и пароль');
  END IF;

  v_email := CASE WHEN position('@' in trim(p_login)) > 0 THEN lower(trim(p_login))
    ELSE public.get_email_by_username(trim(p_login)) END;
  IF v_email IS NULL THEN RETURN json_build_object('ok', false, 'error', 'Неверный логин или пароль'); END IF;

  SELECT id, encrypted_password INTO v_uid, v_enc FROM auth.users
  WHERE email = v_email AND deleted_at IS NULL LIMIT 1;
  IF NOT FOUND OR v_enc IS NULL OR v_enc <> extensions.crypt(p_password, v_enc) THEN
    RETURN json_build_object('ok', false, 'error', 'Неверный логин или пароль');
  END IF;

  SELECT * INTO v_user FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Пользователь не найден'); END IF;
  IF v_user.role = 'admin' THEN RETURN json_build_object('ok', false, 'error', 'Войдите через обычный аккаунт с подпиской'); END IF;
  IF v_user.banned THEN RETURN json_build_object('ok', false, 'error', 'Аккаунт заблокирован', 'code', 'BANNED'); END IF;
  IF NOT public.sub_active(v_user.subscription_expires) THEN
    RETURN json_build_object('ok', false, 'error', 'Нет активной подписки', 'code', 'NO_SUBSCRIPTION');
  END IF;

  IF v_user.hwid IS NULL OR v_user.hwid = '' THEN
    UPDATE profiles SET hwid = v_hw WHERE id = v_uid;
    v_user.hwid := v_hw;
  ELSIF v_user.hwid <> v_hw THEN
    RETURN json_build_object('ok', false, 'error', 'HWID не совпадает', 'code', 'HWID_MISMATCH');
  END IF;

  DELETE FROM mod_sessions WHERE user_id = v_uid;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_now := (extract(epoch from now()) * 1000)::bigint;
  v_expires := v_now + 14 * 86400000;
  INSERT INTO mod_sessions (token, user_id, hwid, expires_at, created_at)
  VALUES (v_token, v_uid, v_hw, v_expires, v_now);

  v_sig := public.mod_sign(v_token, v_user.username, v_expires);
  RETURN json_build_object(
    'ok', true, 'token', v_token, 'expiresAt', v_expires, 'username', v_user.username,
    'subscriptionPlan', v_user.subscription_plan, 'subscriptionExpires', v_user.subscription_expires,
    'hwidBound', true, 'modVersion', coalesce(nullif(trim(p_mod_version), ''), '1.6.1'), 'sig', v_sig
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mod_verify(p_token TEXT, p_hwid TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sess mod_sessions%ROWTYPE; v_user profiles%ROWTYPE; v_hw TEXT; v_expires BIGINT; v_sig TEXT;
BEGIN
  v_hw := upper(trim(coalesce(p_hwid, '')));
  IF coalesce(trim(p_token), '') = '' OR length(v_hw) < 16 THEN
    RETURN json_build_object('ok', false, 'error', 'Нет токена или HWID');
  END IF;

  SELECT * INTO v_sess FROM mod_sessions WHERE token = trim(p_token) AND expires_at > (extract(epoch from now()) * 1000)::bigint;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Сессия истекла', 'code', 'TOKEN_EXPIRED'); END IF;
  IF v_sess.hwid <> v_hw THEN RETURN json_build_object('ok', false, 'error', 'HWID не совпадает', 'code', 'HWID_MISMATCH'); END IF;

  SELECT * INTO v_user FROM profiles WHERE id = v_sess.user_id;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'Пользователь не найден'); END IF;
  IF v_user.banned THEN RETURN json_build_object('ok', false, 'error', 'Аккаунт заблокирован', 'code', 'BANNED'); END IF;
  IF NOT public.sub_active(v_user.subscription_expires) THEN
    RETURN json_build_object('ok', false, 'error', 'Подписка истекла', 'code', 'NO_SUBSCRIPTION');
  END IF;

  v_expires := (extract(epoch from now()) * 1000)::bigint + 14 * 86400000;
  v_sig := public.mod_sign(trim(p_token), v_user.username, v_expires);
  RETURN json_build_object(
    'ok', true, 'expiresAt', v_expires, 'username', v_user.username,
    'subscriptionPlan', v_user.subscription_plan, 'subscriptionExpires', v_user.subscription_expires,
    'hwidBound', v_user.hwid IS NOT NULL AND v_user.hwid <> '', 'modVersion', '1.6.1', 'sig', v_sig
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mod_login(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mod_verify(TEXT, TEXT) TO anon, authenticated;

-- UPDATE public.profiles SET role = 'admin' WHERE email = 'ваш@email.com';
