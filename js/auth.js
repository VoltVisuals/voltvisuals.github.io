const Auth = {
  _user: null,
  _initPromise: null,

  PLANS: {
    '30d': { days: 30, price: 150, label: '30 дней', desc: 'Месяц доступа ко всем модулям' },
    '6m': { days: 180, price: 250, label: '6 месяцев', desc: 'Полгода — выгоднее на 33%' },
    lifetime: { days: null, price: 399, label: 'Навсегда', desc: 'Разовая покупка без ограничений' },
  },

  DURATIONS: {
    '1h': { label: '1 час' },
    '2h': { label: '2 часа' },
    '3h': { label: '3 часа' },
    '6h': { label: '6 часов' },
    '12h': { label: '12 часов' },
    '1d': { label: '1 день' },
    '2d': { label: '2 дня' },
    '3d': { label: '3 дня' },
    '7d': { label: '1 неделя' },
    '14d': { label: '2 недели' },
  },

  api(path, options = {}) {
    return fetch('/api' + path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
  },

  async init() {
    if (!this._initPromise) {
      this._initPromise = this.refreshUser();
    }
    return this._initPromise;
  },

  async refreshUser() {
    try {
      const res = await this.api('/auth/me');
      const data = await res.json();
      this._user = data.user || null;
    } catch {
      this._user = null;
    }
    return this._user;
  },

  getCurrentUser() {
    return this._user;
  },

  isAdmin(user) {
    return user?.role === 'admin';
  },

  async register({ username, email, password }) {
    const res = await this.api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.error || 'Ошибка регистрации' };
    this._user = data.user;
    return { ok: true, user: data.user };
  },

  async login({ login, password }) {
    const res = await this.api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.error || 'Ошибка входа' };
    this._user = data.user;
    return { ok: true, user: data.user };
  },

  async logout() {
    try {
      await this.api('/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    this._user = null;
    window.location.href = 'index.html';
  },

  async redeemCode(code, planId) {
    const res = await this.api('/subscription/redeem', {
      method: 'POST',
      body: JSON.stringify({ code, planId }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.error || 'Неверный код' };
    this._user = data.user;
    return { ok: true, user: data.user };
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
          btn.className = container.id === 'mobileUser'
            ? 'nav-admin-btn mobile-admin-link'
            : 'btn btn--primary btn--sm nav-admin-btn';
          btn.textContent = 'Админ-панель';
          const logout = container.querySelector('#logoutBtn, #mobileLogoutBtn');
          if (logout) container.insertBefore(btn, logout);
          else container.appendChild(btn);
        }
      } else if (btn) {
        btn.remove();
      }
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
          link.textContent = 'Админ-панель';
          const profile = mobileMenu.querySelector('a[href="profile.html"]');
          profile?.insertAdjacentElement('afterend', link);
        }
      } else if (link) {
        link.remove();
      }
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
    return (
      this.PLANS[planId]?.label ||
      this.DURATIONS[planId]?.label ||
      planId ||
      '—'
    );
  },

  getInitials(username) {
    return (username || '?').slice(0, 2).toUpperCase();
  },

  avatarColor(username) {
    let h = 0;
    for (let i = 0; i < (username || '').length; i++) {
      h = username.charCodeAt(i) + ((h << 5) - h);
    }
    const hue = Math.abs(h) % 360;
    return `hsl(${hue}, 55%, 45%)`;
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
    const p = new URLSearchParams(window.location.search);
    const r = p.get('redirect');
    if (r && !r.includes('://') && !r.startsWith('//')) return r;
    return 'profile.html';
  },

  loginRedirect(user) {
    if (this.isAdmin(user)) return 'admin.html';
    return this.getRedirect();
  },

  async downloadMod() {
    const res = await fetch('/api/mod/download', { credentials: 'include' });
    if (!res.ok) {
      let msg = 'Не удалось скачать';
      try {
        const data = await res.json();
        if (data.error) msg = data.error;
      } catch { /* binary or empty */ }
      return { ok: false, error: msg };
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
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

      const avatar = document.getElementById('navAvatar');
      const name = document.getElementById('navUsername');
      const mobAvatar = document.getElementById('mobileNavAvatar');
      const mobName = document.getElementById('mobileNavUsername');

      [avatar, mobAvatar].forEach(el => {
        if (!el) return;
        el.textContent = this.getInitials(current.username);
        el.style.background = `linear-gradient(135deg, ${this.avatarColor(current.username)}, var(--accent-dim))`;
      });
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

    document.getElementById('logoutBtn')?.addEventListener('click', e => {
      e.preventDefault();
      this.logout();
    });
    document.getElementById('mobileLogoutBtn')?.addEventListener('click', e => {
      e.preventDefault();
      this.logout();
    });

    const burger = document.getElementById('navBurger');
    const menu = document.getElementById('mobileMenu');
    burger?.addEventListener('click', () => menu?.classList.toggle('open'));
    menu?.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => menu?.classList.remove('open'));
    });

    const header = document.getElementById('header');
    window.addEventListener('scroll', () => {
      header?.classList.toggle('scrolled', window.scrollY > 40);
    });
  },
};

document.addEventListener('DOMContentLoaded', async () => {
  await Auth.init();
  if (document.getElementById('header')) Auth.initNav();
});
