# Guía Completa de Implementación en IIS - HelpDesk ERP

## Requisitos Previos

### Software Necesario
1. **Windows Server** (2016, 2019, 2022) o **Windows 10/11** con IIS habilitado
2. **IIS (Internet Information Services)** instalado
3. **PHP 8.x** instalado
4. **Microsoft SQL Server** (2017, 2019, 2022)
5. **Microsoft Drivers for PHP for SQL Server** (SQLSRV)
6. **Node.js** y **npm** (para build del frontend)

### Habilitar IIS en Windows
```powershell
# Abrir PowerShell como Administrador
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServer
Enable-WindowsOptionalFeature -Online -FeatureName IIS-CommonHttpFeatures
Enable-WindowsOptionalFeature -Online -FeatureName IIS-HttpErrors
Enable-WindowsOptionalFeature -Online -FeatureName IIS-ApplicationDevelopment
Enable-WindowsOptionalFeature -Online -FeatureName IIS-NetFxExtensibility45
Enable-WindowsOptionalFeature -Online -FeatureName IIS-HealthAndDiagnostics
Enable-WindowsOptionalFeature -Online -FeatureName IIS-HttpLogging
Enable-WindowsOptionalFeature -Online -FeatureName IIS-Security
Enable-WindowsOptionalFeature -Online -FeatureName IIS-RequestFiltering
Enable-WindowsOptionalFeature -Online -FeatureName IIS-Performance
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerManagementTools
Enable-WindowsOptionalFeature -Online -FeatureName IIS-ManagementConsole
Enable-WindowsOptionalFeature -Online -FeatureName IIS-BasicAuthentication
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WindowsAuthentication
Enable-WindowsOptionalFeature -Online -FeatureName IIS-StaticContent
Enable-WindowsOptionalFeature -Online -FeatureName IIS-DefaultDocument
Enable-WindowsOptionalFeature -Online -FeatureName IIS-DirectoryBrowsing
Enable-WindowsOptionalFeature -Online -FeatureName Web-WebSockets
Enable-WindowsOptionalFeature -Online -FeatureName Web-Mgmt-Console
```

## Paso 1: Instalar PHP en Windows

### Descargar e Instalar PHP
1. Descargar PHP 8.x desde https://windows.php.net/download/
2. Extraer en `C:\php`
3. Renombrar `php.ini-development` a `php.ini`

### Configurar php.ini
Editar `C:\php\php.ini` y habilitar:
```ini
extension_dir = "ext"
extension=sqlsrv
extension=pdo_sqlsrv
extension=mysqli
extension=pdo_mysql
extension=curl
extension=fileinfo
extension=mbstring
extension=openssl

; Configuración de seguridad
expose_php = Off
display_errors = Off
log_errors = On
error_log = "C:\php\logs\php_errors.log"
upload_max_filesize = 50M
post_max_size = 50M
max_execution_time = 300
memory_limit = 256M
```

### Configurar IIS para PHP
1. Abrir **Internet Information Services (IIS) Manager**
2. Seleccionar el servidor en el árbol izquierdo
3. En **Handler Mappings**, hacer clic en "Add Module Mapping"
4. Configurar:
   - **Request path**: `*.php`
   - **Module**: `FastCgiModule`
   - **Executable**: `C:\php\php-cgi.exe`
   - **Name**: `PHP_via_FastCGI`
5. Clic en "Request Restrictions" y desmarcar "Invoke handler only if request is mapped to"
6. Clic en OK para guardar

## Paso 2: Instalar Microsoft Drivers for PHP for SQL Server

### Descargar Drivers
1. Descargar desde: https://learn.microsoft.com/en-us/sql/connect/php/download-drivers-php-sql-server
2. Para PHP 8.x, descargar la versión compatible (8.0, 8.1, 8.2)
3. Extrair el contenido en `C:\php\ext`

### Verificar Instalación
```powershell
# Crear archivo de prueba
echo "<?php phpinfo(); ?>" > C:\inetpub\wwwroot\test.php

# Acceder a http://localhost/test.php
# Verificar que sqlsrv y pdo_sqlsrv estén cargados
```

## Paso 3: Configurar Base de Datos SQL Server

