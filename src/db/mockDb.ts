/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Pais,
  TipoDivision,
  DivisionGeografica,
  Ubicacion,
  Rubro,
  GrupoEmpresarial,
  Empresa,
  EmpresaSucursal,
  Persona,
  PersonaRol,
  EmpresaContacto,
  Ticket,
  TicketHistorialEstado,
  Atencion,
  AtencionTiempo,
  Archivo,
  TicketArchivo,
  AtencionArchivo,
  AccesoAuditoria,
  AuditoriaOperacion,
  TicketPrioridad,
  TicketEstado,
  AtencionEstado,
  SystemConfig,
  MotivoContacto
} from "../types";

// FIX v2.40 — Tipo BajaRegistro para listar bajas lógicas en la pestaña BAJAS.
export interface BajaRegistro {
  id_baja?: number;
  id?: number; // compatibility con estado local del frontend
  tipo_entidad?: string;
  tipo?: string; // compatibility con estado local del frontend (EMPRESAS, SUCURSALES, CONTACTOS)
  id_entidad: number;
  nombre?: string; // Solo en estado local, no viene de la BD
  id_usuario?: number | null;
  motivo: string;
  fecha_baja?: string;
  fecha?: string; // compatibility con estado local del frontend
  ip_address?: string;
  usuario?: string; // Solo en estado local
}

// Database structure interface
export interface MockDatabase {
  paises: Pais[];
  tiposDivision: TipoDivision[];
  divisionesGeograficas: DivisionGeografica[];
  ubicaciones: Ubicacion[];
  rubros: Rubro[];
  gruposEmpresariales: GrupoEmpresarial[];
  empresas: Empresa[];
  sucursales: EmpresaSucursal[];
  personas: Persona[];
  roles: PersonaRol[];
  asignacionesRoles: { id_persona: number; id_rol: number; fecha_asignacion: string; asignado_por: number | null }[];
  contactosEmpresariales: EmpresaContacto[];
  motivosContacto?: MotivoContacto[];
  tickets: Ticket[];
  historialEstados: TicketHistorialEstado[];
  atenciones: Atencion[];
  atencionesTiempo: AtencionTiempo[];
  archivos: Archivo[];
  ticketArchivos: TicketArchivo[];
  atencionArchivos: AtencionArchivo[];
  auditoriaAccesos: AccesoAuditoria[];
  auditoriaOperaciones?: AuditoriaOperacion[];
  // FIX v2.40 — Lista de bajas lógicas (para pestaña BAJAS en CompanyManager).
  bajasRegistradas?: BajaRegistro[];
  systemConfig?: SystemConfig;
}

const STORAGE_KEY = "SOPORTE_TICKETS_DB";

// Initial seed data
const SEED_PAISES: Pais[] = [
  { id_pais: 1, nombre: "Perú", codigo_iso: "PER" },
  { id_pais: 2, nombre: "Colombia", codigo_iso: "COL" },
  { id_pais: 3, nombre: "Chile", codigo_iso: "CHL" }
];

const SEED_TIPOS_DIVISION: TipoDivision[] = [
  { id_tipo_division: 1, nombre: "Departamento / Región" },
  { id_tipo_division: 2, nombre: "Provincia" },
  { id_tipo_division: 3, nombre: "Distrito / Municipio" }
];

const SEED_DIVISIONES: DivisionGeografica[] = [
  // Perú
  { id_division: 1, nombre: "Lima", id_tipo_division: 1, id_division_padre: null },
  { id_division: 2, nombre: "Lima Metropolitana", id_tipo_division: 2, id_division_padre: 1 },
  { id_division: 3, nombre: "Miraflores", id_tipo_division: 3, id_division_padre: 2 },
  { id_division: 4, nombre: "San Isidro", id_tipo_division: 3, id_division_padre: 2 },
  { id_division: 5, nombre: "Santiago de Surco", id_tipo_division: 3, id_division_padre: 2 },
  
  { id_division: 6, nombre: "Arequipa", id_tipo_division: 1, id_division_padre: null },
  { id_division: 7, nombre: "Arequipa", id_tipo_division: 2, id_division_padre: 6 },
  { id_division: 8, nombre: "Yanahuara", id_tipo_division: 3, id_division_padre: 7 },

  // Colombia
  { id_division: 9, nombre: "Cundinamarca", id_tipo_division: 1, id_division_padre: null },
  { id_division: 10, nombre: "Bogotá D.C.", id_tipo_division: 2, id_division_padre: 9 },
  { id_division: 11, nombre: "Usaquén", id_tipo_division: 3, id_division_padre: 10 },
  { id_division: 12, nombre: "Chapinero", id_tipo_division: 3, id_division_padre: 10 }
];

const SEED_UBICACIONES: Ubicacion[] = [
  { id_ubicacion: 1, direccion: "Av. Alfredo Benavides 1050", referencia: "Cerca al Parque Reducto", id_division: 3 }, // Miraflores
  { id_ubicacion: 2, direccion: "Camino Real 390, Of. 401", referencia: "Torre Real", id_division: 4 }, // San Isidro
  { id_ubicacion: 3, direccion: "Javier Prado Este 4510", referencia: "Frente al Jockey Plaza", id_division: 5 }, // Surco
  { id_ubicacion: 4, direccion: "Av. Ejercito 312, Selva Alegre", referencia: "A una cuadra de la plaza", id_division: 8 }, // Yanahuara
  { id_ubicacion: 5, direccion: "Calle 100 #15-30", referencia: "Frente al Parque de la 93", id_division: 11 }, // Usaquén
  { id_ubicacion: 6, direccion: "Cra 13 #52-45", referencia: "Cerca de la Universidad Javeriana", id_division: 12 } // Chapinero
];

