/**
 * Apple-style emoji на всех платформах через CDN (emoji-datasource-apple).
 * https://github.com/iamcal/emoji-data
 */
const AppleEmoji = {
  CDN: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.1/img/apple/64',

  toUnified(str) {
    const cps = [];
    for (const ch of str) {
      const cp = ch.codePointAt(0);
      if (cp === 0xfe0f) continue;
      cps.push(cp.toString(16));
    }
    return cps.join('-');
  },

  imgUrl(char) {
    return `${this.CDN}/${this.toUnified(char)}.png`;
  },

  render(el) {
    const char = el.dataset.emoji || el.textContent.trim();
    if (!char) return;

    const size = parseInt(el.dataset.size, 10) || (el.classList.contains('profile-stat-icon') ? 28 : 20);
    const img = document.createElement('img');
    img.src = this.imgUrl(char);
    img.alt = char;
    img.className = 'emoji-ios-img';
    img.width = size;
    img.height = size;
    img.draggable = false;
    img.loading = 'lazy';
    img.decoding = 'async';
    el.replaceChildren(img);
  },

  init(selector = '.emoji-ios') {
    document.querySelectorAll(selector).forEach(el => this.render(el));
  },
};

document.addEventListener('DOMContentLoaded', () => AppleEmoji.init());
