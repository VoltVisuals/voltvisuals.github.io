const SiteTheme = {
  STORAGE_KEY: 'vv-theme',

  THEMES: [
    {
      id: 'volt',
      name: 'VoltVisuals',
      start: '#8187FF',
      end: '#4D5199',
      mesh: ['rgba(129, 135, 255, 0.18)', 'rgba(77, 81, 153, 0.12)', 'rgba(129, 135, 255, 0.08)'],
      orb: ['rgba(129, 135, 255, 0.15)', 'rgba(77, 81, 153, 0.12)'],
    },
    {
      id: 'emerald',
      name: 'Emerald',
      start: '#26C68C',
      end: '#1A8F63',
      mesh: ['rgba(38, 198, 140, 0.18)', 'rgba(26, 143, 99, 0.12)', 'rgba(38, 198, 140, 0.08)'],
      orb: ['rgba(38, 198, 140, 0.15)', 'rgba(26, 143, 99, 0.12)'],
    },
    {
      id: 'ruby',
      name: 'Ruby',
      start: '#FF5C7A',
      end: '#B8324F',
      mesh: ['rgba(255, 92, 122, 0.18)', 'rgba(184, 50, 79, 0.12)', 'rgba(255, 92, 122, 0.08)'],
      orb: ['rgba(255, 92, 122, 0.15)', 'rgba(184, 50, 79, 0.12)'],
    },
    {
      id: 'ocean',
      name: 'Ocean',
      start: '#5CB8FF',
      end: '#3278B8',
      mesh: ['rgba(92, 184, 255, 0.18)', 'rgba(50, 120, 184, 0.12)', 'rgba(92, 184, 255, 0.08)'],
      orb: ['rgba(92, 184, 255, 0.15)', 'rgba(50, 120, 184, 0.12)'],
    },
    {
      id: 'gold',
      name: 'Gold',
      start: '#FFD166',
      end: '#B8860B',
      mesh: ['rgba(255, 209, 102, 0.18)', 'rgba(184, 134, 11, 0.12)', 'rgba(255, 209, 102, 0.08)'],
      orb: ['rgba(255, 209, 102, 0.15)', 'rgba(184, 134, 11, 0.12)'],
    },
  ],

  find(id) {
    return this.THEMES.find(t => t.id === id) || this.THEMES[0];
  },

  apply(themeOrId) {
    const theme = typeof themeOrId === 'string' ? this.find(themeOrId) : themeOrId;
    if (!theme) return;

    const root = document.documentElement;
    root.setAttribute('data-theme', theme.id);
    root.style.setProperty('--accent', theme.start);
    root.style.setProperty('--accent-dim', theme.end);
    root.style.setProperty('--accent-glow', `${theme.start}59`);
    root.style.setProperty('--mesh-1', theme.mesh[0]);
    root.style.setProperty('--mesh-2', theme.mesh[1]);
    root.style.setProperty('--mesh-3', theme.mesh[2]);
    root.style.setProperty('--orb-1', theme.orb[0]);
    root.style.setProperty('--orb-2', theme.orb[1]);

    try {
      localStorage.setItem(this.STORAGE_KEY, theme.id);
    } catch {
      /* ignore */
    }

    document.querySelectorAll('.theme-chip').forEach(chip => {
      chip.classList.toggle('theme-chip--active', chip.dataset.theme === theme.id);
    });

    document.querySelectorAll('.theme-preview-card').forEach(card => {
      card.classList.toggle('theme-preview-card--active', card.dataset.theme === theme.id);
    });

    if (typeof window !== 'undefined') {
      window.activeTheme = theme;
    }
  },

  init() {
    let saved = null;
    try {
      saved = localStorage.getItem(this.STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.apply(saved || 'volt');
  },

  applyVarsOnly(themeOrId) {
    const theme = typeof themeOrId === 'string' ? this.find(themeOrId) : themeOrId;
    if (!theme || typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-theme', theme.id);
    root.style.setProperty('--accent', theme.start);
    root.style.setProperty('--accent-dim', theme.end);
    root.style.setProperty('--accent-glow', `${theme.start}59`);
    root.style.setProperty('--mesh-1', theme.mesh[0]);
    root.style.setProperty('--mesh-2', theme.mesh[1]);
    root.style.setProperty('--mesh-3', theme.mesh[2]);
    root.style.setProperty('--orb-1', theme.orb[0]);
    root.style.setProperty('--orb-2', theme.orb[1]);
  },

  bindPicker() {
    document.querySelectorAll('[data-theme]').forEach(el => {
      if (el.closest('.theme-preview-card') || el.classList.contains('theme-chip')) return;
      el.addEventListener('click', () => {
        const theme = this.find(el.dataset.theme);
        if (theme) this.apply(theme);
      });
    });

    document.querySelectorAll('.theme-preview-card[data-theme]').forEach(card => {
      card.addEventListener('click', () => this.apply(card.dataset.theme));
    });
  },
};

(function applyThemeEarly() {
  if (typeof document === 'undefined') return;
  let saved = 'volt';
  try {
    saved = localStorage.getItem(SiteTheme.STORAGE_KEY) || 'volt';
  } catch {
    /* ignore */
  }
  SiteTheme.applyVarsOnly(saved);
})();
