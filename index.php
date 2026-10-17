<?php
/**
 * index.php - SPA (Single Page Application) Frontend
 *
 * Arquitectura:
 *   - Esta pagina es el App Shell (carga una sola vez)
 *   - El sidebar y header son estaticos
 *   - Las "paginas" se cargan dinamicamente via JS en el contenedor #app-view
 *   - Routing basado en hash: #/dashboard, #/tickets, #/empresas, etc.
 *   - Cada vista llama a la API REST y se renderiza con vanilla JS
 */
declare(strict_types=1);

// Verificar sesion
require_once __DIR__ . '/includes/session.php';
startAppSession();
if (empty($_SESSION['user']['id_persona'])) {
    header('Location: /login.php');
    exit;
}

$user = $_SESSION['user'];
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
    <meta name="theme-color" content="#304753">
    <meta name="description" content="Sistema de Atenciones - MonosyncERP">

    <link rel="manifest" href="/manifest.json">
    <link rel="icon" type="image/png" href="/assets/img/icon-192.png">
    <link rel="apple-touch-icon" href="/assets/img/icon-192.png">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">

    <title>Atenciones - MonosyncERP</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
    <link rel="stylesheet" href="/assets/css/app.css">
</head>
<body>
    <div class="app-layout">
        <header class="app-header">
            <button class="menu-toggle" id="menuToggle" aria-label="Abrir menu">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
            <h1 class="app-header__title">Sistema de Atenciones</h1>
            <div class="app-header__actions">
                <button class="header-btn" data-action="install-pwa" hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                    <span class="hidden-sm">Instalar</span>
                </button>
                <button class="header-btn" id="themeToggle" type="button" title="Cambiar tema" aria-label="Cambiar tema" aria-pressed="false">☾</button>
                <a href="#/notificaciones" class="header-btn" id="notifBtn" title="Notificaciones">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6V11a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2z"/></svg>
                    <span data-notif-badge class="header-btn__badge hidden">0</span>
                </a>
                <a href="/api/v1/auth/logout" class="header-btn" title="Cerrar sesion">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
                    <span class="hidden-sm">Salir</span>
                </a>
            </div>
        </header>

        <aside class="app-sidebar" id="sidebar">
            <nav>
                <div class="nav-section">Principal</div>
                <a href="#/dashboard" class="nav-item" data-route="dashboard">
                    <svg class="nav-item__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
                    <span class="nav-item__label">Dashboard</span>
                </a>
                <a href="#/tickets" class="nav-item" data-route="tickets">
                    <svg class="nav-item__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-9 3h2v2h-2V7zm0 4h2v2h-2v-2zm-4-4h2v2H7V7zm0 4h2v2H7v-2zm-2 6v-2h12v2H5zm8-6h2v2h-2v-2zm0-4h2v2h-2V7zm4 8h2v2h-2v-2zm0-4h2v2h-2v-2z"/></svg>
                    <span class="nav-item__label">Tickets</span>
                </a>
                <a href="#/atenciones" class="nav-item" data-route="atenciones">
                    <svg class="nav-item__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                    <span class="nav-item__label">Atenciones</span>
                </a>

                <div class="nav-section">Directorios</div>
                <div class="nav-item" data-toggle-submenu="empresas">
                    <svg class="nav-item__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>
                    <span class="nav-item__label">Empresas</span>
                    <svg class="nav-item__chevron" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                </div>
                <div class="nav-submenu" id="submenu-empresas">
                    <a href="#/empresas" class="nav-item" data-route="empresas">
                        <span class="nav-item__label">Listado de Empresas</span>
                    </a>
                    <a href="#/sucursales" class="nav-item" data-route="sucursales">
                        <span class="nav-item__label">Sucursales</span>
                    </a>
                    <a href="#/contactos" class="nav-item" data-route="contactos">
                        <span class="nav-item__label">Contactos</span>
                    </a>
                    <a href="#/usuarios" class="nav-item" data-route="usuarios">
                        <span class="nav-item__label">Trabajadores</span>
                    </a>
                </div>
                <div class="nav-item" data-toggle-submenu="geografia">
                    <svg class="nav-item__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-2.18c.11-.31.18-.65.18-1 0-1.66-1.34-3-3-3-1.05 0-1.96.54-2.5 1.35l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.11-.9-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 16H4V8h16v12z"/></svg>
                    <span class="nav-item__label">Geografia</span>
                    <svg class="nav-item__chevron" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                </div>
                <div class="nav-submenu" id="submenu-geografia">
                    <a href="#/paises" class="nav-item"><span class="nav-item__label">Paises</span></a>
                    <a href="#/divisiones" class="nav-item"><span class="nav-item__label">Divisiones</span></a>
                    <a href="#/ubicaciones" class="nav-item"><span class="nav-item__label">Ubicaciones</span></a>
                    <a href="#/rubros" class="nav-item"><span class="nav-item__label">Rubros</span></a>
                    <a href="#/grupos" class="nav-item"><span class="nav-item__label">Grupos Empresariales</span></a>
                    <a href="#/motivos" class="nav-item"><span class="nav-item__label">Motivos de Contacto</span></a>
                </div>

                <div class="nav-section">Reportes</div>
                <a href="#/reportes" class="nav-item" data-route="reportes">
                    <svg class="nav-item__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.11 0-2 .89-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>
                    <span class="nav-item__label">Reportes</span>
                </a>
                <a href="#/exportaciones" class="nav-item" data-route="exportaciones">
                    <svg class="nav-item__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                    <span class="nav-item__label">Exportaciones</span>
                </a>
                <a href="#/encuestas" class="nav-item" data-route="encuestas">
                    <svg class="nav-item__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                    <span class="nav-item__label">Encuestas</span>
                </a>

                <div class="nav-section">Sistema</div>
                <a href="#/auditoria" class="nav-item" data-route="auditoria">
                    <svg class="nav-item__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
                    <span class="nav-item__label">Auditoria</span>
                </a>
                <a href="#/seguridad" class="nav-item" data-route="seguridad">
                    <svg class="nav-item__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
                    <span class="nav-item__label">Roles y Permisos</span>
                </a>
                <a href="#/notificaciones" class="nav-item" data-route="notificaciones">
                    <svg class="nav-item__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6V11a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2z"/></svg>
                    <span class="nav-item__label">Notificaciones</span>
                </a>
                <a href="#/configuracion" class="nav-item" data-route="configuracion">
                    <svg class="nav-item__icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94 0 .31.04.64.09.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.21.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
                    <span class="nav-item__label">Configuracion</span>
                </a>
            </nav>
        </aside>

        <div class="app-overlay" id="overlay"></div>

        <main class="app-main" id="appView">
            <div class="loading-container">
                <div class="spinner spinner-lg"></div>
                <p>Cargando...</p>
            </div>
        </main>
    </div>

    <div id="toast-container"></div>
    <div id="modal-root"></div>

    <script>
        // Pasar datos del usuario al JS
        window.AppUser = <?= json_encode($user, JSON_UNESCAPED_UNICODE) ?>;
    </script>
    <script src="/assets/js/app.js"></script>
    <script src="/assets/js/dashboard.js"></script>
    <script src="/assets/js/views.js"></script>
    <script src="/pwa/push-client.js"></script>
</body>
</html>
