const CookieConsent = {
  STORAGE_KEY: 'vv-cookie-consent',

  init() {
    if (this.hasConsent()) return;
    this.render();
  },

  hasConsent() {
    try {
      return localStorage.getItem(this.STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  },

  accept() {
    try {
      localStorage.setItem(this.STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    document.getElementById('cookieBanner')?.remove();
  },

  render() {
    if (document.getElementById('cookieBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'cookieBanner';
    banner.className = 'cookie-banner';
    banner.innerHTML = `
      <div class="cookie-banner-inner container">
        <p class="cookie-banner-text">
          Мы используем файлы cookie и локальное хранилище для авторизации, сохранения темы оформления и работы сайта.
          Продолжая пользоваться сайтом, вы соглашаетесь с
          <a href="privacy.html">политикой конфиденциальности</a>.
        </p>
        <div class="cookie-banner-actions">
          <a href="privacy.html" class="btn btn--ghost btn--sm">Подробнее</a>
          <button type="button" class="btn btn--primary btn--sm" id="cookieAcceptBtn">Принять</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);
    document.getElementById('cookieAcceptBtn')?.addEventListener('click', () => this.accept());
  },
};