const SEED_RUBROS: Rubro[] = [
  { id_rubro: 1, nombre: "Tecnología y Software" },
  { id_rubro: 2, nombre: "Banca y Finanzas" },
  { id_rubro: 3, nombre: "Retail y Comercio" },
  { id_rubro: 4, nombre: "Salud e Insumos Médicos" },
  { id_rubro: 5, nombre: "Minería y Energía" }
];

const SEED_MOTIVOS_CONTACTO: MotivoContacto[] = [
  {
    id_motivo: 1,
    nombre: "Incidencia de sistema",
    descripcion: "Problema técnico detectado en el sistema.",
    activo: true,
    orden: 1
  },
  {
    id_motivo: 2,
    nombre: "Solicitud de servicio",
    descripcion: "Solicitud de intervención técnica o mantenimiento.",
    activo: true,
    orden: 2
  },
  {
    id_motivo: 3,
    nombre: "Consulta operativa",
    descripcion: "Consulta general sobre operativa, facturación o proceso.",
    activo: true,
    orden: 3
  }
];

const SEED_GRUPOS: GrupoEmpresarial[] = [
  { id_grupo: 1, nombre: "Grupo Intercorp", descripcion: "Conglomerado multinacional peruano líder en banca, retail y educación." },
  { id_grupo: 2, nombre: "Grupo Romero", descripcion: "Uno de los grupos económicos más grandes de Perú con fuerte presencia en consumo masivo, puertos y minería." },
  { id_grupo: 3, nombre: "Grupo Aval", descripcion: "Conglomerado financiero de Colombia, líder en banca tradicional y digital." }
];

const SEED_EMPRESAS: Empresa[] = [
  {
    id_empresa: 1,
    ruc: "20100030451",
    razon_social: "Banco Internacional del Perú S.A.",
    nombre_comercial: "Interbank",
    telefono: "+51 1 3119000",
    correo: "soporte-it@interbank.pe",
    id_rubro: 2,
    id_grupo: 1,
    id_ubicacion: 2,
    estado: true
  },
  {
    id_empresa: 2,
    ruc: "20504100512",
    razon_social: "Súper Mercados Peruanos S.A.",
    nombre_comercial: "Plaza Vea",
    telefono: "+51 1 6250000",
    correo: "tecnologia@spsa.pe",
    id_rubro: 3,
    id_grupo: 1,
    id_ubicacion: 3,
    estado: true
  },
  {
    id_empresa: 3,
    ruc: "20100120150",
    razon_social: "Alicorp S.A.A.",
    nombre_comercial: "Alicorp",
    telefono: "+51 1 3150800",
    correo: "it_support@alicorp.com.pe",
    id_rubro: 3,
    id_grupo: 2,
    id_ubicacion: 1,
    estado: false
  },
  {
    id_empresa: 4,
    ruc: "80031245021",
    razon_social: "Banco de Bogotá S.A.",
    nombre_comercial: "Banco de Bogotá",
    telefono: "+57 601 3320011",
    correo: "it-banco@bancobogota.co",
    id_rubro: 2,
    id_grupo: 3,
    id_ubicacion: 5,
    estado: true
  }
];

const SEED_SUCURSALES: EmpresaSucursal[] = [
  { id_sucursal: 1, id_empresa: 1, nombre: "Sede Central Camino Real", id_ubicacion: 2, telefono: "+51 1 3119010", es_principal: true },
  { id_sucursal: 2, id_empresa: 1, nombre: "Sucursal Miraflores Benavides", id_ubicacion: 1, telefono: "+51 1 3119022", es_principal: false },
  { id_sucursal: 3, id_empresa: 2, nombre: "Plaza Vea Higuereta", id_ubicacion: 3, telefono: "+51 1 6251210", es_principal: true },
  { id_sucursal: 4, id_empresa: 3, nombre: "Planta Industrial Fray Martín", id_ubicacion: 1, telefono: "+51 1 3150801", es_principal: true },
  { id_sucursal: 5, id_empresa: 3, nombre: "Sede Industrial Arequipa", id_ubicacion: 4, telefono: "+51 54 220021", es_principal: false },
  { id_sucursal: 6, id_empresa: 4, nombre: "Sede Centro Chapinero", id_ubicacion: 6, telefono: "+57 601 3320250", es_principal: true }
];

