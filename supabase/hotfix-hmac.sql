-- Hotfix: hmac/digest в Supabase (pgcrypto в schema extensions)
-- SQL Editor → Run (если ошибка "function hmac(bytea, bytea, unknown) does not exist")

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

CREATE OR REPLACE FUNCTION public.mod_sign(p_token TEXT, p_username TEXT, p_expires BIGINT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT upper(substr(encode(extensions.hmac(
    ('Vv1.6.1#volt|' || p_token || '|' || p_username || '|' || p_expires::text)::bytea,
    public.cfg('volt_mod_key')::bytea, 'sha256'::text), 'hex'), 1, 16));
$$;

GRANT EXECUTE ON FUNCTION public.volt_key_sig(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.volt_sha256_hex(TEXT) TO authenticated;
