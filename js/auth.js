const Auth = {
  _user: null,
  _initPromise: null,
  _supabase: null,

  PLANS: {
    '30d': { days: 30, price: 150, label: '30 дней', desc: 'Месяц доступа ко всем модулям' },
    '6m': { days: 180, price: 250, label: '6 месяцев', desc: 'Полгода — выгоднее на 33%' },
    lifetime: { days: null, price: 399, label: 'Навсегда', desc: 'Разовая покупка без ограничений' },
  },

  DURATIONS: {
    '1h': { label: '1 час' }, '2h': { label: '2 часа' }, '3h': { label: '3 часа' },
    '6h': { label: '6 часов' }, '12h': { label: '12 часов' }, '1d': { label: '1 день' },
    '2d': { label: '2 дня' }, '3d': { label: '3 дня' }, '7d': { label: '1 неделя' }, '14d': { label: '2 недели' },
  },

  ADMIN_DURATIONS: [
    { id: '1h', label: '1 час' }, { id: '2h', label: '2 часа' }, { id: '3h', label: '3 часа' },
    { id: '6h', label: '6 часов' }, { id: '12h', label: '12 часов' }, { id: '1d', label: '1 день' },
    { id: '2d', label: '2 дня' }, { id: '3d', label: '3 дня' }, { id: '7d', label: '1 неделя' },
    { id: '14d', label: '2 недели' }, { id: '30d', label: '30 дней' }, { id: '6m', label: '6 месяцев' },
    { id: 'lifetime', label: 'Навсегда' },
  ],

  isConfigured() {
    return !!(
      window.VV_SUPABASE_URL &&
      window.VV_SUPABASE_ANON_KEY &&
      window.VV_SUPABASE_URL.includes('supabase.co')
    );
  },

  apiUrl() {
    return (window.VV_API_URL || '').replace(/\/$/, '');
  },

  getSupabase() {
    if (!this.isConfigured()) return null;
    if (!this._supabase) {
      this._supabase = window.supabase.createClient(
        window.VV_SUPABASE_URL,
        window.VV_SUPABASE_ANON_KEY,
      );
    }
    return this._supabase;
  },

  mapProfile(row, email, meta) {
    if (!row && meta) {
      return {
        id: meta.id,
        username: meta.username || meta.user_metadata?.username || (email || '').split('@')[0],
        email: email || meta.email,
        role: meta.app_metadata?.role || meta.user_metadata?.role || 'user',
        hwid: null,
        subscriptionPlan: null,
        subscriptionExpires: null,
        createdAt: meta.created_at,
        banned: false,
      };
    }
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      email: email || row.email,
      role: row.role,
      hwid: row.hwid,
      subscriptionPlan: row.subscription_plan,
      subscriptionExpires: row.subscription_expires,
      createdAt: row.created_at,
      banned: !!row.banned,
    };
  },

  async getAccessToken() {
    const sb = this.getSupabase();
    if (!sb) return null;
    const { data: { session } } = await sb.auth.getSession();
    return session?.access_token || null;
  },

  /** Edge Function API (mod) — fallback если RPC не задеплоены */
  async callApi(path, { method = 'POST', body } = {}) {
    if (!this.isConfigured()) {
      return { ok: false, error: 'Supabase не настроен' };
    }
    const token = await this.getAccessToken();
    const headers = {
      'Content-Type': 'application/json',
      apikey: window.VV_SUPABASE_ANON_KEY,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetch(`${this.apiUrl()}${path}`, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { ok: false, error: 'Edge Function не задеплоена. Выполните supabase/rpc.sql в SQL Editor.' };
      }
    } catch {
      return { ok: false, error: 'API недоступен' };
    }
  },

  async rpc(fn, params = {}) {
    const sb = this.getSupabase();
    if (!sb) return { ok: false, error: 'Supabase не настроен' };
    const { data, error } = await sb.rpc(fn, params);
    if (error) {
      if (error.code === 'PGRST202') {
        return { ok: false, error: 'Функция не найдена. Выполните supabase/rpc.sql в SQL Editor.' };
      }
      return { ok: false, error: error.message };
    }
    if (data && typeof data === 'object' && 'ok' in data) return data;
    return { ok: true, data };
  },

  async init() {
    if (!this._initPromise) this._initPromise = this.refreshUser();
    return this._initPromise;
  },

  async refreshUser() {
    const sb = this.getSupabase();
    if (!sb) { this._user = null; return null; }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) { this._user = null; return null; }

    const { data: profile, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
    if (error || !profile) {
      const fallback = this.mapProfile(null, session.user.email, session.user);
      if (fallback && !fallback.banned) {
        this._user = fallback;
        return this._user;
      }
      this._user = null;
      return null;
    }

    if (profile.banned) {
      await sb.auth.signOut();
      this._user = null;
      return null;
    }

    this._user = this.mapProfile(profile, session.user.email);
    return this._user;
  },

  getCurrentUser() { return this._user; },
  isAdmin(user) { return user?.role === 'admin'; },

  async resolveEmail(login) {
    const trimmed = login.trim();
    if (trimmed.includes('@')) return trimmed.toLowerCase();
    const sb = this.getSupabase();
    const { data, error } = await sb.rpc('get_email_by_username', { p_username: trimmed });
    if (error || !data) return null;
    return data;
  },

  async register({ username, email, password }) {
    if (!this.isConfigured()) return { ok: false, error: 'Supabase не настроен' };
    const sb = this.getSupabase();
    const uname = username.trim();
    const mail = email.trim().toLowerCase();

    if (uname.length < 3) return { ok: false, error: 'Ник минимум 3 символа' };
    if (!mail.includes('@')) return { ok: false, error: 'Некорректный email' };
    if (password.length < 6) return { ok: false, error: 'Пароль минимум 6 символов' };

    const { data: available } = await sb.rpc('is_username_available', { p_username: uname });
    if (available === false) return { ok: false, error: 'Этот ник уже занят' };

    const { data, error } = await sb.auth.signUp({
      email: mail,
      password,
      options: { data: { username: uname } },
    });

    if (error) {
      const msg = error.message.includes('already registered') ? 'Этот email уже зарегистрирован' : error.message;
      return { ok: false, error: msg };
    }

    if (!data.session) {
      return { ok: false, error: 'Отключите Confirm email в Supabase Auth или подтвердите почту' };
    }

    await this.refreshUser();
    return { ok: true, user: this._user };
  },

  async login({ login, password }) {
    if (!this.isConfigured()) return { ok: false, error: 'Supabase не настроен' };
    const email = await this.resolveEmail(login);
    if (!email) return { ok: false, error: 'Неверный логин или пароль' };

    const { error } = await this.getSupabase().auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: 'Неверный логин или пароль' };

    await this.refreshUser();
    if (!this._user) return { ok: false, error: 'Аккаунт заблокирован' };
    return { ok: true, user: this._user };
  },

  async logout() {
    const sb = this.getSupabase();
    if (sb) await sb.auth.signOut();
    this._user = null;
    window.location.href = 'index.html';
  },

  async redeemCode(code) {
    const result = await this.rpc('redeem_activation_key', { p_code: code });
    if (!result.ok) return result;
    await this.refreshUser();
    return { ok: true, user: this._user, planId: result.planId };
  },

  injectAdminNav() {
    document.querySelectorAll('#navUser, #mobileUser').forEach(container => {
      if (!container) return;
      const current = this.getCurrentUser();
      let btn = container.querySelector('.nav-admin-btn');
      if (current && this.isAdmin(current)) {
        if (!btn) {
          btn = document.createElement('a');
          btn.href = 'admin.html';
          btn.className = container.id === 'mobileUser' ? 'nav-admin-btn mobile-admin-link' : 'btn btn--primary btn--sm nav-admin-btn';
          btn.textContent = 'Админ-pанель';
          const logout = container.querySelector('#logoutBtn, #mobileLogoutBtn');
          if (logout) container.insertBefore(btn, logout);
          else container.appendChild(btn);
        }
      } else if (btn) btn.remove();
    });

    const mobileMenu = document.getElementById('mobileMenu');
    if (mobileMenu) {
      let link = mobileMenu.querySelector('.mobile-admin-link-item');
      const current = this.getCurrentUser();
      if (current && this.isAdmin(current)) {
        if (!link) {
          link = document.createElement('a');
          link.href = 'admin.html';
          link.className = 'mobile-admin-link-item';
          link.textContent = 'Админ-pанель';
          mobileMenu.querySelector('a[href="profile.html"]')?.insertAdjacentElement('afterend', link);
        }
      } else if (link) link.remove();
    }

    const profileAdmin = document.getElementById('profileAdminBtn');
    if (profileAdmin) {
      const current = this.getCurrentUser();
      profileAdmin.classList.toggle('hidden', !(current && this.isAdmin(current)));
    }
  },

  isSubscriptionActive(user) {
    if (!user?.subscriptionExpires) return false;
    if (user.subscriptionExpires === 'lifetime') return true;
    return new Date(user.subscriptionExpires) > new Date();
  },

  formatExpiry(user) {
    if (!user?.subscriptionExpires) return 'Не куплен';
    if (user.subscriptionExpires === 'lifetime') return 'Навсегда';
    const d = new Date(user.subscriptionExpires);
    if (d <= new Date()) return 'Истёк';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  },

  planLabel(planId) {
    return this.PLANS[planId]?.label || this.DURATIONS[planId]?.label || planId || '—';
  },

  getInitials(username) { return (username || '?').slice(0, 2).toUpperCase(); },

  avatarColor(username) {
    let h = 0;
    for (let i = 0; i < (username || '').length; i++) h = username.charCodeAt(i) + ((h << 5) - h);
    return `hsl(${Math.abs(h) % 360}, 55%, 45%)`;
  },

  async requireAuth() {
    await this.init();
    if (!this.getCurrentUser()) {
      const ret = encodeURIComponent(window.location.pathname.split('/').pop() || 'profile.html');
      window.location.href = `login.html?redirect=${ret}`;
      return false;
    }
    return true;
  },

  async requireAdmin() {
    await this.init();
    const user = this.getCurrentUser();
    if (!user || !this.isAdmin(user)) {
      window.location.href = 'login.html?redirect=admin.html';
      return false;
    }
    return true;
  },

  getRedirect() {
    const r = new URLSearchParams(window.location.search).get('redirect');
    if (r && !r.includes('://') && !r.startsWith('//')) return r;
    return 'profile.html';
  },

  loginRedirect(user) {
    if (this.isAdmin(user)) return 'admin.html';
    return this.getRedirect();
  },

  async downloadMod() {
    const sb = this.getSupabase();
    if (!sb) return { ok: false, error: 'Supabase не настроен' };
    if (!this.isSubscriptionActive(this._user)) {
      return { ok: false, error: 'Нужна активная подписка' };
    }

    const { data, error } = await sb.storage.from('mod-releases').download('voltvisuals-1.6.1.jar');
    if (error) {
      return { ok: false, error: error.message || 'Файл не найден в Storage bucket mod-releases' };
    }

    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voltvisuals-1.6.1.jar';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { ok: true };
  },

  showToast(message, type = 'success') {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `toast toast--${type} toast--visible`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('toast--visible'), 3200);
  },

  renderNav() {
    const guest = document.getElementById('navGuest');
    const userEl = document.getElementById('navUser');
    const mobileGuest = document.getElementById('mobileGuest');
    const mobileUser = document.getElementById('mobileUser');
    const current = this.getCurrentUser();

    if (current) {
      guest?.classList.add('hidden');
      userEl?.classList.remove('hidden');
      mobileGuest?.classList.add('hidden');
      mobileUser?.classList.remove('hidden');
      [document.getElementById('navAvatar'), document.getElementById('mobileNavAvatar')].forEach(el => {
        if (!el) return;
        el.textContent = this.getInitials(current.username);
        el.style.background = `linear-gradient(135deg, ${this.avatarColor(current.username)}, var(--accent-dim))`;
      });
      const name = document.getElementById('navUsername');
      const mobName = document.getElementById('mobileNavUsername');
      if (name) name.textContent = current.username;
      if (mobName) mobName.textContent = current.username;
      this.injectAdminNav();
    } else {
      guest?.classList.remove('hidden');
      userEl?.classList.add('hidden');
      mobileGuest?.classList.remove('hidden');
      mobileUser?.classList.add('hidden');
      document.querySelectorAll('.nav-admin-btn').forEach(el => el.remove());
    }
  },

  initNav() {
    this.renderNav();
    document.getElementById('logoutBtn')?.addEventListener('click', e => { e.preventDefault(); this.logout(); });
    document.getElementById('mobileLogoutBtn')?.addEventListener('click', e => { e.preventDefault(); this.logout(); });
    document.getElementById('navBurger')?.addEventListener('click', () => document.getElementById('mobileMenu')?.classList.toggle('open'));
    document.getElementById('mobileMenu')?.querySelectorAll('a').forEach(l => l.addEventListener('click', () => document.getElementById('mobileMenu')?.classList.remove('open')));
    window.addEventListener('scroll', () => document.getElementById('header')?.classList.toggle('scrolled', window.scrollY > 40));
  },

  onAuthStateChange() {
    const sb = this.getSupabase();
    if (!sb) return;
    sb.auth.onAuthStateChange(() => {
      this.refreshUser().then(() => { if (document.getElementById('header')) this.renderNav(); });
    });
  },
};

document.addEventListener('DOMContentLoaded', async () => {
  Auth.onAuthStateChange();
  await Auth.init();
  if (document.getElementById('header')) Auth.initNav();
});
