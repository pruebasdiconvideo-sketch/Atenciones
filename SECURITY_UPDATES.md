# Security Updates and Configuration Guide

## Overview
This document outlines the security improvements made to the HelpDesk ERP system to ensure secure authentication, data integrity, and protection of sensitive credentials.

## Security Changes Implemented

### 1. Database Configuration Security

#### Created Secure Configuration File
- **File**: `db_iis_php_setup/db_config.php`
- **Purpose**: Centralized database credential management
- **Features**:
  - Supports environment variables (recommended for production)
  - Fallback to protected JSON configuration file
  - No hardcoded credentials in source code
  - Supports both development and production environments

#### Updated PHP API Files
- **Files Modified**:
  - `public/api_tickets.php`
  - `db_iis_php_setup/api_tickets.php`
- **Changes**:
  - Removed hardcoded database credentials
  - Now loads configuration from `db_config.php`
  - Secure connection handling with SQLSRV driver

### 2. Secure User Authentication

#### New Authentication Endpoint
- **Endpoint**: `?action=authenticate`
- **Method**: POST
- **Features**:
  - SHA-256 password hashing
  - Database-only user validation (no mock data)
  - Active user status verification
  - Account blocking after failed attempts
  - Role-based access control
  - Audit logging of all access attempts
  - Automatic password upgrade from plain text to hash
  - IP address tracking for security auditing

#### Authentication Flow
1. User submits email and password
2. Password is hashed using SHA-256
3. Database query checks for active user with matching email
4. Password verification (supports both plain text migration and hash)
5. Failed attempts are logged to `acceso_auditoria` table
6. Account blocked after 3 failed attempts within 30 minutes
7. Successful login updates `ultimo_acceso` timestamp
8. Returns user data without password

#### Updated Login Component
- **File**: `src/components/Login.tsx`
- **Changes**:
  - Removed mock database authentication
  - Now calls PHP authentication API
  - Handles authentication errors properly
  - Respects role restrictions (blocks client contacts)
  - Maintains "remember me" functionality

### 3. Ticket Traceability with Complete Company Data

#### New Traceability Endpoint
- **Endpoint**: `?action=get_ticket_traceability&id_ticket={id}`
- **Method**: GET
- **Features**:
  - Fetches complete ticket information
  - Includes full company data (RUC, address, phone, email)
  - Includes business sector (rubro) information
  - Includes company group details
  - Includes geographic division data
  - Includes branch (sucursal) information
  - Includes contact person details
  - Includes technician assignment
  - Returns state history (ticket_historial_estado)
  - Returns attention records (atencion)

#### SQL Query Enhancements
The traceability query now joins:
- `ticket` → `empresa` (company)
- `empresa` → `rubro` (business sector)
- `empresa` → `grupo_empresarial` (company group)
- `empresa` → `ubicacion` (location)
- `ubicacion` → `division_geografica` (geographic division)
- `ticket` → `empresa_sucursal` (branch)
- `ticket` → `empresa_contacto` (company contact)
- `empresa_contacto` → `persona` (contact person)
- `ticket` → `persona` (assigned technician)

#### Updated TicketManager Component
- **File**: `src/components/TicketManager.tsx`
- **Changes**:
  - Added `fetchTicketTraceability` function
  - Automatically fetches traceability when viewing a ticket
  - Stores complete company data in `ticketTraceability` state
  - Enables display of full company information in ticket details

### 4. Removal of Hardcoded Credentials

#### Frontend Changes
- **File**: `src/db/mockDb.ts`
  - Removed default passwords (admin123, supervisor123, tecnico123, cliente123)
  - Passwords now must be set in database via secure authentication

- **File**: `src/App.tsx`
  - Removed hardcoded admin PIN (admin123)
  - Added placeholder for proper authentication implementation
  - Updated placeholder text to contact administrator

### 5. Git Security

#### Updated .gitignore
- Added protection for sensitive configuration files:
  - `db_iis_php_setup/.db_config.json`
  - `db_iis_php_setup/db_config.php.local`
  - `*.db_config.json`

## Configuration Instructions

### Development Setup

1. **Create local database configuration** (optional):
   ```bash
   # Create db_iis_php_setup/.db_config.json
   {
     "serverName": "YOUR_SERVER\\SQLEXPRESS2022",
     "Database": "MonosyncERP",
     "UID": "sa",
     "PWD": "your_password"
   }
   ```

