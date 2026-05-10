// ===============================================
// THEME.JS
// V.V.S Rotselaar – Dark/Light mode toggle
//
// Voeg onderaan elke pagina toe (na firebase-config):
//   <script type="module" src="scripts/theme.js"></script>
//
// Voeg ook dit één-regeltje toe IN DE <head> van elke pagina
// (voorkomt witte flits bij eerste load):
//   <script>if(localStorage.getItem('vvs_theme')==='dark')document.documentElement.classList.add('dark');</script>
// ===============================================

const STORAGE_KEY = 'vvs_theme';

function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
}

function injectToggle() {
    const footer = document.querySelector('.main-footer');
    if (!footer || footer.querySelector('.theme-toggle-wrap')) return;

    const isDark = localStorage.getItem(STORAGE_KEY) === 'dark';

    // Absoluut rechts gepositioneerd via CSS
    // .main-footer { position: relative }
    // .theme-toggle-wrap { position: absolute; right: 1.5rem; top: 50%; transform: translateY(-50%) }
    const wrap = document.createElement('div');
    wrap.className = 'theme-toggle-wrap';
    wrap.setAttribute('title', 'Wissel tussen licht en donker');
    wrap.innerHTML = `
        <span class="theme-toggle-label">☀️</span>
        <label class="theme-toggle">
            <input type="checkbox" id="themeCheckbox" ${isDark ? 'checked' : ''}>
            <div class="theme-toggle-slider">
                <div class="theme-toggle-thumb">${isDark ? '🌙' : '☀️'}</div>
            </div>
        </label>
        <span class="theme-toggle-label">🌙</span>
    `;

    footer.appendChild(wrap);

    const checkbox = wrap.querySelector('#themeCheckbox');
    const thumb    = wrap.querySelector('.theme-toggle-thumb');

    checkbox.addEventListener('change', () => {
        const dark = checkbox.checked;
        applyTheme(dark);
        localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
        thumb.textContent = dark ? '🌙' : '☀️';
    });
}

applyTheme(localStorage.getItem(STORAGE_KEY) === 'dark');
document.addEventListener('DOMContentLoaded', injectToggle);
