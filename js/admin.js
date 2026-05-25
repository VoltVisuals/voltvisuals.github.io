const Admin = {
  users: [],
  editingId: null,
  searchTimer: null,
  durations: Auth.ADMIN_DURATIONS,

  formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  },

  subBadge(user) {
    if (user.banned) return '<span class="admin-tag admin-tag--red">Бан</span>';
    if (!user.subscriptionExpires) return '<span class="admin-tag">Нет</span>';
    if (user.subscriptionExpires === 'lifetime') return '<span class="admin-tag admin-tag--green">Lifetime</span>';
    const active = new Date(user.subscriptionExpires) > new Date();
    return active
      ? '<span class="admin-tag admin-tag--green">Активна</span>'
      : '<span class="admin-tag admin-tag--red">Истекла</span>';
  },

  loadDurations() {
    const select = document.getElementById('keyPlanSelect');
    if (select) {
      select.innerHTML = this.durations
        .map(d => `<option value="${d.id}">${this.escape(d.label)}</option>`)
        .join('');
    }
  },

  async loadStats() {
    const data = await Auth.rpc('admin_stats');
    if (!data.ok) return;
    document.getElementById('statTotal').textContent = data.stats.total;
    document.getElementById('statActive').textContent = data.stats.active;
    document.getElementById('statBanned').textContent = data.stats.banned;
  },

  async loadKeys() {
    const data = await Auth.rpc('admin_list_keys');
    if (!data.ok) return;
    const tbody = document.getElementById('keysTableBody');
    if (!data.keys?.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="admin-empty">Ключей пока нет</td></tr>';
      return;
    }
    tbody.innerHTML = data.keys.map(k => {
      const status = k.status === 'used'
        ? '<span class="admin-tag admin-tag--red">Использован</span>'
        : '<span class="admin-tag admin-tag--green">Активен</span>';
      const label = Auth.planLabel(k.planId);
      return `<tr>
        <td>${this.escape(label)}</td>
        <td>${this.formatDate(k.createdAt)}</td>
        <td>${status}</td>
        <td>${k.usedAt ? this.formatDate(k.usedAt) : '—'}</td>
        <td>${k.usedBy ? this.escape(k.usedBy) : '—'}</td>
      </tr>`;
    }).join('');
  },

  async generateKey() {
    const planId = document.getElementById('keyPlanSelect').value;
    const data = await Auth.rpc('admin_generate_key', { p_plan_id: planId });
    if (!data.ok || !data.keys?.length) {
      Auth.showToast(data.error || 'Ошибка генерации', 'error');
      return;
    }
    const key = data.keys[0];
    document.getElementById('generatedKey').textContent = key.code;
    document.getElementById('keyResultLabel').textContent = key.label || Auth.planLabel(key.planId);
    document.getElementById('keyResult').classList.remove('hidden');
    Auth.showToast('Ключ сгенерирован');
    await this.loadKeys();
  },

  async loadUsers(q = '') {
    const data = await Auth.rpc('admin_list_users', { p_q: q });
    if (!data.ok) {
      Auth.showToast(data.error || 'Ошибка загрузки', 'error');
      return;
    }
    this.users = data.users || [];
    this.renderTable();
  },

  renderTable() {
    const tbody = document.getElementById('usersTableBody');
    if (!this.users.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="admin-empty">Пользователи не найдены</td></tr>';
      return;
    }

    tbody.innerHTML = this.users.map(u => {
      const hwid = u.hwid
        ? `<span class="admin-mono" title="${u.hwid}">${u.hwid.slice(0, 12)}…</span>`
        : '<span class="admin-muted">—</span>';
      const plan = u.subscriptionPlan ? Auth.planLabel(u.subscriptionPlan) : '—';
      const expires = u.subscriptionExpires === 'lifetime' ? 'Навсегда' : u.subscriptionExpires ? this.formatDate(u.subscriptionExpires) : '—';

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
    }).join('');

    tbody.querySelectorAll('.admin-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => this.openEdit(btn.dataset.id));
    });
  },

  escape(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  clearCredentials() {
    document.getElementById('editCredentials')?.classList.add('hidden');
  },

  async loadCredentials() {
    this.clearCredentials();
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
    this.clearCredentials();
  },

  async saveUser() {
    if (!this.editingId) return;
    const plan = document.getElementById('editPlan').value;
    const expires = document.getElementById('editExpires').value.trim();
    const hwid = document.getElementById('editHwid').value.trim();
    const banned = document.getElementById('editBanned').checked;

    const patch = { banned, hwid: hwid || null };
    if (plan) {
      patch.subscriptionPlan = plan;
      if (expires) patch.subscriptionExpires = expires;
    } else {
      patch.subscriptionPlan = null;
    }

    const data = await Auth.rpc('admin_update_user', { p_id: this.editingId, p_patch: patch });
    if (!data.ok) {
      Auth.showToast(data.error || 'Ошибка сохранения', 'error');
      return;
    }
    Auth.showToast('Пользователь обновлён');
    this.closeEdit();
    await this.loadStats();
    await this.loadUsers(document.getElementById('userSearch').value.trim());
  },

  async revokeSubscription() {
    if (!this.editingId) return;
    const user = this.users.find(u => u.id === this.editingId);
    if (!confirm(`Забрать подписку у ${user?.username}?`)) return;

    const data = await Auth.rpc('admin_revoke_subscription', { p_id: this.editingId });
    if (!data.ok) {
      Auth.showToast(data.error || 'Ошибка', 'error');
      return;
    }
    document.getElementById('editPlan').value = '';
    document.getElementById('editExpires').value = '';
    Auth.showToast('Подписка отозвана');
    await this.loadStats();
    await this.loadUsers(document.getElementById('userSearch').value.trim());
  },

  async resetHwid() {
    if (!this.editingId) return;
    const data = await Auth.rpc('admin_update_user', { p_id: this.editingId, p_patch: { hwid: null } });
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
    if (!confirm(`Удалить ${user?.username}?`)) return;

    const data = await Auth.rpc('admin_delete_user', { p_id: this.editingId });
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
      navigator.clipboard?.writeText(document.getElementById('generatedKey').textContent).then(() => Auth.showToast('Скопировано'));
    });
    document.getElementById('userSearch').addEventListener('input', e => {
      clearTimeout(this.searchTimer);
      const q = e.target.value.trim();
      this.searchTimer = setTimeout(() => this.loadUsers(q), 300);
    });
    document.getElementById('editClose').addEventListener('click', () => this.closeEdit());
    document.getElementById('editBackdrop').addEventListener('click', () => this.closeEdit());
    document.getElementById('saveUserBtn').addEventListener('click', () => this.saveUser());
    document.getElementById('revokeSubBtn').addEventListener('click', () => this.revokeSubscription());
    document.getElementById('resetHwidBtn').addEventListener('click', () => this.resetHwid());
    document.getElementById('deleteUserBtn').addEventListener('click', () => this.deleteUser());
  },

  async init() {
    if (!(await Auth.requireAdmin())) return;
    document.getElementById('adminUserName').textContent = Auth.getCurrentUser().username;
    this.bindEvents();
    this.loadDurations();
    await this.loadStats();
    await this.loadKeys();
    await this.loadUsers();
  },
};

Admin.init();