const SEED_PERSONAS: Persona[] = [
  // Administradores y Técnicos
  {
    id_persona: 1,
    tipo_documento: "DNI",
    numero_documento: "44558811",
    nombres: "Alejandro",
    apellido_paterno: "Gómez",
    apellido_materno: "Paredes",
    fecha_nacimiento: "1988-04-12",
    telefono: "+51 987654321",
    correo: "admin@soporte.com",
    direccion: "Av. Larco 412, Miraflores",
    sexo: "M",
    estado: true
  },
  {
    id_persona: 2,
    tipo_documento: "DNI",
    numero_documento: "44558812",
    nombres: "Mariana",
    apellido_paterno: "Sifuentes",
    apellido_materno: "Díaz",
    fecha_nacimiento: "1994-08-22",
    telefono: "+51 987654123",
    correo: "supervisor@soporte.com",
    direccion: "Jr. Batalla de Junín 204, Barranco",
    sexo: "F",
    estado: true
  },
  {
    id_persona: 3,
    tipo_documento: "DNI",
    numero_documento: "44558813",
    nombres: "Carlos Alberto",
    apellido_paterno: "Rodríguez",
    apellido_materno: "Salazar",
    fecha_nacimiento: "1991-11-05",
    telefono: "+51 912345678",
    correo: "tecnico@soporte.com",
    direccion: "Calle Las Palomas 150, Surquillo",
    sexo: "M",
    estado: true
  },
  {
    id_persona: 4,
    tipo_documento: "DNI",
    numero_documento: "44558814",
    nombres: "Juan José",
    apellido_paterno: "Pérez",
    apellido_materno: "Montalván",
    fecha_nacimiento: "1985-02-18",
    telefono: "+51 922334455",
    correo: "juan.perez@soporte.com",
    direccion: "Av. Arequipa 3320, San Isidro",
    sexo: "M",
    estado: true
  },

  // Clientes / Contactos de Empresas
  {
    id_persona: 5,
    tipo_documento: "DNI",
    numero_documento: "10203040",
    nombres: "Roberto",
    apellido_paterno: "Villanueva",
    apellido_materno: "Castro",
    fecha_nacimiento: "1980-05-30",
    telefono: "+51 955667788",
    correo: "rvillanueva@interbank.pe",
    direccion: "Av. Prolongación Javier Prado 1150",
    sexo: "M",
    estado: true
  },
  {
    id_persona: 6,
    tipo_documento: "DNI",
    numero_documento: "20304050",
    nombres: "Cecilia",
    apellido_paterno: "Mendoza",
    apellido_materno: "Flores",
    fecha_nacimiento: "1985-09-14",
    telefono: "+51 911223344",
    correo: "cmendoza@plazavea.com.pe",
    direccion: "Calle San Martín 120, Surco",
    sexo: "F",
    estado: true
  },
  {
    id_persona: 7,
    tipo_documento: "CE",
    numero_documento: "99001122",
    nombres: "Eduardo José",
    apellido_paterno: "Guerrero",
    apellido_materno: "López",
    fecha_nacimiento: "1978-12-01",
    telefono: "+51 944332211",
    correo: "cliente@soporte.com",
    direccion: "Av. Republica de Panamá 5543",
    sexo: "M",
    estado: true
  },
  {
    id_persona: 8,
    tipo_documento: "RUC",
    numero_documento: "10984125023",
    nombres: "Felipe",
    apellido_paterno: "Restrepo",
    apellido_materno: "Orozco",
    fecha_nacimiento: "1989-07-25",
    telefono: "+57 3217502410",
    correo: "frestrepo@bancobogota.co",
    direccion: "Calle 102 #18-20, Bogotá",
    sexo: "M",
    estado: true
  }
];

const SEED_ROLES: PersonaRol[] = [
  { id_rol: 1, nombre: "Administrador", descripcion: "Acceso total para la configuración y administración del sistema de soporte técnico." },
  { id_rol: 2, nombre: "Supervisor", descripcion: "Asigna tareas, consulta reportes globales, y audita los indicadores geográficos y de tiempos." },
  { id_rol: 3, nombre: "Técnico", descripcion: "Visualiza tickets asignados, registra atenciones técnicas, y carga evidencias documentales o fotográficas." },
  { id_rol: 4, nombre: "Cliente / Contacto empresarial", descripcion: "Crea tickets reportando fallas en sus sedes y consulta el historial de estados de su empresa." }
];

const SEED_ASIGNACIONES = [
  { id_persona: 1, id_rol: 1, fecha_asignacion: "2026-01-10 08:30:00", asignado_por: 1 },
  { id_persona: 2, id_rol: 2, fecha_asignacion: "2026-01-12 09:15:00", asignado_por: 1 },
  { id_persona: 3, id_rol: 3, fecha_asignacion: "2026-01-15 10:00:00", asignado_por: 1 },
  { id_persona: 4, id_rol: 3, fecha_asignacion: "2026-01-18 11:30:00", asignado_por: 2 },
  { id_persona: 5, id_rol: 4, fecha_asignacion: "2026-02-01 14:00:00", asignado_por: 1 },
  { id_persona: 6, id_rol: 4, fecha_asignacion: "2026-02-05 14:00:00", asignado_por: 1 },
  { id_persona: 7, id_rol: 4, fecha_asignacion: "2026-02-10 14:00:00", asignado_por: 1 },
  { id_persona: 8, id_rol: 4, fecha_asignacion: "2026-02-15 15:00:00", asignado_por: 2 }
];

const SEED_CONTACTOS: EmpresaContacto[] = [
  {
    id_empresa_contacto: 1,
    id_empresa: 1,
    id_sucursal: 1,
    id_persona: 5,
    cargo: "Gerente del Centro de Operaciones TI",
    telefono_empresa: "+51 1 3119020",
    correo_empresa: "rvillanueva@interbank.pe",
    es_principal: true,
    estado: true
  },
  {
    id_empresa_contacto: 2,
    id_empresa: 2,
    id_sucursal: 3,
    id_persona: 6,
    cargo: "Jefa de Plataforma Tecnológica",
    telefono_empresa: "+51 1 6251210",
    correo_empresa: "cmendoza@plazavea.com.pe",
    es_principal: true,
    estado: true
  },
  {
    id_empresa_contacto: 3,
    id_empresa: 3,
    id_sucursal: 4,
    id_persona: 7,
    cargo: "Administrador de Redes y Comunicaciones",
    telefono_empresa: "+51 1 3150822",
    correo_empresa: "eguerrero@alicorp.com.pe",
    es_principal: true,
    estado: true
  },
  {
    id_empresa_contacto: 4,
    id_empresa: 4,
    id_sucursal: 6,
    id_persona: 8,
    cargo: "Director de Soporte Técnico Corporativo",
    telefono_empresa: "+57 601 3320251",
    correo_empresa: "frestrepo@bancobogota.co",
    es_principal: true,
    estado: true
  }
];

