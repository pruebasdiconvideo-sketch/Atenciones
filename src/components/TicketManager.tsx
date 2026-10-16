import React, { useState, useMemo, useEffect } from "react";
import { MockDatabase } from "../db/mockDb";
import {
  Ticket,
  TicketPrioridad,
  TicketEstado,
  TicketHistorialEstado,
  Atencion,
  AtencionEstado,
  Archivo,
  Persona,
  EmpresaSucursal,
  EmpresaContacto,
  AtencionTiempo,
  TicketMedioContacto,
  MotivoContacto
} from "../types";
import { logTechnicalError, getFriendlyErrorMessage } from "../utils/errorLogger";
import { getApiUrl as getDynamicApiUrl } from "../utils/api";
import {
  Plus,
  Search,
  Eye,
  Edit3,
  MapPin,
  Clock,
  ArrowRight,
  Paperclip,
  AlertCircle,
  RefreshCw,
  FileText,
  Save,
  Trash2,
  Tag,
  X,
  FileDown
} from "lucide-react";

interface TicketManagerProps {
  db: MockDatabase;
  currentUser: Persona;
  currentRole: string;
  updateDb: (newDb: MockDatabase) => void;
  onSync?: () => void;
  dbSyncedWithSql?: boolean;
}

export const formatTicketStatus = (status: any, ticket?: any): string => {
  if (status === true || status === "true" || status === 1 || status === "1") {
    const hasCierre = ticket && (ticket.fecha_cierre ?? ticket.FECHA_CIERRE);
    return hasCierre ? "CERRADO" : "EN ATENCIÓN";
  }

  const statusStr = String(status || "").trim().toUpperCase();
  if (statusStr === "EN_ATENCION" || statusStr === "EN ATENCION") {
    return "EN ATENCIÓN";
  }
  if (statusStr === "PENDIENTE") {
    return "PENDIENTE";
  }
  if (statusStr === "RESUELTO") {
    return "RESUELTO";
  }
  if (statusStr === "CERRADO") {
    return "CERRADO";
  }
  if (statusStr === "REABIERTO") {
    return "REABIERTO";
  }
  if (statusStr === "ANULADO") {
    return "ANULADO";
  }

  const hasCierre = ticket && (ticket.fecha_cierre ?? ticket.FECHA_CIERRE);
  return hasCierre ? "CERRADO" : "EN ATENCIÓN";
};

const formatHistoryReason = (reason: unknown): string =>
  String(reason ?? "")
    .replace(/\bpor\s+trigger\s*\(\s*update\s+en\s+ticket\s*\)/gi, "por una actualización automática")
    .replace(/\btrigger\s*\(\s*update\s+en\s+ticket\s*\)/gi, "una actualización automática");

const normalizeDates = (obj: any): any => {
  if (!obj) return obj;
  if (Array.isArray(obj)) return obj.map(item => normalizeDates(item));
  if (typeof obj !== 'object' || obj === null) return obj;

  const result = { ...obj };
  const dateFields = ['fecha_registro', 'fecha_cierre', 'fecha_cambio', 'fecha_inicio', 'fecha_fin', 'fecha_asignacion', 'fecha_subida', 'fecha_nacimiento'];
  const timeFields = ['hora_registro', 'hora_cierre', 'hora_inicio', 'hora_fin'];

  dateFields.forEach(field => {
    if (result[field] && typeof result[field] === 'object') {
      result[field] = String(result[field]);
    }
  });

  timeFields.forEach(field => {
    if (result[field] && typeof result[field] === 'object') {
      result[field] = String(result[field]);
    }
  });

  return result;
};

