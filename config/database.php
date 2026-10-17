<?php
/**
 * config/database.php v4
 *
 * Configuracion centralizada de conexion a Microsoft SQL Server.
 *
 * IMPORTANTE: Atributos PDO compatibles con pdo_sqlsrv.
 * NO usar ATTR_EMULATE_PREPARES (no soportado por pdo_sqlsrv).
 */

declare(strict_types=1);

final class Database
{
    /** Credenciales - AJUSTAR segun tu entorno */
    private const DB_HOST = 'DESKTOP-FOOD01U\\SQL2025';
    private const DB_PORT = 1435;
    private const DB_NAME = 'MonosyncERP';
    private const DB_USER = 'sa';
    private const DB_PASS = '123';
    private const DB_TIMEOUT = 15;

    /** Pool de conexiones por proceso PHP (sin persistente para evitar problemas en IIS) */
    private static ?PDO $pool = null;

    /** Ultimo error de conexion (para diagnostico) */
    private static ?string $lastError = null;

    /**
     * Devuelve una conexion PDO a SQL Server.
     * Lanza excepcion si falla.
     */
    public static function connection(): PDO
    {
        if (self::$pool !== null) {
            return self::$pool;
        }

        // DSN - TrustServerCertificate=yes para desarrollo local
        $dsn = sprintf(
            'sqlsrv:Server=%s,%d;Database=%s;Encrypt=yes;TrustServerCertificate=yes;LoginTimeout=%d',
            self::DB_HOST,
            self::DB_PORT,
            self::DB_NAME,
            self::DB_TIMEOUT
        );

        try {
            // Atributos PDO 100% compatibles con pdo_sqlsrv
            self::$pool = new PDO($dsn, self::DB_USER, self::DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::SQLSRV_ATTR_ENCODING    => PDO::SQLSRV_ENCODING_UTF8,
            ]);
            self::$lastError = null;
            return self::$pool;

        } catch (PDOException $e) {
            self::$lastError = $e->getMessage();
            error_log('[DB] Conexion fallida: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * Ejecuta un stored procedure con parametros y devuelve el primer result set.
     */
    public static function callSP(string $spName, array $params = []): array
    {
        $pdo  = self::connection();
        $placeholders = implode(',', array_fill(0, count($params), '?'));
        $stmt = $pdo->prepare("EXEC $spName $placeholders");
        foreach (array_values($params) as $i => $v) {
            $stmt->bindValue($i + 1, $v, self::inferType($v));
        }
        $stmt->execute();
        return $stmt->fetchAll();
    }

    /** Tipado de parametro PDO basado en el valor PHP */
    private static function inferType($v): int
    {
        if (is_int($v))   return PDO::PARAM_INT;
        if (is_bool($v))  return PDO::PARAM_BOOL;
        if (is_null($v))  return PDO::PARAM_NULL;
        return PDO::PARAM_STR;
    }

    /** Genera un trace_id unico para logs */
    public static function traceId(): string
    {
        return bin2hex(random_bytes(8));
    }

    /** Devuelve el ultimo error de conexion (para diagnostico) */
    public static function getLastError(): ?string
    {
        return self::$lastError;
    }
}
