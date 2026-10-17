<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/session.php';
startAppSession();
if (!empty($_SESSION['user']['id_persona'])) {
    header('Location: /');
    exit;
}
$errorMsg = $_GET['error'] ?? '';
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
    <link rel="manifest" href="/manifest.json">
    <link rel="icon" href="/assets/img/icon-192.png">
    <title>Iniciar Sesion - Atenciones</title>
    <link rel="stylesheet" href="/assets/css/app.css">
</head>
<body>
    <main class="login-page">
        <div class="login-card">
            <h1>Atenciones</h1>
            <p>Sistema de gestion de tickets - MonosyncERP</p>

            <?php if ($errorMsg === 'expired'): ?>
                <div style="background:#fbe5e3;color:#955650;padding:10px;border-radius:4px;margin-bottom:16px;font-size:14px">
                    Su sesion ha expirado. Ingrese nuevamente.
                </div>
            <?php endif; ?>

            <form id="loginForm">
                <div class="form-group">
                    <label class="form-label" for="correo">Correo electronico <span class="req">*</span></label>
                    <input type="email" id="correo" name="correo" class="form-input" required
                           autocomplete="email" placeholder="admin@soporte.com">
                </div>
                <div class="form-group">
                    <label class="form-label" for="password">Contrasena <span class="req">*</span></label>
                    <input type="password" id="password" name="password" class="form-input" required
                           autocomplete="current-password">
                </div>
                <button type="submit" class="btn btn-primary w-full" style="justify-content:center">
                    Ingresar
                </button>
            </form>

            <p class="text-muted text-sm mt-4 text-center">
                Sistema seguro. Solo personal autorizado.
            </p>
        </div>
    </main>

    <div id="toast-container"></div>
    <script src="/assets/js/app.js"></script>
    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const correo = document.getElementById('correo').value;
            const password = document.getElementById('password').value;
            const btn = e.target.querySelector('button[type="submit"]');
            const orig = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<div class="spinner"></div> Ingresando...';
            try {
                const r = await fetch('/api/v1/auth/login', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ correo, password })
                });
                const j = await r.json();
                if (j.ok) {
                    window.location.href = '/';
                } else {
                    App.toast(j.message || 'Credenciales invalidas', 'error');
                    btn.disabled = false;
                    btn.innerHTML = orig;
                }
            } catch (err) {
                App.toast('Error de conexion', 'error');
                btn.disabled = false;
                btn.innerHTML = orig;
            }
        });
    </script>
</body>
</html>