export function TicketManager({ db, currentUser, currentRole, updateDb, onSync, dbSyncedWithSql }: TicketManagerProps) {
  // ====================================================================
  // MARCADOR DE VERSIÓN — Si en la consola del navegador NO aparece:
  //   "[TicketManager v2.9 FIX] componente montado"
  // entonces sigues ejecutando el bundle antiguo.
  // v2.7 = refuerzo total anti-cierre del panel (isTracePanelOpen state)
  // ====================================================================
  useEffect(() => {
  }, []);

  // FIX v2.32 — activeTab ahora permite "AUDITORIA" como sub-pestaña adicional
  // que muestra el registro de auditoría de tickets (creaciones, ediciones, cambios de estado).
  const [activeTab, setActiveTab] = useState<TicketEstado | "TODOS" | "AUDITORIA">("TODOS");
  const [searchTerm, setSearchTerm] = useState("");
  // FIX v2.36 — OPTIMIZACIÓN: Debounce en búsqueda para evitar refetch en cada tecla.
  // El término "real" usado para filtrar solo se actualiza 300ms después de la última tecla.
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // FIX v2.33 — Estado de notificación modal (reemplaza alert()).
  const [notification, setNotification] = useState<{
    type: "success" | "error" | "warning" | "info";
    title: string;
    message: string;
  } | null>(null);
  // Helper para mostrar notificación de forma concisa.
  const notify = (
    type: "success" | "error" | "warning" | "info",
    title: string,
    message: string
  ) => setNotification({ type, title, message });

  // FIX v2.33 — Estado del modal "Ver correos destino" al crear ticket.
  const [showCorreosModal, setShowCorreosModal] = useState(false);
  const [selectedPriority, setSelectedPriority] = useState<string>("TODOS");
  const [selectedCompany, setSelectedCompany] = useState<string>("TODOS");
  const [selectedMotivoFilter, setSelectedMotivoFilter] = useState<string>("TODOS");
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<string>("TODOS");
  const [selectedAssigneeFilter, setSelectedAssigneeFilter] = useState<string>("TODOS");
  const [selectedRubroFilter, setSelectedRubroFilter] = useState<string>("TODOS");
  const [createdDateFilter, setCreatedDateFilter] = useState<string>("");
  const [closedDateFilter, setClosedDateFilter] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);

  const resolveTicketSolution = (ticketId: any): string => {
    if (!ticketId) return "";
    const atencionesList = db.atenciones || [];
    const ticketAttentions = atencionesList.filter(a => {
      const aTicketId = (a as any).id_ticket ?? (a as any).ID_TICKET ?? (a as any).id_Ticket ?? (a as any).Id_ticket;
      return Number(aTicketId) === Number(ticketId);
    });
    const solutions = ticketAttentions
      .map(a => (a as any).solucion_aplicada ?? (a as any).SOLUCION_APLICADA)
      .filter((s): s is string => !!s && s.trim().length > 0);

    if (solutions.length > 0) {
      return solutions.join(" | ");
    }
    return "Pendiente de registro / Sin solución";
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [
    activeTab,
    searchTerm,
    selectedPriority,
    selectedCompany,
    selectedMotivoFilter,
    selectedBranchFilter,
    selectedAssigneeFilter,
    selectedRubroFilter,
    createdDateFilter,
    closedDateFilter,
    pageSize
  ]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  // FIX v2.7: Estado separado para controlar si el panel está abierto.
  // Esto desacopla la visibilidad del panel del valor de viewTicket.
  // El panel SOLO se cierra cuando el usuario hace click en [X] o "Cerrar Panel".
  const [viewTicket, setViewTicketRaw] = useState<Ticket | null>(null);
  const [isTracePanelOpen, setIsTracePanelOpen] = useState<boolean>(false);
  const [showStatusChangeModal, setShowStatusChangeModal] = useState(false);
  const [statusChangeTarget, setStatusChangeTarget] = useState<TicketEstado | null>(null);
  const [statusChangeReason, setStatusChangeReason] = useState("");
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);

  // ====================================================================
  // GUARDIÁN ANTI-CIERRE ACCIDENTAL DEL PANEL (v2.7 — refuerzo total)
  // --------------------------------------------------------------------
  // El panel de trazabilidad SOLO se cierra mediante closeViewTicketExplicit(),
  // que se llama únicamente desde:
  //   1. El botón [X] del panel
  //   2. El botón "Cerrar Panel de Trazabilidad"
  //   3. handleDeleteTicket (al eliminar el ticket)
  // NINGÚN callback async, fetch, useEffect o handler puede cerrar el panel.
  // ====================================================================
  const userInitiatedClose = React.useRef<boolean>(false);
  const setViewTicket = React.useCallback((value: Ticket | null) => {
    if (value === null && !userInitiatedClose.current) {
      console.warn("%c[TicketManager v2.7] BLOQUEADO setViewTicket(null) — el panel solo se cierra con [X] o 'Cerrar Panel'", "color:#dc2626;font-weight:bold;");
      return;
    }
    if (value !== null) {
      userInitiatedClose.current = false;
      setIsTracePanelOpen(true); // FIX v2.7: abrir panel al setear un ticket
    }
    setViewTicketRaw(value);
  }, []);
  const closeViewTicketExplicit = React.useCallback(() => {
    traceabilityRequestId.current += 1;
    setIsTraceabilityLoading(false);
    userInitiatedClose.current = true;
    setIsTracePanelOpen(false);
    setViewTicketRaw(null);
  }, []);

  const [formEmpresa, setFormEmpresa] = useState<string>("");
  const [formSucursal, setFormSucursal] = useState<string>("");
  const [formContacto, setFormContacto] = useState<string>("");
  const [formPrioridad, setFormPrioridad] = useState<TicketPrioridad>("MEDIA");
  const [formMedioContacto, setFormMedioContacto] = useState<TicketMedioContacto>("EMAIL");
  const [formMotivo, setFormMotivo] = useState<string>("");
  const [formDetalle, setFormDetalle] = useState("");
  const [formFiles, setFormFiles] = useState<{ name: string; size: number; type: string; base64Content?: string }[]>([]);
  // FIX v2.32 — Opción de envío automático de correo al registrar ticket.
  const [formEnviarCorreo, setFormEnviarCorreo] = useState<boolean>(true);
  // FIX v2.66 — Selección de destinatarios: contacto de empresa Y/O usuario del sistema.
  const [formNotificarContacto, setFormNotificarContacto] = useState<boolean>(false);
  const [formNotificarUsuario, setFormNotificarUsuario] = useState<boolean>(false);
  const [formContactoNotifId, setFormContactoNotifId] = useState<string>("");
  const [formUsuarioNotifId, setFormUsuarioNotifId] = useState<string>("");
  // FIX v2.66 — Modales de búsqueda para asignación de correos.
  const [showBusquedaContactoModal, setShowBusquedaContactoModal] = useState(false);
  const [showBusquedaUsuarioModal, setShowBusquedaUsuarioModal] = useState(false);
  const [busquedaContactoQuery, setBusquedaContactoQuery] = useState("");
  const [busquedaUsuarioQuery, setBusquedaUsuarioQuery] = useState("");

  const [showCompanySearchModal, setShowCompanySearchModal] = useState(false);
  const [companySearchQuery, setCompanySearchQuery] = useState("");
  const [companySearchModalTarget, setCompanySearchModalTarget] = useState<"FORM" | "FILTER">("FORM");

  const [showBranchSearchModal, setShowBranchSearchModal] = useState(false);
  const [branchSearchQuery, setBranchSearchQuery] = useState("");

  const [showContactSearchModal, setShowContactSearchModal] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState("");

  const [showAddAttentionModal, setShowAddAttentionModal] = useState(false);
  const [attentionDetalle, setAttentionDetalle] = useState("");
  const [attentionSolucion, setAttentionSolucion] = useState("");
  const [attentionEstado, setAttentionEstado] = useState<AtencionEstado>("EN_PROCESO");
  const [attentionInicioFecha, setAttentionInicioFecha] = useState(new Date().toISOString().substring(0, 10));
  const [attentionInicioHora, setAttentionInicioHora] = useState("09:00");
  const [attentionFinFecha, setAttentionFinFecha] = useState(new Date().toISOString().substring(0, 10));
  const [attentionFinHora, setAttentionFinHora] = useState("12:00");
  const [attentionTechValue, setAttentionTechValue] = useState<string>(currentUser.id_persona.toString());
  // FIX v2.67 — Atender y cerrar ticket en el mismo flujo de creación.
  const [formAtenderAhora, setFormAtenderAhora] = useState<boolean>(false);
  const [formAtencionDetalle, setFormAtencionDetalle] = useState("");
  const [formAtencionSolucion, setFormAtencionSolucion] = useState("");
  const [formCerrarTicket, setFormCerrarTicket] = useState<boolean>(false);
  // FIX v2.73 — Checkbox opcional para notificar al cerrar ticket.
  const [formNotificarCierre, setFormNotificarCierre] = useState<boolean>(true);
  // FIX v2.81 — Hora de inicio y fin explícitas al atender y cerrar en el registro.
  // El usuario puede ajustarlas manualmente; si las deja vacías, el backend usa GETDATE().
  const [formAtencionFechaInicio, setFormAtencionFechaInicio] = useState<string>("");
  const [formAtencionHoraInicio, setFormAtencionHoraInicio] = useState<string>("");
  const [formAtencionFechaFin, setFormAtencionFechaFin] = useState<string>("");
  const [formAtencionHoraFin, setFormAtencionHoraFin] = useState<string>("");

  const [editingAttention, setEditingAttention] = useState<Atencion | null>(null);
  const [editAttentionDetalle, setEditAttentionDetalle] = useState("");
  const [editAttentionSolucion, setEditAttentionSolucion] = useState("");

  const [showFileUploadModal, setShowFileUploadModal] = useState(false);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [fileEvidenceType, setFileEvidenceType] = useState<string>("EVIDENCIA_ADICIONAL");
  const [previewArchivo, setPreviewArchivo] = useState<Archivo | null>(null);

  const [useLocalSql, setUseLocalSql] = useState<boolean>(true);
  const [localSqlTickets, setLocalSqlTickets] = useState<any[]>([]);
  const [ticketStatusCounts, setTicketStatusCounts] = useState<Record<string, number>>({});
  const [isLoadingSql, setIsLoadingSql] = useState<boolean>(false);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [ticketTraceability, setTicketTraceability] = useState<any>(null);
  const [isTraceabilityLoading, setIsTraceabilityLoading] = useState<boolean>(false);
  const [traceabilityError, setTraceabilityError] = useState<string | null>(null);
  const traceabilityRequestId = React.useRef(0);

  const [showMotivoModal, setShowMotivoModal] = useState(false);
  const [editingMotivo, setEditingMotivo] = useState<MotivoContacto | null>(null);
  const [motivoForm, setMotivoForm] = useState<Partial<MotivoContacto>>({ nombre: '', descripcion: '', activo: true, orden: 0 });

  const isAdmin = currentRole.toLowerCase().includes("admin") || currentUser.id_persona === 1;

  const fetchTicketTraceability = async (ticketId: number) => {
    const requestId = ++traceabilityRequestId.current;
    setTraceabilityError(null);
    setIsTraceabilityLoading(true);
    const params = new URLSearchParams();
    params.append("action", "get_ticket_traceability");
    params.append("id_ticket", ticketId.toString());

    const apiUrl = getDynamicApiUrl(undefined, params);

    try {
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error("No se pudo cargar la trazabilidad.");
      const data = await response.json();
      if (data.status !== "success") throw new Error("No se pudo cargar la trazabilidad.");
      if (requestId === traceabilityRequestId.current) {
        setTicketTraceability({
          ticket: data.data.ticket ? normalizeDates(data.data.ticket) : null,
          historial: data.data.historial ? normalizeDates(data.data.historial) : [],
          atenciones: data.data.atenciones ? normalizeDates(data.data.atenciones) : [],
          evidencias: data.data.evidencias ? normalizeDates(data.data.evidencias) : []
        });
      }
    } catch (error) {
      if (requestId === traceabilityRequestId.current) {
        setTraceabilityError("No se pudo cargar el historial. Intente nuevamente.");
        console.error("Error al cargar trazabilidad:", error);
      }
    } finally {
      if (requestId === traceabilityRequestId.current) setIsTraceabilityLoading(false);
    }
  };

  // FIX v2.82 — Calcular duración entre fecha/hora de inicio y fin.
  // Devuelve un objeto legible con días, horas, minutos y totales para SLA.
  const calcularDuracionAtencion = (
    fechaInicio: string,
    horaInicio: string,
    fechaFin: string,
    horaFin: string
  ): { dias: number; horas: number; minutos: number; totalHoras: number; totalMinutos: number; legible: string } | null => {
    if (!fechaInicio || !horaInicio || !fechaFin || !horaFin) return null;
    try {
      const inicio = new Date(`${fechaInicio}T${horaInicio.length === 5 ? horaInicio + ":00" : horaInicio}`);
      const fin = new Date(`${fechaFin}T${horaFin.length === 5 ? horaFin + ":00" : horaFin}`);
      if (isNaN(inicio.getTime()) || isNaN(fin.getTime())) return null;
      if (fin < inicio) return null;
      const totalMs = fin.getTime() - inicio.getTime();
      const totalMinutos = Math.floor(totalMs / 60000);
      const totalHoras = totalMinutos / 60;
      const dias = Math.floor(totalMinutos / (60 * 24));
      const horas = Math.floor((totalMinutos % (60 * 24)) / 60);
      const minutos = totalMinutos % 60;
      let legible = "";
      if (dias > 0) legible += `${dias}d `;
      if (horas > 0 || dias > 0) legible += `${horas}h `;
      legible += `${minutos}m`;
      return { dias, horas, minutos, totalHoras: parseFloat(totalHoras.toFixed(2)), totalMinutos, legible: legible.trim() };
    } catch {
      return null;
    }
  };

  const fetchLocalSqlTickets = () => {
    setIsLoadingSql(true);
    setSqlError(null);

    const params = new URLSearchParams();
    params.append("action", "list");
    if (activeTab !== "TODOS") params.append("estado", activeTab);
    if (selectedPriority !== "TODOS") params.append("prioridad", selectedPriority);
    if (selectedCompany !== "TODOS") params.append("id_empresa", selectedCompany);
    if (selectedMotivoFilter !== "TODOS") params.append("id_motivo_contacto", selectedMotivoFilter);
    if (selectedBranchFilter !== "TODOS") params.append("id_sucursal", selectedBranchFilter);
    if (selectedRubroFilter !== "TODOS") params.append("id_rubro", selectedRubroFilter);
    if (selectedAssigneeFilter !== "TODOS") params.append("id_usuario", selectedAssigneeFilter);

    const getApiUrl = () => {
      return getDynamicApiUrl(undefined, params);
    };

    fetch(getApiUrl())
      .then(res => {
        if (!res.ok) throw new Error(`Error de conexión`);
        return res.json();
      })
      .then(data => {
        if (data.status === "success") {
          if (data.counts && typeof data.counts === "object") {
            setTicketStatusCounts(Object.fromEntries(
              Object.entries(data.counts).map(([key, value]) => [key, Number(value) || 0])
            ));
          }
          const normalizedTickets = (data.data || []).map((ticket: any) => {
            const normalized = normalizeDates(ticket);
            if (normalized.id_motivo_contacto) {
              const motivo = db.motivosContacto?.find(m => m.id_motivo === normalized.id_motivo_contacto);
              if (motivo) {
                normalized.motivo_nombre = motivo.nombre;
              }
            }
            return normalized;
          });
          setLocalSqlTickets(normalizedTickets);
          setUseLocalSql(true);
        } else {
          throw new Error(data.message || "Error al leer desde la base de datos.");
        }
      })
      .catch(err => {
        logTechnicalError(err, { url: getApiUrl(), sqlStatus: "TICKET_LIST_FETCH_ERROR", currentUser });
        setSqlError(getFriendlyErrorMessage("database") + " — " + (err?.message || "Error desconocido"));
        // FIX v2.4: NO caer a datos locales simulados. Toda la información debe venir
        // de la base de datos el sistema. Mostrar error y vaciar la lista para que
        // el usuario sepa que NO hay datos reales disponibles.
        console.error("[TicketManager v2.4] Error al cargar tickets desde el sistema:", err);
        setLocalSqlTickets([]);
        // Mantener useLocalSql=true para que el sistema SIGA intentando usar la BD
        // y no caiga al modo de datos locales en memoria (db.tickets).
        setUseLocalSql(true);
      })
      .finally(() => {
        setIsLoadingSql(false);
      });
  };

  // FIX v2.81 — useLocalSql eliminado de las dependencias porque cambia a true
  // después del primer fetch y dispara un fetch redundante. Solo se quiere
  // refrescar cuando cambian los filtros activos.
  useEffect(() => {
    fetchLocalSqlTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    selectedPriority,
    selectedCompany,
    selectedMotivoFilter,
    selectedBranchFilter,
    selectedRubroFilter,
  ]);

  useEffect(() => {
    if (viewTicket) {
      // FIX v2.77 — Solo sincronizar viewTicket con localSqlTickets. NO llamar fetchTicketTraceability aquí.
      const fresh = localSqlTickets.find(t => t.id_ticket === viewTicket.id_ticket);
      if (fresh && (
        fresh.estado !== viewTicket.estado ||
        fresh.fecha_cierre !== viewTicket.fecha_cierre ||
        fresh.hora_cierre !== viewTicket.hora_cierre ||
        fresh.id_motivo_contacto !== viewTicket.id_motivo_contacto
      )) {
        setViewTicket(fresh);
      }
      // FIX v2.77 — La trazabilidad se llama manualmente después de operaciones, no aquí.
    } else {
      setTicketTraceability(null);
      setTraceabilityError(null);
    }
  }, [viewTicket]);

  // FIX v2.75 — Cuando localSqlTickets se refresca, sincronizar viewTicket SOLO si hay cambios.
  // NO llamar fetchTicketTraceability automáticamente (causa lentitud y cierre del panel).
  useEffect(() => {
    if (!viewTicket) return;
    const fresh = localSqlTickets.find(t => Number(t.id_ticket) === Number(viewTicket.id_ticket));
    if (fresh && (
      fresh.estado !== viewTicket.estado ||
      fresh.fecha_cierre !== viewTicket.fecha_cierre ||
      fresh.hora_cierre !== viewTicket.hora_cierre
    )) {
      setViewTicket(fresh);
    }
    // FIX v2.75 — NO llamar fetchTicketTraceability aquí. Se llama manualmente cuando es necesario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSqlTickets]);

  const traceTicket = ticketTraceability?.ticket && viewTicket && Number(ticketTraceability.ticket.id_ticket) === Number(viewTicket.id_ticket)
    ? ticketTraceability.ticket
    : null;
  const traceHistorial = Array.isArray(ticketTraceability?.historial)
    ? ticketTraceability.historial
    : (viewTicket ? db.historialEstados.filter(h => Number(h.id_ticket) === Number(viewTicket.id_ticket)) : []);
  const traceAtenciones = Array.isArray(ticketTraceability?.atenciones)
    ? ticketTraceability.atenciones
    : (viewTicket ? db.atenciones.filter(a => Number(a.id_ticket) === Number(viewTicket.id_ticket)) : []);

  useEffect(() => {
    if (dbSyncedWithSql) {
      setUseLocalSql(true);
    }
  }, [dbSyncedWithSql]);

  const filteredSucursalesForForm = useMemo(() => {
    if (!formEmpresa) return [];
    return db.sucursales.filter(s => s.id_empresa === parseInt(formEmpresa));
  }, [formEmpresa, db.sucursales]);

  const filteredContactosForForm = useMemo(() => {
    if (!formEmpresa) return [];
    return db.contactosEmpresariales
      .filter(c => c.id_empresa === parseInt(formEmpresa) && c.estado)
      .map(c => {
        const p = db.personas.find(per => per.id_persona === c.id_persona);
        return {
          id_empresa_contacto: c.id_empresa_contacto,
          nombre_contacto: p ? `${p.nombres} ${p.apellido_paterno} (${c.cargo || 'Contacto'})` : `Contacto #${c.id_empresa_contacto}`
        };
      });
  }, [formEmpresa, db.contactosEmpresariales, db.personas]);

  const searchedCompanies = useMemo(() => {
    return db.empresas.filter(e => {
      const q = companySearchQuery.trim().toLowerCase();
      if (!q) return true;
      return (e.nombre_comercial || "").toLowerCase().includes(q) ||
        e.razon_social.toLowerCase().includes(q) ||
        e.ruc.includes(q);
    });
  }, [db.empresas, companySearchQuery]);

  const searchedBranches = useMemo(() => {
    return filteredSucursalesForForm.filter(s => {
      const q = branchSearchQuery.trim().toLowerCase();
      if (!q) return true;
      return s.nombre.toLowerCase().includes(q);
    });
  }, [filteredSucursalesForForm, branchSearchQuery]);

  const searchedContactos = useMemo(() => {
    return filteredContactosForForm.filter(c => {
      const q = contactSearchQuery.trim().toLowerCase();
      if (!q) return true;
      return c.nombre_contacto.toLowerCase().includes(q);
    });
  }, [filteredContactosForForm, contactSearchQuery]);

  const filteredTicketsExceptStatus = useMemo(() => {
    // FIX v2.4: Siempre usar localSqlTickets (datos de la BD). Nada de simulación.
    const listToFilter = localSqlTickets;

    return listToFilter.filter((t) => {
      const compObj = db.empresas.find(e => e.id_empresa === t.id_empresa);
      const compName = compObj ? (compObj.nombre_comercial || compObj.razon_social || "") : "";

      const contactObj = db.contactosEmpresariales.find(c => c.id_empresa_contacto === t.id_empresa_contacto);
      const personObj = contactObj ? db.personas.find(p => p.id_persona === contactObj.id_persona) : null;
      const contactName = personObj ? `${personObj.nombres} ${personObj.apellido_paterno}` : "";

      // FIX v2.36: Usar debouncedSearchTerm en lugar de searchTerm para evitar recálculo en cada tecla.
      const matchSearch = !debouncedSearchTerm ||
        (t.nro_ticket || "").toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        (t.detalle_reporte || "").toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        ((t as any).empresa_nombre || "").toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        ((t as any).contacto_nombre || "").toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        compName.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        contactName.toLowerCase().includes(debouncedSearchTerm.toLowerCase());

      const matchPriority = selectedPriority === "TODOS" || t.prioridad === selectedPriority;
      const matchCompany = selectedCompany === "TODOS" || t.id_empresa === parseInt(selectedCompany);
      const matchMotivo = selectedMotivoFilter === "TODOS" || t.id_motivo_contacto === parseInt(selectedMotivoFilter);
      const matchBranch = selectedBranchFilter === "TODOS" || t.id_sucursal === parseInt(selectedBranchFilter);
      const matchAssignee = selectedAssigneeFilter === "TODOS" || t.id_usuario === parseInt(selectedAssigneeFilter);

      const companyRef = db.empresas.find(e => e.id_empresa === t.id_empresa);
      const matchRubro = selectedRubroFilter === "TODOS" || (companyRef && companyRef.id_rubro === parseInt(selectedRubroFilter));

      const matchCreatedDate = !createdDateFilter || t.fecha_registro === createdDateFilter;
      const matchClosedDate = !closedDateFilter || t.fecha_cierre === closedDateFilter;

      if (currentRole === "Cliente / Contacto empresarial") {
        const clientContacts = db.contactosEmpresariales.filter(c => c.id_persona === currentUser.id_persona);
        const allowedCompanyIds = clientContacts.map(c => c.id_empresa);
        if (!allowedCompanyIds.includes(t.id_empresa)) {
          return false;
        }
      }

      return matchSearch && matchPriority && matchCompany && matchMotivo && matchBranch && matchAssignee && matchRubro && matchCreatedDate && matchClosedDate;
    });
  }, [
    useLocalSql,
    localSqlTickets,
    db.tickets,
    debouncedSearchTerm,
    selectedPriority,
    selectedCompany,
    selectedMotivoFilter,
    selectedBranchFilter,
    selectedAssigneeFilter,
    selectedRubroFilter,
    createdDateFilter,
    closedDateFilter,
    currentRole,
    currentUser,
    db.contactosEmpresariales,
    db.empresas,
    db.personas
  ]);

  const filteredTickets = useMemo(() => {
    return filteredTicketsExceptStatus.filter((t) => {
      if (activeTab === "TODOS") return true;
      // FIX v2.4: Normalizar ambos lados de la comparación.
      // El activeTab usa "EN_ATENCION" (con guion bajo) pero formatTicketStatus
      // devuelve "EN ATENCIÓN" (con espacio y tilde). Hay que comparar de forma robusta.
      const formattedStatus = formatTicketStatus(t.estado, t);
      const normalizedFormattted = formattedStatus.replace(/ /g, "_").toUpperCase();
      const normalizedActiveTab = activeTab.replace(/ /g, "_").toUpperCase();
      // Quitar tildes para comparación
      const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return stripAccents(normalizedFormattted) === stripAccents(normalizedActiveTab);
    }).sort((a, b) => b.id_ticket - a.id_ticket);
  }, [filteredTicketsExceptStatus, activeTab]);

  const paginatedTickets = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredTickets.slice(startIndex, startIndex + pageSize);
  }, [filteredTickets, currentPage, pageSize]);

  const totalPages = useMemo(() => {
    return Math.ceil(filteredTickets.length / pageSize) || 1;
  }, [filteredTickets, pageSize]);

  const handleDeleteTicket = (ticketId: number) => {
    if (!confirm("🚨 ADVERTENCIA: Esta acción es irreversible y eliminará físicamente el ticket y todo su historial de atenciones de la base de datos corporativa.\n\n¿Desea proceder con la eliminación?")) {
      return;
    }

    // FIX v2.63 — Eliminar del backend (base de datos) además del estado local.
    fetch(getDynamicApiUrl("delete_ticket"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_ticket: ticketId }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === "success") {
          // Actualizar estado local
          const nextTickets = db.tickets.filter(t => t.id_ticket !== ticketId);
          const nextAtenciones = db.atenciones.filter(a => a.id_ticket !== ticketId);
          const nextHistorial = db.historialEstados.filter(h => h.id_ticket !== ticketId);
          const nextArchivos = db.ticketArchivos.filter(ta => ta.id_ticket !== ticketId);

          updateDb({
            ...db,
            tickets: nextTickets,
            atenciones: nextAtenciones,
            historialEstados: nextHistorial,
            ticketArchivos: nextArchivos
          });
          closeViewTicketExplicit();
          notify("success", "Ticket eliminado", `El ticket #${ticketId} ha sido eliminado de la base de datos.`);

          // Refrescar la lista desde el backend
          fetchLocalSqlTickets();
        } else {
          notify("error", "Error al eliminar", data.message || "No se pudo eliminar el ticket de la base de datos.");
        }
      })
      .catch(err => {
        console.error("Error al eliminar ticket:", err);
        notify("error", "Error de conexión", "No se pudo conectar con el servidor para eliminar el ticket.");
      });
  };

  const handleSaveEditTicketSubmit = (updatedTicket: Ticket) => {
    const originalTicket = db.tickets.find(t => t.id_ticket === updatedTicket.id_ticket);

    const ticketToSave = {
      ...updatedTicket,
      id_motivo_contacto: updatedTicket.id_motivo_contacto ? Number(updatedTicket.id_motivo_contacto) : null
    };

    const nextTickets = db.tickets.map(t =>
      t.id_ticket === updatedTicket.id_ticket ? ticketToSave : t
    );

    const nextHistorial = [...db.historialEstados];

    if (originalTicket) {
      const estadoCambio = originalTicket.estado !== ticketToSave.estado;
      const motivoCambio = originalTicket.id_motivo_contacto !== ticketToSave.id_motivo_contacto;

      if (estadoCambio || motivoCambio) {
        const nextHistId = db.historialEstados.length > 0 ? Math.max(...db.historialEstados.map(h => h.id_historial)) + 1 : 1;
        // FIX v2.79 — NO usar new Date().toISOString() (zona horaria UTC).
        // Dejar vacío; el backend usa GETDATE() del servidor el sistema.
        const nowStr = "";

        let motivoTexto = "Modificación de ticket: ";
        if (estadoCambio) {
          motivoTexto += `Cambio de estado de ${originalTicket.estado} a ${ticketToSave.estado}. `;
        }
        if (motivoCambio) {
          const oldMotivo = db.motivosContacto?.find(m => m.id_motivo === originalTicket.id_motivo_contacto);
          const newMotivo = db.motivosContacto?.find(m => m.id_motivo === ticketToSave.id_motivo_contacto);
          motivoTexto += `Motivo de contacto cambiado de '${oldMotivo?.nombre || 'N/A'}' a '${newMotivo?.nombre || 'N/A'}'.`;
        }

        nextHistorial.push({
          id_historial: nextHistId,
          id_ticket: ticketToSave.id_ticket,
          estado_anterior: originalTicket.estado,
          estado_nuevo: ticketToSave.estado,
          fecha_cambio: nowStr,
          motivo: motivoTexto,
          id_usuario: currentUser.id_persona
        });
      }
    }

    const newDb: MockDatabase = {
      ...db,
      tickets: nextTickets,
      historialEstados: nextHistorial
    };

    if (useLocalSql) {
      const updateTicketUrl = getDynamicApiUrl("update_ticket");

      const payload = {
        id_ticket: ticketToSave.id_ticket,
        detalle_reporte: ticketToSave.detalle_reporte,
        prioridad: ticketToSave.prioridad,
        estado: ticketToSave.estado,
        medio_contacto: ticketToSave.medio_contacto,
        id_motivo_contacto: ticketToSave.id_motivo_contacto,
        id_usuario: ticketToSave.id_usuario || currentUser.id_persona,
        id_sucursal: ticketToSave.id_sucursal || null
      };


      fetch(updateTicketUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(res => {
          if (!res.ok) throw new Error(`Error de conexión`);
          return res.json();
        })
        .then(data => {
          if (data.status === "success") {

            // FIX v2.71 — Refrescar lista de tickets inmediatamente.
            fetchLocalSqlTickets();

            updateDb(newDb);
            // FIX: mantener el panel abierto con el ticket actualizado; nunca cerrar.
            setViewTicket(ticketToSave);
            // Refrescar la trazabilidad para que el historial muestre el motivo recién registrado.
            fetchTicketTraceability(ticketToSave.id_ticket);
          } else {
            throw new Error(data.message || "Error al actualizar el ticket en el servidor.");
          }
        })
        .catch(err => {
          console.error("Error al actualizar ticket :", err);
          notify("warning", "Sincronización pendiente", "No se pudo sincronizar con el servidor. Los cambios se guardaron localmente y se sincronizarán en el próximo intento.");
          updateDb(newDb);
          // FIX: mantener el panel abierto.
          setViewTicket(ticketToSave);
          fetchTicketTraceability(ticketToSave.id_ticket);
        });
    } else {
      updateDb(newDb);
      // FIX: mantener el panel abierto.
      setViewTicket(ticketToSave);
      fetchTicketTraceability(ticketToSave.id_ticket);
    }

    setEditingTicket(null);
    alert("¡TICKET ACTUALIZADO CON ÉXITO!");
  };

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formEmpresa || !formContacto || !formDetalle) {
      alert("Por favor complete los campos obligatorios (*)");
      return;
    }

    const currentYear = new Date().getFullYear();
    const currentYearTickets = db.tickets.filter(t => t.nro_ticket.startsWith(`${currentYear}-`));
    const nextCorrelativeNum = currentYearTickets.length + 1;
    const paddedCorrelative = String(nextCorrelativeNum).padStart(5, "0");
    const generatedNro = `${currentYear}-${paddedCorrelative}`;

    const newTicketId = db.tickets.length > 0 ? Math.max(...db.tickets.map(t => t.id_ticket)) + 1 : 1;
    // FIX v2.75 — NO usar new Date() del navegador (zona horaria UTC).
    // Dejar fechas vacías; el backend las calcula con GETDATE() del servidor el sistema.
    // Se llenarán cuando fetchLocalSqlTickets traiga los datos reales.

    const newTicket: Ticket = {
      id_ticket: newTicketId,
      nro_ticket: generatedNro,
      fecha_registro: new Date().toISOString().substring(0, 10),
      hora_registro: new Date().toTimeString().substring(0, 8),
      // FIX v2.93 — Si el usuario marcó "cerrar como RESUELTO", el ticket
      // aparece inmediatamente con estado RESUELTO (no PENDIENTE).
      fecha_cierre: formAtenderAhora && formCerrarTicket ? new Date().toISOString().substring(0, 10) : null,
      hora_cierre: formAtenderAhora && formCerrarTicket ? new Date().toTimeString().substring(0, 8) : null,
      id_usuario: currentUser.id_persona,
      id_empresa_contacto: parseInt(formContacto),
      id_empresa: parseInt(formEmpresa),
      id_sucursal: formSucursal ? parseInt(formSucursal) : null,
      detalle_reporte: formDetalle,
      prioridad: formPrioridad,
      // FIX v2.93 — Estado inicial correcto según las opciones del usuario.
      estado: formAtenderAhora && formCerrarTicket ? "RESUELTO" : "PENDIENTE",
      medio_contacto: formMedioContacto,
      id_motivo_contacto: formMotivo ? parseInt(formMotivo) : null
    };

    const newHistoryId = db.historialEstados.length > 0 ? Math.max(...db.historialEstados.map(h => h.id_historial)) + 1 : 1;
    const initialStatus = formAtenderAhora && formCerrarTicket ? "RESUELTO" : "PENDIENTE";
    const newHistory: TicketHistorialEstado = {
      id_historial: newHistoryId,
      id_ticket: newTicketId,
      estado_anterior: "PENDIENTE",
      estado_nuevo: initialStatus,
      id_usuario: currentUser.id_persona,
      motivo: initialStatus === "RESUELTO" ? "Ticket resuelto al registrar." : "Creación inicial del ticket.",
      fecha_cambio: ""
    };

    let updatedArchivos = [...db.archivos];
    let updatedTicketArchivos = [...db.ticketArchivos];

    formFiles.forEach((file, index) => {
      const nextFileId = updatedArchivos.length > 0 ? Math.max(...updatedArchivos.map(a => a.id_archivo)) + 1 : 1;
      const sysName = `usr-${currentUser.id_persona}-${Date.now()}-${index}.${file.name.split('.').pop()}`;
      const checksum = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

      const newFileObj: Archivo = {
        id_archivo: nextFileId,
        nombre_original: file.name,
        nombre_sistema: sysName,
        ruta: `/uploads/tickets/${newTicketId}/${sysName}`,
        tipo_mime: file.type || "application/octet-stream",
        extension: file.name.split('.').pop() || "",
        tamano_bytes: file.size,
        tamano_formato: (file.size / (1024 * 1024)).toFixed(2) + " MB",
        checksum: checksum,
        id_usuario_subio: currentUser.id_persona,
        fecha_subida: "" /* El backend usa GETDATE() */,
        estado: true,
        // FIX v2.1: NO guardar base64Content en memoria — el backend ya lo tiene.
        base64Content: undefined
      };

      const newTicketFileObj = {
        id_ticket_archivo: updatedTicketArchivos.length + 1,
        id_ticket: newTicketId,
        id_archivo: nextFileId,
        tipo_evidencia: "REPORTE_INICIAL" as const
      };

      updatedArchivos.push(newFileObj);
      updatedTicketArchivos.push(newTicketFileObj);
    });

    const newDb: MockDatabase = {
      ...db,
      tickets: [newTicket, ...db.tickets],
      historialEstados: [newHistory, ...db.historialEstados],
      archivos: updatedArchivos,
      ticketArchivos: updatedTicketArchivos
    };

    const getCreateApiUrl = () => {
      // FIX v2.91.3 — Desactivado el endpoint combinado. Usar 'create' normal.
      const USE_COMBINED_ENDPOINT = false;
      if (USE_COMBINED_ENDPOINT && formAtenderAhora && formAtencionDetalle.trim()) {
        return getDynamicApiUrl("create_with_attention");
      }
      return getDynamicApiUrl("create");
    };

    if (useLocalSql) {
      // FIX v2.32 — Resolver correo destino desde el contacto seleccionado.
      const contactoSeleccionado = db.contactosEmpresariales.find(
        c => c.id_empresa_contacto === parseInt(formContacto)
      );
      const personaContacto = contactoSeleccionado
        ? db.personas.find(p => p.id_persona === contactoSeleccionado.id_persona)
        : null;
      // FIX v2.66 — Resolver correos según selección específica del usuario.
      let correoDestino = "";
      if (formNotificarContacto) {
        const contactoNotif = formContactoNotifId
          ? db.contactosEmpresariales.find(c => c.id_empresa_contacto === parseInt(formContactoNotifId))
          : contactoSeleccionado;
        const personaContactoNotif = contactoNotif
          ? db.personas.find(p => p.id_persona === contactoNotif.id_persona)
          : null;
        correoDestino = contactoNotif?.correo_empresa || personaContactoNotif?.correo || "";
      }
      let correoUsuarioSistema = "";
      if (formNotificarUsuario) {
        const usuarioSel = formUsuarioNotifId
          ? db.personas.find(p => p.id_persona === parseInt(formUsuarioNotifId))
          : currentUser;
        correoUsuarioSistema = usuarioSel?.correo || "";
      }

      // FIX v2.91.3 — Construir el body AQUÍ (después de que correoDestino y
      // correoUsuarioSistema estén definidos) y SIN los campos de atención extra.
      const requestBody: any = {
        id_empresa: parseInt(formEmpresa),
        id_empresa_contacto: parseInt(formContacto),
        id_sucursal: formSucursal ? parseInt(formSucursal) : null,
        detalle_reporte: formDetalle,
        prioridad: formPrioridad,
        medio_contacto: formMedioContacto,
        id_usuario: currentUser.id_persona,
        id_motivo_contacto: formMotivo ? parseInt(formMotivo) : null,
        enviar_correo: formEnviarCorreo,
        notificar_contacto: formNotificarContacto,
        notificar_usuario: formNotificarUsuario,
        correo_destino: correoDestino,
        correo_usuario: correoUsuarioSistema,
        detalle_atencion: formAtenderAhora ? formAtencionDetalle.trim() : "",
        solucion_aplicada: formAtenderAhora ? formAtencionSolucion || "" : "",
        cerrar_ticket: formAtenderAhora && formCerrarTicket,
        fecha_inicio: formAtenderAhora ? formAtencionFechaInicio || null : null,
        hora_inicio: formAtenderAhora ? formAtencionHoraInicio || null : null,
        fecha_fin: formAtenderAhora && formCerrarTicket ? formAtencionFechaFin || null : null,
        hora_fin: formAtenderAhora && formCerrarTicket ? formAtencionHoraFin || null : null
      };

      fetch(getCreateApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      })
        .then(res => {
          if (!res.ok) throw new Error(`Error de conexión`);
          return res.json();
        })
        .then(data => {
          if (data.status === "success") {
            // FIX v2.66 — Mensaje detallado según destinatarios.
            let correoMsg = "";
            if (formEnviarCorreo) {
              const destinos = [];
              if (formNotificarContacto && correoDestino) destinos.push(`Contacto: ${correoDestino}`);
              if (formNotificarUsuario && correoUsuarioSistema) destinos.push(`Usuario: ${correoUsuarioSistema}`);
              if (destinos.length > 0) {
                correoMsg = `\n\n📧 Notificación enviada a:\n${destinos.map(d => "  • " + d).join("\n")}`;
              }
            }
            const ticketId = parseInt(data.id_ticket);
            const nroTicket = data.nro_ticket || "";
            if (!Number.isFinite(ticketId) || ticketId <= 0) {
              throw new Error("No se recibió el número del ticket.");
            }

            // FIX v2.111 — Si el backend devolvió whatsapp_url, abrir WhatsApp.
            if (data.whatsapp_url) {
              setTimeout(() => {
                window.open(data.whatsapp_url, '_blank');
              }, 500);
            }

            const resolvedTicket = formAtenderAhora && formCerrarTicket;
            const savedTicket = {
              ...newTicket,
              id_ticket: ticketId,
              nro_ticket: nroTicket || newTicket.nro_ticket,
              estado: resolvedTicket ? "RESUELTO" as const : newTicket.estado,
              fecha_cierre: resolvedTicket ? newTicket.fecha_cierre : null,
              hora_cierre: resolvedTicket ? newTicket.hora_cierre : null,
            };
            const savedHistory = { ...newHistory, id_ticket: ticketId };
            const hasAttention = formAtenderAhora && !!formAtencionDetalle.trim();
            const savedAttention: Atencion | null = hasAttention ? {
              id_atencion: Math.max(0, ...db.atenciones.map(attention => attention.id_atencion)) + 1,
              id_ticket: ticketId,
              id_usuario: currentUser.id_persona,
              fecha_inicio: formAtencionFechaInicio || null,
              hora_inicio: formAtencionHoraInicio || null,
              fecha_fin: resolvedTicket ? formAtencionFechaFin || null : null,
              hora_fin: resolvedTicket ? formAtencionHoraFin || null : null,
              detalle_atencion: formAtencionDetalle,
              solucion_aplicada: formAtencionSolucion || null,
              estado: resolvedTicket ? "COMPLETADO" : "EN_PROCESO",
            } : null;
            const confirmedDb = {
              ...newDb,
              tickets: [savedTicket, ...db.tickets.filter(ticket => Number(ticket.id_ticket) !== ticketId)],
              historialEstados: [savedHistory, ...db.historialEstados],
              atenciones: savedAttention ? [savedAttention, ...db.atenciones] : db.atenciones,
              ticketArchivos: [
                ...db.ticketArchivos,
                ...updatedTicketArchivos.slice(db.ticketArchivos.length).map(file => ({ ...file, id_ticket: ticketId })),
              ],
            };
            updateDb(confirmedDb);
            setLocalSqlTickets(prev => [savedTicket, ...prev.filter(ticket => Number(ticket.id_ticket) !== ticketId)]);
            setCurrentPage(1);
            fetchLocalSqlTickets();

            const filesToUpload = formFiles.filter(file => file.base64Content);
            if (filesToUpload.length > 0) {
              void Promise.all(filesToUpload.map(async file => {
                const response = await fetch(getDynamicApiUrl("upload_file"), {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id_ticket: ticketId,
                    id_usuario: currentUser.id_persona,
                    tipo_evidencia: "REPORTE_INICIAL",
                    file: { name: file.name, type: file.type || "application/octet-stream", size: file.size, base64Content: file.base64Content },
                  }),
                });
                const uploadData = await response.json();
                if (!response.ok || uploadData.status !== "success") throw new Error("No se pudo adjuntar un archivo.");
              })).then(() => {
                fetchLocalSqlTickets();
                if (Number(viewTicket?.id_ticket) === ticketId) fetchTicketTraceability(ticketId);
              }).catch(error => {
                logTechnicalError(error, { url: getDynamicApiUrl("upload_file"), sqlStatus: "TICKET_UPLOAD_FAIL", currentUser });
                notify("warning", "Ticket registrado", "El ticket se guardó, pero no se pudieron adjuntar todos los archivos.");
              });
            }

            // Mostrar notificación INMEDIATAMENTE (no esperar al async)
            let accionMsg = "";
            if (formAtenderAhora && formCerrarTicket) accionMsg = "\n\n🔧 Ticket atendido y cerrado como RESUELTO.";
            else if (formAtenderAhora) accionMsg = "\n\n🔧 Atención registrada.";

            notify(
              "success",
              "Ticket registrado",
              `Ticket ${nroTicket} registrado exitosamente.${correoMsg}${accionMsg}`
            );
          } else {
            throw new Error(data.message || "Error al guardar el ticket.");
          }
        })
        .catch(err => {
          logTechnicalError(err, { url: "/api_tickets.php?action=create", sqlStatus: "TICKET_CREATE_FAIL", currentUser });
          // FIX v2.89.1 — Mensaje más detallado para diagnóstico
          notify(
            "error",
            "No se pudo registrar el ticket",
            "Revise los datos e inténtelo nuevamente."
          );
        });
    } else {
      updateDb(newDb);
    }

    setShowCreateModal(false);

    setFormEmpresa("");
    setFormSucursal("");
    setFormContacto("");
    setFormPrioridad("MEDIA");
    setFormDetalle("");
    setFormFiles([]);
    setFormEnviarCorreo(true);
    setFormNotificarContacto(false);
    setFormNotificarUsuario(false);
    setFormContactoNotifId("");
    setFormUsuarioNotifId("");
    setFormAtenderAhora(false);
    setFormAtencionDetalle("");
    setFormAtencionSolucion("");
    setFormCerrarTicket(false);
    // FIX v2.81 — Limpiar horas explícitas de atención.
    setFormAtencionFechaInicio("");
    setFormAtencionHoraInicio("");
    setFormAtencionFechaFin("");
    setFormAtencionHoraFin("");
  };

  const handleAddDummyFile = () => {
    const names = [
      "error-pantalla.png", "log-servidor-iis.txt", "factura-pos-fallido.pdf",
      "captura-cobertura.jpg"
    ];
    const pickName = names[Math.floor(Math.random() * names.length)];
    const extension = pickName.split('.').pop() || "txt";
    const mimes: { [key: string]: string } = {
      png: "image/png", jpg: "image/jpeg", txt: "text/plain", pdf: "application/pdf"
    };

    const dummyBase64s: { [key: string]: string } = {
      png: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      jpg: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
      txt: "data:text/plain;charset=utf-8;base64,U0lTVEVNQSBESUNPTiBTT1BPUlRFIC0gQVJDSElWTyBERSBERU1PU1RSQUNJT04=",
      pdf: "data:application/pdf;base64,JVBERi0xLjUKMSAwIG9iagogIDw8IC9UeXBlIC9DYXRhbG9nCiAgICAgL1BhZ2VzIDIgMCBSCiAgPj4KZW5kb2JqCjIgMCBvYmoKICA8PCAvVHlwZSAvUGFnZXMKICAgICAvS2lkcyBbIDMgMCBSIF0KICAgICAvQ291bnQgMQogID4+CmVuZG9iagozIDAgb2JqCiAgPDwgL1R5cGUgL1BhZ2UKICAgICAvUGFyZW50IDIgMCBSCiAgICAgL01lZGlhQm94IFsgMCAwIDU5NSA4NDIgXQogICAgIC9SZXNvdXJjZXMgPDwKICAgICAgIC9Gb250IDw8CiAgICAgICAgIC9GMSA0IDAgUgogICAgICAgPj4KICAgICA+PgogICAgIC9Db250ZW50cyA1IDAgUgogID4+CmVuZG9iago0IDAgb2JqCiAgPDwgL1R5cGUgL0ZvbnQKICAgICAvU3VidHlwZSAvVHlwZTEKICAgICAvQmFzZUZvbnQgL0hlbHZldGljYQogID4+CmVuZG9iago1IDAgb2JqCiAgPDwgL0xlbmd0aCA0NCA+PgpzdHJlYW0KQlQgL0YxIDEyIFRmIDUwIDcwMCBUZCAoRklSTUEgRElDT04gLSBFVklERU5DSUEgREVNTykgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIGYgCjAwMDAwMDAyMzEgMDAwMDAgbiAKMDAwMDAwMjg4OCAwMDAwMCBuIAp0cmFpbGVyCiAgPDwgL1NpemUgNgogICAgIC9Sb290IDEgMCBSCiAgPj4Kc3RhcnR4cmVmCjI5OTIKJSVFT0Y="
    };

    const size = Math.floor(Math.random() * 3200000 + 40000);
    setFormFiles([...formFiles, {
      name: pickName,
      size: size,
      type: mimes[extension],
      base64Content: dummyBase64s[extension]
    }]);
  };

  const initiateStatusChange = (newStatus: TicketEstado) => {
    setStatusChangeTarget(newStatus);
    setStatusChangeReason("");
    setShowStatusChangeModal(true);
  };

  const handleApplyStatusChange = () => {
    if (!viewTicket || !statusChangeTarget) return;
    if (!statusChangeReason.trim()) {
      alert("Por favor ingrese el motivo del cambio de estado para la auditoría.");
      return;
    }

    // MARCADOR DE VERSIÓN — si no ves este log, sigues con el bundle antiguo

    const previousStatus = viewTicket.estado;
    // FIX v2.75 — NO usar new Date() del navegador. El backend usa GETDATE().
    // Las fechas se actualizarán cuando fetchLocalSqlTickets traiga los datos reales.

    let targetState: TicketEstado = statusChangeTarget;
    let clearingCierre = false;
    if (statusChangeTarget === "REABIERTO") {
      targetState = "PENDIENTE";
      clearingCierre = true;
    }

    const updatedTickets = db.tickets.map(t => {
      if (t.id_ticket === viewTicket.id_ticket) {
        return {
          ...t,
          estado: targetState,
          // FIX v2.75 — No poner fechas de JS; el backend las calcula con GETDATE().
          fecha_cierre: clearingCierre ? null : t.fecha_cierre,
          hora_cierre: clearingCierre ? null : t.hora_cierre
        };
      }
      return t;
    });

    const nextHistId = db.historialEstados.length > 0 ? Math.max(...db.historialEstados.map(h => h.id_historial)) + 1 : 1;
    const newHistoryRecord: TicketHistorialEstado = {
      id_historial: nextHistId,
      id_ticket: viewTicket.id_ticket,
      estado_anterior: previousStatus,
      estado_nuevo: targetState,
      id_usuario: currentUser.id_persona,
      motivo: statusChangeTarget === "REABIERTO" ? `[REAPERTURA DE TICKET] ${statusChangeReason.trim()}` : statusChangeReason.trim(),
      fecha_cambio: "" /* El backend usa GETDATE() */
    };

    const newDb: MockDatabase = {
      ...db,
      tickets: updatedTickets,
      historialEstados: [newHistoryRecord, ...db.historialEstados]
    };

    const getUpdateStatusApiUrl = () => {
      return getDynamicApiUrl("update_status");
    };

    if (useLocalSql) {
      fetch(getUpdateStatusApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_ticket: viewTicket.id_ticket,
          estado: statusChangeTarget,
          motivo: statusChangeReason.trim(),
          id_usuario: currentUser.id_persona,
          // FIX v2.78 — Enviar flag de notificación según checkbox del modal.
          notificar_cierre: formNotificarCierre && (statusChangeTarget === "CERRADO" || statusChangeTarget === "RESUELTO")
        })
      })
        .then(res => {
          if (!res.ok) throw new Error(`Error de conexión`);
          return res.json();
        })
        .then(data => {
          if (data.status === "success") {
            notify("success", "Estado actualizado", `El ticket ha cambiado a: ${statusChangeTarget.replace(/_/g, " ")}.`);
            updateDb(newDb);

            // FIX v2.81 — Refrescar la lista de tickets Y el árbol de datos
            // mediante sync_light, sin necesidad de F5. sync_light es ligero
            // y no bloquea la UI (a diferencia del antiguo sync_all).

            // FIX: mantener el panel abierto con el estado actualizado localmente.
            const refreshedTicket = updatedTickets.find(t => t.id_ticket === viewTicket.id_ticket)
              || (viewTicket ? { ...viewTicket, estado: targetState } : null);
            setViewTicket(refreshedTicket);
            // Refrescar trazabilidad después de 300ms (no bloquea la UI).
            setTimeout(() => fetchTicketTraceability(viewTicket.id_ticket), 300);
          } else {
            throw new Error(data.message || "Error al actualizar el estado del ticket.");
          }
        })
        .catch(err => {
          logTechnicalError(err, { url: "/api_tickets.php?action=update_estado", sqlStatus: "TICKET_UPDATE_ESTADO_FAIL", currentUser });
          notify(
            "error",
            "Error al actualizar estado",
            `No fue posible actualizar el estado del ticket .\n\nDetalle: ${err?.message || "Error de conexión"}`
          );
          // No actualizar estado localmente — debe quedar registrado en la BD.
          // Mantenemos el panel abierto con el viewTicket original para que el usuario reintente.
          setViewTicket(viewTicket);
          fetchTicketTraceability(viewTicket.id_ticket);
        });
    } else {
      updateDb(newDb);
      // FIX: mantener el panel abierto.
      const refreshedTicket = updatedTickets.find(t => t.id_ticket === viewTicket.id_ticket)
        || (viewTicket ? { ...viewTicket, estado: targetState, fecha_cierre: clearingCierre ? null : viewTicket.fecha_cierre, hora_cierre: clearingCierre ? null : viewTicket.hora_cierre } : null);
      setViewTicket(refreshedTicket);
      fetchTicketTraceability(viewTicket.id_ticket);
    }

    setShowStatusChangeModal(false);
    setStatusChangeTarget(null);
    setStatusChangeReason("");
  };

  const handleSaveMotivo = () => {
    if (!motivoForm.nombre || motivoForm.nombre.trim() === '') {
      alert("El nombre del motivo es obligatorio.");
      return;
    }

    // MARCADOR DE VERSIÓN

    // FIX CRÍTICO: Para CREAR un motivo nuevo (editingMotivo === null), enviar id_motivo: null
    // y dejar que el sistema asigne el ID autoincremental con SCOPE_IDENTITY().
    // Antes se enviaba id_motivo = (length+1) lo que hacía que el PHP ejecutara UPDATE
    // en lugar de INSERT (porque id_motivo !== null && !== 0), y el motivo NUNCA se creaba.
    const isCreating = !editingMotivo;
    const idMotivoToSend = isCreating ? null : editingMotivo!.id_motivo;

    const newMotivo: MotivoContacto = {
      id_motivo: editingMotivo?.id_motivo ?? 0,  // 0 temporal; el backend lo reasignará
      nombre: motivoForm.nombre.trim(),
      descripcion: motivoForm.descripcion || null,
      activo: motivoForm.activo ?? true,
      orden: motivoForm.orden ?? 0
    };

    let updatedMotivos = [...(db.motivosContacto || [])];
    if (editingMotivo) {
      updatedMotivos = updatedMotivos.map(m => m.id_motivo === editingMotivo.id_motivo ? newMotivo : m);
    } else {
      updatedMotivos.push(newMotivo);
    }

    const newDb: MockDatabase = {
      ...db,
      motivosContacto: updatedMotivos
    };

    const payload = {
      id_motivo: idMotivoToSend,
      nombre: newMotivo.nombre,
      descripcion: newMotivo.descripcion,
      activo: newMotivo.activo,
      orden: newMotivo.orden
    };

    if (useLocalSql) {
      const saveMotivoUrl = getDynamicApiUrl("save_motivo");
      fetch(saveMotivoUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(res => {
          // FIX: capturar HTTP errors y leer el body del error para mostrar al usuario
          if (!res.ok) {
            return res.json().catch(() => ({})).then(errBody => {
              throw new Error(errBody.message || `Error de conexión`);
            });
          }
          return res.json();
        })
        .then(data => {
          if (data.status === "success") {
            // FIX v2.9: NO llamar onSync() — eso recargaría toda la página y cerraría el panel.
            // Solo actualizar la lista de tickets localmente.
            updateDb(newDb);

            // FIX v2.71 — Refrescar lista de tickets inmediatamente.

            alert("Motivo guardado exitosamente.");
          } else {
            // FIX: el backend respondió pero con status error — mostrar al usuario
            const msg = data.message || "Error desconocido al guardar el motivo.";
            console.error("[TicketManager v2.9 FIX] backend respondió error:", msg, data);
            alert("ERROR al guardar el motivo:\n\n" + msg + "\n\nRevise la consola para más detalles.");
          }
        })
        .catch(err => {
          console.error("%c[TicketManager v2.9 FIX] Error de red/HTTP al guardar motivo:", "color:#dc2626;font-weight:bold;", err);
          alert("ERROR de conexión al guardar el motivo:\n\n" + (err?.message || err) + "\n\nVerifique que api_tickets.php esté actualizado y el IIS esté corriendo.");
        });
    } else {
      // FIX v2.4: La rama else solo se ejecuta si useLocalSql=false. Como ahora SIEMPRE
      // es true, esta rama nunca se ejecuta. La dejamos por seguridad pero indicando
      // que NO se guardó en la BD.
      alert("No se pudo guardar el motivo. Verifique su conexión.");
    }

    setShowMotivoModal(false);
    setEditingMotivo(null);
    setMotivoForm({ nombre: '', descripcion: '', activo: true, orden: 0 });
  };

  const handleDeleteMotivo = (id_motivo: number) => {
    if (!confirm("¿Está seguro de eliminar este motivo? Esta acción no se puede deshacer.")) return;


    const updatedMotivos = (db.motivosContacto || []).filter(m => m.id_motivo !== id_motivo);
    const newDb: MockDatabase = {
      ...db,
      motivosContacto: updatedMotivos
    };

    if (useLocalSql) {
      const deleteMotivoUrl = getDynamicApiUrl("delete_motivo");
      fetch(deleteMotivoUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_motivo })
      })
        .then(res => {
          if (!res.ok) {
            return res.json().catch(() => ({})).then(errBody => {
              throw new Error(errBody.message || `Error de conexión`);
            });
          }
          return res.json();
        })
        .then(data => {
          if (data.status === "success") {
            updateDb(newDb);

            // FIX v2.71 — Refrescar lista de tickets inmediatamente.

            alert("Motivo eliminado: " + (data.message || 'OK'));
          } else {
            const msg = data.message || "Error desconocido al eliminar el motivo.";
            console.error("[TicketManager v2.9 FIX] backend respondió error:", msg, data);
            alert("ERROR al eliminar el motivo:\n\n" + msg);
          }
        })
        .catch(err => {
          console.error("%c[TicketManager v2.9 FIX] Error de red/HTTP al eliminar motivo:", "color:#dc2626;font-weight:bold;", err);
          alert("ERROR de conexión al eliminar el motivo:\n\n" + (err?.message || err));
        });
    } else {
      // FIX v2.4: La rama else solo se ejecuta si useLocalSql=false. Como ahora SIEMPRE
      // es true, esta rama nunca se ejecuta. La dejamos por seguridad pero indicando
      // que NO se eliminó en la BD.
      alert("No se pudo eliminar el motivo. Verifique su conexión.");
    }
  };

  const handleAddAttention = (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewTicket) return;
    if (!attentionDetalle.trim()) {
      alert("Debe ingresar el detalle de las operaciones técnicas efectuadas.");
      return;
    }

    // MARCADOR DE VERSIÓN — si no ves este log, sigues con el bundle antiguo

    const nextAtencionId = db.atenciones.length > 0 ? Math.max(...db.atenciones.map(a => a.id_atencion)) + 1 : 1;

    const newAtencion: Atencion = {
      id_atencion: nextAtencionId,
      id_ticket: viewTicket.id_ticket,
      id_usuario: parseInt(attentionTechValue),
      fecha_inicio: attentionInicioFecha,
      hora_inicio: attentionInicioHora + ":00",
      fecha_fin: attentionEstado === "COMPLETADO" ? attentionFinFecha : null,
      hora_fin: attentionEstado === "COMPLETADO" ? attentionFinHora + ":00" : null,
      detalle_atencion: attentionDetalle,
      solucion_aplicada: attentionSolucion || null,
      estado: attentionEstado
    };

    let updatedTimesList = [...db.atencionesTiempo];
    // FIX: NO mutar db.tickets ni db.historialEstados directamente.
    // Construir arreglos nuevos inmutables para respetar el ciclo de React.
    let updatedTicketsList = [...db.tickets];
    let updatedHistorialList = [...db.historialEstados];
    let newTicketEstado = viewTicket.estado;
    let newTicketFechaCierre = viewTicket.fecha_cierre;
    let newTicketHoraCierre = viewTicket.hora_cierre;

    if (attentionEstado === "COMPLETADO") {
      const dt1 = new Date(`${attentionInicioFecha}T${attentionInicioHora}:00`);
      const dt2 = new Date(`${attentionFinFecha}T${attentionFinHora}:00`);
      let diffMs = dt2.getTime() - dt1.getTime();
      if (diffMs < 0) diffMs = 0;

      const totalMins = Math.floor(diffMs / (1000 * 60));
      const hoursDec = parseFloat((totalMins / 60).toFixed(2));

      const hPart = Math.floor(totalMins / 60);
      const mPart = totalMins % 60;
      const formattedRepr = `${hPart}h ${String(mPart).padStart(2, "0")}m`;

      const newTimeNode: AtencionTiempo = {
        id_atencion: nextAtencionId,
        duracion_minutos: totalMins,
        duracion_horas: hoursDec,
        duracion_formato: formattedRepr
      };
      updatedTimesList.push(newTimeNode);

      if (viewTicket.estado === "PENDIENTE" || viewTicket.estado === "EN_ATENCION") {
        const nowStrDate = ""; // FIX v2.75 — El backend usa GETDATE()
        const nowStrTime = ""; // FIX v2.75 — El backend usa GETDATE()

        updatedTicketsList = updatedTicketsList.map(t => {
          if (t.id_ticket === viewTicket.id_ticket) {
            return {
              ...t,
              estado: "RESUELTO" as TicketEstado,
              fecha_cierre: nowStrDate,
              hora_cierre: nowStrTime
            };
          }
          return t;
        });

        const nextHistId = updatedHistorialList.length > 0 ? Math.max(...updatedHistorialList.map(h => h.id_historial)) + 1 : 1;
        const autoHistoryRecord: TicketHistorialEstado = {
          id_historial: nextHistId,
          id_ticket: viewTicket.id_ticket,
          estado_anterior: viewTicket.estado,
          estado_nuevo: "RESUELTO",
          id_usuario: currentUser.id_persona,
          motivo: "El ticket fue marcado como resuelto tras completarse la atención técnica.",
          fecha_cambio: "" /* El backend usa GETDATE() */
        };
        updatedHistorialList = [autoHistoryRecord, ...updatedHistorialList];

        newTicketEstado = "RESUELTO";
        newTicketFechaCierre = nowStrDate;
        newTicketHoraCierre = nowStrTime;
      }
    }

    if (attentionEstado === "EN_PROCESO" && viewTicket.estado === "PENDIENTE") {
      const nowStrDate = ""; // FIX v2.75 — El backend usa GETDATE()
      const nowStrTime = ""; // FIX v2.75 — El backend usa GETDATE()

      updatedTicketsList = updatedTicketsList.map(t => {
        if (t.id_ticket === viewTicket.id_ticket) return { ...t, estado: "EN_ATENCION" as TicketEstado };
        return t;
      });

      const nextHistId = updatedHistorialList.length > 0 ? Math.max(...updatedHistorialList.map(h => h.id_historial)) + 1 : 1;
      const autoHistoryRecord: TicketHistorialEstado = {
        id_historial: nextHistId,
        id_ticket: viewTicket.id_ticket,
        estado_anterior: "PENDIENTE",
        estado_nuevo: "EN_ATENCION",
        id_usuario: currentUser.id_persona,
        motivo: "El ticket pasó a estar en atención al iniciarse los trabajos técnicos.",
        fecha_cambio: "" /* El backend usa GETDATE() */
      };
      updatedHistorialList = [autoHistoryRecord, ...updatedHistorialList];

      newTicketEstado = "EN_ATENCION";
    }

    const newDb: MockDatabase = {
      ...db,
      tickets: updatedTicketsList,
      historialEstados: updatedHistorialList,
      atenciones: [...db.atenciones, newAtencion],
      atencionesTiempo: updatedTimesList
    };

    const getCreateAttentionUrl = () => {
      return getDynamicApiUrl("create_attention");
    };

    // FIX: Helper local para garantizar que el panel NUNCA se cierre.
    // Si el ticket no está en db.tickets (modo SQL), usamos el viewTicket actual
    // con el estado actualizado como fallback.
    const buildRefreshedTicket = (): Ticket | null => {
      const found = updatedTicketsList.find(t => getTicketIdVal(t) === getTicketIdVal(viewTicket));
      if (found) return found;
      if (!viewTicket) return null;
      return {
        ...viewTicket,
        estado: newTicketEstado,
        fecha_cierre: newTicketFechaCierre,
        hora_cierre: newTicketHoraCierre
      };
    };

    if (useLocalSql) {
      fetch(getCreateAttentionUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_ticket: getTicketIdVal(viewTicket),
          id_usuario: parseInt(attentionTechValue),
          detalle_atencion: attentionDetalle,
          solucion_aplicada: attentionSolucion || null,
          estado: attentionEstado,
          fecha_inicio: attentionInicioFecha,
          hora_inicio: attentionInicioHora + ":00",
          fecha_fin: attentionEstado === "COMPLETADO" ? attentionFinFecha : null,
          hora_fin: attentionEstado === "COMPLETADO" ? attentionFinHora + ":00" : null
        })
      })
        .then(res => res.json())
        .then(data => {
          if (data.status === "success") {
            notify("success", "Atención registrada", "La atención técnica ha sido registrada con éxito.");
            updateDb(newDb);

            // FIX v2.71 — Refrescar lista de tickets inmediatamente.

            // FIX: mantener el panel abierto SIEMPRE.
            setViewTicket(buildRefreshedTicket());
            // Refrescar trazabilidad para que el historial muestre el motivo recién guardado.
            fetchTicketTraceability(getTicketIdVal(viewTicket) as number);
          } else {
            logTechnicalError(new Error(data.message || "Error al guardar atención técnica."), {
              url: "/api_tickets.php?action=add_atencion",
              sqlStatus: "ATTENTION_ADD_FAIL",
              currentUser,
              customInfo: { data }
            });
            // FIX v2.4: NO usar modo simulación. La atención debe registrarse en la BD.
            alert("No se pudo registrar la atención. " + (data.message || "Error del servidor") + "");
            // No actualizar localmente — la atención debe registrarse en la BD.
          }
        })
        .catch(err => {
          logTechnicalError(err, { url: "/api_tickets.php?action=add_atencion", sqlStatus: "ATTENTION_ADD_HTTP_ERROR", currentUser });
          // FIX v2.4: NO usar modo simulación. La atención debe registrarse en la BD.
          alert("No se pudo conectar con el servidor. " + (err?.message || "Error de conexión") + "");
        });
    } else {
      updateDb(newDb);
      setViewTicket(buildRefreshedTicket());
      fetchTicketTraceability(getTicketIdVal(viewTicket) as number);
    }

    // FIX: Solo cerrar el SUB-modal de atención, NO el panel principal del ticket.
    setShowAddAttentionModal(false);
    setAttentionDetalle("");
    setAttentionSolucion("");
    setAttentionEstado("EN_PROCESO");
  };

  const handleSaveEditAttention = (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewTicket || !editingAttention) return;
    if (!editAttentionDetalle.trim()) {
      alert("Debe ingresar el detalle de las operaciones técnicas.");
      return;
    }

    const updatedAttentions = db.atenciones.map(at => {
      if (at.id_atencion === editingAttention.id_atencion) {
        return {
          ...at,
          detalle_atencion: editAttentionDetalle,
          solucion_aplicada: editAttentionSolucion || null
        };
      }
      return at;
    });

    const newDb: MockDatabase = {
      ...db,
      atenciones: updatedAttentions
    };

    const getUpdateAttentionUrl = () => {
      return getDynamicApiUrl("update_attention");
    };

    if (useLocalSql) {
      fetch(getUpdateAttentionUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_atencion: editingAttention.id_atencion,
          detalle_atencion: editAttentionDetalle,
          solucion_aplicada: editAttentionSolucion || null
        })
      })
        .then(res => res.json())
        .then(data => {
          if (data.status === "success") {
            alert("Atención técnica modificada con éxito.");
            updateDb(newDb);

            // FIX v2.71 — Refrescar lista de tickets inmediatamente.

            // FIX: mantener el panel abierto. Fallback al viewTicket actual si no está en db.tickets.
            const refreshedTicket = newDb.tickets.find(t => getTicketIdVal(t) === getTicketIdVal(viewTicket)) || viewTicket;
            setViewTicket(refreshedTicket);
            fetchTicketTraceability(getTicketIdVal(viewTicket) as number);
          } else {
            logTechnicalError(new Error(data.message || "Error al modificar la atención técnica."), {
              url: "/api_tickets.php?action=edit_atencion",
              sqlStatus: "ATTENTION_EDIT_FAIL",
              currentUser,
              customInfo: { data }
            });
            // FIX v2.4: NO usar modo simulación. La modificación debe registrarse en la BD.
            alert("No se pudo modificar la atención. " + (data.message || "Error del servidor") + "\n\nLa operación NO fue completada.");
          }
        })
        .catch(err => {
          logTechnicalError(err, { url: "/api_tickets.php?action=edit_atencion", sqlStatus: "ATTENTION_EDIT_HTTP_ERROR", currentUser });
          // FIX v2.4: NO usar modo simulación.
          alert("No se pudo conectar con el servidor. " + (err?.message || "Error de conexión") + "\n\nLa operación NO fue completada.");
        });
    } else {
      updateDb(newDb);
      // FIX: mantener el panel abierto.
      const refreshedTicket = newDb.tickets.find(t => getTicketIdVal(t) === getTicketIdVal(viewTicket)) || viewTicket;
      setViewTicket(refreshedTicket);
      fetchTicketTraceability(getTicketIdVal(viewTicket) as number);
    }

    setEditingAttention(null);
  };

  const handleUploadFileSimulation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewTicket || !fileToUpload) return;

    // MARCADOR DE VERSIÓN — si no ves este log, sigues con el bundle antiguo

    const performUpload = (base64: string, finalSize: number) => {
      const nextFileId = db.archivos.length > 0 ? Math.max(...db.archivos.map(a => a.id_archivo)) + 1 : 1;
      const sysName = `usr-${currentUser.id_persona}-${Date.now()}.${fileToUpload.name.split('.').pop()}`;
      const checksum = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const nowStrDate = ""; // FIX v2.75 — El backend usa GETDATE()
      const nowStrTime = ""; // FIX v2.75 — El backend usa GETDATE()

      const ticketIdVal = getTicketIdVal(viewTicket);
      const newFileObj: Archivo = {
        id_archivo: nextFileId,
        nombre_original: fileToUpload.name,
        nombre_sistema: sysName,
        ruta: `/uploads/tickets/${ticketIdVal}/${sysName}`,
        tipo_mime: fileToUpload.type || "application/octet-stream",
        extension: fileToUpload.name.split('.').pop() || "bin",
        tamano_bytes: finalSize,
        tamano_formato: (finalSize / (1024 * 1024)).toFixed(2) + " MB",
        checksum: checksum,
        id_usuario_subio: currentUser.id_persona,
        fecha_subida: "" /* El backend usa GETDATE() */,
        estado: true,
        // FIX v2.1: NO guardar base64Content en el estado de React (db.archivos).
        // El base64 ya se envió al backend y está guardado .
        // Mantenerlo en memoria causaría que updateDb → saveDatabase → localStorage.setItem
        // exceda la cuota (~5-10MB) con archivos grandes como PDFs.
        // El base64 se recupera del backend vía sync_all cuando se necesita visualizar.
        base64Content: undefined
      };

      const nextTicketFileId = db.ticketArchivos.length > 0 ? Math.max(...db.ticketArchivos.map(tf => tf.id_ticket_archivo)) + 1 : 1;
      const newTicketFileObj = {
        id_ticket_archivo: nextTicketFileId,
        id_ticket: ticketIdVal || 0,
        id_archivo: nextFileId,
        tipo_evidencia: fileEvidenceType as any
      };

      const newDb: MockDatabase = {
        ...db,
        archivos: [...db.archivos, newFileObj],
        ticketArchivos: [...db.ticketArchivos, newTicketFileObj]
      };

      const getUploadFileUrl = () => {
        const queryParams = new URLSearchParams({
          action: "upload_file",
          id_ticket: String(ticketIdVal),
          id_usuario: String(currentUser.id_persona),
          tipo_evidencia: fileEvidenceType
        });
        return getDynamicApiUrl(undefined, queryParams);
      };

      if (useLocalSql) {
        fetch(getUploadFileUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_ticket: ticketIdVal,
            id_usuario: currentUser.id_persona,
            tipo_evidencia: fileEvidenceType,
            file: {
              name: fileToUpload.name,
              size: finalSize,
              type: fileToUpload.type || "application/octet-stream",
              base64Content: base64
            }
          })
        })
          .then(res => {
            // FIX v2.1: Capturar SIEMPRE el body del response, incluso en errores HTTP,
            // para mostrar el mensaje detallado del backend al usuario.
            return res.json().then(body => ({ ok: res.ok, body }));
          })
          .then(({ ok, body }) => {
            if (ok && body.status === "success") {
              const metodo = body.method ? ` (método: ${body.method})` : "";
              alert("Evidencia vinculada con éxito" + metodo + ".");
              updateDb(newDb);

              // FIX v2.71 — Refrescar lista de tickets inmediatamente.

              // FIX: mantener el panel abierto SIEMPRE.
              setViewTicket({ ...viewTicket });
              fetchTicketTraceability(ticketIdVal as number);
              // FIX v2.1: Solo cerrar el modal y limpiar el archivo si la subida fue exitosa.
              setShowFileUploadModal(false);
              setFileToUpload(null);
            } else {
              // El backend respondió con error — mostrar el detalle al usuario
              const errMsg = body.message || "Error desconocido del servidor.";
              const spErr = "";
              const directErr = "";
              const debug = "";
              const fullErr = errMsg;
              console.error("[TicketManager v2.9 FIX] upload_file backend error:", body);
              // FIX v2.4: NO ofrecer modo contingencia local — el archivo debe estar en la BD.
              alert(
                "No se pudo subir el archivo: " + fullErr +
                ""
              );
              // Dejamos el modal abierto para que el usuario reintente.
            }
          })
          .catch(err => {
            console.error("%c[TicketManager v2.9 FIX] Error de red/HTTP en upload_file:", "color:#dc2626;font-weight:bold;", err);
            // FIX v2.4: NO ofrecer modo contingencia local.
            alert(
              "ERROR DE CONEXIÓN al subir el archivo:\n\n" + (err?.message || err) +
              "\n\nVerifique que api_tickets.php esté actualizado y el IIS esté corriendo." +
              "\n\nEl archivo no se pudo subir. Intente nuevamente."
            );
            logTechnicalError(err, {
              url: "/api_tickets.php?action=upload_file",
              sqlStatus: "EVIDENCE_UPLOAD_FAIL",
              currentUser
            });
          });
      } else {
        updateDb(newDb);
        // FIX: mantener el panel abierto.
        setViewTicket({ ...viewTicket });
        fetchTicketTraceability(ticketIdVal as number);
        setShowFileUploadModal(false);
        setFileToUpload(null);
      }
    };

    if (fileToUpload.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 1200;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);
          const resizedBase64 = canvas.toDataURL("image/jpeg", 0.75);
          performUpload(resizedBase64, Math.round(resizedBase64.length * 0.75));
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(fileToUpload);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        performUpload(base64, fileToUpload.size);
      };
      reader.readAsDataURL(fileToUpload);
    }
  };

  const getTicketEmpresaId = (t: any): number | null => {
    if (!t) return null;
    const val = t.id_empresa ?? t.ID_EMPRESA ?? t.id_Empresa ?? t.Id_empresa;
    return val ? Number(val) : null;
  };

  const getTicketSucursalId = (t: any): number | null => {
    if (!t) return null;
    const val = t.id_sucursal ?? t.ID_SUCURSAL ?? t.id_Sucursal ?? t.Id_sucursal;
    return val ? Number(val) : null;
  };

  const getTicketContactoId = (t: any): number | null => {
    if (!t) return null;
    const val = t.id_empresa_contacto ?? t.ID_EMPRESA_CONTACTO ?? t.id_empresaContacto ?? t.id_EmpresaContacto ?? t.Id_empresa_contacto;
    return val ? Number(val) : null;
  };

  const getTicketUsuarioId = (t: any): number | null => {
    if (!t) return null;
    const val = t.id_usuario ?? t.ID_USUARIO ?? t.id_Usuario ?? t.Id_usuario;
    return val ? Number(val) : null;
  };

  const getTicketIdVal = (t: any): number | null => {
    if (!t) return null;
    const val = t.id_ticket ?? t.ID_TICKET ?? t.id_Ticket ?? t.Id_ticket;
    return val ? Number(val) : null;
  };

  const safeString = (value: any): string => {
    if (value === null || value === undefined) return "";
    return typeof value === "string" ? value : String(value);
  };

  const findEmpresa = (list: any[], id: any) => {
    if (!id) return null;
    return list.find(item => {
      const itemId = item.id_empresa ?? item.ID_EMPRESA ?? item.id_Empresa ?? item.Id_empresa;
      return Number(itemId) === Number(id);
    });
  };

  const findSucursal = (list: any[], id: any) => {
    if (!id) return null;
    return list.find(item => {
      const itemId = item.id_sucursal ?? item.ID_SUCURSAL ?? item.id_Sucursal ?? item.Id_sucursal;
      return Number(itemId) === Number(id);
    });
  };

  const findContacto = (list: any[], id: any) => {
    if (!id) return null;
    return list.find(item => {
      const itemId = item.id_empresa_contacto ?? item.ID_EMPRESA_CONTACTO ?? item.id_empresaContacto ?? item.id_EmpresaContacto ?? item.Id_empresa_contacto;
      return Number(itemId) === Number(id);
    });
  };

  const findPersona = (list: any[], id: any) => {
    if (!id) return null;
    return list.find(item => {
      const itemId = item.id_persona ?? item.ID_PERSONA ?? item.id_Persona ?? item.Id_persona;
      return Number(itemId) === Number(id);
    });
  };

  const resolveEmpresaName = (empresaId: any, fallbackName?: string) => {
    if (!empresaId) return fallbackName || "Empresa No Especificada";
    const e = findEmpresa(db.empresas, empresaId);
    return e ? (e.nombre_comercial || e.razon_social || e.NOMBRE_COMERCIAL || e.RAZON_SOCIAL) : (fallbackName || `Empresa #${empresaId}`);
  };

  const resolveSucursalName = (sucursalId: any, fallbackName?: string) => {
    if (!sucursalId) return fallbackName || "Sin Sede / Remoto";
    const s = findSucursal(db.sucursales, sucursalId);
    return s ? (s.nombre || s.NOMBRE) : (fallbackName || `Sucursal #${sucursalId}`);
  };

  const resolveContactoNombre = (contactoId: any, fallbackName?: string) => {
    if (!contactoId) return fallbackName || "Contacto No Especificado";
    const c = findContacto(db.contactosEmpresariales, contactoId);
    if (!c) return fallbackName || `Contacto #${contactoId}`;
    const personaId = c.id_persona ?? c.ID_PERSONA ?? c.id_Persona ?? c.Id_persona;
    const p = findPersona(db.personas, personaId);
    return p ? `${p.nombres ?? p.NOMBRES ?? ""} ${p.apellido_paterno ?? p.APELLIDO_PATERNO ?? ""}` : (fallbackName || `Persona #${personaId}`);
  };

  const resolvePersonaNombre = (personaId: any) => {
    if (!personaId) return "Usuario No Especificado";
    const p = findPersona(db.personas, personaId);
    return p ? `${p.nombres ?? p.NOMBRES ?? ""} ${p.apellido_paterno ?? p.APELLIDO_PATERNO ?? ""}` : `Usuario #${personaId}`;
  };

  const getTicketAttendingTechName = (ticketId: any) => {
    const atenciones = db.atenciones.filter(a => {
      const aTicketId = (a as any).id_ticket ?? (a as any).ID_TICKET ?? (a as any).id_Ticket ?? (a as any).Id_ticket;
      return Number(aTicketId) === Number(ticketId);
    });
    if (atenciones.length === 0) {
      return "Pendiente de Asignación / Atención";
    }
    const uniqueTechIds = Array.from(new Set(atenciones.map(a => (a as any).id_usuario ?? (a as any).ID_USUARIO ?? (a as any).id_Usuario ?? (a as any).Id_usuario)));
    return uniqueTechIds.map(id => resolvePersonaNombre(id)).join(", ");
  };

  const handleDownloadFile = (archivo: Archivo) => {
    if (archivo.base64Content) {
      const link = document.createElement("a");
      link.href = archivo.base64Content;
      link.download = archivo.nombre_original;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    const fileContent = `SISTEMA DICON SOPORTE - ARCHIVO DE EVIDENCIA DE AUDITORÍA\n` +
      `===================================================\n` +
      `Nombre Original: ${archivo.nombre_original}\n` +
      `Nombre Sistema: ${archivo.nombre_sistema}\n` +
      `Extensión: ${archivo.extension}\n` +
      `Tipo MIME: ${archivo.tipo_mime}\n` +
      `Tamaño: ${archivo.tamano_formato} (${archivo.tamano_bytes} bytes)\n` +
      `Hash Checksum SHA-256: ${archivo.checksum}\n` +
      `Fecha de Subida: ${archivo.fecha_subida || "18/06/2026 09:00"}\n` +
      `Registrado/Subido por: ${archivo.id_usuario_subio ? resolvePersonaNombre(archivo.id_usuario_subio) : "Sistema / Técnico"}\n` +
      `===================================================\n` +
      `[Evidencia Digital Verificada y Autenticada en Base de Datos SQL]`;

    const blob = new Blob([fileContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const baseName = archivo.nombre_original.endsWith(archivo.extension)
      ? archivo.nombre_original.slice(0, -(archivo.extension.length + 1))
      : archivo.nombre_original;
    link.download = `${baseName}.info.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // FIX v2.5: Exportar el ticket visible (con trazabilidad) a PDF usando window.print()
  // con una hoja de estilos optimizada para impresión.
  const handleExportTicketPdf = () => {
    if (!viewTicket) return;

    const t = viewTicket;
    const tId = getTicketIdVal(t);
    const empresa = resolveEmpresaName(getTicketEmpresaId(t));
    const sucursal = resolveSucursalName(getTicketSucursalId(t));
    const contacto = resolveContactoNombre(getTicketContactoId(t));
    const usuarioReg = resolvePersonaNombre(getTicketUsuarioId(t));
    const motivoNombre = traceTicket?.motivo_nombre ?? (() => {
      const motivoId = traceTicket?.id_motivo_contacto ?? t.id_motivo_contacto;
      const motivo = db.motivosContacto?.find(m => m.id_motivo === motivoId);
      return motivo ? motivo.nombre : "No especificado";
    })();
    const solucion = resolveTicketSolution(tId);

    // Construir HTML del historial
    const historialHtml = traceHistorial.length > 0
      ? traceHistorial.map(h => `
        <tr>
          <td>${safeString(h.fecha_cambio)}</td>
          <td><strong>${safeString(h.estado_anterior)}</strong> → <strong>${safeString(h.estado_nuevo)}</strong></td>
          <td>${h.id_usuario ? resolvePersonaNombre(h.id_usuario) : 'Sistema'}</td>
          <td>${safeString(formatHistoryReason(h.motivo))}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="4" style="text-align:center; padding:20px;">Sin registros</td></tr>';

    // Construir HTML de atenciones
    const atencionesHtml = traceAtenciones.length > 0
      ? traceAtenciones.map((at, idx) => {
        const timeNode = db.atencionesTiempo.find(att => Number(att.id_atencion) === Number(at.id_atencion));
        return `
            <tr>
              <td>#${idx + 1}</td>
              <td>${safeString(at.fecha_inicio)} ${safeString(at.hora_inicio).substring(0, 5)}</td>
              <td>${at.fecha_fin ? safeString(at.fecha_fin) + ' ' + safeString(at.hora_fin).substring(0, 5) : 'En proceso'}</td>
              <td>${resolvePersonaNombre(at.id_usuario)}</td>
              <td>${safeString(at.estado)}</td>
              <td>${safeString(at.detalle_atencion)}</td>
              <td>${at.solucion_aplicada ? safeString(at.solucion_aplicada) : '—'}</td>
              <td>${timeNode ? safeString(timeNode.duracion_formato) : '—'}</td>
            </tr>
          `;
      }).join('')
      : '<tr><td colspan="8" style="text-align:center; padding:20px;">Sin atenciones registradas</td></tr>';

    // Construir HTML de evidencias
    const evidencias = db.ticketArchivos.filter(ta => Number(ta.id_ticket) === Number(t.id_ticket));
    const evidenciasHtml = evidencias.length > 0
      ? evidencias.map(ta => {
        const archVal = db.archivos.find(a => Number(a.id_archivo) === Number(ta.id_archivo));
        if (!archVal) return '';
        return `
            <tr>
              <td>${safeString(archVal.nombre_original)}</td>
              <td>${safeString(archVal.tamano_formato)}</td>
              <td>${safeString(ta.tipo_evidencia)}</td>
              <td>${archVal.id_usuario_subio ? resolvePersonaNombre(archVal.id_usuario_subio) : 'Sistema'}</td>
              <td>${safeString(archVal.fecha_subida)}</td>
            </tr>
          `;
      }).join('')
      : '<tr><td colspan="5" style="text-align:center; padding:20px;">Sin evidencias vinculadas</td></tr>';

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Ticket ${safeString(t.nro_ticket)} — Reporte de Trazabilidad</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #141414; padding: 24px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px 0; }
  h2 { font-size: 14px; margin: 24px 0 8px 0; border-bottom: 2px solid #141414; padding-bottom: 4px; text-transform: uppercase; }
  .meta { font-size: 11px; color: #555; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; font-size: 12px; margin-bottom: 16px; }
  .grid div { display: flex; gap: 8px; }
  .grid strong { min-width: 130px; color: #555; text-transform: uppercase; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 16px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #141414; color: #fff; text-transform: uppercase; font-size: 10px; }
  tr:nth-child(even) td { background: #f5f5f5; }
  .descripcion { background: #f9f9f9; border: 1px solid #ccc; padding: 12px; font-size: 12px; line-height: 1.5; margin-bottom: 16px; }
  .solucion { background: #ecfdf5; border: 1px solid #059669; padding: 12px; font-size: 12px; line-height: 1.5; margin-bottom: 16px; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 10px; color: #888; text-align: center; }
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <h1>Reporte de Ticket ${safeString(t.nro_ticket)}</h1>
  <div class="meta">Generado el ${new Date().toLocaleString('es-PE')} por ${currentUser.nombres} ${currentUser.apellido_paterno}</div>

  <h2>Datos del Ticket</h2>
  <div class="grid">
    <div><strong>ID:</strong> <span>${tId}</span></div>
    <div><strong>N° Ticket:</strong> <span>${safeString(t.nro_ticket)}</span></div>
    <div><strong>Empresa:</strong> <span>${empresa}</span></div>
    <div><strong>Sucursal:</strong> <span>${sucursal}</span></div>
    <div><strong>Contacto:</strong> <span>${contacto}</span></div>
    <div><strong>Registrado por:</strong> <span>${usuarioReg}</span></div>
    <div><strong>Fecha registro:</strong> <span>${safeString(t.fecha_registro)} ${safeString(t.hora_registro)}</span></div>
    <div><strong>Estado actual:</strong> <span>${formatTicketStatus(t.estado, t)}</span></div>
    <div><strong>Prioridad:</strong> <span>${safeString(t.prioridad)}</span></div>
    <div><strong>Medio contacto:</strong> <span>${safeString(t.medio_contacto)}</span></div>
    <div><strong>Motivo:</strong> <span>${motivoNombre}</span></div>
    ${t.fecha_cierre ? `<div><strong>Fecha cierre:</strong> <span>${safeString(t.fecha_cierre)} ${safeString(t.hora_cierre)}</span></div>` : ''}
  </div>

  <h2>Descripción del Reporte</h2>
  <div class="descripcion">${safeString(t.detalle_reporte)}</div>

  <h2>Solución Aplicada</h2>
  <div class="solucion">${solucion && solucion !== "Pendiente de registro / Sin solución" ? solucion : "Pendiente de registro."}</div>

  <h2>Atenciones Técnicas</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Inicio</th>
        <th>Fin</th>
        <th>Técnico</th>
        <th>Estado</th>
        <th>Operaciones</th>
        <th>Solución</th>
        <th>Duración</th>
      </tr>
    </thead>
    <tbody>${atencionesHtml}</tbody>
  </table>

  <h2>Evidencias y Archivos</h2>
  <table>
    <thead>
      <tr>
        <th>Nombre</th>
        <th>Tamaño</th>
        <th>Tipo</th>
        <th>Subido por</th>
        <th>Fecha</th>
      </tr>
    </thead>
    <tbody>${evidenciasHtml}</tbody>
  </table>

  <h2>Historial de Cambios de Estado</h2>
  <table>
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Cambio</th>
        <th>Realizado por</th>
        <th>Motivo</th>
      </tr>
    </thead>
    <tbody>${historialHtml}</tbody>
  </table>

  <div class="footer">
    Documento generado por ERP SOPORTE<br>
    Ticket N° ${safeString(t.nro_ticket)} · ID interno #${tId}
  </div>

  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;

    // Abrir el HTML en una nueva ventana e imprimir como PDF
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } else {
      alert("El navegador bloqueó la apertura de la ventana de impresión. Habilite las ventanas emergentes para exportar a PDF.");
    }
  };

  return (
    <div className="space-y-6 text-[#141414]">

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b-2 border-[#141414] pb-4">
        <div>
          <h2 className="text-3xl font-serif italic text-[#141414]">Control de Tickets</h2>
          <p className="text-[10px] uppercase font-bold tracking-widest text-[#141414]/70 mt-1">
            Administre incidentes, asigne técnicos, registre trabajos e inspeccione la trazabilidad de la auditoría.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setEditingMotivo(null);
                setMotivoForm({ nombre: '', descripcion: '', activo: true, orden: 0 });
                setShowMotivoModal(true);
              }}
              className="flex items-center gap-1.5 bg-purple-800 text-white border border-purple-800 px-3 py-1.5 text-[11px] font-mono font-bold uppercase hover:bg-purple-900 transition-colors cursor-pointer"
            >
              <Tag className="w-4 h-4" /> Administrar Motivos
            </button>
          )}

          {currentRole !== "Cliente / Contacto empresarial" && (
            <button
              type="button"
              onClick={() => {
                setFormEmpresa("");
                setFormSucursal("");
                setFormContacto("");
                setFormDetalle("");
                setFormFiles([]);
                setShowCreateModal(true);
              }}
              className="flex items-center gap-1.5 bg-[#141414] text-[#E4E3E0] border border-[#141414] px-3 py-1.5 text-[11px] font-mono font-bold uppercase hover:bg-[#141414]/90 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Registrar Nuevo Ticket
            </button>
          )}
        </div>
      </div>

      <div className="border border-[#141414] bg-white/10 overflow-hidden">

        <div className="flex border-b border-[#141414] overflow-x-auto bg-[#E4E3E0]/70">
          {/* FIX v2.34: La pestaña AUDITORIA solo es visible para administradores. */}
          {((() => {
            const tabs = ["TODOS", "PENDIENTE", "EN_ATENCION", "RESUELTO", "CERRADO", "REABIERTO", "ANULADO"];
            if (isAdmin) tabs.push("AUDITORIA");
            return tabs as const;
          })()).map((tab) => {
            // FIX v2.4: Comparación robusta de estado con normalización de espacios, guiones y tildes.
            const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const normalizeStatus = (s: string) => stripAccents(s.replace(/ /g, "_").toUpperCase());
            const counts = tab === "AUDITORIA"
              ? 0
              : tab === activeTab
                ? filteredTickets.length
                : ticketStatusCounts[tab] ?? filteredTicketsExceptStatus.filter(t => normalizeStatus(formatTicketStatus(t.estado, t)) === normalizeStatus(tab)).length;

            const tabColors: Record<string, string> = {
              TODOS: "border-[#141414] text-[#141414]",
              PENDIENTE: "border-amber-600 text-amber-700",
              EN_ATENCION: "border-purple-600 text-purple-700",
              RESUELTO: "border-emerald-600 text-emerald-700",
              CERRADO: "border-slate-500 text-slate-700",
              REABIERTO: "border-red-600 text-red-700",
              ANULADO: "border-red-500 text-red-800",
              AUDITORIA: "border-[#1f3a5f] text-[#1f3a5f]"
            };

            const isActive = activeTab === tab;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 border-b-2 text-[10px] font-mono uppercase transition-all whitespace-nowrap cursor-pointer ${isActive
                  ? `${tabColors[tab]} bg-[#E4E3E0] font-bold border-b-3`
                  : "border-transparent text-[#141414]/65 hover:text-[#141414] hover:bg-[#E4E3E0]/30"
                  }`}
              >
                {tab === "TODOS" ? "TODOS" : tab === "EN_ATENCION" ? "EN ATENCIÓN" : tab === "AUDITORIA" ? "📋 AUDITORÍA" : tab}
                {tab !== "AUDITORIA" && (
                  <span className="ml-2 bg-[#141414]/10 text-[#141414] border border-[#141414]/20 px-1.5 py-0.5 font-mono text-[9px]">
                    {counts}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ============================================================ */}
        {/* FIX v2.32 — PANEL DE AUDITORÍA DE TICKETS                   */}
        {/* Muestra el historial de cambios de estado y operaciones       */}
        {/* registradas en db.historialEstados + db.auditoriaOperaciones. */}
        {/* ============================================================ */}
        {activeTab === "AUDITORIA" ? (
          <div className="p-4 space-y-4 bg-[#E4E3E0]/45">
            <header className="border-2 border-[#141414] bg-white p-3">
              <h3 className="text-xs font-serif italic font-bold uppercase tracking-wide">Registro de Auditoría · Tickets</h3>
              <p className="text-[10px] font-mono uppercase tracking-widest text-[#141414]/60 mt-0.5">
                Historial completo de cambios de estado y operaciones sobre tickets
              </p>
            </header>

            {/* Historial de cambios de estado */}
            <section aria-label="Historial de cambios de estado">
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#141414] mb-2">
                Cambios de Estado ({db.historialEstados.length})
              </h4>
              <div className="border border-[#141414] overflow-x-auto bg-white">
                <table className="w-full text-left border-collapse text-[11px] font-mono text-[#141414]" aria-label="Historial de cambios de estado de tickets">
                  <thead>
                    <tr className="bg-[#141414] text-[#E4E3E0] text-[9px] font-bold uppercase tracking-wider">
                      <th scope="col" className="py-2 px-3 w-[140px]">Fecha</th>
                      <th scope="col" className="py-2 px-3 w-[110px]">Ticket</th>
                      <th scope="col" className="py-2 px-3 w-[120px]">Estado Anterior</th>
                      <th scope="col" className="py-2 px-3 w-[120px]">Estado Nuevo</th>
                      <th scope="col" className="py-2 px-3 w-[140px]">Usuario</th>
                      <th scope="col" className="py-2 px-3">Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141414]/10">
                    {db.historialEstados.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-[#141414]/40 italic uppercase text-[10px]">
                          No hay cambios de estado registrados.
                        </td>
                      </tr>
                    ) : (
                      db.historialEstados.slice(0, 100).map(h => {
                        const ticket = db.tickets.find(t => t.id_ticket === h.id_ticket);
                        const usuario = db.personas.find(p => p.id_persona === h.id_usuario);
                        return (
                          <tr key={h.id_historial} className="hover:bg-[#141414]/5">
                            <td className="py-1.5 px-3 text-[10px]">{h.fecha_cambio}</td>
                            <td className="py-1.5 px-3 font-bold">{ticket?.nro_ticket || `#${h.id_ticket}`}</td>
                            <td className="py-1.5 px-3">
                              <span className="px-1.5 py-0.5 bg-[#141414]/10 border border-[#141414]/30 text-[9px] uppercase font-bold">
                                {h.estado_anterior}
                              </span>
                            </td>
                            <td className="py-1.5 px-3">
                              <span className="px-1.5 py-0.5 bg-[#1f3a5f] text-white text-[9px] uppercase font-bold">
                                {h.estado_nuevo}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 text-[10px]">
                              {usuario ? `${usuario.nombres} ${usuario.apellido_paterno}` : `#${h.id_usuario}`}
                            </td>
                            <td className="py-1.5 px-3 text-[10px] text-[#141414]/80">{formatHistoryReason(h.motivo)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Operaciones CRUD auditadas (si están disponibles) */}
            {db.auditoriaOperaciones && db.auditoriaOperaciones.length > 0 && (
              <section aria-label="Operaciones CRUD auditadas" className="mt-4">
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#141414] mb-2">
                  Operaciones CRUD · Tickets ({db.auditoriaOperaciones.filter(a => a.modulo === "TICKETS").length})
                </h4>
                <div className="border border-[#141414] overflow-x-auto bg-white">
                  <table className="w-full text-left border-collapse text-[11px] font-mono text-[#141414]" aria-label="Operaciones CRUD de tickets auditadas">
                    <thead>
                      <tr className="bg-[#141414] text-[#E4E3E0] text-[9px] font-bold uppercase tracking-wider">
                        <th scope="col" className="py-2 px-3 w-[140px]">Fecha y Hora</th>
                        <th scope="col" className="py-2 px-3 w-[140px]">Usuario</th>
                        <th scope="col" className="py-2 px-3 w-[110px]">Operación</th>
                        <th scope="col" className="py-2 px-3">Detalle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#141414]/10">
                      {db.auditoriaOperaciones
                        .filter(a => a.modulo === "TICKETS")
                        .slice(0, 100)
                        .map(a => (
                          <tr key={a.id_auditoria} className="hover:bg-[#141414]/5">
                            <td className="py-1.5 px-3 text-[10px]">{a.fecha_hora}</td>
                            <td className="py-1.5 px-3 text-[10px]">{a.usuario}</td>
                            <td className="py-1.5 px-3">
                              <span className={`px-1.5 py-0.5 text-[9px] uppercase font-bold ${a.operacion === "CREACION" ? "bg-emerald-700 text-white" :
                                a.operacion === "MODIFICACION" ? "bg-amber-600 text-white" :
                                  a.operacion === "ELIMINACION" ? "bg-red-700 text-white" :
                                    "bg-[#141414] text-[#E4E3E0]"
                                }`}>
                                {a.operacion}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 text-[10px] text-[#141414]/80">{formatHistoryReason(a.detalles)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Pie de página del módulo Tickets */}
            <footer className="border-t-2 border-[#141414] mt-4 pt-3 pb-2 px-3 bg-[#141414]/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[9px] font-mono uppercase tracking-widest text-[#141414]/60">
              <span>ERP SOPORTE · v2.32 · Módulo Tickets</span>
              <span>Pestaña: Auditoría</span>
              <span>© {new Date().getFullYear()} ERP SOPORTE</span>
            </footer>
          </div>
        ) : (
          <div className="p-4 space-y-3 bg-[#E4E3E0]/45 border-t border-[#141414]/10">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="relative md:col-span-2">
                <label className="block text-[10px] font-bold text-[#141414]/75 uppercase mb-1">Buscar por correlativo ó descripción</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-3.5 w-3.5 opacity-50" />
                  </span>
                  <input
                    type="text"
                    className="text-xs w-full bg-white border border-[#141414] pl-9 pr-3 py-2 text-[#141414] font-mono focus:outline-none"
                    placeholder="ID correlativo, ej. 2026-0001..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#141414]/75 uppercase mb-1">Prioridad del Ticket</label>
                <select
                  value={selectedPriority}
                  onChange={(e) => setSelectedPriority(e.target.value)}
                  className="text-xs w-full bg-white border border-[#141414] px-3 py-2 text-[#141414] font-mono focus:outline-none cursor-pointer"
                >
                  <option value="TODOS">-- PRIORIDAD --</option>
                  <option value="CRITICA">🔴 CRÍTICA</option>
                  <option value="ALTA">🟠 ALTA</option>
                  <option value="MEDIA">🟡 MEDIA</option>
                  <option value="BAJA">🔵 BAJA</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#141414]/75 uppercase mb-1">Empresa Cliente (Buscar)</label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    className="text-xs w-full bg-white border border-[#141414] p-2 text-[#141414] font-mono focus:outline-none placeholder-zinc-400"
                    placeholder="-- TODAS LAS EMPRESAS --"
                    readOnly
                    value={selectedCompany !== "TODOS" ? (db.empresas.find(e => e.id_empresa === parseInt(selectedCompany))?.nombre_comercial || db.empresas.find(e => e.id_empresa === parseInt(selectedCompany))?.razon_social || "").toUpperCase() : ""}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCompanySearchQuery("");
                      setCompanySearchModalTarget("FILTER");
                      setShowCompanySearchModal(true);
                    }}
                    className="bg-white hover:bg-[#141414] hover:text-[#E4E3E0] border border-[#141414] px-2 font-mono font-bold text-[10px] uppercase transition-colors whitespace-nowrap cursor-pointer"
                  >
                    [Buscar]
                  </button>
                  {selectedCompany !== "TODOS" && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCompany("TODOS");
                        setSelectedBranchFilter("TODOS");
                      }}
                      className="bg-white hover:bg-red-500 hover:text-white border border-red-500 px-2 font-mono font-bold text-[10px] cursor-pointer"
                    >
                      [X]
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[#141414]/10 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
              <div>
                <label className="block text-[9px] font-bold text-[#141414]/70 uppercase mb-1">Motivo Contacto</label>
                <select
                  value={selectedMotivoFilter}
                  onChange={(e) => setSelectedMotivoFilter(e.target.value)}
                  className="text-xs w-full bg-white border border-[#141414] px-2 py-1.5 text-[#141414] font-mono focus:outline-none cursor-pointer"
                >
                  <option value="TODOS">-- TODOS --</option>
                  {(db.motivosContacto || [])
                    .filter(m => m.activo !== false)
                    .sort((a, b) => (a.orden || 0) - (b.orden || 0))
                    .map(m => (
                      <option key={m.id_motivo} value={m.id_motivo.toString()}>
                        {m.nombre}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-bold text-[#141414]/70 uppercase mb-1">Sucursal Cliente</label>
                <select
                  value={selectedBranchFilter}
                  onChange={(e) => setSelectedBranchFilter(e.target.value)}
                  className="text-xs w-full bg-white border border-[#141414] px-2 py-1.5 text-[#141414] font-mono focus:outline-none cursor-pointer"
                >
                  <option value="TODOS">-- SUCURSAL (TODAS) --</option>
                  {db.sucursales
                    .filter(s => selectedCompany === "TODOS" || s.id_empresa === parseInt(selectedCompany))
                    .map(s => (
                      <option key={s.id_sucursal} value={s.id_sucursal}>{s.nombre}</option>
                    ))
                  }
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-bold text-[#141414]/70 uppercase mb-1">Técnico Asignado</label>
                <select
                  value={selectedAssigneeFilter}
                  onChange={(e) => setSelectedAssigneeFilter(e.target.value)}
                  className="text-xs w-full bg-white border border-[#141414] px-2 py-1.5 text-[#141414] font-mono focus:outline-none cursor-pointer"
                >
                  <option value="TODOS">-- TÉCNICOS (TODOS) --</option>
                  {db.personas.filter(p => {
                    const asig = db.asignacionesRoles.find(a => a.id_persona === p.id_persona);
                    return asig && [1, 2, 3].includes(asig.id_rol);
                  }).map(p => (
                    <option key={p.id_persona} value={p.id_persona}>{p.nombres} {p.apellido_paterno}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-bold text-[#141414]/70 uppercase mb-1">Rubro Comercial</label>
                <select
                  value={selectedRubroFilter}
                  onChange={(e) => setSelectedRubroFilter(e.target.value)}
                  className="text-xs w-full bg-white border border-[#141414] px-2 py-1.5 text-[#141414] font-mono focus:outline-none cursor-pointer"
                >
                  <option value="TODOS">-- RUBRO (TODOS) --</option>
                  {db.rubros.map(r => (
                    <option key={r.id_rubro} value={r.id_rubro}>{r.nombre}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-bold text-[#141414]/70 uppercase mb-1">Fec. Registro (Ctrl)</label>
                <input
                  type="date"
                  value={createdDateFilter}
                  onChange={(e) => setCreatedDateFilter(e.target.value)}
                  className="text-xs w-full bg-white border border-[#141414] px-2 py-1 text-[#141414] font-mono focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-[#141414]/70 uppercase mb-1">Fec. Cierre (Filtro)</label>
                <input
                  type="date"
                  value={closedDateFilter}
                  onChange={(e) => setClosedDateFilter(e.target.value)}
                  className="text-xs w-full bg-white border border-[#141414] px-2 py-1 text-[#141414] font-mono focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-[#141414]/65 font-bold uppercase">
                ⚡ Encontrados: <span className="text-blue-900 border border-blue-900 px-1 font-mono">{filteredTickets.length}</span> tickets coincidentes
              </span>
              <div className="flex items-center gap-2">
                {/* FIX v2.68 — Botón Actualizar restaurado. */}
                <button
                  type="button"
                  onClick={() => {
                    fetchLocalSqlTickets();
                    // FIX v2.95 — Si hay un ticket abierto, refrescar su trazabilidad inmediatamente
                    // (sin setTimeout) para que la solución y atenciones aparezcan al instante.
                    if (viewTicket) {
                      fetchTicketTraceability(getTicketIdVal(viewTicket) as number);
                    }
                  }}
                  className="flex items-center gap-1.5 border border-[#141414] bg-white text-[#141414] px-3 py-1.5 text-[10px] font-mono font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
                  title="Actualizar lista de tickets y trazabilidad"
                  aria-label="Actualizar lista de tickets y trazabilidad"
                >
                  ↻ Actualizar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm("");
                    setSelectedPriority("TODOS");
                    setSelectedCompany("TODOS");
                    setSelectedMotivoFilter("TODOS");
                    setSelectedBranchFilter("TODOS");
                    setSelectedAssigneeFilter("TODOS");
                    setSelectedRubroFilter("TODOS");
                    setCreatedDateFilter("");
                    setClosedDateFilter("");
                  }}
                  className="text-[10px] font-mono font-bold text-red-800 hover:text-red-950 underline cursor-pointer"
                >
                  🔄 REINICIAR FILTROS COMBINADOS
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border border-[#141414] bg-white/20 overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[600px]">
          <table className="table-fixed w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase tracking-wider font-mono">
                <th className="w-[110px] py-3 px-4 border-b border-[#141414]">Ticket ID</th>
                <th className="w-[260px] py-3 px-4 border-b border-[#141414]">Empresa / Sede</th>
                <th className="w-[180px] py-3 px-4 border-b border-[#141414]">Prioridad / Registro</th>
                <th className="w-[180px] py-3 px-4 border-b border-[#141414]">Contacto Reportante</th>
                <th className="w-[260px] py-3 px-4 border-b border-[#141414]">Problema Reportado</th>
                <th className="w-[220px] py-3 px-4 border-b border-[#141414]">Solución Aplicada</th>
                <th className="w-[120px] py-3 px-4 border-b border-[#141414]">Estado</th>
                <th className="w-[120px] py-3 px-4 border-b border-[#141414] text-right">Trazabilidad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/15 text-xs font-mono">
              {paginatedTickets.map((t) => {
                const formattedStatus = formatTicketStatus(t.estado, t);

                const priorityLabels = {
                  CRITICA: "bg-red-500/10 text-red-900 border border-red-500 font-bold px-1.5 py-0.5",
                  ALTA: "bg-orange-500/10 text-orange-950 border border-orange-500 px-1.5 py-0.5",
                  MEDIA: "bg-amber-550/10 text-amber-950 border border-amber-600 px-1.5 py-0.5",
                  BAJA: "bg-blue-500/10 text-blue-900 border border-blue-500 px-1.5 py-0.5"
                };

                const stateLabels = {
                  PENDIENTE: "bg-yellow-500/10 text-yellow-950 border border-yellow-600 px-1.5 py-0.5",
                  EN_ATENCION: "bg-purple-500/10 text-purple-950 border border-purple-600 px-1.5 py-0.5",
                  RESUELTO: "bg-emerald-500/10 text-emerald-950 border border-emerald-600 px-1.5 py-0.5",
                  CERRADO: "bg-zinc-500/10 text-zinc-700 border border-zinc-500 px-1.5 py-0.5",
                  REABIERTO: "bg-rose-500/10 text-rose-950 border border-rose-600 px-1.5 py-0.5",
                  ANULADO: "bg-red-500/10 text-red-900 border border-red-500 px-1.5 py-0.5 font-bold"
                };

                const mappedStateKey = (t.estado === "EN_ATENCION" || formattedStatus === "EN ATENCIÓN") ? "EN_ATENCION" : (t.estado as keyof typeof stateLabels) || "PENDIENTE";

                const tIdVal = getTicketIdVal(t);
                const tNroTicket = t.nro_ticket ?? t.NRO_TICKET ?? t.Nro_ticket;
                const tEmpresaNombre = t.empresa_nombre ?? t.EMPRESA_NOMBRE ?? t.empresaNombre;
                const tSucursalNombre = t.sucursal_nombre ?? t.SUCURSAL_NOMBRE ?? t.sucursalNombre;
                const tContactoNombre = t.contacto_nombre ?? t.CONTACTO_NOMBRE ?? t.contactoNombre;
                const tPrioridad = (t.prioridad ?? t.PRIORIDAD ?? t.Prioridad) as keyof typeof priorityLabels || "MEDIA";
                const tFechaRegistro = t.fecha_registro ?? t.FECHA_REGISTRO ?? t.Fecha_registro;
                const tHoraRegistro = t.hora_registro ?? t.HORA_REGISTRO ?? t.Hora_registro;
                const tDetalleReporte = t.detalle_reporte ?? t.DETALLE_REPORTE ?? t.Detalle_reporte;
                const tMotivoNombre = t.motivo_nombre ?? t.MOTIVO_NOMBRE ?? t.motivoNombre;

                return (
                  <tr key={tIdVal ?? tNroTicket} className="hover:bg-[#141414]/5 transition-colors font-mono">
                    <td className="py-3 px-4 font-bold text-[#141414] text-[13px] border-b border-[#141414]/10">
                      {tNroTicket}
                    </td>
                    <td className="py-3 px-4 border-b border-[#141414]/10">
                      <div className="font-bold text-[#141414] truncate max-w-[160px] uppercase text-[11px]" title={tEmpresaNombre || resolveEmpresaName(getTicketEmpresaId(t))}>
                        {tEmpresaNombre || resolveEmpresaName(getTicketEmpresaId(t))}
                      </div>
                      <div className="text-[10px] text-[#141414]/70 max-w-[160px] truncate flex items-center gap-1 mt-0.5" title={tSucursalNombre || resolveSucursalName(getTicketSucursalId(t))}>
                        <MapPin className="w-3 h-3 shrink-0" />
                        {tSucursalNombre || resolveSucursalName(getTicketSucursalId(t))}
                      </div>
                      {tMotivoNombre && (
                        <div className="text-[9px] text-blue-700 font-bold uppercase truncate mt-1" title={`Motivo: ${tMotivoNombre}`}>
                          Motivo: {tMotivoNombre}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap border-b border-[#141414]/10">
                      <span className={`${priorityLabels[tPrioridad] || priorityLabels.MEDIA}`}>
                        {tPrioridad}
                      </span>
                      <div className="text-[10px] text-[#141414]/65 mt-1.5 flex items-center gap-1">
                        <Clock className="w-3 h-3 shrink-0" />
                        {safeString(tFechaRegistro)} {safeString(tHoraRegistro).substring(0, 5)}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-[#141414] font-medium border-b border-[#141414]/10">
                      {tContactoNombre || resolveContactoNombre(getTicketContactoId(t))}
                    </td>
                    <td className="py-3 px-4 max-w-[280px] border-b border-[#141414]/10">
                      <p className="text-[#141414]/80 line-clamp-2 truncate text-[11px] font-sans font-medium" title={tDetalleReporte}>
                        {tDetalleReporte}
                      </p>
                    </td>
                    <td className="py-3 px-4 max-w-[220px] border-b border-[#141414]/10">
                      {resolveTicketSolution(getTicketIdVal(t)) && resolveTicketSolution(getTicketIdVal(t)) !== "Pendiente de registro / Sin solución" ? (
                        <p className="text-emerald-850 line-clamp-2 truncate text-[11px] font-sans font-semibold text-emerald-800" title={resolveTicketSolution(getTicketIdVal(t))}>
                          {resolveTicketSolution(getTicketIdVal(t))}
                        </p>
                      ) : (
                        <span className="text-[#141414]/40 font-bold">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap border-b border-[#141414]/10">
                      <span className={`text-[10px] font-bold ${stateLabels[mappedStateKey] || stateLabels.PENDIENTE}`}>
                        {formattedStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap border-b border-[#141414]/10">
                      <button
                        type="button"
                        onClick={() => {
                          const ticketId = getTicketIdVal(t);
                          setViewTicket(t);
                          setTicketTraceability(null);
                          if (ticketId) {
                            fetchTicketTraceability(ticketId);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 bg-white hover:bg-[#141414] hover:text-[#E4E3E0] border border-[#141414] text-[#141414] px-2.5 py-1.5 font-bold uppercase text-[9.5px] transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" /> Trazabilidad
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredTickets.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    No se encontraron tickets registrados que coincidan con los filtros aplicados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex flex-wrap items-center justify-between gap-3 font-mono border-t border-[#141414]">
          <div className="text-[10.5px]">
            Mostrando registros <span className="font-bold">{filteredTickets.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}</span> al <span className="font-bold">{Math.min(currentPage * pageSize, filteredTickets.length)}</span> de un total de <span className="text-[#E4E3E0] hover:underline font-bold text-yellow-400">{filteredTickets.length}</span> tickets
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(1)}
              className="px-2 py-1 bg-white/10 hover:bg-white/20 text-[#E4E3E0] text-[10px] uppercase font-bold border border-white/20 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              « Primero
            </button>
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-[#E4E3E0] text-[10px] uppercase font-bold border border-white/20 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              ‹ Anterior
            </button>

            <div className="text-[10.5px] px-2 bg-white/20 py-0.5 border border-white/15">
              Página <span className="font-bold text-yellow-400">{currentPage}</span> de <span className="font-bold">{totalPages}</span>
            </div>

            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-[#E4E3E0] text-[10px] uppercase font-bold border border-white/20 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              Siguiente ›
            </button>
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(totalPages)}
              className="px-2 py-1 bg-white/10 hover:bg-white/20 text-[#E4E3E0] text-[10px] uppercase font-bold border border-white/20 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              Último »
            </button>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-[#141414]/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#E4E3E0] max-w-2xl w-full max-h-[90vh] overflow-y-auto border-2 border-[#141414] rounded-none shadow-none">

            <div className="p-4 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <div>
                <h3 className="text-sm font-bold font-mono uppercase tracking-wider">Registrar nuevo ticket</h3>
                <p className="text-[10px] text-[#E4E3E0]/70 font-mono">Complete los datos del reporte para registrar el ticket.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-mono font-bold text-lg p-1 cursor-pointer"
              >
                [X]
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="p-5 space-y-4 text-xs font-mono text-[#141414]">

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-[#141414] uppercase mb-1 font-mono">
                    Empresa Clientel <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      className="w-full text-xs font-mono bg-white border border-[#141414] p-2 text-[#141414] focus:outline-none"
                      placeholder="SELECCIONE EMPRESA..."
                      readOnly
                      required
                      value={formEmpresa ? (db.empresas.find(e => e.id_empresa === parseInt(formEmpresa))?.nombre_comercial || db.empresas.find(e => e.id_empresa === parseInt(formEmpresa))?.razon_social || "").toUpperCase() : ""}
                    />
                    {currentRole !== "Cliente / Contacto empresarial" && (
                      <button
                        type="button"
                        onClick={() => {
                          setCompanySearchQuery("");
                          setCompanySearchModalTarget("FORM");
                          setShowCompanySearchModal(true);
                        }}
                        className="bg-white hover:bg-[#141414] hover:text-[#E4E3E0] border border-[#141414] px-3 font-mono font-bold text-[11px] whitespace-nowrap cursor-pointer uppercase transition-colors"
                      >
                        [Buscar]
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#141414] uppercase mb-1 font-mono">
                    Sucursal / Sede Afectada
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      className="w-full text-xs font-mono bg-white border border-[#141414] p-2 text-[#141414] focus:outline-none"
                      placeholder="SEDE MATRIZ / MULTIPLE"
                      readOnly
                      value={formSucursal ? (db.sucursales.find(s => s.id_sucursal === parseInt(formSucursal))?.nombre || "").toUpperCase() : "REQUERIR GENERAL MATRIZ"}
                    />
                    <button
                      type="button"
                      disabled={!formEmpresa}
                      onClick={() => {
                        setBranchSearchQuery("");
                        setShowBranchSearchModal(true);
                      }}
                      className="bg-white hover:bg-[#141414] hover:text-[#E4E3E0] border border-[#141414] px-3 font-mono font-bold text-[11px] whitespace-nowrap cursor-pointer uppercase transition-colors disabled:opacity-40"
                    >
                      [Buscar]
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-[#141414] uppercase mb-1 font-mono">
                    Contacto Reportante <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      required
                      className="w-full text-xs font-mono bg-white border border-[#141414] p-2 text-[#141414] focus:outline-none"
                      placeholder="PERSONA DE CONTACTO..."
                      readOnly
                      value={formContacto ? (filteredContactosForForm.find(c => c.id_empresa_contacto === parseInt(formContacto))?.nombre_contacto || "").toUpperCase() : ""}
                    />
                    <button
                      type="button"
                      disabled={!formEmpresa || currentRole === "Cliente / Contacto empresarial"}
                      onClick={() => {
                        setContactSearchQuery("");
                        setShowContactSearchModal(true);
                      }}
                      className="bg-white hover:bg-[#141414] hover:text-[#E4E3E0] border border-[#141414] px-3 font-mono font-bold text-[11px] whitespace-nowrap cursor-pointer uppercase transition-colors disabled:opacity-40"
                    >
                      [Buscar]
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#141414] uppercase mb-1 font-mono">
                    Prioridad del Ticket <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formPrioridad}
                    onChange={(e) => setFormPrioridad(e.target.value as TicketPrioridad)}
                    className="w-full text-xs bg-white border border-[#141414] p-2 text-[#141414] focus:outline-none font-mono font-bold"
                  >
                    <option value="BAJA">🔵 BAJA PRIORIDAD</option>
                    <option value="MEDIA">🟡 MEDIA PRIORIDAD</option>
                    <option value="ALTA">🟠 ALTA PRIORIDAD</option>
                    <option value="CRITICA">🔴 CRÍTICA PRIORIDAD</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-[#141414] uppercase mb-1 font-mono">
                    Canal / Medio de Reporte <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formMedioContacto}
                    onChange={(e) => setFormMedioContacto(e.target.value as any)}
                    className="w-full text-xs bg-white border border-[#141414] p-2 text-[#141414] focus:outline-none font-mono font-bold"
                  >
                    <option value="EMAIL">📨 CORREO ELECTRÓNICO (EMAIL)</option>
                    <option value="TELEFONO">📞 TELÉFONO / CENTRAL</option>
                    <option value="CHAT">💬 WHATSAPP / CHAT TI</option>
                    <option value="PRESENCIAL">👥 VISITA PRESENCIAL O CARGO</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#141414] uppercase mb-1 font-mono">
                    Motivo de Contacto <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formMotivo}
                    onChange={(e) => setFormMotivo(e.target.value)}
                    className="w-full text-xs bg-white border border-[#141414] p-2 text-[#141414] focus:outline-none font-mono font-bold"
                    required
                  >
                    <option value="">-- Seleccione motivo --</option>
                    {(db.motivosContacto || []).filter(m => m.activo !== false).sort((a, b) => (a.orden || 0) - (b.orden || 0)).map(m => (
                      <option key={m.id_motivo} value={m.id_motivo.toString()}>
                        {m.nombre}
                      </option>
                    ))}
                  </select>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateModal(false);
                        setEditingMotivo(null);
                        setMotivoForm({ nombre: '', descripcion: '', activo: true, orden: 0 });
                        setShowMotivoModal(true);
                      }}
                      className="mt-1 text-[9px] text-purple-700 hover:underline font-bold uppercase flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Administrar motivos
                    </button>
                  )}
                  {!db.motivosContacto?.length && (
                    <p className="text-[10px] text-red-700 mt-2">No hay motivos disponibles. Por favor sincronice la lista de motivos.</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#141414] uppercase mb-1 font-mono">
                  Descripción del Problema Técnico <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  value={formDetalle}
                  onChange={(e) => setFormDetalle(e.target.value)}
                  placeholder="Escriba los códigos de error, anomalías encontradas, versiones y equipos comprometidos..."
                  className="w-full text-xs bg-white border border-[#141414] p-2.5 text-[#141414] focus:outline-none font-mono"
                />
              </div>

              <div className="bg-white border border-[#141414] p-4 font-mono">
                <div className="flex items-center justify-between border-b border-[#141414] pb-2 mb-2">
                  <div className="flex items-center gap-1.5 text-[#141414] font-bold text-xs uppercase">
                    <Paperclip className="w-4 h-4 text-[#141414]" />
                    <span>Evidencias y Archivos de Entrada</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      id="form-file-picker"
                      onChange={(e) => {
                        if (e.target.files) {
                          const files = Array.from(e.target.files);
                          Promise.all(
                            files.map((f: any) => {
                              return new Promise<{ name: string; size: number; type: string; base64Content: string }>((resolve) => {
                                const reader = new FileReader();
                                reader.onload = (event: any) => {
                                  resolve({
                                    name: f.name as string,
                                    size: f.size as number,
                                    type: (f.type || "application/octet-stream") as string,
                                    base64Content: event.target?.result as string
                                  });
                                };
                                reader.readAsDataURL(f);
                              });
                            })
                          ).then((newFiles: any[]) => {
                            setFormFiles(prev => [...prev, ...newFiles]);
                          });
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => document.getElementById("form-file-picker")?.click()}
                      className="text-[11px] font-bold text-blue-700 hover:underline cursor-pointer uppercase font-mono"
                    >
                      [+] Adjuntar Archivo Real
                    </button>
                    <span className="text-[#141414]/30 font-mono text-[10px]">|</span>
                    <button
                      type="button"
                      onClick={handleAddDummyFile}
                      className="text-[11px] font-bold text-zinc-600 hover:underline cursor-pointer uppercase font-mono"
                    >
                      [+] Adjuntar Demo
                    </button>
                  </div>
                </div>

                {formFiles.length > 0 ? (
                  <ul className="space-y-1.5 max-h-32 overflow-y-auto">
                    {formFiles.map((f, i) => (
                      <li key={i} className="flex justify-between items-center text-xs bg-[#E4E3E0]/40 border border-[#141414] py-1 px-2.5">
                        <span className="truncate font-bold text-[#141414] max-w-[320px]" title={f.name}>{f.name.toUpperCase()}</span>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-[10px] text-zinc-500">{(f.size / (1024 * 1024)).toFixed(2)} MB [{f.type.split('/').pop()?.toUpperCase()}]</span>
                          <button
                            type="button"
                            onClick={() => setFormFiles(formFiles.filter((_, idx) => idx !== i))}
                            className="text-red-650 font-bold hover:text-red-900 ml-1"
                          >
                            [Eliminar]
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-zinc-500 text-[11px] text-center py-2 uppercase">Ningún adjunto cargado.</p>
                )}
              </div>

              {/* FIX v2.66 — Configuración de notificaciones con modales de búsqueda. */}
              <div className="border-2 border-[#141414] bg-[#141414]/5 p-3 space-y-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formEnviarCorreo}
                    onChange={(e) => setFormEnviarCorreo(e.target.checked)}
                    className="mt-0.5 w-4 h-4 border-2 border-[#141414] cursor-pointer"
                    aria-label="Enviar notificación por correo"
                  />
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#141414]">
                    📧 Enviar notificación por correo al registrar el ticket
                  </span>
                </label>

                {formEnviarCorreo && (
                  <div className="ml-6 space-y-3 border-l-2 border-[#141414]/30 pl-3">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-[#141414]/60 font-bold">
                      Seleccionar destinatario(s):
                    </p>

                    {/* Contacto de empresa */}
                    <div className="space-y-1.5">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" checked={formNotificarContacto} onChange={(e) => setFormNotificarContacto(e.target.checked)} className="mt-0.5 w-4 h-4 border-2 border-[#141414] cursor-pointer" />
                        <span className="text-[11px] font-bold uppercase tracking-wide text-[#141414]">Notificar a un contacto de la empresa</span>
                      </label>
                      {formNotificarContacto && (
                        <div className="ml-6 space-y-1.5">
                          {formEmpresa ? (() => {
                            const contactosEmpresa = db.contactosEmpresariales.filter(c => c.id_empresa === parseInt(formEmpresa));
                            if (contactosEmpresa.length === 0) return <p className="text-[10px] font-mono text-amber-700">⚠ La empresa no tiene contactos.</p>;
                            const idSel = formContactoNotifId || formContacto;
                            const c = idSel ? db.contactosEmpresariales.find(x => x.id_empresa_contacto === parseInt(idSel)) : null;
                            const p = c ? db.personas.find(per => per.id_persona === c.id_persona) : null;
                            const nombreSel = p ? `${p.nombres} ${p.apellido_paterno}` : "";
                            const correoSel = c?.correo_empresa || p?.correo || "";
                            return (
                              <>
                                <button type="button" onClick={() => { setBusquedaContactoQuery(""); setShowBusquedaContactoModal(true); }} className="w-full bg-white border border-[#141414] p-2 text-[11px] font-mono text-[#141414] hover:bg-[#141414]/5 cursor-pointer flex items-center justify-between" aria-label="Buscar contacto">
                                  <span>{nombreSel ? `${nombreSel}${correoSel ? ` (${correoSel})` : " (sin correo)"}` : "— Buscar contacto —"}</span>
                                  <span className="text-[9px] uppercase font-bold text-[#141414]/60">🔍 Buscar</span>
                                </button>
                                <p className="text-[10px] font-mono text-[#141414] bg-white border border-[#141414]/30 p-1.5">{correoSel ? `✓ Correo destino: ${correoSel}` : <span className="text-amber-700">⚠ El contacto no tiene correo</span>}</p>
                              </>
                            );
                          })() : <p className="text-[10px] font-mono text-[#141414]/50 italic">Seleccione una empresa primero.</p>}
                        </div>
                      )}
                    </div>

                    {/* Usuario del sistema */}
                    <div className="space-y-1.5">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" checked={formNotificarUsuario} onChange={(e) => setFormNotificarUsuario(e.target.checked)} className="mt-0.5 w-4 h-4 border-2 border-[#141414] cursor-pointer" />
                        <span className="text-[11px] font-bold uppercase tracking-wide text-[#141414]">Notificar a un usuario del sistema</span>
                      </label>
                      {formNotificarUsuario && (() => {
                        const usuariosSistema = db.personas.filter(p => { const asig = db.asignacionesRoles?.find(a => a.id_persona === p.id_persona); return asig && asig.id_rol !== 4 && p.estado !== false && p.correo; });
                        if (usuariosSistema.length === 0) return <div className="ml-6"><p className="text-[10px] font-mono text-amber-700">⚠ No hay usuarios del sistema con correo.</p></div>;
                        const usuarioSel = formUsuarioNotifId ? db.personas.find(p => p.id_persona === parseInt(formUsuarioNotifId)) : currentUser;
                        const nombreSel = usuarioSel ? `${usuarioSel.nombres || ""} ${usuarioSel.apellido_paterno || ""}`.trim() : "";
                        const correoSel = usuarioSel?.correo || "";
                        return (
                          <div className="ml-6 space-y-1.5">
                            <button type="button" onClick={() => { setBusquedaUsuarioQuery(""); setShowBusquedaUsuarioModal(true); }} className="w-full bg-white border border-[#141414] p-2 text-[11px] font-mono text-[#141414] hover:bg-[#141414]/5 cursor-pointer flex items-center justify-between" aria-label="Buscar usuario">
                              <span>{nombreSel ? `${nombreSel}${correoSel ? ` (${correoSel})` : " (sin correo)"}` : "— Buscar usuario —"}</span>
                              <span className="text-[9px] uppercase font-bold text-[#141414]/60">🔍 Buscar</span>
                            </button>
                            <p className="text-[10px] font-mono text-[#141414] bg-white border border-[#141414]/30 p-1.5">{correoSel ? `✓ Correo destino: ${correoSel}` : <span className="text-amber-700">⚠ El usuario no tiene correo</span>}</p>
                          </div>
                        );
                      })()}
                    </div>

                    {formEnviarCorreo && !formNotificarContacto && !formNotificarUsuario && (
                      <div className="text-[10px] font-mono text-amber-700 bg-amber-50 border-l-2 border-amber-600 p-2">⚠ Seleccione al menos un destinatario.</div>
                    )}
                    {formEnviarCorreo && (formNotificarContacto || formNotificarUsuario) && (
                      <div className="text-[10px] font-mono text-[#141414]/70 pt-1 border-t border-[#141414]/20">
                        {(() => { const d: string[] = []; if (formNotificarContacto) d.push("Contacto"); if (formNotificarUsuario) d.push("Usuario"); return `📧 Se notificará a: ${d.join(" y ")}`; })()}
                      </div>
                    )}
                  </div>
                )}
                {!formEnviarCorreo && (
                  <p className="text-[10px] font-mono text-[#141414]/60 ml-6">✓ No se enviará notificación por correo.</p>
                )}
              </div>

              {/* FIX v2.67 — Atender y cerrar ticket en el mismo flujo de creación. */}
              <div className="border-2 border-[#141414] bg-[#141414]/5 p-3 space-y-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formAtenderAhora}
                    onChange={(e) => setFormAtenderAhora(e.target.checked)}
                    className="mt-0.5 w-4 h-4 border-2 border-[#141414] cursor-pointer"
                    aria-label="Atender el ticket inmediatamente"
                  />
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#141414]">
                    🔧 Atender este ticket inmediatamente
                  </span>
                </label>
                {formAtenderAhora && (
                  <div className="ml-6 space-y-3 border-l-2 border-[#141414]/30 pl-3">
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                        Detalle de la Atención <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={formAtencionDetalle}
                        onChange={(e) => setFormAtencionDetalle(e.target.value)}
                        placeholder="Describa el trabajo realizado, diagnóstico, etc."
                        rows={3}
                        className="w-full bg-white border border-[#141414] p-2 text-xs font-mono text-[#141414] focus:outline-none focus:bg-yellow-50 resize-none"
                      />
                    </div>
                    {/* FIX v2.81 — Fechas y horas de inicio/fin explícitas.
                        Aprovecha el espacio vacío y permite registrar atenciones
                        con tiempos precisos sin recurrir al GETDATE() del servidor. */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          🕒 Fecha de Inicio
                        </label>
                        <input
                          type="date"
                          value={formAtencionFechaInicio}
                          onChange={(e) => setFormAtencionFechaInicio(e.target.value)}
                          className="w-full bg-white border border-[#141414] p-2 text-xs font-mono text-[#141414] focus:outline-none focus:bg-yellow-50"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          🕒 Hora de Inicio
                        </label>
                        <input
                          type="time"
                          value={formAtencionHoraInicio}
                          onChange={(e) => setFormAtencionHoraInicio(e.target.value)}
                          className="w-full bg-white border border-[#141414] p-2 text-xs font-mono text-[#141414] focus:outline-none focus:bg-yellow-50"
                        />
                      </div>
                    </div>
                    {formCerrarTicket && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                            🏁 Fecha de Cierre
                          </label>
                          <input
                            type="date"
                            value={formAtencionFechaFin}
                            onChange={(e) => setFormAtencionFechaFin(e.target.value)}
                            className="w-full bg-white border border-[#141414] p-2 text-xs font-mono text-[#141414] focus:outline-none focus:bg-yellow-50"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                            🏁 Hora de Cierre
                          </label>
                          <input
                            type="time"
                            value={formAtencionHoraFin}
                            onChange={(e) => setFormAtencionHoraFin(e.target.value)}
                            className="w-full bg-white border border-[#141414] p-2 text-xs font-mono text-[#141414] focus:outline-none focus:bg-yellow-50"
                          />
                        </div>
                      </div>
                    )}
                    {(!formAtencionFechaInicio || !formAtencionHoraInicio) && (
                      <p className="text-[9px] font-mono text-[#141414]/55 leading-tight">
                        ℹ Si deja las horas vacías, el sistema registrará automáticamente la fecha y hora actuales del servidor el sistema al guardar.
                      </p>
                    )}
                    {/* FIX v2.82 — Calculadora de duración en vivo (días+horas+minutos).
                        Aparece solo cuando hay fechas de inicio y fin completas. Soporta
                        atenciones que se extienden por varios días. */}
                    {(() => {
                      const duracion = formCerrarTicket
                        ? calcularDuracionAtencion(formAtencionFechaInicio, formAtencionHoraInicio, formAtencionFechaFin, formAtencionHoraFin)
                        : null;
                      if (!duracion) return null;
                      const slaCumplido = duracion.totalHoras <= 24;
                      return (
                        <div className={`border p-2.5 ${slaCumplido ? "bg-emerald-50 border-emerald-700" : "bg-amber-50 border-amber-700"}`}>
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <span className="text-[9px] font-bold text-zinc-600 uppercase font-mono tracking-wider block">⏱ Duración calculada</span>
                              <span className={`text-base font-bold font-mono ${slaCumplido ? "text-emerald-900" : "text-amber-900"}`}>
                                {duracion.legible}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-[9px] font-mono uppercase text-zinc-600 block">Total horas</span>
                              <span className="text-sm font-bold font-mono text-[#141414]">{duracion.totalHoras}h</span>
                            </div>
                            <div className="text-right border-l border-zinc-300 pl-3">
                              <span className="text-[9px] font-mono uppercase text-zinc-600 block">SLA 24h</span>
                              <span className={`text-[11px] font-bold font-mono ${slaCumplido ? "text-emerald-800" : "text-amber-800"}`}>
                                {slaCumplido ? "✓ Cumplido" : "⚠ Excedido"}
                              </span>
                            </div>
                          </div>
                          {duracion.dias > 0 && (
                            <p className="text-[9px] font-mono text-zinc-600 mt-1.5 border-t border-zinc-300 pt-1">
                              📅 Atención extendida a {duracion.dias} día(s) — total {duracion.totalMinutos} minuto(s).
                            </p>
                          )}
                        </div>
                      );
                    })()}
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                        Solución Aplicada
                      </label>
                      <textarea
                        value={formAtencionSolucion}
                        onChange={(e) => setFormAtencionSolucion(e.target.value)}
                        placeholder="Describa la solución aplicada (opcional si aún no se cierra)"
                        rows={2}
                        className="w-full bg-white border border-[#141414] p-2 text-xs font-mono text-[#141414] focus:outline-none focus:bg-yellow-50 resize-none"
                      />
                    </div>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formCerrarTicket}
                        onChange={(e) => {
                          setFormCerrarTicket(e.target.checked);
                          // FIX v2.81 — Al desmarcar "Cerrar ticket", limpiar las
                          // fechas de cierre para que no se envíen residuos.
                          if (!e.target.checked) {
                            setFormAtencionFechaFin("");
                            setFormAtencionHoraFin("");
                          }
                        }}
                        className="mt-0.5 w-4 h-4 border-2 border-[#141414] cursor-pointer"
                        aria-label="Cerrar ticket después de atender"
                      />
                      <span className="text-[11px] font-bold uppercase tracking-wide text-[#141414]">
                        ✅ Cerrar ticket como RESUELTO después de atender
                      </span>
                    </label>
                    {formCerrarTicket && (
                      <>
                        <p className="text-[10px] font-mono text-emerald-700 ml-6">
                          ✓ El ticket se registrará, se atenderá y se cerrará como RESUELTO en una sola operación.
                        </p>
                        {/* FIX v2.73 — Checkbox opcional para notificar cierre al contacto */}
                        <label className="flex items-start gap-2 cursor-pointer ml-6 mt-2">
                          <input
                            type="checkbox"
                            checked={formNotificarCierre}
                            onChange={(e) => setFormNotificarCierre(e.target.checked)}
                            className="mt-0.5 w-4 h-4 border-2 border-[#141414] cursor-pointer"
                            aria-label="Notificar cierre al contacto"
                          />
                          <span className="text-[11px] font-bold uppercase tracking-wide text-[#141414]">
                            📧 Notificar al contacto de la empresa sobre el cierre del ticket
                          </span>
                        </label>
                      </>
                    )}
                  </div>
                )}
                {!formAtenderAhora && (
                  <p className="text-[10px] font-mono text-[#141414]/60 ml-6">
                    ✓ El ticket se registrará como PENDIENTE. Podrá atenderlo más tarde.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-[#141414] pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 text-[11px] bg-white border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors font-mono font-bold uppercase cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-[11px] bg-[#141414] text-[#E4E3E0] hover:bg-[#141414]/90 border border-[#141414] font-mono font-bold uppercase cursor-pointer"
                >
                  REGISTRAR TICKET
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {showCompanySearchModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-fade-in-quick">
          <div className="bg-[#E4E3E0] max-w-xl w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col max-h-[85vh] font-mono text-[#141414] text-xs">

            <div className="p-3 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <span className="font-bold uppercase tracking-wider text-[11px]">🔎 BUSCAR Y SELECCIONAR EMPRESA</span>
              <button
                type="button"
                onClick={() => setShowCompanySearchModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-bold"
              >
                [X]
              </button>
            </div>

            <div className="p-3 bg-zinc-200 border-b border-[#141414] flex gap-2">
              <input
                type="text"
                autoFocus
                placeholder="ESCRIBA RUC, RAZÓN SOCIAL O NOMBRE..."
                value={companySearchQuery}
                onChange={(e) => setCompanySearchQuery(e.target.value)}
                className="w-full bg-white border border-[#141414] p-1.5 focus:outline-none placeholder-zinc-400 font-mono text-xs uppercase"
              />
            </div>

            <div className="overflow-y-auto flex-1 p-3">
              <table className="w-full text-left border-collapse border border-[#141414]">
                <thead>
                  <tr className="bg-[#141414]/10 font-bold text-[10px] uppercase border-b border-[#141414]">
                    <th className="p-2 border-r border-[#141414]">RUC</th>
                    <th className="p-2 border-r border-[#141414]">Nombre Empresa</th>
                    <th className="p-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/45">
                  {searchedCompanies.map(emp => (
                    <tr key={emp.id_empresa} className="hover:bg-[#141414]/5 cursor-pointer" onClick={() => {
                      if (companySearchModalTarget === "FILTER") {
                        setSelectedCompany(emp.id_empresa.toString());
                        setSelectedBranchFilter("TODOS");
                      } else {
                        setFormEmpresa(emp.id_empresa.toString());
                        setFormSucursal("");
                        setFormContacto("");
                      }
                      setShowCompanySearchModal(false);
                    }}>
                      <td className="p-2 border-r border-[#141414] font-bold">{emp.ruc}</td>
                      <td className="p-2 border-r border-[#141414] uppercase">{emp.nombre_comercial || emp.razon_social}</td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          className="bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                        >
                          [✔ Seleccionar]
                        </button>
                      </td>
                    </tr>
                  ))}
                  {searchedCompanies.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-zinc-500 italic uppercase">Ninguna coincidencia hallada.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-3 border-t border-[#141414] bg-zinc-200 text-right">
              <button
                type="button"
                onClick={() => setShowCompanySearchModal(false)}
                className="px-3 py-1 bg-white border border-[#141414] font-bold text-[10.5px] uppercase hover:bg-zinc-100 cursor-pointer"
              >
                Cancelar Cierre
              </button>
            </div>

          </div>
        </div>
      )}

      {showBranchSearchModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-fade-in-quick">
          <div className="bg-[#E4E3E0] max-w-xl w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col max-h-[85vh] font-mono text-[#141414] text-xs">

            <div className="p-3 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <span className="font-bold uppercase tracking-wider text-[11px]">🔎 BUSCAR Y SELECCIONAR SUCURSAL</span>
              <button
                type="button"
                onClick={() => setShowBranchSearchModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-bold"
              >
                [X]
              </button>
            </div>

            <div className="p-3 bg-zinc-200 border-b border-[#141414] flex gap-2">
              <input
                type="text"
                autoFocus
                placeholder="CON EXPRESIÓN DE NOMBRE..."
                value={branchSearchQuery}
                onChange={(e) => setBranchSearchQuery(e.target.value)}
                className="w-full bg-white border border-[#141414] p-1.5 focus:outline-none placeholder-zinc-400 font-mono text-xs uppercase"
              />
            </div>

            <div className="overflow-y-auto flex-1 p-3">
              <table className="w-full text-left border-collapse border border-[#141414]">
                <thead>
                  <tr className="bg-[#141414]/10 font-bold text-[10px] uppercase border-b border-[#141414]">
                    <th className="p-2 border-r border-[#141414]">Código</th>
                    <th className="p-2 border-r border-[#141414]">Establecimiento</th>
                    <th className="p-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/45">
                  {searchedBranches.map(br => (
                    <tr key={br.id_sucursal} className="hover:bg-[#141414]/5 cursor-pointer" onClick={() => {
                      setFormSucursal(br.id_sucursal.toString());
                      setShowBranchSearchModal(false);
                    }}>
                      <td className="p-2 border-r border-[#141414]">SED_{br.id_sucursal}</td>
                      <td className="p-2 border-r border-[#141414] font-bold uppercase">{br.nombre} {br.es_principal ? "(MATRIZ)" : ""}</td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          className="bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                        >
                          [✔ Seleccionar]
                        </button>
                      </td>
                    </tr>
                  ))}
                  {searchedBranches.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-zinc-500 italic uppercase">Sede matriz o principal por defecto.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-3 border-t border-[#141414] bg-zinc-200 text-right">
              <button
                type="button"
                onClick={() => {
                  setFormSucursal("");
                  setShowBranchSearchModal(false);
                }}
                className="px-3 py-1 bg-red-805 text-white bg-red-800 hover:bg-red-900 border border-[#141414] font-bold text-[10px] uppercase mr-2 cursor-pointer"
              >
                No usar sucursal (Matriz)
              </button>
              <button
                type="button"
                onClick={() => setShowBranchSearchModal(false)}
                className="px-3 py-1 bg-white border border-[#141414] font-bold text-[10.5px] uppercase hover:bg-zinc-100 cursor-pointer"
              >
                Cerrar
              </button>
            </div>

          </div>
        </div>
      )}

      {showContactSearchModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-fade-in-quick">
          <div className="bg-[#E4E3E0] max-w-xl w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col max-h-[85vh] font-mono text-[#141414] text-xs">

            <div className="p-3 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <span className="font-bold uppercase tracking-wider text-[11px]">🔎 BUSCAR Y SELECCIONAR CONTACTO REPORTANTE</span>
              <button
                type="button"
                onClick={() => setShowContactSearchModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-bold"
              >
                [X]
              </button>
            </div>

            <div className="p-3 bg-zinc-200 border-b border-[#141414] flex gap-2">
              <input
                type="text"
                autoFocus
                placeholder="ESCRIBA EL NOMBRE DEL OPERADOR O CARGO..."
                value={contactSearchQuery}
                onChange={(e) => setContactSearchQuery(e.target.value)}
                className="w-full bg-white border border-[#141414] p-1.5 focus:outline-none placeholder-zinc-400 font-mono text-xs uppercase"
              />
            </div>

            <div className="overflow-y-auto flex-1 p-3">
              <table className="w-full text-left border-collapse border border-[#141414]">
                <thead>
                  <tr className="bg-[#141414]/10 font-bold text-[10px] uppercase border-b border-[#141414]">
                    <th className="p-2 border-r border-[#141414]">ID Persona</th>
                    <th className="p-2 border-r border-[#141414]">Nombre del Contacto Autorizado</th>
                    <th className="p-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/45">
                  {searchedContactos.map(con => (
                    <tr key={con.id_empresa_contacto} className="hover:bg-[#141414]/5 cursor-pointer" onClick={() => {
                      setFormContacto(con.id_empresa_contacto.toString());
                      setShowContactSearchModal(false);
                    }}>
                      <td className="p-2 border-r border-[#141414]">CNT_{con.id_empresa_contacto}</td>
                      <td className="p-2 border-r border-[#141414] uppercase font-bold">{con.nombre_contacto}</td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          className="bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                        >
                          [✔ Seleccionar]
                        </button>
                      </td>
                    </tr>
                  ))}
                  {searchedContactos.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-zinc-550 italic uppercase">Ningún contacto corporativo habilitado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-3 border-t border-[#141414] bg-zinc-200 text-right">
              <button
                type="button"
                onClick={() => setShowContactSearchModal(false)}
                className="px-3 py-1 bg-white border border-[#141414] font-bold text-[10.5px] uppercase hover:bg-zinc-100 cursor-pointer"
              >
                Cerrar Ventana
              </button>
            </div>

          </div>
        </div>
      )}

      {/* FIX v2.7: El panel se renderiza cuando isTracePanelOpen es true.
          Esto desacopla la visibilidad del panel del valor de viewTicket,
          evitando que se cierre si viewTicket se actualiza o se vuelve null
          temporalmente durante operaciones async. */}
      {isTracePanelOpen && viewTicket && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex justify-end z-40">
          <div className="bg-[#E4E3E0] max-w-4xl w-full h-full border-l-2 border-[#141414] shadow-none flex flex-col overflow-y-auto font-mono text-[#141414] text-xs">

            <div className="p-5 border-b border-[#141414] bg-[#141414] text-[#E4E3E0] flex items-center justify-between">
              <div>
                <span className="bg-zinc-800 text-[9px] font-bold px-2 py-0.5 rounded-none tracking-widest uppercase">
                  HISTORIAL DE ATENCIÓN Y TRAZABILIDAD
                </span>
                <h3 className="text-base font-bold tracking-tight uppercase">TICKET NRO {viewTicket.nro_ticket}</h3>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {/* FIX v2.5: Botón Exportar a PDF */}
                <button
                  type="button"
                  onClick={handleExportTicketPdf}
                  className="bg-emerald-700 hover:bg-emerald-900 border border-[#E4E3E0]/25 text-white text-[9.5px] font-mono font-bold px-2.5 py-1.5 uppercase transition-all cursor-pointer flex items-center gap-1"
                  title="Exportar este ticket con toda su trazabilidad a PDF"
                >
                  <FileDown className="w-3.5 h-3.5" /> Exportar PDF
                </button>
                {/* FIX v2.109 — Botones de Editar/Eliminar visibles según permisos.
                    El botón Eliminar SÍ aparece en tickets CERRADOS/RESUELTOS.
                    Solo el botón Editar se oculta en tickets cerrados. */}
                {currentRole !== "Cliente / Contacto empresarial" && (isAdmin || (() => {
                  const userAsig = db.asignacionesRoles?.find(a => Number(a.id_persona) === Number(currentUser.id_persona));
                  const userRoleId = userAsig ? Number(userAsig.id_rol) : null;
                  const allPerms = (db as any).rolePermissions;
                  let canMod = false, canDel = false;
                  if (Array.isArray(allPerms) && allPerms.length > 0 && userRoleId !== null) {
                    const perm = allPerms.find((p: any) => Number(p.id_rol) === userRoleId && p.modulo === 'TICKETS');
                    if (perm) { canMod = perm.modificar; canDel = perm.eliminar; }
                  }
                  return canMod || canDel;
                })()) && (
                    <>
                      {viewTicket.estado !== "CERRADO" && viewTicket.estado !== "RESUELTO" && (
                        <button
                          type="button"
                          onClick={() => setEditingTicket(viewTicket)}
                          className="bg-indigo-700 hover:bg-indigo-900 border border-[#E4E3E0]/25 text-white text-[9.5px] font-mono font-bold px-2.5 py-1.5 uppercase transition-all cursor-pointer"
                        >
                          ✏️ Editar Ticket
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteTicket(viewTicket.id_ticket)}
                        className="bg-red-700 hover:bg-red-900 border border-[#E4E3E0]/25 text-white text-[9.5px] font-mono font-bold px-2.5 py-1.5 uppercase transition-all cursor-pointer"
                      >
                        🗑️ Eliminar
                      </button>
                    </>
                  )}
                {/* FIX v2.96 — Si el ticket está CERRADO o RESUELTO, mostrar aviso de que no se puede editar. */}
                {(viewTicket.estado === "CERRADO" || viewTicket.estado === "RESUELTO") && (
                  <span className="bg-red-700 text-white text-[9.5px] font-mono font-bold px-2.5 py-1.5 uppercase border border-red-900">
                    🔒 TICKET CERRADO — NO EDITABLE
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => closeViewTicketExplicit()}
                  className="text-[#E4E3E0] hover:text-red-500 font-mono font-bold text-xl cursor-pointer ml-2"
                >
                  [X]
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6 flex-1">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white/40 p-4 border border-[#141414] rounded-none text-xs">

                <div className="space-y-2">
                  <div className="flex gap-2">
                    <span className="font-bold text-zinc-600 min-w-[120px] uppercase">N° TICKET:</span>
                    <span className="font-mono text-[#141414] font-bold">{(viewTicket as any).nro_ticket || "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-bold text-zinc-600 min-w-[120px] uppercase">EMPRESA:</span>
                    <span className="text-[#141414] font-bold uppercase truncate" title={resolveEmpresaName(getTicketEmpresaId(viewTicket))}>{resolveEmpresaName(getTicketEmpresaId(viewTicket))}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-bold text-zinc-600 min-w-[120px] uppercase">SUCURSAL:</span>
                    <span className="text-[#141414] uppercase truncate" title={resolveSucursalName(getTicketSucursalId(viewTicket))}>{resolveSucursalName(getTicketSucursalId(viewTicket))}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-bold text-zinc-600 min-w-[120px] uppercase">CONTACTO:</span>
                    <span className="text-[#141414] font-bold uppercase truncate" title={resolveContactoNombre(getTicketContactoId(viewTicket))}>{resolveContactoNombre(getTicketContactoId(viewTicket))}</span>
                  </div>
                  <div className="flex gap-2 border-t border-zinc-100 pt-1">
                    <span className="font-bold text-zinc-600 min-w-[120px] uppercase">REGISTRADO POR:</span>
                    <span className="text-[#141414] font-bold uppercase text-[11px] truncate" title={resolvePersonaNombre(getTicketUsuarioId(viewTicket))}>{resolvePersonaNombre(getTicketUsuarioId(viewTicket))}</span>
                  </div>
                  {(traceTicket?.motivo_nombre || traceTicket?.id_motivo_contacto || viewTicket.id_motivo_contacto) && (
                    <div className="flex gap-2">
                      <span className="font-bold text-zinc-600 min-w-[120px] uppercase">MOTIVO CONTACTO:</span>
                      <span className="text-blue-800 font-bold uppercase truncate">
                        {traceTicket?.motivo_nombre ?? (() => {
                          const motivoId = traceTicket?.id_motivo_contacto ?? viewTicket.id_motivo_contacto;
                          const motivo = db.motivosContacto?.find(m => m.id_motivo === motivoId);
                          return motivo ? motivo.nombre : "No especificado";
                        })()}
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex gap-2">
                    <span className="font-bold text-zinc-600 min-w-[120px] uppercase">FEC. REGISTRO:</span>
                    <span className="text-[#141414] font-mono">{viewTicket.fecha_registro} {viewTicket.hora_registro}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-bold text-zinc-600 min-w-[120px] uppercase">PRIORIDAD:</span>
                    <span className="text-[#141414] font-bold uppercase">{viewTicket.prioridad}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-bold text-zinc-600 min-w-[120px] uppercase">ESTADO ACTUAL:</span>
                    <span className="text-blue-900 border border-blue-900 px-1 font-bold uppercase">{formatTicketStatus(viewTicket.estado, viewTicket)}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-bold text-zinc-600 min-w-[120px] uppercase">MEDIO CONTACTO:</span>
                    <span className="text-zinc-800 font-bold font-mono tracking-wide">⚡ {viewTicket.medio_contacto || "EMAIL"}</span>
                  </div>
                  {viewTicket.fecha_cierre && (
                    <div className="flex gap-2">
                      <span className="font-bold text-zinc-600 min-w-[120px] uppercase">FEC. CIERRE:</span>
                      <span className="text-emerald-950 font-mono font-bold">{viewTicket.fecha_cierre} {viewTicket.hora_cierre}</span>
                    </div>
                  )}
                  <div className="flex gap-2 border-t border-zinc-100 pt-1">
                    <span className="font-bold text-zinc-600 min-w-[120px] uppercase">TÉCNICO ATENCIÓN:</span>
                    <span className="text-purple-950 font-bold uppercase text-[11px] truncate" title={getTicketAttendingTechName(getTicketIdVal(viewTicket))}>
                      🔧 {getTicketAttendingTechName(getTicketIdVal(viewTicket))}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">DESCRIPCIÓN DEL INCIDENTE INICIAL</h4>
                <div className="bg-white border border-[#141414] p-4 rounded-none text-[#141414] text-xs leading-relaxed font-sans">
                  {viewTicket.detalle_reporte}
                </div>
              </div>

              {isTraceabilityLoading && (
                <div role="status" className="flex items-center gap-2 border border-[#141414]/15 bg-white/60 px-3 py-2 text-[11px] text-zinc-600">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Cargando historial de atención…
                </div>
              )}

              {traceabilityError && (
                <div className="flex items-center justify-between gap-3 border border-red-300 bg-red-50 p-3 text-[11px] text-red-900">
                  <p>{traceabilityError}</p>
                  <button
                    type="button"
                    onClick={() => fetchTicketTraceability(getTicketIdVal(viewTicket) as number)}
                    className="shrink-0 border border-red-700 px-2.5 py-1 font-bold hover:bg-red-100"
                  >
                    Reintentar
                  </button>
                </div>
              )}

              {(() => {
                const solution = resolveTicketSolution(getTicketIdVal(viewTicket));
                return (
                  <div className="space-y-1.5 animate-fade-in-quick">
                    <h4 className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">SOLUCIÓN TÉCNICA APLICADA</h4>
                    <div className="bg-emerald-50/70 border border-emerald-800 p-4 rounded-none text-emerald-900 text-xs leading-relaxed font-sans font-semibold">
                      {solution && solution !== "Pendiente de registro / Sin solución" ? solution : "PENDIENTE DE REGISTRO / TRABAJOS EN PROCESO"}
                    </div>
                  </div>
                );
              })()}

              {currentRole !== "Cliente / Contacto empresarial" && (
                <div className="border border-[#141414] rounded-none p-4 bg-white/40 space-y-3">
                  <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">ACCIONES DE TRANSICIÓN DE ESTADO (AUDITABLE)</h4>
                  <div className="flex flex-wrap gap-2">
                    {(["PENDIENTE", "EN_ATENCION", "RESUELTO", "CERRADO", "REABIERTO", "ANULADO"] as const).map(st => {
                      const isCurrent = viewTicket.estado === st;
                      const transitionColors = {
                        PENDIENTE: "hover:bg-[#141414] hover:text-[#E4E3E0] bg-white text-[#141414] border-[#141414]",
                        EN_ATENCION: "hover:bg-[#141414] hover:text-[#E4E3E0] bg-white text-[#141414] border-[#141414]",
                        RESUELTO: "hover:bg-[#141414] hover:text-[#E4E3E0] bg-white text-[#141414] border-[#141414]",
                        CERRADO: "hover:bg-[#141414] hover:text-[#E4E3E0] bg-white text-[#141414] border-[#141414]",
                        REABIERTO: "hover:bg-[#141414] hover:text-[#E4E3E0] bg-white text-[#141414] border-[#141414]",
                        ANULADO: "hover:bg-red-800 hover:text-white bg-white text-red-600 border-red-600"
                      };

                      let isTransitionDisabled = isCurrent;
                      let transitionTitle = "";

                      if (viewTicket.estado === "ANULADO") {
                        isTransitionDisabled = true;
                        transitionTitle = "Este ticket ha sido ANULADO y no permite más transiciones de estado.";
                      } else if (viewTicket.estado === "CERRADO") {
                        if (st !== "REABIERTO") {
                          isTransitionDisabled = true;
                          transitionTitle = "Un ticket CERRADO solo puede ser REABIERTO.";
                        }
                      } else {
                        if (st === "REABIERTO") {
                          isTransitionDisabled = true;
                          transitionTitle = "La reapertura solo está disponible para tickets CERRADOS.";
                        }
                        if (st === "CERRADO" && viewTicket.estado !== "RESUELTO") {
                          isTransitionDisabled = true;
                          transitionTitle = "Solo se puede CERRAR un ticket si su estado actual es RESUELTO.";
                        }
                      }

                      return (
                        <button
                          key={st}
                          type="button"
                          disabled={isTransitionDisabled}
                          title={transitionTitle}
                          onClick={() => initiateStatusChange(st)}
                          className={`px-3 py-1.5 border font-mono font-bold text-[10px] rounded-none transition-all uppercase ${isCurrent
                            ? "bg-[#141414] text-[#E4E3E0] border-[#141414] cursor-not-allowed opacity-95"
                            : isTransitionDisabled
                              ? "bg-zinc-100 text-[#141414]/30 border-zinc-200 cursor-not-allowed opacity-50"
                              : `${transitionColors[st]} cursor-pointer`
                            }`}
                        >
                          → {st === "EN_ATENCION" ? "EN ATENCIÓN" : st === "REABIERTO" ? "REABRIR" : st === "ANULADO" ? "ANULAR TICKET" : st}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">ATENCIONES TÉCNICAS REGISTRADAS</h4>
                  {currentRole !== "Cliente / Contacto empresarial" && viewTicket.estado !== "CERRADO" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAttentionTechValue(currentUser.id_persona.toString());
                        setShowAddAttentionModal(true);
                      }}
                      className="text-xs text-blue-900 hover:underline font-bold flex items-center gap-1 font-mono uppercase cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> [+] Registrar Atención
                    </button>
                  ) : viewTicket.estado === "CERRADO" ? (
                    <span className="text-[10px] text-red-700 font-bold bg-red-150 border border-red-700 px-2 py-0.5 font-mono uppercase">
                      🔒 REGISTRO BLOQUEADO (TICKET CERRADO)
                    </span>
                  ) : null}
                </div>

                {/* FIX v2.82 — Resumen de tiempo total de atenciones del ticket.
                    Aprovecha el espacio y da al operador una métrica inmediata. */}
                {traceAtenciones.length > 0 && (() => {
                  let totalHrs = 0;
                  let totalMin = 0;
                  traceAtenciones.forEach(at => {
                    const tn = db.atencionesTiempo.find(att => Number(att.id_atencion) === Number(at.id_atencion));
                    if (tn) {
                      totalHrs += Number(tn.duracion_horas ?? 0);
                      totalMin += Number(tn.duracion_minutos ?? 0);
                    } else if (at.fecha_inicio && at.hora_inicio && at.fecha_fin && at.hora_fin) {
                      const dur = calcularDuracionAtencion(
                        String(at.fecha_inicio).substring(0, 10),
                        String(at.hora_inicio).substring(0, 8),
                        String(at.fecha_fin).substring(0, 10),
                        String(at.hora_fin).substring(0, 8)
                      );
                      if (dur) {
                        totalHrs += dur.totalHoras;
                        totalMin += dur.totalMinutos;
                      }
                    }
                  });
                  const d = Math.floor(totalHrs / 24);
                  const h = Math.floor(totalHrs % 24);
                  const m = Math.round((totalHrs - Math.floor(totalHrs)) * 60);
                  let legible = "";
                  if (d > 0) legible += `${d}d `;
                  if (h > 0 || d > 0) legible += `${h}h `;
                  legible += `${m}m`;
                  const slaCumplido = totalHrs <= 24;
                  return (
                    <div className={`border p-2.5 ${slaCumplido ? "bg-emerald-50 border-emerald-700" : "bg-amber-50 border-amber-700"} flex items-center justify-between gap-3`}>
                      <div>
                        <span className="text-[9px] font-bold text-zinc-600 uppercase font-mono tracking-wider block">⏱ Tiempo total acumulado ({traceAtenciones.length} atención(es))</span>
                        <span className={`text-base font-bold font-mono ${slaCumplido ? "text-emerald-900" : "text-amber-900"}`}>
                          {legible.trim() || "0m"}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] font-mono uppercase text-zinc-600 block">Total horas</span>
                        <span className="text-sm font-bold font-mono text-[#141414]">{totalHrs.toFixed(2)}h</span>
                      </div>
                      <div className="text-right border-l border-zinc-300 pl-3">
                        <span className="text-[9px] font-mono uppercase text-zinc-600 block">SLA 24h</span>
                        <span className={`text-[11px] font-bold font-mono ${slaCumplido ? "text-emerald-800" : "text-amber-800"}`}>
                          {slaCumplido ? "✓ Cumplido" : "⚠ Excedido"}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                <div className="space-y-3.5">
                  {traceAtenciones.length > 0 ? (
                    traceAtenciones.map((at, idx) => {
                      const timeNode = db.atencionesTiempo.find(att => Number(att.id_atencion) === Number(at.id_atencion));

                      const atStateColors = {
                        EN_PROCESO: "bg-purple-100 text-purple-950 border-purple-950",
                        PAUSADO: "bg-amber-100 text-amber-950 border-amber-950",
                        COMPLETADO: "bg-emerald-100 text-emerald-950 border-emerald-950"
                      };

                      return (
                        <div key={at.id_atencion} className="border border-[#141414] rounded-none p-4 bg-white/45 relative">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="bg-[#141414]/10 font-mono text-[10px] px-2 py-0.5 rounded-none text-[#141414] font-bold border border-[#141414]">
                                ATENCIÓN #{idx + 1}
                              </span>
                              <span className={`text-[9px] font-bold px-2 py-0.5 border rounded-none uppercase ${atStateColors[at.estado]}`}>
                                {at.estado}
                              </span>
                              {viewTicket.estado !== "CERRADO" && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingAttention(at);
                                    setEditAttentionDetalle(at.detalle_atencion);
                                    setEditAttentionSolucion(at.solucion_aplicada || "");
                                  }}
                                  className="text-[10px] text-blue-900 hover:underline font-bold ml-2 uppercase font-mono cursor-pointer flex items-center gap-0.5"
                                >
                                  ✏️ Editar
                                </button>
                              )}
                            </div>
                            <div className="text-[10px] text-zinc-600 text-right font-mono">
                              <div>📅 INICIO: <strong className="font-mono">{safeString(at.fecha_inicio)} {safeString(at.hora_inicio).substring(0, 5)}</strong></div>
                              {at.fecha_fin && (
                                <div>🏁 FIN: <strong className="font-mono">{safeString(at.fecha_fin)} {safeString(at.hora_fin).substring(0, 5)}</strong></div>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2 text-xs">
                            <p className="text-zinc-800">
                              🔧 <strong>Técnico encargado:</strong> {resolvePersonaNombre(at.id_usuario)}
                            </p>

                            <div className="bg-white p-2.5 rounded-none border border-[#141414] text-[11px]">
                              <span className="font-semibold text-zinc-600 uppercase text-[9px] block mb-1">Operaciones efectuadas:</span>
                              <div className="text-zinc-800 font-mono whitespace-pre-wrap">{at.detalle_atencion}</div>
                            </div>

                            {at.solucion_aplicada && (
                              <div className="bg-emerald-50/55 p-2.5 border border-emerald-900 rounded-none text-[11px]">
                                <span className="font-semibold text-emerald-950 uppercase text-[9px] block mb-1">🎯 Solución aplicada:</span>
                                <div className="text-zinc-800">{at.solucion_aplicada}</div>
                              </div>
                            )}

                            {timeNode && (
                              <div className="border-t border-[#141414]/20 pt-2 flex items-center justify-between text-[10px] text-blue-900 font-semibold font-mono uppercase">
                                <span>Duración total calculada:</span>
                                <span>⚡ {timeNode.duracion_formato} ({timeNode.duracion_minutos} min / {timeNode.duracion_horas} horas)</span>
                              </div>
                            )}
                            {/* FIX v2.82 — Si no hay timeNode pero sí fechas, calcular en vivo. */}
                            {!timeNode && at.fecha_inicio && at.hora_inicio && at.fecha_fin && at.hora_fin && (() => {
                              const duracion = calcularDuracionAtencion(
                                String(at.fecha_inicio).substring(0, 10),
                                String(at.hora_inicio).substring(0, 8),
                                String(at.fecha_fin).substring(0, 10),
                                String(at.hora_fin).substring(0, 8)
                              );
                              if (!duracion) return null;
                              return (
                                <div className="border-t border-[#141414]/20 pt-2 flex items-center justify-between text-[10px] text-blue-900 font-semibold font-mono uppercase">
                                  <span>Duración (calculada en vivo):</span>
                                  <span>⚡ {duracion.legible} ({duracion.totalMinutos} min / {duracion.totalHoras} horas)</span>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-zinc-500 text-xs text-center py-4 bg-white/20 border border-[#141414] rounded-none uppercase font-mono">
                      No se han reportado atenciones técnicas para este ticket.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">ARCHIVOS Y EVIDENCIAS DE AUDITORÍA</h4>
                  <button
                    type="button"
                    onClick={() => setShowFileUploadModal(true)}
                    className="text-xs text-blue-900 hover:underline font-bold flex items-center gap-1 font-mono uppercase cursor-pointer"
                  >
                    <Paperclip className="w-3.5 h-3.5" /> [+] Vincular Evidencia
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* FIX v2.68 — Usar evidencias de ticketTraceability (BD) en lugar de db.ticketArchivos (memoria). */}
                  {(ticketTraceability?.evidencias && ticketTraceability.evidencias.length > 0) ? (
                    ticketTraceability.evidencias.map((evid: any) => {
                      const uploaderName = evid.id_usuario_subio
                        ? resolvePersonaNombre(evid.id_usuario_subio)
                        : "Sistema / Técnico";
                      return (
                        <div key={evid.id_ticket_archivo || evid.id_archivo} className="border border-[#141414] p-3 bg-white rounded-none flex flex-col justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="p-2 bg-zinc-100 rounded-none text-zinc-600 shrink-0 border border-[#141414]/25">
                              <FileText className="w-5 h-5 text-zinc-800" />
                            </div>
                            <div className="text-xs min-w-0 flex-1">
                              <p className="font-bold text-[#141414] truncate" title={evid.nombre_original}>
                                {evid.nombre_original?.toUpperCase() || "ARCHIVO"}
                              </p>
                              <p className="text-[9px] text-zinc-500 font-mono">TAMAÑO: {evid.tamano_formato || "—"} - EXTENSION: .{(evid.extension || "").toUpperCase()}</p>
                              <div className="text-[9px] text-indigo-950 font-bold uppercase mt-1">
                                📁 {evid.tipo_evidencia || "EVIDENCIA"}
                              </div>
                              <p className="text-[9.5px] text-zinc-600 mt-1">
                                Subido por: <strong className="text-zinc-900 uppercase font-mono truncate" title={uploaderName}>{uploaderName}</strong>
                              </p>
                              <p className="text-[9px] text-zinc-500 font-mono mt-0.5">
                                Fecha: {evid.fecha_subida || "—"}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2 border-t border-[#141414]/10 pt-2 text-[9px] font-mono">
                            <button
                              type="button"
                              onClick={() => fetch(getDynamicApiUrl(undefined, new URLSearchParams({ action: "get_archivo", id_archivo: evid.id_archivo.toString() }))).then(r => r.json()).then(d => { if (d.status === "success" && d.data?.base64Content) { const link = document.createElement("a"); link.href = d.data.base64Content; link.download = evid.nombre_original || "archivo"; link.click(); } })}
                              className="bg-zinc-100 hover:bg-[#141414] hover:text-white border border-[#141414] px-2 py-1 font-bold uppercase cursor-pointer transition-colors"
                            >
                              👁️ Visualizar
                            </button>
                            <button
                              type="button"
                              onClick={() => fetch(getDynamicApiUrl(undefined, new URLSearchParams({ action: "get_archivo", id_archivo: evid.id_archivo.toString() }))).then(r => r.json()).then(d => { if (d.status === "success" && d.data?.base64Content) { const link = document.createElement("a"); link.href = d.data.base64Content; link.download = evid.nombre_original || "archivo"; link.click(); } })}
                              className="bg-white hover:bg-zinc-100 border border-[#141414] px-2 py-1 font-bold uppercase cursor-pointer"
                            >
                              📥 Descargar
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="col-span-2 text-zinc-500 text-xs text-center py-4 bg-white/20 border border-[#141414] rounded-none uppercase font-mono">
                      No hay archivos de evidencia vinculados.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">
                  HISTORIAL DE CAMBIOS DE ESTADO
                </h4>

                <div className="relative border-l border-[#141414] pl-4 space-y-4 ml-2">
                  {traceHistorial.map((h) => (
                    <div key={h.id_historial} className="relative text-xs">
                      <span className="absolute -left-[20.5px] top-1.5 w-2.5 h-2.5 bg-[#141414] border border-[#E4E3E0]" />

                      <div className="text-zinc-600 font-mono text-[9px]">
                        📅 {safeString(h.fecha_cambio || (h as any).fecha_change)}
                      </div>

                      <p className="font-bold text-[#141414] mt-0.5 flex items-center gap-1.5 flex-wrap uppercase text-[10px]">
                        <span>{h.estado_anterior}</span>
                        <ArrowRight className="w-3 h-3 text-[#141414]" />
                        <span className="border border-[#141414] px-1 bg-white">{h.estado_nuevo}</span>
                      </p>

                      <p className="text-zinc-800 mt-1 pl-2.5 py-1.5 bg-white border border-[#141414]/25 italic font-sans text-[11px] leading-relaxed">
                        &ldquo;{formatHistoryReason(h.motivo)}&rdquo;
                      </p>

                      <div className="text-[9px] text-zinc-500 mt-1 uppercase font-mono">
                        👤 REALIZADO POR: <strong>{h.id_usuario ? resolvePersonaNombre(h.id_usuario) : 'Sistema'}</strong>
                      </div>
                    </div>
                  ))}
                  {traceHistorial.length === 0 && (
                    <p className="text-zinc-500 text-xs italic pl-4 font-mono uppercase">No hay historial de estados registrados.</p>
                  )}
                </div>
              </div>

            </div>

            <div className="p-4 bg-zinc-200 border-t border-[#141414] flex justify-end">
              <button
                type="button"
                onClick={() => closeViewTicketExplicit()}
                className="px-5 py-2 text-xs bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 font-mono font-bold uppercase rounded-none cursor-pointer flex items-center gap-2"
              >
                <X className="w-3.5 h-3.5" />
                Cerrar Panel de Trazabilidad
              </button>
            </div>

          </div>
        </div>
      )}

      {showMotivoModal && isAdmin && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-60">
          <div className="bg-[#E4E3E0] max-w-2xl w-full max-h-[90vh] overflow-y-auto border-2 border-[#141414] rounded-none shadow-none">

            <div className="p-4 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <div>
                <h3 className="text-sm font-bold font-mono uppercase tracking-wider">ADMINISTRAR MOTIVOS DE CONTACTO</h3>
                <p className="text-[10px] text-[#E4E3E0]/70 font-mono">Gestione los motivos disponibles para los tickets</p>
              </div>
              <button
                type="button"
                onClick={() => setShowMotivoModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-mono font-bold text-lg p-1 cursor-pointer"
              >
                [X]
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-white/40 border border-[#141414] p-4 space-y-3">
                <h4 className="text-[11px] font-bold uppercase text-zinc-600">
                  {editingMotivo ? '✏️ Editar Motivo' : '➕ Nuevo Motivo'}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-[#141414] uppercase mb-1">Nombre *</label>
                    <input
                      type="text"
                      value={motivoForm.nombre || ''}
                      onChange={(e) => setMotivoForm({ ...motivoForm, nombre: e.target.value })}
                      className="w-full bg-white border border-[#141414] p-2 text-xs font-mono focus:outline-none"
                      placeholder="Ej: Incidencia de sistema"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#141414] uppercase mb-1">Orden</label>
                    <input
                      type="number"
                      value={motivoForm.orden || 0}
                      onChange={(e) => setMotivoForm({ ...motivoForm, orden: parseInt(e.target.value) || 0 })}
                      className="w-full bg-white border border-[#141414] p-2 text-xs font-mono focus:outline-none"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#141414] uppercase mb-1">Descripción</label>
                  <input
                    type="text"
                    value={motivoForm.descripcion || ''}
                    onChange={(e) => setMotivoForm({ ...motivoForm, descripcion: e.target.value })}
                    className="w-full bg-white border border-[#141414] p-2 text-xs font-mono focus:outline-none"
                    placeholder="Descripción del motivo..."
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs font-bold uppercase cursor-pointer">
                    <input
                      type="checkbox"
                      checked={motivoForm.activo ?? true}
                      onChange={(e) => setMotivoForm({ ...motivoForm, activo: e.target.checked })}
                      className="w-4 h-4"
                    />
                    Activo
                  </label>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-[#141414]/10">
                  {editingMotivo && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMotivo(null);
                        setMotivoForm({ nombre: '', descripcion: '', activo: true, orden: 0 });
                      }}
                      className="px-4 py-1.5 bg-zinc-300 border border-[#141414] text-[#141414] text-[10px] font-bold uppercase hover:bg-zinc-400 cursor-pointer"
                    >
                      Cancelar Edición
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSaveMotivo}
                    className="px-4 py-1.5 bg-[#141414] text-white text-[10px] font-bold uppercase hover:bg-[#141414]/90 border border-[#141414] cursor-pointer flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {editingMotivo ? 'Actualizar' : 'Guardar'}
                  </button>
                </div>
              </div>

              <div className="border border-[#141414] overflow-hidden">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase">
                      <th className="p-2 border-r border-[#141414]/30">ID</th>
                      <th className="p-2 border-r border-[#141414]/30">Nombre</th>
                      <th className="p-2 border-r border-[#141414]/30">Descripción</th>
                      <th className="p-2 border-r border-[#141414]/30">Orden</th>
                      <th className="p-2 border-r border-[#141414]/30">Estado</th>
                      <th className="p-2 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141414]/15">
                    {(db.motivosContacto || []).sort((a, b) => (a.orden || 0) - (b.orden || 0)).map(m => (
                      <tr key={m.id_motivo} className="hover:bg-[#141414]/5">
                        <td className="p-2 border-r border-[#141414]/10 font-bold">{m.id_motivo}</td>
                        <td className="p-2 border-r border-[#141414]/10 font-bold uppercase">{m.nombre}</td>
                        <td className="p-2 border-r border-[#141414]/10 text-zinc-600">{m.descripcion || '-'}</td>
                        <td className="p-2 border-r border-[#141414]/10 text-center">{m.orden || 0}</td>
                        <td className="p-2 border-r border-[#141414]/10">
                          <span className={`px-2 py-0.5 text-[9px] font-bold uppercase ${m.activo ? 'bg-emerald-100 text-emerald-800 border border-emerald-800' : 'bg-red-100 text-red-800 border border-red-800'}`}>
                            {m.activo ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td className="p-2 text-right flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMotivo(m);
                              setMotivoForm({
                                nombre: m.nombre,
                                descripcion: m.descripcion || '',
                                activo: m.activo ?? true,
                                orden: m.orden || 0
                              });
                            }}
                            className="bg-blue-600 text-white px-2 py-0.5 text-[9px] font-bold uppercase hover:bg-blue-700 cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMotivo(m.id_motivo)}
                            className="bg-red-600 text-white px-2 py-0.5 text-[9px] font-bold uppercase hover:bg-red-700 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(!db.motivosContacto || db.motivosContacto.length === 0) && (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-zinc-500 uppercase">No hay motivos registrados</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end pt-2 border-t border-[#141414]/10">
                <button
                  type="button"
                  onClick={() => setShowMotivoModal(false)}
                  className="px-3 py-1.5 bg-[#141414] text-white text-xs font-bold uppercase hover:bg-[#141414]/90 border border-[#141414] cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingTicket && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#E4E3E0] max-w-lg w-full max-h-[90vh] overflow-y-auto border-2 border-[#141414] rounded-none shadow-none font-mono text-[#141414] text-xs">

            <div className="p-4 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <div>
                <h3 className="text-sm font-bold font-mono uppercase tracking-wider">✏️ MODIFICAR TICKET {editingTicket.nro_ticket}</h3>
                <p className="text-[10px] text-[#E4E3E0]/70 font-mono uppercase">EDITE TODOS LOS PARÁMETROS DEL TICKET</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTicket(null)}
                className="text-[#E4E3E0] hover:text-red-500 font-mono font-bold text-lg p-1 cursor-pointer"
              >
                [X]
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveEditTicketSubmit(editingTicket);
              }}
              className="p-5 space-y-4 text-xs font-mono"
            >
              {(() => {
                const company = db.empresas.find(e => e.id_empresa === editingTicket.id_empresa);
                if (!company) return null;
                const rubro = db.rubros.find(r => r.id_rubro === company.id_rubro);
                const grupo = company.id_grupo ? db.gruposEmpresariales.find(g => g.id_grupo === company.id_grupo) : null;

                return (
                  <div className="bg-slate-100 border border-[#141414] p-3 text-[11px] font-mono text-[#141414] space-y-1.5 mb-2 animate-fade-in-quick">
                    <div className="font-bold border-b border-[#141414]/20 pb-0.5 text-[10.5px] uppercase tracking-wide text-blue-900 flex justify-between">
                      <span>🏢 EMPRESA ASOCIADA AL TICKET</span>
                      <span className="font-bold font-mono">ID #{company.id_empresa}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-1 text-slate-800">
                      <div className="sm:col-span-2">
                        <span className="font-semibold text-zinc-500">RAZÓN SOCIAL:</span> <span className="font-bold uppercase text-[#141414]">{company.nombre_comercial || company.razon_social}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-zinc-500">RUC:</span> <span className="font-bold text-[#141414]">{company.ruc}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-zinc-500">TELÉFONO:</span> <span className="font-bold text-[#141414]">{company.telefono || "--"}</span>
                      </div>
                      <div className="sm:col-span-2">
                        <span className="font-semibold text-zinc-500">CORREO:</span> <span className="underline text-blue-950 font-bold">{company.correo}</span>
                      </div>
                      {rubro && (
                        <div className="sm:col-span-2">
                          <span className="font-semibold text-zinc-500">RUBRO IND:</span> <span className="uppercase">{rubro.nombre}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">DETALLE DEL REPORTE <span className="text-red-500">*</span></label>
                <textarea
                  required
                  rows={4}
                  value={editingTicket.detalle_reporte}
                  onChange={(e) => setEditingTicket({ ...editingTicket, detalle_reporte: e.target.value })}
                  className="w-full bg-white border border-[#141414]/30 p-2 focus:outline-none text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">PRIORIDAD</label>
                  <select
                    value={editingTicket.prioridad}
                    onChange={(e) => setEditingTicket({ ...editingTicket, prioridad: e.target.value as TicketPrioridad })}
                    className="w-full bg-white border border-[#141414]/30 p-2 focus:outline-none"
                  >
                    <option value="BAJA">BAJA</option>
                    <option value="MEDIA">MEDIA</option>
                    <option value="ALTA">ALTA</option>
                    <option value="CRITICA">CRÍTICA</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">MEDIO CONTACTO</label>
                  <select
                    value={editingTicket.medio_contacto || "EMAIL"}
                    onChange={(e) => setEditingTicket({ ...editingTicket, medio_contacto: e.target.value as TicketMedioContacto })}
                    className="w-full bg-white border border-[#141414]/30 p-2 focus:outline-none"
                  >
                    <option value="EMAIL">EMAIL</option>
                    <option value="TELEFONO">TELÉFONO</option>
                    <option value="CHAT">CHAT</option>
                    <option value="PRESENCIAL">PRESENCIAL</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">MOTIVO DE CONTACTO</label>
                <select
                  value={editingTicket.id_motivo_contacto?.toString() || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEditingTicket({
                      ...editingTicket,
                      id_motivo_contacto: value ? Number(value) : null
                    });
                  }}
                  className="w-full bg-white border border-[#141414]/30 p-2 focus:outline-none"
                >
                  <option value="">-- Seleccione un motivo --</option>
                  {(db.motivosContacto || [])
                    .filter(m => m.activo !== false)
                    .sort((a, b) => (a.orden || 0) - (b.orden || 0))
                    .map(m => (
                      <option key={m.id_motivo} value={m.id_motivo.toString()}>
                        {m.nombre}
                      </option>
                    ))}
                </select>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      const currentTicket = editingTicket;
                      setEditingTicket(null);
                      setEditingMotivo(null);
                      setMotivoForm({ nombre: '', descripcion: '', activo: true, orden: 0 });
                      setShowMotivoModal(true);
                      setTimeout(() => {
                        if (currentTicket) setEditingTicket(currentTicket);
                      }, 100);
                    }}
                    className="mt-1 text-[9px] text-purple-700 hover:underline font-bold uppercase flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Administrar motivos
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">ESTADO DEL TICKET</label>
                  <select
                    value={editingTicket.estado}
                    onChange={(e) => {
                      let newEst = e.target.value as TicketEstado;
                      if (newEst === "REABIERTO") {
                        newEst = "PENDIENTE";
                        alert("El ticket se ha reabierto y ha vuelto al estado PENDIENTE.");
                        setEditingTicket({
                          ...editingTicket,
                          estado: newEst,
                          fecha_cierre: null,
                          hora_cierre: null
                        });
                      } else {
                        setEditingTicket({ ...editingTicket, estado: newEst });
                      }
                    }}
                    className="w-full bg-white border border-[#141414]/30 p-2 font-bold text-red-900 focus:outline-none"
                  >
                    <option value="PENDIENTE">PENDIENTE</option>
                    <option value="EN_ATENCION">EN ATENCIÓN</option>
                    <option value="RESUELTO">RESUELTO</option>
                    <option value="CERRADO">CERRADO</option>
                    <option value="REABIERTO">REABIERTO (REABRIR COMO PENDIENTE)</option>
                    <option value="ANULADO">ANULADO</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-zinc-600 mb-1">TÉCNICO / RESPONSABLE</label>
                  <select
                    value={editingTicket.id_usuario || ""}
                    onChange={(e) => setEditingTicket({ ...editingTicket, id_usuario: Number(e.target.value) || currentUser.id_persona })}
                    className="w-full bg-white border border-[#141414]/30 p-2 focus:outline-none"
                  >
                    <option value="">-- SIN TÉCNICO ASIGNADO --</option>
                    {db.personas.filter(p => {
                      const asig = db.asignacionesRoles.find(a => a.id_persona === p.id_persona);
                      return asig && [1, 2, 3].includes(asig.id_rol);
                    }).map(p => (
                      <option key={p.id_persona} value={p.id_persona}>
                        {p.nombres} {p.apellido_paterno}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-[#141414]/20 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingTicket(null)}
                  className="px-3 py-1.5 bg-white border border-[#141414] text-[#141414] font-bold uppercase hover:bg-slate-100 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] font-bold uppercase hover:bg-black cursor-pointer border border-[#141414] flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  Guardar Cambios
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {showStatusChangeModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#E4E3E0] max-w-md w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col font-mono text-[#141414] text-xs">

            <div className="p-3 bg-[#141414] text-[#E4E3E0] font-bold uppercase tracking-wider text-[11px] border-b border-[#141414]">
              Cambio de estado del ticket
            </div>

            <div className="p-4 space-y-3">
              <p className="text-zinc-750 font-sans leading-relaxed text-xs">
                Va a cambiar el estado de este ticket a <strong className="border border-[#141414] px-1 bg-white text-[#141414] font-mono font-bold uppercase">{statusChangeTarget === "EN_ATENCION" ? "EN ATENCIÓN" : statusChangeTarget === "REABIERTO" ? "REABRIR" : statusChangeTarget}</strong>. Por favor indique el motivo del cambio para el historial.
              </p>

              <textarea
                required
                rows={3}
                value={statusChangeReason}
                onChange={(e) => setStatusChangeReason(e.target.value)}
                placeholder="Escriba el motivo del cambio de estado..."
                className="w-full bg-white border border-[#141414] rounded-none p-2 focus:outline-none font-mono text-xs placeholder-zinc-400"
              />

              {/* FIX v2.78 — Checkbox para notificar al contacto al cerrar/resolver. */}
              {(statusChangeTarget === "CERRADO" || statusChangeTarget === "RESUELTO") && (
                <label className="flex items-start gap-2 cursor-pointer bg-[#141414]/5 p-2 border border-[#141414]/30">
                  <input
                    type="checkbox"
                    checked={formNotificarCierre}
                    onChange={(e) => setFormNotificarCierre(e.target.checked)}
                    className="mt-0.5 w-4 h-4 border-2 border-[#141414] cursor-pointer"
                    aria-label="Notificar al contacto sobre el cierre"
                  />
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#141414]">
                    📧 Notificar al contacto de la empresa sobre el cierre del ticket
                  </span>
                </label>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowStatusChangeModal(false);
                    setStatusChangeTarget(null);
                  }}
                  className="px-3 py-1.5 bg-white border border-[#141414] text-[#141414] hover:bg-zinc-100 font-mono font-bold uppercase rounded-none cursor-pointer text-[10px]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleApplyStatusChange}
                  className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 font-mono font-bold uppercase rounded-none cursor-pointer text-[10px]"
                >
                  Confirmar cambio
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {showAddAttentionModal && viewTicket && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#E4E3E0] max-w-lg w-full max-h-[90vh] overflow-y-auto border-2 border-[#141414] rounded-none shadow-none font-mono text-[#141414] text-xs">

            <div className="p-4 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <div>
                <h3 className="text-sm font-bold font-mono uppercase tracking-wider">Registrar Atención Técnica</h3>
                <p className="text-[10px] text-[#E4E3E0]/70 font-mono uppercase">Complete los detalles de la atención realizada.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddAttentionModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-mono font-bold text-lg p-1 cursor-pointer"
              >
                [X]
              </button>
            </div>

            <form onSubmit={handleAddAttention} className="p-4 space-y-4 text-xs font-mono text-[#141414]">
              {(() => {
                const company = db.empresas.find(e => e.id_empresa === viewTicket.id_empresa);
                if (!company) return null;
                return (
                  <div className="bg-slate-100 border border-[#141414] p-3 text-[11px] font-mono text-[#141414] mb-2 animate-fade-in-quick">
                    <div className="font-bold text-[#141414] uppercase">
                      🏢 EMPRESA: <span className="text-blue-900">{company.nombre_comercial || company.razon_social}</span>
                    </div>
                    <div className="text-zinc-600 mt-1 flex justify-between">
                      <span>RUC: {company.ruc}</span>
                      <span>TELEFONO: {company.telefono || "--"}</span>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-[#141414] uppercase tracking-wide mb-1 font-mono">
                    Técnico Encargado <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={attentionTechValue}
                    onChange={(e) => setAttentionTechValue(e.target.value)}
                    className="w-full bg-white border border-[#141414] p-1.5 focus:outline-none text-[#141414] rounded-none font-mono font-bold"
                  >
                    {/* FIX v2.96 — Mostrar solo usuarios con rol Técnico (id_rol=3) o Admin (id_rol=1) o Supervisor (id_rol=2).
                        Antes mostraba TODAS las personas incluyendo contactos de empresas. */}
                    {db.personas.filter(p => {
                      const asig = db.asignacionesRoles?.find(a => Number(a.id_persona) === Number(p.id_persona));
                      const rolId = asig ? Number(asig.id_rol) : null;
                      // Mostrar Admin (1), Supervisor (2), Técnico (3) y cualquier rol personalizado (>4)
                      // NO mostrar contactos de empresa (rol 4)
                      return rolId !== null && rolId !== 4 && p.estado !== false;
                    }).map(p => (
                      <option key={p.id_persona} value={p.id_persona}>{p.nombres.toUpperCase()} {p.apellido_paterno.toUpperCase()}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-[#141414] uppercase tracking-wide mb-1 font-mono">
                    Estado de Atención <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={attentionEstado}
                    onChange={(e) => setAttentionEstado(e.target.value as AtencionEstado)}
                    className="w-full bg-white border border-[#141414] p-1.5 focus:outline-none text-[#141414] rounded-none font-mono font-bold"
                  >
                    <option value="EN_PROCESO">⚙️ EN PROCESO</option>
                    <option value="COMPLETADO">✅ COMPLETADO</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-[#141414]/10 pt-3">
                <div>
                  <label className="block text-[10px] font-bold text-[#141414] uppercase tracking-wide mb-1 font-mono">
                    Fecha de Inicio <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={attentionInicioFecha}
                    onChange={(e) => setAttentionInicioFecha(e.target.value)}
                    className="w-full bg-white border border-[#141414] p-1.5 text-[#141414] rounded-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#141414] uppercase tracking-wide mb-1 font-mono">
                    Hora de Inicio <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="time"
                    required
                    value={attentionInicioHora}
                    onChange={(e) => setAttentionInicioHora(e.target.value)}
                    className="w-full bg-white border border-[#141414] p-1.5 text-[#141414] rounded-none font-mono"
                  />
                </div>
              </div>

              {attentionEstado === "COMPLETADO" && (
                <div className="grid grid-cols-2 gap-3 border-t border-[#141414]/15 pt-3 bg-white/20 p-2 border border-[#141414]/20">
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-950 uppercase tracking-wide mb-1 font-mono">
                      Fecha de Fin <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={attentionFinFecha}
                      onChange={(e) => setAttentionFinFecha(e.target.value)}
                      className="w-full bg-white border border-emerald-900 p-1.5 text-emerald-950 rounded-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-950 uppercase tracking-wide mb-1 font-mono">
                      Hora de Fin <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="time"
                      required
                      value={attentionFinHora}
                      onChange={(e) => setAttentionFinHora(e.target.value)}
                      className="w-full bg-white border border-emerald-900 p-1.5 text-emerald-950 rounded-none font-mono"
                    />
                  </div>
                </div>
              )}

              <div className="border-t border-[#141414]/10 pt-3">
                <label className="block text-[10px] font-bold text-[#141414] uppercase tracking-wide mb-1 font-mono">
                  Operaciones Técnicas Efectuadas <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  value={attentionDetalle}
                  onChange={(e) => setAttentionDetalle(e.target.value)}
                  placeholder="Detalle los trabajos realizados, mediciones de ping, reinstalaciones de software, firmware, cableado o pruebas..."
                  className="w-full bg-white border border-[#141414] rounded-none p-2 focus:outline-none font-mono placeholder-zinc-400"
                />
              </div>

              {attentionEstado === "COMPLETADO" && (
                <div>
                  <label className="block text-[10px] font-bold text-emerald-950 uppercase tracking-wide mb-1 font-mono">
                    Solución Definitiva Aplicada <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    required
                    rows={2}
                    value={attentionSolucion}
                    onChange={(e) => setAttentionSolucion(e.target.value)}
                    placeholder="Instalación de versión de firmware x.y, reparación de cable, etc..."
                    className="w-full bg-white border border-emerald-900 p-2 focus:outline-none font-mono rounded-none placeholder-zinc-400 text-emerald-950 font-bold"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-[#141414]/15 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddAttentionModal(false)}
                  className="px-3 py-1.5 bg-white border border-[#141414] text-[#141414] hover:bg-zinc-100 font-mono font-bold uppercase rounded-none cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 border border-[#141414] font-mono font-bold uppercase rounded-none cursor-pointer"
                >
                  Confirmar Grabar Detalle
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {editingAttention && viewTicket && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#E4E3E0] max-w-lg w-full max-h-[90vh] overflow-y-auto border-2 border-[#141414] rounded-none shadow-none font-mono text-[#141414] text-xs">

            <div className="p-4 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <div>
                <h3 className="text-sm font-bold font-mono uppercase tracking-wider">✏️ MODIFICAR ATENCIÓN TÉCNICA</h3>
                <p className="text-[10px] text-[#E4E3E0]/70 font-mono uppercase">EDITE LAS OPERACIONES REALIZADAS Y LA SOLUCIÓN ASOCIADA.</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingAttention(null)}
                className="text-[#E4E3E0] hover:text-red-500 font-mono font-bold text-lg p-1 cursor-pointer"
              >
                [X]
              </button>
            </div>

            <form onSubmit={handleSaveEditAttention} className="p-4 space-y-4 text-xs font-mono text-[#141414]">
              <div className="bg-slate-100 border border-[#141414] p-3 text-[11px] font-mono text-[#141414] mb-2 animate-fade-in-quick">
                <div className="font-bold text-[#141414] uppercase">
                  🔧 ATENCIÓN REGISTRADA POR: <span className="text-blue-900">{resolvePersonaNombre(editingAttention.id_usuario)}</span>
                </div>
                <div className="text-zinc-600 mt-1 flex justify-between">
                  <span>FECHA: {safeString(editingAttention.fecha_inicio)} {safeString(editingAttention.hora_inicio).substring(0, 5)}</span>
                  <span>ESTADO: <strong className="text-slate-800">{editingAttention.estado}</strong></span>
                </div>
              </div>

              <div className="border-t border-[#141414]/10 pt-3">
                <label className="block text-[10px] font-bold text-[#141414] uppercase tracking-wide mb-1 font-mono">
                  Operaciones Técnicas Efectuadas <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  value={editAttentionDetalle}
                  onChange={(e) => setEditAttentionDetalle(e.target.value)}
                  placeholder="Detalle los trabajos realizados..."
                  className="w-full bg-white border border-[#141414] rounded-none p-2 focus:outline-none font-mono placeholder-zinc-400"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#141414] uppercase tracking-wide mb-1 font-mono">
                  Solución Definitiva Aplicada (Opcional)
                </label>
                <textarea
                  rows={2}
                  value={editAttentionSolucion}
                  onChange={(e) => setEditAttentionSolucion(e.target.value)}
                  placeholder="Instalación de versión de firmware, etc..."
                  className="w-full bg-white border border-[#141414] p-2 focus:outline-none font-mono rounded-none placeholder-zinc-400"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-[#141414]/15 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingAttention(null)}
                  className="px-3 py-1.5 bg-white border border-[#141414] text-[#141414] hover:bg-zinc-100 font-mono font-bold uppercase rounded-none cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 border border-[#141414] font-mono font-bold uppercase rounded-none cursor-pointer"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {showFileUploadModal && viewTicket && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#E4E3E0] max-w-sm w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col font-mono text-[#141414] text-xs">

            <div className="p-3 bg-[#141414] text-[#E4E3E0] font-bold uppercase tracking-wider text-[11px] border-b border-[#141414]">
              📎 Integridad de Archivo (SHA-256)
            </div>

            <div className="p-4 space-y-4">
              <p className="text-zinc-700 font-sans leading-relaxed text-xs">
                Seleccione el archivo que desea vincular. El sistema calculará el hash criptográfico SHA-256 y registrará su firma digital inmediatamente.
              </p>

              <form onSubmit={handleUploadFileSimulation} className="space-y-4 font-mono text-xs text-[#141414]">
                <div>
                  <label className="block text-[10px] font-bold text-[#141414] mb-1 uppercase tracking-wide">Clase de Evidencia <span className="text-red-500">*</span></label>
                  <select
                    value={fileEvidenceType}
                    onChange={(e) => setFileEvidenceType(e.target.value)}
                    className="w-full bg-white border border-[#141414] p-2 rounded-none focus:outline-none font-bold"
                  >
                    <option value="REPORTE_INICIAL">📄 REPORTE INICIAL</option>
                    <option value="EVIDENCIA_ADICIONAL">🔍 EVIDENCIA ADICIONAL</option>
                    <option value="FOTO_FINAL">📸 FOTOGRAFÍA FINAL</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-[#141414] mb-1 uppercase tracking-wide">Seleccionar Archivo Real <span className="text-red-500">*</span></label>
                  <input
                    type="file"
                    required
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setFileToUpload(e.target.files[0]);
                      }
                    }}
                    className="w-full bg-white border border-[#141414] p-2 rounded-none text-[#141414] focus:outline-none font-mono"
                  />
                </div>

                <div className="flex justify-end gap-2 border-t border-[#141414]/15 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowFileUploadModal(false);
                      setFileToUpload(null);
                    }}
                    className="px-3 py-1.5 bg-white border border-[#141414] text-[#141414] hover:bg-zinc-100 font-mono font-bold uppercase rounded-none cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 border border-[#141414] font-mono font-bold uppercase rounded-none cursor-pointer"
                  >
                    [VINCULAR EVIDENCIA]
                  </button>
                </div>
              </form>
            </div>

          </div>
        </div>
      )}

      {previewArchivo && (
        <div className="fixed inset-0 bg-[#141414]/80 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#E4E3E0] max-w-lg w-full border-2 border-[#141414] shadow-none flex flex-col font-mono text-[#141414] text-xs">
            <div className="p-3.5 border-b border-[#141414] bg-[#141414] text-[#E4E3E0] flex items-center justify-between">
              <div>
                <span className="bg-zinc-800 text-[8px] font-bold px-1.5 py-0.5 rounded-none tracking-widest uppercase">
                  VISUALIZADOR DE EVIDENCIA DIGITAL
                </span>
                <h3 className="text-xs font-bold truncate max-w-xs uppercase mt-0.5" title={previewArchivo.nombre_original}>{previewArchivo.nombre_original}</h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewArchivo(null)}
                className="text-[#E4E3E0] hover:text-red-500 font-mono font-bold text-lg cursor-pointer"
              >
                [X]
              </button>
            </div>

            <div className="p-4 bg-white border-b border-[#141414] flex flex-col items-center justify-center min-h-[220px]">
              {["png", "jpg", "jpeg", "gif", "webp"].includes(previewArchivo.extension.toLowerCase()) || previewArchivo.tipo_mime.startsWith("image/") ? (
                <div className="w-full flex flex-col items-center gap-2">
                  {previewArchivo.base64Content ? (
                    <img
                      src={previewArchivo.base64Content}
                      alt={previewArchivo.nombre_original}
                      className="max-h-[380px] max-w-full object-contain border border-[#141414]"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-44 bg-slate-50 border border-dashed border-[#141414]/30 flex flex-col items-center justify-center p-3 relative overflow-hidden">
                      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
                      <div className="z-10 flex flex-col items-center text-center">
                        <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-600 flex items-center justify-center text-emerald-950 font-bold mb-1">
                          ✓ IMG
                        </div>
                        <span className="text-[10px] font-bold uppercase text-[#141414]">Captura de Evidencia Técnica</span>
                        <span className="text-[8px] text-zinc-500 font-mono max-w-[240px] truncate mt-0.5 font-bold" title={previewArchivo.ruta}>RUTA: {previewArchivo.ruta}</span>
                        <div className="mt-3 text-[7.5px] text-emerald-900 font-mono border border-emerald-900/30 px-2 py-1 bg-emerald-50 max-w-[280px]">
                          EVIDENCIA DE SISTEMA CONFIRMADA • SHA-256 MATCHED
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center p-6 flex flex-col items-center">
                  <FileText className="w-16 h-16 text-zinc-500 mb-3 stroke-1" />
                  <span className="text-xs font-bold uppercase block text-[#141414]">Archivo de Documentación / Log</span>
                  <span className="text-[9px] text-zinc-500 font-mono mt-1">FORMATO BINARIO: .{previewArchivo.extension.toUpperCase()} ({previewArchivo.tipo_mime})</span>

                  <div className="mt-3.5 bg-zinc-50 border border-[#141414]/25 p-3 font-mono text-[8px] text-left text-zinc-600 max-w-[320px] w-full max-h-24 overflow-y-auto leading-normal whitespace-pre-wrap">
                    {"[HEADER_METADATA_START]\n" +
                      `FILE_NAME: ${previewArchivo.nombre_original}\n` +
                      `CHECKSUM: ${previewArchivo.checksum}\n` +
                      `UPLOADER_ID: ${previewArchivo.id_usuario_subio}\n` +
                      `TIMESTAMP: ${previewArchivo.fecha_subida || "2026-06-18 09:00"}\n` +
                      "[BINARY_STREAM_READY_FOR_EXTRACTION]"}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 space-y-2">
              <div className="grid grid-cols-2 gap-2 text-[10px] bg-white/50 p-2.5 border border-[#141414]/15">
                <div>
                  <span className="text-zinc-500 block uppercase text-[8px]">Nombre Original:</span>
                  <strong className="text-zinc-900 truncate block font-sans font-bold" title={previewArchivo.nombre_original}>{previewArchivo.nombre_original}</strong>
                </div>
                <div>
                  <span className="text-zinc-500 block uppercase text-[8px]">Ubicación Física:</span>
                  <strong className="text-zinc-800 font-mono truncate block font-bold" title={previewArchivo.ruta}>{previewArchivo.ruta}</strong>
                </div>
                <div>
                  <span className="text-zinc-500 block uppercase text-[8px]">Tamaño Formateado:</span>
                  <strong className="text-zinc-800 font-bold">{previewArchivo.tamano_formato}</strong>
                </div>
                <div>
                  <span className="text-zinc-500 block uppercase text-[8px]">Subido por:</span>
                  <strong className="text-zinc-800 uppercase font-bold truncate" title={previewArchivo.id_usuario_subio ? resolvePersonaNombre(previewArchivo.id_usuario_subio) : "Sistema / Técnico"}>{previewArchivo.id_usuario_subio ? resolvePersonaNombre(previewArchivo.id_usuario_subio) : "Sistema / Técnico"}</strong>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2 text-[10px]">
                <button
                  type="button"
                  onClick={() => handleDownloadFile(previewArchivo)}
                  className="bg-[#141414] text-[#E4E3E0] hover:bg-[#141414]/90 border border-[#141414] px-3.5 py-1.5 font-bold uppercase cursor-pointer flex items-center gap-1.5"
                >
                  📥 Descargar Archivo
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewArchivo(null)}
                  className="bg-white hover:bg-zinc-100 border border-[#141414] px-3 py-1.5 font-bold uppercase cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* FIX v2.34 — MODAL "VER CORREOS DESTINO" AL CREAR TICKET     */}
      {/* Colores unificados a paleta de la página (#141414/#E4E3E0).  */}
      {/* ============================================================ */}
      {showCorreosModal && (
        <div className="fixed inset-0 bg-[#141414]/70 backdrop-blur-sm flex items-center justify-center p-4 z-[90]">
          <div className="bg-[#E4E3E0] border-4 border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-lg w-full rounded-none">
            <div className="p-4 bg-[#141414] text-[#E4E3E0] flex justify-between items-center border-b-2 border-[#141414]">
              <h3 className="text-xs font-mono uppercase font-bold tracking-widest">
                📧 Correos destino de la notificación
              </h3>
              <button
                type="button"
                onClick={() => setShowCorreosModal(false)}
                className="text-[#E4E3E0] hover:text-red-400 font-mono font-bold text-sm cursor-pointer"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-[#141414]/60">
                Lista completa de destinatarios que recibirán el correo automático al registrar el ticket
              </p>
              <div className="border border-[#141414] max-h-[300px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-[11px] font-mono text-[#141414]">
                  <thead className="sticky top-0">
                    <tr className="bg-[#141414] text-[#E4E3E0] text-[9px] font-bold uppercase tracking-wider">
                      <th scope="col" className="py-2 px-3">Nombre</th>
                      <th scope="col" className="py-2 px-3">Correo</th>
                      <th scope="col" className="py-2 px-3">Rol</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141414]/10">
                    {(() => {
                      const correosDestino: Array<{ nombre: string, correo: string, rol: string }> = [];
                      if (formContacto) {
                        const c = db.contactosEmpresariales.find(x => x.id_empresa_contacto === parseInt(formContacto));
                        const p = c ? db.personas.find(per => per.id_persona === c.id_persona) : null;
                        const correoContacto = c?.correo_empresa || p?.correo || "";
                        if (correoContacto) {
                          correosDestino.push({
                            nombre: p ? `${p.nombres} ${p.apellido_paterno}` : "Contacto",
                            correo: correoContacto,
                            rol: "Contacto del ticket",
                          });
                        }
                      }
                      db.personas.forEach(per => {
                        if (per.correo && per.id_rol === 1 && per.estado !== false) {
                          if (!correosDestino.some(c => c.correo === per.correo)) {
                            correosDestino.push({
                              nombre: `${per.nombres} ${per.apellido_paterno}`,
                              correo: per.correo,
                              rol: "Administrador",
                            });
                          }
                        }
                      });
                      if (correosDestino.length === 0) {
                        return (
                          <tr>
                            <td colSpan={3} className="py-4 text-center text-[#141414]/50 italic uppercase">
                              No hay correos destino configurados.
                            </td>
                          </tr>
                        );
                      }
                      return correosDestino.map((d, i) => (
                        <tr key={i} className="hover:bg-[#141414]/5">
                          <td className="py-2 px-3 font-bold">{d.nombre}</td>
                          <td className="py-2 px-3">{d.correo}</td>
                          <td className="py-2 px-3 text-[#141414]/70">
                            <span className={`px-1.5 py-0.5 text-[9px] uppercase font-bold ${d.rol === "Contacto del ticket"
                              ? "bg-[#141414] text-[#E4E3E0]"
                              : "bg-[#141414]/60 text-[#E4E3E0]"
                              }`}>
                              {d.rol}
                            </span>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
              <div className="bg-[#141414]/5 border-l-4 border-[#141414] p-2 text-[10px] font-mono text-[#141414]/80">
                <strong>Asunto:</strong> Ticket #&lt;NRO_TICKET&gt; registrado · ERP SOPORTE
                <br />
                <strong>Contenido:</strong> N° de ticket, prioridad y detalle del reporte.
              </div>
              <div className="flex justify-end border-t border-[#141414] pt-3">
                <button
                  type="button"
                  onClick={() => setShowCorreosModal(false)}
                  className="px-3 py-1.5 text-[11px] bg-[#141414] text-[#E4E3E0] border border-[#141414] hover:bg-[#141414]/90 transition-colors font-mono font-bold uppercase cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* FIX v2.66 — MODAL BÚSQUEDA DE CONTACTO PARA NOTIFICACIÓN     */}
      {/* ============================================================ */}
      {showBusquedaContactoModal && formEmpresa && (
        <div className="fixed inset-0 bg-[#141414]/70 backdrop-blur-sm flex items-center justify-center p-4 z-[80]">
          <div className="bg-[#E4E3E0] border-4 border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full max-h-[80vh] flex flex-col rounded-none">
            <div className="p-4 bg-[#141414] text-[#E4E3E0] flex justify-between items-center border-b-2 border-[#141414]">
              <h3 className="text-xs font-mono uppercase font-bold tracking-widest">🔍 Buscar contacto de empresa</h3>
              <button type="button" onClick={() => setShowBusquedaContactoModal(false)} className="text-[#E4E3E0] hover:text-red-400 font-mono font-bold text-sm cursor-pointer" aria-label="Cerrar">✕</button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <input type="text" value={busquedaContactoQuery} onChange={(e) => setBusquedaContactoQuery(e.target.value)} placeholder="Buscar por nombre o correo..." className="w-full bg-white border border-[#141414] p-2 text-xs font-mono text-[#141414] focus:outline-none" autoFocus />
              <div className="border border-[#141414] max-h-[400px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs font-mono text-[#141414]">
                  <thead className="sticky top-0"><tr className="bg-[#141414] text-[#E4E3E0] text-[9px] font-bold uppercase tracking-wider"><th className="py-2 px-3">Nombre</th><th className="py-2 px-3">Correo</th><th className="py-2 px-3">Cargo</th><th className="py-2 px-3 text-right">Acción</th></tr></thead>
                  <tbody className="divide-y divide-[#141414]/10">
                    {(() => {
                      const contactosEmpresa = db.contactosEmpresariales.filter(c => c.id_empresa === parseInt(formEmpresa));
                      const q = busquedaContactoQuery.toLowerCase().trim();
                      const filtrados = q ? contactosEmpresa.filter(c => { const p = db.personas.find(per => per.id_persona === c.id_persona); const nombre = p ? `${p.nombres} ${p.apellido_paterno}`.toLowerCase() : ""; const correo = (c.correo_empresa || p?.correo || "").toLowerCase(); return nombre.includes(q) || correo.includes(q); }) : contactosEmpresa;
                      if (filtrados.length === 0) return <tr><td colSpan={4} className="py-6 text-center text-[#141414]/50 italic uppercase">No se encontraron contactos.</td></tr>;
                      return filtrados.map(c => {
                        const p = db.personas.find(per => per.id_persona === c.id_persona);
                        const nombre = p ? `${p.nombres} ${p.apellido_paterno}` : `Contacto #${c.id_empresa_contacto}`;
                        const correo = c.correo_empresa || p?.correo || "";
                        const esSeleccionado = formContactoNotifId && parseInt(formContactoNotifId) === c.id_empresa_contacto;
                        return (
                          <tr key={c.id_empresa_contacto} className={`hover:bg-[#141414]/5 ${esSeleccionado ? "bg-[#141414]/10" : ""}`}>
                            <td className="py-2 px-3 font-bold uppercase">{nombre}</td>
                            <td className="py-2 px-3">{correo || <span className="text-amber-700">sin correo</span>}</td>
                            <td className="py-2 px-3 text-[#141414]/70">{c.cargo || "—"}</td>
                            <td className="py-2 px-3 text-right">
                              <button type="button" onClick={() => { setFormContactoNotifId(c.id_empresa_contacto.toString()); setShowBusquedaContactoModal(false); }} className={`px-2 py-1 border border-[#141414] text-[9px] font-bold uppercase cursor-pointer transition-colors ${esSeleccionado ? "bg-[#141414] text-[#E4E3E0]" : "bg-white hover:bg-[#141414] hover:text-[#E4E3E0]"}`}>{esSeleccionado ? "✓ Seleccionado" : "Seleccionar"}</button>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-[#141414]">
                <button type="button" onClick={() => { setFormContactoNotifId(""); setShowBusquedaContactoModal(false); }} className="px-3 py-1.5 text-[10px] bg-white border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] font-mono font-bold uppercase cursor-pointer">Usar contacto del ticket</button>
                <button type="button" onClick={() => setShowBusquedaContactoModal(false)} className="px-3 py-1.5 text-[10px] bg-[#141414] text-[#E4E3E0] border border-[#141414] hover:bg-[#141414]/90 font-mono font-bold uppercase cursor-pointer">Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* FIX v2.66 — MODAL BÚSQUEDA DE USUARIO DEL SISTEMA            */}
      {/* ============================================================ */}
      {showBusquedaUsuarioModal && (
        <div className="fixed inset-0 bg-[#141414]/70 backdrop-blur-sm flex items-center justify-center p-4 z-[80]">
          <div className="bg-[#E4E3E0] border-4 border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full max-h-[80vh] flex flex-col rounded-none">
            <div className="p-4 bg-[#141414] text-[#E4E3E0] flex justify-between items-center border-b-2 border-[#141414]">
              <h3 className="text-xs font-mono uppercase font-bold tracking-widest">🔍 Buscar usuario del sistema</h3>
              <button type="button" onClick={() => setShowBusquedaUsuarioModal(false)} className="text-[#E4E3E0] hover:text-red-400 font-mono font-bold text-sm cursor-pointer" aria-label="Cerrar">✕</button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <input type="text" value={busquedaUsuarioQuery} onChange={(e) => setBusquedaUsuarioQuery(e.target.value)} placeholder="Buscar por nombre o correo..." className="w-full bg-white border border-[#141414] p-2 text-xs font-mono text-[#141414] focus:outline-none" autoFocus />
              <div className="border border-[#141414] max-h-[400px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs font-mono text-[#141414]">
                  <thead className="sticky top-0"><tr className="bg-[#141414] text-[#E4E3E0] text-[9px] font-bold uppercase tracking-wider"><th className="py-2 px-3">Nombre</th><th className="py-2 px-3">Correo</th><th className="py-2 px-3">Rol</th><th className="py-2 px-3 text-right">Acción</th></tr></thead>
                  <tbody className="divide-y divide-[#141414]/10">
                    {(() => {
                      const usuariosSistema = db.personas.filter(p => { const asig = db.asignacionesRoles?.find(a => a.id_persona === p.id_persona); return asig && asig.id_rol !== 4 && p.estado !== false && p.correo; });
                      const q = busquedaUsuarioQuery.toLowerCase().trim();
                      const filtrados = q ? usuariosSistema.filter(p => { const nombre = `${p.nombres} ${p.apellido_paterno}`.toLowerCase(); const correo = (p.correo || "").toLowerCase(); return nombre.includes(q) || correo.includes(q); }) : usuariosSistema;
                      if (filtrados.length === 0) return <tr><td colSpan={4} className="py-6 text-center text-[#141414]/50 italic uppercase">No se encontraron usuarios.</td></tr>;
                      return filtrados.map(p => {
                        const asig = db.asignacionesRoles?.find(a => a.id_persona === p.id_persona);
                        const rol = asig ? db.roles?.find(r => r.id_rol === asig.id_rol) : null;
                        const esActual = currentUser?.id_persona === p.id_persona;
                        const esSeleccionado = formUsuarioNotifId && parseInt(formUsuarioNotifId) === p.id_persona;
                        return (
                          <tr key={p.id_persona} className={`hover:bg-[#141414]/5 ${esSeleccionado ? "bg-[#141414]/10" : ""}`}>
                            <td className="py-2 px-3 font-bold uppercase">{p.nombres} {p.apellido_paterno}{esActual && <span className="text-[9px] text-[#1f3a5f] ml-1">[ACTUAL]</span>}</td>
                            <td className="py-2 px-3">{p.correo}</td>
                            <td className="py-2 px-3 text-[#141414]/70">{rol?.nombre || "—"}</td>
                            <td className="py-2 px-3 text-right">
                              <button type="button" onClick={() => { setFormUsuarioNotifId(p.id_persona.toString()); setShowBusquedaUsuarioModal(false); }} className={`px-2 py-1 border border-[#141414] text-[9px] font-bold uppercase cursor-pointer transition-colors ${esSeleccionado ? "bg-[#141414] text-[#E4E3E0]" : "bg-white hover:bg-[#141414] hover:text-[#E4E3E0]"}`}>{esSeleccionado ? "✓ Seleccionado" : "Seleccionar"}</button>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-[#141414]">
                <button type="button" onClick={() => { setFormUsuarioNotifId(""); setShowBusquedaUsuarioModal(false); }} className="px-3 py-1.5 text-[10px] bg-white border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] font-mono font-bold uppercase cursor-pointer">Usar usuario actual</button>
                <button type="button" onClick={() => setShowBusquedaUsuarioModal(false)} className="px-3 py-1.5 text-[10px] bg-[#141414] text-[#E4E3E0] border border-[#141414] hover:bg-[#141414]/90 font-mono font-bold uppercase cursor-pointer">Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* FIX v2.34 — MODAL DE NOTIFICACIÓN (reemplaza alert())        */}
      {/* Colores unificados a paleta de la página (#141414/#E4E3E0).  */}
      {/* ============================================================ */}
      {notification && (
        <div className="fixed inset-0 bg-[#141414]/70 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
          <div
            className="bg-[#E4E3E0] border-4 border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-md w-full rounded-none"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ticket-notif-title"
          >
            <div className="p-4 bg-[#141414] text-[#E4E3E0] flex justify-between items-center border-b-2 border-[#141414]">
              <h3 id="ticket-notif-title" className="text-xs font-mono uppercase font-bold tracking-widest">
                {notification.type === "success" ? "✓ Operación exitosa" :
                  notification.type === "error" ? "✕ Error" :
                    notification.type === "warning" ? "⚠ Advertencia" :
                      "ℹ Información"}
              </h3>
              <button
                type="button"
                onClick={() => setNotification(null)}
                className="text-[#E4E3E0] hover:text-red-400 font-mono font-bold text-sm cursor-pointer"
                aria-label="Cerrar notificación"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <h4 className="text-sm font-serif italic font-bold text-[#141414]">
                {notification.title}
              </h4>
              <p className="text-xs font-mono text-[#141414]/85 whitespace-pre-line leading-relaxed">
                {notification.message}
              </p>
              <div className="flex justify-end border-t border-[#141414] pt-3">
                <button
                  type="button"
                  onClick={() => setNotification(null)}
                  className="px-3 py-1.5 text-[11px] bg-[#141414] text-[#E4E3E0] border border-[#141414] hover:bg-[#141414]/90 transition-colors font-mono font-bold uppercase cursor-pointer"
                >
                  Aceptar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}