const SEED_TICKETS: Ticket[] = [
  {
    id_ticket: 1,
    nro_ticket: "2026-0001",
    fecha_registro: "2026-06-10",
    hora_registro: "09:12:00",
    fecha_cierre: "2026-06-11",
    hora_cierre: "15:30:00",
    id_usuario: 3, // Técnico Carlos Rodríguez
    id_empresa_contacto: 1, // Roberto Villanueva (Interbank)
    id_empresa: 1,
    id_sucursal: 1,
    detalle_reporte: "Servidor de base de datos de transacciones secundarias presenta caída masiva con error 10054 (Connection reset by peer) durante el backup diario. Afecta al reporte de cajas de la sede Camino Real.",
    prioridad: "CRITICA",
    estado: "CERRADO",
    medio_contacto: "EMAIL"
  },
  {
    id_ticket: 2,
    nro_ticket: "2026-0002",
    fecha_registro: "2026-06-12",
    hora_registro: "11:45:00",
    fecha_cierre: "2026-06-13",
    hora_cierre: "18:00:00",
    id_usuario: 3, // Técnico Carlos Rodríguez
    id_empresa_contacto: 2, // Cecilia Mendoza (Plaza Vea)
    id_empresa: 2,
    id_sucursal: 3,
    detalle_reporte: "Punto de Venta (POS) Nro 4 y 7 bloqueados tras actualización de software de facturación. No permiten lectura de tarjetas de crédito y envían error de checksum del firmware.",
    prioridad: "ALTA",
    estado: "RESUELTO",
    medio_contacto: "SISTEMA"
  },
  {
    id_ticket: 3,
    nro_ticket: "2026-0003",
    fecha_registro: "2026-06-15",
    hora_registro: "14:20:00",
    fecha_cierre: null,
    hora_cierre: null,
    id_usuario: 4, // Técnico Juan Pérez
    id_empresa_contacto: 3, // Eduardo Guerrero (Alicorp)
    id_empresa: 3,
    id_sucursal: 4,
    detalle_reporte: "Falla de conectividad fibra óptica en la Planta Industrial Fray Martín. Latencias superiores a 500ms y pérdida de paquetes intermitente que bloquea el sistema de picking SCM.",
    prioridad: "ALTA",
    estado: "EN_ATENCION",
    medio_contacto: "TELEFONO"
  },
  {
    id_ticket: 4,
    nro_ticket: "2026-0004",
    fecha_registro: "2026-06-17",
    hora_registro: "08:10:00",
    fecha_cierre: null,
    hora_cierre: null,
    id_usuario: 3, // Técnico Carlos Rodríguez
    id_empresa_contacto: 4, // Felipe Restrepo (Banco de Bogotá)
    id_empresa: 4,
    id_sucursal: 6,
    detalle_reporte: "Problemas en el lector de huellas biométrico del acceso restringido en la Sede Centro Chapinero. No reconoce credenciales del personal autorizado de bóveda.",
    prioridad: "MEDIA",
    estado: "PENDIENTE",
    medio_contacto: "CHAT"
  },
  {
    id_ticket: 5,
    nro_ticket: "2026-0005",
    fecha_registro: "2026-06-18",
    hora_registro: "10:30:00",
    fecha_cierre: null,
    hora_cierre: null,
    id_usuario: 3,
    id_empresa_contacto: 1, // Roberto Villanueva (Interbank)
    id_empresa: 1,
    id_sucursal: 2,
    detalle_reporte: "Impresora térmica de tickets en ventanilla 3 de Sucursal Miraflores no imprime código de barras. Se solicita cambio de cabezal térmico por desgaste visible.",
    prioridad: "BAJA",
    estado: "REABIERTO",
    medio_contacto: "EMAIL"
  }
];

