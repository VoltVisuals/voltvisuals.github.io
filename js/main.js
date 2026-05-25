const MODULES = {
  combat: [
    { id: 'tapemouse', name: 'TapeMouse', hint: 'CPS клики', desc: 'Автоматические клики с настраиваемой скоростью (CPS).', defaultOn: true },
    { id: 'fastexp', name: 'Fast Exp', hint: 'Бутылочки опыта', desc: 'Ускоряет бросок бутылочек опыта, не мешая еде.', defaultOn: false },
    { id: 'fastclick', name: 'FastClick', hint: 'Быстрые клики', desc: 'Снижает задержку между кликами для быстрого взаимодействия.', defaultOn: false },
    { id: 'totempop', name: 'TotemPop', hint: 'Тотем / талисман', desc: 'Голограмма и сообщение в чат при сбитии талисмана с кастомным названием.', defaultOn: false },
  ],
  movement: [
    { id: 'autosprint', name: 'AutoSprint', hint: 'Авто-спринт', desc: 'Автоматически включает спринт при движении.', defaultOn: true },
    { id: 'elytrahelper', name: 'ElytraHelper', hint: 'Элитры по бинду', desc: 'Быстрая смена нагрудника на элитры по бинду.', defaultOn: false },
    { id: 'twerk', name: 'Twerk', hint: 'Быстрый шифт', desc: 'Быстрое приседание (шифт) для забавы или обхода AFK.', defaultOn: false },
  ],
  player: [
    { id: 'antiafk', name: 'AntiAFK', hint: 'Защита от кика', desc: 'Защита от кика за бездействие на сервере.', defaultOn: false },
    { id: 'autorespawn', name: 'AutoRespawn', hint: 'Авто-респawn', desc: 'Автоматически возрождается после смерти.', defaultOn: false },
    { id: 'autoeat', name: 'AutoEat', hint: 'Авто-еда', desc: 'Ест еду, когда голод ниже порога.', defaultOn: false },
    { id: 'fishing', name: 'Fishing', hint: 'Авто-рыбалка', desc: 'Автоматически закидывает и подсекает удочку.', defaultOn: false },
  ],
  render: [
    { id: 'interface', name: 'Interface', hint: 'HUD', desc: 'Элементы HUD: ватермарк, клавиши, эффекты и др.', defaultOn: true },
    { id: 'hitcolor', name: 'HitColor', hint: 'Хитбокс', desc: 'Светлый туман на игроках. Скрывает при невидимости.', defaultOn: false },
    { id: 'ambience', name: 'Ambience', hint: 'Яркий мир', desc: 'Яркий мир, настройка времени суток и погоды.', defaultOn: true },
    { id: 'clearrender', name: 'ClearRender', hint: 'NoRender', desc: 'Скрывает выбранные визуальные эффекты на экране.', defaultOn: false },
    { id: 'particles', name: 'Particles', hint: 'Частицы', desc: 'Красивые частицы вокруг игрока и в мире.', defaultOn: false },
    { id: 'customhands', name: 'CustomHands', hint: 'Руки', desc: 'Настройка положения и анимации рук.', defaultOn: false },
    { id: 'customcamera', name: 'CustomCamera', hint: 'Камера', desc: 'Камера от третьего лица: дистанция и NoClip.', defaultOn: false },
    { id: 'aspectratio', name: 'AspectRatio', hint: 'Соотношение', desc: 'Изменяет соотношение сторон экрана.', defaultOn: false },
    { id: 'pearlprediction', name: 'PearlPrediction', hint: 'Траектория', desc: 'Показывает траекторию полёта эндер-жемчуга.', defaultOn: false },
    { id: 'targetesp', name: 'TargetESP', hint: 'Маркер цели', desc: 'Маркер на цели в прицеле.', defaultOn: false },
    { id: 'hitparticles', name: 'HitParticles', hint: 'Частицы удара', desc: 'Кастомные частицы при успешном ударе по цели.', defaultOn: false },
    { id: 'damagenumbers', name: 'DamageNumbers', hint: '3D урон', desc: 'Всплывающие 3D-числа урона и исцеления над целями.', defaultOn: false },
    { id: 'itemphysics', name: 'ItemPhysics', hint: 'Физика', desc: 'Реалистичная физика выброшенных предметов.', defaultOn: false },
    { id: 'killeffect', name: 'KillEffect', hint: 'Эффект убийства', desc: 'Эффект молнии и частиц при убийстве противника.', defaultOn: false },
    { id: 'shulkerpreview', name: 'ShulkerPreview', hint: 'Шалкер', desc: 'Просмотр содержимого шалкера при наведении.', defaultOn: false },
  ],
  misc: [
    { id: 'notifications', name: 'Notifications', hint: 'Уведомления', desc: 'Всплывающие уведомления при включении модулей.', defaultOn: true },
    { id: 'auctionhelper', name: 'AuctionHelper', hint: 'Аукцион', desc: 'Подсветка выгодных лотов на аукционе.', defaultOn: false },
    { id: 'plugins', name: 'Plugins', hint: 'Плагины', desc: 'Показывает плагины сервера в чате.', defaultOn: false },
    { id: 'autotpaccept', name: 'AutoTpaccept', hint: 'Телепорт', desc: 'Принимает запросы на телепорт.', defaultOn: false },
    { id: 'effectcancel', name: 'EffectCancel', hint: 'Эффекты', desc: 'Отключает выбранные негативные эффекты.', defaultOn: false },
    { id: 'serverrpspoof', name: 'ServerRPSpoof', hint: 'Ресурспак', desc: 'Автоматически принимает ресурспак сервера.', defaultOn: false },
    { id: 'chathelper', name: 'ChatHelper', hint: 'Чат', desc: 'Исправление раскладки команд и история чата.', defaultOn: false },
    { id: 'armornotifier', name: 'ArmorNotifier', hint: 'Броня', desc: 'Предупреждение о низкой прочности брони.', defaultOn: false },
  ],
};