2. **Or use environment variables** (recommended):
   ```bash
   export DB_SERVER="YOUR_SERVER\\SQLEXPRESS2022"
   export DB_NAME="MonosyncERP"
   export DB_USER="sa"
   export DB_PASSWORD="your_password"
   ```

3. **Or edit db_config.php directly** (for development only):
   ```php
   // Edit db_iis_php_setup/db_config.php
   $serverName = "YOUR_SERVER\\SQLEXPRESS2022";
   $database = "MonosyncERP";
   $uid = "sa";
   $pwd = "your_password";
   ```

### Production Setup

1. **Use environment variables exclusively**:
   - Set environment variables in your web server configuration
   - Do not commit any configuration files with credentials

2. **Protect configuration files**:
   - Ensure `db_config.php` is outside web root if possible
   - Set proper file permissions (read-only for web server user)
   - Use IIS/Server security to restrict access

3. **Database User Security**:
   - Create a dedicated database user with limited permissions
   - Do not use 'sa' account in production
   - Grant only necessary permissions (SELECT, INSERT, UPDATE, DELETE)

## User Management

### Creating Users

Users must be created directly in the database `persona` table with:
- `contrasena`: SHA-256 hashed password
- `estado`: 1 (active)
- `bloqueado`: 0 (not blocked)
- Role assignment via `persona_rol_asignacion` table

### Password Hashing

Use SHA-256 for password hashing:
```php
$hashedPassword = hash('sha256', $plainPassword);
```

Or use the authentication endpoint which automatically upgrades plain text passwords to hashes on first login.

## Database Schema Requirements

Ensure the following tables exist and are properly configured:

### Required Tables
- `persona` - User accounts
- `persona_rol` - Role definitions
- `persona_rol_asignacion` - User-role assignments
- `acceso_auditoria` - Access audit log
- `empresa` - Company information
- `empresa_sucursal` - Company branches
- `empresa_contacto` - Company contacts
- `ubicacion` - Location data
- `division_geografica` - Geographic divisions
- `rubro` - Business sectors
- `grupo_empresarial` - Company groups
- `ticket` - Support tickets
- `ticket_historial_estado` - Ticket state history
- `atencion` - Technical attentions

## Security Best Practices

1. **Never commit credentials** to version control
2. **Use strong passwords** for all database and user accounts
3. **Enable SSL/TLS** for all API communications
4. **Regularly update** PHP and SQL Server
5. **Monitor access logs** in `acceso_auditoria` table
6. **Implement rate limiting** on authentication endpoints
7. **Use prepared statements** (already implemented in PHP API)
8. **Validate all input** on both client and server
9. **Keep backups** of database and configuration
10. **Review user permissions** regularly

## Testing

### Test Authentication
```bash
curl -X POST http://your-server/api_tickets.php \
  -H "Content-Type: application/json" \
  -d '{"action":"authenticate","correo":"user@example.com","contrasena":"password"}'
```

### Test Ticket Traceability
```bash
curl "http://your-server/api_tickets.php?action=get_ticket_traceability&id_ticket=1"
```

## Troubleshooting

### Authentication Fails
- Check database connection in `db_config.php`
- Verify user exists in `persona` table
- Ensure user `estado` = 1 (active)
- Check if user is `bloqueado` = 1 (blocked)
- Verify password is correctly hashed in database

### Traceability Returns No Data
- Verify ticket ID exists
- Check foreign key relationships between tables
- Ensure all joins have matching records
- Review SQL Server error logs

### Database Connection Errors
- Verify SQL Server is running
- Check SQLSRV driver is installed in PHP
- Test connection with SQL Server Management Studio
- Verify firewall allows connection to SQL Server port (1433)

## Migration Notes

### Existing Plain Text Passwords
The authentication endpoint automatically upgrades plain text passwords to SHA-256 hashes on successful login. No manual migration required.

### Mock Data Removal
Frontend mock database (`mockDb.ts`) no longer contains default passwords. All user authentication now goes through the PHP API and SQL Server database.

## Support

For issues or questions about security configuration:
1. Review this documentation
2. Check SQL Server error logs
3. Check PHP error logs
4. Verify database schema matches requirements
5. Test API endpoints with curl or Postman