const SEED_HISTORIAL: TicketHistorialEstado[] = [
  {
    id_historial: 1,
    id_ticket: 1,
    estado_anterior: "PENDIENTE",
    estado_nuevo: "EN_ATENCION",
    id_usuario: 2, // Supervisor Mariana
    motivo: "Se asignó técnico Carlos Rodríguez para revisión inmediata por criticidad en base de datos.",
    fecha_cambio: "2026-06-10 09:30:00"
  },
  {
    id_historial: 2,
    id_ticket: 1,
    estado_anterior: "EN_ATENCION",
    estado_nuevo: "RESUELTO",
    id_usuario: 3, // Técnico Carlos
    motivo: "Base de datos restaurada, índices reconstruidos y puerto de escucha verificado.",
    fecha_cambio: "2026-06-11 14:15:00"
  },
  {
    id_historial: 3,
    id_ticket: 1,
    estado_anterior: "RESUELTO",
    estado_nuevo: "CERRADO",
    id_usuario: 1, // Administrador Alejandro
    motivo: "Cliente firma conformidad y valida que el reporte consolida correctamente.",
    fecha_cambio: "2026-06-11 15:30:00"
  },
  {
    id_historial: 4,
    id_ticket: 2,
    estado_anterior: "PENDIENTE",
    estado_nuevo: "EN_ATENCION",
    id_usuario: 2,
    motivo: "Se inicia diagnóstico de firmware remotamente con terminal POS de contingencia.",
    fecha_cambio: "2026-06-12 12:00:00"
  },
  {
    id_historial: 5,
    id_ticket: 2,
    estado_anterior: "EN_ATENCION",
    estado_nuevo: "RESUELTO",
    id_usuario: 3,
    motivo: "Reinstalación de versión de firmware estable 2.4.1 completada en los terminales 4 y 7.",
    fecha_cambio: "2026-06-13 18:00:00"
  },
  {
    id_historial: 6,
    id_ticket: 3,
    estado_anterior: "PENDIENTE",
    estado_nuevo: "EN_ATENCION",
    id_usuario: 2,
    motivo: "Asignado a Juan Pérez por expertise en redes de fibra monomodo.",
    fecha_cambio: "2026-06-15 15:00:00"
  },
  {
    id_historial: 7,
    id_ticket: 5,
    estado_anterior: "PENDIENTE",
    estado_nuevo: "RESUELTO",
    id_usuario: 3,
    motivo: "Limpieza del sensor óptico realizada.",
    fecha_cambio: "2026-06-18 11:00:00"
  },
  {
    id_historial: 8,
    id_ticket: 5,
    estado_anterior: "RESUELTO",
    estado_nuevo: "REABIERTO",
    id_usuario: 5, // Cliente Roberto
    motivo: "Sigue saliendo borroso. Requiero que se verifique cambio físico de cabezal.",
    fecha_cambio: "2026-06-18 12:15:00"
  }
];

const SEED_ATENCIONES: Atencion[] = [
  {
    id_atencion: 1,
    id_ticket: 1,
    id_usuario: 3,
    fecha_inicio: "2026-06-10",
    hora_inicio: "09:35:00",
    fecha_fin: "2026-06-10",
    hora_fin: "13:40:00",
    detalle_atencion: "Se realiza un ping extendido y se detecta desconexión del host de la base de datos SQL Server corporativa. Se ingresa físicamente al rack de datos, se reinserta el patch cord de red y se descarta problema físico. Posteriormente se verifica el Event Viewer de SQL Server.",
    solucion_aplicada: "Se reinició servicio SQL Server agent y se optimizó el plan de respaldos automáticos para no saturar memoria E/S.",
    estado: "COMPLETADO"
  },
  {
    id_atencion: 2,
    id_ticket: 1,
    id_usuario: 3,
    fecha_inicio: "2026-06-11",
    hora_inicio: "09:00:00",
    fecha_fin: "2026-06-11",
    hora_fin: "14:15:00",
    detalle_atencion: "Verificación de la integridad lógica de las tablas de transacciones. Reindexación de índices fragmentados superiores al 30% en la base de datos 'BD_VENTANILLA_REAL'.",
    solucion_aplicada: "Comando DBCC DBREINDEX completado con éxito. Se ejecutó script de sincronización espejo.",
    estado: "COMPLETADO"
  },
  {
    id_atencion: 3,
    id_ticket: 2,
    id_usuario: 3,
    fecha_inicio: "2026-06-12",
    hora_inicio: "12:15:00",
    fecha_fin: "2026-06-12",
    hora_fin: "16:45:00",
    detalle_atencion: "Conexión vía túnel SSH hacia la centralizadora de POS. Se revisa logs del SDK de lectura EMV y se halla un desfazamiento de firma criptográfica en los terminales afectados.",
    solucion_aplicada: "Puesta en marcha de firmware beta para descartar hardware físico.",
    estado: "COMPLETADO"
  },
  {
    id_atencion: 4,
    id_ticket: 2,
    id_usuario: 3,
    fecha_inicio: "2026-06-13",
    hora_inicio: "14:00:00",
    fecha_fin: "2026-06-13",
    hora_fin: "18:00:00",
    detalle_atencion: "Instalación de parche de producción 2.4.1. Verificación en sitio de transacciones reales con tarjetas de prueba internacional Visa y Mastercard.",
    solucion_aplicada: "Firmware definitivo aplicado de forma exitosa. Pruebas de cobro transaccional al 100% integras.",
    estado: "COMPLETADO"
  },
  {
    id_atencion: 5,
    id_ticket: 3,
    id_usuario: 4,
    fecha_inicio: "2026-06-16",
    hora_inicio: "09:00:00",
    fecha_fin: null,
    hora_fin: null,
    detalle_atencion: "Pruebas OTDR (Optical Time-Domain Reflectometer) desde el switch de distribución core en planta hasta el armario de fibra de empaque. Se detecta doblez excesivo o daño físico en el tramo subterráneo de la planta.",
    solucion_aplicada: null,
    estado: "EN_PROCESO"
  }
];

const SEED_ATENCIONES_TIEMPO: AtencionTiempo[] = [
  { id_atencion: 1, duracion_minutos: 245, duracion_horas: 4.08, duracion_formato: "4h 05m" },
  { id_atencion: 2, duracion_minutos: 315, duracion_horas: 5.25, duracion_formato: "5h 15m" },
  { id_atencion: 3, duracion_minutos: 270, duracion_horas: 4.5, duracion_formato: "4h 30m" },
  { id_atencion: 4, duracion_minutos: 240, duracion_horas: 4, duracion_formato: "4h 00m" }
];