### Crear Base de Datos
1. Abrir **SQL Server Management Studio (SSMS)**
2. Conectarse al servidor SQL Server
3. Ejecutar el script `db_iis_php_setup\database.sql`
4. Verificar que todas las tablas se crearon correctamente

### Crear Usuario de Base de Datos (Recomendado)
```sql
-- No usar 'sa' en producción
CREATE LOGIN helpdesk_user WITH PASSWORD = 'TuContraseñaSegura123!';
USE MonosyncERP;
CREATE USER helpdesk_user FOR LOGIN helpdesk_user;
ALTER ROLE db_datareader ADD MEMBER helpdesk_user;
ALTER ROLE db_datawriter ADD MEMBER helpdesk_user;
```

### Configurar Acceso Remoto (si es necesario)
1. Abrir **SQL Server Configuration Manager**
2. Ir a **SQL Server Network Configuration** → **Protocols for SQLEXPRESS2022**
3. Habilitar **TCP/IP**
4. Reiniciar el servicio SQL Server
5. Configurar firewall para permitir puerto 1433

## Paso 4: Configurar Archivos del Proyecto

### Configurar db_config.php
Editar `db_iis_php_setup\db_config.php`:
```php
// Opción 1: Usar valores directos (desarrollo)
if (!$serverName) $serverName = "DESKTOP-PG8TI45\\SQL2022";
if (!$database) $database = "MonosyncERP";
if (!$uid) $uid = "sa"; // O el usuario creado en paso 3
if (!$pwd) $pwd = "123"; // O la contraseña segura
```

### O Usar Variables de Entorno (Producción)
```powershell
# Configurar variables de entorno del sistema
setx DB_SERVER "DESKTOP-PG8TI45\SQL2022" /M
setx DB_NAME "MonosyncERP" /M
setx DB_USER "helpdesk_user" /M
setx DB_PASSWORD "TuContraseñaSegura123!" /M
```

## Paso 5: Build del Frontend (React)

### Instalar Dependencias
```powershell
cd d:\Platzi\HelpDesk2
npm install
```

### Build para Producción
```powershell
npm run build
```

Esto generará los archivos en la carpeta `dist/`

## Paso 6: Configurar Sitio en IIS

### Crear Sitio Web
1. Abrir **IIS Manager**
2. Clic derecho en **Sites** → **Add Website**
3. Configurar:
   - **Site name**: `HelpDeskERP`
   - **Physical path**: `d:\Platzi\HelpDesk2\dist`
   - **Binding**: HTTP, Port 80 (o el puerto deseado)
   - **Host name**: (opcional) tu dominio
4. Clic en OK

### Configurar web.config
El archivo `dist\web.config` ya está configurado, pero verificar:
- El path de PHP debe coincidir con tu instalación: `C:\Program Files\php\php-cgi.exe`
- Si PHP está en otro lugar, actualizar la línea:
  ```xml
  <add name="PHP_via_FastCGI" path="*.php" verb="*" modules="FastCgiModule" 
       scriptProcessor="C:\php\php-cgi.exe" resourceType="File" requireAccess="Script" />
  ```

### Copiar api_tickets.php a dist
```powershell
copy "d:\Platzi\HelpDesk2\public\api_tickets.php" "d:\Platzi\HelpDesk2\dist\api_tickets.php"
copy "d:\Platzi\HelpDesk2\db_iis_php_setup\db_config.php" "d:\Platzi\HelpDesk2\dist\db_config.php"
```

### Configurar Permisos
```powershell
# Dar permisos a IUSR y IIS_IUSRS
icacls "d:\Platzi\HelpDesk2\dist" /grant "IUSR:(OI)(CI)F"
icacls "d:\Platzi\HelpDesk2\dist" /grant "IIS_IUSRS:(OI)(CI)F"
```

## Paso 7: Configurar Application Pool

### Crear Application Pool
1. En IIS Manager, ir a **Application Pools**
2. Clic derecho → **Add Application Pool**
3. Configurar:
   - **Name**: `HelpDeskERPPool`
   - **.NET CLR version**: `No Managed Code`
   - **Managed pipeline mode**: `Integrated`
4. Clic en OK

