<?php
/**
 * api/routes/atenciones.php - Listado de atenciones
 *
 *   GET /atenciones                    - Listado (filtros: id_ticket, id_usuario, estado)
 *   GET    /atenciones/{id_atencion}   - Detalle
 *   POST   /atenciones                 - Crear atencion
 *   PUT    /atenciones/{id_atencion}   - Actualizar atencion
 *   DELETE /atenciones/{id_atencion}   - Eliminar atencion
 */
Auth::requirePermission('TICKETS', 'ver');

$method = $_SERVER['REQUEST_METHOD'];
$id     = $segments[1] ?? null;

if ($method === 'GET' && $id === null) {
    $pdo = Database::connection();
    $where = "WHERE 1=1";
    $params = [];
    if (!empty($_GET['id_ticket'])) {
        $where .= " AND a.id_ticket = ?";
        $params[] = (int)$_GET['id_ticket'];
    }
    if (!empty($_GET['id_usuario'])) {
        $where .= " AND a.id_usuario = ?";
        $params[] = (int)$_GET['id_usuario'];
    }
    if (!empty($_GET['estado'])) {
        $where .= " AND a.estado = ?";
        $params[] = $_GET['estado'];
    }
    $sql = "SELECT TOP 200 a.id_atencion, a.id_ticket, a.id_usuario, a.fecha_inicio, a.hora_inicio,
                   a.fecha_fin, a.hora_fin, a.detalle_atencion, a.solucion_aplicada, a.estado,
                   p.nombres + ' ' + p.apellido_paterno AS tecnico_nombre,
                   at.duracion_minutos, at.duracion_formato,
                   t.nro_ticket, e.razon_social AS empresa_nombre
            FROM atencion a WITH (NOLOCK)
            INNER JOIN persona p WITH (NOLOCK) ON a.id_usuario = p.id_persona
            INNER JOIN ticket t WITH (NOLOCK) ON a.id_ticket = t.id_ticket
            LEFT JOIN empresa e WITH (NOLOCK) ON t.id_empresa = e.id_empresa
            LEFT JOIN atencion_tiempo at WITH (NOLOCK) ON a.id_atencion = at.id_atencion
            $where ORDER BY a.id_atencion DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    $ticketIds = array_values(array_unique(array_map('intval', array_column($rows, 'id_ticket'))));
    if ($ticketIds) {
        $marks = implode(',', array_fill(0, count($ticketIds), '?'));
        $docStmt = $pdo->prepare("SELECT id_ticket, id_documento, nombre_original, tamano_bytes
                                  FROM dbo.ticket_documento WHERE id_ticket IN ($marks)
                                  ORDER BY id_documento");
        $docStmt->execute($ticketIds);
        $documents = [];
        foreach ($docStmt->fetchAll() as $document) {
            $documents[(int)$document['id_ticket']][] = $document;
        }
        foreach ($rows as &$row) {
            $row['documentos'] = $documents[(int)$row['id_ticket']] ?? [];
        }
        unset($row);
    }
    ApiResponse::success($rows, 200);
}

if ($method === 'GET' && $id !== null) {
    $pdo = Database::connection();
        $stmt = $pdo->prepare("SELECT a.*, p.nombres + ' ' + p.apellido_paterno AS tecnico_nombre,
                          at.duracion_minutos, at.duracion_formato, t.nro_ticket,
                          e.razon_social AS empresa_nombre
                           FROM atencion a
                           INNER JOIN persona p ON a.id_usuario = p.id_persona
                           INNER JOIN ticket t ON a.id_ticket = t.id_ticket
                      LEFT JOIN empresa e ON t.id_empresa = e.id_empresa
                           LEFT JOIN atencion_tiempo at ON a.id_atencion = at.id_atencion
                           WHERE a.id_atencion = ?");
    $stmt->execute([(int)$id]);
    $row = $stmt->fetch();
    if (!$row) ApiResponse::error('not_found', 'Atencion no encontrada', 404);
    $docStmt = $pdo->prepare("SELECT id_documento, nombre_original, tamano_bytes
                              FROM dbo.ticket_documento WHERE id_ticket = ? ORDER BY id_documento");
    $docStmt->execute([(int)$row['id_ticket']]);
    $row['documentos'] = $docStmt->fetchAll();
    ApiResponse::success($row, 200);
}

if ($method === 'POST' && $id === null) {
    Auth::requirePermission('TICKETS', 'modificar');
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    foreach (['id_ticket', 'detalle_atencion'] as $k) {
        if (empty($body[$k])) ApiResponse::validationError([$k => 'Requerido']);
    }
    $pdo = Database::connection();
    $stmt = $pdo->prepare("EXEC sp_atencion_create ?, ?, ?, ?, ?, ?, ?, ?, ?, ?");
    $stmt->bindValue(1, (int)$body['id_ticket'], PDO::PARAM_INT);
    $stmt->bindValue(2, $user['id_persona'], PDO::PARAM_INT);
    $stmt->bindValue(3, $body['detalle_atencion'], PDO::PARAM_STR);
    $stmt->bindValue(4, $body['solucion_aplicada'] ?? null, PDO::PARAM_STR);
    $stmt->bindValue(5, $body['estado'] ?? 'EN_PROCESO', PDO::PARAM_STR);
    $stmt->bindValue(6, $body['fecha_inicio'] ?? null, PDO::PARAM_STR);
    $stmt->bindValue(7, $body['hora_inicio'] ?? null, PDO::PARAM_STR);
    $stmt->bindValue(8, $body['fecha_fin'] ?? null, PDO::PARAM_STR);
    $stmt->bindValue(9, $body['hora_fin'] ?? null, PDO::PARAM_STR);
    $newId = null;
    $stmt->bindParam(10, $newId, PDO::PARAM_INT | PDO::PARAM_INPUT_OUTPUT, 32);
    $stmt->execute();
    $row = $stmt->fetch();
    ApiResponse::success(['id_atencion' => (int)($row['id_atencion'] ?? $newId)], 201, 'Atencion creada');
}

if ($method === 'PUT' && $id !== null) {
    Auth::requirePermission('TICKETS', 'modificar');
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $detalle = trim((string)($body['detalle_atencion'] ?? ''));
    $estado = (string)($body['estado'] ?? '');
    $errors = [];
    if ($detalle === '') $errors['detalle_atencion'] = 'Requerido';
    if (!in_array($estado, ['EN_PROCESO', 'COMPLETADO', 'PAUSADO'], true)) $errors['estado'] = 'Estado no valido';
    if ($errors) ApiResponse::validationError($errors);
    $pdo = Database::connection();
    $stmt = $pdo->prepare("UPDATE dbo.atencion
                           SET detalle_atencion = ?, solucion_aplicada = ?, estado = ?
                           WHERE id_atencion = ?");
    $stmt->execute([$detalle, trim((string)($body['solucion_aplicada'] ?? '')) ?: null, $estado, (int)$id]);
    if ($stmt->rowCount() === 0) {
        $check = $pdo->prepare('SELECT 1 FROM dbo.atencion WHERE id_atencion = ?');
        $check->execute([(int)$id]);
        if (!$check->fetchColumn()) ApiResponse::error('not_found', 'Atencion no encontrada', 404);
    }
    ApiResponse::success(['id_atencion' => (int)$id], 200, 'Atencion actualizada');
}

if ($method === 'DELETE' && $id !== null) {
    Auth::requirePermission('TICKETS', 'eliminar');
    $pdo = Database::connection();
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('DELETE FROM dbo.atencion_tiempo WHERE id_atencion = ?');
        $stmt->execute([(int)$id]);
        $stmt = $pdo->prepare('DELETE FROM dbo.atencion WHERE id_atencion = ?');
        $stmt->execute([(int)$id]);
        if ($stmt->rowCount() === 0) {
            $pdo->rollBack();
            ApiResponse::error('not_found', 'Atencion no encontrada', 404);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    ApiResponse::success(null, 200, 'Atencion eliminada');
}

ApiResponse::error('not_found', 'Endpoint no encontrado', 404);