const SEED_ARCHIVOS: Archivo[] = [
  {
    id_archivo: 1,
    nombre_original: "sql-error-log-10054.txt",
    nombre_sistema: "ff551241-1192-416b-bc55-eefe3212891d.txt",
    ruta: "/uploads/tickets/1/sql-error-log-10054.txt",
    tipo_mime: "text/plain",
    extension: "txt",
    tamano_bytes: 54120,
    tamano_formato: "52.8 KB",
    checksum: "39ae9dfbf24090ea0dfb8ef2f0eb3499fa68cf387f98ee08c1effd9a34fc3e59",
    id_usuario_subio: 5, // Roberto V.
    fecha_subida: "2026-06-10 09:15:00",
    estado: true
  },
  {
    id_archivo: 2,
    nombre_original: "evidencia-pos-error-checksum.png",
    nombre_sistema: "fa320015-ab12-4217-bcbe-dae650eaefaa.png",
    ruta: "/uploads/tickets/2/evidencia-pos-error-checksum.png",
    tipo_mime: "image/png",
    extension: "png",
    tamano_bytes: 1542100,
    tamano_formato: "1.47 MB",
    checksum: "9d3feaadfae91142510255dfdaaa225efcd110e0decdc6d64bbed8cf12eaeee1",
    id_usuario_subio: 6, // Cecilia M.
    fecha_subida: "2026-06-12 11:50:00",
    estado: true
  },
  {
    id_archivo: 3,
    nombre_original: "informe-prueba-sincronizacion.pdf",
    nombre_sistema: "ccdc0510-9112-45e0-91ae-eedff0ea21aa.pdf",
    ruta: "/uploads/atenciones/2/informe-prueba-sincronizacion.pdf",
    tipo_mime: "application/pdf",
    extension: "pdf",
    tamano_bytes: 3120150,
    tamano_formato: "2.97 MB",
    checksum: "5faabbecdedd0901eebbcdee901eaec50bbded1210251bbdd6f10eed30eecafe",
    id_usuario_subio: 3, // Carlos R.
    fecha_subida: "2026-06-11 14:10:00",
    estado: true
  }
];

const SEED_TICKET_ARCHIVOS: TicketArchivo[] = [
  { id_ticket_archivo: 1, id_ticket: 1, id_archivo: 1, tipo_evidencia: "REPORTE_INICIAL" },
  { id_ticket_archivo: 2, id_ticket: 2, id_archivo: 2, tipo_evidencia: "REPORTE_INICIAL" }
];

const SEED_ATENCION_ARCHIVOS: AtencionArchivo[] = [
  { id_atencion_archivo: 1, id_atencion: 2, id_archivo: 3, tipo_evidencia: "DOCUMENTO_ENTREGADO" }
];

const SEED_AUDITORIA: AccesoAuditoria[] = [
  { id_acceso: 1, correo: "admin@soporte.com", fecha_hora: "2026-06-18 08:00:30", ip_address: "192.168.10.150", estado: "EXITOSO", intentos_previos: 0 },
  { id_acceso: 2, correo: "tecnico@soporte.com", fecha_hora: "2026-06-18 08:35:10", ip_address: "192.168.10.12", estado: "EXITOSO", intentos_previos: 0 },
  { id_acceso: 3, correo: "cliente@soporte.com", fecha_hora: "2026-06-18 09:12:00", ip_address: "190.113.125.14", estado: "FALLIDO", intentos_previos: 1 },
  { id_acceso: 4, correo: "cliente@soporte.com", fecha_hora: "2026-06-18 09:12:45", ip_address: "190.113.125.14", estado: "EXITOSO", intentos_previos: 2 }
];

const SEED_OPERACIONES: AuditoriaOperacion[] = [
  { id_auditoria: 1, usuario: "admin@soporte.com", fecha_hora: "2026-06-18 08:15:30", modulo: "GEOGRAFICO", operacion: "CREACION", detalles: "Se registró nuevo País 'Chile' (CHL) con niveles jerárquicos personalizados en la tabla de directorios maestros." },
  { id_auditoria: 2, usuario: "admin@soporte.com", fecha_hora: "2026-06-18 08:21:44", modulo: "EMPRESAS", operacion: "CREACION", detalles: "Se registró la empresa 'Banco de Bogotá S.A.' con RUC: 80031245021 y se vinculó a la ubicación de Cundinamarca (Usaquén)." }
];

