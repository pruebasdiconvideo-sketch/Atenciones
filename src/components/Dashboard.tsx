/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo } from "react";
import { MockDatabase } from "../db/mockDb";
import { Ticket, TicketPrioridad, TicketEstado } from "../types";
import {
  Briefcase,
  Calendar,
  Clock,
  Database,
  Filter,
  Globe,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  Zap,
  Wrench,
  FileText,
  FileDown
} from "lucide-react";

interface DashboardProps {
  db: MockDatabase;
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

  const hasCierre = ticket && (ticket.fecha_cierre ?? ticket.FECHA_CIERRE);
  return hasCierre ? "CERRADO" : "EN ATENCIÓN";
};

export function Dashboard({ db }: DashboardProps) {
  type DashboardPeriod = "today" | "yesterday" | "7d" | "30d" | "month" | "prevMonth" | "custom";

  const [periodFilter, setPeriodFilter] = useState<DashboardPeriod>("30d");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");

  const [filterPais, setFilterPais] = useState<string>("TODOS");
  const [filterEmpresa, setFilterEmpresa] = useState<string>("TODOS");
  const [filterDistrito, setFilterDistrito] = useState<string>("TODOS");
  const [filterPrioridad, setFilterPrioridad] = useState<string>("TODOS");
  const [filterEstado, setFilterEstado] = useState<string>("TODOS");
  const [filterFechaInicio, setFilterFechaInicio] = useState<string>("");
  const [filterFechaFin, setFilterFechaFin] = useState<string>("");

  const [filterRubro, setFilterRubro] = useState<string>("TODOS");
  const [filterSucursal, setFilterSucursal] = useState<string>("TODOS");
  const [filterContacto, setFilterContacto] = useState<string>("TODOS");

  const handleSetFilterEmpresa = (val: string) => {
    setFilterEmpresa(val);
    setFilterSucursal("TODOS");
    setFilterContacto("TODOS");
  };

  const [showPaisSearchModal, setShowPaisSearchModal] = useState(false);
  const [paisSearchQuery, setPaisSearchQuery] = useState("");
  const [showEmpresaSearchModal, setShowEmpresaSearchModal] = useState(false);
  const [empresaSearchQuery, setEmpresaSearchQuery] = useState("");
  const [showDistritoSearchModal, setShowDistritoSearchModal] = useState(false);
  const [distritoSearchQuery, setDistritoSearchQuery] = useState("");

  const resetFilters = () => {
    setPeriodFilter("30d");
    setCustomStartDate("");
    setCustomEndDate("");
    setFilterPais("TODOS");
    setFilterEmpresa("TODOS");
    setFilterDistrito("TODOS");
    setFilterPrioridad("TODOS");
    setFilterEstado("TODOS");
    setFilterFechaInicio("");
    setFilterFechaFin("");
    setFilterRubro("TODOS");
    setFilterSucursal("TODOS");
    setFilterContacto("TODOS");
  };

  const listEmpresas = useMemo(() => db.empresas, [db.empresas]);
  const listPaises = useMemo(() => db.paises, [db.paises]);

  const getIsoDate = (value?: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  };

  const normalizeDateRange = useMemo(() => {
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    if (periodFilter === "today") {
      return { start: new Date(start), end };
    }

    if (periodFilter === "yesterday") {
      const y = new Date(start);
      y.setDate(y.getDate() - 1);
      return { start: new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0, 0), end: new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999) };
    }

    if (periodFilter === "7d") {
      const s = new Date(start);
      s.setDate(s.getDate() - 6);
      return { start: new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0, 0), end };
    }

    if (periodFilter === "30d") {
      const s = new Date(start);
      s.setDate(s.getDate() - 29);
      return { start: new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0, 0), end };
    }

    if (periodFilter === "month") {
      const s = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
      return { start: s, end };
    }

    if (periodFilter === "prevMonth") {
      const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1, 0, 0, 0, 0);
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
      return { start: firstDay, end: lastDay };
    }

    if (periodFilter === "custom") {
      const startDate = customStartDate ? getIsoDate(customStartDate) : null;
      const endDate = customEndDate ? getIsoDate(customEndDate) : null;
      if (startDate && endDate) {
        return {
          start: new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0),
          end: new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999)
        };
      }
      return { start: new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0), end };
    }

    return { start: new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0), end };
  }, [customEndDate, customStartDate, periodFilter]);

  const periodDescription = useMemo(() => {
    const labelMap: Record<DashboardPeriod, string> = {
      today: "Hoy",
      yesterday: "Ayer",
      "7d": "Últimos 7 días",
      "30d": "Últimos 30 días",
      month: "Mes actual",
      prevMonth: "Mes anterior",
      custom: customStartDate && customEndDate ? `Rango: ${customStartDate} - ${customEndDate}` : "Rango personalizado"
    };
    return labelMap[periodFilter] || "Período";
  }, [customEndDate, customStartDate, periodFilter]);

  const matchesPeriod = (value?: string | null) => {
    if (!value) return false;
    const date = getIsoDate(value);
    if (!date) return false;
    return date >= getIsoDate(normalizeDateRange.start.toISOString()) && date <= getIsoDate(normalizeDateRange.end.toISOString());
  };

  const filteredTickets = useMemo(() => {
    return db.tickets.filter((ticket) => {
      const hasCustomDateRange = filterFechaInicio || filterFechaFin;
      const dateFromTicket = getIsoDate(ticket.fecha_registro);
      const fromManual = filterFechaInicio ? getIsoDate(filterFechaInicio) : null;
      const toManual = filterFechaFin ? getIsoDate(filterFechaFin) : null;

      if (hasCustomDateRange) {
        if (fromManual && dateFromTicket && dateFromTicket < fromManual) return false;
        if (toManual && dateFromTicket && dateFromTicket > toManual) return false;
      } else if (!matchesPeriod(ticket.fecha_registro)) {
        return false;
      }

      if (filterEmpresa !== "TODOS" && ticket.id_empresa !== parseInt(filterEmpresa)) return false;

      if (filterPais !== "TODOS") {
        const empresa = db.empresas.find(e => e.id_empresa === ticket.id_empresa);
        if (!empresa) return false;
        const ubicacion = db.ubicaciones.find(u => u.id_ubicacion === empresa.id_ubicacion);
        if (!ubicacion) return false;
        let division = db.divisionesGeograficas.find(dg => dg.id_division === ubicacion.id_division);
        while (division && division.id_division_padre !== null) {
          division = db.divisionesGeograficas.find(dg => dg.id_division === division?.id_division_padre);
        }
        let associatedPaisId = 1;
        if (division?.nombre.toLowerCase().includes("cundinamarca") || division?.nombre.toLowerCase().includes("bogotá")) {
          associatedPaisId = 2;
        } else if (ubicacion.id_division >= 9) {
          associatedPaisId = 2;
        } else if (ubicacion.id_division >= 6 && ubicacion.id_division <= 8) {
          associatedPaisId = 1;
        }
        if (associatedPaisId !== parseInt(filterPais)) return false;
      }

      if (filterDistrito !== "TODOS") {
        const targetDivId = parseInt(filterDistrito);
        let id_ubicacion: number | undefined;
        if (ticket.id_sucursal && ticket.id_sucursal !== null) {
          const suc = db.sucursales.find(s => s.id_sucursal === ticket.id_sucursal);
          if (suc) id_ubicacion = suc.id_ubicacion;
        }
        if (!id_ubicacion) {
          const empresa = db.empresas.find(e => e.id_empresa === ticket.id_empresa);
          if (empresa) id_ubicacion = empresa.id_ubicacion;
        }
        if (!id_ubicacion) return false;
        const ubicacion = db.ubicaciones.find(u => u.id_ubicacion === id_ubicacion);
        if (!ubicacion) return false;
        let currentDivId: number | null = ubicacion.id_division;
        let matched = false;
        while (currentDivId !== null) {
          if (currentDivId === targetDivId) {
            matched = true;
            break;
          }
          const divNode = db.divisionesGeograficas.find(dg => dg.id_division === currentDivId);
          currentDivId = divNode ? divNode.id_division_padre : null;
        }
        if (!matched) return false;
      }

      if (filterRubro !== "TODOS") {
        const empNode = db.empresas.find(e => e.id_empresa === ticket.id_empresa);
        if (!empNode || empNode.id_rubro !== parseInt(filterRubro)) return false;
      }

      if (filterSucursal !== "TODOS" && ticket.id_sucursal !== parseInt(filterSucursal)) return false;
      if (filterContacto !== "TODOS" && ticket.id_empresa_contacto !== parseInt(filterContacto)) return false;
      if (filterPrioridad !== "TODOS" && ticket.prioridad !== filterPrioridad) return false;

      if (filterEstado !== "TODOS") {
        const formattedStatus = formatTicketStatus(ticket.estado, ticket);
        const compareState = filterEstado === "EN_ATENCION" ? "EN ATENCIÓN" : filterEstado;
        if (formattedStatus !== compareState) return false;
      }

      return true;
    });
  }, [db, filterPais, filterEmpresa, filterDistrito, filterPrioridad, filterEstado, filterFechaInicio, filterFechaFin, filterRubro, filterSucursal, filterContacto, matchesPeriod]);

  const kpis = useMemo(() => {
    const total = filteredTickets.length;
    const pendientes = filteredTickets.filter(t => formatTicketStatus(t.estado, t) === "PENDIENTE").length;
    const enAtencion = filteredTickets.filter(t => formatTicketStatus(t.estado, t) === "EN ATENCIÓN").length;
    const resueltos = filteredTickets.filter(t => formatTicketStatus(t.estado, t) === "RESUELTO").length;
    const cerrados = filteredTickets.filter(t => formatTicketStatus(t.estado, t) === "CERRADO").length;
    const reabiertos = filteredTickets.filter(t => formatTicketStatus(t.estado, t) === "REABIERTO").length;

    const ticketIdsFiltered = new Set(filteredTickets.map(t => t.id_ticket));
    const targetAtenciones = db.atenciones.filter(a => ticketIdsFiltered.has(a.id_ticket));
    const targetAtencionesIds = new Set(targetAtenciones.map(a => a.id_atencion));
    const correspondingTimes = db.atencionesTiempo.filter(t => targetAtencionesIds.has(t.id_atencion));

    const attentionMinutes = correspondingTimes.length > 0
      ? Math.round(correspondingTimes.reduce((acc, item) => acc + (item.duracion_minutos || 0), 0) / correspondingTimes.length)
      : 0;

    const resolvedTickets = filteredTickets.filter(t => {
      const estado = formatTicketStatus(t.estado, t);
      return estado === "RESUELTO" || estado === "CERRADO";
    });

    const resolutionMinutes = resolvedTickets.length > 0
      ? Math.round(
        resolvedTickets.reduce((acc, ticket) => {
          const fechaCreacion = ticket.fecha_registro ? new Date(`${ticket.fecha_registro}T${ticket.hora_registro || "00:00:00"}`) : null;
          const fechaCierre = ticket.fecha_cierre ? new Date(`${ticket.fecha_cierre}T${ticket.hora_cierre || "00:00:00"}`) : null;
          if (!fechaCreacion || !fechaCierre || Number.isNaN(fechaCreacion.getTime()) || Number.isNaN(fechaCierre.getTime())) {
            return acc;
          }
          return acc + Math.max(0, Math.round((fechaCierre.getTime() - fechaCreacion.getTime()) / 60000));
        }, 0) / resolvedTickets.length
      )
      : 0;

    const formatMinutes = (mins: number) => {
      if (mins <= 0) return "0 min";
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? `${h}h ${m}m` : `${m} min`;
    };

    return {
      total,
      pendientes,
      enAtencion,
      resueltos,
      cerrados,
      reabiertos,
      avgAttention: formatMinutes(attentionMinutes),
      avgResolution: formatMinutes(resolutionMinutes),
      attentionMinutes,
      resolutionMinutes
    };
  }, [db.atenciones, db.atencionesTiempo, filteredTickets]);

  const priorityChart = useMemo(() => {
    const counts = { CRITICA: 0, ALTA: 0, MEDIA: 0, BAJA: 0 };
    filteredTickets.forEach((t) => {
      counts[t.prioridad as keyof typeof counts] = (counts[t.prioridad as keyof typeof counts] || 0) + 1;
    });

    const max = Math.max(...Object.values(counts), 1);
    return Object.entries(counts).map(([name, val]) => ({
      name,
      value: val,
      percentage: filteredTickets.length > 0 ? Math.round((val / filteredTickets.length) * 100) : 0,
      ratio: val / max
    }));
  }, [filteredTickets]);

  const processChart = useMemo(() => {
    const counts: Record<string, number> = {};

    filteredTickets.forEach((ticket) => {
      const key = (ticket.motivo_nombre || ticket.medio_contacto || "Sin proceso").toString();
      counts[key] = (counts[key] || 0) + 1;
    });

    const max = Math.max(...Object.values(counts), 1);
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value, ratio: value / max }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [filteredTickets]);

  const technicianChart = useMemo(() => {
    const counts = new Map<number, { name: string; attended: number; resolved: number }>();

    filteredTickets.forEach((ticket) => {
      const relatedAttentions = db.atenciones.filter(a => a.id_ticket === ticket.id_ticket);
      relatedAttentions.forEach((attention) => {
        const tech = db.personas.find((persona) => persona.id_persona === attention.id_usuario);
        const current = counts.get(attention.id_usuario) || {
          name: tech ? `${tech.nombres} ${tech.apellido_paterno}` : `Técnico ${attention.id_usuario}`,
          attended: 0,
          resolved: 0
        };

        current.attended += 1;
        if (["RESUELTO", "CERRADO"].includes(formatTicketStatus(ticket.estado, ticket).toUpperCase())) {
          current.resolved += 1;
        }
        counts.set(attention.id_usuario, current);
      });
    });

    const entries = [...counts.values()].map((entry) => ({
      ...entry,
      percentage: filteredTickets.length > 0 ? Math.round((entry.attended / Math.max(filteredTickets.length, 1)) * 100) : 0
    }));

    return entries.sort((a, b) => b.attended - a.attended).slice(0, 5);
  }, [db.atenciones, db.personas, filteredTickets]);

  const rubroChart = useMemo(() => {
    const counts: { [key: string]: number } = {};
    db.empresas.forEach(emp => {
      if (emp.estado === false) return;
      const rubro = db.rubros?.find(r => r.id_rubro === emp.id_rubro);
      const nombre = rubro?.nombre || "Sin rubro";
      counts[nombre] = (counts[nombre] || 0) + 1;
    });
    const max = Math.max(...Object.values(counts), 1);
    return Object.entries(counts)
      .map(([name, val]) => ({ name, value: val, ratio: val / max }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [db.empresas, db.rubros]);

  const monthlyChart = useMemo(() => {
    const months: { [key: string]: number } = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleDateString('es-PE', { month: 'short', year: '2-digit' });
      months[key] = 0;
    }
    filteredTickets.forEach(t => {
      const fecha = t.fecha_registro;
      if (!fecha) return;
      const d = new Date(fecha);
      if (isNaN(d.getTime())) return;
      const key = d.toLocaleDateString('es-PE', { month: 'short', year: '2-digit' });
      if (key in months) months[key]++;
    });
    const max = Math.max(...Object.values(months), 1);
    return Object.entries(months).map(([name, val]) => ({ name, value: val, ratio: val / max }));
  }, [filteredTickets]);

  const avgPerDay = useMemo(() => {
    const resolved = filteredTickets.filter(t => {
      const est = formatTicketStatus(t.estado, t);
      return est === "RESUELTO" || est === "CERRADO";
    });
    const total = filteredTickets.length;
    const avg = total > 0 ? Math.round((resolved.length / total) * 100) : 0;
    return { resolved: resolved.length, total, percentage: avg };
  }, [filteredTickets]);

  const handleExportDashboardPdf = () => {
    const today = new Date().toLocaleString('es-PE');
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Dashboard — Reporte Ejecutivo</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; padding: 24px; max-width: 900px; margin: 0 auto; color: #141414; }
  h1 { font-size: 20px; margin: 0 0 4px 0; }
  h2 { font-size: 13px; margin: 20px 0 8px 0; border-bottom: 2px solid #141414; padding-bottom: 4px; text-transform: uppercase; }
  .meta { font-size: 11px; color: #555; margin-bottom: 16px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
  .kpi { border: 1px solid #ccc; padding: 10px; }
  .kpi-label { font-size: 9px; text-transform: uppercase; color: #666; }
  .kpi-value { font-size: 24px; font-weight: bold; }
  .kpi-sub { font-size: 9px; color: #888; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 16px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  th { background: #141414; color: #fff; text-transform: uppercase; font-size: 10px; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 10px; color: #888; text-align: center; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>Reporte Ejecutivo del Dashboard</h1>
  <div class="meta">Generado el ${today}</div>

  <h2>Indicadores Principales</h2>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Total filtrado</div><div class="kpi-value">${kpis.total}</div><div class="kpi-sub">Tickets coincidentes</div></div>
    <div class="kpi"><div class="kpi-label">Por procesar</div><div class="kpi-value">${kpis.pendientes + kpis.reabiertos}</div><div class="kpi-sub">${kpis.pendientes} pend · ${kpis.reabiertos} reab</div></div>
    <div class="kpi"><div class="kpi-label">En atención</div><div class="kpi-value">${kpis.enAtencion}</div><div class="kpi-sub">Trabajos en curso</div></div>
    <div class="kpi"><div class="kpi-label">Resueltos/cerrados</div><div class="kpi-value">${kpis.resueltos + kpis.cerrados}</div><div class="kpi-sub">${kpis.resueltos} res · ${kpis.cerrados} cerr</div></div>
  </div>

  <h2>Tiempos de Atención</h2>
  <table>
    <tr><th>Tiempo prom. primera atención</th><td>${kpis.avgAttention}</td></tr>
    <tr><th>Tiempo prom. resolución</th><td>${kpis.avgResolution}</td></tr>
  </table>

  <h2>Distribución por Prioridad</h2>
  <table>
    <thead><tr><th>Prioridad</th><th>Cantidad</th><th>Porcentaje</th></tr></thead>
    <tbody>
      ${priorityChart.map(p => `<tr><td>${p.name}</td><td>${p.value}</td><td>${p.percentage}%</td></tr>`).join('')}
    </tbody>
  </table>

  <h2>Tickets por proceso</h2>
  <table>
    <thead><tr><th>Proceso</th><th>Tickets</th></tr></thead>
    <tbody>
      ${processChart.slice(0, 5).map(c => `<tr><td>${c.name}</td><td>${c.value}</td></tr>`).join('')}
    </tbody>
  </table>

  <h2>Atenciones por técnico</h2>
  <table>
    <thead><tr><th>Técnico</th><th>Atenciones</th><th>Resueltos</th></tr></thead>
    <tbody>
      ${technicianChart.map(t => `<tr><td>${t.name}</td><td>${t.attended}</td><td>${t.resolved}</td></tr>`).join('')}
    </tbody>
  </table>

  <div class="footer">Documento generado por Dicon Soporte — Sistema de Soporte</div>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    else { alert("El navegador bloqueó la ventana. Habilite las ventanas emergentes."); }
  };

  const handleExportDashboardCsv = () => {
    const rows: string[][] = [["Nro Ticket", "Empresa", "Estado", "Prioridad", "Fecha Registro", "Detalle"]];
    filteredTickets.forEach(t => {
      const emp = db.empresas.find(e => e.id_empresa === t.id_empresa);
      rows.push([
        t.nro_ticket || "",
        emp ? (emp.nombre_comercial || emp.razon_social) : "",
        formatTicketStatus(t.estado, t),
        t.prioridad || "",
        `${t.fecha_registro} ${t.hora_registro}`,
        (t.detalle_reporte || "").replace(/"/g, '""').substring(0, 200)
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dashboard_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 font-sans text-[#141414]">

      {/* Title block */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b-2 border-[#141414] pb-4">
        <div>
          <h2 className="text-2xl font-serif italic text-[#141414]">Panel de Control</h2>
          <p className="text-[10px] uppercase font-bold tracking-widest text-[#141414]/70 mt-1">
            Métricas de tickets, distribución y cumplimiento de tiempos de atención
          </p>
        </div>

        {/* Export buttons + DB status */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleExportDashboardCsv}
            className="flex items-center gap-1.5 border border-[#141414] bg-white text-[#141414] px-2.5 py-1 text-[10px] font-mono font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
            title="Exportar datos del dashboard a CSV"
          >
            <FileText className="w-3 h-3" /> CSV
          </button>
          <button
            type="button"
            onClick={handleExportDashboardPdf}
            className="flex items-center gap-1.5 border border-[#141414] bg-[#141414] text-[#E4E3E0] px-2.5 py-1 text-[10px] font-mono font-bold uppercase hover:bg-[#141414]/90 transition-colors cursor-pointer"
            title="Exportar dashboard a PDF para imprimir"
          >
            <FileDown className="w-3 h-3" /> PDF
          </button>
          <div className="flex items-center gap-1.5 border border-[#141414] bg-white px-2 py-1 text-[10px] font-mono uppercase tracking-wider">
            <Database className="w-3 h-3 text-emerald-700" />
            <span className="text-emerald-800">Conectado</span>
          </div>
        </div>
      </div>

      {/* FILTER BAR PANEL */}
      <div className="border border-[#141414] bg-white/10 p-4">
        <div className="flex items-center gap-2 mb-4 border-b border-[#141414]/20 pb-2">
          <Filter className="w-4 h-4 text-[#141414]" />
          <span className="font-serif italic text-xs uppercase tracking-wide font-bold">Filtros de Segmentación de Datos</span>
          <button
            type="button"
            onClick={resetFilters}
            className="ml-auto flex items-center gap-1 text-[11px] font-mono uppercase font-bold border border-[#141414] px-2 py-0.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" /> Limpiar Consultas
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {/* País */}
          <div>
            <label className="block text-[10px] font-bold text-[#141414]/65 mb-1.5 uppercase tracking-wider font-mono">País</label>
            <div className="flex gap-1">
              <input
                type="text"
                readOnly
                className="w-full text-xs bg-white border border-[#141414] p-1 text-[#141414] font-mono focus:outline-none select-none uppercase"
                value={filterPais === "TODOS" ? "TODOS" : (db.paises.find(p => p.id_pais === parseInt(filterPais))?.nombre || "").toUpperCase()}
              />
              <button
                type="button"
                onClick={() => {
                  setPaisSearchQuery("");
                  setShowPaisSearchModal(true);
                }}
                className="bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] px-1.5 py-1 text-[10px] font-mono font-bold uppercase cursor-pointer"
                title="Buscar País"
              >
                🔍
              </button>
            </div>
          </div>

          {/* Empresa */}
          <div>
            <label className="block text-[10px] font-bold text-[#141414]/65 mb-1.5 uppercase tracking-wider font-mono">Empresa</label>
            <div className="flex gap-1">
              <input
                type="text"
                readOnly
                className="w-full text-xs bg-white border border-[#141414] p-1 text-[#141414] font-mono focus:outline-none select-none uppercase truncate"
                value={filterEmpresa === "TODOS" ? "TODAS" : (db.empresas.find(e => e.id_empresa === parseInt(filterEmpresa))?.nombre_comercial || db.empresas.find(e => e.id_empresa === parseInt(filterEmpresa))?.razon_social || "").toUpperCase()}
              />
              <button
                type="button"
                onClick={() => {
                  setEmpresaSearchQuery("");
                  setShowEmpresaSearchModal(true);
                }}
                className="bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] px-1.5 py-1 text-[10px] font-mono font-bold uppercase cursor-pointer"
                title="Buscar Empresa"
              >
                🔍
              </button>
            </div>
          </div>

          {/* Distrito / Región */}
          <div>
            <label className="block text-[10px] font-bold text-[#141414]/65 mb-1.5 uppercase tracking-wider font-mono">Distrito/Región</label>
            <div className="flex gap-1">
              <input
                type="text"
                readOnly
                className="w-full text-xs bg-white border border-[#141414] p-1 text-[#141414] font-mono focus:outline-none select-none uppercase truncate"
                value={filterDistrito === "TODOS" ? "TODOS" : (db.divisionesGeograficas.find(dg => dg.id_division === parseInt(filterDistrito))?.nombre || "").toUpperCase()}
              />
              <button
                type="button"
                onClick={() => {
                  setDistritoSearchQuery("");
                  setShowDistritoSearchModal(true);
                }}
                className="bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] px-1.5 py-1 text-[10px] font-mono font-bold uppercase cursor-pointer"
                title="Buscar Distrito"
              >
                🔍
              </button>
            </div>
          </div>

          {/* Prioridad */}
          <div>
            <label className="block text-[10px] font-bold text-[#141414]/65 mb-1.5 uppercase tracking-wider font-mono">Prioridad</label>
            <select
              value={filterPrioridad}
              onChange={(e) => setFilterPrioridad(e.target.value)}
              className="w-full text-xs bg-white border border-[#141414] p-1 text-[#141414] font-mono focus:outline-none h-[26px]"
            >
              <option value="TODOS" className="bg-[#E4E3E0]">-- TODAS --</option>
              <option value="CRITICA" className="bg-[#E4E3E0]">CRITICA</option>
              <option value="ALTA" className="bg-[#E4E3E0]">ALTA</option>
              <option value="MEDIA" className="bg-[#E4E3E0]">MEDIA</option>
              <option value="BAJA" className="bg-[#E4E3E0]">BAJA</option>
            </select>
          </div>

          {/* Estado */}
          <div>
            <label className="block text-[10px] font-bold text-[#141414]/65 mb-1.5 uppercase tracking-wider font-mono">Estado</label>
            <select
              value={filterEstado}
              onChange={(e) => setFilterEstado(e.target.value)}
              className="w-full text-xs bg-white border border-[#141414] p-1 text-[#141414] font-mono focus:outline-none h-[26px]"
            >
              <option value="TODOS" className="bg-[#E4E3E0]">-- TODOS --</option>
              <option value="PENDIENTE" className="bg-[#E4E3E0]">PENDIENTE</option>
              <option value="EN_ATENCION" className="bg-[#E4E3E0]">EN ATENCION</option>
              <option value="RESUELTO" className="bg-[#E4E3E0]">RESUELTO</option>
              <option value="CERRADO" className="bg-[#E4E3E0]">CERRADO</option>
              <option value="REABIERTO" className="bg-[#E4E3E0]">REABIERTO</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mt-3 pt-3 border-t border-[#141414]/10 animate-fade-in-quick">
          {/* Rubro */}
          <div>
            <label className="block text-[10px] font-bold text-[#141414]/65 mb-1.5 uppercase tracking-wider font-mono">Rubro de Empresa</label>
            <select
              value={filterRubro}
              onChange={(e) => setFilterRubro(e.target.value)}
              className="w-full text-xs bg-white border border-[#141414] p-1 text-[#141414] font-mono focus:outline-none h-[26px]"
            >
              <option value="TODOS">-- TODOS LOS RUBROS --</option>
              {db.rubros.map(rub => (
                <option key={rub.id_rubro} value={rub.id_rubro}>{rub.nombre.toUpperCase()}</option>
              ))}
            </select>
          </div>

          {/* Sucursal */}
          <div>
            <label className="block text-[10px] font-bold text-[#141414]/65 mb-1.5 uppercase tracking-wider font-mono">
              Sucursal {filterEmpresa !== "TODOS" ? "(Vinculada)" : "(Seleccione Empresa)"}
            </label>
            <select
              value={filterSucursal}
              onChange={(e) => setFilterSucursal(e.target.value)}
              disabled={filterEmpresa === "TODOS"}
              className="w-full text-xs bg-white border border-[#141414] p-1 text-[#141414] font-mono focus:outline-none disabled:opacity-50 disabled:bg-zinc-100 h-[26px]"
            >
              <option value="TODOS">-- TODAS SUCURSALES --</option>
              {filterEmpresa !== "TODOS" && db.sucursales
                .filter(s => s.id_empresa === parseInt(filterEmpresa))
                .map(suc => (
                  <option key={suc.id_sucursal} value={suc.id_sucursal}>{suc.nombre.toUpperCase()}</option>
                ))}
            </select>
          </div>

          {/* Contacto */}
          <div>
            <label className="block text-[10px] font-bold text-[#141414]/65 mb-1.5 uppercase tracking-wider font-mono">
              Contacto {filterEmpresa !== "TODOS" ? "(Vinculado)" : "(Seleccione Empresa)"}
            </label>
            <select
              value={filterContacto}
              onChange={(e) => setFilterContacto(e.target.value)}
              disabled={filterEmpresa === "TODOS"}
              className="w-full text-xs bg-white border border-[#141414] p-1 text-[#141414] font-mono focus:outline-none disabled:opacity-50 disabled:bg-zinc-100 h-[26px]"
            >
              <option value="TODOS">-- TODOS CONTACTOS --</option>
              {filterEmpresa !== "TODOS" && db.contactosEmpresariales
                .filter(c => c.id_empresa === parseInt(filterEmpresa))
                .map(con => {
                  const per = db.personas.find(p => p.id_persona === con.id_persona);
                  const name = per ? `${per.nombres} ${per.apellido_paterno}` : `Contacto #${con.id_empresa_contacto}`;
                  return (
                    <option key={con.id_empresa_contacto} value={con.id_empresa_contacto}>
                      {name.toUpperCase()} {con.cargo ? `(${con.cargo.toUpperCase()})` : ""}
                    </option>
                  );
                })}
            </select>
          </div>

          {/* Fecha Inicio */}
          <div>
            <label className="block text-[10px] font-bold text-[#141414]/65 mb-1.5 uppercase tracking-wider font-mono">Desde</label>
            <input
              type="date"
              value={filterFechaInicio}
              onChange={(e) => setFilterFechaInicio(e.target.value)}
              className="w-full text-xs bg-white border border-[#141414] p-1 text-[#141414] font-mono focus:outline-none"
            />
          </div>

          {/* Fecha Fin */}
          <div>
            <label className="block text-[10px] font-bold text-[#141414]/65 mb-1.5 uppercase tracking-wider font-mono">Hasta</label>
            <input
              type="date"
              value={filterFechaFin}
              onChange={(e) => setFilterFechaFin(e.target.value)}
              className="w-full text-xs bg-white border border-[#141414] p-1 text-[#141414] font-mono focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="border border-[#141414] bg-white/20 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono">Periodo</span>
            <span className="text-[10px] font-semibold text-[#141414]/70">{periodDescription}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "today", label: "Hoy" },
              { key: "yesterday", label: "Ayer" },
              { key: "7d", label: "7 días" },
              { key: "30d", label: "30 días" },
              { key: "month", label: "Mes actual" },
              { key: "prevMonth", label: "Mes anterior" },
              { key: "custom", label: "Personalizado" }
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setPeriodFilter(option.key as DashboardPeriod)}
                className={`px-2.5 py-1 text-[10px] font-mono font-bold uppercase border transition-colors ${periodFilter === option.key ? "bg-[#141414] text-[#E4E3E0] border-[#141414]" : "bg-white text-[#141414] border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0]"
                  }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {periodFilter === "custom" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-[10px] font-mono uppercase tracking-wider">
                Desde
                <input type="date" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)} className="mt-1 w-full border border-[#141414] bg-white p-1 text-[#141414]" />
              </label>
              <label className="text-[10px] font-mono uppercase tracking-wider">
                Hasta
                <input type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} className="mt-1 w-full border border-[#141414] bg-white p-1 text-[#141414]" />
              </label>
            </div>
          )}
        </div>
      </div>

      {/* KPI METRIC CARDS GRID */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total General */}
        <div className="border border-[#141414] p-3 bg-white/25 text-[#141414]">
          <p className="text-[9px] uppercase font-bold opacity-60 tracking-wider">Total filtrado</p>
          <p className="text-2xl font-serif italic mt-0.5">{kpis.total}</p>
          <p className="text-[8px] font-mono uppercase opacity-50 mt-0.5">Tickets coincidentes</p>
        </div>

        {/* Pendientes y Reabiertos */}
        <div className="border border-[#141414] p-3 bg-[#141414] text-[#E4E3E0]">
          <p className="text-[9px] uppercase font-bold opacity-60 text-emerald-400 tracking-wider">Por procesar</p>
          <p className="text-2xl font-serif italic mt-0.5">{kpis.pendientes + kpis.reabiertos}</p>
          <p className="text-[8px] font-mono uppercase opacity-70 mt-0.5">
            {kpis.pendientes} pend · {kpis.reabiertos} reab
          </p>
        </div>

        {/* En Atención */}
        <div className="border border-[#141414] p-3 bg-white/25 text-[#141414]">
          <p className="text-[9px] uppercase font-bold opacity-60 tracking-wider">En atención</p>
          <p className="text-2xl font-serif italic mt-0.5">{kpis.enAtencion}</p>
          <p className="text-[8px] font-mono uppercase opacity-50 mt-0.5">Trabajos en curso</p>
        </div>

        {/* Resueltos y Cerrados */}
        <div className="border border-[#141414] p-3 bg-white/25 text-[#141414]">
          <p className="text-[9px] uppercase font-bold opacity-60 tracking-wider">Resueltos / cerrados</p>
          <p className="text-2xl font-serif italic mt-0.5">{kpis.resueltos + kpis.cerrados}</p>
          <p className="text-[8px] font-mono uppercase opacity-50 mt-0.5">
            {kpis.resueltos} res · {kpis.cerrados} cerr
          </p>
        </div>
      </div>

      {/* SLA AND TIMES REPORT CARD */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* SLA Attention Time */}
        <div className="border border-[#141414] p-4 bg-white/35 flex justify-between items-center">
          <div>
            <p className="text-[9px] uppercase font-bold opacity-60 tracking-wider">Tiempo prom. de primera atención</p>
            <p className="text-xl font-serif italic mt-0.5">{kpis.avgAttention}</p>
            <p className="text-[9px] font-mono opacity-50 mt-0.5">Desde asignación hasta inicio de trabajos</p>
          </div>
          <div className="p-1.5 border border-[#141414] bg-white">
            <Clock className="w-4 h-4 text-[#141450]" />
          </div>
        </div>

        {/* SLA Resolution Time */}
        <div className="border border-[#141414] p-4 bg-white/35 flex justify-between items-center">
          <div>
            <p className="text-[9px] uppercase font-bold opacity-60 tracking-wider">Tiempo prom. de resolución</p>
            <p className="text-xl font-serif italic mt-0.5">{kpis.avgResolution}</p>
            <p className="text-[9px] font-mono opacity-50 mt-0.5">Desde registro hasta cierre</p>
          </div>
          <div className="p-1.5 border border-[#141414] bg-[#141414] text-[#E4E3E0]">
            <Zap className="w-4 h-4" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="border border-[#141414] bg-white/10 p-5">
          <div className="border-b border-[#141414] pb-2 mb-4">
            <h3 className="font-serif italic font-bold text-sm text-[#141414]">Distribución por Prioridad de Consultas</h3>
          </div>
          <div className="space-y-4">
            {priorityChart.map((p) => {
              const textColors = {
                CRITICA: "text-red-700 font-bold",
                ALTA: "text-orange-700 font-semibold",
                MEDIA: "text-amber-800 font-medium",
                BAJA: "text-[#141414]"
              };

              return (
                <div key={p.name} className="space-y-1">
                  <div className="flex text-xs justify-between font-mono">
                    <span className={textColors[p.name as TicketPrioridad] || ""}>{p.name}</span>
                    <span className="font-bold">{p.value} ({p.percentage}%)</span>
                  </div>
                  <div className="w-full bg-[#141414]/10 border border-[#141414] h-2.5 overflow-hidden">
                    <div className="h-full bg-[#141414] transition-all duration-300" style={{ width: `${Math.max(p.percentage, 1)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border border-[#141414] bg-white/10 p-5">
          <div className="border-b border-[#141414] pb-2 mb-4">
            <h3 className="font-serif italic font-bold text-sm text-[#141414]">Tickets por Proceso</h3>
          </div>
          <div className="space-y-4">
            {processChart.map((item) => (
              <div key={item.name} className="space-y-1">
                <div className="flex text-xs justify-between font-mono">
                  <span className="truncate max-w-[170px] uppercase font-bold" title={item.name}>{item.name}</span>
                  <span>{item.value} Tkt(s)</span>
                </div>
                <div className="w-full bg-[#141414]/10 border border-[#141414] h-2.5 overflow-hidden">
                  <div className="h-full bg-[#141414] transition-all duration-300" style={{ width: `${Math.max((item.value / Math.max(processChart.reduce((sum, entry) => sum + entry.value, 0), 1)) * 100, 1)}%` }} />
                </div>
              </div>
            ))}
            {processChart.length === 0 && <p className="text-slate-500 font-mono text-[11px] text-center py-8">No hay procesos para este período</p>}
          </div>
        </div>

        <div className="border border-[#141414] bg-white/10 p-5">
          <div className="border-b border-[#141414] pb-2 mb-4">
            <h3 className="font-serif italic font-bold text-sm text-[#141414]">Atenciones por Técnico</h3>
          </div>
          <div className="space-y-4">
            {technicianChart.map((tech) => {
              const totalAttended = technicianChart.reduce((sum, entry) => sum + entry.attended, 0) || 1;
              const pct = Math.round((tech.attended / totalAttended) * 100);
              return (
                <div key={tech.name} className="space-y-1">
                  <div className="flex text-xs justify-between font-mono">
                    <span className="truncate font-semibold uppercase">{tech.name}</span>
                    <span>{tech.attended} ({tech.resolved} res)</span>
                  </div>
                  <div className="w-full bg-[#141414]/10 border border-[#141414] h-2.5 overflow-hidden">
                    <div className="h-full bg-[#141414] transition-all duration-300" style={{ width: `${Math.max(pct, 1)}%` }} />
                  </div>
                </div>
              );
            })}
            {technicianChart.length === 0 && <p className="text-slate-500 font-mono text-[11px] text-center py-8">Sin atenciones registradas</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="border border-[#141414] bg-white/10 p-5">
          <div className="border-b border-[#141414] pb-2 mb-4">
            <h3 className="font-serif italic font-bold text-sm text-[#141414]">Top de rubros por empresa</h3>
          </div>
          <div className="space-y-4">
            {rubroChart.map((item) => (
              <div key={item.name} className="space-y-1">
                <div className="flex text-xs justify-between font-mono">
                  <span className="truncate uppercase font-bold">{item.name}</span>
                  <span>{item.value}</span>
                </div>
                <div className="w-full bg-[#141414]/10 border border-[#141414] h-2.5 overflow-hidden">
                  <div className="h-full bg-[#141414] transition-all duration-300" style={{ width: `${Math.max((item.value / Math.max(rubroChart.reduce((sum, entry) => sum + entry.value, 0), 1)) * 100, 1)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-[#141414] bg-white/10 p-5">
          <div className="border-b border-[#141414] pb-2 mb-4">
            <h3 className="font-serif italic font-bold text-sm text-[#141414]">Tickets del último mes</h3>
          </div>
          <div className="space-y-4">
            {monthlyChart.map((item) => (
              <div key={item.name} className="space-y-1">
                <div className="flex text-xs justify-between font-mono">
                  <span className="uppercase font-bold">{item.name}</span>
                  <span>{item.value}</span>
                </div>
                <div className="w-full bg-[#141414]/10 border border-[#141414] h-2.5 overflow-hidden">
                  <div className="h-full bg-[#141414] transition-all duration-300" style={{ width: `${Math.max((item.value / Math.max(monthlyChart.reduce((sum, entry) => sum + entry.value, 0), 1)) * 100, 1)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* DIALOGS DIALOGS FOR DASHBOARD FILTERS */}

      {/* 1. SELECCIÓN DE PAÍS */}
      {showPaisSearchModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-fade-in-quick">
          <div className="bg-[#E4E3E0] max-w-md w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col max-h-[80vh] font-mono text-[#141414] text-xs">
            <div className="p-3 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <span className="font-bold uppercase tracking-wider text-[11px]">🔎 FILTRAR POR PAÍS</span>
              <button
                type="button"
                onClick={() => setShowPaisSearchModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-bold"
              >
                [X]
              </button>
            </div>
            <div className="p-3 bg-zinc-200 border-b border-[#141414]">
              <input
                type="text"
                autoFocus
                placeholder="ESCRIBA EL NOMBRE DEL PAÍS..."
                value={paisSearchQuery}
                onChange={(e) => setPaisSearchQuery(e.target.value)}
                className="w-full bg-white border border-[#141414] p-1.5 focus:outline-none placeholder-zinc-400 font-mono text-xs uppercase"
              />
            </div>
            <div className="overflow-y-auto flex-1 p-3">
              <table className="w-full text-left border-collapse border border-[#141414]">
                <thead>
                  <tr className="bg-[#141414]/10 font-bold text-[10px] uppercase border-b border-[#141414]">
                    <th className="p-2 border-r border-[#141414]">Código ISO</th>
                    <th className="p-2 border-r border-[#141414]">Nombre País</th>
                    <th className="p-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/45 bg-white">
                  <tr
                    className="hover:bg-[#141414]/5 cursor-pointer text-blue-900 font-bold"
                    onClick={() => {
                      setFilterPais("TODOS");
                      setShowPaisSearchModal(false);
                    }}
                  >
                    <td className="p-2 border-r border-[#141414]">ALL</td>
                    <td className="p-2 border-r border-[#141414] uppercase">-- TODOS LOS PAÍSES --</td>
                    <td className="p-2 text-right">
                      <button
                        type="button"
                        className="bg-blue-900 text-white hover:bg-blue-950 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                      >
                        [Todos]
                      </button>
                    </td>
                  </tr>
                  {db.paises
                    .filter(p => p.nombre.toLowerCase().includes(paisSearchQuery.toLowerCase()) || p.codigo_iso.toLowerCase().includes(paisSearchQuery.toLowerCase()))
                    .map(p => (
                      <tr
                        key={p.id_pais}
                        className="hover:bg-[#141414]/5 cursor-pointer"
                        onClick={() => {
                          setFilterPais(p.id_pais.toString());
                          setShowPaisSearchModal(false);
                        }}
                      >
                        <td className="p-2 border-r border-[#141414] font-bold">{p.codigo_iso}</td>
                        <td className="p-2 border-r border-[#141414] uppercase">{p.nombre}</td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            className="bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                          >
                            [Seleccionar]
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-[#141414] bg-zinc-200 text-right">
              <button
                type="button"
                onClick={() => setShowPaisSearchModal(false)}
                className="px-3 py-1 bg-white border border-[#141414] font-bold text-[10.5px] uppercase hover:bg-zinc-100 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. SELECCIÓN DE EMPRESA */}
      {showEmpresaSearchModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-fade-in-quick">
          <div className="bg-[#E4E3E0] max-w-lg w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col max-h-[80vh] font-mono text-[#141414] text-xs">
            <div className="p-3 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <span className="font-bold uppercase tracking-wider text-[11px]">🔎 FILTRAR POR EMPRESA</span>
              <button
                type="button"
                onClick={() => setShowEmpresaSearchModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-bold"
              >
                [X]
              </button>
            </div>
            <div className="p-3 bg-zinc-200 border-b border-[#141414]">
              <input
                type="text"
                autoFocus
                placeholder="RUC O NOMBRE DE EMPRESA..."
                value={empresaSearchQuery}
                onChange={(e) => setEmpresaSearchQuery(e.target.value)}
                className="w-full bg-white border border-[#141414] p-1.5 focus:outline-none placeholder-zinc-400 font-mono text-xs uppercase"
              />
            </div>
            <div className="overflow-y-auto flex-1 p-3">
              <table className="w-full text-left border-collapse border border-[#141414]">
                <thead>
                  <tr className="bg-[#141414]/10 font-bold text-[10px] uppercase border-b border-[#141414]">
                    <th className="p-2 border-r border-[#141414]">RUC</th>
                    <th className="p-2 border-r border-[#141414]">Razón Social / Comercial</th>
                    <th className="p-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/45 bg-white">
                  <tr
                    className="hover:bg-[#141414]/5 cursor-pointer text-blue-900 font-bold"
                    onClick={() => {
                      handleSetFilterEmpresa("TODOS");
                      setShowEmpresaSearchModal(false);
                    }}
                  >
                    <td className="p-2 border-r border-[#141414]">ALL</td>
                    <td className="p-2 border-r border-[#141414] uppercase">-- TODAS LAS EMPRESAS --</td>
                    <td className="p-2 text-right">
                      <button
                        type="button"
                        className="bg-blue-900 text-white hover:bg-blue-950 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                      >
                        [Todas]
                      </button>
                    </td>
                  </tr>
                  {db.empresas
                    .filter(e => e.ruc.includes(empresaSearchQuery) || e.razon_social.toLowerCase().includes(empresaSearchQuery.toLowerCase()) || (e.nombre_comercial && e.nombre_comercial.toLowerCase().includes(empresaSearchQuery.toLowerCase())))
                    .map(e => (
                      <tr
                        key={e.id_empresa}
                        className="hover:bg-[#141414]/5 cursor-pointer"
                        onClick={() => {
                          handleSetFilterEmpresa(e.id_empresa.toString());
                          setShowEmpresaSearchModal(false);
                        }}
                      >
                        <td className="p-2 border-r border-[#141414] font-bold">{e.ruc}</td>
                        <td className="p-2 border-r border-[#141414] uppercase">{e.nombre_comercial || e.razon_social}</td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            className="bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                          >
                            [Seleccionar]
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-[#141414] bg-zinc-200 text-right">
              <button
                type="button"
                onClick={() => setShowEmpresaSearchModal(false)}
                className="px-3 py-1 bg-white border border-[#141414] font-bold text-[10.5px] uppercase hover:bg-zinc-100 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. SELECCIÓN DE DISTRITO / REGION */}
      {showDistritoSearchModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-fade-in-quick">
          <div className="bg-[#E4E3E0] max-w-md w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col max-h-[80vh] font-mono text-[#141414] text-xs">
            <div className="p-3 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <span className="font-bold uppercase tracking-wider text-[11px]">🔎 FILTRAR POR DISTRITO / REGION</span>
              <button
                type="button"
                onClick={() => setShowDistritoSearchModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-bold"
              >
                [X]
              </button>
            </div>
            <div className="p-3 bg-zinc-200 border-b border-[#141414]">
              <input
                type="text"
                autoFocus
                placeholder="ESCRIBA EL NOMBRE DEL DISTRITO O REGION..."
                value={distritoSearchQuery}
                onChange={(e) => setDistritoSearchQuery(e.target.value)}
                className="w-full bg-white border border-[#141414] p-1.5 focus:outline-none placeholder-zinc-400 font-mono text-xs uppercase"
              />
            </div>
            <div className="overflow-y-auto flex-1 p-3">
              <table className="w-full text-left border-collapse border border-[#141414]">
                <thead>
                  <tr className="bg-[#141414]/10 font-bold text-[10px] uppercase border-b border-[#141414]">
                    <th className="p-2 border-r border-[#141414]">ID Div</th>
                    <th className="p-2 border-r border-[#141414]">Nombre División</th>
                    <th className="p-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/45 bg-white">
                  <tr
                    className="hover:bg-[#141414]/5 cursor-pointer text-blue-900 font-bold"
                    onClick={() => {
                      setFilterDistrito("TODOS");
                      setShowDistritoSearchModal(false);
                    }}
                  >
                    <td className="p-2 border-r border-[#141414]">ALL</td>
                    <td className="p-2 border-r border-[#141414] uppercase">-- TODOS LOS DISTRITOS / REGIONES --</td>
                    <td className="p-2 text-right">
                      <button
                        type="button"
                        className="bg-blue-900 text-white hover:bg-blue-950 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                      >
                        [Todos]
                      </button>
                    </td>
                  </tr>
                  {db.divisionesGeograficas
                    .filter(dg => dg.nombre.toLowerCase().includes(distritoSearchQuery.toLowerCase()))
                    .map(dg => (
                      <tr
                        key={dg.id_division}
                        className="hover:bg-[#141414]/5 cursor-pointer"
                        onClick={() => {
                          setFilterDistrito(dg.id_division.toString());
                          setShowDistritoSearchModal(false);
                        }}
                      >
                        <td className="p-2 border-r border-[#141414] font-bold">DIV_{dg.id_division}</td>
                        <td className="p-2 border-r border-[#141414] uppercase">{dg.nombre}</td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            className="bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                          >
                            [Seleccionar]
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-[#141414] bg-zinc-200 text-right">
              <button
                type="button"
                onClick={() => setShowDistritoSearchModal(false)}
                className="px-3 py-1 bg-white border border-[#141414] font-bold text-[10.5px] uppercase hover:bg-zinc-100 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FIX v2.114 — Gráficos adicionales: Top Rubros, Tickets por Mes, Promedio */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top Rubros por Empresa */}
        <div className="border border-[#141414] bg-white p-4">
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#141414] border-b border-[#141414]/20 pb-2 mb-3">📊 Top Rubros por Empresa</h3>
          <div className="space-y-2">
            {rubroChart.length === 0 ? (
              <p className="text-[10px] text-zinc-400 font-mono uppercase text-center py-4">No hay datos disponibles</p>
            ) : (
              rubroChart.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[9px] font-mono font-bold text-zinc-600 w-24 truncate" title={item.name}>{item.name}</span>
                  <div className="flex-1 bg-zinc-100 h-5 relative">
                    <div className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400" style={{ width: `${item.ratio * 100}%` }} />
                  </div>
                  <span className="text-[9px] font-mono font-bold text-[#141414] w-6 text-right">{item.value}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tickets por Mes */}
        <div className="border border-[#141414] bg-white p-4">
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#141414] border-b border-[#141414]/20 pb-2 mb-3">📅 Tickets por Mes (Últimos 6 meses)</h3>
          <div className="flex items-end justify-between h-32 gap-2">
            {monthlyChart.map((item, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[9px] font-mono font-bold text-[#141414]">{item.value}</span>
                <div className="w-full bg-zinc-100 relative" style={{ height: '80px' }}>
                  <div className="absolute bottom-0 w-full bg-gradient-to-t from-emerald-600 to-emerald-400" style={{ height: `${item.ratio * 100}%` }} />
                </div>
                <span className="text-[8px] font-mono text-zinc-500 uppercase">{item.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Promedio de Atención */}
        <div className="border border-[#141414] bg-white p-4">
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#141414] border-b border-[#141414]/20 pb-2 mb-3">✅ Promedio de Atención</h3>
          <div className="flex flex-col items-center justify-center py-4">
            <div className="relative w-24 h-24">
              <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e5e5" strokeWidth="10" />
                <circle cx="50" cy="50" r="40" fill="none" stroke={avgPerDay.percentage >= 80 ? '#16a34a' : avgPerDay.percentage >= 50 ? '#d97706' : '#dc2626'} strokeWidth="10" strokeDasharray={`${avgPerDay.percentage * 2.51} 251`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xl font-bold font-mono text-[#141414]">{avgPerDay.percentage}%</span>
            </div>
            <p className="text-[10px] font-mono text-zinc-500 mt-2 uppercase">Atendidos: {avgPerDay.resolved} / {avgPerDay.total}</p>
          </div>
        </div>
      </div>

    </div>
  );
}