### Asignar Pool al Sitio
1. Clic derecho en el sitio **HelpDeskERP** → **Manage Website** → **Advanced Settings**
2. En **Application Pool**, seleccionar `HelpDeskERPPool`
3. Clic en OK

## Capacidad, seguridad y pruebas de carga

- En producción, publique el frontend y `api_tickets.php` bajo el mismo origen HTTPS. La API usa una cookie de sesión `HttpOnly` y `SameSite=Strict`; no configure una URL de API en otro dominio sin implementar CORS con credenciales y una lista explícita de orígenes permitidos.
- Mantenga `display_errors = Off` en PHP. El API no habilita CORS global y `web.config` bloquea el acceso HTTP al directorio `erp_cache` y a los archivos de configuración.
- No configure FastCGI con 500 procesos por defecto. Ajuste `maxInstances`, la cola del Application Pool y los límites de SQL Server según memoria, CPU, conexiones disponibles y consumo medido por proceso PHP.
- La caché de `sync_light` evita conexiones SQL para lecturas calientes y agrupa las cargas simultáneas tras una caché fría. Las operaciones de escritura y autenticación siguen requiriendo conexiones a SQL Server.
- Desactive `AUTO_CLOSE` una vez durante la instalación, desde SQL Server y con permisos administrativos: `ALTER DATABASE [MonosyncERP] SET AUTO_CLOSE OFF;`. No lo haga desde cada petición de la aplicación.
- Antes de anunciar soporte para 500 usuarios simultáneos, ejecute una prueba con 500 usuarios virtuales y un patrón realista de acceso, lectura y escritura. Mida latencia p95/p99, errores HTTP, cola de IIS, memoria de FastCGI y conexiones/esperas de SQL Server; ajuste la configuración y repita la prueba.
- Mantenga HTTPS obligatorio en el binding de IIS y compruebe que el certificado sea válido antes de poner el sistema a disposición de usuarios externos.

## Paso 8: Probar la Instalación

### Probar PHP
1. Crear archivo `d:\Platzi\HelpDesk2\dist\test.php`:
   ```php
   <?php
   phpinfo();
   ?>
   ```
2. Acceder a `http://localhost/test.php`
3. Verificar que PHP funciona y SQLSRV está cargado

### Probar Conexión a Base de Datos
1. Crear archivo `d:\Platzi\HelpDesk2\dist\test_db.php`:
   ```php
   <?php
   $dbConfig = require_once 'db_config.php';
   $conn = sqlsrv_connect($dbConfig['serverName'], $dbConfig['connectionInfo']);
   if ($conn) {
       echo "Conexión exitosa a SQL Server";
       sqlsrv_close($conn);
   } else {
       echo "Error de conexión: " . print_r(sqlsrv_errors(), true);
   }
   ?>
   ```
2. Acceder a `http://localhost/test_db.php`

### Probar API
```powershell
# Probar endpoint de listado de tickets
curl "http://localhost/api_tickets.php?action=list"

# Probar endpoint de autenticación
curl -X POST "http://localhost/api_tickets.php?action=authenticate" `
  -H "Content-Type: application/json" `
  -d '{"correo":"tu@email.com","contrasena":"tu_password"}'
```

### Probar Frontend
1. Acceder a `http://localhost` (o el puerto configurado)
2. Verificar que la aplicación React carga correctamente
3. Intentar iniciar sesión con un usuario de la base de datos

## Paso 9: Configurar SSL/HTTPS (Producción)

### Instalar Certificado SSL
1. En IIS Manager, seleccionar el servidor
2. Ir a **Server Certificates**
3. Clic en **Create Self-Signed Certificate** (desarrollo) o importar certificado comercial
4. Clic en **Bindings** del sitio
5. Agregar binding HTTPS con el certificado

### Forzar HTTPS
Agregar al `web.config`:
```xml
<rewrite>
  <rules>
    <rule name="HTTP to HTTPS redirect" stopProcessing="true">
      <match url="(.*)" />
      <conditions>
        <add input="{HTTPS}" pattern="off" ignoreCase="true" />
      </conditions>
      <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
    </rule>
  </rules>
</rewrite>
```

