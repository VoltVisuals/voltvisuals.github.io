const Admin = {
  users: [],
  editingId: null,
  searchTimer: null,

  api(path, options = {}) {
    return fetch('/api' + path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
  },

  formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  },

  subBadge(user) {
    if (user.banned) return '<span class="admin-tag admin-tag--red">Бан</span>';
    if (!user.subscriptionExpires) return '<span class="admin-tag">Нет</span>';
    if (user.subscriptionExpires === 'lifetime') {
      return '<span class="admin-tag admin-tag--green">Lifetime</span>';
    }
    const active = new Date(user.subscriptionExpires) > new Date();
    return active
      ? '<span class="admin-tag admin-tag--green">Активна</span>'
      : '<span class="admin-tag admin-tag--red">Истекла</span>';
  },

  async loadStats() {
    const res = await this.api('/admin/stats');
    const data = await res.json();
    if (!data.ok) return;
    document.getElementById('statTotal').textContent = data.stats.total;
    document.getElementById('statActive').textContent = data.stats.active;
    document.getElementById('statBanned').textContent = data.stats.banned;
  },

  async loadKeys() {
    const res = await this.api('/admin/keys');
    const data = await res.json();
    if (!data.ok) return;
    const tbody = document.getElementById('keysTableBody');
    if (!data.keys.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="admin-empty">Ключей пока нет</td></tr>';
      return;
    }
    tbody.innerHTML = data.keys.map(k => {
      const status = k.status === 'used'
        ? '<span class="admin-tag admin-tag--red">Использован</span>'
        : '<span class="admin-tag admin-tag--green">Активен</span>';
      return `<tr>
        <td>${Auth.planLabel(k.planId)}</td>
        <td>${this.formatDate(k.createdAt)}</td>
        <td>${status}</td>
        <td>${k.usedAt ? this.formatDate(k.usedAt) : '—'}</td>
        <td>${k.usedBy ? this.escape(k.usedBy) : '—'}</td>
      </tr>`;
    }).join('');
  },

  async generateKey() {
    const planId = document.getElementById('keyPlanSelect').value;
    const res = await this.api('/admin/keys/generate', {
      method: 'POST',
      body: JSON.stringify({ planId, count: 1 }),
    });
    const data = await res.json();
    if (!data.ok || !data.keys?.length) {
      Auth.showToast(data.error || 'Ошибка генерации', 'error');
      return;
    }
    const code = data.keys[0].code;
    document.getElementById('generatedKey').textContent = code;
    document.getElementById('keyResult').classList.remove('hidden');
    Auth.showToast('Ключ сгенерирован — скопируйте и передайте покупателю');
    await this.loadKeys();
  },

  async loadUsers(q = '') {
    const url = q ? `/admin/users?q=${encodeURIComponent(q)}` : '/admin/users';
    const res = await this.api(url);
    const data = await res.json();
    if (!data.ok) {
      Auth.showToast(data.error || 'Ошибка загрузки', 'error');
      return;
    }
    this.users = data.users;
    this.renderTable();
  },

  renderTable() {
    const tbody = document.getElementById('usersTableBody');
    if (!this.users.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="admin-empty">Пользователи не найдены</td></tr>';
      return;
    }

    tbody.innerHTML = this.users
      .map(u => {
        const hwid = u.hwid
          ? `<span class="admin-mono" title="${u.hwid}">${u.hwid.slice(0, 12)}…</span>`
          : '<span class="admin-muted">—</span>';
        const plan = u.subscriptionPlan ? Auth.planLabel(u.subscriptionPlan) : '—';
        const expires =
          u.subscriptionExpires === 'lifetime'
            ? 'Навсегда'
            : u.subscriptionExpires
              ? this.formatDate(u.subscriptionExpires)
              : '—';

        return `<tr class="${u.banned ? 'admin-row-banned' : ''}">
          <td><strong>${this.escape(u.username)}</strong></td>
          <td>${this.escape(u.email)}</td>
          <td>${plan}</td>
          <td>${expires}</td>
          <td>${hwid}</td>
          <td>${this.formatDate(u.createdAt)}</td>
          <td>${this.subBadge(u)}</td>
          <td><button class="btn btn--ghost btn--sm admin-edit-btn" data-id="${u.id}">Изменить</button></td>
        </tr>`;
      })
      .join('');

    tbody.querySelectorAll('.admin-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => this.openEdit(btn.dataset.id));
    });
  },

  escape(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  openEdit(id) {
    const user = this.users.find(u => u.id === id);
    if (!user) return;
    this.editingId = id;

    document.getElementById('editTitle').textContent = user.username;
    document.getElementById('editSubtitle').textContent = user.email;
    document.getElementById('editPlan').value = user.subscriptionPlan || '';
    document.getElementById('editExpires').value = user.subscriptionExpires || '';
    document.getElementById('editHwid').value = user.hwid || '';
    document.getElementById('editBanned').checked = !!user.banned;
    document.getElementById('editModal').classList.remove('hidden');
  },

  closeEdit() {
    document.getElementById('editModal').classList.add('hidden');
    this.editingId = null;
  },

  async saveUser() {
    if (!this.editingId) return;

    const plan = document.getElementById('editPlan').value;
    const expires = document.getElementById('editExpires').value.trim();
    const hwid = document.getElementById('editHwid').value.trim();
    const banned = document.getElementById('editBanned').checked;

    const body = { banned };
    if (plan) {
      body.subscriptionPlan = plan;
      body.subscriptionExpires = expires || (plan === 'lifetime' ? 'lifetime' : undefined);
    } else {
      body.subscriptionPlan = null;
      body.subscriptionExpires = null;
    }
    body.hwid = hwid || null;

    const res = await this.api(`/admin/users/${this.editingId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      Auth.showToast(data.error || 'Ошибка сохранения', 'error');
      return;
    }

    Auth.showToast('Пользователь обновлён');
    this.closeEdit();
    await this.loadStats();
    await this.loadUsers(document.getElementById('userSearch').value.trim());
  },

  async resetHwid() {
    if (!this.editingId) return;
    const res = await this.api(`/admin/users/${this.editingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ hwid: null }),
    });
    const data = await res.json();
    if (!data.ok) {
      Auth.showToast(data.error || 'Ошибка', 'error');
      return;
    }
    document.getElementById('editHwid').value = '';
    Auth.showToast('HWID сброшен');
    await this.loadUsers(document.getElementById('userSearch').value.trim());
  },

  async deleteUser() {
    if (!this.editingId) return;
    const user = this.users.find(u => u.id === this.editingId);
    if (!confirm(`Удалить пользователя ${user?.username}? Это необратимо.`)) return;

    const res = await this.api(`/admin/users/${this.editingId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) {
      Auth.showToast(data.error || 'Ошибка удаления', 'error');
      return;
    }

    Auth.showToast('Пользователь удалён');
    this.closeEdit();
    await this.loadStats();
    await this.loadUsers(document.getElementById('userSearch').value.trim());
  },

  bindEvents() {
    document.getElementById('adminLogoutBtn').addEventListener('click', () => Auth.logout());
    document.getElementById('refreshBtn').addEventListener('click', async () => {
      await this.loadStats();
      await this.loadKeys();
      await this.loadUsers(document.getElementById('userSearch').value.trim());
      Auth.showToast('Данные обновлены');
    });

    document.getElementById('generateKeyBtn').addEventListener('click', () => this.generateKey());
    document.getElementById('copyKeyBtn').addEventListener('click', () => {
      const code = document.getElementById('generatedKey').textContent;
      navigator.clipboard?.writeText(code).then(() => Auth.showToast('Скопировано'));
    });

    document.getElementById('userSearch').addEventListener('input', e => {
      clearTimeout(this.searchTimer);
      const q = e.target.value.trim();
      this.searchTimer = setTimeout(() => this.loadUsers(q), 300);
    });

    document.getElementById('editClose').addEventListener('click', () => this.closeEdit());
    document.getElementById('editBackdrop').addEventListener('click', () => this.closeEdit());
    document.getElementById('saveUserBtn').addEventListener('click', () => this.saveUser());
    document.getElementById('resetHwidBtn').addEventListener('click', () => this.resetHwid());
    document.getElementById('deleteUserBtn').addEventListener('click', () => this.deleteUser());
  },

  async init() {
    if (!(await Auth.requireAdmin())) return;

    const user = Auth.getCurrentUser();
    document.getElementById('adminUserName').textContent = user.username;
    this.bindEvents();
    await this.loadStats();
    await this.loadKeys();
    await this.loadUsers();
  },
};

Admin.init();
