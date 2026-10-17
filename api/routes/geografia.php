<?php
/**
 * api/routes/geografia.php - Paises, divisiones (jerarquia), rubros, grupos, motivos
 *
 *   GET /geografia                            - Paises + divisiones (todo)
 *   GET /geografia/paises                     - Lista de paises
 *   GET /geografia/divisiones?id_pais=X       - Divisiones por pais (todas)
 *   GET /geografia/divisiones/hijas?id_padre=X - Hijas de una division (por id_padre)
 *   GET /geografia/divisiones/nivel?nivel=X   - Divisiones de un nivel (1=Pais, 2=Departamento, 3=Provincia, 4=Distrito)
 *   GET /geografia/tipos-division              - Tipos de division
 *   GET /geografia/rubros                     - Rubros
 *   GET /geografia/grupos                     - Grupos empresariales
 *   GET /geografia/motivos                    - Motivos de contacto
 *   GET /geografia/roles                      - Roles
 *   GET /geografia/validate?tabla=X&campo=Y&valor=Z - Validar duplicados
 */
$method = $_SERVER['REQUEST_METHOD'];
$action = $segments[1] ?? null;
$id     = $segments[2] ?? null;

if ($method === 'GET' && in_array($action, [null, 'all', 'paises', 'tipos-division', 'divisiones', 'validate'], true)) {
    Auth::requireAnyPermission([
        ['GEOGRAFIA', 'ver'], ['EMPRESAS', 'ver'], ['SUCURSALES', 'ver'], ['CONTACTOS', 'ver'],
    ]);
} elseif (in_array($method, ['POST', 'PUT', 'DELETE'], true) && $action === 'divisiones') {
    $permission = ['POST' => 'registrar', 'PUT' => 'modificar', 'DELETE' => 'eliminar'][$method];
    Auth::requirePermission('GEOGRAFIA', $permission);
} else {
    ApiResponse::error('method_not_allowed', 'Metodo no permitido para este recurso.', 405);
}

$pdo = Database::connection();

/* ---- GET /geografia (sin parametros o 'all') ---- */
if ($action === null || $action === 'all') {
    $rows = Database::callSP('sp_obtener_geografia', [$_GET['id_pais'] ?? null]);
    ApiResponse::success($rows, 200);
}

/* ---- POST /geografia/divisiones ---- */
if ($method === 'POST' && $action === 'divisiones' && $id === null) {
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $name = trim((string)($body['nombre'] ?? ''));
    $type = (int)($body['id_tipo_division'] ?? 0);
    if ($name === '') ApiResponse::validationError(['nombre' => 'Requerido']);
    if (!in_array($type, [1, 2, 3], true)) ApiResponse::validationError(['id_tipo_division' => 'Use 1 departamento, 2 provincia o 3 distrito']);

    $parentId = null;
    if ($type === 1) {
        $countryId = (int)($body['id_pais'] ?? 0);
        if ($countryId < 1) ApiResponse::validationError(['id_pais' => 'Seleccione un pais']);
        $country = $pdo->prepare('SELECT 1 FROM dbo.pais WHERE id_pais = ?');
        $country->execute([$countryId]);
        if (!$country->fetchColumn()) ApiResponse::validationError(['id_pais' => 'Pais no encontrado']);
    } else {
        $parentId = (int)($body['id_division_padre'] ?? 0);
        if ($parentId < 1) ApiResponse::validationError(['id_division_padre' => 'Seleccione el nivel padre']);
        $parent = $pdo->prepare('SELECT id_tipo_division FROM dbo.division_geografica WHERE id_division = ?');
        $parent->execute([$parentId]);
        if ((int)$parent->fetchColumn() !== $type - 1) {
            ApiResponse::validationError(['id_division_padre' => 'El padre debe pertenecer al nivel geografico anterior']);
        }
        $countryId = (int)$pdo->query('SELECT dbo.fn_pais_de_division(' . $parentId . ')')->fetchColumn();
    }

    $duplicate = $pdo->prepare('SELECT 1 FROM dbo.division_geografica WHERE id_tipo_division = ? AND nombre = ? AND ((id_division_padre = ?) OR (id_division_padre IS NULL AND ? IS NULL))');
    $duplicate->execute([$type, $name, $parentId, $parentId]);
    if ($duplicate->fetchColumn()) ApiResponse::validationError(['nombre' => 'Ya existe una division con ese nombre en ese nivel']);

    $stmt = $pdo->prepare('INSERT INTO dbo.division_geografica (nombre, id_tipo_division, id_division_padre, id_pais) OUTPUT INSERTED.id_division VALUES (?, ?, ?, ?)');
    $stmt->execute([$name, $type, $parentId, $type === 1 ? $countryId : null]);
    ApiResponse::success(['id_division' => (int)$stmt->fetchColumn()], 201, 'Division creada');
}

