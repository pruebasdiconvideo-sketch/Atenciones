# Sistema de Atenciones v2.0 - MonosyncERP

Sistema web de gestion de tickets y atenciones tecnicas.

## Requisitos del Servidor

- **Windows Server 2019+** con **IIS 10+**
- **PHP 8.1+** via FastCGI con extensiones:
  - `pdo_sqlsrv` (https://github.com/microsoft/msphpsql)
  - `openssl`, `mbstring`, `json`, `session`, `fileinfo`
  - Opcional: `sqlsrv` (no-PDO API)
- **URL Rewrite Module** para IIS (https://www.iis.net/downloads/microsoft/url-rewrite)
- **Microsoft SQL Server 2019+** (en servidor separado)
- **ODBC Driver 18 for SQL Server**

## Estructura del Proyecto

```
Atenciones-Mejorado/
├── api/                          # API REST
│   ├── index.php                # Router principal
│   └── routes/                  # Endpoints por recurso
│       ├── auth.php             # /auth/login, /auth/token
│       ├── dashboard.php        # /dashboard/*
│       ├── tickets.php           # /tickets/*
│       ├── notificaciones.php   # /notificaciones/*
│       ├── encuestas.php        # /encuestas/*
│       ├── auditoria.php        # /auditoria/*
│       └── exportaciones.php    # /exportaciones/*
├── assets/                      # Frontend
│   ├── css/app.css
│   └── js/{app.js, dashboard.js}
├── config/
│   └── database.php             # Conexion SQL Server (pdo_sqlsrv)
├── includes/
│   ├── api_response.php        # Helpers JSON
│   └── auth.php                # Sesion + Bearer Token + Permisos
├── modules/                    # Modulos de funcionalidad
│   ├── dashboard/
│   ├── notificaciones/
│   │   └── push_dispatcher.php # Worker para Web Push
│   ├── encuestas/
│   ├── auditoria/
│   ├── exportacion/
│   │   └── worker.php          # Worker CLI para exportaciones async
│   └── permisos/
├── pwa/                         # Progressive Web App
│   ├── manifest.json
│   ├── service-worker.js       # Cache + Push + Background Sync
│   └── push-client.js          # Suscripcion Web Push
├── scripts_sql/                 # Scripts SQL
│   └── 02_extension_nuevas_opciones.sql
├── storage/                     # Archivos temporales (crear en servidor)
│   ├── exports/
│   └── logs/
├── vendor/                      # Dependencias Composer (crear en servidor)
│   ├── minishlink/web-push
│   └── phpoffice/phpspreadsheet
├── docs/                        # Documentacion tecnica
├── web.config                   # Configuracion IIS
├── index.php                    # App Shell (frontend)
├── login.php                    # Pantalla de login
└── README.md
```

## Instalacion

### 1. Base de datos SQL Server

```sql
-- En el servidor SQL Server (otra VM)
-- 1. Crear login de aplicacion
CREATE LOGIN app_atenciones WITH PASSWORD = 'C4mb14r3nPr0d!';
USE MonosyncERP;
CREATE USER app_atenciones FOR LOGIN app_atenciones;
ALTER ROLE db_datareader ADD MEMBER app_atenciones;
ALTER ROLE db_datawriter ADD MEMBER app_atenciones;
GRANT EXECUTE ON SCHEMA::dbo TO app_atenciones;

-- 2. Aplicar script de extension
sqlcmd -S servidor_sql -d MonosyncERP -U sa -i 02_extension_nuevas_opciones.sql

-- 3. Como administrador de la BD, crear la tabla para adjuntos de tickets
sqlcmd -S servidor_sql -d MonosyncERP -U sa -i 08_ticket_documentos.sql

-- 4. Agregar estado y fecha de baja para empresas
sqlcmd -S servidor_sql -d MonosyncERP -U sa -i 09_empresa_bajas.sql

-- 5. Habilitar el checkbox para crear (u omitir) la sede principal
sqlcmd -S servidor_sql -d MonosyncERP -U sa -i 10_empresa_sede_principal.sql
```

### 2. Configurar IIS

1. Crear sitio web en IIS apuntando a la carpeta raiz del proyecto
2. Instalar **URL Rewrite Module**
3. Habilitar **WebSocket Protocol** (para notificaciones tiempo real)
4. Configurar Application Pool:
   - .NET CLR Version: No Managed Code
   - Identity: ApplicationPoolIdentity
   - Recycle: cada 1740 min (default) o ajustar
5. Permisos de carpeta:
  - `storage/` con permisos de escritura para IIS_IUSRS (incluye `storage/ticket_documents/`)
   - `vendor/` con permisos de solo lectura

### 3. Instalar dependencias PHP

```bash
# En el servidor IIS
composer require minishlink/web-push phpoffice/phpspreadsheet
```

### 4. Generar claves VAPID para PWA Push

```bash
# Una sola vez:
php vendor/bin/vapid-keys > config/vapid.json
```

Formato esperado:
```json
{
  "publicKey":  "BOP...2 caracteres base64url...",
  "privateKey": "8x...2 caracteres base64url..."
}
```

### 5. Configurar workers (Windows Task Scheduler)

Crear 2 tareas programadas que ejecuten scripts PHP:

| Tarea                  | Comando                                                           | Frecuencia |
|------------------------|--------------------------------------------------------------------|------------|
| Exportaciones worker   | `php C:\inetpub\wwwroot\Atenciones\modules\exportacion\worker.php`| Cada 2 min |
| Push dispatcher        | `php C:\inetpub\wwwroot\Atenciones\modules\notificaciones\push_dispatcher.php` | Cada 1 min |

### 6. Ajustar credenciales de BD

Editar `config/database.php`:
```php
private const DB_HOST = 'IP_DEL_SERVIDOR_SQL';
private const DB_USER = 'app_atenciones';
private const DB_PASS = 'contrasena_segura';
```

## Caracteristicas nuevas (v2.0)

- **Dashboard con KPIs y graficos** (Chart.js)
- **Roles y permisos** por modulo (12 modulos catalogados)
- **Notificaciones** con plantillas, push web (VAPID) y email
- **API REST** completa con tokens, rate limiting, logs
- **Auditoria avanzada** con triggers DML en tablas criticas
- **Exportacion masiva** async (XLSX, CSV, JSON, PDF)
- **Encuestas de satisfaccion** post-cierre de ticket
- **PWA** instalable con offline-first, push notifications y share target

## Seguridad

- **TLS obligatorio** (HSTS preload)
- Cookies `HttpOnly`, `Secure`, `SameSite=Strict`
- CSP estricta en headers
- Tokens API con hash SHA-512 (nunca en plano)
- Rate limiting por token
- Validacion de permisos en cada endpoint
- Parametros tipados (PDO prepare)
- Sin exponer credenciales ni trazas internas en errores

## Soporte de 5000 usuarios concurrentes

Para soportar 5000 sesiones activas con ~300 concurrentes reales:

1. **Application Pool**: 4-8 workers (no mas de CPU cores)
2. **PHP-FPM/FastCGI**: max_children = 50 por worker
3. **Connection Pooling**: activado en pdo_sqlsrv (ATTR_PERSISTENT=true)
4. **SQL Server**: max worker threads = 1024, max connections = 32767
5. **Cache**: Redis opcional para sesiones PHP (`session.save_handler = redis`)
6. **Load Balancer**: si > 500 conexiones simultaneas reales, usar 2+ servidores IIS detras de NLB

## Documentacion completa

Ver `docs/arquitectura_atenciones.pdf` para el documento tecnico completo (30+ paginas) con:
- Arquitectura recomendada
- Revision del codigo GitHub actual
- Mejoras propuestas
- Configuracion detallada IIS + SQL Server
- Plan de escalabilidad a 5000 usuarios
- Hardening de seguridad
- Procedimientos de despliegue
