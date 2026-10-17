<?php
/**
 * api/routes/auth.php
 *
 * Endpoints de autenticacion:
 *   POST /auth/login     - Login web (correo + password) -> sesion
 *   POST /auth/logout    - Cierra sesion
 *   POST /auth/token      - Genera API token (requiere permiso SEGURIDAD)
 */

$method = $_SERVER['REQUEST_METHOD'];
$id     = $segments[1] ?? null;

if ($method === 'POST' && $id === 'login') {
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    if (empty($body['correo']) || empty($body['password'])) {
        ApiResponse::validationError(['correo' => 'Requerido', 'password' => 'Requerido']);
    }

    try {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            "SELECT TOP 1 id_persona, correo, nombres, apellido_paterno, contrasena,
                    bloqueado, estado, activo
             FROM persona WITH (NOLOCK)
             WHERE correo = ? AND activo = 1"
        );
        $stmt->execute([$body['correo']]);
        $u = $stmt->fetch();

        $valid = $u
            ? password_verify($body['password'], $u['contrasena'])
            : password_verify($body['password'], '$2y$10$dummyHashToPreventTimingAttackXXXXXXXXXXXXXXXXXXXXXXXXXX');

        if (!$u || !$valid || !$u['estado'] || $u['bloqueado']) {
            ApiResponse::error('invalid_credentials', 'Credenciales invalidas.', 401);
        }

        startAppSession();
        $_SESSION['user'] = [
            'id_persona' => (int)$u['id_persona'],
            'correo'      => $u['correo'],
            'nombre'       => $u['nombres'] . ' ' . $u['apellido_paterno'],
            'login_at'     => gmdate('c'),
        ];
        session_regenerate_id(true);

        ApiResponse::success([
            'id_persona' => (int)$u['id_persona'],
            'nombre'      => $u['nombres'] . ' ' . $u['apellido_paterno'],
            'correo'       => $u['correo'],
            'session'     => session_id(),
        ], 200, 'Login exitoso');
    } catch (Throwable $e) {
        error_log('[auth/login] ' . $e->getMessage());
        ApiResponse::error('server_error', 'Error interno. Intente mas tarde.', 500);
    }
}

if ($method === 'POST' && $id === 'logout') {
    if (session_status() === PHP_SESSION_ACTIVE) session_destroy();
    ApiResponse::success(null, 200, 'Sesion cerrada');
}

/* ---- GET /auth/me - Devuelve datos del usuario actual (sesion o token) ---- */
if ($method === 'GET' && $id === 'me') {
    $rows = Database::callSP('sp_usuario_actual', [$user['id_persona']]);
    if (empty($rows)) {
        ApiResponse::error('not_found', 'Usuario no encontrado.', 404);
    }
    ApiResponse::success($rows[0], 200);
}

/* ---- GET /auth/vapid-public-key - Clave publica VAPID para PWA push ---- */
if ($method === 'GET' && $id === 'vapid-public-key') {
    $path = __DIR__ . '/../../config/vapid.json';
    $vapid = is_file($path) ? json_decode((string)file_get_contents($path), true) : [];
    ApiResponse::success([
        'publicKey' => $vapid['publicKey'] ?? '',
    ], 200);
}

if ($method === 'POST' && $id === 'token') {
    Auth::requirePermission('SEGURIDAD', 'registrar');
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    if (empty($body['nombre'])) {
        ApiResponse::validationError(['nombre' => 'Nombre descriptivo requerido']);
    }
    $scopes = $body['scopes'] ?? [];
    $dias   = (int)($body['dias_expiracion'] ?? 365);

    try {
        $pdo  = Database::connection();
        $stmt = $pdo->prepare("EXEC sp_api_token_crear ?, ?, ?, ?, ?");
        $stmt->bindValue(1, $user['id_persona'], PDO::PARAM_INT);
        $stmt->bindValue(2, $body['nombre'],     PDO::PARAM_STR);
        $stmt->bindValue(3, json_encode($scopes, JSON_UNESCAPED_UNICODE), PDO::PARAM_STR);
        $stmt->bindValue(4, $dias, PDO::PARAM_INT);
        $token = null;
        $stmt->bindParam(5, $token, PDO::PARAM_STR | PDO::PARAM_INPUT_OUTPUT, 128);
        $stmt->execute();
        $row = $stmt->fetch();

        ApiResponse::success([
            'token'    => $row['token'] ?? $token,
            'id_token' => (int)$row['id_token'],
            'scopes'   => $scopes,
            'expira'   => date('c', time() + $dias * 86400),
        ], 201, 'Token creado. Guardelo en lugar seguro - no se volvera a mostrar.');
    } catch (Throwable $e) {
        ApiResponse::error('token_creation_failed', $e->getMessage(), 500);
    }
}

ApiResponse::error('not_found', 'Sub-recurso de auth no encontrado.', 404);