const CATEGORY_LABELS = {
  combat: 'Combat',
  movement: 'Movement',
  player: 'Player',
  render: 'Render',
  misc: 'Misc',
};

const THEMES = typeof SiteTheme !== 'undefined' ? SiteTheme.THEMES : [
  { id: 'volt', name: 'VoltVisuals', start: '#8187FF', end: '#4D5199' },
  { id: 'emerald', name: 'Emerald', start: '#26C68C', end: '#1A8F63' },
  { id: 'ruby', name: 'Ruby', start: '#FF5C7A', end: '#B8324F' },
  { id: 'ocean', name: 'Ocean', start: '#5CB8FF', end: '#3278B8' },
  { id: 'gold', name: 'Gold', start: '#FFD166', end: '#B8860B' },
];

const moduleState = {};
Object.values(MODULES).flat().forEach(m => {
  moduleState[m.id] = m.defaultOn;
});

let activeCategory = 'combat';
let selectedModuleId = null;
let detailSource = null;
let activeTheme = THEMES[0];

function allModules() {
  return Object.values(MODULES).flat();
}

function findModule(id) {
  return allModules().find(m => m.id === id);
}

function countActive() {
  return Object.values(moduleState).filter(Boolean).length;
}

function updateHudCount() {
  const el = document.getElementById('hudActiveCount');
  if (el) el.textContent = countActive();
}

function showToast(msg) {
  if (typeof Auth !== 'undefined' && Auth.showToast) {
    Auth.showToast(msg);
    return;
  }
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'toast toast--success toast--visible';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('toast--visible'), 2500);
}

function applyTheme(theme) {
  if (typeof SiteTheme !== 'undefined') {
    SiteTheme.apply(theme);
    activeTheme = SiteTheme.find(theme.id || theme);
  } else {
    activeTheme = theme;
    const root = document.documentElement;
    root.style.setProperty('--accent', theme.start);
    root.style.setProperty('--accent-dim', theme.end);
    root.style.setProperty('--accent-glow', `${theme.start}4D`);
  }

  document.querySelectorAll('.theme-chip').forEach(chip => {
    chip.classList.toggle('theme-chip--active', chip.dataset.theme === activeTheme.id);
  });

  document.querySelectorAll('.theme-preview-card').forEach(card => {
    card.classList.toggle('theme-preview-card--active', card.dataset.theme === activeTheme.id);
  });
}

function initThemePicker() {
  document.querySelectorAll('.theme-preview-card[data-theme]').forEach(card => {
    card.addEventListener('click', () => applyTheme(card.dataset.theme));
  });
}