export const SEED_SYSTEM_CONFIG: SystemConfig = {
  smtpHost: "smtp.corp-mail.com",
  smtpPort: 587,
  smtpUser: "notificaciones@soporte.com",
  smtpPass: "SuperSecurePass123!",
  smtpSecurity: "TLS",
  notificationTemplates: [
    {
      id: "TICKET_REGISTRO",
      titulo: "MTR-01 • Registro de nuevo ticket",
      asunto: "Mesa Ayuda ERP: Registro Exitoso de Ticket Nro {NRO_TICKET}",
      cuerpo: "Estimado cliente, se ha registrado exitosamente el ticket Nro. {NRO_TICKET} en la mesa de ayuda.\n\nDetalle del reporte: {DETALLE}\nPrioridad: {PRIORIDAD}\n\nAtentamente,\nOficina de Soporte & ANS ERP."
    },
    {
      id: "TICKET_ASIGNACION",
      titulo: "MTR-02 • Asignación de ticket a responsable",
      asunto: "Mesa Ayuda ERP: Ticket #{NRO_TICKET} asignado a su bandeja de servicio",
      cuerpo: "Hola {USUARIO}, se le ha asignado la atención y resolución del ticket de soporte #{NRO_TICKET}.\n\nEmpresa: {RAZON_SOCIAL}\nSolicitante: {CONTACTO}\nPrioridad: {PRIORIDAD}\n\nPor favor, conéctese al panel para iniciar las operaciones técnicas de atención."
    },
    {
      id: "TICKET_ESTADO",
      titulo: "MTR-03 • Cambio de estado en ticket",
      asunto: "Mesa Ayuda ERP: Actualización de estado en Ticket #{NRO_TICKET}",
      cuerpo: "Estimado cliente, le informamos que el estado de su ticket #{NRO_TICKET} ha cambiado de '{ESTADO_ANTERIOR}' a '{ESTADO_NUEVO}'.\n\nMotivo informado: {MOTIVO_CAMBIO}\nEjecutor: {USUARIO}\n\nAtentamente,\nSoporte Técnico Corporativo."
    },
    {
      id: "USUARIO_NUEVO",
      titulo: "SYS-01 • Registro de nuevo usuario",
      asunto: "HelpDesk ERP: Cuenta de acceso activada",
      cuerpo: "Bienvenido {USUARIO},\n\nSe ha creado su cuenta de acceso para el HelpDesk SQL Console.\n\nLogin ID: {CORREO}\nContraseña asignada: {CONTRASENA_TEMPORAL}\n\nPor favor, recuerde que debe cambiar su contraseña regularmente."
    },
    {
      id: "PASSWORD_RECOVERY",
      titulo: "SYS-02 • Solicitud de restablecimiento",
      asunto: "HelpDesk ERP: Enlace para restablecimiento de contraseña",
      cuerpo: "Hola {USUARIO},\n\nUd. ha solicitado el restablecimiento de su clave de acceso para el HelpDesk SQL Console.\n\nPara ingresar una nueva contraseña, use el siguiente enlace seguro (vía hash token):\nhttps://soporte-erp.com/reset?token={RESET_TOKEN}\n\nEste enlace tiene una vigencia parametrizada de {VIGENCIA_MINUTOS} minutos.\n\nSi usted no realizó esta solicitud ignore este mensaje."
    }
  ],
  ticketStates: [
    { id: "PENDIENTE", nombre: "Pendiente", activo: true, color: "orange", es_inicial: true },
    { id: "EN_ATENCION", nombre: "En Proceso", activo: true, color: "blue", es_inicial: false },
    { id: "RESUELTO", nombre: "Atendido", activo: true, color: "emerald", es_inicial: false },
    { id: "CERRADO", nombre: "Cerrado", activo: true, color: "slate", es_inicial: false },
    { id: "ANULADO", nombre: "Anulado", attivo: true, color: "rose", es_inicial: false } as any
  ],
  documentTypes: [
    { id: "DNI", nombre: "DNI (Doc. Nacional de Identidad)", activo: true, longitud_requerida: 8 },
    { id: "CE", nombre: "Cédula de Extranjería", activo: true, longitud_requerida: 9 },
    { id: "PASAPORTE", nombre: "Pasaporte Internacional", activo: true, longitud_requerida: 12 },
    { id: "RUC", nombre: "RUC (Registro Único de Contribuyentes)", activo: true, longitud_requerida: 11 }
  ],
  security: {
    intentosMaximos: 3,
    tiempoBloqueoSegundos: 30,
    inactividadMinutos: 15,
    vencimientoContrasenaDias: 90,
    dobleFactorOpcional: false
  },
  auditConfig: {
    logEmpresas: true,
    logSucursales: true,
    logTickets: true,
    logUsuarios: true,
    logGeografico: true
  },
  rolePermissions: {
    1: {
      DASHBOARD: { ver: true, registrar: true, modificar: true, eliminar: true, aprobar: true, exportar: true, imprimir: true },
      TICKETS: { ver: true, registrar: true, modificar: true, eliminar: true, aprobar: true, exportar: true, imprimir: true },
      CLIENTES: { ver: true, registrar: true, modificar: true, eliminar: true, aprobar: true, exportar: true, imprimir: true },
      GEOGRAFIA: { ver: true, registrar: true, modificar: true, eliminar: true, aprobar: true, exportar: true, imprimir: true },
      SEGURIDAD: { ver: true, registrar: true, modificar: true, eliminar: true, aprobar: true, exportar: true, imprimir: true },
      REPORTES: { ver: true, registrar: true, modificar: true, eliminar: true, aprobar: true, exportar: true, imprimir: true }
    },
    2: {
      DASHBOARD: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: true, exportar: true, imprimir: true },
      TICKETS: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: true, exportar: true, imprimir: true },
      CLIENTES: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: false, exportar: true, imprimir: true },
      GEOGRAFIA: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: false, exportar: true, imprimir: true },
      SEGURIDAD: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
      REPORTES: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: true, exportar: true, imprimir: true }
    },
    3: {
      DASHBOARD: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: true },
      TICKETS: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: true, exportar: true, imprimir: true },
      CLIENTES: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
      GEOGRAFIA: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
      SEGURIDAD: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
      REPORTES: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: true }
    },
    4: {
      DASHBOARD: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
      TICKETS: { ver: true, registrar: true, modificar: true, eliminar: false, aprobar: false, exportar: false, imprimir: true },
      CLIENTES: { ver: true, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
      GEOGRAFIA: { ver: false, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
      SEGURIDAD: { ver: false, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false },
      REPORTES: { ver: false, registrar: false, modificar: false, eliminar: false, aprobar: false, exportar: false, imprimir: false }
    }
  }
};

