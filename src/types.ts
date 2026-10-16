/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// 1. PAÍS
export interface Pais {
  id_pais: number;
  nombre: string;
  codigo_iso: string; // nVARCHAR(3) UNIQUE
}

// 2. TIPO_DIVISION
export interface TipoDivision {
  id_tipo_division: number;
  nombre: string; // nVARCHAR(50) NOT NULL, UNIQUE (e.g., Departamento, Provincia, Distrito)
}

// 3. PAIS_TIPO_DIVISION
export interface PaisTipoDivision {
  id_pais: number;
  id_tipo_division: number;
  orden: number; // TINYINT, CHECK(orden >= 1)
}

// 4. DIVISION_GEOGRAFICA
export interface DivisionGeografica {
  id_division: number;
  nombre: string; // nVARCHAR(100) NOT NULL
  id_tipo_division: number; // FK -> TIPO_DIVISION
  id_division_padre: number | null; // FK -> DIVISION_GEOGRAFICA
}

// 5. UBICACION
export interface Ubicacion {
  id_ubicacion: number;
  direccion: string; // nVARCHAR(255) NOT NULL
  referencia: string | null; // nVARCHAR(255)
  id_division: number; // FK -> DIVISION_GEOGRAFICA (distrito / división más específica)
}

// 6. RUBRO
export interface Rubro {
  id_rubro: number;
  nombre: string; // nVARCHAR(100) NOT NULL, UNIQUE
}

// 7. GRUPO_EMPRESARIAL
export interface GrupoEmpresarial {
  id_grupo: number;
  nombre: string; // nVARCHAR(100) NOT NULL, UNIQUE
  descripcion: string | null; // TEXT
}

// 8. EMPRESA
export interface Empresa {
  id_empresa: number;
  ruc: string; // nVARCHAR(20) NOT NULL, UNIQUE
  razon_social: string; // nVARCHAR(255) NOT NULL
  nombre_comercial: string | null; // nVARCHAR(255)
  telefono: string | null; // nVARCHAR(20)
  correo: string; // nVARCHAR(100) NOT NULL, UNIQUE
  id_rubro: number; // FK -> RUBRO
  id_grupo: number | null; // FK -> GRUPO_EMPRESARIAL
  id_ubicacion: number; // FK -> UBICACION
  estado?: boolean; // true = activa, false = inactive
}

// 9. EMPRESA_SUCURSAL
export interface EmpresaSucursal {
  id_sucursal: number;
  id_empresa: number; // FK -> EMPRESA
  nombre: string; // nVARCHAR(100) NOT NULL
  id_ubicacion: number; // FK -> UBICACION
  telefono: string | null; // nVARCHAR(20)
  es_principal: boolean; // Not null, default false
}

// 10. PERSONA
export interface Persona {
  id_persona: number;
  tipo_documento: string; // nVARCHAR(10) NOT NULL (e.g. DNI, CE, RUC)
  numero_documento: string; // nVARCHAR(20) NOT NULL, UNIQUE
  nombres: string; // nVARCHAR(100) NOT NULL
  apellido_paterno: string; // nVARCHAR(100) NOT NULL
  apellido_materno: string | null; // nVARCHAR(100)
  fecha_nacimiento: string | null; // DATE
  telefono: string | null; // nVARCHAR(20)
  correo: string; // nVARCHAR(100) NOT NULL, UNIQUE (acts as user login)
  direccion: string | null; // nVARCHAR(255)
  sexo: "M" | "F" | null; // CHECK Sexo IN (M, F)
  estado: boolean; // default true (Activo / Inactivo)
  contrasena?: string; // Contraseña de ingreso al sistema ERP
  bloqueado?: boolean; // Bloqueado por múltiples intentos fallidos
  id_empresa?: number; // Empresa asignada
  id_sucursal?: number | null; // Sucursal asignada (opcional)
}

// 11. PERSONA_ROL
export interface PersonaRol {
  id_rol: number;
  nombre: string; // nVARCHAR(50) NOT NULL, UNIQUE (e.g. Administrador, Supervisor, Técnico, Cliente)
  descripcion: string | null; // nVARCHAR(255)
}

// 12. PERSONA_ROL_ASIGNACION
export interface PersonaRolAsignacion {
  id_persona: number; // FK -> PERSONA, PK
  id_role_asignado: number; // FK -> PERSONA_ROL
  fecha_asignacion: string; // DATETIME, default NOW()
  asignado_por: number | null; // FK -> PERSONA
}

// 13. EMPRESA_CONTACTO
export interface EmpresaContacto {
  id_empresa_contacto: number;
  id_empresa: number; // FK -> EMPRESA
  id_sucursal: number | null; // FK -> EMPRESA_SUCURSAL (associated to a branch/sucursal)
  id_persona: number; // FK -> PERSONA
  cargo: string | null; // nVARCHAR(100)
  telefono_empresa: string | null; // nVARCHAR(20)
  correo_empresa: string | null; // nVARCHAR(100)
  es_principal: boolean; // default false
  estado: boolean; // default true
}

export interface MotivoContacto {
  id_motivo: number;
  nombre: string;
  descripcion?: string | null;
  activo?: boolean;
  orden?: number;
}

// 14. TICKET
export type TicketPrioridad = "BAJA" | "MEDIA" | "ALTA" | "CRITICA";
export type TicketEstado = "PENDIENTE" | "EN_ATENCION" | "RESUELTO" | "CERRADO" | "REABIERTO" | "ANULADO";
export type TicketMedioContacto = "EMAIL" | "TELEFONO" | "CHAT" | "PRESENCIAL" | "SISTEMA";

