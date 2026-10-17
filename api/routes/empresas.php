<?php
/**
 * api/routes/empresas.php - CRUD de Empresas
 *
 *   GET    /empresas              - Listado (con filtro ?query=)
 *   GET    /empresas/{id}         - Detalle
 *   POST   /empresas              - Crear
 *   PUT    /empresas/{id}         - Actualizar
 *   DELETE /empresas/{id}         - Dar de baja
 *   PATCH  /empresas/{id}/reactivar - Reactivar
 */
$method = $_SERVER['REQUEST_METHOD'];
$id     = $segments[1] ?? null;
$action = $segments[2] ?? null;
if ($method === 'GET') {
    Auth::requireAnyPermission([
        ['EMPRESAS', 'ver'], ['CONTACTOS', 'ver'], ['SUCURSALES', 'ver'], ['TICKETS', 'ver'],
    ]);
} else {
    Auth::requirePermission('EMPRESAS', 'ver');
}
$pdo = Database::connection();
$hasBajaColumns = (bool)$pdo->query(
    "SELECT CASE WHEN COL_LENGTH('dbo.empresa', 'activo') IS NOT NULL
                       AND COL_LENGTH('dbo.empresa', 'fecha_baja') IS NOT NULL
                 THEN 1 ELSE 0 END"
)->fetchColumn();
$hasSedePrincipalFlag = (bool)$pdo->query(
        "SELECT COUNT(*) FROM sys.parameters
         WHERE object_id = OBJECT_ID('dbo.sp_empresa_guardar')
             AND name = '@crear_sede_principal'"
)->fetchColumn();
$empresaSelect = "SELECT e.id_empresa, e.ruc, e.razon_social, e.nombre_comercial,
                         e.correo, e.telefono, e.id_rubro, r.nombre AS rubro,
                         e.id_grupo, g.nombre AS grupo, u.direccion, u.referencia,
                         u.id_division, dbo.fn_pais_de_division(u.id_division) AS id_pais,
                         dbo.fn_obtener_ruta_geografica(u.id_division) AS ubicacion_completa,
                         e.activo, e.fecha_baja,
                         CASE WHEN EXISTS (
                             SELECT 1 FROM dbo.empresa_sucursal sede
                             WHERE sede.id_empresa = e.id_empresa AND sede.es_principal = 1 AND sede.activo = 1
                         ) THEN 1 ELSE 0 END AS tiene_sede_principal
                  FROM dbo.empresa e
                  LEFT JOIN dbo.rubro r ON r.id_rubro = e.id_rubro
                  LEFT JOIN dbo.grupo_empresarial g ON g.id_grupo = e.id_grupo
                  LEFT JOIN dbo.ubicacion u ON u.id_ubicacion = e.id_ubicacion";

/* ---- GET /empresas ---- */
if ($method === 'GET' && $id === null) {
    $query = $_GET['query'] ?? null;
    $includeInactive = ($_GET['estado'] ?? '') === 'baja';
    if ($includeInactive) {
        if (!$hasBajaColumns) {
            ApiResponse::error('migration_required', 'Ejecute scripts_sql/09_empresa_bajas.sql para consultar empresas dadas de baja.', 503);
        }
        $term = trim((string)$query);
        $sql = $empresaSelect . ' WHERE e.activo = 0';
        $params = [];
        if ($term !== '') {
            $sql .= ' AND (e.ruc LIKE ? OR e.razon_social LIKE ? OR e.correo LIKE ?)';
            $search = '%' . $term . '%';
            array_push($params, $search, $search, $search);
        }
        $stmt = $pdo->prepare($sql . ' ORDER BY e.razon_social');
        $stmt->execute($params);
        ApiResponse::success($stmt->fetchAll(), 200);
    }

    if ($hasBajaColumns) {
        $term = trim((string)$query);
        $sql = $empresaSelect . ' WHERE e.activo = 1';
        $params = [];
        if ($term !== '') {
            $sql .= ' AND (e.ruc LIKE ? OR e.razon_social LIKE ? OR e.nombre_comercial LIKE ? OR e.correo LIKE ?)';
            $search = '%' . $term . '%';
            array_push($params, $search, $search, $search, $search);
        }
        $stmt = $pdo->prepare($sql . ' ORDER BY e.razon_social');
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
    } else {
        $rows = Database::callSP('sp_empresa_buscar', [$query]);
        foreach ($rows as &$row) $row['activo'] = 1;
        unset($row);
    }
    ApiResponse::success($rows, 200);
}

