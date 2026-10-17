<?php
/**
 * api/routes/personas.php - CRUD de Personas/Usuarios
 */
$method = $_SERVER['REQUEST_METHOD'];
$id     = $segments[1] ?? null;

if ($method === 'GET' && $id === null) {
    Auth::requireAnyPermission([['PERSONAS', 'ver'], ['CONTACTOS', 'ver']]);
} else {
    Auth::requirePermission('PERSONAS', 'ver');
}

if ($method === 'GET' && $id === null) {
    $pdo = Database::connection();
    $search = $_GET['query'] ?? '';
    $stmt = $pdo->prepare("
        SELECT TOP 200 id_persona, tipo_documento, numero_documento, nombres,
               apellido_paterno, apellido_materno, correo, telefono, estado,
               bloqueado, activo, id_empresa, id_sucursal
        FROM persona WITH (NOLOCK)
        WHERE activo = 1 AND (
            ? = '' OR
            nombres LIKE '%' + ? + '%' OR
            apellido_paterno LIKE '%' + ? + '%' OR
            numero_documento LIKE '%' + ? + '%' OR
            correo LIKE '%' + ? + '%'
        )
        ORDER BY apellido_paterno, nombres");
    $stmt->execute([$search, $search, $search, $search, $search]);
    ApiResponse::success($stmt->fetchAll(), 200);
}

if ($method === 'GET' && $id !== null) {
    $pdo = Database::connection();
    $stmt = $pdo->prepare("
        SELECT p.id_persona, p.tipo_documento, p.numero_documento, p.nombres,
               p.apellido_paterno, p.apellido_materno, p.fecha_nacimiento,
               p.telefono, p.correo, p.direccion, p.sexo, p.estado, p.bloqueado,
               p.activo, p.id_empresa, p.id_sucursal,
               pra.id_rol, pr.nombre AS rol_nombre
        FROM persona p WITH (NOLOCK)
        LEFT JOIN persona_rol_asignacion pra WITH (NOLOCK) ON p.id_persona = pra.id_persona
        LEFT JOIN persona_rol pr WITH (NOLOCK) ON pra.id_rol = pr.id_rol
        WHERE p.id_persona = ?");
    $stmt->execute([(int)$id]);
    $row = $stmt->fetch();
    if (!$row) ApiResponse::error('not_found', 'Persona no encontrada', 404);
    ApiResponse::success($row, 200);
}

if ($method === 'POST' && $id === null) {
    Auth::requirePermission('PERSONAS', 'registrar');
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    foreach (['tipo_documento', 'nombres', 'apellido_paterno', 'correo'] as $k) {
        if (empty($body[$k])) ApiResponse::validationError([$k => 'Requerido']);
    }

    // Hash bcrypt de la contrasena si viene, sino usar DEFAULT_PASS
    $hash = !empty($body['contrasena']) ? password_hash($body['contrasena'], PASSWORD_BCRYPT) : null;

    $pdo = Database::connection();
    // Insertar directamente porque el SP usa 'DEFAULT_PASS' literal
    $stmt = $pdo->prepare("
        INSERT INTO persona (tipo_documento, numero_documento, nombres, apellido_paterno,
                             apellido_materno, correo, telefono, direccion, sexo, estado,
                             contrasena, bloqueado, activo)
        OUTPUT INSERTED.id_persona
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 1)");
    $stmt->execute([
        $body['tipo_documento'],
        $body['numero_documento'] ?? null,
        $body['nombres'],
        $body['apellido_paterno'],
        $body['apellido_materno'] ?? null,
        $body['correo'],
        $body['telefono'] ?? null,
        $body['direccion'] ?? null,
        $body['sexo'] ?? null,
        $hash ?? 'DEFAULT_PASS',
    ]);
    $newId = (int)$stmt->fetchColumn();

    // Asignar rol si viene
    if (!empty($body['id_rol'])) {
        $pdo->prepare("INSERT INTO persona_rol_asignacion (id_persona, id_rol, asignado_por) VALUES (?, ?, ?)")
            ->execute([$newId, (int)$body['id_rol'], $user['id_persona'] ?? null]);
    }

    ApiResponse::success(['id_persona' => $newId], 201, 'Persona creada');
}

if ($method === 'PUT' && $id !== null) {
    Auth::requirePermission('PERSONAS', 'modificar');
    $body = json_decode(file_get_contents('php://input'), true) ?: [];

    $pdo = Database::connection();
    $updates = [];
    $params = [];
    $fields = ['tipo_documento', 'numero_documento', 'nombres', 'apellido_paterno',
               'apellido_materno', 'correo', 'telefono', 'direccion', 'sexo', 'estado'];

    foreach ($fields as $f) {
        if (array_key_exists($f, $body)) {
            $updates[] = "$f = ?";
            $params[] = $body[$f];
        }
    }

    // Cambio de contrasena si viene
    if (!empty($body['contrasena'])) {
        $hash = password_hash($body['contrasena'], PASSWORD_BCRYPT);
        $updates[] = "contrasena = ?";
        $params[] = $hash;
    }

    // Cambio de bloqueado si viene
    if (array_key_exists('bloqueado', $body)) {
        $updates[] = "bloqueado = ?";
        $params[] = (int)$body['bloqueado'];
    }

    if (empty($updates)) ApiResponse::validationError(['campos' => 'Nada que actualizar']);

    $params[] = (int)$id;
    $sql = "UPDATE persona SET " . implode(', ', $updates) . " WHERE id_persona = ?";
    $pdo->prepare($sql)->execute($params);

    // Actualizar rol si viene
    if (!empty($body['id_rol'])) {
        $pdo->prepare("DELETE FROM persona_rol_asignacion WHERE id_persona = ?")->execute([(int)$id]);
        $pdo->prepare("INSERT INTO persona_rol_asignacion (id_persona, id_rol, asignado_por) VALUES (?, ?, ?)")
            ->execute([(int)$id, (int)$body['id_rol'], $user['id_persona'] ?? null]);
    }

    ApiResponse::success(['id_persona' => (int)$id], 200, 'Persona actualizada');
}

if ($method === 'DELETE' && $id !== null) {
    Auth::requirePermission('PERSONAS', 'eliminar');
    // Soft delete
    $pdo = Database::connection();
    $pdo->prepare("UPDATE persona SET activo = 0, fecha_baja = GETDATE() WHERE id_persona = ?")
        ->execute([(int)$id]);
    ApiResponse::success(['success' => 1], 200, 'Persona desactivada');
}

ApiResponse::error('not_found', 'Endpoint no encontrado', 404);
