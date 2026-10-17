<?php
/**
 * api/routes/tickets.php
 *
 * CRUD RESTful de tickets (resumido - el sistema ya tiene SPs completos).
 *   GET    /tickets                     - Listado con filtros + paginacion
 *   POST   /tickets                     - Crear ticket (requiere sp_ticket_create)
 *   GET    /tickets/{id}                 - Detalle + trazabilidad
 *   PATCH  /tickets/{id}/status          - Cambiar estado
 *   GET    /tickets/{id}/files          - Listar archivos adjuntos
 *   POST   /tickets/{id}/files          - Subir archivo (multipart)
 *   POST   /tickets/{id}/atenciones     - Registrar atencion
 */

Auth::requirePermission('TICKETS', 'ver');

$method = $_SERVER['REQUEST_METHOD'];
$id     = $segments[1] ?? null;
$action = $segments[2] ?? null;
$fileId = $segments[3] ?? null;
$documentStorage = dirname(__DIR__, 2) . '/storage/ticket_documents';

/* ---- GET /tickets ---- */
if ($method === 'GET' && $id === null) {
    Auth::requirePermission('TICKETS', 'ver');
    $page    = max(1, (int)($_GET['page'] ?? 1));
    $perPage = min(200, max(10, (int)($_GET['per_page'] ?? 50)));

    $rows = Database::callSP('sp_ticket_list', [
        $_GET['estado']            ?? null,
        $_GET['prioridad']         ?? null,
        $_GET['id_empresa']        ?? null,
        $_GET['id_sucursal']       ?? null,
        $_GET['id_rubro']          ?? null,
        $_GET['id_contacto']       ?? null,
        $_GET['id_usuario']        ?? null,
        $_GET['fecha_desde']       ?? null,
        $_GET['fecha_hasta']       ?? null,
        $_GET['search']             ?? null,
        $_GET['id_motivo']         ?? null,
    ]);
    $total = count($rows);
    $paged = array_slice($rows, ($page - 1) * $perPage, $perPage);
    ApiResponse::paginated($paged, $total, $page, $perPage);
}