function renderGuiModules(category) {
  const container = document.getElementById('guiModules');
  const title = document.getElementById('guiCatTitle');
  if (!container) return;

  activeCategory = category;
  const modules = MODULES[category] || [];
  if (title) title.textContent = CATEGORY_LABELS[category];

  container.innerHTML = modules.slice(0, 4).map(m => `
    <div class="gui-mod-card ${selectedModuleId === m.id ? 'selected' : ''}" data-id="${m.id}" role="button" tabindex="0">
      <div class="gui-mod-head">
        <span class="gui-mod-icon"></span>
        <span class="gui-mod-name">${m.name}</span>
        <span class="gui-mod-bind">NONE</span>
      </div>
      <div class="gui-mod-body">
        <div class="gui-mod-toggle-row">
          <span class="gui-mod-toggle-label">Включить</span>
          <div class="gui-mod-controls">
            <svg class="gui-mod-gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>
            <div class="gui-check ${moduleState[m.id] ? 'on' : ''}" data-id="${m.id}" role="switch"
                 aria-checked="${moduleState[m.id]}" tabindex="0"></div>
          </div>
        </div>
        <p class="gui-mod-desc">${m.desc}</p>
      </div>
    </div>
  `).join('');
}

function renderModulesGrid(category) {
  const grid = document.getElementById('modulesGrid');
  if (!grid) return;

  const modules = MODULES[category] || [];
  grid.innerHTML = modules.map(m => `
    <article class="module-card ${selectedModuleId === m.id ? 'module-card--selected' : ''}"
             data-id="${m.id}" role="button" tabindex="0">
      <div class="module-card-header">
        <span class="module-card-name">${m.name}</span>
        <div class="module-card-right">
          <span class="module-card-status ${moduleState[m.id] ? 'on' : ''}">
            ${moduleState[m.id] ? 'Вкл' : 'Выкл'}
          </span>
          <span class="module-card-badge">${m.hint}</span>
        </div>
      </div>
      <p class="module-card-desc">${m.desc}</p>
      <div class="module-card-toggle">
        <span class="module-card-toggle-label">Переключить</span>
        <div class="gui-check ${moduleState[m.id] ? 'on' : ''}" data-id="${m.id}" role="switch"></div>
      </div>
    </article>
  `).join('');

  observeNewCards(grid.querySelectorAll('.module-card'));
}

function renderModuleDetail() {
  const mod = selectedModuleId ? findModule(selectedModuleId) : null;
  const heroPanel = document.getElementById('moduleDetailPanel');
  const sectionPanel = document.getElementById('moduleDetailSection');

  if (!mod) {
    heroPanel?.classList.add('hidden');
    sectionPanel?.classList.add('hidden');
    return;
  }

  const cat = Object.entries(MODULES).find(([, list]) => list.some(m => m.id === mod.id))?.[0] || activeCategory;
  const html = `
    <div class="detail-header">
      <div>
        <span class="detail-category">${CATEGORY_LABELS[cat]}</span>
        <h3 class="detail-name">${mod.name}</h3>
      </div>
      <button class="detail-close" aria-label="Закрыть">&times;</button>
    </div>
    <p class="detail-hint">${mod.hint}</p>
    <p class="detail-desc">${mod.desc}</p>
    <div class="detail-actions">
      <div class="detail-toggle-row">
        <span>Состояние</span>
        <div class="gui-check ${moduleState[mod.id] ? 'on' : ''}" data-id="${mod.id}" role="switch"></div>
      </div>
      <span class="detail-status ${moduleState[mod.id] ? 'detail-status--on' : ''}">
        ${moduleState[mod.id] ? '● Модуль включён' : '○ Модуль выключен'}
      </span>
    </div>
  `;

  function bindClose(panel) {
    panel.querySelector('.detail-close')?.addEventListener('click', () => {
      selectedModuleId = null;
      detailSource = null;
      renderGuiModules(activeCategory);
      const activeTab = document.querySelector('.module-tab.active');
      if (activeTab) renderModulesGrid(activeTab.dataset.category);
      heroPanel?.classList.add('hidden');
      sectionPanel?.classList.add('hidden');
    });
  }

  if (detailSource === 'gui' && heroPanel) {
    heroPanel.classList.remove('hidden');
    heroPanel.innerHTML = html;
    bindClose(heroPanel);
    sectionPanel?.classList.add('hidden');
  } else if (detailSource === 'grid' && sectionPanel) {
    sectionPanel.classList.remove('hidden');
    sectionPanel.innerHTML = html;
    bindClose(sectionPanel);
    heroPanel?.classList.add('hidden');
  }
}