export function getInitialDatabase(): MockDatabase {
  const localData = localStorage.getItem(STORAGE_KEY);
  if (localData) {
    try {
      const parsed = JSON.parse(localData);
      // Validar integridad mínima
      if (parsed.tickets && parsed.empresas && parsed.personas && parsed.auditoriaAccesos) {
        if (!parsed.auditoriaOperaciones) {
          parsed.auditoriaOperaciones = SEED_OPERACIONES;
        }
        if (!parsed.systemConfig) {
          parsed.systemConfig = SEED_SYSTEM_CONFIG;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        } else if (!parsed.systemConfig.rolePermissions) {
          parsed.systemConfig.rolePermissions = SEED_SYSTEM_CONFIG.rolePermissions;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        }
        if (!parsed.motivosContacto) {
          parsed.motivosContacto = SEED_MOTIVOS_CONTACTO;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        }
        return parsed;
      }
    } catch (e) {
      console.warn("Falla al parsear DB persistente, se cargará seed inicial", e);
    }
  }

  const initial: MockDatabase = {
    paises: SEED_PAISES,
    tiposDivision: SEED_TIPOS_DIVISION,
    divisionesGeograficas: SEED_DIVISIONES,
    ubicaciones: SEED_UBICACIONES,
    rubros: SEED_RUBROS,
    gruposEmpresariales: SEED_GRUPOS,
    empresas: SEED_EMPRESAS,
    sucursales: SEED_SUCURSALES,
    personas: SEED_PERSONAS.map(p => ({ ...p, contrasena: "", bloqueado: false })), // Passwords should be set in database via secure authentication
    roles: SEED_ROLES,
    asignacionesRoles: SEED_ASIGNACIONES,
    contactosEmpresariales: SEED_CONTACTOS,
    motivosContacto: SEED_MOTIVOS_CONTACTO,
    tickets: SEED_TICKETS,
    historialEstados: SEED_HISTORIAL,
    atenciones: SEED_ATENCIONES,
    atencionesTiempo: SEED_ATENCIONES_TIEMPO,
    archivos: SEED_ARCHIVOS,
    ticketArchivos: SEED_TICKET_ARCHIVOS,
    atencionArchivos: SEED_ATENCION_ARCHIVOS,
    auditoriaAccesos: SEED_AUDITORIA,
    auditoriaOperaciones: SEED_OPERACIONES,
    bajasRegistradas: [],
    systemConfig: SEED_SYSTEM_CONFIG
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

export function saveDatabase(db: MockDatabase) {
  try {
    // FIX v2.1: localStorage tiene un límite de ~5-10MB. Los archivos PDF/imágenes
    // en base64 pueden pesar varios MB cada uno y agotar la cuota, causando el error:
    //   "Failed to execute 'setitem' on 'Storage': Setting the value of
    //    'SOPORTE_TICKETS_DB' exceeded the quota."
    //
    // Solución: NO persistir el contenido base64 de los archivos en localStorage.
    // El base64 YA está guardado en SQL Server (tabla [archivo].base64Content),
    // y se recupera vía sync_all o get_ticket_traceability cuando se necesita.
    // Aquí solo persistimos los metadatos del archivo (nombre, ruta, tamaño, etc.).
    const dbToPersist: MockDatabase = {
      ...db,
      archivos: (db.archivos || []).map(a => {
        // Clonar el archivo sin el base64Content para evitar exceder la cuota
        const { base64Content, ...archivoMeta } = a;
        return archivoMeta as Archivo;
      })
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dbToPersist));
  } catch (err) {
    // Si aún así excede la cuota (por ejemplo, muchísimos tickets), intentamos
    // una versión aún más ligera: solo metadatos esenciales.
    console.warn("[saveDatabase v2.1] No se pudo persistir db completa en localStorage. Intentando versión ligera...", err);
    try {
      const lightDb: any = {
        ...db,
        // Solo conservar los primeros 100 tickets/atenciones para no romper la UI
        tickets: (db.tickets || []).slice(0, 100),
        atenciones: (db.atenciones || []).slice(0, 200),
        historialEstados: (db.historialEstados || []).slice(0, 500),
        archivos: (db.archivos || []).slice(0, 50).map(a => {
          const { base64Content, ...meta } = a;
          return meta;
        }),
        ticketArchivos: (db.ticketArchivos || []).slice(0, 200)
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lightDb));
      console.warn("[saveDatabase v2.1] Versión ligera persistida correctamente.");
    } catch (err2) {
      console.error("[saveDatabase v2.1] No se pudo persistir ni la versión ligera. La app seguirá funcionando en memoria pero se perderá al recargar.", err2);
      // No lanzar el error — la app debe seguir funcionando en memoria.
      // El siguiente sync_all desde el backend restaurará los datos.
    }
  }
}

// RESTORE DATABASE FOR RESET BUTTON
export function resetDatabase(): MockDatabase {
  localStorage.removeItem(STORAGE_KEY);
  const db = getInitialDatabase();
  return db;
}