/* ---- GET /empresas/{id} ---- */
if ($method === 'GET' && $id !== null) {
    $stmt = $pdo->prepare($empresaSelect . ' WHERE e.id_empresa = ?');
    $stmt->execute([(int)$id]);
    $row = $stmt->fetch();
    if (!$row) ApiResponse::error('not_found', 'Empresa no encontrada', 404);
    $statusSql = $hasBajaColumns
        ? 'SELECT activo, fecha_baja FROM dbo.empresa WHERE id_empresa = ?'
        : 'SELECT 1 AS activo FROM dbo.empresa WHERE id_empresa = ?';
    $statusStmt = $pdo->prepare($statusSql);
    $statusStmt->execute([(int)$id]);
    $status = $statusStmt->fetch() ?: [];
    $row['activo'] = isset($status['activo']) ? (int)$status['activo'] : 1;
    $row['fecha_baja'] = $status['fecha_baja'] ?? null;
    $row['id_pais'] = null;
    ApiResponse::success($row, 200);
}

/* ---- POST /empresas ---- */
if ($method === 'POST' && $id === null) {
    Auth::requirePermission('EMPRESAS', 'registrar');
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    foreach (['ruc', 'razon_social', 'correo', 'id_rubro', 'direccion', 'id_division'] as $k) {
        if (empty($body[$k])) ApiResponse::validationError([$k => 'Requerido']);
    }
    if (!preg_match('/^[0-9]{1,11}$/D', trim((string)$body['ruc']))) {
        ApiResponse::validationError(['ruc' => 'El RUC debe contener solo numeros y maximo 11 digitos']);
    }
    if (empty($body['crear_sede_principal']) && !$hasSedePrincipalFlag) {
        ApiResponse::error(
            'migration_required',
            'Aplique scripts_sql/10_empresa_sede_principal.sql para omitir la sede principal.',
            409
        );
    }

    $pdo = Database::connection();
    $placeholders = implode(',', array_fill(0, $hasSedePrincipalFlag ? 13 : 12, '?'));
    $stmt = $pdo->prepare("EXEC sp_empresa_guardar $placeholders");
    $savedId = 0;
    $stmt->bindParam(1, $savedId, PDO::PARAM_INT | PDO::PARAM_INPUT_OUTPUT, 32);
    $stmt->bindValue(2, $body['ruc'], PDO::PARAM_STR);
    $stmt->bindValue(3, $body['razon_social'], PDO::PARAM_STR);
    $stmt->bindValue(4, $body['nombre_comercial'] ?? null, PDO::PARAM_STR);
    $stmt->bindValue(5, $body['telefono'] ?? null, PDO::PARAM_STR);
    $stmt->bindValue(6, $body['correo'], PDO::PARAM_STR);
    $stmt->bindValue(7, $body['id_rubro'] ?? null, isset($body['id_rubro']) ? PDO::PARAM_INT : PDO::PARAM_NULL);
    $stmt->bindValue(8, $body['id_grupo'] ?? null, isset($body['id_grupo']) ? PDO::PARAM_INT : PDO::PARAM_NULL);
    $stmt->bindValue(9, $body['direccion'], PDO::PARAM_STR);
    $stmt->bindValue(10, $body['referencia'] ?? null, PDO::PARAM_STR);
    $stmt->bindValue(11, $body['id_division'], PDO::PARAM_INT);
    $stmt->bindValue(12, $user['correo'] ?? 'Sistema', PDO::PARAM_STR);
    if ($hasSedePrincipalFlag) {
        $stmt->bindValue(13, !empty($body['crear_sede_principal']), PDO::PARAM_BOOL);
    }
    $stmt->execute();
    $row = $stmt->fetch();
    ApiResponse::success(['id_empresa' => (int)($row['id_empresa'] ?? $savedId)], 201, 'Empresa creada');
}

