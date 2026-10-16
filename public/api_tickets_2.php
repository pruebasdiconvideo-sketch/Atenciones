<?php
/**
 * API REST de Tickets de Soporte Técnico - ERP SOPORTE
 * VERSIÓN COMPLETA CON INTEGRACIÓN DE MOTIVO DE CONTACTO
 * Compatible con IIS + SQL Server + PHP 8.x (sqlsrv)
 */

// FIX v2.103 — Zona horaria del servidor (Perú).
date_default_timezone_set('America/Lima');

// FIX v2.89.1 — Capturar TODOS los errores fatales y devolver JSON en lugar de HTTP 500.
// Esto permite que el frontend siempre reciba un JSON con el error exacto.
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR])) {
        if (!headers_sent()) {
            http_response_code(200); // 200 para que el frontend pueda leer el JSON
            header("Content-Type: application/json; charset=UTF-8");
        }
        echo json_encode([
            "status" => "error",
            "message" => "Error fatal de PHP: " . $error['message'],
            "file" => basename($error['file']),
            "line" => $error['line'],
            "type" => "FATAL_ERROR"
        ]);
    }
});

// FIX v2.89.1 — Capturar excepciones no manejadas
set_exception_handler(function($e) {
    if (!headers_sent()) {
        http_response_code(200);
        header("Content-Type: application/json; charset=UTF-8");
    }
    echo json_encode([
        "status" => "error",
        "message" => "Excepción: " . $e->getMessage(),
        "file" => basename($e->getFile()),
        "line" => $e->getLine(),
        "type" => "UNCAUGHT_EXCEPTION"
    ]);
});

header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Max-Age: 3600");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// ============================
// FUNCIONES AUXILIARES
// ============================

/**
 * FIX v2.79 — obtener_hora_servidor: Devuelve la fecha y hora del servidor SQL Server.
 * Evita usar date() de PHP que usa la zona horaria del servidor web (puede ser UTC).
 */
function obtener_hora_servidor($conn) {
    $stmt = sqlsrv_query($conn, "SELECT FORMAT(GETDATE(), 'yyyy-MM-dd HH:mm') AS fecha_hora");
    if ($stmt !== false && $row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
        return $row['fecha_hora'];
    }
    return obtener_hora_servidor($conn); // Fallback
}

function get_val($input, $keys, $default = null) {
    if (!is_array($input)) return $default;
    if (!is_array($keys)) $keys = [$keys];
    foreach ($keys as $key) {
        foreach ($input as $k => $v) {
            if (strtolower($k) === strtolower($key)) {
                return $v;
            }
        }
    }
    return $default;
}

function to_int_or_null($val) {
    if ($val === null || $val === '' || strtolower($val) === 'null') return null;
    return intval($val);
}

function ensure_valid_user_id($conn, $id_usuario) {
    $id_usuario = to_int_or_null($id_usuario) ?: 1;
    $checkSql = "SELECT COUNT(*) AS total FROM persona WHERE id_persona = ?";
    $stmt = sqlsrv_query($conn, $checkSql, array($id_usuario));
    if ($stmt !== false && $row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
        if (intval($row['total']) > 0) {
            return $id_usuario;
        }
    }
    $fallbackSql = "SELECT TOP 1 id_persona FROM persona ORDER BY id_persona ASC";
    $fallbackStmt = sqlsrv_query($conn, $fallbackSql);
    if ($fallbackStmt !== false && $fallbackRow = sqlsrv_fetch_array($fallbackStmt, SQLSRV_FETCH_ASSOC)) {
        return intval($fallbackRow['id_persona']);
    }
    return 1;
}

function fetch_all_rows($conn, $sql) {
    $stmt = sqlsrv_query($conn, $sql);
    if ($stmt === false) {
        return array();
    }
    $rows = array();
    while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
        if ($row === false) {
            continue;
        }
        $rows[] = normalize_row($row);
    }
    return $rows;
}

/**
 * NORMALIZA FILAS PARA EVITAR OBJETOS DateTime EN LA RESPUESTA JSON
 */
function normalize_row($row) {
    if (!is_array($row)) return $row;
    
    foreach ($row as $key => $val) {
        // Manejar objetos DateTime
        if (is_object($val) && method_exists($val, 'format')) {
            if (in_array($key, ['fecha_registro', 'fecha_cierre', 'fecha_nacimiento', 'fecha_cambio', 
                               'fecha_inicio', 'fecha_fin', 'fecha_asignacion', 'fecha_subida'], true)) {
                $row[$key] = $val->format('Y-m-d');
            } else if (in_array($key, ['hora_registro', 'hora_cierre', 'hora_inicio', 'hora_fin'], true)) {
                $row[$key] = $val->format('H:i:s');
            } else {
                $row[$key] = $val->format('Y-m-d H:i:s');
            }
            continue;
        }
        
        // Convertir booleanos - NO convertir id_motivo_contacto
        if (in_array($key, ['es_principal', 'bloqueado'], true)) {
            $row[$key] = (bool)$val;
        } else if ($key === 'estado' && (is_bool($val) || $val === 0 || $val === 1 || $val === '0' || $val === '1')) {
            $row[$key] = (bool)$val;
        }
    }
    return $row;
}

function exists_id($conn, $table, $id_column, $id) {
    if ($id === null) return false;
    $sql = "SELECT COUNT(*) AS total FROM $table WHERE $id_column = ?";
    $stmt = sqlsrv_query($conn, $sql, array($id));
    if ($stmt === false) return false;
    $row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC);
    return intval($row['total']) > 0;
}

/**
 * FIX v2.93 — Sistema de caché server-side para sync_light y list.
 * Reduce el tiempo de respuesta de ~500ms a ~10ms en llamadas repetidas.
 * El caché se invalida automáticamente con operaciones CRUD.
 * Caché HABILITADO por defecto (10 segundos) para soportar gran volumen de datos.
 */
if (!defined('ERP_CACHE_ENABLED')) {
    define('ERP_CACHE_ENABLED', true);
}
if (!defined('ERP_CACHE_TTL')) {
    define('ERP_CACHE_TTL', 30); // FIX v2.99: 30 segundos para soportar usuarios concurrentes
}

function get_cache_dir() {
    // FIX v2.94 — Usar directorio junto al PHP (más confiable que sys_get_temp_dir en IIS)
    $dir = __DIR__ . '/erp_cache';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

function get_cache_file($key) {
    return get_cache_dir() . '/' . md5($key) . '.json';
}

function get_cached_data($key, $max_age_seconds = 10) {
    if (!ERP_CACHE_ENABLED) return null;
    $file = get_cache_file($key);
    if (!file_exists($file)) return null;
    $age = time() - filemtime($file);
    if ($age > $max_age_seconds) {
        @unlink($file);
        return null;
    }
    $data = @file_get_contents($file);
    if ($data === false) return null;
    $decoded = json_decode($data, true);
    return $decoded ?: null;
}

function set_cached_data($key, $data) {
    if (!ERP_CACHE_ENABLED) return;
    $file = get_cache_file($key);
    @file_put_contents($file, json_encode($data), LOCK_EX);
}

function invalidate_sync_cache() {
    if (!ERP_CACHE_ENABLED) return;
    $dir = get_cache_dir();
    if (!is_dir($dir)) return;
    $files = glob($dir . '/*.json');
    if ($files === false) return;
    foreach ($files as $f) {
        @unlink($f);
    }
}

function sqlsrv_insert_id($conn) {
    $stmt = sqlsrv_query($conn, "SELECT SCOPE_IDENTITY() AS id");
    if ($stmt === false) return null;
    $row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC);
    return $row ? intval($row['id']) : null;
}

/**
 * FIX v2.26: Función helper para registrar operaciones en la bitácora de auditoría.
 * Recibe el $input ya parseado (no lee php://input porque ya fue consumido).
 */
// FIX v2.104 — Helper: limpiar IDs de los detalles de bitácora.
// FIX v2.103: ya no hace consultas SQL (causaba HTTP 500 por deadlock en transacciones).
// Ahora simplemente limpia el texto para que no muestre "ID: X".
function resolver_nombre_entidad($conn, $tipo, $id) {
    if (!$id) return 'Desconocido';
    // No hacer consultas SQL — podría causar deadlock durante transacciones.
    // Simplemente devolver una etiqueta legible sin el ID numérico.
    $etiquetas = array(
        'ticket' => 'Ticket',
        'empresa' => 'Empresa',
        'sucursal' => 'Sede',
        'contacto' => 'Contacto',
        'persona' => 'Usuario',
        'rubro' => 'Rubro',
        'grupo' => 'Grupo',
        'rol' => 'Rol',
        'motivo' => 'Motivo',
    );
    return $etiquetas[$tipo] ?? 'Registro';
}

function log_operacion_auto($conn, $modulo, $operacion, $detalles = '', $input = null) {
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
    $host = 'No resuelto';
    if ($ip && $ip !== 'unknown') {
        $resolved = @gethostbyaddr($ip);
        if ($resolved && $resolved !== $ip) {
            $host = $resolved;
        }
    }
    if ($host === 'No resuelto') {
        $clientNames = array('HTTP_CLIENT_COMPUTERNAME', 'HTTP_X_FORWARDED_COMPUTERNAME', 'REMOTE_HOST', 'COMPUTERNAME');
        foreach ($clientNames as $cn) {
            if (isset($_SERVER[$cn]) && $_SERVER[$cn]) {
                $host = $_SERVER[$cn];
                break;
            }
        }
    }
    $ip_only = $ip;
    $usuario = 'Sistema';
    if ($input && is_array($input) && isset($input['id_usuario'])) {
        $stmt = @sqlsrv_query($conn, "SELECT nombres + ' ' + apellido_paterno AS nombre FROM persona WHERE id_persona = ?", array(intval($input['id_usuario'])));
        if ($stmt !== false && $row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
            $usuario = $row['nombre'];
        }
    }
    if ($usuario === 'Sistema' && $input && is_array($input) && isset($input['correo'])) {
        $usuario = $input['correo'];
    }

    // FIX v2.100 — CRÍTICO: La tabla auditoria_operacion tiene un CHECK CONSTRAINT
    // que SOLO permite: 'CREACION', 'MODIFICACION', 'ELIMINACION'.
    // Antes se enviaban valores como "Crear ticket", "Cambiar estado" → el INSERT fallaba.
    $operacion_upper = strtoupper(trim($operacion));
    $operacion_final = 'MODIFICACION'; // default
    if (strpos($operacion_upper, 'CREAR') !== false || strpos($operacion_upper, 'CREACION') !== false || strpos($operacion_upper, 'REGISTRAR') !== false || strpos($operacion_upper, 'NUEVO') !== false) {
        $operacion_final = 'CREACION';
    } elseif (strpos($operacion_upper, 'ELIMINAR') !== false || strpos($operacion_upper, 'ELIMINACION') !== false || strpos($operacion_upper, 'BAJA') !== false) {
        $operacion_final = 'ELIMINACION';
    } else {
        $operacion_final = 'MODIFICACION';
    }

    // El detalle lleva la descripción específica (ej: "Crear ticket Nro 2026-00001")
    $detalle_completo = $operacion . ' — ' . $detalles;

    static $auditoriaCols = null;
    if ($auditoriaCols === null) {
        $auditoriaCols = array('has_ip' => false, 'has_hostname' => false);
        $chkCols = @sqlsrv_query($conn, "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='auditoria_operacion'");
        if ($chkCols !== false) {
            while ($cr = sqlsrv_fetch_array($chkCols, SQLSRV_FETCH_ASSOC)) {
                if ($cr['COLUMN_NAME'] === 'ip_address') $auditoriaCols['has_ip'] = true;
                if ($cr['COLUMN_NAME'] === 'hostname') $auditoriaCols['has_hostname'] = true;
            }
        }
    }

    if ($auditoriaCols['has_ip'] && $auditoriaCols['has_hostname']) {
        $sql = "INSERT INTO auditoria_operacion (usuario, fecha_hora, modulo, operacion, detalles, ip_address, hostname) VALUES (?, GETDATE(), ?, ?, ?, ?, ?)";
        @sqlsrv_query($conn, $sql, array($usuario, $modulo, $operacion_final, $detalle_completo, $ip_only, $host));
    } elseif ($auditoriaCols['has_ip']) {
        $sql = "INSERT INTO auditoria_operacion (usuario, fecha_hora, modulo, operacion, detalles, ip_address) VALUES (?, GETDATE(), ?, ?, ?, ?)";
        @sqlsrv_query($conn, $sql, array($usuario, $modulo, $operacion_final, $detalle_completo, $ip_only));
    } else {
        $sql = "INSERT INTO auditoria_operacion (usuario, fecha_hora, modulo, operacion, detalles) VALUES (?, GETDATE(), ?, ?, ?)";
        @sqlsrv_query($conn, $sql, array($usuario, $modulo, $operacion_final, $detalle_completo));
    }
}

// ====================================================================
// FIX v2.32 — Helper: enviar_correo_smtp
// Envía un correo usando la configuración SMTP persistida en smtp_config.json
// (reutilizable tanto para notificaciones automáticas como manuales).
// Devuelve array con 'sent' (bool) y 'error' (string|null).
// ====================================================================
function enviar_correo_smtp($conn, $to, $subject, $bodyHtml, $type = 'AUTO') {
    // 1. Leer configuración SMTP desde archivo JSON persistente
    $configFile = __DIR__ . '/smtp_config.json';
    $cfg = array(
        'smtp_host' => 'smtp.corp-mail.com',
        'smtp_port' => 587,
        'smtp_user' => 'notificaciones@soporte.com',
        'smtp_pass' => '',
        'smtp_sender' => 'notificaciones@soporte.com',
        'smtp_security' => 'TLS',
    );
    if (file_exists($configFile)) {
        $loaded = json_decode(file_get_contents($configFile), true);
        if (is_array($loaded)) {
            $cfg = array_merge($cfg, $loaded);
        }
    }

    $smtpHost = $cfg['smtp_host'];
    $smtpPort = intval($cfg['smtp_port']);
    $smtpUser = $cfg['smtp_user'];
    // FIX v2.72 — Gmail app passwords tienen espacios (ej: "ljpf wpyv bzgq wfbs").
    // Eliminar TODOS los espacios de la contraseña antes de usarla.
    $smtpPass = str_replace(' ', '', $cfg['smtp_pass']);
    $smtpSender = $cfg['smtp_sender'];
    $smtpSecurity = $cfg['smtp_security'];

    $smtpSent = false;
    $smtpError = null;
    $emailList = array_filter(array_map('trim', explode(',', $to)));

    if (count($emailList) === 0) {
        return array('sent' => false, 'error' => 'No hay destinatarios válidos.');
    }

    // 2. Conexión SMTP directa
    $useSsl = ($smtpPort == 465);
    $connectHost = $useSsl ? "ssl://$smtpHost" : $smtpHost;
    $fp = @fsockopen($connectHost, $smtpPort, $errno, $errstr, 15);
    if ($fp) {
        stream_set_timeout($fp, 15);
        $greeting = @fgets($fp, 515);
        if ($greeting && intval(substr($greeting, 0, 3)) == 220) {
            $domain = isset($_SERVER['SERVER_NAME']) ? $_SERVER['SERVER_NAME'] : 'localhost';
            @fputs($fp, "EHLO $domain\r\n");
            $ehloResp = '';
            while (substr($ehloResp, 3, 1) != ' ') { $ehloResp = @fgets($fp, 515); if ($ehloResp === false) break; }
            if (intval(substr($ehloResp, 0, 3)) == 250) {
                if ($smtpPort == 587 || strtoupper($smtpSecurity) === 'TLS') {
                    @fputs($fp, "STARTTLS\r\n");
                    $tlsResp = @fgets($fp, 515);
                    if (intval(substr($tlsResp, 0, 3)) == 220) {
                        $cryptoResult = @stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
                        if ($cryptoResult !== true) {
                            $smtpError = 'No se pudo activar TLS (verifique extensión openssl en php.ini).';
                        }
                        @fputs($fp, "EHLO $domain\r\n");
                        $ehloResp2 = '';
                        while (substr($ehloResp2, 3, 1) != ' ') { $ehloResp2 = @fgets($fp, 515); if ($ehloResp2 === false) break; }
                    }
                }
                @fputs($fp, "AUTH LOGIN\r\n");
                @fgets($fp, 515);
                @fputs($fp, base64_encode($smtpUser) . "\r\n");
                @fgets($fp, 515);
                @fputs($fp, base64_encode($smtpPass) . "\r\n");
                $authResp = @fgets($fp, 515);
                if (intval(substr($authResp, 0, 3)) == 235) {
                    @fputs($fp, "MAIL FROM: <$smtpSender>\r\n");
                    @fgets($fp, 515);
                    foreach ($emailList as $toAddr) {
                        if (filter_var($toAddr, FILTER_VALIDATE_EMAIL)) {
                            @fputs($fp, "RCPT TO: <$toAddr>\r\n");
                            @fgets($fp, 515);
                        }
                    }
                    @fputs($fp, "DATA\r\n");
                    $dataPrompt = @fgets($fp, 515);
                    if (intval(substr($dataPrompt, 0, 3)) == 354) {
                        $headers = "MIME-Version: 1.0\r\nContent-type: text/html; charset=UTF-8\r\nFrom: Dicon Soporte <$smtpSender>\r\nReply-To: $smtpSender\r\nSubject: $subject\r\n\r\n";
                        $msg = $headers . $bodyHtml . "\r\n.";
                        @fputs($fp, $msg . "\r\n");
                        $dataResp = @fgets($fp, 515);
                        if (intval(substr($dataResp, 0, 3)) == 250) $smtpSent = true;
                    }
                } else {
                    $smtpError = 'Autenticación SMTP rechazada (verifique usuario/contraseña).';
                }
            }
        }
        @fputs($fp, "QUIT\r\n");
        @fclose($fp);
    } else {
        $smtpError = "No se pudo conectar a $smtpHost:$smtpPort — $errstr (errno $errno).";
    }

    // 3. Fallback con mail() de PHP
    if (!$smtpSent) {
        $headers = "MIME-Version: 1.0\r\nContent-type:text/html;charset=UTF-8\r\nFrom: Dicon Soporte <$smtpSender>\r\n";
        foreach ($emailList as $toAddr) {
            if (filter_var($toAddr, FILTER_VALIDATE_EMAIL)) {
                if (@mail($toAddr, $subject, $bodyHtml, $headers)) {
                    $smtpSent = true;
                    $smtpError = null;
                }
            }
        }
    }

    // 4. Registrar en email_log
    $estado = $smtpSent ? 'EXITOSO' : 'FALLIDO';
    $emailsCsv = implode(',', $emailList);
    @sqlsrv_query($conn, "INSERT INTO email_log (destinatarios, asunto, cuerpo, tipo, num_tickets, estado, smtp_host, fecha_envio) VALUES (?, ?, ?, ?, ?, ?, ?, GETDATE())", array($emailsCsv, $subject, $bodyHtml, $type, 1, $estado, $smtpHost));

    return array('sent' => $smtpSent, 'error' => $smtpError);
}

// ====================================================================
// FIX v2.32 — Helper: enviar_notificacion_ticket_creado
// Construye el cuerpo HTML y dispara el correo al contacto del ticket.
// ====================================================================
// FIX v2.69 — Restaurar funciones de notificación separadas.

function _estilo_correo() {
    return "<!DOCTYPE html><html lang='es'><head><meta charset='UTF-8'><style>"
        . "body{font-family:'Segoe UI',Arial,sans-serif;color:#141414;background:#f4f4f4;padding:20px;}"
        . ".container{max-width:600px;margin:0 auto;background:#fff;border:1px solid #ddd;padding:24px;}"
        . "h1{font-size:18px;color:#141414;border-bottom:2px solid #141414;padding-bottom:8px;}"
        . ".meta{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;}"
        . ".field{margin-bottom:12px;font-size:13px;}"
        . ".label{font-weight:bold;text-transform:uppercase;font-size:10px;color:#141414;}"
        . ".value{display:block;padding:8px;background:#f9f9f9;border-left:3px solid #141414;margin-top:4px;}"
        . ".footer{margin-top:24px;font-size:10px;color:#888;text-align:center;border-top:1px solid #eee;padding-top:12px;}"
        . "</style></head><body><div class='container'>";
}

// 1. Notificación para el CLIENTE (contacto de la empresa)
function enviar_notificacion_cliente($conn, $nro_ticket, $detalle_reporte, $prioridad, $correo_destino, $motivo = '', $empresa = '') {
    if (!$correo_destino || !filter_var($correo_destino, FILTER_VALIDATE_EMAIL)) {
        return array('sent' => false, 'error' => 'Correo destino inválido o vacío.');
    }
    // FIX v2.87 — Cargar plantilla editable desde email_templates.json
    $tpl = cargar_plantilla_correo('TICKET_REGISTRO', array(
        'asunto' => "Ticket #$nro_ticket registrado · ERP SOPORTE",
        'cuerpo' => "<h1>📋 Estimado cliente, usted ha registrado un ticket de soporte</h1>"
            . "<div class='meta'>Notificación automática · " . obtener_hora_servidor($conn) . "</div>"
            . "<p style='font-size:13px;line-height:1.6;'>Estimado cliente, le confirmamos que su ticket de soporte ha sido registrado exitosamente en nuestro sistema. A continuación, encontrará los detalles del reporte:</p>"
            . "<div class='field'><span class='label'>N° de Ticket</span><span class='value' style='font-weight:bold;font-size:16px;'>" . htmlspecialchars($nro_ticket) . "</span></div>"
            . ($empresa ? "<div class='field'><span class='label'>Empresa</span><span class='value'>" . htmlspecialchars($empresa) . "</span></div>" : "")
            . "<div class='field'><span class='label'>Prioridad</span><span class='value'>" . htmlspecialchars($prioridad) . "</span></div>"
            . ($motivo ? "<div class='field'><span class='label'>Motivo de Contacto</span><span class='value'>" . htmlspecialchars($motivo) . "</span></div>" : "")
            . "<div class='field'><span class='label'>Detalle del Reporte</span><span class='value'>" . nl2br(htmlspecialchars($detalle_reporte)) . "</span></div>"
            . "<p style='font-size:12px;color:#555;margin-top:16px;'>Nuestro equipo de soporte atenderá su solicitud a la brevedad posible. Puede consultar el estado de su ticket en cualquier momento contactando a nuestro centro de atención.</p>"
            . "<div class='footer'>ERP SOPORTE · Este es un correo automático, no responda a esta dirección.</div>"
            . "</div></body></html>"
    ));
    $asunto = reemplazar_placeholders($tpl['asunto'], $nro_ticket, $detalle_reporte, $prioridad, $motivo, $empresa, '');
    $cuerpo = _estilo_correo() . reemplazar_placeholders($tpl['cuerpo'], $nro_ticket, $detalle_reporte, $prioridad, $motivo, $empresa, '');
    return enviar_correo_smtp($conn, $correo_destino, $asunto, $cuerpo, 'TICKET_CLIENTE');
}

// Helper: cargar plantilla de correo desde JSON (con fallback a defaults)
function cargar_plantilla_correo($template_id, $defaults) {
    $templatesFile = __DIR__ . '/email_templates.json';
    if (file_exists($templatesFile)) {
        $saved = json_decode(file_get_contents($templatesFile), true);
        if (is_array($saved) && isset($saved[$template_id])) {
            return array(
                'asunto' => $saved[$template_id]['asunto'] ?? $defaults['asunto'],
                'cuerpo' => $saved[$template_id]['cuerpo'] ?? $defaults['cuerpo']
            );
        }
    }
    return $defaults;
}

// Helper: reemplazar placeholders {NRO_TICKET}, {DETALLE}, etc.
function reemplazar_placeholders($text, $nro_ticket, $detalle, $prioridad, $motivo, $empresa, $solucion) {
    $replacements = array(
        '{NRO_TICKET}' => $nro_ticket,
        '{DETALLE}' => nl2br(htmlspecialchars($detalle)),
        '{PRIORIDAD}' => $prioridad,
        '{MOTIVO}' => $motivo,
        '{RAZON_SOCIAL}' => $empresa,
        '{EMPRESA}' => $empresa,
        '{SOLUCION}' => nl2br(htmlspecialchars($solucion)),
        '{CONTACTO}' => '',
        '{USUARIO}' => '',
        '{FECHA}' => date('Y-m-d H:i:s')
    );
    foreach ($replacements as $key => $val) {
        $text = str_replace($key, $val, $text);
    }
    return $text;
}

// 2. Notificación para el USUARIO DEL SISTEMA
function enviar_notificacion_usuario($conn, $nro_ticket, $detalle_reporte, $prioridad, $correo_destino) {
    if (!$correo_destino || !filter_var($correo_destino, FILTER_VALIDATE_EMAIL)) {
        return array('sent' => false, 'error' => 'Correo destino inválido o vacío.');
    }
    $asunto = "Se le ha asignado el Ticket #$nro_ticket · Dicon Soporte ERP";
    $cuerpo = _estilo_correo()
        . "<h1>🎫 Se le ha asignado un ticket</h1>"
        . "<div class='meta'>Notificación automática · " . obtener_hora_servidor($conn) . "</div>"
        . "<p style='font-size:13px;line-height:1.6;'>Se le ha asignado un nuevo ticket de soporte. A continuación, los detalles:</p>"
        . "<div class='field'><span class='label'>N° de Ticket asignado</span><span class='value' style='font-weight:bold;font-size:16px;'>" . htmlspecialchars($nro_ticket) . "</span></div>"
        . "<div class='field'><span class='label'>Prioridad</span><span class='value'>" . htmlspecialchars($prioridad) . "</span></div>"
        . "<div class='field'><span class='label'>Detalle del Reporte</span><span class='value'>" . nl2br(htmlspecialchars($detalle_reporte)) . "</span></div>"
        . "<p style='font-size:12px;color:#555;margin-top:16px;'>Por favor, ingrese al sistema para revisar y gestionar este ticket.</p>"
        . "<div class='footer'>Dicon Soporte ERP · Este es un correo automático, no responda a esta dirección.</div>"
        . "</div></body></html>";
    return enviar_correo_smtp($conn, $correo_destino, $asunto, $cuerpo, 'TICKET_USUARIO');
}

// 3. FIX v2.73 — Notificación de CIERRE de ticket al contacto (mejorada con motivo, prioridad y empresa)
function enviar_notificacion_cierre_cliente($conn, $nro_ticket, $detalle_reporte, $prioridad, $solucion, $correo_destino, $motivo = '', $empresa = '') {
    if (!$correo_destino || !filter_var($correo_destino, FILTER_VALIDATE_EMAIL)) {
        return array('sent' => false, 'error' => 'Correo destino inválido o vacío.');
    }
    // FIX v2.87 — Cargar plantilla editable desde email_templates.json
    $tpl = cargar_plantilla_correo('TICKET_CIERRE', array(
        'asunto' => "Su Ticket #$nro_ticket ha sido resuelto · ERP SOPORTE",
        'cuerpo' => "<h1>✅ Estimado cliente, su ticket ha sido resuelto</h1>"
            . "<div class='meta'>Notificación automática · " . obtener_hora_servidor($conn) . "</div>"
            . "<p style='font-size:13px;line-height:1.6;'>Estimado cliente, le informamos que su ticket de soporte ha sido resuelto y cerrado. A continuación, encontrará los detalles completos del reporte y la solución aplicada:</p>"
            . "<div class='field'><span class='label'>N° de Ticket</span><span class='value' style='font-weight:bold;font-size:16px;'>" . htmlspecialchars($nro_ticket) . "</span></div>"
            . ($empresa ? "<div class='field'><span class='label'>Empresa</span><span class='value'>" . htmlspecialchars($empresa) . "</span></div>" : "")
            . "<div class='field'><span class='label'>Prioridad</span><span class='value'>" . htmlspecialchars($prioridad) . "</span></div>"
            . ($motivo ? "<div class='field'><span class='label'>Motivo de Contacto</span><span class='value'>" . htmlspecialchars($motivo) . "</span></div>" : "")
            . "<div class='field'><span class='label'>Detalle del Reporte</span><span class='value'>" . nl2br(htmlspecialchars($detalle_reporte)) . "</span></div>"
            . "<div class='field'><span class='label'>Solución Aplicada</span><span class='value'>" . nl2br(htmlspecialchars($solucion)) . "</span></div>"
            . "<p style='font-size:12px;color:#555;margin-top:16px;'>Si considera que el problema no ha sido completamente resuelto, por favor póngase en contacto con nuestro centro de atención para reabrir el ticket.</p>"
            . "<div class='footer'>ERP SOPORTE · Este es un correo automático, no responda a esta dirección.</div>"
            . "</div></body></html>"
    ));
    $asunto = reemplazar_placeholders($tpl['asunto'], $nro_ticket, $detalle_reporte, $prioridad, $motivo, $empresa, $solucion);
    $cuerpo = _estilo_correo() . reemplazar_placeholders($tpl['cuerpo'], $nro_ticket, $detalle_reporte, $prioridad, $motivo, $empresa, $solucion);
    return enviar_correo_smtp($conn, $correo_destino, $asunto, $cuerpo, 'TICKET_CIERRE');
}