/* ---- PUT /geografia/divisiones/{id} ---- */
if ($method === 'PUT' && $action === 'divisiones' && $id !== null) {
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $name = trim((string)($body['nombre'] ?? ''));
    if ($name === '') ApiResponse::validationError(['nombre' => 'Requerido']);
    $currentStmt = $pdo->prepare('SELECT id_tipo_division, id_division_padre, id_pais FROM dbo.division_geografica WHERE id_division = ?');
    $currentStmt->execute([(int)$id]);
    $current = $currentStmt->fetch();
    if (!$current) ApiResponse::error('not_found', 'Division no encontrada', 404);
    $type = (int)$current['id_tipo_division'];
    $parentId = $type === 1 ? null : (int)($body['id_division_padre'] ?? $current['id_division_padre']);
    if ($type > 1) {
        $parent = $pdo->prepare('SELECT id_tipo_division FROM dbo.division_geografica WHERE id_division = ?');
        $parent->execute([$parentId]);
        if ((int)$parent->fetchColumn() !== $type - 1) {
            ApiResponse::validationError(['id_division_padre' => 'El padre debe pertenecer al nivel geografico anterior']);
        }
    }
    if ((int)$id === $parentId) ApiResponse::validationError(['id_division_padre' => 'Una division no puede ser su propio padre']);
    $duplicate = $pdo->prepare('SELECT 1 FROM dbo.division_geografica WHERE id_tipo_division = ? AND nombre = ? AND id_division <> ? AND ((id_division_padre = ?) OR (id_division_padre IS NULL AND ? IS NULL))');
    $duplicate->execute([$type, $name, (int)$id, $parentId, $parentId]);
    if ($duplicate->fetchColumn()) ApiResponse::validationError(['nombre' => 'Ya existe una division con ese nombre en ese nivel']);

    if ($type === 1) {
        $countryId = (int)($body['id_pais'] ?? $current['id_pais'] ?? 0);
        $country = $pdo->prepare('SELECT 1 FROM dbo.pais WHERE id_pais = ?');
        $country->execute([$countryId]);
        if (!$country->fetchColumn()) ApiResponse::validationError(['id_pais' => 'Seleccione un pais valido']);
        $stmt = $pdo->prepare('UPDATE dbo.division_geografica SET nombre = ?, id_pais = ? WHERE id_division = ?');
        $stmt->execute([$name, $countryId, (int)$id]);
    } else {
        $stmt = $pdo->prepare('UPDATE dbo.division_geografica SET nombre = ?, id_division_padre = ? WHERE id_division = ?');
        $stmt->execute([$name, $parentId, (int)$id]);
    }
    ApiResponse::success(['id_division' => (int)$id], 200, 'Division actualizada');
}