/* ---- PUT /empresas/{id} ---- */
if ($method === 'PUT' && $id !== null) {
    Auth::requirePermission('EMPRESAS', 'modificar');
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    foreach (['ruc', 'razon_social', 'correo', 'id_rubro'] as $k) {
        if (empty($body[$k])) ApiResponse::validationError([$k => 'Requerido']);
    }
    if (!preg_match('/^[0-9]{1,11}$/D', trim((string)$body['ruc']))) {
        ApiResponse::validationError(['ruc' => 'El RUC debe contener solo numeros y maximo 11 digitos']);
    }

    $pdo = Database::connection();
    $principalStmt = $pdo->prepare(
        'SELECT 1 FROM dbo.empresa_sucursal WHERE id_empresa = ? AND es_principal = 1 AND activo = 1'
    );
    $principalStmt->execute([(int)$id]);
    $hasPrimaryBranch = (bool)$principalStmt->fetchColumn();

    if ($hasPrimaryBranch) {
        $duplicate = $pdo->prepare('SELECT 1 FROM dbo.empresa WHERE ruc = ? AND id_empresa <> ?');
        $duplicate->execute([trim((string)$body['ruc']), (int)$id]);
        if ($duplicate->fetchColumn()) ApiResponse::validationError(['ruc' => 'El RUC ya esta registrado']);
        $duplicate = $pdo->prepare('SELECT 1 FROM dbo.empresa WHERE correo = ? AND id_empresa <> ?');
        $duplicate->execute([trim((string)$body['correo']), (int)$id]);
        if ($duplicate->fetchColumn()) ApiResponse::validationError(['correo' => 'El correo ya esta registrado']);

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare("UPDATE dbo.empresa
                SET ruc = ?, razon_social = ?, nombre_comercial = ?, telefono = ?,
                    correo = ?, id_rubro = ?, id_grupo = ?
                WHERE id_empresa = ?");
            $stmt->execute([
                trim((string)$body['ruc']),
                trim((string)$body['razon_social']),
                trim((string)($body['nombre_comercial'] ?? '')) ?: null,
                trim((string)($body['telefono'] ?? '')) ?: null,
                trim((string)$body['correo']),
                (int)$body['id_rubro'],
                !empty($body['id_grupo']) ? (int)$body['id_grupo'] : null,
                (int)$id,
            ]);
            $audit = $pdo->prepare("INSERT INTO dbo.auditoria_operacion (usuario, modulo, operacion, detalles)
                VALUES (?, 'EMPRESAS', 'MODIFICACION', ?)");
            $audit->execute([
                $user['correo'] ?? 'Sistema',
                'Se modificaron los datos generales de la empresa ID ' . (int)$id . '; la ubicación y sede principal se conservaron.',
            ]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        ApiResponse::success(['id_empresa' => (int)$id, 'ubicacion_conservada' => true], 200, 'Datos de empresa actualizados; la ubicación no fue modificada');
    }

    foreach (['direccion', 'id_division'] as $k) {
        if (empty($body[$k])) ApiResponse::validationError([$k => 'Requerido']);
    }
    $stmt = $pdo->prepare("EXEC sp_empresa_guardar ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?");
    $savedId = (int)$id;
    $stmt->bindParam(1, $savedId, PDO::PARAM_INT | PDO::PARAM_INPUT_OUTPUT, 32);
    $stmt->bindValue(2, $body['ruc'], PDO::PARAM_STR);
    $stmt->bindValue(3, $body['razon_social'], PDO::PARAM_STR);
    $stmt->bindValue(4, $body['nombre_comercial'] ?? null, PDO::PARAM_STR);
    $stmt->bindValue(5, $body['telefono'] ?? null, PDO::PARAM_STR);
    $stmt->bindValue(6, $body['correo'], PDO::PARAM_STR);
    $stmt->bindValue(7, $body['id_rubro'] ?? null, isset($body['id_rubro']) ? PDO::PARAM_INT : PDO::PARAM_NULL);
    $stmt->bindValue(8, $body['id_grupo'] ?? null, isset($body['id_grupo']) ? PDO::PARAM_INT : PDO::PARAM_NULL);
    $stmt->bindValue(9, $body['direccion'], PDO::PARAM_STR);
    $stmt->bindValue(10, $body['referencia'] ?? null, PDO::PARAM_STR);
    $stmt->bindValue(11, $body['id_division'], PDO::PARAM_INT);
    $stmt->bindValue(12, $user['correo'] ?? 'Sistema', PDO::PARAM_STR);
    $stmt->execute();
    ApiResponse::success(['id_empresa' => (int)$id], 200, 'Empresa actualizada');
}

/* ---- PATCH /empresas/{id}/reactivar ---- */
if ($method === 'PATCH' && $id !== null && $action === 'reactivar') {
    Auth::requirePermission('EMPRESAS', 'modificar');
    $stmt = Database::connection()->prepare(
        'UPDATE dbo.empresa SET activo = 1, fecha_baja = NULL WHERE id_empresa = ?'
    );
    $stmt->execute([(int)$id]);
    if ($stmt->rowCount() === 0) {
        $check = Database::connection()->prepare('SELECT 1 FROM dbo.empresa WHERE id_empresa = ?');
        $check->execute([(int)$id]);
        if (!$check->fetchColumn()) ApiResponse::error('not_found', 'Empresa no encontrada', 404);
    }
    ApiResponse::success(['id_empresa' => (int)$id], 200, 'Empresa reactivada');
}

/* ---- DELETE /empresas/{id}: baja logica ---- */
if ($method === 'DELETE' && $id !== null) {
    Auth::requirePermission('EMPRESAS', 'eliminar');
    if (($_GET['permanente'] ?? '') === '1') {
        $status = $pdo->prepare('SELECT activo FROM dbo.empresa WHERE id_empresa = ?');
        $status->execute([(int)$id]);
        $active = $status->fetchColumn();
        if ($active === false) ApiResponse::error('not_found', 'Empresa no encontrada', 404);
        if ((int)$active === 1) ApiResponse::error('must_be_inactive', 'Primero debe dar de baja la empresa', 409);
        foreach ([
            ['dbo.ticket', 'id_empresa', 'La empresa tiene tickets asociados.'],
            ['dbo.empresa_sucursal', 'id_empresa', 'Elimine definitivamente sus sedes antes de eliminar la empresa.'],
            ['dbo.empresa_contacto', 'id_empresa', 'Elimine definitivamente sus contactos antes de eliminar la empresa.'],
        ] as [$table, $column, $message]) {
            $dependency = $pdo->prepare("SELECT 1 FROM $table WHERE $column = ?");
            $dependency->execute([(int)$id]);
            if ($dependency->fetchColumn()) ApiResponse::error('has_dependencies', $message, 409);
        }
        try {
            $rows = Database::callSP('sp_empresa_eliminar', [(int)$id, $user['correo'] ?? 'Sistema']);
        } catch (Throwable $e) {
            ApiResponse::error('delete_failed', $e->getMessage(), 409);
        }
        ApiResponse::success($rows[0] ?? ['id_empresa' => (int)$id], 200, 'Empresa eliminada definitivamente');
    }
    $stmt = Database::connection()->prepare(
        'UPDATE dbo.empresa SET activo = 0, fecha_baja = SYSUTCDATETIME() WHERE id_empresa = ? AND activo = 1'
    );
    $stmt->execute([(int)$id]);
    if ($stmt->rowCount() === 0) ApiResponse::error('not_found', 'Empresa activa no encontrada', 404);
    ApiResponse::success(['id_empresa' => (int)$id], 200, 'Empresa dada de baja');
}

ApiResponse::error('not_found', 'Endpoint no encontrado', 404);