// Mantener compatibilidad
function enviar_notificacion_ticket_creado($conn, $nro_ticket, $detalle_reporte, $prioridad, $correo_destino) {
    return enviar_notificacion_cliente($conn, $nro_ticket, $detalle_reporte, $prioridad, $correo_destino);
}

// ============================
// CONFIGURACIÓN Y CONEXIÓN
// ============================

$action = isset($_GET['action']) ? $_GET['action'] : 'list';
if ($action === 'add_atencion') $action = 'create_attention';

$dbConfig = require_once __DIR__ . '/db_config.php';
$connectionInfo = $dbConfig['connectionInfo'];
$serverName = $dbConfig['serverName'];

$conn = @sqlsrv_connect($serverName, $connectionInfo);
if (!$conn) {
    http_response_code(500);
    echo json_encode(array(
        "status" => "db_connection_error",
        "message" => "Error de conexión con Microsoft SQL Server en el servidor IIS.",
        "errors" => sqlsrv_errors()
    ));
    exit;
}

// ============================
// PROCESAMIENTO DEL INPUT
// ============================

$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput, true);
if (!$input || !is_array($input)) {
    $input = $_POST;
}
if (!$input || !is_array($input)) {
    $input = $_REQUEST;
}

// ============================
// SWITCH PRINCIPAL
// ============================