function toggleModule(id, source) {
  const mod = findModule(id);
  if (!mod) return;

  moduleState[id] = !moduleState[id];
  const on = moduleState[id];
  showToast(`${mod.name} ${on ? 'включён' : 'выключен'}`);

  document.querySelectorAll(`.gui-check[data-id="${id}"]`).forEach(t => {
    t.classList.toggle('on', on);
    t.setAttribute('aria-checked', on);
  });

  document.querySelectorAll(`.module-card[data-id="${id}"] .module-card-status`).forEach(s => {
    s.textContent = on ? 'Вкл' : 'Выкл';
    s.classList.toggle('on', on);
  });

  if (source === 'grid') {
    const activeTab = document.querySelector('.module-tab.active');
    if (activeTab) renderModulesGrid(activeTab.dataset.category);
  } else if (source === 'gui') {
    renderGuiModules(activeCategory);
  }
}

function selectModule(id) {
  selectedModuleId = id;
  renderGuiModules(activeCategory);
  const activeTab = document.querySelector('.module-tab.active');
  if (activeTab) renderModulesGrid(activeTab.dataset.category);
  renderModuleDetail();
}

function initGuiTabs() {
  document.querySelectorAll('.gui-cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.gui-cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedModuleId = null;
      renderGuiModules(tab.dataset.tab);
    });
  });
}

function initModuleTabs() {
  document.querySelectorAll('.module-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.module-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedModuleId = null;
      detailSource = null;
      renderModulesGrid(tab.dataset.category);
      document.getElementById('moduleDetailPanel')?.classList.add('hidden');
      document.getElementById('moduleDetailSection')?.classList.add('hidden');
    });
  });
}

function initInteractions() {
  document.addEventListener('click', e => {
    const toggle = e.target.closest('.gui-check[data-id]');
    if (toggle) {
      e.stopPropagation();
      const inGrid = toggle.closest('.module-card');
      toggleModule(toggle.dataset.id, inGrid ? 'grid' : 'gui');
      return;
    }

    const guiCard = e.target.closest('.gui-mod-card[data-id]');
    if (guiCard && !e.target.closest('.gui-check')) {
      selectedModuleId = guiCard.dataset.id;
      renderGuiModules(activeCategory);
      return;
    }

    const card = e.target.closest('.module-card[data-id]');
    if (card && !e.target.closest('.gui-check')) {
      detailSource = 'grid';
      selectModule(card.dataset.id);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.gui-mod-card[data-id], .module-card[data-id]');
    if (row) {
      e.preventDefault();
      if (row.classList.contains('gui-mod-card')) {
        selectedModuleId = row.dataset.id;
        renderGuiModules(activeCategory);
      } else {
        selectModule(row.dataset.id);
      }
    }
    const toggle = e.target.closest('.gui-check[data-id]');
    if (toggle) {
      e.preventDefault();
      toggleModule(toggle.dataset.id, toggle.closest('.module-card') ? 'grid' : 'gui');
    }
  });
}

function initCounterAnimation() {
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count, 10);
    const suffix = el.dataset.suffix || '';
    let current = 0;
    const step = Math.ceil(target / 40);
    const timer = setInterval(() => {
      current = Math.min(target, current + step);
      el.textContent = current + suffix;
      if (current >= target) clearInterval(timer);
    }, 30);
  });
}

function observeNewCards(cards) {
  if (!window._cardObserver) return;
  cards.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    window._cardObserver.observe(el);
  });
}

function initReveal() {
  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }
      });
    },
    { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
  );
  window._cardObserver = observer;

  document.querySelectorAll('.benefit-card, .feature-card, .module-card, .showcase-item, .faq-item, .theme-preview-card, .stat-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(el);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof SiteTheme !== 'undefined') SiteTheme.init();
  renderGuiModules('combat');
  renderModulesGrid('combat');
  initGuiTabs();
  initModuleTabs();
  initThemePicker();
  initInteractions();
  initReveal();
  initCounterAnimation();
  if (typeof SiteTheme !== 'undefined') {
    activeTheme = SiteTheme.find(document.documentElement.getAttribute('data-theme') || 'volt');
  }
});