/* ---- DELETE /geografia/divisiones/{id} ---- */
if ($method === 'DELETE' && $action === 'divisiones' && $id !== null) {
    $check = $pdo->prepare('SELECT 1 FROM dbo.division_geografica WHERE id_division = ?');
    $check->execute([(int)$id]);
    if (!$check->fetchColumn()) ApiResponse::error('not_found', 'Division no encontrada', 404);
    $children = $pdo->prepare('SELECT 1 FROM dbo.division_geografica WHERE id_division_padre = ?');
    $children->execute([(int)$id]);
    if ($children->fetchColumn()) ApiResponse::error('has_children', 'No se puede eliminar: tiene divisiones hijas', 409);
    $used = $pdo->prepare('SELECT 1 FROM dbo.ubicacion WHERE id_division = ?');
    $used->execute([(int)$id]);
    if ($used->fetchColumn()) ApiResponse::error('in_use', 'No se puede eliminar: existen empresas o sedes en esta ubicacion', 409);
    $pdo->prepare('DELETE FROM dbo.division_geografica WHERE id_division = ?')->execute([(int)$id]);
    ApiResponse::success(['id_division' => (int)$id], 200, 'Division eliminada');
}

/* ---- GET /geografia/paises ---- */
if ($action === 'paises') {
    $rows = $pdo->query("SELECT id_pais, nombre, codigo_iso FROM pais ORDER BY nombre")->fetchAll();
    ApiResponse::success($rows, 200);
}

/* ---- GET /geografia/tipos-division ---- */
if ($action === 'tipos-division') {
    $rows = $pdo->query("SELECT id_tipo_division, nombre FROM tipo_division ORDER BY id_tipo_division")->fetchAll();
    ApiResponse::success($rows, 200);
}

/* ---- GET /geografia/divisiones (todas las de un pais) ---- */
if ($action === 'divisiones' && $id === null) {
    $idPais = $_GET['id_pais'] ?? null;
    $sql = "SELECT d.id_division, d.nombre, d.id_tipo_division, d.id_division_padre,
                   COALESCE(d.id_pais, dbo.fn_pais_de_division(d.id_division)) AS id_pais,
                   pais.nombre AS pais, padre.nombre AS padre
            FROM dbo.division_geografica d
            LEFT JOIN dbo.division_geografica padre ON padre.id_division = d.id_division_padre
            LEFT JOIN dbo.pais pais ON pais.id_pais = COALESCE(d.id_pais, dbo.fn_pais_de_division(d.id_division))";
    if ($idPais) $sql .= ' WHERE COALESCE(d.id_pais, dbo.fn_pais_de_division(d.id_division)) = ?';
    $sql .= ' ORDER BY d.id_tipo_division, pais.nombre, padre.nombre, d.nombre';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($idPais ? [(int)$idPais] : []);
    $rows = $stmt->fetchAll();
    ApiResponse::success($rows, 200);
}