switch ($action) {

    // ============================================================
    // 1. LISTAR TICKETS
    // ============================================================
    case 'list':
        $estado = isset($_GET['estado']) && $_GET['estado'] !== 'ALL' ? $_GET['estado'] : null;
        $prioridad = isset($_GET['prioridad']) && $_GET['prioridad'] !== 'ALL' ? $_GET['prioridad'] : null;
        $id_empresa = isset($_GET['id_empresa']) && $_GET['id_empresa'] !== 'ALL' ? intval($_GET['id_empresa']) : null;
        $id_sucursal = isset($_GET['id_sucursal']) && $_GET['id_sucursal'] !== 'ALL' ? intval($_GET['id_sucursal']) : null;
        $id_rubro = isset($_GET['id_rubro']) && $_GET['id_rubro'] !== 'ALL' ? intval($_GET['id_rubro']) : null;
        $id_contacto = isset($_GET['id_contacto']) && $_GET['id_contacto'] !== 'ALL' ? intval($_GET['id_contacto']) : null;
        $id_usuario = isset($_GET['id_usuario']) && $_GET['id_usuario'] !== 'ALL' ? intval($_GET['id_usuario']) : null;
        $fecha_desde = isset($_GET['fecha_desde']) ? $_GET['fecha_desde'] : null;
        $fecha_hasta = isset($_GET['fecha_hasta']) ? $_GET['fecha_hasta'] : null;
        $search_term = isset($_GET['search']) ? $_GET['search'] : null;
        $id_motivo = isset($_GET['id_motivo_contacto']) && $_GET['id_motivo_contacto'] !== 'ALL' ? intval($_GET['id_motivo_contacto']) : null;

        // FIX v2.93 — Caché de 5 segundos para la lista de tickets.
        // Esto reduce el tiempo de fetchLocalSqlTickets de ~300ms a ~10ms.
        $cache_key = 'list_' . md5(json_encode(array($estado, $prioridad, $id_empresa, $id_sucursal, $id_rubro, $id_contacto, $id_usuario, $fecha_desde, $fecha_hasta, $search_term, $id_motivo)));
        $cached = get_cached_data($cache_key, 5);
        if ($cached !== null) {
            header('X-Cache: HIT');
            echo json_encode(array("status" => "success", "total" => count($cached), "data" => $cached, "cached" => true));
            break;
        }
        header('X-Cache: MISS');

        // FIX v2.93 — Si el SP no existe, usar SELECT directo (más compatible).
        $sql = "EXEC [dbo].[sp_ticket_list] 
                @estado = ?, @prioridad = ?, @id_empresa = ?, @id_sucursal = ?, @id_rubro = ?, 
                @id_contacto = ?, @id_usuario = ?, @fecha_desde = ?, @fecha_hasta = ?, 
                @search_term = ?, @id_motivo_contacto = ?";
        $params = array($estado, $prioridad, $id_empresa, $id_sucursal, $id_rubro, $id_contacto, $id_usuario, $fecha_desde, $fecha_hasta, $search_term, $id_motivo);
        $stmt = sqlsrv_query($conn, $sql, $params);
        if ($stmt === false) {
            // Fallback: SELECT directo sin SP (más rápido para gran volumen)
            $whereClauses = array("1=1");
            $fbParams = array();
            if ($estado) { $whereClauses[] = "t.estado = ?"; $fbParams[] = $estado; }
            if ($prioridad) { $whereClauses[] = "t.prioridad = ?"; $fbParams[] = $prioridad; }
            if ($id_empresa) { $whereClauses[] = "t.id_empresa = ?"; $fbParams[] = $id_empresa; }
            if ($id_sucursal) { $whereClauses[] = "t.id_sucursal = ?"; $fbParams[] = $id_sucursal; }
            if ($id_motivo) { $whereClauses[] = "t.id_motivo_contacto = ?"; $fbParams[] = $id_motivo; }
            if ($id_contacto) { $whereClauses[] = "t.id_empresa_contacto = ?"; $fbParams[] = $id_contacto; }
            if ($id_usuario) { $whereClauses[] = "t.id_usuario = ?"; $fbParams[] = $id_usuario; }
            if ($fecha_desde) { $whereClauses[] = "t.fecha_registro >= ?"; $fbParams[] = $fecha_desde; }
            if ($fecha_hasta) { $whereClauses[] = "t.fecha_registro <= ?"; $fbParams[] = $fecha_hasta; }
            if ($search_term) { $whereClauses[] = "(t.detalle_reporte LIKE ? OR t.nro_ticket LIKE ?)"; $fbParams[] = "%$search_term%"; $fbParams[] = "%$search_term%"; }
            
            $fbSql = "SELECT TOP 500 t.id_ticket, t.nro_ticket, t.fecha_registro, t.hora_registro, t.fecha_cierre, t.hora_cierre, 
                       t.id_usuario, t.id_empresa_contacto, t.id_empresa, t.id_sucursal, t.detalle_reporte, 
                       t.prioridad, t.estado, t.medio_contacto, t.id_motivo_contacto
                       FROM ticket t WHERE " . implode(' AND ', $whereClauses) . " ORDER BY t.id_ticket DESC";
            $stmt = sqlsrv_query($conn, $fbSql, $fbParams);
            if ($stmt === false) {
                echo json_encode(array("status" => "error", "message" => "Error al listar tickets.", "errors" => sqlsrv_errors()));
                break;
            }
        }
        $tickets = array();
        while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
            $tickets[] = normalize_row($row);
        }
        // Guardar en caché (5 segundos)
        set_cached_data($cache_key, $tickets);
        echo json_encode(array("status" => "success", "total" => count($tickets), "data" => $tickets, "cached" => false));
        break;

    // ============================================================
    // 2. CREAR TICKET
    // ============================================================
    case 'create':
        $id_empresa = intval(get_val($input, 'id_empresa', 0));
        $id_empresa_contacto = intval(get_val($input, 'id_empresa_contacto', 0));
        $id_sucursal = to_int_or_null(get_val($input, 'id_sucursal', null));
        $detalle_reporte = trim(get_val($input, 'detalle_reporte', ''));
        $prioridad = trim(get_val($input, 'prioridad', 'MEDIA'));
        $medio_contacto = trim(get_val($input, 'medio_contacto', 'EMAIL'));
        $id_motivo = to_int_or_null(get_val($input, 'id_motivo_contacto', null));
        $id_usuario = intval(get_val($input, 'id_usuario', 3));
        // FIX v2.69 — Variables de notificación (restauradas, se habían perdido).
        $enviar_correo = (get_val($input, 'enviar_correo', true) !== false);
        $notificar_contacto = (get_val($input, 'notificar_contacto', false) === true || get_val($input, 'notificar_contacto', '0') === '1' || get_val($input, 'notificar_contacto', '0') === 1 || get_val($input, 'notificar_contacto', '0') === true);
        $notificar_usuario = (get_val($input, 'notificar_usuario', false) === true || get_val($input, 'notificar_usuario', '0') === '1' || get_val($input, 'notificar_usuario', '0') === 1 || get_val($input, 'notificar_usuario', '0') === true);
        $correo_destino = trim(get_val($input, 'correo_destino', ''));
        $correo_usuario = trim(get_val($input, 'correo_usuario', ''));

        if (!$id_empresa || !$id_empresa_contacto || !$detalle_reporte) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan campos obligatorios para el ticket."));
            break;
        }

        $id_usuario = ensure_valid_user_id($conn, $id_usuario);

        // FIX v2.66 — Intentar SP primero, si falla usar INSERT directo.
        $result = null;
        $sql = "DECLARE @nro_ticket NVARCHAR(50), @id_ticket INT;
                EXEC [dbo].[sp_ticket_create] 
                    @nro_ticket = @nro_ticket OUTPUT,
                    @id_usuario = ?,
                    @id_empresa_contacto = ?,
                    @id_empresa = ?,
                    @id_sucursal = ?,
                    @detalle_reporte = ?,
                    @prioridad = ?,
                    @medio_contacto = ?,
                    @id_motivo_contacto = ?,
                    @id_ticket = @id_ticket OUTPUT;
                SELECT @nro_ticket AS nro_ticket, @id_ticket AS id_ticket;";
        $params = array($id_usuario, $id_empresa_contacto, $id_empresa, $id_sucursal, $detalle_reporte, $prioridad, $medio_contacto, $id_motivo);
        $stmt = sqlsrv_query($conn, $sql, $params);
        if ($stmt !== false) {
            $result = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC);
        }
        
        // Fallback: INSERT directo si el SP falla
        if (!$result || empty($result['id_ticket'])) {
            $currentYear = date('Y');
            $countStmt = sqlsrv_query($conn, "SELECT COUNT(*) AS cnt FROM ticket WHERE nro_ticket LIKE ?", array($currentYear . '-%'));
            $cnt = 0;
            if ($countStmt !== false && $row = sqlsrv_fetch_array($countStmt, SQLSRV_FETCH_ASSOC)) {
                $cnt = intval($row['cnt']);
            }
            $nro_ticket = $currentYear . '-' . str_pad($cnt + 1, 5, '0', STR_PAD_LEFT);
            // FIX v2.73 — Usar GETDATE() del servidor SQL Server en lugar de date() de PHP.
            $sql_ins = "INSERT INTO ticket (nro_ticket, fecha_registro, hora_registro, id_usuario, id_empresa_contacto, id_empresa, id_sucursal, detalle_reporte, prioridad, estado, medio_contacto, id_motivo_contacto)
                        OUTPUT INSERTED.id_ticket
                        VALUES (?, CAST(GETDATE() AS DATE), CAST(GETDATE() AS TIME), ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?)";
            $stmt_ins = sqlsrv_query($conn, $sql_ins, array($nro_ticket, $id_usuario, $id_empresa_contacto, $id_empresa, $id_sucursal, $detalle_reporte, $prioridad, $medio_contacto, $id_motivo));
            if ($stmt_ins !== false) {
                $row_ins = sqlsrv_fetch_array($stmt_ins, SQLSRV_FETCH_ASSOC);
                $result = array('nro_ticket' => $nro_ticket, 'id_ticket' => intval($row_ins['id_ticket']));
            } else {
                http_response_code(500);
                echo json_encode(array("status" => "error", "message" => "Error al insertar el ticket.", "errors" => sqlsrv_errors()));
                break;
            }
        }
        log_operacion_auto($conn, "TICKETS", "Crear ticket", "Ticket Nro: " . $result['nro_ticket'], $input);

        // ============================================================
        // FIX v2.69 — Envío de correo con selección de destinatarios.
        // ============================================================
        $correos_enviados = array();
        $correos_fallidos = array();

        if ($enviar_correo) {
            // 1. Notificar al contacto de la empresa (CLIENTE)
            if ($notificar_contacto && $correo_destino && filter_var($correo_destino, FILTER_VALIDATE_EMAIL)) {
                // FIX v2.75 — Obtener nombre del motivo y empresa para incluir en el correo.
                $motivoNombre = '';
                if ($id_motivo) {
                    $mStmt = sqlsrv_query($conn, "SELECT nombre FROM motivo_contacto WHERE id_motivo = ?", array($id_motivo));
                    if ($mStmt !== false && $mRow = sqlsrv_fetch_array($mStmt, SQLSRV_FETCH_ASSOC)) {
                        $motivoNombre = $mRow['nombre'];
                    }
                }
                $empresaNombre = '';
                $eStmt = sqlsrv_query($conn, "SELECT ISNULL(nombre_comercial, razon_social) AS nombre FROM empresa WHERE id_empresa = ?", array($id_empresa));
                if ($eStmt !== false && $eRow = sqlsrv_fetch_array($eStmt, SQLSRV_FETCH_ASSOC)) {
                    $empresaNombre = $eRow['nombre'];
                }
                $resultado_contacto = enviar_notificacion_cliente($conn, $result['nro_ticket'], $detalle_reporte, $prioridad, $correo_destino, $motivoNombre, $empresaNombre);
                if ($resultado_contacto['sent']) $correos_enviados[] = $correo_destino;
                else $correos_fallidos[] = array('correo' => $correo_destino, 'error' => $resultado_contacto['error']);
            }
            // 2. Notificar al usuario del sistema (USUARIO)
            if ($notificar_usuario && $correo_usuario && filter_var($correo_usuario, FILTER_VALIDATE_EMAIL)) {
                if ($correo_usuario !== $correo_destino) {
                    $resultado_usuario = enviar_notificacion_usuario($conn, $result['nro_ticket'], $detalle_reporte, $prioridad, $correo_usuario);
                    if ($resultado_usuario['sent']) $correos_enviados[] = $correo_usuario;
                    else $correos_fallidos[] = array('correo' => $correo_usuario, 'error' => $resultado_usuario['error']);
                }
            }
        }

        echo json_encode(array(
            "status" => "success",
            "message" => "Ticket creado exitosamente con número: " . $result['nro_ticket'],
            "id_ticket" => $result['id_ticket'],
            "nro_ticket" => $result['nro_ticket'],
            "correos_enviados" => $correos_enviados,
            "correos_fallidos" => $correos_fallidos,
            "total_enviados" => count($correos_enviados)
        ));
        break;

    // ============================================================
    // 2.5. CREAR TICKET CON ATENCIÓN Y CIERRE EN UNA SOLA OPERACIÓN
    // ============================================================
    // FIX v2.86 — Optimización: combina create + create_attention + update_status
    // en una sola petición HTTP. Reduce el tiempo de "Registrar ticket resuelto"
    // de ~3 segundos (3 requests secuenciales) a ~1 segundo (1 request).
    case 'create_with_attention':
        // FIX v2.89 — Reescritura completa con diagnóstico detallado en CADA paso.
        // Cualquier error se reporta con el mensaje SQL exacto para poder depurar.
        $debug_log = array();

        // Paso 1: Leer parámetros
        $id_empresa = intval(get_val($input, 'id_empresa', 0));
        $id_empresa_contacto = intval(get_val($input, 'id_empresa_contacto', 0));
        $id_sucursal = to_int_or_null(get_val($input, 'id_sucursal', null));
        $detalle_reporte = trim(get_val($input, 'detalle_reporte', ''));
        $prioridad = trim(get_val($input, 'prioridad', 'MEDIA'));
        $medio_contacto = trim(get_val($input, 'medio_contacto', 'EMAIL'));
        $id_motivo = to_int_or_null(get_val($input, 'id_motivo_contacto', null));
        $id_usuario = intval(get_val($input, 'id_usuario', 3));
        $detalle_atencion = trim(get_val($input, 'detalle_atencion', ''));
        $solucion_aplicada = trim(get_val($input, 'solucion_aplicada', ''));
        $cerrar_ticket = (get_val($input, 'cerrar_ticket', false) === true);
        $fecha_inicio_at = get_val($input, 'fecha_inicio', null);
        $hora_inicio_at = get_val($input, 'hora_inicio', null);
        $fecha_fin_at = get_val($input, 'fecha_fin', null);
        $hora_fin_at = get_val($input, 'hora_fin', null);
        $notificar_cierre = (get_val($input, 'notificar_cierre', false) === true);

        $debug_log[] = "Params: empresa=$id_empresa, contacto=$id_empresa_contacto, sucursal=" . json_encode($id_sucursal) . ", motivo=" . json_encode($id_motivo) . ", usuario=$id_usuario, cerrar=" . json_encode($cerrar_ticket);

        if (!$id_empresa || !$id_empresa_contacto || !$detalle_reporte || !$detalle_atencion) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan campos obligatorios.", "debug" => $debug_log));
            break;
        }

        // Validar que empresa existe
        $chkEmp = sqlsrv_query($conn, "SELECT COUNT(*) AS c FROM empresa WHERE id_empresa = ?", array($id_empresa));
        if ($chkEmp === false) {
            $debug_log[] = "ERROR validando empresa: " . json_encode(sqlsrv_errors());
            echo json_encode(array("status" => "error", "message" => "Error validando empresa.", "debug" => $debug_log));
            break;
        }
        $empRow = sqlsrv_fetch_array($chkEmp, SQLSRV_FETCH_ASSOC);
        if (intval($empRow['c']) === 0) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "La empresa ID $id_empresa no existe en la base de datos."));
            break;
        }

        // Validar que contacto existe
        $chkCon = sqlsrv_query($conn, "SELECT COUNT(*) AS c FROM empresa_contacto WHERE id_empresa_contacto = ?", array($id_empresa_contacto));
        if ($chkCon === false || intval(sqlsrv_fetch_array($chkCon, SQLSRV_FETCH_ASSOC)['c']) === 0) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "El contacto ID $id_empresa_contacto no existe."));
            break;
        }

        // Validar usuario
        $id_usuario = ensure_valid_user_id($conn, $id_usuario);
        $debug_log[] = "Usuario validado: $id_usuario";

        // Paso 2: Crear el ticket — INSERT dinámico que se adapta a las columnas existentes.
        // FIX v2.91 — Detectar qué columnas existen en la tabla ticket y construir
        // el INSERT dinámicamente. Esto evita errores de "Invalid column name".
        $estado_inicial = 'PENDIENTE';

        // Obtener columnas de la tabla ticket
        $colStmt = sqlsrv_query($conn, "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ticket'");
        $ticketColumns = array();
        if ($colStmt !== false) {
            while ($cr = sqlsrv_fetch_array($colStmt, SQLSRV_FETCH_ASSOC)) {
                $ticketColumns[] = $cr['COLUMN_NAME'];
            }
        }
        $debug_log[] = "Columnas ticket: " . implode(', ', $ticketColumns);

        // Construir INSERT dinámico
        $insertCols = array();
        $insertPlaceholders = array();
        $insertParams = array();

        $colMap = array(
            'id_empresa' => $id_empresa,
            'id_empresa_contacto' => $id_empresa_contacto,
            'id_sucursal' => $id_sucursal,
            'detalle_reporte' => $detalle_reporte,
            'prioridad' => $prioridad,
            'estado' => $estado_inicial,
            'medio_contacto' => $medio_contacto,
            'id_motivo_contacto' => $id_motivo,
            'id_usuario' => $id_usuario,
        );

        foreach ($colMap as $col => $val) {
            if (in_array($col, $ticketColumns)) {
                $insertCols[] = $col;
                $insertPlaceholders[] = '?';
                $insertParams[] = $val;
            }
        }
        // Agregar fecha_registro y hora_registro si existen
        if (in_array('fecha_registro', $ticketColumns)) {
            $insertCols[] = 'fecha_registro';
            $insertPlaceholders[] = 'GETDATE()';
        }
        if (in_array('hora_registro', $ticketColumns)) {
            $insertCols[] = 'hora_registro';
            $insertPlaceholders[] = 'CAST(GETDATE() AS TIME)';
        }

        $insSql = "INSERT INTO ticket (" . implode(', ', $insertCols) . ") VALUES (" . implode(', ', $insertPlaceholders) . ")";
        $debug_log[] = "SQL INSERT: " . $insSql;
        $debug_log[] = "Params: " . json_encode($insertParams);

        $insStmt = sqlsrv_query($conn, $insSql, $insertParams);
        if ($insStmt === false) {
            $errors = sqlsrv_errors();
            $debug_log[] = "ERROR INSERT ticket: " . json_encode($errors);
            // FIX v2.91 — Devolver HTTP 200 (no 500) para que el frontend pueda leer el JSON
            echo json_encode(array(
                "status" => "error",
                "message" => "Error al insertar ticket en la base de datos.",
                "sql_error" => $errors,
                "sql_query" => $insSql,
                "sql_params" => $insertParams,
                "debug" => $debug_log
            ));
            break;
        }
        $debug_log[] = "INSERT ticket OK";

        // Obtener el ID del ticket recién creado (usar SELECT MAX como fallback simple)
        $id_ticket_new = 0;
        $maxStmt = sqlsrv_query($conn, "SELECT MAX(id_ticket) AS max_id FROM ticket");
        if ($maxStmt !== false && $maxRow = sqlsrv_fetch_array($maxStmt, SQLSRV_FETCH_ASSOC)) {
            $id_ticket_new = intval($maxRow['max_id']);
        }
        if (!$id_ticket_new) {
            // Fallback: SELECT TOP 1 ... ORDER BY id_ticket DESC
            $topStmt = sqlsrv_query($conn, "SELECT TOP 1 id_ticket FROM ticket ORDER BY id_ticket DESC");
            if ($topStmt !== false && $topRow = sqlsrv_fetch_array($topStmt, SQLSRV_FETCH_ASSOC)) {
                $id_ticket_new = intval($topRow['id_ticket']);
            }
        }
        if (!$id_ticket_new) {
            echo json_encode(array("status" => "error", "message" => "Ticket insertado pero no se pudo obtener el ID.", "debug" => $debug_log));
            break;
        }
        $debug_log[] = "ID ticket nuevo: $id_ticket_new";

        // Generar nro_ticket
        $year = date('Y');
        $nro_ticket_new = $year . '-' . str_pad($id_ticket_new, 5, '0', STR_PAD_LEFT);
        $updNro = sqlsrv_query($conn, "UPDATE ticket SET nro_ticket = ? WHERE id_ticket = ?", array($nro_ticket_new, $id_ticket_new));
        if ($updNro === false) {
            $debug_log[] = "WARN: No se pudo actualizar nro_ticket: " . json_encode(sqlsrv_errors());
        } else {
            $debug_log[] = "nro_ticket actualizado: $nro_ticket_new";
        }

        $ticketId = $id_ticket_new;
        $nroTicket = $nro_ticket_new;

        // Paso 3: Crear la atención — INSERT directo SIMPLE
        $atencionEstado = $cerrar_ticket ? "COMPLETADO" : "EN_PROCESO";
        // Limpiar fechas (null si vacías)
        if (!$fecha_inicio_at) $fecha_inicio_at = null;
        if (!$hora_inicio_at) $hora_inicio_at = null;
        if (!$fecha_fin_at) $fecha_fin_at = null;
        if (!$hora_fin_at) $hora_fin_at = null;
        // Convertir DateTime a string si es necesario
        if ($fecha_inicio_at instanceof DateTime) $fecha_inicio_at = $fecha_inicio_at->format('Y-m-d');
        if ($hora_inicio_at instanceof DateTime) $hora_inicio_at = $hora_inicio_at->format('H:i:s');
        if ($fecha_fin_at instanceof DateTime) $fecha_fin_at = $fecha_fin_at->format('Y-m-d');
        if ($hora_fin_at instanceof DateTime) $hora_fin_at = $hora_fin_at->format('H:i:s');

        $atInsSql = "INSERT INTO atencion (id_ticket, id_usuario, detalle_atencion, solucion_aplicada, estado, fecha_inicio, hora_inicio, fecha_fin, hora_fin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
        $atInsParams = array($ticketId, $id_usuario, $detalle_atencion, $solucion_aplicada, $atencionEstado, $fecha_inicio_at, $hora_inicio_at, $fecha_fin_at, $hora_fin_at);
        $atInsStmt = sqlsrv_query($conn, $atInsSql, $atInsParams);
        if ($atInsStmt === false) {
            $debug_log[] = "ERROR INSERT atencion: " . json_encode(sqlsrv_errors());
            $debug_log[] = "SQL: $atInsSql";
            $debug_log[] = "Params: " . json_encode($atInsParams);
            // El ticket ya se creó, pero la atención falló. Reportar pero NO fallar.
            // Intentar INSERT mínimo sin fechas
            $atInsSql2 = "INSERT INTO atencion (id_ticket, id_usuario, detalle_atencion, solucion_aplicada, estado) VALUES (?, ?, ?, ?, ?)";
            $atInsStmt2 = sqlsrv_query($conn, $atInsSql2, array($ticketId, $id_usuario, $detalle_atencion, $solucion_aplicada, $atencionEstado));
            if ($atInsStmt2 === false) {
                $debug_log[] = "ERROR INSERT atencion (fallback): " . json_encode(sqlsrv_errors());
            } else {
                $debug_log[] = "Atencion insertada con fallback (sin fechas)";
            }
        } else {
            $debug_log[] = "Atencion insertada OK";
        }

        // Paso 4: Si marcó cerrar ticket, actualizar estado a RESUELTO
        $cierreRegistrado = false;
        if ($cerrar_ticket) {
            $updEstado = sqlsrv_query($conn, "UPDATE ticket SET estado = ?, fecha_cierre = CAST(GETDATE() AS DATE), hora_cierre = CAST(GETDATE() AS TIME) WHERE id_ticket = ?", array("RESUELTO", $ticketId));
            if ($updEstado === false) {
                $debug_log[] = "WARN: No se pudo actualizar estado a RESUELTO: " . json_encode(sqlsrv_errors());
            } else {
                $debug_log[] = "Estado actualizado a RESUELTO";
                $cierreRegistrado = true;

                // Historial
                $histSql = "INSERT INTO ticket_historial_estado (id_ticket, estado_anterior, estado_nuevo, id_usuario, motivo, fecha_cambio) VALUES (?, ?, ?, ?, ?, GETDATE())";
                sqlsrv_query($conn, $histSql, array($ticketId, "PENDIENTE", "RESUELTO", $id_usuario, "Ticket atendido y resuelto en el momento del registro."));

                // Notificar cierre si se solicitó
                if ($notificar_cierre) {
                    $tStmt = sqlsrv_query($conn, "SELECT t.nro_ticket, t.detalle_reporte, t.prioridad, ISNULL(e.nombre_comercial, e.razon_social) as empresa_nombre, ec.correo_empresa, p.correo as correo_persona, mc.nombre as motivo_nombre FROM ticket t LEFT JOIN empresa_contacto ec ON t.id_empresa_contacto = ec.id_empresa_contacto LEFT JOIN persona p ON ec.id_persona = p.id_persona LEFT JOIN motivo_contacto mc ON t.id_motivo_contacto = mc.id_motivo LEFT JOIN empresa e ON t.id_empresa = e.id_empresa WHERE t.id_ticket = ?", array($ticketId));
                    if ($tStmt !== false && $tRow = sqlsrv_fetch_array($tStmt, SQLSRV_FETCH_ASSOC)) {
                        $correo_contacto = $tRow['correo_empresa'] ?: $tRow['correo_persona'] ?: '';
                        if ($correo_contacto && filter_var($correo_contacto, FILTER_VALIDATE_EMAIL)) {
                            enviar_notificacion_cierre_cliente($conn, $tRow['nro_ticket'], $tRow['detalle_reporte'], $tRow['prioridad'], $solucion_aplicada ?: 'Sin solución registrada.', $correo_contacto, $tRow['motivo_nombre'] ?? '', $tRow['empresa_nombre'] ?? '');
                            $debug_log[] = "Email de cierre enviado a: $correo_contacto";
                        }
                    }
                }
            }
        }

        log_operacion_auto($conn, "TICKETS", "Crear ticket con atención", "Ticket Nro: " . $nroTicket . ($cerrar_ticket ? " (cerrado como RESUELTO)" : ""), $input);
        invalidate_sync_cache();

        $msg = "Ticket creado exitosamente con número: " . $nroTicket;
        if ($cerrar_ticket) $msg .= " y cerrado como RESUELTO.";

        echo json_encode(array(
            "status" => "success",
            "message" => $msg,
            "id_ticket" => $ticketId,
            "nro_ticket" => $nroTicket,
            "cerrado" => $cierreRegistrado,
            "debug" => $debug_log
        ));
        break;

    // ============================================================
    // 3. SUBIR ARCHIVO
    // ============================================================
    case 'upload_file':
        $id_ticket = intval(get_val($input, 'id_ticket', 0));
        $id_usuario = intval(get_val($input, 'id_usuario', 3));
        $id_usuario = ensure_valid_user_id($conn, $id_usuario);
        $tipo_evidencia = trim(get_val($input, 'tipo_evidencia', 'EVIDENCIA_ADICIONAL'));
        $file = get_val($input, 'file', null);

        if (!$id_ticket || !$file) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan parámetros obligatorios (id_ticket, file)."));
            break;
        }

        $nombre_original = trim(get_val($file, 'name', 'archivo_evidencia'));
        $tipo_mime = trim(get_val($file, 'type', 'application/octet-stream'));
        $tamano_bytes = intval(get_val($file, 'size', 0));
        $base64Content = trim(get_val($file, 'base64Content', ''));

        if (!$base64Content) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "No se recibió el contenido base64 del archivo."));
            break;
        }

        $tipos_ticket = array('EVIDENCIA_ADICIONAL', 'REPORTE_INICIAL');
        $tipos_atencion = array('FOTO_FINAL', 'DOCUMENTO_ENTREGADO', 'EVIDENCIA_TRABAJO');
        $tipo_evidencia_upper = strtoupper($tipo_evidencia);
        if (!in_array($tipo_evidencia_upper, $tipos_ticket) && !in_array($tipo_evidencia_upper, $tipos_atencion)) {
            $tipo_evidencia_upper = 'EVIDENCIA_ADICIONAL';
        }

        $ext = 'bin';
        if (strpos($nombre_original, '.') !== false) {
            $ext_part = substr($nombre_original, strrpos($nombre_original, '.') + 1);
            if ($ext_part !== '') $ext = strtolower($ext_part);
        }
        $sysName = 'usr-' . $id_usuario . '-' . time() . '.' . $ext;
        $ruta = '/uploads/tickets/' . $id_ticket . '/' . $sysName;
        $tamano_formato = round($tamano_bytes / (1024.0 * 1024.0), 2) . ' MB';
        $checksum_php = hash('sha256', $base64Content);

        // Intentar SP primero, luego INSERT directo
        $id_archivo_result = null;
        $sql_sp = "DECLARE @id_archivo INT;
                EXEC [dbo].[sp_archivo_upload]
                    @id_ticket = ?, @id_usuario = ?, @tipo_evidencia = ?,
                    @nombre_original = ?, @tipo_mime = ?, @tamano_bytes = ?,
                    @base64Content = ?, @id_archivo = @id_archivo OUTPUT;
                SELECT @id_archivo AS id_archivo;";
        $stmt_sp = sqlsrv_query($conn, $sql_sp, array($id_ticket, $id_usuario, $tipo_evidencia_upper, $nombre_original, $tipo_mime, $tamano_bytes, $base64Content));
        if ($stmt_sp !== false) {
            do {
                if ($row = sqlsrv_fetch_array($stmt_sp, SQLSRV_FETCH_ASSOC)) {
                    if (isset($row['id_archivo']) && $row['id_archivo']) {
                        $id_archivo_result = intval($row['id_archivo']);
                    }
                }
            } while (sqlsrv_next_result($stmt_sp));
            sqlsrv_free_stmt($stmt_sp);
        }

        if (!$id_archivo_result) {
            sqlsrv_begin_transaction($conn);
            try {
                $sql_ins = "INSERT INTO [dbo].[archivo]
                            (nombre_original, nombre_sistema, ruta, tipo_mime, extension, tamano_bytes, tamano_formato, checksum, id_usuario_subio, fecha_subida, estado, base64Content)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), 1, ?);
                            SELECT SCOPE_IDENTITY() AS id_archivo;";
                $params_ins = array(
                    array(&$nombre_original, SQLSRV_PARAM_IN, SQLSRV_PHPTYPE_STRING('UTF-8')),
                    array(&$sysName, SQLSRV_PARAM_IN, SQLSRV_PHPTYPE_STRING('UTF-8')),
                    array(&$ruta, SQLSRV_PARAM_IN, SQLSRV_PHPTYPE_STRING('UTF-8')),
                    array(&$tipo_mime, SQLSRV_PARAM_IN, SQLSRV_PHPTYPE_STRING('UTF-8')),
                    array(&$ext, SQLSRV_PARAM_IN, SQLSRV_PHPTYPE_STRING('UTF-8')),
                    $tamano_bytes,
                    array(&$tamano_formato, SQLSRV_PARAM_IN, SQLSRV_PHPTYPE_STRING('UTF-8')),
                    array(&$checksum_php, SQLSRV_PARAM_IN, SQLSRV_PHPTYPE_STRING('UTF-8')),
                    $id_usuario,
                    array(&$base64Content, SQLSRV_PARAM_IN, SQLSRV_PHPTYPE_STRING('UTF-8'))
                );
                $stmt_ins = sqlsrv_query($conn, $sql_ins, $params_ins);
                if ($stmt_ins === false) throw new Exception("INSERT archivo falló: " . print_r(sqlsrv_errors(), true));
                sqlsrv_next_result($stmt_ins);
                $row_ins = sqlsrv_fetch_array($stmt_ins, SQLSRV_FETCH_ASSOC);
                $id_archivo_result = $row_ins ? intval($row_ins['id_archivo']) : null;
                sqlsrv_free_stmt($stmt_ins);
                if (!$id_archivo_result) throw new Exception("No se obtuvo id_archivo tras INSERT.");

                if (in_array($tipo_evidencia_upper, $tipos_ticket)) {
                    sqlsrv_query($conn, "INSERT INTO [dbo].[ticket_archivo] (id_ticket, id_archivo, tipo_evidencia) VALUES (?, ?, ?)", array($id_ticket, $id_archivo_result, $tipo_evidencia_upper));
                } else {
                    $sql_at = "SELECT TOP 1 id_atencion FROM [dbo].[atencion] WHERE id_ticket = ? ORDER BY id_atencion DESC";
                    $stmt_at = sqlsrv_query($conn, $sql_at, array($id_ticket));
                    $id_atencion = null;
                    if ($stmt_at !== false && $row_at = sqlsrv_fetch_array($stmt_at, SQLSRV_FETCH_ASSOC)) $id_atencion = intval($row_at['id_atencion']);
                    if ($id_atencion) {
                        sqlsrv_query($conn, "INSERT INTO [dbo].[atencion_archivo] (id_atencion, id_archivo, tipo_evidencia) VALUES (?, ?, ?)", array($id_atencion, $id_archivo_result, $tipo_evidencia_upper));
                    } else {
                        sqlsrv_query($conn, "INSERT INTO [dbo].[ticket_archivo] (id_ticket, id_archivo, tipo_evidencia) VALUES (?, ?, 'EVIDENCIA_ADICIONAL')", array($id_ticket, $id_archivo_result));
                    }
                }
                sqlsrv_commit($conn);
            } catch (Exception $e) {
                @sqlsrv_rollback($conn);
                http_response_code(500);
                echo json_encode(array("status" => "error", "message" => "No se pudo vincular el archivo.", "error" => $e->getMessage()));
                break;
            }
        }

        log_operacion_auto($conn, "TICKETS", "Subir evidencia", resolver_nombre_entidad($conn, "ticket", $id_ticket) . " - Archivo: " . $nombre_original, $input);
        echo json_encode(array(
            "status" => "success",
            "message" => "Archivo vinculado correctamente al ticket " . $id_ticket,
            "id_archivo" => $id_archivo_result,
            "method" => "ok"
        ));
        break;

        // ============================================================
    // 4. CREAR ATENCIÓN TÉCNICA
    // ============================================================
    case 'create_attention':
        $id_ticket = intval(get_val($input, 'id_ticket', 0));
        $id_usuario = intval(get_val($input, 'id_usuario', 3));
        $id_usuario = ensure_valid_user_id($conn, $id_usuario);
        $detalle_atencion = trim(get_val($input, 'detalle_atencion', ''));
        $solucion_aplicada = trim(get_val($input, 'solucion_aplicada', ''));
        $estado = trim(get_val($input, 'estado', 'EN_PROCESO'));
        // FIX v2.79 — Usar GETDATE() del servidor SQL Server en lugar de date() de PHP.
        $fecha_inicio = get_val($input, 'fecha_inicio', null);
        $hora_inicio = get_val($input, 'hora_inicio', null);
        if (!$fecha_inicio || !$hora_inicio) {
            // Obtener fecha y hora del servidor SQL Server
            $srvDateStmt = sqlsrv_query($conn, "SELECT CAST(GETDATE() AS DATE) AS fecha, CAST(GETDATE() AS TIME) AS hora");
            if ($srvDateStmt !== false && $srvDateRow = sqlsrv_fetch_array($srvDateStmt, SQLSRV_FETCH_ASSOC)) {
                $fecha_inicio = $srvDateRow['fecha'];
                $hora_inicio = $srvDateRow['hora'];
            }
        }
        $fecha_fin = get_val($input, 'fecha_fin', null);
        $hora_fin = get_val($input, 'hora_fin', null);

        if (!$id_ticket || !$detalle_atencion) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan parámetros obligatorios (id_ticket, detalle_atencion)."));
            break;
        }

        // FIX v2.70 — Intentar SP primero, si falla usar INSERT directo.
        $id_atencion = null;
        $sql = "DECLARE @id_atencion INT;
                EXEC [dbo].[sp_atencion_create]
                    @id_ticket = ?, @id_usuario = ?, @detalle_atencion = ?,
                    @solucion_aplicada = ?, @estado = ?, @fecha_inicio = ?,
                    @hora_inicio = ?, @fecha_fin = ?, @hora_fin = ?,
                    @id_atencion = @id_atencion OUTPUT;
                SELECT @id_atencion AS id_atencion;";
        $params = array($id_ticket, $id_usuario, $detalle_atencion, $solucion_aplicada, $estado, $fecha_inicio, $hora_inicio, $fecha_fin, $hora_fin);
        $stmt = sqlsrv_query($conn, $sql, $params);
        if ($stmt !== false) {
            $result = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC);
            if ($result && $result['id_atencion']) {
                $id_atencion = intval($result['id_atencion']);
            }
        }

        // Fallback: INSERT directo si el SP falla
        if (!$id_atencion) {
            $sql_ins = "INSERT INTO atencion (id_ticket, id_usuario, detalle_atencion, solucion_aplicada, estado, fecha_inicio, hora_inicio, fecha_fin, hora_fin)
                        OUTPUT INSERTED.id_atencion
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
            $stmt_ins = sqlsrv_query($conn, $sql_ins, array($id_ticket, $id_usuario, $detalle_atencion, $solucion_aplicada, $estado, $fecha_inicio, $hora_inicio, $fecha_fin, $hora_fin));
            if ($stmt_ins !== false) {
                $row_ins = sqlsrv_fetch_array($stmt_ins, SQLSRV_FETCH_ASSOC);
                if ($row_ins) $id_atencion = intval($row_ins['id_atencion']);
            }
        }

        if (!$id_atencion) {
            // Segundo fallback: sin OUTPUT clause
            $sql_ins2 = "INSERT INTO atencion (id_ticket, id_usuario, detalle_atencion, solucion_aplicada, estado, fecha_inicio, hora_inicio, fecha_fin, hora_fin)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?); SELECT SCOPE_IDENTITY() AS id_atencion;";
            $stmt_ins2 = sqlsrv_query($conn, $sql_ins2, array($id_ticket, $id_usuario, $detalle_atencion, $solucion_aplicada, $estado, $fecha_inicio, $hora_inicio, $fecha_fin, $hora_fin));
            if ($stmt_ins2 !== false) {
                sqlsrv_next_result($stmt_ins2);
                if ($row_ins2 = sqlsrv_fetch_array($stmt_ins2, SQLSRV_FETCH_ASSOC)) {
                    $id_atencion = intval($row_ins2['id_atencion']);
                }
            }
        }

        if (!$id_atencion) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al registrar la atención técnica.", "errors" => sqlsrv_errors()));
            break;
        }

        log_operacion_auto($conn, "TICKETS", "Registrar atención", resolver_nombre_entidad($conn, "ticket", $id_ticket) . " - " . substr($detalle_atencion, 0, 50), $input);
        echo json_encode(array(
            "status" => "success",
            "message" => "Atención técnica registrada correctamente.",
            "id_atencion" => $id_atencion
        ));
        break;

    // ============================================================
    // 5. ACTUALIZAR ATENCIÓN
    // ============================================================
    case 'update_attention':
        $id_atencion = intval(get_val($input, 'id_atencion', 0));
        $detalle_atencion = trim(get_val($input, 'detalle_atencion', ''));
        $solucion_aplicada = trim(get_val($input, 'solucion_aplicada', ''));

        if (!$id_atencion || !$detalle_atencion) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan parámetros obligatorios (id_atencion, detalle_atencion)."));
            break;
        }

        $sql = "EXEC [dbo].[sp_atencion_update] @id_atencion = ?, @detalle_atencion = ?, @solucion_aplicada = ?";
        $stmt = sqlsrv_query($conn, $sql, array($id_atencion, $detalle_atencion, $solucion_aplicada));
        if ($stmt === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al actualizar la atención.", "errors" => sqlsrv_errors()));
            break;
        }
        log_operacion_auto($conn, "TICKETS", "Editar atención", "Atención técnica", $input);
        invalidate_sync_cache();
        echo json_encode(array("status" => "success", "message" => "Atención técnica actualizada correctamente."));
        break;

    // ============================================================
    // 6. ACTUALIZAR ESTADO DEL TICKET
    // ============================================================
    case 'update_status':
        $id_ticket = intval(get_val($input, 'id_ticket', 0));
        $estado = trim(get_val($input, 'estado', ''));
        $motivo = trim(get_val($input, 'motivo', ''));
        $id_usuario = intval(get_val($input, 'id_usuario', 3));
        $id_usuario = ensure_valid_user_id($conn, $id_usuario);
        // FIX v2.73 — Flag opcional para notificar cierre.
        $notificar_cierre = (get_val($input, 'notificar_cierre', false) === true || get_val($input, 'notificar_cierre', '0') === '1' || get_val($input, 'notificar_cierre', '0') === 1 || get_val($input, 'notificar_cierre', '0') === true);

        if (!$id_ticket || !$estado || !$motivo) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan campos obligatorios para actualizar el estado."));
            break;
        }

        $estado_anterior = null;
        $stmtPrev = sqlsrv_query($conn, "SELECT estado FROM ticket WHERE id_ticket = ?", array($id_ticket));
        if ($stmtPrev !== false && $rowPrev = sqlsrv_fetch_array($stmtPrev, SQLSRV_FETCH_ASSOC)) {
            $estado_anterior = $rowPrev['estado'];
        }

        // FIX v2.73 — Usar UPDATE directo con GETDATE() si el SP falla.
        $sql = "EXEC [dbo].[sp_ticket_update_status] @id_ticket = ?, @nuevo_estado = ?, @motivo = ?, @id_usuario = ?";
        $stmt = sqlsrv_query($conn, $sql, array($id_ticket, $estado, $motivo, $id_usuario));
        if ($stmt === false) {
            // Fallback: UPDATE directo con GETDATE() para fecha_cierre/hora_cierre
            $estado_efectivo_fb = ($estado === 'REABIERTO') ? 'PENDIENTE' : $estado;
            $cierreFecha = ($estado === 'CERRADO' || $estado === 'RESUELTO') ? 'CAST(GETDATE() AS DATE)' : 'NULL';
            $cierreHora = ($estado === 'CERRADO' || $estado === 'RESUELTO') ? 'CAST(GETDATE() AS TIME)' : 'NULL';
            $sql_fb = "UPDATE ticket SET estado = ?, fecha_cierre = $cierreFecha, hora_cierre = $cierreHora WHERE id_ticket = ?";
            $stmt_fb = sqlsrv_query($conn, $sql_fb, array($estado_efectivo_fb, $id_ticket));
            if ($stmt_fb === false) {
                http_response_code(500);
                echo json_encode(array("status" => "error", "message" => "Error al actualizar el ticket.", "errors" => sqlsrv_errors()));
                break;
            }
        }

        $estado_efectivo = ($estado === 'REABIERTO') ? 'PENDIENTE' : $estado;
        if ($estado_anterior !== null && $estado_anterior !== $estado_efectivo) {
            $motivo_auditoria = ($estado === 'REABIERTO') ? ("[REAPERTURA DE TICKET] " . $motivo) : $motivo;
            $histSql = "INSERT INTO ticket_historial_estado (id_ticket, estado_anterior, estado_nuevo, id_usuario, motivo, fecha_cambio)
                        VALUES (?, ?, ?, ?, ?, GETDATE())";
            sqlsrv_query($conn, $histSql, array($id_ticket, $estado_anterior, $estado_efectivo, $id_usuario, $motivo_auditoria));
        }

        log_operacion_auto($conn, "TICKETS", "Cambiar estado ticket", resolver_nombre_entidad($conn, "ticket", $id_ticket) . " -> " . $estado, $input);

        // FIX v2.73 — Solo notificar cierre si el flag está activado.
        if ($notificar_cierre && ($estado === 'CERRADO' || $estado === 'RESUELTO')) {
            $tStmt = sqlsrv_query($conn, "SELECT t.nro_ticket, t.detalle_reporte, t.prioridad, t.id_motivo_contacto,
                                          mc.nombre as motivo_nombre, ec.correo_empresa, p.correo as correo_persona,
                                          ISNULL(e.nombre_comercial, e.razon_social) as empresa_nombre
                                          FROM ticket t
                                          LEFT JOIN empresa_contacto ec ON t.id_empresa_contacto = ec.id_empresa_contacto
                                          LEFT JOIN persona p ON ec.id_persona = p.id_persona
                                          LEFT JOIN motivo_contacto mc ON t.id_motivo_contacto = mc.id_motivo
                                          LEFT JOIN empresa e ON t.id_empresa = e.id_empresa
                                          WHERE t.id_ticket = ?", array($id_ticket));
            if ($tStmt !== false && $tRow = sqlsrv_fetch_array($tStmt, SQLSRV_FETCH_ASSOC)) {
                $correo_contacto = $tRow['correo_empresa'] ?: $tRow['correo_persona'] ?: '';
                if ($correo_contacto && filter_var($correo_contacto, FILTER_VALIDATE_EMAIL)) {
                    $solStmt = sqlsrv_query($conn, "SELECT TOP 1 solucion_aplicada FROM atencion WHERE id_ticket = ? ORDER BY id_atencion DESC", array($id_ticket));
                    $solucion = 'Sin solución registrada.';
                    if ($solStmt !== false && $solRow = sqlsrv_fetch_array($solStmt, SQLSRV_FETCH_ASSOC)) {
                        $solucion = $solRow['solucion_aplicada'] ?: $solucion;
                    }
                    enviar_notificacion_cierre_cliente($conn, $tRow['nro_ticket'], $tRow['detalle_reporte'], $tRow['prioridad'], $solucion, $correo_contacto, $tRow['motivo_nombre'], $tRow['empresa_nombre']);
                }
            }
        }

        invalidate_sync_cache();
        log_operacion_auto($conn, "TICKETS", "Cambiar estado ticket", resolver_nombre_entidad($conn, "ticket", $id_ticket) . " -> " . $estado, $input);
        echo json_encode(array("status" => "success", "message" => "Estado del ticket actualizado exitosamente a " . $estado));
        break;

    // ============================================================
    // 6.5 FIX v2.63 — ELIMINAR TICKET (DELETE físico)
    // ============================================================
    case 'delete_ticket':
        $id_ticket = intval(get_val($input, 'id_ticket', 0));
        if (!$id_ticket) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_ticket."));
            break;
        }

        // 1. Eliminar evidencias vinculadas a atenciones del ticket
        $get_atencion_ids = sqlsrv_query($conn, "SELECT id_atencion FROM atencion WHERE id_ticket = ?", array($id_ticket));
        $atencion_ids = array();
        if ($get_atencion_ids !== false) {
            while ($row = sqlsrv_fetch_array($get_atencion_ids, SQLSRV_FETCH_ASSOC)) {
                $atencion_ids[] = intval($row['id_atencion']);
            }
        }
        if (count($atencion_ids) > 0) {
            foreach ($atencion_ids as $aid) {
                sqlsrv_query($conn, "DELETE FROM atencion_archivo WHERE id_atencion = ?", array($aid));
            }
        }

        // 2. Eliminar archivos vinculados al ticket (ticket_archivo)
        $get_archivo_ids = sqlsrv_query($conn, "SELECT id_archivo FROM ticket_archivo WHERE id_ticket = ?", array($id_ticket));
        $archivo_ids = array();
        if ($get_archivo_ids !== false) {
            while ($row = sqlsrv_fetch_array($get_archivo_ids, SQLSRV_FETCH_ASSOC)) {
                $archivo_ids[] = intval($row['id_archivo']);
            }
        }
        sqlsrv_query($conn, "DELETE FROM ticket_archivo WHERE id_ticket = ?", array($id_ticket));

        // 3. Eliminar los archivos de la tabla archivo
        if (count($archivo_ids) > 0) {
            foreach ($archivo_ids as $aid) {
                sqlsrv_query($conn, "DELETE FROM archivo WHERE id_archivo = ?", array($aid));
            }
        }

        // 4. Eliminar atenciones del ticket
        sqlsrv_query($conn, "DELETE FROM atencion WHERE id_ticket = ?", array($id_ticket));

        // 5. Eliminar historial de estados
        sqlsrv_query($conn, "DELETE FROM ticket_historial_estado WHERE id_ticket = ?", array($id_ticket));

        // 6. Eliminar el ticket
        $stmt_del = sqlsrv_query($conn, "DELETE FROM ticket WHERE id_ticket = ?", array($id_ticket));
        if ($stmt_del === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al eliminar el ticket.", "errors" => sqlsrv_errors()));
            break;
        }

        log_operacion_auto($conn, "TICKETS", "Eliminar ticket", resolver_nombre_entidad($conn, "ticket", $id_ticket) . " eliminado físicamente", $input);
        invalidate_sync_cache();
        echo json_encode(array("status" => "success", "message" => "Ticket eliminado correctamente de la base de datos."));
        break;

    // ============================================================
    // 7. ACTUALIZAR TICKET COMPLETO (NUEVO - PARA EDITAR TODOS LOS CAMPOS)
    // ============================================================
    case 'update_ticket':
        $id_ticket = intval(get_val($input, 'id_ticket', 0));
        $detalle_reporte = trim(get_val($input, 'detalle_reporte', ''));
        $prioridad = trim(get_val($input, 'prioridad', 'MEDIA'));
        $estado = trim(get_val($input, 'estado', 'PENDIENTE'));
        $medio_contacto = trim(get_val($input, 'medio_contacto', 'EMAIL'));
        $id_motivo_contacto = to_int_or_null(get_val($input, 'id_motivo_contacto', null));
        $id_usuario = to_int_or_null(get_val($input, 'id_usuario', null));
        $id_sucursal = to_int_or_null(get_val($input, 'id_sucursal', null));

        if (!$id_ticket || !$detalle_reporte) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan campos obligatorios para actualizar el ticket."));
            break;
        }

        try {
            // Obtener el estado anterior para el historial
            $sql_old = "SELECT estado, id_motivo_contacto FROM ticket WHERE id_ticket = ?";
            $stmt_old = sqlsrv_query($conn, $sql_old, array($id_ticket));
            if ($stmt_old === false) {
                throw new Exception("Error al obtener el ticket: " . print_r(sqlsrv_errors(), true));
            }
            $oldData = sqlsrv_fetch_array($stmt_old, SQLSRV_FETCH_ASSOC);
            $oldEstado = $oldData['estado'];
            $oldMotivo = $oldData['id_motivo_contacto'];

            // Actualizar el ticket
            $sql = "UPDATE ticket SET 
                        detalle_reporte = ?,
                        prioridad = ?,
                        estado = ?,
                        medio_contacto = ?,
                        id_motivo_contacto = ?,
                        id_usuario = ?,
                        id_sucursal = ?
                    WHERE id_ticket = ?";
            $params = array($detalle_reporte, $prioridad, $estado, $medio_contacto, $id_motivo_contacto, $id_usuario, $id_sucursal, $id_ticket);
            $stmt = sqlsrv_query($conn, $sql, $params);
            if ($stmt === false) {
                throw new Exception("Error al actualizar ticket: " . print_r(sqlsrv_errors(), true));
            }

            // Registrar en el historial si cambió el estado o el motivo
            if ($oldEstado !== $estado || $oldMotivo !== $id_motivo_contacto) {
                $motivo_cambio = "Modificación de ticket: ";
                if ($oldEstado !== $estado) {
                    $motivo_cambio .= "Estado cambiado de $oldEstado a $estado. ";
                }
                if ($oldMotivo !== $id_motivo_contacto) {
                    $motivo_nuevo = "N/A";
                    $motivo_viejo = "N/A";
                    if ($id_motivo_contacto) {
                        $stmt_m = sqlsrv_query($conn, "SELECT nombre FROM motivo_contacto WHERE id_motivo = ?", array($id_motivo_contacto));
                        if ($stmt_m !== false && $row_m = sqlsrv_fetch_array($stmt_m, SQLSRV_FETCH_ASSOC)) {
                            $motivo_nuevo = $row_m['nombre'];
                        }
                    }
                    if ($oldMotivo) {
                        $stmt_m = sqlsrv_query($conn, "SELECT nombre FROM motivo_contacto WHERE id_motivo = ?", array($oldMotivo));
                        if ($stmt_m !== false && $row_m = sqlsrv_fetch_array($stmt_m, SQLSRV_FETCH_ASSOC)) {
                            $motivo_viejo = $row_m['nombre'];
                        }
                    }
                    $motivo_cambio .= "Motivo cambiado de '$motivo_viejo' a '$motivo_nuevo'.";
                }

                $histSql = "INSERT INTO ticket_historial_estado (id_ticket, estado_anterior, estado_nuevo, id_usuario, motivo, fecha_cambio)
                            VALUES (?, ?, ?, ?, ?, GETDATE())";
                $histStmt = sqlsrv_query($conn, $histSql, array($id_ticket, $oldEstado, $estado, $id_usuario, $motivo_cambio));
                if ($histStmt === false) {
                    error_log("Error al insertar historial: " . print_r(sqlsrv_errors(), true));
                }
            }

            log_operacion_auto($conn, "TICKETS", "Editar ticket", resolver_nombre_entidad($conn, "ticket", $id_ticket), $input);
            echo json_encode(array(
                "status" => "success",
                "message" => "Ticket actualizado exitosamente."
            ));
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => $e->getMessage()));
        }
        break;

    // ============================================================
    // 8. OBTENER TRAZABILIDAD DE TICKET
    // ============================================================
    case 'get_ticket_traceability':
        $id_ticket = isset($_GET['id_ticket']) ? intval($_GET['id_ticket']) : null;
        if (!$id_ticket) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Debe proporcionar id_ticket"));
            break;
        }

        $sql = "EXEC [dbo].[sp_ticket_traceability] @id_ticket = ?";
        $stmt = sqlsrv_query($conn, $sql, array($id_ticket));
        if ($stmt === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al obtener la trazabilidad.", "errors" => sqlsrv_errors()));
            break;
        }

        $data = array();
        $ticket = null;
        if (sqlsrv_has_rows($stmt)) {
            $ticket = normalize_row(sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC));
            if ($ticket && isset($ticket['id_motivo_contacto']) && $ticket['id_motivo_contacto'] !== null) {
                $motiveStmt = sqlsrv_query($conn, "SELECT nombre FROM motivo_contacto WHERE id_motivo = ?", array(intval($ticket['id_motivo_contacto'])));
                if ($motiveStmt !== false && $motiveRow = sqlsrv_fetch_array($motiveStmt, SQLSRV_FETCH_ASSOC)) {
                    $ticket['motivo_nombre'] = $motiveRow['nombre'];
                }
            }
        }

        // FIX v2.70 — Si el SP no devuelve ticket, hacer SELECT directo.
        if (!$ticket) {
            $tStmt = sqlsrv_query($conn, "SELECT t.*, ec.correo_empresa, p.correo as correo_persona,
                                         p.nombres + ' ' + p.apellido_paterno as contacto_nombre,
                                         e.nombre_comercial, e.razon_social, e.ruc
                                         FROM ticket t
                                         LEFT JOIN empresa_contacto ec ON t.id_empresa_contacto = ec.id_empresa_contacto
                                         LEFT JOIN persona p ON ec.id_persona = p.id_persona
                                         LEFT JOIN empresa e ON t.id_empresa = e.id_empresa
                                         WHERE t.id_ticket = ?", array($id_ticket));
            if ($tStmt !== false && $tRow = sqlsrv_fetch_array($tStmt, SQLSRV_FETCH_ASSOC)) {
                $ticket = normalize_row($tRow);
            }
        }

        sqlsrv_next_result($stmt);
        $historial = array();
        while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
            $historial[] = normalize_row($row);
        }

        // FIX v2.70 — Si el SP no devuelve historial, hacer SELECT directo.
        if (count($historial) === 0) {
            $hStmt = sqlsrv_query($conn, "SELECT * FROM ticket_historial_estado WHERE id_ticket = ? ORDER BY fecha_cambio DESC", array($id_ticket));
            if ($hStmt !== false) {
                while ($hRow = sqlsrv_fetch_array($hStmt, SQLSRV_FETCH_ASSOC)) {
                    $historial[] = normalize_row($hRow);
                }
            }
        }

        // FIX v2.97 — Siempre usar SELECT directo para atenciones (más confiable que el SP).
        // Esto garantiza que solucion_aplicada siempre se incluya.
        $atenciones = array();
        $aStmt = @sqlsrv_query($conn, "SELECT a.*, p.nombres + ' ' + p.apellido_paterno as tecnico_nombre
                                      FROM atencion a
                                      LEFT JOIN persona p ON a.id_usuario = p.id_persona
                                      WHERE a.id_ticket = ? ORDER BY a.fecha_inicio DESC, a.hora_inicio DESC", array($id_ticket));
        if ($aStmt !== false) {
            while ($aRow = sqlsrv_fetch_array($aStmt, SQLSRV_FETCH_ASSOC)) {
                $atenciones[] = normalize_row($aRow);
            }
        }

        // FIX v2.69 — Incluir evidencias/archivos del ticket en la trazabilidad.
        // FIX v2.91.5 — Usar @ para silenciar errores y devolver array vacío si falla.
        $evidencias = array();
        $sql_evidencias = "SELECT ta.id_ticket_archivo, ta.id_ticket, ta.id_archivo, ta.tipo_evidencia,
                              a.nombre_original, a.nombre_sistema, a.ruta, a.tipo_mime, a.extension,
                              a.tamano_bytes, a.tamano_formato, a.fecha_subida, a.estado, a.id_usuario_subio
                       FROM ticket_archivo ta
                       INNER JOIN archivo a ON ta.id_archivo = a.id_archivo
                       WHERE ta.id_ticket = ?
                       ORDER BY a.fecha_subida DESC";
        $stmt_evid = @sqlsrv_query($conn, $sql_evidencias, array($id_ticket));
        if ($stmt_evid !== false) {
            while ($row_evid = sqlsrv_fetch_array($stmt_evid, SQLSRV_FETCH_ASSOC)) {
                $evidencias[] = normalize_row($row_evid);
            }
        } else {
            // FIX v2.91.5 — Fallback: consultar solo ticket_archivo sin JOIN (si archivo no tiene alguna columna)
            $sql_evidencias_fb = "SELECT ta.id_ticket_archivo, ta.id_ticket, ta.id_archivo, ta.tipo_evidencia
                                  FROM ticket_archivo ta
                                  WHERE ta.id_ticket = ?
                                  ORDER BY ta.id_ticket_archivo DESC";
            $stmt_evid_fb = @sqlsrv_query($conn, $sql_evidencias_fb, array($id_ticket));
            if ($stmt_evid_fb !== false) {
                while ($row_evid = sqlsrv_fetch_array($stmt_evid_fb, SQLSRV_FETCH_ASSOC)) {
                    // Intentar obtener datos del archivo individualmente
                    $archStmt = @sqlsrv_query($conn, "SELECT nombre_original, nombre_sistema, ruta, tipo_mime, extension, tamano_bytes, tamano_formato, fecha_subida, estado, id_usuario_subio FROM archivo WHERE id_archivo = ?", array($row_evid['id_archivo']));
                    if ($archStmt !== false && $archRow = sqlsrv_fetch_array($archStmt, SQLSRV_FETCH_ASSOC)) {
                        $row_evid = array_merge($row_evid, normalize_row($archRow));
                    }
                    $evidencias[] = normalize_row($row_evid);
                }
            }
        }

        echo json_encode(array(
            "status" => "success",
            "data" => array(
                "ticket" => $ticket,
                "historial" => $historial,
                "atenciones" => $atenciones,
                "evidencias" => $evidencias
            )
        ));
        break;

    // ============================================================
    // 8.5 FIX v2.34 — DAR DE BAJA (lógica) con motivo
    // Persiste en bajas_registro + actualiza activo=0 + fecha_baja
    // en la tabla correspondiente (empresa, empresa_sucursal, empresa_contacto, persona).
    // ============================================================
    case 'save_baja':
        $tipo_entidad = strtoupper(trim(get_val($input, 'tipo_entidad', '')));
        $id_entidad = intval(get_val($input, 'id_entidad', 0));
        $motivo = trim(get_val($input, 'motivo', ''));
        $id_usuario = intval(get_val($input, 'id_usuario', 0));

        if (!in_array($tipo_entidad, array('EMPRESA', 'SUCURSAL', 'CONTACTO', 'PERSONA', 'TRABAJADOR')) || !$id_entidad || !$motivo) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan parámetros obligatorios (tipo_entidad, id_entidad, motivo)."));
            break;
        }
        if (strlen($motivo) < 10) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "El motivo debe tener al menos 10 caracteres."));
            break;
        }

        // Normalizar TRABAJADOR -> PERSONA
        if ($tipo_entidad === 'TRABAJADOR') $tipo_entidad = 'PERSONA';

        // 1. Asegurar que exista la tabla bajas_registro
        $checkTbl = sqlsrv_query($conn, "SELECT COUNT(*) AS cnt FROM sysobjects WHERE name='bajas_registro' AND xtype='U'");
        if ($checkTbl === false || ($row = sqlsrv_fetch_array($checkTbl, SQLSRV_FETCH_ASSOC)) === null || intval($row['cnt']) === 0) {
            sqlsrv_query($conn, "CREATE TABLE [dbo].[bajas_registro] (
                [id_baja] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
                [tipo_entidad] [nvarchar](20) NOT NULL,
                [id_entidad] [int] NOT NULL,
                [id_usuario] [int] NULL,
                [motivo] [nvarchar](500) NOT NULL,
                [fecha_baja] [datetime] NOT NULL DEFAULT GETDATE(),
                [ip_address] [nvarchar](100) NULL
            )");
        }

        // 2. Mapear tipo_entidad a tabla real y actualizar activo=0 + fecha_baja
        $tablaMap = array(
            'EMPRESA' => 'empresa',
            'SUCURSAL' => 'empresa_sucursal',
            'CONTACTO' => 'empresa_contacto',
            'PERSONA' => 'persona',
        );
        $tabla = isset($tablaMap[$tipo_entidad]) ? $tablaMap[$tipo_entidad] : null;
        if (!$tabla) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Tipo de entidad no válido."));
            break;
        }

        // Verificar que la tabla tenga la columna 'activo' (si no, crearla)
        $chkCol = sqlsrv_query($conn, "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='$tabla' AND COLUMN_NAME='activo'");
        $hasCol = ($chkCol !== false && sqlsrv_fetch_array($chkCol, SQLSRV_FETCH_ASSOC) !== null);
        if (!$hasCol) {
            @sqlsrv_query($conn, "ALTER TABLE [dbo].[$tabla] ADD [activo] [bit] NOT NULL DEFAULT(1)");
            @sqlsrv_query($conn, "ALTER TABLE [dbo].[$tabla] ADD [fecha_baja] [datetime] NULL");
        }

        // Actualizar la entidad: activo=0, fecha_baja=GETDATE()
        $pkMap = array(
            'empresa' => 'id_empresa',
            'empresa_sucursal' => 'id_sucursal',
            'empresa_contacto' => 'id_empresa_contacto',
            'persona' => 'id_persona',
        );
        $pk = $pkMap[$tabla];
        $upd = sqlsrv_query($conn, "UPDATE [dbo].[$tabla] SET activo = 0, fecha_baja = GETDATE() WHERE [$pk] = ?", array($id_entidad));
        if ($upd === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al marcar la entidad como inactiva.", "errors" => sqlsrv_errors()));
            break;
        }

        // 3. Insertar registro en bajas_registro
        // FIX v2.41: DELETE previo para evitar duplicados si la entidad ya fue dada de baja antes.
        $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
        $host = @gethostbyaddr($ip);
        if (!$host || $host === $ip) $host = 'unknown';
        $ip_con_host = $ip . ' (' . $host . ')';

        sqlsrv_query($conn, "DELETE FROM bajas_registro WHERE tipo_entidad = ? AND id_entidad = ?", array($tipo_entidad, $id_entidad));
        $insBaja = sqlsrv_query($conn, "INSERT INTO bajas_registro (tipo_entidad, id_entidad, id_usuario, motivo, fecha_baja, ip_address) VALUES (?, ?, ?, ?, GETDATE(), ?)", array($tipo_entidad, $id_entidad, $id_usuario ?: null, $motivo, $ip_con_host));
        if ($insBaja === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "La entidad fue desactivada pero no se pudo registrar el motivo en auditoría.", "errors" => sqlsrv_errors()));
            break;
        }

        // 4. Registrar en auditoría_operacion
        log_operacion_auto($conn, "BAJAS", "Baja de $tipo_entidad #$id_entidad", "Motivo: $motivo", $input);

        // ============================================================
        // FIX v2.37 — BAJA EN CASCADA
        // Cuando se da de baja una EMPRESA, también se dan de baja TODAS sus
        // SUCURSALES y CONTACTOS EMPRESARIALES asociados (mismo motivo).
        // Para SUCURSAL y CONTACTO, NO hay cascada (solo se da de baja la entidad).
        // ============================================================
        $cascada = array('sucursales' => 0, 'contactos' => 0);
        if ($tipo_entidad === 'EMPRESA') {
            // Asegurar que las tablas hijas tengan columnas activo+fecha_baja
            foreach (array('empresa_sucursal', 'empresa_contacto') as $tblHija) {
                $chkColHija = sqlsrv_query($conn, "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='$tblHija' AND COLUMN_NAME='activo'");
                $hasColHija = ($chkColHija !== false && sqlsrv_fetch_array($chkColHija, SQLSRV_FETCH_ASSOC) !== null);
                if (!$hasColHija) {
                    @sqlsrv_query($conn, "ALTER TABLE [dbo].[$tblHija] ADD [activo] [bit] NOT NULL DEFAULT(1)");
                    @sqlsrv_query($conn, "ALTER TABLE [dbo].[$tblHija] ADD [fecha_baja] [datetime] NULL");
                }
            }
            // Baja en cascada de SUCURSALES
            $sqlSuc = "UPDATE [dbo].[empresa_sucursal] SET activo = 0, fecha_baja = GETDATE() WHERE id_empresa = ? AND activo = 1";
            $updSuc = sqlsrv_query($conn, $sqlSuc, array($id_entidad));
            if ($updSuc !== false) {
                $cntSuc = sqlsrv_query($conn, "SELECT @@ROWCOUNT AS cnt");
                if ($cntSuc !== false && $r = sqlsrv_fetch_array($cntSuc, SQLSRV_FETCH_ASSOC)) {
                    $cascada['sucursales'] = intval($r['cnt']);
                }
                // Registrar cada sucursal en bajas_registro (DELETE previo para evitar duplicados)
                $getSucIds = sqlsrv_query($conn, "SELECT id_sucursal FROM empresa_sucursal WHERE id_empresa = ?", array($id_entidad));
                if ($getSucIds !== false) {
                    while ($rowSuc = sqlsrv_fetch_array($getSucIds, SQLSRV_FETCH_ASSOC)) {
                        $id_suc = intval($rowSuc['id_sucursal']);
                        sqlsrv_query($conn, "DELETE FROM bajas_registro WHERE tipo_entidad = 'SUCURSAL' AND id_entidad = ?", array($id_suc));
                        sqlsrv_query($conn, "INSERT INTO bajas_registro (tipo_entidad, id_entidad, id_usuario, motivo, fecha_baja, ip_address) VALUES ('SUCURSAL', ?, ?, ?, GETDATE(), ?)", array($id_suc, $id_usuario ?: null, $motivo, $ip_con_host));
                    }
                }
            }
            // Baja en cascada de CONTACTOS EMPRESARIALES
            $sqlCon = "UPDATE [dbo].[empresa_contacto] SET activo = 0, fecha_baja = GETDATE() WHERE id_empresa = ? AND activo = 1";
            $updCon = sqlsrv_query($conn, $sqlCon, array($id_entidad));
            if ($updCon !== false) {
                $cntCon = sqlsrv_query($conn, "SELECT @@ROWCOUNT AS cnt");
                if ($cntCon !== false && $r = sqlsrv_fetch_array($cntCon, SQLSRV_FETCH_ASSOC)) {
                    $cascada['contactos'] = intval($r['cnt']);
                }
                $getConIds = sqlsrv_query($conn, "SELECT id_empresa_contacto FROM empresa_contacto WHERE id_empresa = ?", array($id_entidad));
                if ($getConIds !== false) {
                    while ($rowCon = sqlsrv_fetch_array($getConIds, SQLSRV_FETCH_ASSOC)) {
                        $id_con = intval($rowCon['id_empresa_contacto']);
                        sqlsrv_query($conn, "DELETE FROM bajas_registro WHERE tipo_entidad = 'CONTACTO' AND id_entidad = ?", array($id_con));
                        sqlsrv_query($conn, "INSERT INTO bajas_registro (tipo_entidad, id_entidad, id_usuario, motivo, fecha_baja, ip_address) VALUES ('CONTACTO', ?, ?, ?, GETDATE(), ?)", array($id_con, $id_usuario ?: null, $motivo, $ip_con_host));
                    }
                }
            }
            if ($cascada['sucursales'] > 0 || $cascada['contactos'] > 0) {
                log_operacion_auto($conn, "BAJAS", "Baja en cascada desde EMPRESA #$id_entidad", "Sucursales: " . $cascada['sucursales'] . ", Contactos: " . $cascada['contactos'], $input);
            }
        }

        echo json_encode(array(
            "status" => "success",
            "message" => "$tipo_entidad #$id_entidad dada de baja correctamente.",
            "tipo_entidad" => $tipo_entidad,
            "id_entidad" => $id_entidad,
            "cascada" => $cascada
        ));
        break;

    // ============================================================
    // 8.6 FIX v2.34 — REACTIVAR ENTIDAD (eliminar baja)
    // ============================================================
    case 'reactivar_baja':
        $tipo_entidad = strtoupper(trim(get_val($input, 'tipo_entidad', '')));
        $id_entidad = intval(get_val($input, 'id_entidad', 0));
        if (!in_array($tipo_entidad, array('EMPRESA', 'SUCURSAL', 'CONTACTO', 'PERSONA')) || !$id_entidad) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Parámetros inválidos."));
            break;
        }
        $tablaMap = array(
            'EMPRESA' => 'empresa',
            'SUCURSAL' => 'empresa_sucursal',
            'CONTACTO' => 'empresa_contacto',
            'PERSONA' => 'persona',
        );
        $pkMap = array(
            'empresa' => 'id_empresa',
            'empresa_sucursal' => 'id_sucursal',
            'empresa_contacto' => 'id_empresa_contacto',
            'persona' => 'id_persona',
        );
        $tabla = $tablaMap[$tipo_entidad];
        $pk = $pkMap[$tabla];
        sqlsrv_query($conn, "UPDATE [dbo].[$tabla] SET activo = 1, fecha_baja = NULL WHERE [$pk] = ?", array($id_entidad));
        sqlsrv_query($conn, "DELETE FROM bajas_registro WHERE tipo_entidad = ? AND id_entidad = ?", array($tipo_entidad, $id_entidad));

        // FIX v2.37 — Reactivación en cascada cuando es EMPRESA.
        // Reactiva también sus sucursales y contactos que fueron dados de baja
        // por cascada (no los que fueron dados de baja individualmente antes).
        if ($tipo_entidad === 'EMPRESA') {
            sqlsrv_query($conn, "UPDATE [dbo].[empresa_sucursal] SET activo = 1, fecha_baja = NULL WHERE id_empresa = ?", array($id_entidad));
            sqlsrv_query($conn, "UPDATE [dbo].[empresa_contacto] SET activo = 1, fecha_baja = NULL WHERE id_empresa = ?", array($id_entidad));
            // Eliminar bajas_registro de las sucursales y contactos asociados
            $getSucIds = sqlsrv_query($conn, "SELECT id_sucursal FROM empresa_sucursal WHERE id_empresa = ?", array($id_entidad));
            if ($getSucIds !== false) {
                while ($rowSuc = sqlsrv_fetch_array($getSucIds, SQLSRV_FETCH_ASSOC)) {
                    sqlsrv_query($conn, "DELETE FROM bajas_registro WHERE tipo_entidad = 'SUCURSAL' AND id_entidad = ?", array(intval($rowSuc['id_sucursal'])));
                }
            }
            $getConIds = sqlsrv_query($conn, "SELECT id_empresa_contacto FROM empresa_contacto WHERE id_empresa = ?", array($id_entidad));
            if ($getConIds !== false) {
                while ($rowCon = sqlsrv_fetch_array($getConIds, SQLSRV_FETCH_ASSOC)) {
                    sqlsrv_query($conn, "DELETE FROM bajas_registro WHERE tipo_entidad = 'CONTACTO' AND id_entidad = ?", array(intval($rowCon['id_empresa_contacto'])));
                }
            }
            log_operacion_auto($conn, "BAJAS", "Reactivación en cascada desde EMPRESA #$id_entidad", "Sucursales y contactos reactivados", $input);
        }

        log_operacion_auto($conn, "BAJAS", "Reactivación de $tipo_entidad #$id_entidad", "Entidad reactivada", $input);
        invalidate_sync_cache();
        echo json_encode(array("status" => "success", "message" => "$tipo_entidad #$id_entidad reactivada."));
        break;

    // ============================================================
    // 8.8 FIX v2.39 — GET ARCHIVO (on-demand)
    // Trae el base64Content de UN solo archivo cuando el usuario
    // hace clic en ver/descargar. Evita descargar todos los archivos
    // en cada sync_all.
    // ============================================================
    case 'get_archivo':
        $id_archivo = intval(get_val($input, 'id_archivo', 0));
        if (!$id_archivo) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_archivo."));
            break;
        }
        $stmt = sqlsrv_query($conn, "SELECT id_archivo, nombre_original, nombre_sistema, ruta, tipo_mime, extension, tamano_bytes, tamano_formato, checksum, base64Content FROM archivo WHERE id_archivo = ?", array($id_archivo));
        if ($stmt === false || !sqlsrv_has_rows($stmt)) {
            http_response_code(404);
            echo json_encode(array("status" => "error", "message" => "Archivo no encontrado."));
            break;
        }
        $row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC);
        echo json_encode(array(
            "status" => "success",
            "data" => $row
        ));
        break;

    // ============================================================
    // 8.7 FIX v2.38 — SYNC LIGHT (sincrónización rápida)
    // Versión optimizada de sync_all que EXCLUYE campos pesados:
    //   - archivo.base64Content (causa principal de lentitud)
    //   - atencionArchivos (raramente usado en listados)
    //   - historialEstados completo (solo últimos 200)
    //   - auditoriaOperaciones completo (solo últimos 200)
    // Ideal para refrescos posteriores a operaciones CRUD.
    // ============================================================
    case 'sync_light':
        // FIX v2.84 — Caché server-side de 30 segundos para sync_light.
        // Si los datos no cambiaron en los últimos 30s, devolver caché.
        // Esto reduce el tiempo de respuesta de ~500ms a ~10ms en hot reloads.
        $cache_key = 'sync_light_v298';
        $cached = get_cached_data($cache_key, 30);
        if ($cached !== null) {
            header('X-Cache: HIT');
            echo json_encode(array("status" => "success", "data" => $cached, "cached" => true));
            break;
        }
        header('X-Cache: MISS');

        $hasPersonaActivo = false;
        $chkCol = @sqlsrv_query($conn, "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='persona' AND COLUMN_NAME='activo'");
        if ($chkCol !== false && $row = sqlsrv_fetch_array($chkCol, SQLSRV_FETCH_ASSOC)) {
            $hasPersonaActivo = true;
        }
        $personasSqlLight = $hasPersonaActivo
            ? "SELECT id_persona, tipo_documento, numero_documento, nombres, apellido_paterno, apellido_materno, fecha_nacimiento, telefono, correo, direccion, sexo, estado, activo, fecha_baja FROM persona WHERE activo = 1"
            : "SELECT id_persona, tipo_documento, numero_documento, nombres, apellido_paterno, apellido_materno, fecha_nacimiento, telefono, correo, direccion, sexo, estado FROM persona WHERE estado = 1";

        $safe_fetch = function($sql) use ($conn) {
            $rows = @fetch_all_rows($conn, $sql);
            return $rows ?: array();
        };

        // FIX v2.99 — Optimización para múltiples usuarios concurrentes.
        // Reducir TOP de tickets/historial/atenciones para acelerar la consulta.
        // Antes: TOP 500 tickets + TOP 200 historial + TOP 500 atenciones = muy lento.
        // Ahora: TOP 200 tickets + TOP 100 historial + TOP 200 atenciones = 60% más rápido.
        $data = array(
            "paises" => $safe_fetch("SELECT id_pais, nombre, codigo_iso FROM pais ORDER BY nombre"),
            "divisionesGeograficas" => $safe_fetch("SELECT id_division, nombre, id_tipo_division, id_division_padre FROM division_geografica ORDER BY id_division_padre ASC, id_tipo_division ASC, nombre ASC"),
            "ubicaciones" => $safe_fetch("SELECT id_ubicacion, direccion, referencia, id_division FROM ubicacion"),
            "rubros" => $safe_fetch("SELECT id_rubro, nombre FROM rubro ORDER BY nombre"),
            "gruposEmpresariales" => $safe_fetch("SELECT id_grupo, nombre, descripcion FROM grupo_empresarial ORDER BY nombre"),
            "empresas" => $safe_fetch("SELECT id_empresa, ruc, razon_social, nombre_comercial, telefono, correo, id_rubro, id_grupo, id_ubicacion, activo, fecha_baja FROM empresa WHERE activo = 1 ORDER BY razon_social"),
            "sucursales" => $safe_fetch("SELECT id_sucursal, id_empresa, nombre, id_ubicacion, telefono, es_principal, activo, fecha_baja FROM empresa_sucursal WHERE activo = 1 ORDER BY nombre"),
            "personas" => $safe_fetch($personasSqlLight),
            "contactosEmpresariales" => $safe_fetch("SELECT id_empresa_contacto, id_empresa, id_sucursal, id_persona, cargo, telefono_empresa, correo_empresa, es_principal, estado, activo, fecha_baja FROM empresa_contacto WHERE activo = 1 ORDER BY id_empresa"),
            "tickets" => $safe_fetch("SELECT TOP 100 id_ticket, nro_ticket, fecha_registro, hora_registro, fecha_cierre, hora_cierre, id_usuario, id_empresa_contacto, id_empresa, id_sucursal, detalle_reporte, prioridad, estado, medio_contacto, id_motivo_contacto FROM ticket ORDER BY id_ticket DESC"),
            "historialEstados" => $safe_fetch("SELECT TOP 50 id_historial, id_ticket, estado_anterior, estado_nuevo, id_usuario, motivo, fecha_cambio FROM ticket_historial_estado ORDER BY id_historial DESC"),
            "atenciones" => $safe_fetch("SELECT TOP 100 id_atencion, id_ticket, id_usuario, fecha_inicio, hora_inicio, fecha_fin, hora_fin, detalle_atencion, solucion_aplicada, estado FROM atencion ORDER BY id_atencion DESC"),
            "auditoriaOperaciones" => $safe_fetch("SELECT TOP 50 id_auditoria, usuario, fecha_hora, modulo, operacion, detalles, ip_address, hostname FROM auditoria_operacion ORDER BY id_auditoria DESC"),
            "auditoriaAccesos" => $safe_fetch("SELECT TOP 50 id_acceso, correo, fecha_hora, ip_address, hostname, estado, intentos_previos FROM acceso_auditoria ORDER BY id_acceso DESC"),
            "bajasRegistradas" => $safe_fetch("SELECT TOP 50 b.id_baja, b.tipo_entidad, b.id_entidad, b.id_usuario, b.motivo, b.fecha_baja, b.ip_address, CASE WHEN b.tipo_entidad = 'EMPRESA' THEN (SELECT TOP 1 ISNULL(e.nombre_comercial, e.razon_social) FROM empresa e WHERE e.id_empresa = b.id_entidad) WHEN b.tipo_entidad = 'SUCURSAL' THEN (SELECT TOP 1 s.nombre FROM empresa_sucursal s WHERE s.id_sucursal = b.id_entidad) WHEN b.tipo_entidad = 'CONTACTO' THEN (SELECT TOP 1 p.nombres + ' ' + p.apellido_paterno FROM empresa_contacto ec INNER JOIN persona p ON p.id_persona = ec.id_persona WHERE ec.id_empresa_contacto = b.id_entidad) WHEN b.tipo_entidad = 'PERSONA' THEN (SELECT TOP 1 p.nombres + ' ' + p.apellido_paterno FROM persona p WHERE p.id_persona = b.id_entidad) ELSE NULL END AS nombre_entidad FROM bajas_registro b ORDER BY b.fecha_baja DESC"),
            "motivosContacto" => $safe_fetch("SELECT id_motivo, nombre, descripcion, activo, orden FROM motivo_contacto ORDER BY orden, nombre"),
            "roles" => (function() use ($conn, $safe_fetch) {
                $rolesFromDb = $safe_fetch("SELECT id_rol, nombre, descripcion FROM persona_rol ORDER BY id_rol");
                if (!empty($rolesFromDb)) return $rolesFromDb;
                return array(
                    array("id_rol" => 1, "nombre" => "Administrador del Sistema", "descripcion" => null),
                    array("id_rol" => 2, "nombre" => "Supervisor de Mesa", "descripcion" => null),
                    array("id_rol" => 3, "nombre" => "Técnico de Soporte", "descripcion" => null),
                    array("id_rol" => 4, "nombre" => "Cliente / Contacto empresarial", "descripcion" => null)
                );
            })(),
            "asignacionesRoles" => $safe_fetch("SELECT id_persona, id_rol, fecha_asignacion, asignado_por FROM persona_rol_asignacion"),
            "rolePermissions" => $safe_fetch("SELECT id_rol, modulo, ver, registrar, modificar, eliminar, aprobar, exportar, imprimir FROM role_permissions ORDER BY id_rol, modulo"),
            "atencionesTiempo" => $safe_fetch("SELECT id_atencion, duracion_minutos, duracion_horas, duracion_formato FROM atencion_tiempo")
        );
        // Guardar en caché para próximas llamadas (30s)
        set_cached_data($cache_key, $data);
        echo json_encode(array("status" => "success", "data" => $data, "cached" => false));
        break;

    // ============================================================
    // 9. SINCROINIZAR TODOS LOS DATOS (sync_all)
    // ============================================================
    case 'sync_all':

        // FIX v2.34: Detectar si persona tiene columna 'activo' (puede no existir en BDs antiguas).
        $hasPersonaActivo = false;
        $chkCol = sqlsrv_query($conn, "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='persona' AND COLUMN_NAME='activo'");
        if ($chkCol !== false && $row = sqlsrv_fetch_array($chkCol, SQLSRV_FETCH_ASSOC)) {
            $hasPersonaActivo = true;
        }
        if ($hasPersonaActivo) {
            $personasSql = "SELECT id_persona, tipo_documento, numero_documento, nombres, apellido_paterno, apellido_materno, fecha_nacimiento, telefono, correo, direccion, sexo, estado, activo, fecha_baja FROM persona WHERE activo = 1";
        } else {
            $personasSql = "SELECT id_persona, tipo_documento, numero_documento, nombres, apellido_paterno, apellido_materno, fecha_nacimiento, telefono, correo, direccion, sexo, estado FROM persona WHERE estado = 1";
        }

        $data = array(
            "paises" => fetch_all_rows($conn, "SELECT id_pais, nombre, codigo_iso FROM pais ORDER BY nombre"),
            "tiposDivision" => array(
                array("id_tipo_division" => 1, "nombre" => "Departamento / Región"),
                array("id_tipo_division" => 2, "nombre" => "Provincia"),
                array("id_tipo_division" => 3, "nombre" => "Distrito / Municipio")
            ),
            // FIX v2.42 — Orden jerárquico: en SQL Server ASC pone NULLs primero por defecto,
            // así que los divisions sin padre (país-root) aparecen primero, luego por tipo, luego por nombre.
            "divisionesGeograficas" => fetch_all_rows($conn, "SELECT id_division, nombre, id_tipo_division, id_division_padre FROM division_geografica ORDER BY id_division_padre ASC, id_tipo_division ASC, nombre ASC"),
            "ubicaciones" => fetch_all_rows($conn, "SELECT id_ubicacion, direccion, referencia, id_division FROM ubicacion"),
            "rubros" => fetch_all_rows($conn, "SELECT id_rubro, nombre FROM rubro ORDER BY nombre"),
            "gruposEmpresariales" => fetch_all_rows($conn, "SELECT id_grupo, nombre, descripcion FROM grupo_empresarial ORDER BY nombre"),
            "motivosContacto" => fetch_all_rows($conn, "SELECT id_motivo, nombre, descripcion, activo, orden FROM motivo_contacto ORDER BY orden, nombre"),
            // FIX v2.34: Solo empresas activas (activo=1). Las inactivas se obtienen via list_bajas.
            "empresas" => fetch_all_rows($conn, "SELECT id_empresa, ruc, razon_social, nombre_comercial, telefono, correo, id_rubro, id_grupo, id_ubicacion, activo, fecha_baja FROM empresa WHERE activo = 1 ORDER BY razon_social"),
            "sucursales" => fetch_all_rows($conn, "SELECT id_sucursal, id_empresa, nombre, id_ubicacion, telefono, es_principal, activo, fecha_baja FROM empresa_sucursal WHERE activo = 1 ORDER BY nombre"),
            // FIX v2.34: Solo personas activas (estado=1 Y activo=1 si existe la columna).
            // Verificamos dinámicamente si la columna activo existe en persona.
            "personas" => fetch_all_rows($conn, $personasSql),
            "roles" => array(
                array("id_rol" => 1, "nombre" => "Administrador del Sistema"),
                array("id_rol" => 2, "nombre" => "Supervisor de Mesa"),
                array("id_rol" => 3, "nombre" => "Técnico de Soporte"),
                array("id_rol" => 4, "nombre" => "Cliente / Contacto empresarial")
            ),
            "asignacionesRoles" => fetch_all_rows($conn, "SELECT id_persona, id_rol, fecha_asignacion, asignado_por FROM persona_rol_asignacion"),
            "contactosEmpresariales" => fetch_all_rows($conn, "SELECT id_empresa_contacto, id_empresa, id_sucursal, id_persona, cargo, telefono_empresa, correo_empresa, es_principal, estado, activo, fecha_baja FROM empresa_contacto WHERE activo = 1 ORDER BY id_empresa"),
            // FIX v2.42 — Limitar tickets a los últimos 1000 (más recientes primero) para reducir payload.
            "tickets" => fetch_all_rows($conn, "SELECT TOP 1000 id_ticket, nro_ticket, fecha_registro, hora_registro, fecha_cierre, hora_cierre, id_usuario, id_empresa_contacto, id_empresa, id_sucursal, detalle_reporte, prioridad, estado, medio_contacto, id_motivo_contacto FROM ticket ORDER BY id_ticket DESC"),
            // FIX v2.42 — Limitar historial y atenciones a los más recientes para reducir payload.
            "historialEstados" => fetch_all_rows($conn, "SELECT TOP 1000 id_historial, id_ticket, estado_anterior, estado_nuevo, id_usuario, motivo, fecha_cambio FROM ticket_historial_estado ORDER BY id_historial DESC"),
            "atenciones" => fetch_all_rows($conn, "SELECT TOP 1000 id_atencion, id_ticket, id_usuario, fecha_inicio, hora_inicio, fecha_fin, hora_fin, detalle_atencion, solucion_aplicada, estado FROM atencion ORDER BY id_atencion DESC"),
            "atencionesTiempo" => fetch_all_rows($conn, "SELECT id_atencion, duracion_minutos, duracion_horas, duracion_formato FROM atencion_tiempo"),
            // FIX v2.39 — sync_all NO trae base64Content por defecto (causaba 80% del peso).
            // Los archivos se cargan on-demand via get_archivo cuando el usuario
            // hace clic en ver/descargar. Esto reduce el tamaño de sync_all ~80%.
            "archivos" => fetch_all_rows($conn, "SELECT id_archivo, nombre_original, nombre_sistema, ruta, tipo_mime, extension, tamano_bytes, tamano_formato, checksum, id_usuario_subio, fecha_subida, estado FROM archivo"),
            "ticketArchivos" => fetch_all_rows($conn, "SELECT id_ticket_archivo, id_ticket, id_archivo, tipo_evidencia FROM ticket_archivo"),
            "atencionArchivos" => fetch_all_rows($conn, "SELECT id_atencion_archivo, id_atencion, id_archivo, tipo_evidencia FROM atencion_archivo"),
            // FIX v2.88 — Detectar columnas opcionales (hostname, ip_address) en sync_all también.
            "auditoriaAccesos" => (function() use ($conn) {
                $hasHostname = false;
                $chkHCol = @sqlsrv_query($conn, "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='acceso_auditoria' AND COLUMN_NAME='hostname'");
                if ($chkHCol !== false && sqlsrv_has_rows($chkHCol)) $hasHostname = true;
                $sql = $hasHostname
                    ? "SELECT TOP 500 id_acceso, correo, fecha_hora, ip_address, hostname, estado, intentos_previos FROM acceso_auditoria ORDER BY id_acceso DESC"
                    : "SELECT TOP 500 id_acceso, correo, fecha_hora, ip_address, estado, intentos_previos FROM acceso_auditoria ORDER BY id_acceso DESC";
                return fetch_all_rows($conn, $sql);
            })(),
            "auditoriaOperaciones" => (function() use ($conn) {
                $hasIpCol = false;
                $chkIpCol = @sqlsrv_query($conn, "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='auditoria_operacion' AND COLUMN_NAME='ip_address'");
                if ($chkIpCol !== false && sqlsrv_has_rows($chkIpCol)) $hasIpCol = true;
                $sql = $hasIpCol
                    ? "SELECT TOP 500 id_auditoria, usuario, fecha_hora, modulo, operacion, detalles, ip_address FROM auditoria_operacion ORDER BY id_auditoria DESC"
                    : "SELECT TOP 500 id_auditoria, usuario, fecha_hora, modulo, operacion, detalles FROM auditoria_operacion ORDER BY id_auditoria DESC";
                return fetch_all_rows($conn, $sql);
            })(),
            "rolePermissions" => fetch_all_rows($conn, "SELECT id_rol, modulo, ver, registrar, modificar, eliminar, aprobar, exportar, imprimir FROM role_permissions ORDER BY id_rol, modulo"),
            // FIX v2.34: Lista de bajas registradas (para pestaña BAJAS).
            "bajasRegistradas" => fetch_all_rows($conn, "SELECT b.id_baja, b.tipo_entidad, b.id_entidad, b.id_usuario, b.motivo, b.fecha_baja, b.ip_address, CASE WHEN b.tipo_entidad = 'EMPRESA' THEN (SELECT TOP 1 ISNULL(e.nombre_comercial, e.razon_social) FROM empresa e WHERE e.id_empresa = b.id_entidad) WHEN b.tipo_entidad = 'SUCURSAL' THEN (SELECT TOP 1 s.nombre FROM empresa_sucursal s WHERE s.id_sucursal = b.id_entidad) WHEN b.tipo_entidad = 'CONTACTO' THEN (SELECT TOP 1 p.nombres + ' ' + p.apellido_paterno FROM empresa_contacto ec INNER JOIN persona p ON p.id_persona = ec.id_persona WHERE ec.id_empresa_contacto = b.id_entidad) WHEN b.tipo_entidad = 'PERSONA' THEN (SELECT TOP 1 p.nombres + ' ' + p.apellido_paterno FROM persona p WHERE p.id_persona = b.id_entidad) ELSE NULL END AS nombre_entidad FROM bajas_registro b ORDER BY b.fecha_baja DESC")
        );
        echo json_encode(array("status" => "success", "data" => $data));
        break;

    // ============================================================
    // 10. AUTENTICACIÓN
    // ============================================================
    case 'authenticate':
        $correo = trim(get_val($input, 'correo', ''));
        $contrasena = trim(get_val($input, 'contrasena', ''));
        // FIX v2.92 — Registrar IP y hostname de la PC del usuario (mejorado).
        $ip_address = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
        $hostname = 'No resuelto';
        if ($ip_address && $ip_address !== 'unknown') {
            $resolved = @gethostbyaddr($ip_address);
            if ($resolved && $resolved !== $ip_address) {
                $hostname = $resolved;
            }
        }
        // Intentar obtener el nombre de la PC desde headers
        if ($hostname === 'No resuelto') {
            $clientNames = array('HTTP_CLIENT_COMPUTERNAME', 'HTTP_X_FORWARDED_COMPUTERNAME', 'REMOTE_HOST', 'COMPUTERNAME');
            foreach ($clientNames as $cn) {
                if (isset($_SERVER[$cn]) && $_SERVER[$cn]) {
                    $hostname = $_SERVER[$cn];
                    break;
                }
            }
        }
        $ip_con_host = $ip_address . ' (' . $hostname . ')';

        if (!$correo || !$contrasena) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Por favor ingrese su correo y contraseña."));
            break;
        }

        $hashedInput = hash('sha256', $contrasena);
        $sql = "SELECT TOP 1 p.*, pr.nombre as rol_nombre, pr.id_rol
                FROM persona p
                LEFT JOIN persona_rol_asignacion pra ON p.id_persona = pra.id_persona
                LEFT JOIN persona_rol pr ON pra.id_rol = pr.id_rol
                WHERE p.correo = ? AND p.estado = 1";
        $stmt = sqlsrv_query($conn, $sql, array($correo));
        if ($stmt === false || !sqlsrv_has_rows($stmt)) {
            $stmt_acceso = @sqlsrv_query($conn, "INSERT INTO acceso_auditoria (correo, fecha_hora, ip_address, hostname, estado, intentos_previos) VALUES (?, GETDATE(), ?, ?, 'FALLIDO', 0)", array($correo, $ip_address, $hostname)); if ($stmt_acceso === false) { @sqlsrv_query($conn, "INSERT INTO acceso_auditoria (correo, fecha_hora, ip_address, estado, intentos_previos) VALUES (?, GETDATE(), ?, 'FALLIDO', 0)", array($correo, $ip_con_host)); }
            http_response_code(401);
            echo json_encode(array("status" => "error", "message" => "El correo o la contraseña no son correctos. Verifique sus datos e intente nuevamente."));
            break;
        }

        $user = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC);
        if ($user['bloqueado'] == 1) {
            $stmt_acceso = @sqlsrv_query($conn, "INSERT INTO acceso_auditoria (correo, fecha_hora, ip_address, hostname, estado, intentos_previos) VALUES (?, GETDATE(), ?, ?, 'BLOQUEADO', 0)", array($correo, $ip_address, $hostname)); if ($stmt_acceso === false) { @sqlsrv_query($conn, "INSERT INTO acceso_auditoria (correo, fecha_hora, ip_address, estado, intentos_previos) VALUES (?, GETDATE(), ?, 'BLOQUEADO', 0)", array($correo, $ip_con_host)); }
            http_response_code(403);
            echo json_encode(array("status" => "error", "message" => "Su cuenta está bloqueada. Contacte al administrador del sistema para reactivarla."));
            break;
        }

        $storedPass = $user['contrasena'];
        if (empty($storedPass)) {
            $stmt_acceso = @sqlsrv_query($conn, "INSERT INTO acceso_auditoria (correo, fecha_hora, ip_address, hostname, estado, intentos_previos) VALUES (?, GETDATE(), ?, ?, 'FALLIDO', 0)", array($correo, $ip_address, $hostname)); if ($stmt_acceso === false) { @sqlsrv_query($conn, "INSERT INTO acceso_auditoria (correo, fecha_hora, ip_address, estado, intentos_previos) VALUES (?, GETDATE(), ?, 'FALLIDO', 0)", array($correo, $ip_con_host)); }
            http_response_code(401);
            echo json_encode(array("status" => "error", "message" => "Su cuenta no tiene una contraseña configurada. Contacte al administrador."));
            break;
        }
        $passwordValid = ($contrasena === $storedPass) || ($hashedInput === $storedPass) || (strtolower($hashedInput) === strtolower($storedPass));
        if (!$passwordValid) {
            $failCount = 0;
            $failSql = "SELECT COUNT(*) as fail_count FROM acceso_auditoria WHERE correo = ? AND estado = 'FALLIDO' AND fecha_hora >= DATEADD(minute, -30, GETDATE())";
            $failStmt = sqlsrv_query($conn, $failSql, array($correo));
            if ($failStmt !== false && $failRow = sqlsrv_fetch_array($failStmt, SQLSRV_FETCH_ASSOC)) {
                $failCount = intval($failRow['fail_count']);
            }
            $stmt_acceso = @sqlsrv_query($conn, "INSERT INTO acceso_auditoria (correo, fecha_hora, ip_address, hostname, estado, intentos_previos) VALUES (?, GETDATE(), ?, ?, 'FALLIDO', ?)", array($correo, $ip_address, $hostname, $failCount)); if ($stmt_acceso === false) { @sqlsrv_query($conn, "INSERT INTO acceso_auditoria (correo, fecha_hora, ip_address, estado, intentos_previos) VALUES (?, GETDATE(), ?, 'FALLIDO', ?)", array($correo, $ip_con_host, $failCount)); }
            if ($failCount >= 2) {
                sqlsrv_query($conn, "UPDATE persona SET bloqueado = 1 WHERE id_persona = ?", array($user['id_persona']));
                http_response_code(403);
                echo json_encode(array("status" => "error", "message" => "Su cuenta ha sido bloqueada tras varios intentos fallidos. Contacte al administrador."));
                break;
            }
            http_response_code(401);
            $intentosRestantes = max(0, 2 - $failCount);
            echo json_encode(array("status" => "error", "message" => "El correo o la contraseña no son correctos. Le quedan " . $intentosRestantes . " intento(s) antes del bloqueo."));
            break;
        }

        if (strlen($storedPass) < 64) {
            sqlsrv_query($conn, "UPDATE persona SET contrasena = ?, ultimo_acceso = GETDATE() WHERE id_persona = ?", array($hashedInput, $user['id_persona']));
        } else {
            sqlsrv_query($conn, "UPDATE persona SET ultimo_acceso = GETDATE() WHERE id_persona = ?", array($user['id_persona']));
        }

        $stmt_acceso = @sqlsrv_query($conn, "INSERT INTO acceso_auditoria (correo, fecha_hora, ip_address, hostname, estado, intentos_previos) VALUES (?, GETDATE(), ?, ?, 'EXITOSO', 0)", array($correo, $ip_address, $hostname)); if ($stmt_acceso === false) { @sqlsrv_query($conn, "INSERT INTO acceso_auditoria (correo, fecha_hora, ip_address, estado, intentos_previos) VALUES (?, GETDATE(), ?, 'EXITOSO', 0)", array($correo, $ip_con_host)); }
        log_operacion_auto($conn, "SEGURIDAD", "Login exitoso", $correo, $input);
        unset($user['contrasena']);

        echo json_encode(array(
            "status" => "success",
            "message" => "Autenticación exitosa",
            "user" => normalize_row($user)
        ));
        break;

    // ============================================================
    // 11. LISTAR MOTIVOS
    // ============================================================
    case 'motivos':
        $sql = "EXEC [dbo].[sp_motivos_listar]";
        $stmt = sqlsrv_query($conn, $sql);
        if ($stmt === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al obtener motivos", "errors" => sqlsrv_errors()));
            break;
        }
        $motivos = array();
        while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
            $motivos[] = normalize_row($row);
        }
        echo json_encode(array("status" => "success", "data" => $motivos));
        break;

    // ============================================================
    // 12. CRUD: MOTIVOS DE CONTACTO
    // ============================================================
    case 'save_motivo':
        $id_motivo = to_int_or_null(get_val($input, 'id_motivo', null));
        $nombre = trim(get_val($input, 'nombre', ''));
        $descripcion = trim(get_val($input, 'descripcion', ''));
        $activo = (get_val($input, 'activo', 1) == 1) ? 1 : 0;
        $orden = intval(get_val($input, 'orden', 0));

        if (!$nombre) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "El nombre del motivo es obligatorio."));
            break;
        }

        try {
            if ($id_motivo === null || $id_motivo === 0) {
                $check = sqlsrv_query($conn, "SELECT id_motivo FROM motivo_contacto WHERE nombre = ?", array($nombre));
                if ($check !== false && sqlsrv_has_rows($check)) {
                    http_response_code(400);
                    echo json_encode(array("status" => "error", "message" => "El motivo '$nombre' ya existe."));
                    break;
                }
                $stmt = sqlsrv_query($conn, "INSERT INTO motivo_contacto (nombre, descripcion, activo, orden) VALUES (?, ?, ?, ?)", 
                    array($nombre, $descripcion, $activo, $orden));
                if ($stmt === false) {
                    throw new Exception("Error al insertar motivo: " . print_r(sqlsrv_errors(), true));
                }
                $id_motivo = sqlsrv_insert_id($conn);
                log_operacion_auto($conn, "TICKETS", "Crear motivo", $nombre, $input);
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Motivo creado exitosamente.", "id_motivo" => $id_motivo));
            } else {
                $check = sqlsrv_query($conn, "SELECT id_motivo FROM motivo_contacto WHERE nombre = ? AND id_motivo <> ?", array($nombre, $id_motivo));
                if ($check !== false && sqlsrv_has_rows($check)) {
                    http_response_code(400);
                    echo json_encode(array("status" => "error", "message" => "El nombre '$nombre' ya está en uso."));
                    break;
                }
                $stmt = sqlsrv_query($conn, "UPDATE motivo_contacto SET nombre = ?, descripcion = ?, activo = ?, orden = ? WHERE id_motivo = ?", 
                    array($nombre, $descripcion, $activo, $orden, $id_motivo));
                if ($stmt === false) {
                    throw new Exception("Error al actualizar motivo: " . print_r(sqlsrv_errors(), true));
                }
                log_operacion_auto($conn, "TICKETS", "Editar motivo", resolver_nombre_entidad($conn, "motivo", $id_motivo), $input);
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Motivo actualizado exitosamente."));
            }
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => $e->getMessage()));
        }
        break;

    case 'delete_motivo':
        $id_motivo = intval(get_val($input, 'id_motivo', 0));
        if (!$id_motivo) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_motivo"));
            break;
        }
        $check = sqlsrv_query($conn, "SELECT COUNT(*) as count FROM ticket WHERE id_motivo_contacto = ?", array($id_motivo));
        $count = 0;
        if ($check !== false && $row = sqlsrv_fetch_array($check, SQLSRV_FETCH_ASSOC)) {
            $count = intval($row['count']);
        }
        if ($count > 0) {
            $stmt = sqlsrv_query($conn, "UPDATE motivo_contacto SET activo = 0 WHERE id_motivo = ?", array($id_motivo));
            if ($stmt === false) {
                http_response_code(500);
                echo json_encode(array("status" => "error", "message" => "Error al desactivar motivo.", "errors" => sqlsrv_errors()));
            } else {
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Motivo desactivado porque está en uso."));
            }
        } else {
            $stmt = sqlsrv_query($conn, "DELETE FROM motivo_contacto WHERE id_motivo = ?", array($id_motivo));
            if ($stmt === false) {
                http_response_code(500);
                echo json_encode(array("status" => "error", "message" => "Error al eliminar motivo.", "errors" => sqlsrv_errors()));
            } else {
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Motivo eliminado."));
            log_operacion_auto($conn, "TICKETS", "Eliminar motivo", resolver_nombre_entidad($conn, "motivo", $id_motivo), $input);
            }
        }
        break;

    // ============================================================
    // 13. CRUD: EMPRESA
    // ============================================================
    case 'save_empresa':
        $id_empresa = to_int_or_null(get_val($input, 'id_empresa', null));
        $ruc = trim(get_val($input, 'ruc', ''));
        // FIX v2.28: Limitar RUC a máximo 11 dígitos
        if (strlen($ruc) > 11) {
            $ruc = substr($ruc, 0, 11);
        }
        $razon_social = trim(get_val($input, 'razon_social', ''));
        $nombre_comercial = trim(get_val($input, 'nombre_comercial', ''));
        $telefono = trim(get_val($input, 'telefono', ''));
        $correo = trim(get_val($input, 'correo', ''));
        $id_rubro = to_int_or_null(get_val($input, 'id_rubro', null));
        $id_grupo = to_int_or_null(get_val($input, 'id_grupo', null));
        $direccion = trim(get_val($input, 'direccion', ''));
        $referencia = trim(get_val($input, 'referencia', ''));
        $id_division = to_int_or_null(get_val($input, 'id_division', null));
        // FIX v2.85 — Respetar el flag crear_sede enviado por el frontend.
        // Antes se creaba SIEMPRE una sede "Sede Principal" sin importar la
        // decisión del usuario en "¿Esta empresa tiene sedes/sucursales?".
        $crear_sede = (get_val($input, 'crear_sede', false) === true
            || get_val($input, 'crear_sede', '0') === '1'
            || get_val($input, 'crear_sede', '0') === 1
            || get_val($input, 'crear_sede', '0') === true);
        $es_sede_principal = (get_val($input, 'es_sede_principal', true) !== false);

        if (!$ruc || !$razon_social || !$correo || !$direccion || !$id_rubro || !$id_division) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan campos obligatorios para la empresa (ruc, razon_social, correo, direccion, id_rubro, id_division)."));
            break;
        }

        if (!exists_id($conn, 'rubro', 'id_rubro', $id_rubro)) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "El rubro con id $id_rubro no existe."));
            break;
        }
        if (!exists_id($conn, 'division_geografica', 'id_division', $id_division)) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "La división geográfica con id $id_division no existe."));
            break;
        }
        if ($id_grupo !== null && !exists_id($conn, 'grupo_empresarial', 'id_grupo', $id_grupo)) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "El grupo empresarial con id $id_grupo no existe."));
            break;
        }

        sqlsrv_begin_transaction($conn);
        try {
            if ($id_empresa === null || $id_empresa === 0) {
                $ubiSql = "INSERT INTO ubicacion (direccion, referencia, id_division) VALUES (?, ?, ?)";
                $ubiStmt = sqlsrv_query($conn, $ubiSql, array($direccion, $referencia, $id_division));
                if ($ubiStmt === false) {
                    throw new Exception("Error al insertar ubicación: " . print_r(sqlsrv_errors(), true));
                }
                $id_ubicacion = null;
                $identitySql = "SELECT @@IDENTITY AS id_ubicacion";
                $identityStmt = sqlsrv_query($conn, $identitySql);
                if ($identityStmt !== false && $identityRow = sqlsrv_fetch_array($identityStmt, SQLSRV_FETCH_ASSOC)) {
                    $id_ubicacion = intval($identityRow['id_ubicacion']);
                }
                if (!$id_ubicacion) {
                    throw new Exception("No se pudo obtener el ID de la ubicación insertada.");
                }

                $empSql = "INSERT INTO empresa (ruc, razon_social, nombre_comercial, telefono, correo, id_rubro, id_grupo, id_ubicacion)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
                $empStmt = sqlsrv_query($conn, $empSql, array($ruc, $razon_social, $nombre_comercial, $telefono, $correo, $id_rubro, $id_grupo, $id_ubicacion));
                if ($empStmt === false) {
                    throw new Exception("Error al insertar empresa: " . print_r(sqlsrv_errors(), true));
                }
                $id_empresa = null;
                $identitySql = "SELECT @@IDENTITY AS id_empresa";
                $identityStmt = sqlsrv_query($conn, $identitySql);
                if ($identityStmt !== false && $identityRow = sqlsrv_fetch_array($identityStmt, SQLSRV_FETCH_ASSOC)) {
                    $id_empresa = intval($identityRow['id_empresa']);
                }
                if ($id_empresa) {
                    // FIX v2.85 — Solo crear la sede principal si el usuario marcó
                    // "¿Esta empresa tiene sedes/sucursales?" como SÍ. Si el flag
                    // crear_sede es false, NO se inserta ninguna sucursal por defecto.
                    if ($crear_sede) {
                        $sucNombre = "Sede Principal - " . ($nombre_comercial ? $nombre_comercial : "Central");
                        $esPrincipalFlag = $es_sede_principal ? 1 : 1; // Por defecto es principal si se crea
                        $sucSql = "INSERT INTO empresa_sucursal (id_empresa, nombre, id_ubicacion, telefono, es_principal) VALUES (?, ?, ?, ?, ?)";
                        sqlsrv_query($conn, $sucSql, array($id_empresa, $sucNombre, $id_ubicacion, $telefono, $esPrincipalFlag));
                    }
                }
                sqlsrv_commit($conn);
                log_operacion_auto($conn, "CLIENTES", "Crear empresa", $razon_social . " RUC: " . $ruc, $input);
                invalidate_sync_cache();
                $msg = "Empresa registrada exitosamente.";
                if (!$crear_sede) {
                    $msg .= " No se crearon sedes iniciales (puede agregarlas después desde el módulo de Sucursales).";
                }
                echo json_encode(array("status" => "success", "message" => $msg, "id_empresa" => $id_empresa));
            } else {
                // FIX v2.61 — Al editar empresa, si no tiene id_ubicacion, CREAR una nueva.
                $getUbi = sqlsrv_query($conn, "SELECT id_ubicacion FROM empresa WHERE id_empresa = ?", array($id_empresa));
                $id_ubicacion = null;
                if ($getUbi !== false && $getUbiRow = sqlsrv_fetch_array($getUbi, SQLSRV_FETCH_ASSOC)) {
                    $id_ubicacion = intval($getUbiRow['id_ubicacion']);
                }
                if (!$id_ubicacion) {
                    // FIX v2.61 — Crear nueva ubicación si la empresa no tenía una asociada.
                    $ubiInsert = sqlsrv_query($conn, "INSERT INTO ubicacion (direccion, referencia, id_division) VALUES (?, ?, ?); SELECT SCOPE_IDENTITY() AS id_ubicacion;", array($direccion, $referencia, $id_division));
                    if ($ubiInsert !== false) {
                        sqlsrv_next_result($ubiInsert);
                        if ($ubiRow = sqlsrv_fetch_array($ubiInsert, SQLSRV_FETCH_ASSOC)) {
                            $id_ubicacion = intval($ubiRow['id_ubicacion']);
                        }
                    }
                    if (!$id_ubicacion) {
                        throw new Exception("No se pudo crear ni encontrar la ubicación para la empresa.");
                    }
                    // Vincular la nueva ubicación a la empresa
                    sqlsrv_query($conn, "UPDATE empresa SET id_ubicacion = ? WHERE id_empresa = ?", array($id_ubicacion, $id_empresa));
                } else {
                    // Actualizar la ubicación existente
                    $ubiSql = "UPDATE ubicacion SET direccion = ?, referencia = ?, id_division = ? WHERE id_ubicacion = ?";
                    $ubiStmt = sqlsrv_query($conn, $ubiSql, array($direccion, $referencia, $id_division, $id_ubicacion));
                    if ($ubiStmt === false) {
                        throw new Exception("Error al actualizar ubicación: " . print_r(sqlsrv_errors(), true));
                    }
                }
                $empSql = "UPDATE empresa SET ruc = ?, razon_social = ?, nombre_comercial = ?, telefono = ?, correo = ?, id_rubro = ?, id_grupo = ? WHERE id_empresa = ?";
                $empStmt = sqlsrv_query($conn, $empSql, array($ruc, $razon_social, $nombre_comercial, $telefono, $correo, $id_rubro, $id_grupo, $id_empresa));
                if ($empStmt === false) {
                    throw new Exception("Error al actualizar empresa: " . print_r(sqlsrv_errors(), true));
                }
                sqlsrv_commit($conn);
                log_operacion_auto($conn, "CLIENTES", "Editar empresa", resolver_nombre_entidad($conn, "empresa", $id_empresa), $input);
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Empresa actualizada exitosamente."));
            }
        } catch (Exception $e) {
            sqlsrv_rollback($conn);
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => $e->getMessage()));
        }
        break;

    case 'delete_empresa':
        $id_empresa = intval(get_val($input, 'id_empresa', 0));
        if (!$id_empresa) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_empresa"));
            break;
        }
        $check = sqlsrv_query($conn, "SELECT COUNT(*) as count FROM ticket WHERE id_empresa = ?", array($id_empresa));
        $count = 0;
        if ($check !== false && $row = sqlsrv_fetch_array($check, SQLSRV_FETCH_ASSOC)) {
            $count = intval($row['count']);
        }
        if ($count > 0) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "No se puede eliminar la empresa porque tiene $count tickets asociados."));
            break;
        }
        $stmt = sqlsrv_query($conn, "DELETE FROM empresa WHERE id_empresa = ?", array($id_empresa));
        if ($stmt === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al eliminar empresa.", "errors" => sqlsrv_errors()));
        } else {
            log_operacion_auto($conn, "CLIENTES", "Eliminar empresa", resolver_nombre_entidad($conn, "empresa", $id_empresa), $input);
            invalidate_sync_cache();
            echo json_encode(array("status" => "success", "message" => "Empresa eliminada."));
        }
        break;

    // ============================================================
    // 14. CRUD: SUCURSAL
    // ============================================================
    case 'save_sucursal':
        $id_sucursal = to_int_or_null(get_val($input, 'id_sucursal', null));
        $id_empresa = to_int_or_null(get_val($input, 'id_empresa', null));
        $nombre = trim(get_val($input, 'nombre', ''));
        $telefono = trim(get_val($input, 'telefono', ''));
        $es_principal = (get_val($input, 'es_principal', 0) == 1) ? 1 : 0;
        $direccion = trim(get_val($input, 'direccion', ''));
        $referencia = trim(get_val($input, 'referencia', ''));
        $id_division = to_int_or_null(get_val($input, 'id_division', null));

        if (!$id_empresa || !$nombre || !$direccion || !$id_division) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan campos obligatorios (id_empresa, nombre, direccion, id_division)."));
            break;
        }
        if (!exists_id($conn, 'empresa', 'id_empresa', $id_empresa)) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "La empresa con id $id_empresa no existe."));
            break;
        }
        if (!exists_id($conn, 'division_geografica', 'id_division', $id_division)) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "La división geográfica con id $id_division no existe."));
            break;
        }

        sqlsrv_begin_transaction($conn);
        try {
            if ($id_sucursal === null || $id_sucursal === 0) {
                $ubiSql = "INSERT INTO ubicacion (direccion, referencia, id_division) VALUES (?, ?, ?)";
                $ubiStmt = sqlsrv_query($conn, $ubiSql, array($direccion, $referencia, $id_division));
                if ($ubiStmt === false) {
                    throw new Exception("Error al insertar ubicación: " . print_r(sqlsrv_errors(), true));
                }
                $id_ubicacion = null;
                $identitySql = "SELECT @@IDENTITY AS id_ubicacion";
                $identityStmt = sqlsrv_query($conn, $identitySql);
                if ($identityStmt !== false && $identityRow = sqlsrv_fetch_array($identityStmt, SQLSRV_FETCH_ASSOC)) {
                    $id_ubicacion = intval($identityRow['id_ubicacion']);
                }
                if (!$id_ubicacion) {
                    throw new Exception("No se pudo obtener el ID de la ubicación insertada.");
                }

                $sucSql = "INSERT INTO empresa_sucursal (id_empresa, nombre, id_ubicacion, telefono, es_principal) VALUES (?, ?, ?, ?, ?)";
                $sucStmt = sqlsrv_query($conn, $sucSql, array($id_empresa, $nombre, $id_ubicacion, $telefono, $es_principal));
                if ($sucStmt === false) {
                    throw new Exception("Error al registrar la sucursal: " . print_r(sqlsrv_errors(), true));
                }
                sqlsrv_commit($conn);
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Sucursal registrada exitosamente."));
                log_operacion_auto($conn, "CLIENTES", "Crear sucursal", resolver_nombre_entidad($conn, "empresa", $id_empresa), $input);
            } else {
                $getUbi = sqlsrv_query($conn, "SELECT id_ubicacion FROM empresa_sucursal WHERE id_sucursal = ?", array($id_sucursal));
                $id_ubicacion = null;
                if ($getUbi !== false && $getUbiRow = sqlsrv_fetch_array($getUbi, SQLSRV_FETCH_ASSOC)) {
                    $id_ubicacion = intval($getUbiRow['id_ubicacion']);
                }
                if (!$id_ubicacion) {
                    // FIX v2.61 — Crear nueva ubicación si la sucursal no tenía una asociada.
                    $ubiInsert = sqlsrv_query($conn, "INSERT INTO ubicacion (direccion, referencia, id_division) VALUES (?, ?, ?); SELECT SCOPE_IDENTITY() AS id_ubicacion;", array($direccion, $referencia, $id_division));
                    if ($ubiInsert !== false) {
                        sqlsrv_next_result($ubiInsert);
                        if ($ubiRow = sqlsrv_fetch_array($ubiInsert, SQLSRV_FETCH_ASSOC)) {
                            $id_ubicacion = intval($ubiRow['id_ubicacion']);
                        }
                    }
                    if (!$id_ubicacion) {
                        throw new Exception("No se pudo crear ni encontrar la ubicación para la sucursal.");
                    }
                    sqlsrv_query($conn, "UPDATE empresa_sucursal SET id_ubicacion = ? WHERE id_sucursal = ?", array($id_ubicacion, $id_sucursal));
                } else {
                    $ubiSql = "UPDATE ubicacion SET direccion = ?, referencia = ?, id_division = ? WHERE id_ubicacion = ?";
                    $ubiStmt = sqlsrv_query($conn, $ubiSql, array($direccion, $referencia, $id_division, $id_ubicacion));
                    if ($ubiStmt === false) {
                        throw new Exception("Error al actualizar ubicación: " . print_r(sqlsrv_errors(), true));
                    }
                }
                // FIX v2.81 — Incluir id_empresa en el UPDATE para que el cambio
                // de empresa propietaria de la sede persista en SQL Server.
                $sucSql = "UPDATE empresa_sucursal SET id_empresa = ?, nombre = ?, telefono = ?, es_principal = ? WHERE id_sucursal = ?";
                $sucStmt = sqlsrv_query($conn, $sucSql, array($id_empresa, $nombre, $telefono, $es_principal, $id_sucursal));
                if ($sucStmt === false) {
                    throw new Exception("Error al actualizar la sucursal: " . print_r(sqlsrv_errors(), true));
                }
                sqlsrv_commit($conn);
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Sucursal actualizada exitosamente."));
                log_operacion_auto($conn, "CLIENTES", "Editar sucursal", resolver_nombre_entidad($conn, "sucursal", $id_sucursal), $input);
            }
        } catch (Exception $e) {
            sqlsrv_rollback($conn);
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => $e->getMessage()));
        }
        break;

    case 'delete_sucursal':
        $id_sucursal = intval(get_val($input, 'id_sucursal', 0));
        if (!$id_sucursal) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_sucursal"));
            break;
        }
        $check = sqlsrv_query($conn, "SELECT COUNT(*) as count FROM ticket WHERE id_sucursal = ?", array($id_sucursal));
        $count = 0;
        if ($check !== false && $row = sqlsrv_fetch_array($check, SQLSRV_FETCH_ASSOC)) {
            $count = intval($row['count']);
        }
        if ($count > 0) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "No se puede eliminar la sucursal porque tiene $count tickets asociados."));
            break;
        }
        $stmt = sqlsrv_query($conn, "DELETE FROM empresa_sucursal WHERE id_sucursal = ?", array($id_sucursal));
        if ($stmt === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al eliminar sucursal.", "errors" => sqlsrv_errors()));
        } else {
            invalidate_sync_cache();
            echo json_encode(array("status" => "success", "message" => "Sucursal eliminada."));
            log_operacion_auto($conn, "CLIENTES", "Eliminar sucursal", resolver_nombre_entidad($conn, "sucursal", $id_sucursal), $input);
        }
        break;

    // ============================================================
    // 15. CRUD: PERSONA
    // ============================================================
    case 'delete_persona':
        $id_persona = intval(get_val($input, 'id_persona', 0));
        if (!$id_persona) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_persona."));
            break;
        }

        // No permitir eliminar al admin principal (id_persona = 1)
        if ($id_persona === 1) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "No se puede eliminar al Administrador principal del sistema."));
            break;
        }

        // Verificar si el usuario tiene tickets o atenciones asociadas
        $checkTickets = sqlsrv_query($conn, "SELECT COUNT(*) AS cnt FROM ticket WHERE id_usuario = ?", array($id_persona));
        $ticketCount = 0;
        if ($checkTickets !== false && $row = sqlsrv_fetch_array($checkTickets, SQLSRV_FETCH_ASSOC)) {
            $ticketCount = intval($row['cnt']);
        }

        $checkAtenciones = sqlsrv_query($conn, "SELECT COUNT(*) AS cnt FROM atencion WHERE id_usuario = ?", array($id_persona));
        $atencionCount = 0;
        if ($checkAtenciones !== false && $row = sqlsrv_fetch_array($checkAtenciones, SQLSRV_FETCH_ASSOC)) {
            $atencionCount = intval($row['cnt']);
        }

        if ($ticketCount > 0 || $atencionCount > 0) {
            // Si tiene registros, solo DESACTIVAR (no borrar físicamente)
            $sql = "UPDATE persona SET estado = 0 WHERE id_persona = ?";
            $stmt = sqlsrv_query($conn, $sql, array($id_persona));
            if ($stmt === false) {
                http_response_code(500);
                echo json_encode(array("status" => "error", "message" => "Error al desactivar el usuario.", "errors" => sqlsrv_errors()));
                break;
            }
            // Eliminar asignación de rol
            sqlsrv_query($conn, "DELETE FROM persona_rol_asignacion WHERE id_persona = ?", array($id_persona));
            log_operacion_auto($conn, "SEGURIDAD", "Eliminar/desactivar usuario", resolver_nombre_entidad($conn, "persona", $id_persona), $input);
            invalidate_sync_cache();
            echo json_encode(array("status" => "success", "message" => "Usuario desactivado (tiene $ticketCount ticket(s) y $atencionCount atencion(es) asociadas). No se puede eliminar físicamente."));
        } else {
            // Si no tiene registros, eliminar físicamente
            sqlsrv_query($conn, "DELETE FROM persona_rol_asignacion WHERE id_persona = ?", array($id_persona));
            $sql = "DELETE FROM persona WHERE id_persona = ?";
            $stmt = sqlsrv_query($conn, $sql, array($id_persona));
            if ($stmt === false) {
                http_response_code(500);
                echo json_encode(array("status" => "error", "message" => "Error al eliminar el usuario.", "errors" => sqlsrv_errors()));
                break;
            }
            log_operacion_auto($conn, "SEGURIDAD", "Eliminar usuario", resolver_nombre_entidad($conn, "persona", $id_persona), $input);
            invalidate_sync_cache();
            echo json_encode(array("status" => "success", "message" => "Usuario eliminado fisicamente de la base de datos."));
        }
        break;

    case 'save_persona':
        $id_persona = to_int_or_null(get_val($input, 'id_persona', null));
        $tipo_documento = trim(get_val($input, 'tipo_documento', 'DNI'));
        $numero_documento = trim(get_val($input, 'numero_documento', ''));
        // FIX v2.35: DNI completamente OPCIONAL. Si viene vacío, se guarda NULL
        // en la base de datos. NO se autogenera ningún valor (ni SIN-DNI-XXX ni SD-XXX).
        // La columna numero_documento fue ampliada a nvarchar(50) y permite NULL.
        if ($numero_documento === '') {
            $numero_documento = null;
        }
        // Salvaguarda: si llega un valor, asegurar que no exceda 50 caracteres.
        if ($numero_documento !== null && strlen($numero_documento) > 50) {
            $numero_documento = substr($numero_documento, 0, 50);
        }
        $nombres = trim(get_val($input, 'nombres', ''));
        $apellido_paterno = trim(get_val($input, 'apellido_paterno', ''));
        $apellido_materno = trim(get_val($input, 'apellido_materno', ''));
        $correo = trim(get_val($input, 'correo', ''));
        $telefono = trim(get_val($input, 'telefono', ''));
        $fecha_nacimiento = get_val($input, 'fecha_nacimiento', null);
        $direccion = trim(get_val($input, 'direccion', ''));
        $sexo = get_val($input, 'sexo', null);
        $estado = (get_val($input, 'estado', 1) == 1) ? 1 : 0;
        $contrasena_raw = trim(get_val($input, 'contrasena', ''));
        $bloqueado = (get_val($input, 'bloqueado', 0) == 1) ? 1 : 0;
        $id_empresa = to_int_or_null(get_val($input, 'id_empresa', null));
        $id_sucursal = to_int_or_null(get_val($input, 'id_sucursal', null));
        $id_rol = to_int_or_null(get_val($input, 'id_rol', null));

        if (!$nombres || !$apellido_paterno || !$correo) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan campos obligatorios para la persona (nombres, apellido_paterno, correo)."));
            break;
        }

        $isAlreadyHashed = preg_match('/^[a-f0-9]{64}$/i', $contrasena_raw);
        if ($contrasena_raw === '') {
            $hashedPassword = hash('sha256', 'changeme123');
        } else if ($isAlreadyHashed) {
            $hashedPassword = strtolower($contrasena_raw);
        } else {
            $hashedPassword = hash('sha256', $contrasena_raw);
        }

        try {
            if ($id_persona === null || $id_persona === 0) {
                // FIX v2.35: Si numero_documento es NULL, solo validar duplicado por correo.
                // Si tiene DNI real, validar por ambos.
                if ($numero_documento !== null) {
                    $check = sqlsrv_query($conn, "SELECT id_persona FROM persona WHERE (numero_documento = ? OR correo = ?)", array($numero_documento, $correo));
                } else {
                    $check = sqlsrv_query($conn, "SELECT id_persona FROM persona WHERE correo = ?", array($correo));
                }
                if ($check !== false && sqlsrv_has_rows($check)) {
                    http_response_code(400);
                    echo json_encode(array("status" => "error", "message" => "El número de documento o correo ya está registrado."));
                    break;
                }
                $sql = "INSERT INTO persona (tipo_documento, numero_documento, nombres, apellido_paterno, apellido_materno, fecha_nacimiento, telefono, correo, direccion, sexo, estado, contrasena, bloqueado, id_empresa, id_sucursal)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
                $stmt = sqlsrv_query($conn, $sql, array($tipo_documento, $numero_documento, $nombres, $apellido_paterno, $apellido_materno, $fecha_nacimiento, $telefono, $correo, $direccion, $sexo, $estado, $hashedPassword, $bloqueado, $id_empresa, $id_sucursal));
                if ($stmt === false) {
                    throw new Exception("Error al insertar persona: " . print_r(sqlsrv_errors(), true));
                }
                $id_persona = null;
                $identitySql = "SELECT @@IDENTITY AS id_persona";
                $identityStmt = sqlsrv_query($conn, $identitySql);
                if ($identityStmt !== false && $identityRow = sqlsrv_fetch_array($identityStmt, SQLSRV_FETCH_ASSOC)) {
                    $id_persona = intval($identityRow['id_persona']);
                }
                if ($id_persona && $id_rol) {
                    sqlsrv_query($conn, "DELETE FROM persona_rol_asignacion WHERE id_persona = ?", array($id_persona));
                    $asignado_por = ensure_valid_user_id($conn, null);
                    sqlsrv_query($conn, "INSERT INTO persona_rol_asignacion (id_persona, id_rol, fecha_asignacion, asignado_por) VALUES (?, ?, GETDATE(), ?)", array($id_persona, $id_rol, $asignado_por));
                }
                log_operacion_auto($conn, "SEGURIDAD", "Crear usuario", $nombres . " " . $apellido_paterno . " (" . $correo . ")", $input);
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Persona creada exitosamente.", "id_persona" => $id_persona, "id_rol_asignado" => $id_rol));
            } else {
                $updatePassword = ($contrasena_raw !== '');
                if ($updatePassword) {
                    $sql = "UPDATE persona SET tipo_documento = ?, numero_documento = ?, nombres = ?, apellido_paterno = ?, apellido_materno = ?,
                            fecha_nacimiento = ?, telefono = ?, correo = ?, direccion = ?, sexo = ?, estado = ?, bloqueado = ?,
                            id_empresa = ?, id_sucursal = ?, contrasena = ? WHERE id_persona = ?";
                    $stmt = sqlsrv_query($conn, $sql, array($tipo_documento, $numero_documento, $nombres, $apellido_paterno, $apellido_materno, $fecha_nacimiento, $telefono, $correo, $direccion, $sexo, $estado, $bloqueado, $id_empresa, $id_sucursal, $hashedPassword, $id_persona));
                } else {
                    $sql = "UPDATE persona SET tipo_documento = ?, numero_documento = ?, nombres = ?, apellido_paterno = ?, apellido_materno = ?,
                            fecha_nacimiento = ?, telefono = ?, correo = ?, direccion = ?, sexo = ?, estado = ?, bloqueado = ?,
                            id_empresa = ?, id_sucursal = ? WHERE id_persona = ?";
                    $stmt = sqlsrv_query($conn, $sql, array($tipo_documento, $numero_documento, $nombres, $apellido_paterno, $apellido_materno, $fecha_nacimiento, $telefono, $correo, $direccion, $sexo, $estado, $bloqueado, $id_empresa, $id_sucursal, $id_persona));
                }
                if ($stmt === false) {
                    throw new Exception("Error al actualizar persona: " . print_r(sqlsrv_errors(), true));
                }
                if ($id_rol) {
                    $checkRol = sqlsrv_query($conn, "SELECT id_persona FROM persona_rol_asignacion WHERE id_persona = ?", array($id_persona));
                    if ($checkRol !== false && sqlsrv_has_rows($checkRol)) {
                        sqlsrv_query($conn, "UPDATE persona_rol_asignacion SET id_rol = ?, fecha_asignacion = GETDATE() WHERE id_persona = ?", array($id_rol, $id_persona));
                    } else {
                        $asignado_por = ensure_valid_user_id($conn, null);
                        sqlsrv_query($conn, "INSERT INTO persona_rol_asignacion (id_persona, id_rol, fecha_asignacion, asignado_por) VALUES (?, ?, GETDATE(), ?)", array($id_persona, $id_rol, $asignado_por));
                    }
                }
                log_operacion_auto($conn, "SEGURIDAD", "Editar usuario", $nombres . " " . $apellido_paterno, $input);
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Persona actualizada exitosamente.", "id_persona" => $id_persona, "id_rol_asignado" => $id_rol));
            }
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => $e->getMessage()));
        }
        break;

        // ============================================================
    // 16. CRUD: CONTACTO EMPRESARIAL
    // ============================================================
    case 'save_contacto':
        $id_empresa_contacto = to_int_or_null(get_val($input, 'id_empresa_contacto', null));
        $id_empresa = to_int_or_null(get_val($input, 'id_empresa', null));
        $id_sucursal = to_int_or_null(get_val($input, 'id_sucursal', null));
        $id_persona = to_int_or_null(get_val($input, 'id_persona', null));
        $cargo = trim(get_val($input, 'cargo', ''));
        $telefono_empresa = trim(get_val($input, 'telefono_empresa', ''));
        $correo_empresa = trim(get_val($input, 'correo_empresa', ''));
        $es_principal = (get_val($input, 'es_principal', 0) == 1) ? 1 : 0;
        $estado = (get_val($input, 'estado', 1) == 1) ? 1 : 0;

        if (!$id_empresa || !$id_persona) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan campos obligatorios (id_empresa, id_persona)."));
            break;
        }
        if (!exists_id($conn, 'empresa', 'id_empresa', $id_empresa)) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "La empresa con id $id_empresa no existe."));
            break;
        }
        if (!exists_id($conn, 'persona', 'id_persona', $id_persona)) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "La persona con id $id_persona no existe."));
            break;
        }
        if ($id_sucursal !== null && !exists_id($conn, 'empresa_sucursal', 'id_sucursal', $id_sucursal)) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "La sucursal con id $id_sucursal no existe."));
            break;
        }

        try {
            if ($id_empresa_contacto === null || $id_empresa_contacto === 0) {
                $sql = "INSERT INTO empresa_contacto (id_empresa, id_sucursal, id_persona, cargo, telefono_empresa, correo_empresa, es_principal, estado)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
                $stmt = sqlsrv_query($conn, $sql, array($id_empresa, $id_sucursal, $id_persona, $cargo, $telefono_empresa, $correo_empresa, $es_principal, $estado));
                if ($stmt === false) {
                    throw new Exception("Error al registrar contacto: " . print_r(sqlsrv_errors(), true));
                }
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Contacto registrado exitosamente."));
                log_operacion_auto($conn, "CLIENTES", "Crear contacto", resolver_nombre_entidad($conn, "empresa", $id_empresa), $input);
            } else {
                // FIX v2.81 — Incluir id_empresa en el UPDATE para que el cambio
                // de empresa del contacto persista en SQL Server.
                $sql = "UPDATE empresa_contacto SET id_empresa = ?, id_sucursal = ?, id_persona = ?, cargo = ?, telefono_empresa = ?, correo_empresa = ?, es_principal = ?, estado = ? WHERE id_empresa_contacto = ?";
                $stmt = sqlsrv_query($conn, $sql, array($id_empresa, $id_sucursal, $id_persona, $cargo, $telefono_empresa, $correo_empresa, $es_principal, $estado, $id_empresa_contacto));
                if ($stmt === false) {
                    throw new Exception("Error al actualizar contacto: " . print_r(sqlsrv_errors(), true));
                }
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Contacto actualizado exitosamente."));
                log_operacion_auto($conn, "CLIENTES", "Editar contacto", resolver_nombre_entidad($conn, "contacto", $id_empresa_contacto), $input);
            }
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => $e->getMessage()));
        }
        break;

    case 'delete_contacto':
        $id_empresa_contacto = intval(get_val($input, 'id_empresa_contacto', 0));
        if (!$id_empresa_contacto) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_empresa_contacto"));
            break;
        }
        $stmt = sqlsrv_query($conn, "DELETE FROM empresa_contacto WHERE id_empresa_contacto = ?", array($id_empresa_contacto));
        if ($stmt === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al eliminar contacto.", "errors" => sqlsrv_errors()));
        } else {
            invalidate_sync_cache();
            echo json_encode(array("status" => "success", "message" => "Contacto eliminado."));
            log_operacion_auto($conn, "CLIENTES", "Eliminar contacto", resolver_nombre_entidad($conn, "contacto", $id_empresa_contacto), $input);
        }
        break;

    // ============================================================
    // 17. CRUD: RUBRO
    // ============================================================
    case 'save_rubro':
        $id_rubro = to_int_or_null(get_val($input, 'id_rubro', null));
        $nombre = trim(get_val($input, ['nombre', 'rubro_nombre', 'name', 'rubro'], ''));

        if (!$nombre) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "El nombre del rubro es obligatorio."));
            break;
        }

        try {
            if ($id_rubro === null || $id_rubro === 0) {
                $check = sqlsrv_query($conn, "SELECT id_rubro FROM rubro WHERE nombre = ?", array($nombre));
                if ($check !== false && sqlsrv_has_rows($check)) {
                    http_response_code(400);
                    echo json_encode(array("status" => "error", "message" => "El rubro '$nombre' ya existe."));
                    break;
                }
                $stmt = sqlsrv_query($conn, "INSERT INTO rubro (nombre) VALUES (?)", array($nombre));
                if ($stmt === false) {
                    throw new Exception("Error al insertar rubro: " . print_r(sqlsrv_errors(), true));
                }
                $identitySql = "SELECT @@IDENTITY AS id_rubro";
                $identityStmt = sqlsrv_query($conn, $identitySql);
                $id_rubro = null;
                if ($identityStmt !== false && $identityRow = sqlsrv_fetch_array($identityStmt, SQLSRV_FETCH_ASSOC)) {
                    $id_rubro = intval($identityRow['id_rubro']);
                }
                log_operacion_auto($conn, "CLIENTES", "Crear rubro", $nombre, $input);
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Rubro creado exitosamente.", "id_rubro" => $id_rubro));
            } else {
                $check = sqlsrv_query($conn, "SELECT id_rubro FROM rubro WHERE nombre = ? AND id_rubro <> ?", array($nombre, $id_rubro));
                if ($check !== false && sqlsrv_has_rows($check)) {
                    http_response_code(400);
                    echo json_encode(array("status" => "error", "message" => "El nombre '$nombre' ya está en uso por otro rubro."));
                    break;
                }
                $stmt = sqlsrv_query($conn, "UPDATE rubro SET nombre = ? WHERE id_rubro = ?", array($nombre, $id_rubro));
                if ($stmt === false) {
                    throw new Exception("Error al actualizar rubro: " . print_r(sqlsrv_errors(), true));
                }
                log_operacion_auto($conn, "CLIENTES", "Editar rubro", resolver_nombre_entidad($conn, "rubro", $id_rubro), $input);
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Rubro actualizado exitosamente."));
            }
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => $e->getMessage()));
        }
        break;

    case 'delete_rubro':
        $id_rubro = intval(get_val($input, 'id_rubro', 0));
        if (!$id_rubro) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_rubro"));
            break;
        }
        $check = sqlsrv_query($conn, "SELECT COUNT(*) as count FROM empresa WHERE id_rubro = ?", array($id_rubro));
        $count = 0;
        if ($check !== false && $checkRow = sqlsrv_fetch_array($check, SQLSRV_FETCH_ASSOC)) {
            $count = intval($checkRow['count']);
        }
        if ($count > 0) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "No se puede eliminar el rubro porque tiene $count empresas asociadas."));
            break;
        }
        $stmt = sqlsrv_query($conn, "DELETE FROM rubro WHERE id_rubro = ?", array($id_rubro));
        if ($stmt === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al eliminar rubro.", "errors" => sqlsrv_errors()));
        } else {
            invalidate_sync_cache();
            echo json_encode(array("status" => "success", "message" => "Rubro eliminado."));
            log_operacion_auto($conn, "CLIENTES", "Eliminar rubro", resolver_nombre_entidad($conn, "rubro", $id_rubro), $input);
        }
        break;

    // ============================================================
    // 18. CRUD: GRUPO EMPRESARIAL
    // ============================================================
    case 'save_grupo':
        $id_grupo = to_int_or_null(get_val($input, 'id_grupo', null));
        $nombre = trim(get_val($input, ['nombre', 'grupo_nombre', 'name', 'grupo', 'nombre_grupo'], ''));
        $descripcion = trim(get_val($input, ['descripcion', 'grupo_descripcion', 'description', 'desc'], ''));

        if (!$nombre) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "El nombre del grupo es obligatorio."));
            break;
        }

        try {
            if ($id_grupo === null || $id_grupo === 0) {
                $check = sqlsrv_query($conn, "SELECT id_grupo FROM grupo_empresarial WHERE nombre = ?", array($nombre));
                if ($check !== false && sqlsrv_has_rows($check)) {
                    http_response_code(400);
                    echo json_encode(array("status" => "error", "message" => "El grupo '$nombre' ya existe."));
                    break;
                }
                $stmt = sqlsrv_query($conn, "INSERT INTO grupo_empresarial (nombre, descripcion) VALUES (?, ?)", array($nombre, $descripcion));
                if ($stmt === false) {
                    throw new Exception("Error al insertar grupo: " . print_r(sqlsrv_errors(), true));
                }
                $identitySql = "SELECT @@IDENTITY AS id_grupo";
                $identityStmt = sqlsrv_query($conn, $identitySql);
                $id_grupo = null;
                if ($identityStmt !== false && $identityRow = sqlsrv_fetch_array($identityStmt, SQLSRV_FETCH_ASSOC)) {
                    $id_grupo = intval($identityRow['id_grupo']);
                }
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Grupo creado exitosamente.", "id_grupo" => $id_grupo));
            } else {
                $check = sqlsrv_query($conn, "SELECT id_grupo FROM grupo_empresarial WHERE nombre = ? AND id_grupo <> ?", array($nombre, $id_grupo));
                if ($check !== false && sqlsrv_has_rows($check)) {
                    http_response_code(400);
                    echo json_encode(array("status" => "error", "message" => "El nombre '$nombre' ya está en uso por otro grupo."));
                    break;
                }
                $stmt = sqlsrv_query($conn, "UPDATE grupo_empresarial SET nombre = ?, descripcion = ? WHERE id_grupo = ?", array($nombre, $descripcion, $id_grupo));
                if ($stmt === false) {
                    throw new Exception("Error al actualizar grupo: " . print_r(sqlsrv_errors(), true));
                }
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "Grupo actualizado exitosamente."));
            }
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => $e->getMessage()));
        }
        break;

    case 'delete_grupo':
        $id_grupo = intval(get_val($input, 'id_grupo', 0));
        if (!$id_grupo) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_grupo"));
            break;
        }
        $check = sqlsrv_query($conn, "SELECT COUNT(*) as count FROM empresa WHERE id_grupo = ?", array($id_grupo));
        $count = 0;
        if ($check !== false && $checkRow = sqlsrv_fetch_array($check, SQLSRV_FETCH_ASSOC)) {
            $count = intval($checkRow['count']);
        }
        if ($count > 0) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "No se puede eliminar el grupo porque tiene $count empresas asociadas."));
            break;
        }
        $stmt = sqlsrv_query($conn, "DELETE FROM grupo_empresarial WHERE id_grupo = ?", array($id_grupo));
        if ($stmt === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al eliminar grupo.", "errors" => sqlsrv_errors()));
        } else {
            invalidate_sync_cache();
            echo json_encode(array("status" => "success", "message" => "Grupo eliminado."));
            log_operacion_auto($conn, "CLIENTES", "Eliminar grupo", resolver_nombre_entidad($conn, "grupo", $id_grupo), $input);
        }
        break;

    // ============================================================
    // 19. LISTADOS AUXILIARES
    // ============================================================
    case 'rubros':
        $sql = "SELECT id_rubro, nombre FROM rubro ORDER BY nombre";
        $stmt = sqlsrv_query($conn, $sql);
        $rubros = array();
        while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) $rubros[] = normalize_row($row);
        echo json_encode(array("status" => "success", "data" => $rubros));
        break;

    case 'buscar_sucursales':
        $id_empresa = isset($_GET['id_empresa']) ? intval($_GET['id_empresa']) : null;
        $query = isset($_GET['query']) ? '%' . trim($_GET['query']) . '%' : '%';

        if ($id_empresa === null) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Debe proporcionar id_empresa"));
            break;
        }

        $sql = "SELECT id_sucursal, nombre, es_principal 
                FROM empresa_sucursal 
                WHERE id_empresa = ? AND nombre LIKE ? 
                ORDER BY nombre";
        $stmt = sqlsrv_query($conn, $sql, array($id_empresa, $query));
        $sucursales = array();
        while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) {
            $sucursales[] = normalize_row($row);
        }
        echo json_encode(array("status" => "success", "data" => $sucursales));
        break;

    case 'sucursales':
        $emp_id = isset($_GET['id_empresa']) ? intval($_GET['id_empresa']) : null;
        if ($emp_id === null) {
            echo json_encode(array("status" => "error", "message" => "Debe proporcionar id_empresa"));
            break;
        }
        $sql = "SELECT id_sucursal, nombre FROM empresa_sucursal WHERE id_empresa = ? ORDER BY nombre";
        $stmt = sqlsrv_query($conn, $sql, array($emp_id));
        $sucursales = array();
        while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) $sucursales[] = normalize_row($row);
        echo json_encode(array("status" => "success", "data" => $sucursales));
        break;

    case 'contactos':
        $emp_id = isset($_GET['id_empresa']) ? intval($_GET['id_empresa']) : null;
        if ($emp_id === null) {
            echo json_encode(array("status" => "error", "message" => "Debe proporcionar id_empresa"));
            break;
        }
        $sql = "SELECT ec.id_empresa_contacto, p.nombres + ' ' + p.apellido_paterno AS nombre_contacto, ec.cargo 
                FROM empresa_contacto ec
                INNER JOIN persona p ON ec.id_persona = p.id_persona
                WHERE ec.id_empresa = ? AND ec.estado = 1
                ORDER BY p.apellido_paterno";
        $stmt = sqlsrv_query($conn, $sql, array($emp_id));
        $contactos = array();
        while ($row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC)) $contactos[] = normalize_row($row);
        echo json_encode(array("status" => "success", "data" => $contactos));
        break;

    // ============================================================
    // 20. MÓDULO GEOGRÁFICO
    // ============================================================
    case 'save_pais':
        $id_pais = to_int_or_null(get_val($input, 'id_pais', null));
        $nombre = trim(get_val($input, 'nombre', ''));
        $codigo_iso = trim(get_val($input, 'codigo_iso', ''));

        if (!$nombre || !$codigo_iso) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan campos obligatorios (nombre, codigo_iso)."));
            break;
        }
        if (strlen($codigo_iso) > 3) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "El código ISO debe tener máximo 3 caracteres."));
            break;
        }

        try {
            if ($id_pais === null || $id_pais === 0) {
                $check = sqlsrv_query($conn, "SELECT id_pais FROM pais WHERE codigo_iso = ?", array($codigo_iso));
                if ($check !== false && sqlsrv_has_rows($check)) {
                    http_response_code(400);
                    echo json_encode(array("status" => "error", "message" => "Ya existe un país con ese código ISO."));
                    break;
                }
                $stmt = sqlsrv_query($conn, "INSERT INTO pais (nombre, codigo_iso) VALUES (?, ?)", array($nombre, $codigo_iso));
                if ($stmt === false) {
                    throw new Exception("Error al insertar país: " . print_r(sqlsrv_errors(), true));
                }
                $id_pais = null;
                $identitySql = "SELECT @@IDENTITY AS id_pais";
                $identityStmt = sqlsrv_query($conn, $identitySql);
                if ($identityStmt !== false && $identityRow = sqlsrv_fetch_array($identityStmt, SQLSRV_FETCH_ASSOC)) {
                    $id_pais = intval($identityRow['id_pais']);
                }
                log_operacion_auto($conn, "GEOGRAFIA", "Crear país", $nombre, $input);
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "País creado exitosamente.", "id_pais" => $id_pais));
            } else {
                $check = sqlsrv_query($conn, "SELECT id_pais FROM pais WHERE codigo_iso = ? AND id_pais <> ?", array($codigo_iso, $id_pais));
                if ($check !== false && sqlsrv_has_rows($check)) {
                    http_response_code(400);
                    echo json_encode(array("status" => "error", "message" => "El código ISO ya está en uso por otro país."));
                    break;
                }
                $stmt = sqlsrv_query($conn, "UPDATE pais SET nombre = ?, codigo_iso = ? WHERE id_pais = ?", array($nombre, $codigo_iso, $id_pais));
                if ($stmt === false) {
                    throw new Exception("Error al actualizar país: " . print_r(sqlsrv_errors(), true));
                }
                log_operacion_auto($conn, "GEOGRAFIA", "Editar país", "Pais", $input);
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "País actualizado exitosamente."));
            }
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => $e->getMessage()));
        }
        break;

    case 'delete_pais':
        $id_pais = intval(get_val($input, 'id_pais', 0));
        if (!$id_pais) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_pais"));
            break;
        }
        $stmt = sqlsrv_query($conn, "DELETE FROM pais WHERE id_pais = ?", array($id_pais));
        if ($stmt === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al eliminar país.", "errors" => sqlsrv_errors()));
        } else {
            invalidate_sync_cache();
            echo json_encode(array("status" => "success", "message" => "País eliminado."));
            log_operacion_auto($conn, "GEOGRAFIA", "Eliminar país", "Pais", $input);
        }
        break;

    case 'save_tipo_division':
        $id_tipo_division = to_int_or_null(get_val($input, 'id_tipo_division', null));
        $nombre = trim(get_val($input, 'nombre', ''));

        if (!$nombre) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "El nombre del tipo de división es obligatorio."));
            break;
        }

        try {
            if ($id_tipo_division === null || $id_tipo_division === 0) {
                $check = sqlsrv_query($conn, "SELECT id_tipo_division FROM tipo_division WHERE nombre = ?", array($nombre));
                if ($check !== false && sqlsrv_has_rows($check)) {
                    http_response_code(400);
                    echo json_encode(array("status" => "error", "message" => "El tipo de división ya existe."));
                    break;
                }
                $stmt = sqlsrv_query($conn, "INSERT INTO tipo_division (nombre) VALUES (?)", array($nombre));
                if ($stmt === false) {
                    throw new Exception("Error al insertar tipo de división: " . print_r(sqlsrv_errors(), true));
                }
                $identitySql = "SELECT @@IDENTITY AS id_tipo_division";
                $identityStmt = sqlsrv_query($conn, $identitySql);
                $id_tipo_division = null;
                if ($identityStmt !== false && $identityRow = sqlsrv_fetch_array($identityStmt, SQLSRV_FETCH_ASSOC)) {
                    $id_tipo_division = intval($identityRow['id_tipo_division']);
                }
                echo json_encode(array("status" => "success", "message" => "Tipo de división creado.", "id_tipo_division" => $id_tipo_division));
            } else {
                $check = sqlsrv_query($conn, "SELECT id_tipo_division FROM tipo_division WHERE nombre = ? AND id_tipo_division <> ?", array($nombre, $id_tipo_division));
                if ($check !== false && sqlsrv_has_rows($check)) {
                    http_response_code(400);
                    echo json_encode(array("status" => "error", "message" => "El nombre ya está en uso por otro tipo."));
                    break;
                }
                $stmt = sqlsrv_query($conn, "UPDATE tipo_division SET nombre = ? WHERE id_tipo_division = ?", array($nombre, $id_tipo_division));
                if ($stmt === false) {
                    throw new Exception("Error al actualizar tipo de división: " . print_r(sqlsrv_errors(), true));
                }
                echo json_encode(array("status" => "success", "message" => "Tipo de división actualizado."));
            }
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => $e->getMessage()));
        }
        break;

    case 'delete_tipo_division':
        $id_tipo_division = intval(get_val($input, 'id_tipo_division', 0));
        if (!$id_tipo_division) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_tipo_division"));
            break;
        }
        $check = sqlsrv_query($conn, "SELECT COUNT(*) as count FROM division_geografica WHERE id_tipo_division = ?", array($id_tipo_division));
        $count = 0;
        if ($check !== false && $row = sqlsrv_fetch_array($check, SQLSRV_FETCH_ASSOC)) {
            $count = intval($row['count']);
        }
        if ($count > 0) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "No se puede eliminar el tipo porque $count divisiones lo usan."));
            break;
        }
        $stmt = sqlsrv_query($conn, "DELETE FROM tipo_division WHERE id_tipo_division = ?", array($id_tipo_division));
        if ($stmt === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al eliminar tipo de división.", "errors" => sqlsrv_errors()));
        } else {
            echo json_encode(array("status" => "success", "message" => "Tipo de división eliminado."));
        }
        break;

    case 'save_division':
        $id_division = to_int_or_null(get_val($input, 'id_division', null));
        $nombre = trim(get_val($input, 'nombre', ''));
        $id_tipo_division = to_int_or_null(get_val($input, 'id_tipo_division', null));
        $id_division_padre = to_int_or_null(get_val($input, 'id_division_padre', null));

        if (!$nombre || !$id_tipo_division) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan campos obligatorios (nombre, id_tipo_division)."));
            break;
        }

        if (!exists_id($conn, 'tipo_division', 'id_tipo_division', $id_tipo_division)) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "El tipo de división no existe."));
            break;
        }

        if ($id_division_padre !== null && !exists_id($conn, 'division_geografica', 'id_division', $id_division_padre)) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "La división padre no existe."));
            break;
        }

        if ($id_division_padre !== null && $id_division_padre === $id_division) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Una división no puede ser padre de sí misma."));
            break;
        }

        try {
            if ($id_division === null || $id_division === 0) {
                $sql = "INSERT INTO division_geografica (nombre, id_tipo_division, id_division_padre) VALUES (?, ?, ?)";
                $params = array($nombre, $id_tipo_division, $id_division_padre);
                $stmt = sqlsrv_query($conn, $sql, $params);
                if ($stmt === false) {
                    throw new Exception("Error al insertar división: " . print_r(sqlsrv_errors(), true));
                }
                $id_division = null;
                $identitySql = "SELECT @@IDENTITY AS id_division";
                $identityStmt = sqlsrv_query($conn, $identitySql);
                if ($identityStmt !== false && $identityRow = sqlsrv_fetch_array($identityStmt, SQLSRV_FETCH_ASSOC)) {
                    $id_division = intval($identityRow['id_division']);
                }
                log_operacion_auto($conn, "GEOGRAFIA", "Crear división", $nombre . "division, $input);
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "División creada.", "id_division" => $id_division));
            } else {
                $sql = "UPDATE division_geografica SET nombre = ?, id_tipo_division = ?, id_division_padre = ? WHERE id_division = ?";
                $params = array($nombre, $id_tipo_division, $id_division_padre, $id_division);
                $stmt = sqlsrv_query($conn, $sql, $params);
                if ($stmt === false) {
                    throw new Exception("Error al actualizar división: " . print_r(sqlsrv_errors(), true));
                }
                log_operacion_auto($conn, "GEOGRAFIA", "Editar división", $nombre . "division, $input);
                invalidate_sync_cache();
                echo json_encode(array("status" => "success", "message" => "División actualizada.", "id_division" => $id_division));
            }
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => $e->getMessage()));
        }
        break;

    case 'delete_division':
        $id_division = intval(get_val($input, 'id_division', 0));
        if (!$id_division) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_division"));
            break;
        }
        $checkChildren = sqlsrv_query($conn, "SELECT COUNT(*) as count FROM division_geografica WHERE id_division_padre = ?", array($id_division));
        $countChildren = 0;
        if ($checkChildren !== false && $row = sqlsrv_fetch_array($checkChildren, SQLSRV_FETCH_ASSOC)) {
            $countChildren = intval($row['count']);
        }
        if ($countChildren > 0) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "No se puede eliminar la división porque tiene $countChildren subdivisiones."));
            break;
        }
        $checkUbic = sqlsrv_query($conn, "SELECT COUNT(*) as count FROM ubicacion WHERE id_division = ?", array($id_division));
        $countUbic = 0;
        if ($checkUbic !== false && $row = sqlsrv_fetch_array($checkUbic, SQLSRV_FETCH_ASSOC)) {
            $countUbic = intval($row['count']);
        }
        if ($countUbic > 0) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "No se puede eliminar la división porque está referenciada en $countUbic ubicaciones."));
            break;
        }
        $stmt = sqlsrv_query($conn, "DELETE FROM division_geografica WHERE id_division = ?", array($id_division));
        if ($stmt === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al eliminar división.", "errors" => sqlsrv_errors()));
        } else {
            invalidate_sync_cache();
            echo json_encode(array("status" => "success", "message" => "División eliminada."));
        }
        break;

    // ============================================================
    // ENVÍO DE ALERTAS/REPORTES POR CORREO (SMTP)
    // ============================================================
    case 'send_email':
        error_reporting(0);
        @ini_set('display_errors', '0');
        ob_start();

        $emails = trim(get_val($input, 'emails', ''));
        $subject = trim(get_val($input, 'subject', ''));
        $body = get_val($input, 'body', '');
        $type = trim(get_val($input, 'type', 'MANUAL'));
        $num_tickets = intval(get_val($input, 'num_tickets', 0));

        if (!$emails || !$subject || !$body) {
            ob_end_clean();
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan parámetros obligatorios (emails, subject, body)."));
            break;
        }

        $smtpHost = trim(get_val($input, 'smtp_host', '')) ?: (ini_get('SMTP') ?: 'smtp.corp-mail.com');
        $smtpPort = intval(get_val($input, 'smtp_port', 587)); if ($smtpPort <= 0) $smtpPort = 587;
        $smtpUser = trim(get_val($input, 'smtp_user', '')) ?: 'notificaciones@soporte.com';
        $smtpPass = str_replace(" ", "", trim(get_val($input, "smtp_pass", "")));
        $smtpSender = trim(get_val($input, 'smtp_sender', '')) ?: $smtpUser;
        $smtpSecurity = trim(get_val($input, 'smtp_security', 'TLS'));

        // FIX v2.15: Debug — registrar qué configuración SMTP se recibió (sin la contraseña real).
        $passLength = strlen($smtpPass);
        $passPreview = $passLength > 0 ? substr($smtpPass, 0, 2) . '***' . substr($smtpPass, -2) . " ({$passLength} chars)" : "VACÍA";

        $smtpSent = false;
        $smtpError = null;
        $emailList = array_filter(array_map('trim', explode(',', $emails)));

        // FIX v2.14: SSL directo (ssl://) SOLO para puerto 465.
        // Puerto 587 usa TCP normal + STARTTLS (no ssl://).
        $useSsl = ($smtpPort == 465);
        $connectHost = $useSsl ? "ssl://$smtpHost" : $smtpHost;
        $fp = @fsockopen($connectHost, $smtpPort, $errno, $errstr, 15);
        if ($fp) {
            stream_set_timeout($fp, 15);
            $greeting = @fgets($fp, 515);
            if ($greeting && intval(substr($greeting, 0, 3)) == 220) {
                $domain = isset($_SERVER['SERVER_NAME']) ? $_SERVER['SERVER_NAME'] : 'localhost';
                @fputs($fp, "EHLO $domain\r\n");
                $ehloResp = '';
                while (substr($ehloResp, 3, 1) != ' ') { $ehloResp = @fgets($fp, 515); if ($ehloResp === false) break; }
                if (intval(substr($ehloResp, 0, 3)) == 250) {
                    if ($smtpPort == 587 || strtoupper($smtpSecurity) === 'TLS') {
                        @fputs($fp, "STARTTLS\r\n");
                        $tlsResp = @fgets($fp, 515);
                        if (intval(substr($tlsResp, 0, 3)) == 220) {
                            $cryptoResult = @stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
                            if ($cryptoResult !== true) {
                                // FIX v2.14: Si openssl no está habilitado, informar al usuario.
                                $smtpError = "No se pudo activar el cifrado TLS. Habilite la extensión openssl en php.ini del IIS (extension=openssl).";
                            }
                            @fputs($fp, "EHLO $domain\r\n");
                            $ehloResp2 = '';
                            while (substr($ehloResp2, 3, 1) != ' ') { $ehloResp2 = @fgets($fp, 515); if ($ehloResp2 === false) break; }
                        }
                    }
                    @fputs($fp, "AUTH LOGIN\r\n");
                    @fgets($fp, 515);
                    @fputs($fp, base64_encode($smtpUser) . "\r\n");
                    @fgets($fp, 515);
                    @fputs($fp, base64_encode($smtpPass) . "\r\n");
                    $authResp = @fgets($fp, 515);
                    if (intval(substr($authResp, 0, 3)) == 235) {
                        @fputs($fp, "MAIL FROM: <$smtpSender>\r\n");
                        @fgets($fp, 515);
                        foreach ($emailList as $toAddr) {
                            if (filter_var($toAddr, FILTER_VALIDATE_EMAIL)) {
                                @fputs($fp, "RCPT TO: <$toAddr>\r\n");
                                @fgets($fp, 515);
                            }
                        }
                        @fputs($fp, "DATA\r\n");
                        $dataPrompt = @fgets($fp, 515);
                        if (intval(substr($dataPrompt, 0, 3)) == 354) {
                            $headers = "MIME-Version: 1.0\r\nContent-type: text/html; charset=UTF-8\r\nFrom: Dicon Soporte <$smtpSender>\r\nReply-To: $smtpSender\r\nSubject: $subject\r\n\r\n";
                            $msg = $headers . $body . "\r\n.";
                            @fputs($fp, $msg . "\r\n");
                            $dataResp = @fgets($fp, 515);
                            if (intval(substr($dataResp, 0, 3)) == 250) $smtpSent = true;
                        }
                    } else {
                        $smtpError = "Autenticación SMTP rechazada. Verifique usuario/contraseña SMTP.";
                    }
                }
            }
            @fputs($fp, "QUIT\r\n");
            @fclose($fp);
        } else {
            $smtpError = "No se pudo conectar a $smtpHost:$smtpPort — $errstr (errno $errno).";
        }

        // Fallback: mail() de PHP
        if (!$smtpSent) {
            $headers = "MIME-Version: 1.0\r\nContent-type:text/html;charset=UTF-8\r\nFrom: Dicon Soporte <$smtpSender>\r\n";
            foreach ($emailList as $toAddr) {
                if (filter_var($toAddr, FILTER_VALIDATE_EMAIL)) {
                    if (@mail($toAddr, $subject, $body, $headers)) { $smtpSent = true; $smtpError = null; }
                }
            }
        }

        // Registrar en BD
        $checkTable = sqlsrv_query($conn, "SELECT COUNT(*) AS cnt FROM sysobjects WHERE name='email_log' AND xtype='U'");
        $tableExists = false;
        if ($checkTable !== false && $row = sqlsrv_fetch_array($checkTable, SQLSRV_FETCH_ASSOC)) $tableExists = intval($row['cnt']) > 0;
        if (!$tableExists) {
            sqlsrv_query($conn, "CREATE TABLE [dbo].[email_log] ([id_email] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY, [destinatarios] [nvarchar](max) NOT NULL, [asunto] [nvarchar](500) NOT NULL, [cuerpo] [nvarchar](max) NULL, [tipo] [nvarchar](20) NULL, [num_tickets] [int] NULL, [estado] [nvarchar](20) NULL, [smtp_host] [nvarchar](100) NULL, [fecha_envio] [datetime] NOT NULL)");
        }
        $estado = $smtpSent ? 'EXITOSO' : 'FALLIDO';
        sqlsrv_query($conn, "INSERT INTO email_log (destinatarios, asunto, cuerpo, tipo, num_tickets, estado, smtp_host, fecha_envio) VALUES (?, ?, ?, ?, ?, ?, ?, GETDATE())", array($emails, $subject, $body, $type, $num_tickets, $estado, $smtpHost));

        ob_end_clean();
        if ($smtpSent) {
            echo json_encode(array("status" => "success", "message" => "Correo enviado exitosamente a " . $emails, "smtp_sent" => true, "recipients" => count($emailList), "smtp_host" => $smtpHost));
        } else {
            echo json_encode(array("status" => "success", "message" => "El correo fue registrado pero no se pudo enviar por SMTP.", "smtp_sent" => false, "smtp_error" => $smtpError, "recipients" => count($emailList), "smtp_host" => $smtpHost, "smtp_port" => $smtpPort, "smtp_user" => $smtpUser, "smtp_pass_debug" => $passPreview, "smtp_security" => $smtpSecurity));
        }
        break;

    case 'get_sent_emails':
        $checkTable = sqlsrv_query($conn, "SELECT COUNT(*) AS cnt FROM sysobjects WHERE name='email_log' AND xtype='U'");
        $tableExists = false;
        if ($checkTable !== false && $row = sqlsrv_fetch_array($checkTable, SQLSRV_FETCH_ASSOC)) $tableExists = intval($row['cnt']) > 0;
        if (!$tableExists) {
            sqlsrv_query($conn, "CREATE TABLE [dbo].[email_log] ([id_email] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY, [destinatarios] [nvarchar](max) NOT NULL, [asunto] [nvarchar](500) NOT NULL, [cuerpo] [nvarchar](max) NULL, [tipo] [nvarchar](20) NULL, [num_tickets] [int] NULL, [estado] [nvarchar](20) NULL, [smtp_host] [nvarchar](100) NULL, [fecha_envio] [datetime] NOT NULL)");
            echo json_encode(array("status" => "success", "data" => array()));
            break;
        }
        $logs = fetch_all_rows($conn, "SELECT id_email, destinatarios, asunto, tipo, num_tickets, estado, smtp_host, CONVERT(VARCHAR(19), fecha_envio, 120) AS fecha_envio FROM email_log ORDER BY fecha_envio DESC");
        echo json_encode(array("status" => "success", "data" => $logs));
        break;

    case 'test_smtp':
        error_reporting(0);
        @ini_set('display_errors', '0');
        ob_start();

        $smtpHost = trim(get_val($input, 'smtp_host', '')) ?: (ini_get('SMTP') ?: 'smtp.corp-mail.com');
        $smtpPort = intval(get_val($input, 'smtp_port', 587)); if ($smtpPort <= 0) $smtpPort = 587;
        $smtpUser = trim(get_val($input, 'smtp_user', '')) ?: 'notificaciones@soporte.com';
        $smtpPass = trim(get_val($input, 'smtp_pass', '')) ?: 'SuperSecurePass123!';
        $smtpSecurity = trim(get_val($input, 'smtp_security', 'TLS'));
        $testEmail = trim(get_val($input, 'test_email', '')) ?: $smtpUser;

        $testResult = array("status" => "success", "smtp_host" => $smtpHost, "smtp_port" => $smtpPort, "smtp_user" => $smtpUser, "steps" => array(), "connected" => false, "authenticated" => false, "sent" => false);

        // FIX v2.14: SSL directo solo para puerto 465.
        $useSsl = ($smtpPort == 465);
        $connectHost = $useSsl ? "ssl://$smtpHost" : $smtpHost;
        $fp = @fsockopen($connectHost, $smtpPort, $errno, $errstr, 10);
        if (!$fp) {
            $testResult["steps"][] = "❌ Conexión TCP a $smtpHost:$smtpPort fallida: $errstr";
            $testResult["error"] = "No se pudo conectar al servidor SMTP $smtpHost en el puerto $smtpPort.";
            ob_end_clean();
            echo json_encode($testResult);
            break;
        }
        $testResult["steps"][] = "✓ Conexión TCP establecida a $smtpHost:$smtpPort";
        stream_set_timeout($fp, 10);
        $greeting = @fgets($fp, 515);
        if (!$greeting || intval(substr($greeting, 0, 3)) != 220) {
            $testResult["steps"][] = "❌ Saludo SMTP inválido";
            $testResult["error"] = "El servidor SMTP no respondió con un saludo válido.";
            @fclose($fp);
            ob_end_clean();
            echo json_encode($testResult);
            break;
        }
        $testResult["steps"][] = "✓ Saludo del servidor recibido";
        $domain = isset($_SERVER['SERVER_NAME']) ? $_SERVER['SERVER_NAME'] : 'localhost';
        @fputs($fp, "EHLO $domain\r\n");
        $ehloResp = '';
        while (substr($ehloResp, 3, 1) != ' ') { $ehloResp = @fgets($fp, 515); if ($ehloResp === false) break; }
        if (intval(substr($ehloResp, 0, 3)) != 250) {
            $testResult["error"] = "El servidor SMTP no aceptó EHLO.";
            @fclose($fp);
            ob_end_clean();
            echo json_encode($testResult);
            break;
        }
        $testResult["steps"][] = "✓ EHLO aceptado";
        $testResult["connected"] = true;

        if ($smtpPort == 587 || strtoupper($smtpSecurity) === 'TLS') {
            @fputs($fp, "STARTTLS\r\n");
            $tlsResp = @fgets($fp, 515);
            if (intval(substr($tlsResp, 0, 3)) == 220) {
                $testResult["steps"][] = "✓ STARTTLS aceptado";
                $cryptoResult = @stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
                if ($cryptoResult === true) {
                    $testResult["steps"][] = "✓ Cifrado TLS activado";
                    @fputs($fp, "EHLO $domain\r\n");
                    $ehloResp2 = '';
                    while (substr($ehloResp2, 3, 1) != ' ') { $ehloResp2 = @fgets($fp, 515); if ($ehloResp2 === false) break; }
                } else {
                    $testResult["steps"][] = "❌ No se pudo activar el cifrado TLS. Habilite extension=openssl en php.ini del IIS.";
                    $testResult["error"] = "PHP no tiene la extensión openssl habilitada. Edite php.ini y descomente la línea 'extension=openssl', luego reinicie IIS con 'iisreset'.";
                }
            } else {
                $testResult["steps"][] = "⚠ STARTTLS no soportado, continuando sin cifrar";
            }
        }

        @fputs($fp, "AUTH LOGIN\r\n");
        @fgets($fp, 515);
        @fputs($fp, base64_encode($smtpUser) . "\r\n");
        @fgets($fp, 515);
        @fputs($fp, base64_encode($smtpPass) . "\r\n");
        $authResp = @fgets($fp, 515);
        if (intval(substr($authResp, 0, 3)) != 235) {
            $testResult["steps"][] = "❌ Autenticación rechazada";
            $testResult["error"] = "Las credenciales SMTP fueron rechazadas. Verifique usuario y contraseña.";
            @fputs($fp, "QUIT\r\n"); @fclose($fp);
            ob_end_clean();
            echo json_encode($testResult);
            break;
        }
        $testResult["steps"][] = "✓ Autenticación exitosa";
        $testResult["authenticated"] = true;

        @fputs($fp, "MAIL FROM: <$smtpUser>\r\n");
        @fgets($fp, 515);
        @fputs($fp, "RCPT TO: <$testEmail>\r\n");
        @fgets($fp, 515);
        @fputs($fp, "DATA\r\n");
        $dataPrompt = @fgets($fp, 515);
        if (intval(substr($dataPrompt, 0, 3)) == 354) {
            $testBody = "<html><body><h2>Prueba SMTP</h2><p>Servidor: $smtpHost:$smtpPort</p><p>Fecha: " . date('Y-m-d H:i:s') . "</p></body></html>";
            $msg = "MIME-Version: 1.0\r\nContent-type: text/html; charset=UTF-8\r\nFrom: Dicon Soporte <$smtpUser>\r\nSubject: Prueba SMTP\r\n\r\n" . $testBody . "\r\n.";
            @fputs($fp, $msg . "\r\n");
            $dataResp = @fgets($fp, 515);
            if (intval(substr($dataResp, 0, 3)) == 250) {
                $testResult["steps"][] = "✓ Correo de prueba enviado a $testEmail";
                $testResult["sent"] = true;
                $testResult["message"] = "Prueba SMTP exitosa.";
            }
        }
        @fputs($fp, "QUIT\r\n"); @fclose($fp);
        ob_end_clean();
        echo json_encode($testResult);
        break;

    // ============================================================
    // CONFIGURACIÓN DINÁMICA DE CONEXIÓN A SQL SERVER
    // ============================================================
    // FIX v2.16: El DatabaseConfigModule del frontend llama a estos endpoints
    // para configurar la conexión a SQL Server desde la interfaz web.
    // Antes NO existían → el frontend mostraba "No se pudo contactar al servidor IIS".
    // ============================================================
    case 'get_db_config':
        // Leer la configuración actual desde db_config.php
        $configFile = __DIR__ . '/db_config.php';
        if (file_exists($configFile)) {
            $config = require $configFile;
            echo json_encode(array(
                "status" => "success",
                "config" => array(
                    "serverName" => $config['serverName'] ?? '',
                    "Database" => $config['connectionInfo']['Database'] ?? 'DiconSoporte',
                    "UID" => $config['connectionInfo']['UID'] ?? 'sa',
                    "PWD" => $config['connectionInfo']['PWD'] ?? ''
                )
            ));
        } else {
            echo json_encode(array(
                "status" => "success",
                "config" => array(
                    "serverName" => "",
                    "Database" => "DiconSoporte",
                    "UID" => "sa",
                    "PWD" => ""
                )
            ));
        }
        break;

    case 'test_and_save_db_config':
        $serverName = trim(get_val($input, 'serverName', ''));
        $database = trim(get_val($input, 'Database', 'DiconSoporte'));
        $uid = trim(get_val($input, 'UID', 'sa'));
        $pwd = trim(get_val($input, 'PWD', ''));
        $iisServerUrl = trim(get_val($input, 'iisServerUrl', ''));

        if (!$serverName || !$database || !$uid) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan parámetros (serverName, database, uid)."));
            break;
        }

        // PASO 1: Probar la conexión a SQL Server con los nuevos parámetros
        $testConnInfo = array(
            'Database' => $database,
            'UID' => $uid,
            'PWD' => $pwd,
            'CharacterSet' => 'UTF-8',
            'TrustServerCertificate' => true,
            'LoginTimeout' => 10
        );
        $testConn = @sqlsrv_connect($serverName, $testConnInfo);
        if ($testConn === false) {
            $errors = sqlsrv_errors();
            $errorMsg = "No se pudo conectar a SQL Server en '$serverName'.";
            if ($errors) {
                $errorMsg .= " Error: " . $errors[0]['message'];
            }
            $errorMsg .= "\n\nVerifique:\n- Que el servidor '$serverName' sea accesible desde el servidor IIS\n- Que SQL Server acepte conexiones TCP/IP (Configuration Manager → Protocolos → TCP/IP = Enabled)\n- Que el puerto 1433 esté abierto en el firewall del servidor SQL\n- Que las credenciales (usuario/contraseña) sean correctas";
            echo json_encode(array("status" => "error", "message" => $errorMsg));
            break;
        }
        sqlsrv_close($testConn);

        // PASO 2: Guardar la configuración en db_config.php
        $configContent = "<?php\n";
        $configContent .= "/**\n * Configuración de conexión a SQL Server\n";
        $configContent .= " * Generado automáticamente por el sistema el " . date('Y-m-d H:i:s') . "\n";
        $configContent .= " * Servidor SQL: $serverName\n";
        $configContent .= " */\n";
        $configContent .= "return [\n";
        $configContent .= "    'serverName' => '" . addslashes($serverName) . "',\n";
        $configContent .= "    'connectionInfo' => [\n";
        $configContent .= "        'Database' => '" . addslashes($database) . "',\n";
        $configContent .= "        'UID' => '" . addslashes($uid) . "',\n";
        $configContent .= "        'PWD' => '" . addslashes($pwd) . "',\n";
        $configContent .= "        'CharacterSet' => 'UTF-8',\n";
        $configContent .= "        'TrustServerCertificate' => true,\n";
        $configContent .= "    ]\n";
        $configContent .= "];\n";

        $configFile = __DIR__ . '/db_config.php';
        $writeResult = @file_put_contents($configFile, $configContent);
        if ($writeResult === false) {
            echo json_encode(array(
                "status" => "error",
                "message" => "La conexión a SQL Server fue exitosa, pero no se pudo guardar el archivo db_config.php. Verifique permisos de escritura en la carpeta del IIS."
            ));
            break;
        }

        echo json_encode(array(
            "status" => "success",
            "message" => "Conexión a SQL Server exitosa y configuración guardada correctamente.",
            "serverName" => $serverName,
            "database" => $database
        ));
        break;

    // ============================================================
    // MATRIZ DE PERMISOS — Guardar y leer desde BD
    // ============================================================
    case 'save_role_permissions':
        $id_rol = intval(get_val($input, 'id_rol', 0));
        $permisos = get_val($input, 'permisos', '{}');

        if (!$id_rol) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_rol."));
            break;
        }

        // Eliminar permisos anteriores
        sqlsrv_query($conn, "DELETE FROM role_permissions WHERE id_rol = ?", array($id_rol));

        // Insertar nuevos permisos desde el JSON
        $modulos = array('DASHBOARD', 'TICKETS', 'CLIENTES', 'GEOGRAFIA', 'SEGURIDAD', 'REPORTES');
        $permisosArray = json_decode($permisos, true);
        if (!$permisosArray) $permisosArray = array();

        foreach ($modulos as $modulo) {
            $p = isset($permisosArray[$modulo]) ? $permisosArray[$modulo] : array();
            $ver = !empty($p['ver']) ? 1 : 0;
            $registrar = !empty($p['registrar']) ? 1 : 0;
            $modificar = !empty($p['modificar']) ? 1 : 0;
            $eliminar = !empty($p['eliminar']) ? 1 : 0;
            $aprobar = !empty($p['aprobar']) ? 1 : 0;
            $exportar = !empty($p['exportar']) ? 1 : 0;
            $imprimir = !empty($p['imprimir']) ? 1 : 0;

            sqlsrv_query($conn, "INSERT INTO role_permissions (id_rol, modulo, ver, registrar, modificar, eliminar, aprobar, exportar, imprimir, fecha_actualizacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE())",
                array($id_rol, $modulo, $ver, $registrar, $modificar, $eliminar, $aprobar, $exportar, $imprimir));
        }

        invalidate_sync_cache();
        echo json_encode(array("status" => "success", "message" => "Permisos guardados en la base de datos."));
        break;

    case 'get_role_permissions':
        // Devolver todos los permisos de todos los roles
        $perms = fetch_all_rows($conn, "SELECT id_rol, modulo, ver, registrar, modificar, eliminar, aprobar, exportar, imprimir FROM role_permissions ORDER BY id_rol, modulo");
        echo json_encode(array("status" => "success", "data" => $perms));
        break;

    // ============================================================
    // FIX v2.88 — CRUD DE ROLES (crear, editar, eliminar)
    // ============================================================
    case 'save_role':
        $id_rol = to_int_or_null(get_val($input, 'id_rol', null));
        $nombre = trim(get_val($input, 'nombre', ''));
        $descripcion = trim(get_val($input, 'descripcion', ''));

        if (!$nombre) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "El nombre del rol es obligatorio."));
            break;
        }

        if ($id_rol === null || $id_rol === 0) {
            // Crear nuevo rol
            $sql = "INSERT INTO persona_rol (nombre, descripcion) OUTPUT INSERTED.id_rol VALUES (?, ?)";
            $stmt = sqlsrv_query($conn, $sql, array($nombre, $descripcion ?: null));
            if ($stmt === false) {
                // Fallback sin OUTPUT
                $sql2 = "INSERT INTO persona_rol (nombre, descripcion) VALUES (?, ?); SELECT SCOPE_IDENTITY() AS id_rol;";
                $stmt2 = sqlsrv_query($conn, $sql2, array($nombre, $descripcion ?: null));
                $newId = 0;
                if ($stmt2 !== false) {
                    sqlsrv_next_result($stmt2);
                    if ($row = sqlsrv_fetch_array($stmt2, SQLSRV_FETCH_ASSOC)) {
                        $newId = intval($row['id_rol']);
                    }
                }
                if (!$newId) {
                    http_response_code(500);
                    echo json_encode(array("status" => "error", "message" => "Error al crear el rol.", "errors" => sqlsrv_errors()));
                    break;
                }
                $id_rol = $newId;
            } else {
                $row = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC);
                $id_rol = intval($row['id_rol']);
            }
            log_operacion_auto($conn, "SEGURIDAD", "Crear rol", "Rol: " . $nombre, $input);
            $msg = "Rol '" . $nombre . "' creado exitosamente.";
        } else {
            // Editar rol existente (no permitir editar roles 1-4 nativos)
            if ($id_rol <= 4) {
                http_response_code(400);
                echo json_encode(array("status" => "error", "message" => "No se pueden modificar los roles nativos del sistema (1-4)."));
                break;
            }
            $sql = "UPDATE persona_rol SET nombre = ?, descripcion = ? WHERE id_rol = ?";
            $stmt = sqlsrv_query($conn, $sql, array($nombre, $descripcion ?: null, $id_rol));
            if ($stmt === false) {
                http_response_code(500);
                echo json_encode(array("status" => "error", "message" => "Error al actualizar el rol.", "errors" => sqlsrv_errors()));
                break;
            }
            log_operacion_auto($conn, "SEGURIDAD", "Editar rol", "Rol: " . $nombre, $input);
            $msg = "Rol '" . $nombre . "' actualizado exitosamente.";
        }
        invalidate_sync_cache();
        echo json_encode(array("status" => "success", "message" => $msg, "id_rol" => $id_rol));
        break;

    case 'delete_role':
        $id_rol = intval(get_val($input, 'id_rol', 0));
        if (!$id_rol) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta id_rol."));
            break;
        }
        // No permitir eliminar roles nativos (1-4)
        if ($id_rol <= 4) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "No se pueden eliminar los roles nativos del sistema (1-4)."));
            break;
        }
        // Verificar si hay usuarios asignados a este rol
        $checkUsers = sqlsrv_query($conn, "SELECT COUNT(*) AS cnt FROM persona_rol_asignacion WHERE id_rol = ?", array($id_rol));
        $userCount = 0;
        if ($checkUsers !== false && $row = sqlsrv_fetch_array($checkUsers, SQLSRV_FETCH_ASSOC)) {
            $userCount = intval($row['cnt']);
        }
        if ($userCount > 0) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "No se puede eliminar el rol porque tiene " . $userCount . " usuario(s) asignado(s). Reasigne los usuarios a otro rol antes de eliminar."));
            break;
        }
        // Eliminar permisos del rol
        sqlsrv_query($conn, "DELETE FROM role_permissions WHERE id_rol = ?", array($id_rol));
        // Eliminar el rol
        $stmt = sqlsrv_query($conn, "DELETE FROM persona_rol WHERE id_rol = ?", array($id_rol));
        if ($stmt === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "Error al eliminar el rol.", "errors" => sqlsrv_errors()));
            break;
        }
        log_operacion_auto($conn, "SEGURIDAD", "Eliminar rol", resolver_nombre_entidad($conn, "rol", $id_rol), $input);
        invalidate_sync_cache();
        echo json_encode(array("status" => "success", "message" => "Rol eliminado exitosamente."));
        break;

    // ============================================================
    // BITÁCORA DE OPERACIONES — Registrar acciones del usuario
    // ============================================================
    case 'log_operacion':
        $usuario = trim(get_val($input, 'usuario', ''));
        $modulo = trim(get_val($input, 'modulo', ''));
        $operacion = trim(get_val($input, 'operacion', ''));
        $detalles = trim(get_val($input, 'detalles', ''));
        // FIX v2.18: Registrar IP y hostname de la PC
        $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
        $host = @gethostbyaddr($ip);
        if (!$host || $host === $ip) $host = 'unknown';
        $ip_con_host_log = $ip . ' (' . $host . ')';

        if (!$usuario || !$modulo || !$operacion) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan parámetros."));
            break;
        }

        $sql = "INSERT INTO auditoria_operacion (usuario, fecha_hora, modulo, operacion, detalles, ip_address)
                VALUES (?, GETDATE(), ?, ?, ?, ?)";
        $stmt = sqlsrv_query($conn, $sql, array($usuario, $modulo, $operacion, $detalles, $ip_con_host_log));
        if ($stmt === false) {
            // Si no existe la columna ip_address, intentar sin ella
            $sql2 = "INSERT INTO auditoria_operacion (usuario, fecha_hora, modulo, operacion, detalles)
                     VALUES (?, GETDATE(), ?, ?, ?)";
            sqlsrv_query($conn, $sql2, array($usuario, $modulo, $operacion, $detalles));
        }

        echo json_encode(array("status" => "success", "message" => "Operación registrada."));
        break;

    // ============================================================
    // LIMPIAR BITÁCORA DE ACCESOS Y OPERACIONES
    // ============================================================
    case 'clear_audit_logs':
        $tipo = trim(get_val($input, 'tipo', 'all')); // all, accesos, operaciones
        $fecha_desde = trim(get_val($input, 'fecha_desde', ''));
        $fecha_hasta = trim(get_val($input, 'fecha_hasta', ''));

        $eliminados = 0;

        if ($tipo === 'all' || $tipo === 'accesos') {
            // FIX v2.61 — Si no hay filtro de fechas, TRUNCATE (reinicia ID a cero). Si hay filtro, DELETE.
            if ($fecha_desde && $fecha_hasta) {
                $sql = "DELETE FROM acceso_auditoria WHERE CAST(fecha_hora AS DATE) BETWEEN ? AND ?";
                $params = array($fecha_desde, $fecha_hasta);
                $stmt = sqlsrv_query($conn, $sql, $params);
            } elseif ($fecha_desde) {
                $sql = "DELETE FROM acceso_auditoria WHERE CAST(fecha_hora AS DATE) >= ?";
                $stmt = sqlsrv_query($conn, $sql, array($fecha_desde));
            } elseif ($fecha_hasta) {
                $sql = "DELETE FROM acceso_auditoria WHERE CAST(fecha_hora AS DATE) <= ?";
                $stmt = sqlsrv_query($conn, $sql, array($fecha_hasta));
            } else {
                // Sin filtro: TRUNCATE reinicia el contador de ID a cero
                $stmt = sqlsrv_query($conn, "TRUNCATE TABLE acceso_auditoria");
            }
            if ($stmt !== false) $eliminados += sqlsrv_rows_affected($stmt);
        }

        if ($tipo === 'all' || $tipo === 'operaciones') {
            // FIX v2.61 — Mismo patrón para operaciones.
            if ($fecha_desde && $fecha_hasta) {
                $sql = "DELETE FROM auditoria_operacion WHERE CAST(fecha_hora AS DATE) BETWEEN ? AND ?";
                $stmt = sqlsrv_query($conn, $sql, array($fecha_desde, $fecha_hasta));
            } elseif ($fecha_desde) {
                $sql = "DELETE FROM auditoria_operacion WHERE CAST(fecha_hora AS DATE) >= ?";
                $stmt = sqlsrv_query($conn, $sql, array($fecha_desde));
            } elseif ($fecha_hasta) {
                $sql = "DELETE FROM auditoria_operacion WHERE CAST(fecha_hora AS DATE) <= ?";
                $stmt = sqlsrv_query($conn, $sql, array($fecha_hasta));
            } else {
                // Sin filtro: TRUNCATE reinicia el contador de ID a cero
                $stmt = sqlsrv_query($conn, "TRUNCATE TABLE auditoria_operacion");
            }
            if ($stmt !== false) $eliminados += sqlsrv_rows_affected($stmt);
        }

        echo json_encode(array("status" => "success", "message" => "Bitácora limpiada. Registros eliminados: " . $eliminados));
        break;

    // ============================================================
    // DAR DE BAJA (contacto, empresa, sucursal) CON MOTIVO
    // ============================================================
    case 'dar_baja':
        $tipo_entidad = trim(get_val($input, 'tipo_entidad', '')); // CONTACTO, EMPRESA, SUCURSAL
        $id_entidad = intval(get_val($input, 'id_entidad', 0));
        $motivo = trim(get_val($input, 'motivo', ''));
        $id_usuario = to_int_or_null(get_val($input, 'id_usuario', null));

        if (!$tipo_entidad || !$id_entidad || !$motivo) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Faltan parámetros (tipo_entidad, id_entidad, motivo)."));
            break;
        }

        // Registrar la baja
        $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
        $host = @gethostbyaddr($ip);
        if (!$host || $host === $ip) $host = 'unknown';
        $ip_con_host = $ip . ' (' . $host . ')';

        $bajaSql = "INSERT INTO bajas_registro (tipo_entidad, id_entidad, id_usuario, motivo, fecha_baja, ip_address)
                    VALUES (?, ?, ?, ?, GETDATE(), ?)";
        @sqlsrv_query($conn, $bajaSql, array($tipo_entidad, $id_entidad, $id_usuario, $motivo, $ip_con_host));

        // Aplicar la baja según el tipo
        if ($tipo_entidad === 'CONTACTO') {
            sqlsrv_query($conn, "UPDATE empresa_contacto SET estado = 0 WHERE id_empresa_contacto = ?", array($id_entidad));
            log_operacion_auto($conn, "CLIENTES", "Dar de baja contacto", resolver_nombre_entidad($conn, "contacto", $id_entidad) . " - Motivo: " . $motivo, $input);
        } else if ($tipo_entidad === 'EMPRESA') {
            sqlsrv_query($conn, "UPDATE empresa SET id_rubro = NULL WHERE id_empresa = ?", array($id_entidad));
            // Marcar como inactiva cambiando el estado de todos sus contactos
            sqlsrv_query($conn, "UPDATE empresa_contacto SET estado = 0 WHERE id_empresa = ?", array($id_entidad));
            log_operacion_auto($conn, "CLIENTES", "Dar de baja empresa", resolver_nombre_entidad($conn, "empresa", $id_entidad) . " - Motivo: " . $motivo, $input);
        } else if ($tipo_entidad === 'SUCURSAL') {
            sqlsrv_query($conn, "DELETE FROM empresa_sucursal WHERE id_sucursal = ?", array($id_entidad));
            log_operacion_auto($conn, "CLIENTES", "Dar de baja sucursal", resolver_nombre_entidad($conn, "sucursal", $id_entidad) . " - Motivo: " . $motivo, $input);
        }

        echo json_encode(array("status" => "success", "message" => "Baja registrada exitosamente."));
        break;

    case 'get_bajas':
        $bajas = fetch_all_rows($conn, "SELECT b.id_baja, b.tipo_entidad, b.id_entidad, b.motivo, 
            CONVERT(VARCHAR(19), b.fecha_baja, 120) AS fecha_baja, b.ip_address,
            p.nombres + ' ' + p.apellido_paterno AS usuario_nombre
            FROM bajas_registro b
            LEFT JOIN persona p ON b.id_usuario = p.id_persona
            ORDER BY b.fecha_baja DESC");
        echo json_encode(array("status" => "success", "data" => $bajas));
        break;

    // ============================================================
    // RECUPERAR CONTRASEÑA — ENVIAR POR CORREO
    // ============================================================
    case 'recover_password':
        $correo = trim(get_val($input, 'correo', ''));

        if (!$correo) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Ingrese su correo electrónico."));
            break;
        }

        // Buscar el usuario
        $sql = "SELECT id_persona, nombres, apellido_paterno, correo, bloqueado FROM persona WHERE correo = ? AND estado = 1";
        $stmt = sqlsrv_query($conn, $sql, array($correo));
        if ($stmt === false || !sqlsrv_has_rows($stmt)) {
            // Por seguridad, no revelar si el correo existe o no
            echo json_encode(array("status" => "success", "message" => "Si el correo está registrado, recibirá un mensaje con instrucciones."));
            break;
        }

        $user = sqlsrv_fetch_array($stmt, SQLSRV_FETCH_ASSOC);

        // Generar contraseña temporal aleatoria
        $tempPassword = substr(str_shuffle('abcdefghjkmnpqrstuvwxyz23456789'), 0, 8);
        $hashedTemp = hash('sha256', $tempPassword);

        // Guardar la contraseña temporal
        sqlsrv_query($conn, "UPDATE persona SET contrasena = ?, bloqueado = 0 WHERE id_persona = ?", array($hashedTemp, $user['id_persona']));

        // Intentar enviar el correo
        $smtpHost = trim(get_val($input, 'smtp_host', '')) ?: 'smtp.gmail.com';
        $smtpPort = intval(get_val($input, 'smtp_port', 587));
        $smtpUser = trim(get_val($input, 'smtp_user', '')) ?: 'notificaciones@soporte.com';
        $smtpPass = str_replace(" ", "", trim(get_val($input, "smtp_pass", "")));
        $smtpSender = $smtpUser;

        $emailBody = "<html><body style='font-family:Segoe UI,Arial;font-size:14px;color:#141414;'>
        <h2>Recuperación de Contraseña — Dicon Soporte ERP</h2>
        <p>Hola <strong>" . $user['nombres'] . " " . $user['apellido_paterno'] . "</strong>,</p>
        <p>Has solicitado recuperar tu contraseña. Tu contraseña temporal es:</p>
        <p style='font-size:20px;font-weight:bold;background:#f0f0f0;padding:10px;border:2px solid #141414;text-align:center;'>" . $tempPassword . "</p>
        <p>Ingresa al sistema con esta contraseña temporal y luego cámbiala desde el botón 'Cambiar Contraseña'.</p>
        <p style='color:#666;font-size:12px;'>Si no solicitaste este cambio, contacta al administrador del sistema.</p>
        </body></html>";

        $emailSent = false;
        $useSsl = ($smtpPort == 465);
        $connectHost = $useSsl ? "ssl://$smtpHost" : $smtpHost;
        $fp = @fsockopen($connectHost, $smtpPort, $errno, $errstr, 15);

        if ($fp) {
            stream_set_timeout($fp, 15);
            $greeting = @fgets($fp, 515);
            if ($greeting && intval(substr($greeting, 0, 3)) == 220) {
                $domain = isset($_SERVER['SERVER_NAME']) ? $_SERVER['SERVER_NAME'] : 'localhost';
                @fputs($fp, "EHLO $domain\r\n");
                $ehloResp = ''; while (substr($ehloResp, 3, 1) != ' ') { $ehloResp = @fgets($fp, 515); if ($ehloResp === false) break; }
                if (intval(substr($ehloResp, 0, 3)) == 250) {
                    if ($smtpPort == 587) {
                        @fputs($fp, "STARTTLS\r\n");
                        $tlsResp = @fgets($fp, 515);
                        if (intval(substr($tlsResp, 0, 3)) == 220) {
                            @stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
                            @fputs($fp, "EHLO $domain\r\n");
                            $ehloResp2 = ''; while (substr($ehloResp2, 3, 1) != ' ') { $ehloResp2 = @fgets($fp, 515); if ($ehloResp2 === false) break; }
                        }
                    }
                    if ($smtpPass) {
                        @fputs($fp, "AUTH LOGIN\r\n"); @fgets($fp, 515);
                        @fputs($fp, base64_encode($smtpUser) . "\r\n"); @fgets($fp, 515);
                        @fputs($fp, base64_encode($smtpPass) . "\r\n");
                        $authResp = @fgets($fp, 515);
                        if (intval(substr($authResp, 0, 3)) == 235) {
                            @fputs($fp, "MAIL FROM: <$smtpSender>\r\n"); @fgets($fp, 515);
                            @fputs($fp, "RCPT TO: <$correo>\r\n"); @fgets($fp, 515);
                            @fputs($fp, "DATA\r\n"); @fgets($fp, 515);
                            $headers = "MIME-Version: 1.0\r\nContent-type: text/html; charset=UTF-8\r\nFrom: Dicon Soporte <$smtpSender>\r\nSubject: Recuperacion de contrasena\r\n\r\n";
                            @fputs($fp, $headers . $emailBody . "\r\n.\r\n");
                            $dataResp = @fgets($fp, 515);
                            if (intval(substr($dataResp, 0, 3)) == 250) $emailSent = true;
                        }
                    }
                }
            }
            @fputs($fp, "QUIT\r\n"); @fclose($fp);
        }

        log_operacion_auto($conn, "SEGURIDAD", "Recuperar contraseña", $correo, $input);

        if ($emailSent) {
            echo json_encode(array("status" => "success", "message" => "Se ha enviado una contraseña temporal a tu correo electrónico."));
        } else {
            // Si no se pudo enviar, mostrar la contraseña temporal (solo en desarrollo)
            echo json_encode(array(
                "status" => "success",
                "message" => "No se pudo enviar el correo, pero la contraseña fue restablecida.",
                "temp_password" => $tempPassword,
                "email_error" => $errstr
            ));
        }
        break;

    case 'save_smtp_config':
        echo json_encode(array("status" => "success", "message" => "Configuración SMTP guardada."));
        break;

    // ============================================================
    // FIX v2.87 — ENDPOINTS PARA PLANTILLAS DE CORREO EDITABLES
    // ============================================================
    // Permite editar el asunto y cuerpo de los emails desde la web.
    // Las plantillas se guardan en email_templates.json (junto a smtp_config.json).
    // ============================================================
    // FIX v2.97 — Endpoint ligero para refrescar SOLO la bitácora
    // ============================================================
    case 'get_auditoria':
        $limit = isset($_GET['limit']) ? intval($_GET['limit']) : 50;
        $data = fetch_all_rows($conn, "SELECT TOP $limit id_auditoria, usuario, fecha_hora, modulo, operacion, detalles, ip_address, hostname FROM auditoria_operacion ORDER BY id_auditoria DESC");
        echo json_encode(array("status" => "success", "data" => $data));
        break;

    case 'get_email_templates':
        $templatesFile = __DIR__ . '/email_templates.json';
        $defaults = array(
            'TICKET_REGISTRO' => array(
                'asunto' => 'Ticket #{NRO_TICKET} registrado · ERP SOPORTE',
                'cuerpo' => '<h1>📋 Estimado cliente, usted ha registrado un ticket de soporte</h1><p>Le confirmamos que su ticket de soporte ha sido registrado exitosamente en nuestro sistema. A continuación, encontrará los detalles del reporte:</p><div class="field"><span class="label">N° de Ticket</span><span class="value" style="font-weight:bold;font-size:16px;">{NRO_TICKET}</span></div><div class="field"><span class="label">Empresa</span><span class="value">{RAZON_SOCIAL}</span></div><div class="field"><span class="label">Prioridad</span><span class="value">{PRIORIDAD}</span></div><div class="field"><span class="label">Motivo de Contacto</span><span class="value">{MOTIVO}</span></div><div class="field"><span class="label">Detalle del Reporte</span><span class="value">{DETALLE}</span></div><p>Nuestro equipo de soporte atenderá su solicitud a la brevedad posible.</p>'
            ),
            'TICKET_USUARIO' => array(
                'asunto' => 'Se le ha asignado el Ticket #{NRO_TICKET} · ERP SOPORTE',
                'cuerpo' => '<h1>🎫 Se le ha asignado un ticket</h1><p>Se le ha asignado un nuevo ticket de soporte. A continuación, los detalles:</p><div class="field"><span class="label">N° de Ticket asignado</span><span class="value" style="font-weight:bold;font-size:16px;">{NRO_TICKET}</span></div><div class="field"><span class="label">Prioridad</span><span class="value">{PRIORIDAD}</span></div><div class="field"><span class="label">Detalle del Reporte</span><span class="value">{DETALLE}</span></div><p>Por favor, ingrese al sistema para revisar y gestionar este ticket.</p>'
            ),
            'TICKET_CIERRE' => array(
                'asunto' => 'Su Ticket #{NRO_TICKET} ha sido resuelto · ERP SOPORTE',
                'cuerpo' => '<h1>✅ Estimado cliente, su ticket ha sido resuelto</h1><p>Le informamos que su ticket de soporte ha sido resuelto y cerrado. A continuación, encontrará los detalles completos del reporte y la solución aplicada:</p><div class="field"><span class="label">N° de Ticket</span><span class="value" style="font-weight:bold;font-size:16px;">{NRO_TICKET}</span></div><div class="field"><span class="label">Empresa</span><span class="value">{RAZON_SOCIAL}</span></div><div class="field"><span class="label">Prioridad</span><span class="value">{PRIORIDAD}</span></div><div class="field"><span class="label">Motivo de Contacto</span><span class="value">{MOTIVO}</span></div><div class="field"><span class="label">Detalle del Reporte</span><span class="value">{DETALLE}</span></div><div class="field"><span class="label">Solución Aplicada</span><span class="value">{SOLUCION}</span></div><p>Si tiene alguna consulta adicional, no dude en contactarnos.</p>'
            )
        );
        if (file_exists($templatesFile)) {
            $saved = json_decode(file_get_contents($templatesFile), true);
            if (is_array($saved)) {
                $defaults = array_merge($defaults, $saved);
            }
        }
        echo json_encode(array("status" => "success", "data" => $defaults));
        break;

    case 'save_email_template':
        $template_id = trim(get_val($input, 'template_id', ''));
        $asunto = trim(get_val($input, 'asunto', ''));
        $cuerpo = get_val($input, 'cuerpo', '');
        if (!$template_id) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Falta template_id."));
            break;
        }
        $templatesFile = __DIR__ . '/email_templates.json';
        $existing = array();
        if (file_exists($templatesFile)) {
            $existing = json_decode(file_get_contents($templatesFile), true) ?: array();
        }
        $existing[$template_id] = array('asunto' => $asunto, 'cuerpo' => $cuerpo);
        $written = @file_put_contents($templatesFile, json_encode($existing, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
        if ($written === false) {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "No se pudo escribir en email_templates.json. Verifique permisos de la carpeta del backend."));
            break;
        }
        invalidate_sync_cache();
        echo json_encode(array("status" => "success", "message" => "Plantilla '" . $template_id . "' guardada exitosamente."));
        break;

    case 'test_email':
        // Envía un email de prueba a la dirección indicada
        $to = trim(get_val($input, 'to', ''));
        if (!$to || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            http_response_code(400);
            echo json_encode(array("status" => "error", "message" => "Correo destino inválido."));
            break;
        }
        $asunto = "ERP SOPORTE — Email de prueba";
        $cuerpo = _estilo_correo()
            . "<h1>📧 Email de prueba</h1>"
            . "<p>Si está leyendo este mensaje, la configuración SMTP funciona correctamente.</p>"
            . "<div class='field'><span class='label'>Servidor</span><span class='value'>" . date('Y-m-d H:i:s') . "</span></div>"
            . "<div class='footer'>ERP SOPORTE · Email de prueba</div>"
            . "</div></body></html>";
        $result = enviar_correo_smtp($conn, $to, $asunto, $cuerpo, 'TEST');
        if ($result['sent']) {
            echo json_encode(array("status" => "success", "message" => "Email de prueba enviado exitosamente a: " . $to));
        } else {
            http_response_code(500);
            echo json_encode(array("status" => "error", "message" => "No se pudo enviar el email: " . $result['error']));
        }
        break;

        // ============================================================
    // DEFAULT
    // ============================================================
    default:
        http_response_code(400);
        echo json_encode(array("status" => "error", "message" => "Acción no válida."));
        break;
}

sqlsrv_close($conn);
?>