/* ============================================================================
 *  app.js - Sistema de Atenciones v2 (SPA Router)
 *
 *  Caracteristicas:
 *   - Routing basado en hash (#/dashboard, #/tickets, #/tickets/123, etc.)
 *   - Cliente HTTP para API REST
 *   - Sidebar colapsable en mobile
 *   - Submenus expandibles
 *   - Notificaciones toast
 *   - Modales
 *   - Polling de notificaciones no leidas
 * ========================================================================== */

const App = {
    config: {
        apiBase: '/api/v1',
        user: window.AppUser || null,
    },

    state: {
        sidebarOpen: false,
        deferredPrompt: null,
        notificationsBadge: 0,
        currentRoute: null,
        renderVersion: 0,
    },

    // Registry de vistas - cada vista tiene su render() function
    views: {},

    async init() {
        this.bindEvents();
        this.bindTheme();
        this.bindSidebar();
        this.bindSubmenus();
        this.bindRouting();
        this.registerServiceWorker();
        this.startNotificationsPolling();

        // Cargar la ruta inicial
        this.router();
    },

    /* ====== EVENTOS GLOBALES ====== */
    bindEvents() {
        // Capturar prompt de instalacion PWA
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.state.deferredPrompt = e;
            document.querySelector('[data-action="install-pwa"]')?.classList.remove('hidden');
        });

        // Click en boton instalar PWA
        document.querySelector('[data-action="install-pwa"]')?.addEventListener('click', async () => {
            if (!this.state.deferredPrompt) return;
            this.state.deferredPrompt.prompt();
            const choice = await this.state.deferredPrompt.userChoice;
            if (choice.outcome === 'accepted') {
                this.toast('App instalada', 'success');
            }
            this.state.deferredPrompt = null;
            document.querySelector('[data-action="install-pwa"]')?.classList.add('hidden');
        });
    },

    bindTheme() {
        const root = document.documentElement;
        const toggle = document.getElementById('themeToggle');
        let savedTheme = null;
        try { savedTheme = localStorage.getItem('atenciones-theme'); } catch (e) { }
        if (savedTheme === 'light' || savedTheme === 'dark') root.dataset.theme = savedTheme;

        const updateButton = () => {
            const theme = root.dataset.theme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            if (toggle) {
                toggle.textContent = theme === 'dark' ? '☀' : '☾';
                toggle.title = theme === 'dark' ? 'Cambiar a modo dia' : 'Cambiar a modo noche';
                toggle.setAttribute('aria-label', toggle.title);
                toggle.setAttribute('aria-pressed', String(theme === 'dark'));
            }
        };

        updateButton();
        toggle?.addEventListener('click', () => {
            const currentTheme = root.dataset.theme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
            root.dataset.theme = nextTheme;
            try { localStorage.setItem('atenciones-theme', nextTheme); } catch (e) { }
            updateButton();
        });
    },

    /* ====== SIDEBAR MODO HAMBURGUESA SIEMPRE ====== */
    bindSidebar() {
        const toggle = document.getElementById('menuToggle');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('overlay');

        // Abrir/cerrar sidebar
        const openSidebar = () => {
            sidebar.classList.add('open');
            overlay.classList.add('active');
            this.state.sidebarOpen = true;
        };
        const closeSidebar = () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
            this.state.sidebarOpen = false;
        };

        toggle?.addEventListener('click', () => {
            if (sidebar.classList.contains('open')) closeSidebar();
            else openSidebar();
        });

        overlay?.addEventListener('click', closeSidebar);

        // Cerrar sidebar con tecla Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.state.sidebarOpen) closeSidebar();
        });

        // Cerrar sidebar al hacer click en cualquier nav-item que tenga href
        document.addEventListener('click', (e) => {
            const navItem = e.target.closest('.nav-item[href]');
            if (navItem) {
                // Pequeno delay para que el navegador procese el cambio de hash
                setTimeout(closeSidebar, 100);
            }
        });
    },

    /* ====== SUBMENUS EXPANDIBLES ====== */
    bindSubmenus() {
        document.querySelectorAll('[data-toggle-submenu]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const key = item.dataset.toggleSubmenu;
                const submenu = document.getElementById('submenu-' + key);
                if (submenu) {
                    submenu.classList.toggle('open');
                    item.classList.toggle('expanded');
                }
            });
        });
    },

    /* ====== ROUTING ====== */
    bindRouting() {
        window.addEventListener('hashchange', () => this.router());
        // Tambien escuchar popstate por si usamos history API en futuro
        window.addEventListener('popstate', () => this.router());
    },

    async router() {
        const renderVersion = ++this.state.renderVersion;
        const hash = window.location.hash.slice(1) || '/dashboard';
        const parts = hash.split('/').filter(Boolean);   // ['tickets', '123']
        const viewName = parts[0] || 'dashboard';
        const params = parts.slice(1);   // ['123']

        this.state.currentRoute = { viewName, params };

        // Actualizar nav-item activo
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            const route = item.dataset.route || item.getAttribute('href')?.replace('#/', '');
            if (route === viewName) item.classList.add('active');
        });

        // Renderizar la vista
        const view = this.views[viewName] || this.views.notFound;
        const container = document.getElementById('appView');
        container.innerHTML = '<div class="loading-container"><div class="spinner spinner-lg"></div><p>Cargando...</p></div>';

        try {
            await view.render(container, params);
        } catch (err) {
            if (renderVersion !== this.state.renderVersion) return;
            console.error('[Router] Error:', err);
            container.innerHTML = `
                <div class="card">
                    <div class="empty-state">
                        <div class="empty-state__icon">⚠️</div>
                        <div class="empty-state__title">Error al cargar la vista</div>
                        <div class="empty-state__desc">${this.escapeHtml(err.message)}</div>
                        <button class="btn btn-primary" onclick="location.reload()">Reintentar</button>
                    </div>
                </div>`;
        }
    },

    navigate(path) {
        window.location.hash = path;
    },

    /* ====== HTTP ====== */
    async request(path, opts = {}) {
        const url = this.config.apiBase + path;
        const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
        const options = {
            credentials: 'include',
            ...opts,
            headers,
        };
        const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
        if (isFormData) {
            delete options.headers['Content-Type'];
        } else if (options.body && typeof options.body === 'object') {
            options.body = JSON.stringify(options.body);
        }
        try {
            const r = await fetch(url, options);
            const text = await r.text();
            let j;
            try {
                j = JSON.parse(text);
            } catch {
                const contentType = r.headers?.get?.('content-type') || '';
                const isHtml = /text\/html/i.test(contentType) || /^\s*<(?:!doctype|html|head|body)\b/i.test(text);
                const message = r.status >= 500 || isHtml
                    ? `Error del servidor (HTTP ${r.status}) al consultar ${path}. Revise el registro PHP/IIS.`
                    : (text.trim().slice(0, 300) || `Respuesta no valida del servidor (HTTP ${r.status}).`);
                j = { ok: false, message };
            }

            if (!r.ok || !j.ok) {
                if (r.status === 401) {
                    // Sesion expirada - redirigir a login
                    window.location.href = '/login.php';
                    return;
                }
                throw new Error(j.message || `HTTP ${r.status}`);
            }
            return j.data !== undefined ? j.data : j;
        } catch (err) {
            console.error('[App.request]', path, err);
            this.toast(err.message || 'Error de red', 'error');
            throw err;
        }
    },

    /* ====== NOTIFICACIONES ====== */
    startNotificationsPolling() {
        if (!this.config.user) return;
        const poll = async () => {
            try {
                const data = await this.request('/notificaciones/unread-count');
                this.state.notificationsBadge = data.total || 0;
                this.updateNotificationsBadge();
            } catch (e) { /* offline */ }
        };
        poll();
        setInterval(poll, 60_000);
    },

    updateNotificationsBadge() {
        document.querySelectorAll('[data-notif-badge]').forEach(el => {
            const count = this.state.notificationsBadge;
            if (count > 0) {
                el.textContent = count > 99 ? '99+' : count;
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });
    },

    /* ====== TOAST ====== */
    toast(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 200);
        }, duration);
    },

    /* ====== MODAL (definido en views.js como App.showModal) ====== */
    // App.showModal y App.closeModal estan definidos en views.js
    // para evitar duplicacion.

    /* ====== PWA ====== */
    async registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        try {
            await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            console.info('[PWA] Service worker registrado');
        } catch (err) {
            console.warn('[PWA] No se pudo registrar SW', err);
        }
    },

    /* ====== HELPERS DE FORMATO ====== */
    escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    },

    formatDate(dateStr) {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        return d.toLocaleDateString('es-PE', { year: 'numeric', month: '2-digit', day: '2-digit' });
    },

    formatDateTime(dateStr) {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        return d.toLocaleString('es-PE', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    },

    formatNumber(n, decimals = 0) {
        if (n == null || isNaN(n)) return '-';
        return new Intl.NumberFormat('es-PE', { minimumFractionDigits: decimals }).format(n);
    },

    /* ====== UI HELPERS ====== */
    badge(text, type = 'muted') {
        return `<span class="badge badge-${type}">${this.escapeHtml(text)}</span>`;
    },

    btn(label, opts = {}) {
        const cls = ['btn'];
        if (opts.variant) cls.push(`btn-${opts.variant}`);
        if (opts.size) cls.push(`btn-${opts.size}`);
        if (opts.icon) cls.push('btn-icon');
        const attrs = Object.entries(opts.attrs || {})
            .map(([k, v]) => `${k}="${this.escapeHtml(v)}"`).join(' ');
        return `<button class="${cls.join(' ')}" ${attrs}>${opts.icon ? opts.icon : ''}<span>${this.escapeHtml(label)}</span></button>`;
    },

    /* ====== ESTADO VACIO ====== */
    emptyState(icon, title, desc, action) {
        return `<div class="empty-state">
            <div class="empty-state__icon">${icon}</div>
            <div class="empty-state__title">${this.escapeHtml(title)}</div>
            <div class="empty-state__desc">${this.escapeHtml(desc)}</div>
            ${action || ''}
        </div>`;
    },

    /* ====== TABLA GENERICA ====== */
    table({ columns, rows, empty = 'Sin datos' }) {
        if (!rows || rows.length === 0) {
            return `<div class="table-wrap"><table><thead><tr>${columns.map(c => `<th>${this.escapeHtml(c.label)}</th>`).join('')}</tr></thead></table><div class="table-empty">${this.escapeHtml(empty)}</div></div>`;
        }
        const head = columns.map(c => `<th>${this.escapeHtml(c.label)}</th>`).join('');
        const body = rows.map(row =>
            `<tr>${columns.map(c => `<td>${c.render ? c.render(row) : this.escapeHtml(row[c.key] ?? '')}</td>`).join('')}</tr>`
        ).join('');
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    },
};

window.App = App;

// Auto-init
document.addEventListener('DOMContentLoaded', () => App.init());