/* ---- GET /geografia/divisiones/hijas?id_padre=X ---- */
if ($action === 'divisiones' && $id === 'hijas') {
    $idPadre = $_GET['id_padre'] ?? null;
    if (!$idPadre) {
        ApiResponse::validationError(['id_padre' => 'Requerido']);
    }
    $stmt = $pdo->prepare("SELECT d.id_division, d.nombre, d.id_tipo_division, d.id_division_padre
                           FROM division_geografica d
                           WHERE d.id_division_padre = ?
                           ORDER BY d.nombre");
    $stmt->execute([(int)$idPadre]);
    $rows = $stmt->fetchAll();
    ApiResponse::success($rows, 200);
}

/* ---- GET /geografia/divisiones/nivel?nivel=X ---- */
// Devuelve las divisiones raiz (sin padre) de un nivel especifico.
// nivel=1: Paises, nivel=2: Departamentos, nivel=3: Provincias, nivel=4: Distritos
if ($action === 'divisiones' && $id === 'nivel') {
    $nivel = (int)($_GET['nivel'] ?? 0);
    if ($nivel < 1 || $nivel > 10) {
        ApiResponse::validationError(['nivel' => 'Nivel invalido (1-10)']);
    }

    // Para nivel 2 (departamentos): divisiones cuyo tipo=2 y cuyo padre tiene tipo=1 (pais)
    // Para nivel 3 (provincias): divisiones cuyo tipo=3 y cuyo padre tiene tipo=2
    // Para nivel 4 (distritos): divisiones cuyo tipo=4 y cuyo padre tiene tipo=3
    if ($nivel === 1) {
        // Paises - no estan en division_geografica, estan en tabla pais
        $rows = $pdo->query("SELECT id_pais AS id_division, nombre, 1 AS id_tipo_division, NULL AS id_division_padre FROM pais ORDER BY nombre")->fetchAll();
    } else {
        // Divisiones cuyo tipo_division = nivel y cuyo padre tiene tipo_division = nivel-1
        $sql = "SELECT d.id_division, d.nombre, d.id_tipo_division, d.id_division_padre,
                       dbo.fn_pais_de_division(d.id_division) AS id_pais
                FROM division_geografica d
                WHERE d.id_tipo_division = ?
                ORDER BY d.nombre";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$nivel]);
        $rows = $stmt->fetchAll();
    }
    ApiResponse::success($rows, 200);
}

/* ---- GET /geografia/rubros ---- */
if ($action === 'rubros') {
    $rows = Database::callSP('sp_rubro_buscar', [$_GET['query'] ?? null]);
    ApiResponse::success($rows, 200);
}

/* ---- GET /geografia/grupos ---- */
if ($action === 'grupos') {
    $rows = Database::callSP('sp_grupo_buscar', [$_GET['query'] ?? null]);
    ApiResponse::success($rows, 200);
}

/* ---- GET /geografia/motivos ---- */
if ($action === 'motivos') {
    $rows = Database::callSP('sp_motivos_listar', []);
    ApiResponse::success($rows, 200);
}

/* ---- GET /geografia/roles ---- */
if ($action === 'roles') {
    $rows = $pdo->query("SELECT id_rol, nombre, descripcion FROM persona_rol ORDER BY nombre")->fetchAll();
    ApiResponse::success($rows, 200);
}

/* ---- GET /geografia/validate ---- */
if ($action === 'validate') {
    $tabla = $_GET['tabla'] ?? '';
    $campo = $_GET['campo'] ?? '';
    $valor = $_GET['valor'] ?? '';
    $idExcluir = $_GET['id_excluir'] ?? null;

    if (!$tabla || !$campo || !$valor) {
        ApiResponse::validationError(['tabla' => 'Requerido', 'campo' => 'Requerido', 'valor' => 'Requerido']);
    }

    $tablasPermitidas = ['empresa' => 'empresa', 'sucursal' => 'empresa_sucursal', 'persona' => 'persona', 'rubro' => 'rubro', 'grupo' => 'grupo_empresarial'];
    if (!isset($tablasPermitidas[$tabla])) {
        ApiResponse::error('invalid_table', 'Tabla no permitida para validacion', 400);
    }
    $tablaReal = $tablasPermitidas[$tabla];

    $campoExtra = '';
    $params = [$valor];
    if ($tabla === 'sucursal' && !empty($_GET['id_empresa'])) {
        $campoExtra = ' AND id_empresa = ?';
        $params[] = (int)$_GET['id_empresa'];
    }
    if ($idExcluir) {
        $campoId = ($tabla === 'empresa') ? 'id_empresa' : ($tabla === 'persona' ? 'id_persona' : ($tabla === 'sucursal' ? 'id_sucursal' : ($tabla === 'rubro' ? 'id_rubro' : 'id_grupo')));
        $campoExtra .= " AND $campoId <> ?";
        $params[] = (int)$idExcluir;
    }

    $stmt = $pdo->prepare("SELECT COUNT(*) FROM $tablaReal WHERE $campo = ? $campoExtra");
    $stmt->execute($params);
    $count = (int)$stmt->fetchColumn();
    ApiResponse::success(['existe' => $count > 0, 'count' => $count], 200);
}

ApiResponse::error('not_found', 'Endpoint no encontrado. Disponibles: paises, tipos-division, divisiones, divisiones/hijas, divisiones/nivel, rubros, grupos, motivos, roles, validate', 404);