export interface Ticket {
  id_ticket: number;
  nro_ticket: string; // YEAR-CORRELATIVO e.g., 2026-0001
  fecha_registro: string; // DATE
  hora_registro: string; // TIME
  fecha_cierre: string | null; // DATE
  hora_cierre: string | null; // TIME
  id_usuario: number; // FK -> PERSONA (Técnico o Administrador creador/asignado)
  id_empresa_contacto: number; // FK -> EMPRESA_CONTACTO
  id_empresa: number; // FK -> EMPRESA
  id_sucursal: number | null; // FK -> EMPRESA_SUCURSAL
  detalle_reporte: string; // TEXT NOT NULL
  prioridad: TicketPrioridad; // ENUM
  estado: TicketEstado; // ENUM
  medio_contacto: TicketMedioContacto; // Communication channel
  id_motivo_contacto?: number | null; // FK -> MOTIVO_CONTACTO (optional)
  motivo_nombre?: string; // optional descriptive motive name from traceability responses
}

// 15. TICKET_HISTORIAL_ESTADO
export interface TicketHistorialEstado {
  id_historial: number;
  id_ticket: number; // FK -> TICKET
  estado_anterior: TicketEstado;
  estado_nuevo: TicketEstado;
  id_usuario: number; // FK -> PERSONA (quien cambió el estado)
  motivo: string; // nVARCHAR(255) NOT NULL
  fecha_cambio: string; // DATETIME, default NOW()
}

// 16. ATENCION
export type AtencionEstado = "EN_PROCESO" | "PAUSADO" | "COMPLETADO";

export interface Atencion {
  id_atencion: number;
  id_ticket: number; // FK -> TICKET
  id_usuario: number; // FK -> PERSONA (técnico asignado)
  fecha_inicio: string; // DATE
  hora_inicio: string; // TIME
  fecha_fin: string | null; // DATE
  hora_fin: string | null; // TIME
  detalle_atencion: string | null; // TEXT
  solucion_aplicada: string | null; // TEXT
  estado: AtencionEstado;
}

// 17. ATENCION_TIEMPO
export interface AtencionTiempo {
  id_atencion: number; // PK, FK -> ATENCION
  duracion_minutos: number;
  duracion_horas: number;
  duracion_formato: string; // e.g. "2h 30m"
}

// 18. ARCHIVOS / EVIDENCIAS
export interface Archivo {
  id_archivo: number;
  nombre_original: string; // e.g., "evidencia1.png"
  nombre_sistema: string; // e.g., UUID-based
  ruta: string;
  tipo_mime: string;
  extension: string;
  tamano_bytes: number;
  tamano_formato: string; // e.g. "2.5 MB"
  checksum: string; // SHA-256 hash
  id_usuario_subio: number; // FK -> PERSONA
  fecha_subida: string; // DATETIME
  estado: boolean; // default true
  base64Content?: string; // Stored file data
}

// 19. TICKET_ARCHIVO
export type TicketArchivoTipo = "REPORTE_INICIAL" | "EVIDENCIA_ADICIONAL";

export interface TicketArchivo {
  id_ticket_archivo: number;
  id_ticket: number; // FK -> TICKET
  id_archivo: number; // FK -> ARCHIVO
  tipo_evidencia: TicketArchivoTipo;
}

// 20. ATENCION_ARCHIVO
export type AtencionArchivoTipo = "EVIDENCIA_TRABAJO" | "DOCUMENTO_ENTREGADO" | "FOTO_FINAL";

export interface AtencionArchivo {
  id_atencion_archivo: number;
  id_atencion: number; // FK -> ATENCION
  id_archivo: number; // FK -> ARCHIVO
  tipo_evidencia: AtencionArchivoTipo;
}

// AUDITORÍA DE ACCESOS (para registrar auditoría de login y bloqueos)
export interface AccesoAuditoria {
  id_acceso: number;
  correo: string;
  fecha_hora: string;
  ip_address: string;
  estado: "EXITOSO" | "FALLIDO" | "BLOQUEADO";
  intentos_previos: number;
}

// AUDITORÍA DE OPERACIONES ADMINISTRATIVAS (CRUD de empresas, sucursales y directorios geográficos)
export interface AuditoriaOperacion {
  id_auditoria: number;
  usuario: string; // Correo de la persona autenticada
  fecha_hora: string; // DATETIME
  modulo: string; // "EMPRESAS", "SUCURSALES", "GEOGRAFICO", "DIRECTORIOS"
  operacion: "CREACION" | "MODIFICACION" | "ELIMINACION";
  detalles: string; // Información del cambio con detalles del antes/después
}

export interface SystemConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpSecurity: "SSL" | "TLS" | "NONE";
  smtpSender?: string;
  notificationTemplates: {
    id: string;
    titulo: string;
    asunto: string;
    cuerpo: string;
  }[];
  ticketStates: {
    id: string;
    nombre: string;
    activo: boolean;
    color: string;
    es_inicial: boolean;
  }[];
  documentTypes: {
    id: string;
    nombre: string;
    activo: boolean;
    longitud_requerida: number;
  }[];
  security: {
    intentosMaximos: number;
    tiempoBloqueoSegundos: number;
    inactividadMinutos: number;
    vencimientoContrasenaDias: number;
    dobleFactorOpcional: boolean;
  };
  auditConfig: {
    logEmpresas: boolean;
    logSucursales: boolean;
    logTickets: boolean;
    logUsuarios: boolean;
    logGeografico: boolean;
  };
  rolePermissions?: {
    [roleId: number]: {
      [moduleName: string]: {
        ver: boolean;
        registrar: boolean;
        modificar: boolean;
        eliminar: boolean;
        aprobar: boolean;
        exportar: boolean;
        imprimir: boolean;
      };
    };
  };
}