## Paso 10: Configurar Firewall

### Abrir Puertos Necesarios
```powershell
# Puerto HTTP (80)
New-NetFirewallRule -DisplayName "IIS HTTP" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow

# Puerto HTTPS (443)
New-NetFirewallRule -DisplayName "IIS HTTPS" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow

# Puerto SQL Server (1433) - solo si es necesario acceso remoto
New-NetFirewallRule -DisplayName "SQL Server" -Direction Inbound -LocalPort 1433 -Protocol TCP -Action Allow
```

## Solución de Problemas Comunes

### Error 500 - Internal Server Error
1. Verificar logs de IIS: `C:\inetpub\logs\LogFiles`
2. Verificar logs de PHP: `C:\php\logs\php_errors.log`
3. Habilitar errores detallados en `php.ini` temporalmente:
   ```ini
   display_errors = On
   ```

### Error de Conexión SQL Server
1. Verificar que SQL Server está ejecutándose
2. Verificar que el servicio SQL Server Browser está iniciado
3. Verificar que TCP/IP está habilitado en SQL Server Configuration Manager
4. Verificar firewall permite puerto 1433
5. Probar conexión con SSMS

### PHP no se ejecuta
1. Verificar que Handler Mapping está configurado correctamente
2. Verificar que `php-cgi.exe` tiene permisos de ejecución
3. Verificar que la ruta en web.config es correcta
4. Reiniciar IIS: `iisreset`

### CORS Errors
1. Verificar que el frontend y API están en el mismo dominio
2. Si están en dominios diferentes, configurar CORS en `api_tickets.php`:
   ```php
   header("Access-Control-Allow-Origin: https://tu-dominio.com");
   ```

### Archivos estáticos no cargan
1. Verificar que MIME types están configurados en web.config
2. Verificar permisos en la carpeta `dist/assets`
3. Limpiar caché del navegador

## Mantenimiento

### Backup de Base de Datos
```sql
-- Script de backup
BACKUP DATABASE MonosyncERP 
TO DISK = 'C:\Backups\MonosyncERP_' + CONVERT(VARCHAR, GETDATE(), 112) + '.bak'
WITH FORMAT, COMPRESSION;
```

### Logs de Auditoría
Revisar regularmente la tabla `acceso_auditoria` para detectar actividad sospechosa.

### Actualizaciones
1. Mantener PHP actualizado
2. Mantener SQL Server actualizado
3. Actualizar drivers SQLSRV cuando se actualice PHP
4. Rebuild del frontend cuando haya cambios

## Estructura de Archivos Final

```
d:\Platzi\HelpDesk2\
├── dist/                          # Archivos para IIS
│   ├── api_tickets.php           # API PHP
│   ├── db_config.php            # Configuración BD
│   ├── index.html                # Entry point React
│   ├── assets/                   # Archivos estáticos compilados
│   └── web.config                # Configuración IIS
├── db_iis_php_setup/
│   ├── database.sql              # Script de base de datos
│   └── db_config.php             # Configuración BD (fuente)
├── public/
│   ├── api_tickets.php           # API PHP (copia de trabajo)
│   └── web.config                # Configuración IIS (copia)
└── src/                          # Código fuente React
```

## Checklist de Implementación

- [ ] IIS instalado y configurado
- [ ] PHP 8.x instalado y configurado
- [ ] Drivers SQLSRV instalados
- [ ] Base de datos MonosyncERP creada
- [ ] Usuario de base de datos creado
- [ ] db_config.php configurado
- [ ] Frontend compilado (npm run build)
- [ ] api_tickets.php copiado a dist
- [ ] web.config configurado
- [ ] Application pool creado
- [ ] Sitio web creado en IIS
- [ ] Permisos de carpetas configurados
- [ ] Conexión a base de datos probada
- [ ] API probada
- [ ] Frontend probado
- [ ] SSL configurado (producción)
- [ ] Firewall configurado
- [ ] Logs monitoreados

## Contacto y Soporte

Para problemas técnicos:
1. Revisar logs de IIS y PHP
2. Verificar configuración de web.config
3. Probar conexión a base de datos independientemente
4. Revisar documentación de Microsoft IIS y PHP