/* ---- POST /tickets ---- */
if ($method === 'POST' && $id === null) {
    Auth::requirePermission('TICKETS', 'registrar');
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    foreach (['id_usuario','id_empresa_contacto','id_empresa','detalle_reporte'] as $k) {
        if (empty($body[$k])) ApiResponse::validationError([$k => 'Requerido']);
    }
    $pdo  = Database::connection();
    $stmt = $pdo->prepare("EXEC sp_ticket_create ?, ?, ?, ?, ?, ?, ?, ?, ?, ?");
    $stmt->bindValue(1, $body['id_usuario'],            PDO::PARAM_INT);
    $stmt->bindValue(2, $body['id_empresa_contacto'], PDO::PARAM_INT);
    $stmt->bindValue(3, $body['id_empresa'],            PDO::PARAM_INT);
    $stmt->bindValue(4, $body['id_sucursal'] ?? null, PDO::PARAM_INT);
    $stmt->bindValue(5, $body['detalle_reporte'],     PDO::PARAM_STR);
    $stmt->bindValue(6, $body['prioridad']     ?? 'MEDIA',  PDO::PARAM_STR);
    $stmt->bindValue(7, $body['medio_contacto'] ?? 'SISTEMA', PDO::PARAM_STR);
    $stmt->bindValue(8, $body['id_motivo_contacto'] ?? null, PDO::PARAM_INT);
    $nroTicket = null;
    $idTicket  = null;
    $stmt->bindParam(9, $nroTicket, PDO::PARAM_STR | PDO::PARAM_INPUT_OUTPUT, 50);
    $stmt->bindParam(10, $idTicket, PDO::PARAM_INT | PDO::PARAM_INPUT_OUTPUT, 32);
    $stmt->execute();
    $row = $stmt->fetch();

    // Disparar notificaciones automaticas
    $idNew = (int)($row['id_ticket'] ?? $idTicket);
    $nro   = $row['nro_ticket'] ?? $nroTicket;
    if ($idNew) {
        require_once __DIR__ . '/../../modules/notificaciones/push_dispatcher.php';
        $tecnicos = $pdo->query(
            "SELECT p.id_persona FROM persona_rol_asignacion pra
             INNER JOIN persona p ON pra.id_persona = p.id_persona
             INNER JOIN persona_rol pr ON pra.id_rol = pr.id_rol
             WHERE pr.nombre IN ('TECNICO','SOPORTE') AND p.activo = 1
             FOR JSON PATH")->fetchColumn();
        if ($tecnicos) {
            Database::callSP('sp_notificacion_enviar', [
                'TICKET_CREADO', $tecnicos,
                json_encode(['nro_ticket' => $nro, 'prioridad' => $body['prioridad'] ?? 'MEDIA']),
                $idNew, 'TICKETS'
            ]);
        }
    }

    ApiResponse::success(['id_ticket' => $idNew, 'nro_ticket' => $nro], 201, 'Ticket creado');
}

/* ---- GET /tickets/{id} ---- */
if ($method === 'GET' && $id !== null && $action === null) {
    $rows = Database::callSP('sp_ticket_traceability', [(int)$id]);
    $ticket = $rows[0] ?? null;
    if (!$ticket) ApiResponse::error('not_found', 'Ticket no encontrado.', 404);

    // Historial y atenciones desde multiples result sets
    $pdo = Database::connection();
    $stmt = $pdo->query("SELECT * FROM ticket_historial_estado WHERE id_ticket = " . (int)$id . " ORDER BY fecha_cambio DESC");
    $hist = $stmt->fetchAll();
    $stmt = $pdo->query("SELECT * FROM atencion WHERE id_ticket = " . (int)$id . " ORDER BY id_atencion DESC");
    $atenc = $stmt->fetchAll();
    ApiResponse::success(['ticket' => $ticket, 'historial' => $hist, 'atenciones' => $atenc], 200);
}

/* ---- Archivos del ticket ---- */
if ($id !== null && $action === 'files' && $method === 'GET') {
    $pdo = Database::connection();
    $check = $pdo->prepare('SELECT 1 FROM dbo.ticket WHERE id_ticket = ?');
    $check->execute([(int)$id]);
    if (!$check->fetchColumn()) ApiResponse::error('not_found', 'Ticket no encontrado.', 404);

    if ($fileId === null) {
        $stmt = $pdo->prepare("SELECT id_documento, nombre_original, tipo_mime, tamano_bytes, fecha_registro
                               FROM dbo.ticket_documento WHERE id_ticket = ? ORDER BY id_documento DESC");
        $stmt->execute([(int)$id]);
        ApiResponse::success($stmt->fetchAll(), 200);
    }

    $stmt = $pdo->prepare("SELECT nombre_original, archivo_key, tipo_mime, tamano_bytes
                           FROM dbo.ticket_documento WHERE id_ticket = ? AND id_documento = ?");
    $stmt->execute([(int)$id, (int)$fileId]);
    $document = $stmt->fetch();
    if (!$document) ApiResponse::error('not_found', 'Documento no encontrado.', 404);
    if (!preg_match('/^[a-f0-9]{48}$/', $document['archivo_key'])) {
        ApiResponse::error('invalid_file', 'Documento no disponible.', 404);
    }
    $path = $documentStorage . '/' . $document['archivo_key'];
    if (!is_file($path)) ApiResponse::error('not_found', 'Archivo no disponible.', 404);

    header('Content-Type: application/octet-stream');
    header('X-Content-Type-Options: nosniff');
    header('Content-Length: ' . filesize($path));
    header("Content-Disposition: attachment; filename*=UTF-8''" . rawurlencode($document['nombre_original']));
    readfile($path);
    exit;
}

if ($id !== null && $action === 'files' && $method === 'POST' && $fileId === null) {
    Auth::requirePermission('TICKETS', 'modificar');
    $file = $_FILES['documento'] ?? null;
    if (!$file || !isset($file['error']) || $file['error'] !== UPLOAD_ERR_OK) {
        ApiResponse::validationError(['documento' => 'Seleccione un archivo valido.']);
    }
    if ($file['size'] < 1 || $file['size'] > 10 * 1024 * 1024) {
        ApiResponse::validationError(['documento' => 'El archivo debe pesar hasta 10 MB.']);
    }

    $originalName = basename(str_replace('\\', '/', (string)$file['name']));
    $originalName = preg_replace('/[\x00-\x1F\x7F]/u', '', $originalName) ?? '';
    $originalName = mb_substr($originalName, 0, 255);
    $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']) ?: 'application/octet-stream';
    $allowedTypes = [
        'pdf' => ['application/pdf'],
        'jpg' => ['image/jpeg'], 'jpeg' => ['image/jpeg'], 'png' => ['image/png'],
        'gif' => ['image/gif'], 'txt' => ['text/plain'],
        'csv' => ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
        'doc' => ['application/msword'],
        'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
        'xls' => ['application/vnd.ms-excel'],
        'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
        'ppt' => ['application/vnd.ms-powerpoint'],
        'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip'],
    ];
    if ($originalName === '' || !isset($allowedTypes[$extension]) || !in_array($mime, $allowedTypes[$extension], true)) {
        ApiResponse::validationError(['documento' => 'Formato de documento no permitido.']);
    }

    $pdo = Database::connection();
    $check = $pdo->prepare('SELECT 1 FROM dbo.ticket WHERE id_ticket = ?');
    $check->execute([(int)$id]);
    if (!$check->fetchColumn()) ApiResponse::error('not_found', 'Ticket no encontrado.', 404);
    if (!is_dir($documentStorage) && !mkdir($documentStorage, 0770, true) && !is_dir($documentStorage)) {
        ApiResponse::error('storage_unavailable', 'No se pudo preparar el almacenamiento de documentos.', 500);
    }
    if (!is_writable($documentStorage)) {
        ApiResponse::error('storage_unavailable', 'El almacenamiento de documentos no permite escritura.', 500);
    }

    $fileKey = bin2hex(random_bytes(24));
    $path = $documentStorage . '/' . $fileKey;
    if (!move_uploaded_file($file['tmp_name'], $path)) {
        ApiResponse::error('upload_failed', 'No se pudo guardar el documento.', 500);
    }
    try {
        $stmt = $pdo->prepare("INSERT INTO dbo.ticket_documento
            (id_ticket, nombre_original, archivo_key, tipo_mime, tamano_bytes, id_usuario)
            VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->execute([(int)$id, $originalName, $fileKey, $mime, (int)$file['size'], (int)$user['id_persona']]);
        $documentId = (int)$pdo->lastInsertId();
    } catch (Throwable $e) {
        @unlink($path);
        throw $e;
    }
    ApiResponse::success(['id_documento' => $documentId], 201, 'Documento adjuntado al ticket.');
}

if ($id !== null && $action === 'files' && $method === 'DELETE' && $fileId !== null) {
    Auth::requirePermission('TICKETS', 'modificar');
    $pdo = Database::connection();
    $stmt = $pdo->prepare("SELECT archivo_key FROM dbo.ticket_documento
                           WHERE id_ticket = ? AND id_documento = ?");
    $stmt->execute([(int)$id, (int)$fileId]);
    $document = $stmt->fetch();
    if (!$document) ApiResponse::error('not_found', 'Documento no encontrado.', 404);
    $stmt = $pdo->prepare('DELETE FROM dbo.ticket_documento WHERE id_ticket = ? AND id_documento = ?');
    $stmt->execute([(int)$id, (int)$fileId]);
    if (preg_match('/^[a-f0-9]{48}$/', $document['archivo_key'])) {
        @unlink($documentStorage . '/' . $document['archivo_key']);
    }
    ApiResponse::success(null, 200, 'Documento eliminado.');
}

/* ---- PATCH /tickets/{id}/status ---- */
if ($method === 'PATCH' && $action === 'status') {
    Auth::requirePermission('TICKETS', 'modificar');
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    if (empty($body['nuevo_estado']) || empty($body['motivo'])) {
        ApiResponse::validationError(['nuevo_estado' => 'Requerido', 'motivo' => 'Requerido']);
    }
    Database::callSP('sp_ticket_update_status', [
        (int)$id, $body['nuevo_estado'], substr($body['motivo'], 0, 255), $user['id_persona']
    ]);
    ApiResponse::success(null, 200, 'Estado actualizado');
}

ApiResponse::error('not_found', 'Sub-recurso de tickets no encontrado.', 404);
