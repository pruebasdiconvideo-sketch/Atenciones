/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from "react";
import { MockDatabase } from "../db/mockDb";
import {
  Empresa,
  GrupoEmpresarial,
  Rubro,
  EmpresaSucursal,
  EmpresaContacto,
  Persona,
  Ubicacion,
} from "../types";
import { logTechnicalError } from "../utils/errorLogger";
import { getApiUrl as getDynamicApiUrl } from "../utils/api";
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Building,
  Sliders,
  Tags,
  MapPin,
  Briefcase,
  Compass,
  AlertTriangle,
  Check,
  Mail,
  Phone,
  FileDown,
  FileText,
  Archive,
} from "lucide-react";

interface CompanyManagerProps {
  db: MockDatabase;
  updateDb: (newDb: MockDatabase) => void;
  currentUser?: any;
  currentUserRole?: string;
  onSync?: () => void;
}

const isCloudSandbox =
  typeof window !== "undefined" &&
  (window.location.hostname.endsWith(".run.app") ||
    window.location.hostname.endsWith(".google.com") ||
    window.location.hostname.includes("aistudio-preview"));

const safeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const hasCustomUrl =
    typeof window !== "undefined" &&
    window.localStorage.getItem("iis_server_url");
  if (isCloudSandbox && !hasCustomUrl) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          status: "success",
          message: "Simulation active",
          id_persona: 999,
          id_empresa: 999,
          id_sucursal: 999,
          id_empresa_contacto: 999,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
  }
  return window.fetch(input, init);
};

const fetch = safeFetch;

type ModeTab =
  | "EMPRESAS"
  | "GRUPOS"
  | "RUBROS"
  | "SUCURSALES"
  | "CONTACTOS"
  | "BAJAS"
  | "REPORTE";

// FIX v2.32 — Dos pestañas principales: REGISTROS y DASHBOARD/REPORTES
type MainTab = "REGISTROS" | "DASHBOARD";

// ====================================================================
// FIX v2.31 — DashboardEmpresarial
// Panel de visualización ejecutiva que aparece al INICIO del módulo,
// antes que los registros. Muestra KPIs y distribución de empresas
// por rubro. Usa useMemo para cálculos derivados y HTML semántico
// accesible (role="region", aria-label).
// ====================================================================
interface DashboardEmpresarialProps {
  db: MockDatabase;
  onIrAReporte?: () => void;
}

function DashboardEmpresarial({ db, onIrAReporte }: DashboardEmpresarialProps) {
  // Cálculos derivados memoizados para evitar recálculos en cada render
  const totales = useMemo(() => {
    const totalEmpresas = db.empresas.length;
    const totalSucursales = db.sucursales.length;
    const totalContactos = db.contactosEmpresariales.length;
    const totalGrupos = db.gruposEmpresariales.length;
    const totalRubros = db.rubros.length;
    const totalEmpresasConSucursal = new Set(
      db.sucursales.map((s) => s.id_empresa)
    ).size;
    const totalEmpresasConContacto = new Set(
      db.contactosEmpresariales.map((c) => c.id_empresa)
    ).size;
    const coberturaSucursal =
      totalEmpresas > 0
        ? Math.round((totalEmpresasConSucursal / totalEmpresas) * 100)
        : 0;
    const coberturaContacto =
      totalEmpresas > 0
        ? Math.round((totalEmpresasConContacto / totalEmpresas) * 100)
        : 0;
    return {
      totalEmpresas,
      totalSucursales,
      totalContactos,
      totalGrupos,
      totalRubros,
      coberturaSucursal,
      coberturaContacto,
    };
  }, [
    db.empresas,
    db.sucursales,
    db.contactosEmpresariales,
    db.gruposEmpresariales,
    db.rubros,
  ]);

  // Distribución de empresas por rubro (para el mini-gráfico de barras)
  const distribucionRubros = useMemo(() => {
    const conteo = new Map<number, number>();
    db.empresas.forEach((emp) => {
      const id = emp.id_rubro || 0;
      conteo.set(id, (conteo.get(id) || 0) + 1);
    });
    const arr = db.rubros
      .map((r) => ({
        id: r.id_rubro,
        nombre: r.nombre,
        cantidad: conteo.get(r.id_rubro) || 0,
      }))
      .filter((r) => r.cantidad > 0)
      .sort((a, b) => b.cantidad - a.cantidad);
    // Empresas sin rubro asignado
    const sinRubro = conteo.get(0) || 0;
    if (sinRubro > 0) {
      arr.push({ id: 0, nombre: "Sin rubro", cantidad: sinRubro });
    }
    const max = arr.length > 0 ? arr[0].cantidad : 1;
    return { arr, max };
  }, [db.empresas, db.rubros]);

  // Top 5 empresas con más sucursales
  const topEmpresas = useMemo(() => {
    const conteo = new Map<number, number>();
    db.sucursales.forEach((s) => {
      conteo.set(s.id_empresa, (conteo.get(s.id_empresa) || 0) + 1);
    });
    return db.empresas
      .map((emp) => ({
        empresa: emp,
        sucursales: conteo.get(emp.id_empresa) || 0,
      }))
      .sort((a, b) => b.sucursales - a.sucursales)
      .slice(0, 5);
  }, [db.empresas, db.sucursales]);

  // KPI cards — cada una con role="figure" y aria-label
  const kpiCards = [
    {
      label: "Empresas",
      value: totales.totalEmpresas,
      sub: `${totales.coberturaSucursal}% con sedes`,
      icon: Building,
      color: "bg-[#141414] text-[#E4E3E0]",
    },
    {
      label: "Sedes / Sucursales",
      value: totales.totalSucursales,
      sub: `Matrices + sucursales`,
      icon: MapPin,
      color: "bg-[#1f3a5f] text-white",
    },
    {
      label: "Contactos",
      value: totales.totalContactos,
      sub: `${totales.coberturaContacto}% cobertura`,
      icon: Briefcase,
      color: "bg-[#3a5f1f] text-white",
    },
    {
      label: "Grupos Económicos",
      value: totales.totalGrupos,
      sub: `${totales.totalRubros} rubros activos`,
      icon: Compass,
      color: "bg-[#5f3a1f] text-white",
    },
  ];

  return (
    <section
      className="space-y-4"
      role="region"
      aria-label="Resumen ejecutivo de empresas"
    >
      {/* Encabezado del dashboard */}
      <header className="border-2 border-[#141414] bg-[#141414] text-[#E4E3E0] p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-sm sm:text-base font-serif italic tracking-wide">
            Resumen Ejecutivo · Empresas
          </h2>
          <p className="text-[10px] font-mono uppercase tracking-widest text-[#E4E3E0]/70">
            Visualización general · {new Date().toLocaleDateString("es-PE", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        {onIrAReporte && (
          <button
            type="button"
            onClick={onIrAReporte}
            className="self-start sm:self-auto bg-[#E4E3E0] text-[#141414] px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider hover:bg-white transition-colors cursor-pointer"
            aria-label="Ver reporte completo de empresas"
          >
            Ver reporte completo →
          </button>
        )}
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="list">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <article
              key={kpi.label}
              role="figure"
              aria-label={`${kpi.label}: ${kpi.value}`}
              className={`${kpi.color} border-2 border-[#141414] p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,0.5)] flex flex-col gap-2`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-80">
                  {kpi.label}
                </span>
                <Icon className="w-4 h-4 opacity-70" aria-hidden="true" />
              </div>
              <span className="text-3xl sm:text-4xl font-serif font-bold tabular-nums">
                {kpi.value.toLocaleString("es-PE")}
              </span>
              <span className="text-[9px] font-mono uppercase tracking-wider opacity-75">
                {kpi.sub}
              </span>
            </article>
          );
        })}
      </div>

      {/* Gráfico de barras + Top empresas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Distribución por rubro */}
        <article
          className="border-2 border-[#141414] bg-white p-4 space-y-3"
          aria-label="Distribución de empresas por rubro"
        >
          <h3 className="text-[11px] font-mono font-bold uppercase tracking-widest text-[#141414] border-b border-[#141414]/20 pb-2">
            Distribución de Empresas por Rubro
          </h3>
          {distribucionRubros.arr.length === 0 ? (
            <p className="text-xs text-zinc-400 italic py-6 text-center">
              No hay empresas registradas para mostrar distribución.
            </p>
          ) : (
            <ul className="space-y-1.5" role="list">
              {distribucionRubros.arr.map((r) => {
                const pct = Math.round(
                  (r.cantidad / totales.totalEmpresas) * 100
                );
                const barPct = Math.round(
                  (r.cantidad / distribucionRubros.max) * 100
                );
                return (
                  <li
                    key={r.id}
                    className="text-[11px] font-mono"
                    title={`${r.nombre}: ${r.cantidad} empresa(s) (${pct}%)`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-bold uppercase truncate pr-2">
                        {r.nombre}
                      </span>
                      <span className="text-[#141414]/70 tabular-nums">
                        {r.cantidad} · {pct}%
                      </span>
                    </div>
                    <div
                      className="h-2 bg-[#141414]/10 border border-[#141414]/30"
                      role="img"
                      aria-label={`${pct}% del total`}
                    >
                      <div
                        className="h-full bg-[#141414] transition-all duration-300"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </article>

        {/* Top empresas con más sedes */}
        <article
          className="border-2 border-[#141414] bg-white p-4 space-y-3"
          aria-label="Top 5 empresas con mayor número de sedes"
        >
          <h3 className="text-[11px] font-mono font-bold uppercase tracking-widest text-[#141414] border-b border-[#141414]/20 pb-2">
            Top 5 Empresas con más Sedes
          </h3>
          {topEmpresas.length === 0 ? (
            <p className="text-xs text-zinc-400 italic py-6 text-center">
              No hay empresas con sedes registradas.
            </p>
          ) : (
            <ol className="space-y-1.5 list-none" role="list">
              {topEmpresas.map((item, idx) => {
                const maxSuc = topEmpresas[0].sucursales || 1;
                const barPct = Math.round(
                  (item.sucursales / maxSuc) * 100
                );
                return (
                  <li
                    key={item.empresa.id_empresa}
                    className="text-[11px] font-mono flex items-center gap-2"
                  >
                    <span
                      className="inline-flex items-center justify-center w-5 h-5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold shrink-0"
                      aria-hidden="true"
                    >
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-bold uppercase truncate pr-2">
                          {item.empresa.nombre_comercial ||
                            item.empresa.razon_social}
                        </span>
                        <span className="text-[#141414]/70 tabular-nums">
                          {item.sucursales} sede(s)
                        </span>
                      </div>
                      <div
                        className="h-2 bg-[#141414]/10 border border-[#141414]/30"
                        role="img"
                        aria-label={`${item.sucursales} sedes`}
                      >
                        <div
                          className="h-full bg-[#1f3a5f] transition-all duration-300"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </article>
      </div>
    </section>
  );
}

// ====================================================================
// FIX v2.12: Componente ReporteEmpresarial — reporte filtrable en la página
// Permite filtrar por rubro, ver empresas con sus sucursales y contactos,
// y exportar la información filtrada a CSV y PDF.
// ====================================================================
function ReporteEmpresarial({ db }: { db: MockDatabase }) {
  const [filtroRubro, setFiltroRubro] = useState<string>("TODOS");
  const [filtroTexto, setFiltroTexto] = useState<string>("");
  const [empresaExpandida, setEmpresaExpandida] = useState<number | null>(null);

  // Filtrar empresas según rubro y texto
  const empresasFiltradas = useMemo(() => {
    return db.empresas.filter(emp => {
      // Filtro por rubro
      if (filtroRubro !== "TODOS" && emp.id_rubro !== parseInt(filtroRubro)) return false;
      // Filtro por texto (RUC, nombre comercial, razón social)
      if (filtroTexto.trim()) {
        const q = filtroTexto.trim().toLowerCase();
        const rucMatch = (emp.ruc || "").includes(q);
        const nombreMatch = (emp.nombre_comercial || "").toLowerCase().includes(q);
        const razonMatch = (emp.razon_social || "").toLowerCase().includes(q);
        if (!rucMatch && !nombreMatch && !razonMatch) return false;
      }
      return true;
    });
  }, [db.empresas, filtroRubro, filtroTexto]);

  // Función para resolver nombre de rubro
  const resolveRubro = (id_rubro: number | null) => {
    if (!id_rubro) return "—";
    const r = db.rubros.find(r => r.id_rubro === id_rubro);
    return r ? r.nombre : "—";
  };

  // Función para resolver nombre de persona
  const resolvePersona = (id_persona: number) => {
    const p = db.personas.find(per => per.id_persona === id_persona);
    return p ? `${p.nombres} ${p.apellido_paterno}` : `#${id_persona}`;
  };

  // Exportar CSV con datos filtrados
  const handleExportCsv = () => {
    const rows: string[][] = [["RUC", "Empresa", "Rubro", "Teléfono", "Correo", "Sucursal", "Dirección Sucursal", "Contacto", "Cargo", "Teléfono Contacto", "Correo Contacto"]];
    empresasFiltradas.forEach(emp => {
      const rubro = resolveRubro(emp.id_rubro);
      const sucursales = db.sucursales.filter(s => s.id_empresa === emp.id_empresa);
      const contactos = db.contactosEmpresariales.filter(c => c.id_empresa === emp.id_empresa);
      if (sucursales.length === 0 && contactos.length === 0) {
        rows.push([emp.ruc, emp.nombre_comercial || emp.razon_social, rubro, emp.telefono || "", emp.correo || "", "", "", "", "", "", ""]);
      } else {
        const maxRows = Math.max(sucursales.length, contactos.length, 1);
        for (let i = 0; i < maxRows; i++) {
          const suc = sucursales[i];
          const con = contactos[i];
          const ubi = suc ? db.ubicaciones.find(u => u.id_ubicacion === suc.id_ubicacion) : null;
          rows.push([
            emp.ruc, emp.nombre_comercial || emp.razon_social, rubro, emp.telefono || "", emp.correo || "",
            suc ? suc.nombre : "",
            ubi ? ubi.direccion : "",
            con ? resolvePersona(con.id_persona) : "",
            con ? (con.cargo || "") : "",
            con ? (con.telefono_empresa || "") : "",
            con ? (con.correo_empresa || "") : "",
          ]);
        }
      }
    });
    const csv = rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reporte_empresas_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Exportar PDF con datos filtrados
  const handleExportPdf = () => {
    const today = new Date().toLocaleString('es-PE');
    const rubroNombre = filtroRubro !== "TODOS" ? resolveRubro(parseInt(filtroRubro)) : "Todos";

    const empresasHtml = empresasFiltradas.map(emp => {
      const sucursales = db.sucursales.filter(s => s.id_empresa === emp.id_empresa);
      const contactos = db.contactosEmpresariales.filter(c => c.id_empresa === emp.id_empresa);

      const sucHtml = sucursales.length > 0 ? sucursales.map(s => {
        const ubi = db.ubicaciones.find(u => u.id_ubicacion === s.id_ubicacion);
        const div = ubi ? db.divisionesGeograficas.find(dg => dg.id_division === ubi.id_division) : null;
        const contactosSucursal = db.contactosEmpresariales.filter(c => c.id_sucursal === s.id_sucursal);
        const conSucHtml = contactosSucursal.length > 0
          ? contactosSucursal.map(cs => `<br/>&nbsp;&nbsp;• ${resolvePersona(cs.id_persona)} (${cs.cargo || "—"}) — ${cs.telefono_empresa || "—"} / ${cs.correo_empresa || "—"}`).join('')
          : "";
        return `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${s.nombre}</td><td style="padding:4px 8px;border:1px solid #ddd;">${ubi ? ubi.direccion : "—"}</td><td style="padding:4px 8px;border:1px solid #ddd;">${div ? div.nombre : "—"}</td><td style="padding:4px 8px;border:1px solid #ddd;">${s.telefono || "—"}</td><td style="padding:4px 8px;border:1px solid #ddd;">${s.es_principal ? "Sí" : "No"}${conSucHtml}</td></tr>`;
      }).join('') : '<tr><td colspan="5" style="padding:4px 8px;border:1px solid #ddd;color:#999;">Sin sucursales</td></tr>';

      const conHtml = contactos.length > 0 ? contactos.map(c => {
        const p = db.personas.find(per => per.id_persona === c.id_persona);
        return `<tr><td style="padding:4px 8px;border:1px solid #ddd;">${resolvePersona(c.id_persona)}</td><td style="padding:4px 8px;border:1px solid #ddd;">${p ? p.tipo_documento + " " + p.numero_documento : "—"}</td><td style="padding:4px 8px;border:1px solid #ddd;">${c.cargo || "—"}</td><td style="padding:4px 8px;border:1px solid #ddd;">${c.telefono_empresa || (p ? p.telefono : "—")}</td><td style="padding:4px 8px;border:1px solid #ddd;">${c.correo_empresa || (p ? p.correo : "—")}</td></tr>`;
      }).join('') : '<tr><td colspan="5" style="padding:4px 8px;border:1px solid #ddd;color:#999;">Sin contactos</td></tr>';

      return `<div style="border:1px solid #ccc;margin-bottom:10px;padding:10px;">
        <h3 style="margin:0 0 4px 0;font-size:14px;">${emp.nombre_comercial || emp.razon_social}</h3>
        <p style="font-size:11px;color:#555;margin:0 0 6px 0;">RUC: ${emp.ruc} · Rubro: ${resolveRubro(emp.id_rubro)} · Tel: ${emp.telefono || "—"} · Correo: ${emp.correo || "—"}</p>
        <p style="font-size:10px;font-weight:bold;margin:6px 0 2px 0;">SUCURSALES Y CONTACTOS DE SEDE:</p>
        <table style="width:100%;font-size:10px;border-collapse:collapse;margin-bottom:6px;"><thead><tr style="background:#eee;"><th style="padding:3px 6px;border:1px solid #ddd;text-align:left;">Sucursal</th><th style="padding:3px 6px;border:1px solid #ddd;">Dirección</th><th style="padding:3px 6px;border:1px solid #ddd;">Distrito</th><th style="padding:3px 6px;border:1px solid #ddd;">Teléfono</th><th style="padding:3px 6px;border:1px solid #ddd;">Principal / Contactos</th></tr></thead><tbody>${sucHtml}</tbody></table>
        <p style="font-size:10px;font-weight:bold;margin:6px 0 2px 0;">CONTACTOS DE EMPRESA:</p>
        <table style="width:100%;font-size:10px;border-collapse:collapse;"><thead><tr style="background:#eee;"><th style="padding:3px 6px;border:1px solid #ddd;text-align:left;">Nombre</th><th style="padding:3px 6px;border:1px solid #ddd;">Documento</th><th style="padding:3px 6px;border:1px solid #ddd;">Cargo</th><th style="padding:3px 6px;border:1px solid #ddd;">Teléfono</th><th style="padding:3px 6px;border:1px solid #ddd;">Correo</th></tr></thead><tbody>${conHtml}</tbody></table>
      </div>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Reporte de Empresas</title><style>body{font-family:'Segoe UI',Arial,sans-serif;padding:24px;max-width:1000px;margin:0 auto;color:#141414;}h1{font-size:20px;margin:0 0 4px 0;}h2{font-size:14px;margin:16px 0 8px 0;}.meta{font-size:11px;color:#555;margin-bottom:12px;}.footer{margin-top:24px;padding-top:10px;border-top:1px solid #ccc;font-size:10px;color:#888;text-align:center;}tr:nth-child(even) td{background:#f9f9f9;}@media print{body{padding:0;max-width:none;}}</style></head><body>
      <h1>Reporte de Empresas</h1>
      <div class="meta">Generado: ${today} · Rubro: ${rubroNombre} · ${empresasFiltradas.length} empresa(s)${filtroTexto ? ' · Filtro: "' + filtroTexto + '"' : ''}</div>
      ${empresasHtml || '<p style="color:#999;">No hay empresas que coincidan con los filtros.</p>'}
      <div class="footer">ERP SOPORTE</div>
      <script>window.onload=function(){window.print();};</script>
    </body></html>`;
    const w = window.open('', '_blank', 'width=1000,height=700');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    else { setNotification({ type: "warning", title: "Notificación", message: "Habilite las ventanas emergentes para exportar." }); }
  };

  return (
    <div className="space-y-4" role="region" aria-label="Reporte general de empresas">
      {/* Encabezado profesional del reporte */}
      <header className="border-2 border-[#141414] bg-white p-4 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-[#141414]/20 pb-2">
          <div>
            <h2 className="text-base font-serif italic font-bold tracking-wide">
              Reporte General de Empresas
            </h2>
            <p className="text-[10px] font-mono uppercase tracking-widest text-[#141414]/60">
              Directorio empresarial filtrable · {new Date().toLocaleDateString("es-PE")}
            </p>
          </div>
          <span className="text-[10px] font-mono text-[#141414]/60 self-start sm:self-auto">
            {empresasFiltradas.length} empresa(s) · {db.sucursales.length} sede(s) · {db.contactosEmpresariales.length} contacto(s)
          </span>
        </div>
      </header>

      {/* Filtros */}
      <div className="border border-[#141414] bg-white/10 p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2 border-b border-[#141414]/20 pb-2">
          <span className="font-serif italic text-xs uppercase font-bold">Filtros del Reporte</span>
          <span className="ml-auto text-[10px] font-mono text-[#141414]/60">
            {empresasFiltradas.length} empresa(s) encontrada(s)
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Filtro por rubro */}
          <div>
            <label className="block text-[10px] font-bold text-[#141414]/65 mb-1 uppercase">Rubro</label>
            <select
              value={filtroRubro}
              onChange={(e) => setFiltroRubro(e.target.value)}
              className="w-full text-xs bg-white border border-[#141414] p-1.5 text-[#141414] font-mono focus:outline-none cursor-pointer"
            >
              <option value="TODOS">-- TODOS LOS RUBROS --</option>
              {db.rubros.map(r => (
                <option key={r.id_rubro} value={r.id_rubro}>{r.nombre}</option>
              ))}
            </select>
          </div>
          {/* Búsqueda por texto */}
          <div className="md:col-span-2">
            <label className="block text-[10px] font-bold text-[#141414]/65 mb-1 uppercase">Buscar (RUC, nombre o razón social)</label>
            <input
              type="text"
              placeholder="Escriba para filtrar..."
              value={filtroTexto}
              onChange={(e) => setFiltroTexto(e.target.value)}
              className="w-full text-xs bg-white border border-[#141414] p-1.5 text-[#141414] font-mono focus:outline-none"
            />
          </div>
        </div>
        {/* Botones de exportación */}
        <div className="flex items-center gap-2 justify-end pt-2 border-t border-[#141414]/10">
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 border border-[#141414] bg-white text-[#141414] px-3 py-1.5 text-[10px] font-mono font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
          >
            <FileText className="w-3 h-3" /> Exportar CSV
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 border border-[#141414] bg-[#141414] text-[#E4E3E0] px-3 py-1.5 text-[10px] font-mono font-bold uppercase hover:bg-[#141414]/90 transition-colors cursor-pointer"
          >
            <FileDown className="w-3 h-3" /> Exportar PDF
          </button>
        </div>
      </div>

      {/* Tabla de empresas filtradas con expansión */}
      <div className="border border-[#141414] overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs" aria-label="Listado de empresas filtradas">
          <thead>
            <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase">
              <th scope="col" className="py-2.5 px-3 w-8" aria-label="Expandir/contraer"></th>
              <th scope="col" className="py-2.5 px-3">RUC</th>
              <th scope="col" className="py-2.5 px-3">Empresa</th>
              <th scope="col" className="py-2.5 px-3">Rubro</th>
              <th scope="col" className="py-2.5 px-3 text-center">Sucursales</th>
              <th scope="col" className="py-2.5 px-3 text-center">Contactos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#141414]/10 font-mono">
            {empresasFiltradas.map(emp => {
              const sucursales = db.sucursales.filter(s => s.id_empresa === emp.id_empresa);
              const contactos = db.contactosEmpresariales.filter(c => c.id_empresa === emp.id_empresa);
              const isExpanded = empresaExpandida === emp.id_empresa;
              return (
                <React.Fragment key={emp.id_empresa}>
                  <tr
                    className="hover:bg-[#141414]/5 cursor-pointer"
                    onClick={() => setEmpresaExpandida(isExpanded ? null : emp.id_empresa)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setEmpresaExpandida(isExpanded ? null : emp.id_empresa);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-expanded={isExpanded}
                    aria-label={`Empresa ${emp.nombre_comercial || emp.razon_social}, RUC ${emp.ruc}`}
                  >
                    <td className="py-2 px-3 text-center font-bold text-[10px]" aria-hidden="true">{isExpanded ? "▼" : "▶"}</td>
                    <td className="py-2 px-3 font-bold">{emp.ruc}</td>
                    <td className="py-2 px-3 uppercase font-bold">{emp.nombre_comercial || emp.razon_social}</td>
                    <td className="py-2 px-3 text-[11px]">{resolveRubro(emp.id_rubro)}</td>
                    <td className="py-2 px-3 text-center">{sucursales.length}</td>
                    <td className="py-2 px-3 text-center">{contactos.length}</td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-white">
                      <td colSpan={6} className="p-4">
                        {/* Detalle de la empresa expandida */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Sucursales con sus contactos */}
                          <div>
                            <p className="text-[10px] font-bold uppercase text-[#141414]/60 mb-2">Sucursales y Contactos de Sede</p>
                            {sucursales.length > 0 ? (
                              <div className="space-y-2">
                                {sucursales.map(s => {
                                  const ubi = db.ubicaciones.find(u => u.id_ubicacion === s.id_ubicacion);
                                  const div = ubi ? db.divisionesGeograficas.find(dg => dg.id_division === ubi.id_division) : null;
                                  const contactosSuc = db.contactosEmpresariales.filter(c => c.id_sucursal === s.id_sucursal);
                                  return (
                                    <div key={s.id_sucursal} className="border border-[#141414]/20 p-2 text-[11px]">
                                      <p className="font-bold uppercase">{s.nombre} {s.es_principal && <span className="text-emerald-700">(Matriz)</span>}</p>
                                      <p className="text-[10px] text-zinc-500">{ubi ? ubi.direccion : "—"} {div ? "· " + div.nombre : ""} · Tel: {s.telefono || "—"}</p>
                                      {contactosSuc.length > 0 && (
                                        <ul className="mt-1 ml-3 text-[10px] text-zinc-600 list-disc">
                                          {contactosSuc.map(cs => (
                                            <li key={cs.id_empresa_contacto}>{resolvePersona(cs.id_persona)} — {cs.cargo || "—"} · {cs.telefono_empresa || "—"} · {cs.correo_empresa || "—"}</li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-[11px] text-zinc-400 italic">Sin sucursales registradas.</p>
                            )}
                          </div>
                          {/* Contactos de empresa */}
                          <div>
                            <p className="text-[10px] font-bold uppercase text-[#141414]/60 mb-2">Contactos de Empresa</p>
                            {contactos.length > 0 ? (
                              <div className="space-y-1">
                                {contactos.map(c => {
                                  const p = db.personas.find(per => per.id_persona === c.id_persona);
                                  return (
                                    <div key={c.id_empresa_contacto} className="border border-[#141414]/20 p-2 text-[11px]">
                                      <p className="font-bold">{resolvePersona(c.id_persona)} {c.es_principal && <span className="text-emerald-700">(Principal)</span>}</p>
                                      <p className="text-[10px] text-zinc-500">{c.cargo || "—"}</p>
                                      <p className="text-[10px] text-zinc-500">Tel: {c.telefono_empresa || (p ? p.telefono : "—")} · {c.correo_empresa || (p ? p.correo : "—")}</p>
                                      <p className="text-[9px] text-zinc-400">{p ? `${p.tipo_documento}: ${p.numero_documento}` : ""}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-[11px] text-zinc-400 italic">Sin contactos registrados.</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {empresasFiltradas.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-zinc-400 uppercase text-[11px]">
                  No hay empresas que coincidan con los filtros aplicados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CompanyManager({
  db,
  updateDb,
  currentUser,
  currentUserRole,
  onSync,
}: CompanyManagerProps) {
  // FIX v2.32 — Dos niveles de pestañas: MainTab (REGISTROS / DASHBOARD)
  // y dentro de REGISTROS un ModeTab con sub-pestañas.
  // Por defecto abre REGISTROS → EMPRESAS.
  const [activeMainTab, setActiveMainTab] = useState<MainTab>("REGISTROS");
  const [activeSubTab, setActiveSubTab] = useState<ModeTab>("EMPRESAS");

  // Mostrar/Ocultar modal de baja con motivo
  const [showBajaModal, setShowBajaModal] = useState(false);
  const [bajaTarget, setBajaTarget] = useState<{
    tipo: ModeTab;
    id: number;
    nombre: string;
  } | null>(null);
  const [bajaMotivo, setBajaMotivo] = useState("");

  // Empresas/sucursales/contactos marcados como inactivos (simulado en memoria)
  // En producción se lee del campo `activo` de el sistema.
  const [bajasRegistradas, setBajasRegistradas] = useState<
    Array<{
      id: number;
      tipo: ModeTab;
      id_entidad: number;
      nombre: string;
      motivo: string;
      fecha: string;
      usuario: string;
    }>
  >([]);

  // FIX v2.40 — bajasUnificadas: combina bajas de la BD (db.bajasRegistradas)
  // con bajas del estado local (bajasRegistradas). Esto hace que la pestaña
  // BAJAS muestre TODAS las bajas, incluyendo las creadas en sesiones anteriores.
  const bajasUnificadas = useMemo(() => {
    const mapTipoBackendToFrontend: Record<string, ModeTab> = {
      EMPRESA: "EMPRESAS",
      SUCURSAL: "SUCURSALES",
      CONTACTO: "CONTACTOS",
      PERSONA: "CONTACTOS",
      TRABAJADOR: "CONTACTOS",
    };
    // 1. Bajas desde la BD (db.bajasRegistradas)
    const desdeBd: Array<{
      id: number;
      tipo: ModeTab;
      id_entidad: number;
      nombre: string;
      motivo: string;
      fecha: string;
      usuario: string;
    }> = (db.bajasRegistradas || []).map((b: any) => {
      const tipoFrontend = mapTipoBackendToFrontend[b.tipo_entidad || ""] || "EMPRESAS";
      // FIX v2.40: Usar nombre_entidad que viene del backend (vía JOIN con la tabla correspondiente).
      // Si no viene, generar un fallback con el ID.
      let nombre = b.nombre_entidad || b.nombre || "";
      if (!nombre) {
        if (tipoFrontend === "EMPRESAS") nombre = `Empresa #${b.id_entidad}`;
        else if (tipoFrontend === "SUCURSALES") nombre = `Sucursal #${b.id_entidad}`;
        else nombre = `Contacto #${b.id_entidad}`;
      }
      return {
        id: b.id_baja || b.id || Date.now() + b.id_entidad,
        tipo: tipoFrontend,
        id_entidad: b.id_entidad,
        nombre,
        motivo: b.motivo,
        fecha: b.fecha_baja || b.fecha || "",
        usuario: b.usuario || (b.id_usuario ? `Usuario #${b.id_usuario}` : "sistema"),
      };
    });
    // 2. Bajas del estado local (que aún no se han persistido o que vienen de cascada)
    // Solo incluir las locales que no estén ya en la BD (por id_entidad + tipo).
    const idsEnBd = new Set(desdeBd.map(b => `${b.tipo}-${b.id_entidad}`));
    const soloLocales = bajasRegistradas.filter(b => !idsEnBd.has(`${b.tipo}-${b.id_entidad}`));
    // 3. Combinar: BD primero (más reciente), luego locales
    return [...desdeBd, ...soloLocales];
  }, [db.bajasRegistradas, bajasRegistradas]);

  const [searchQuery, setSearchQuery] = useState("");
  // FIX v2.36 — OPTIMIZACIÓN: Debounce en búsqueda para evitar refilter en cada tecla.
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // FIX v2.116 — Filtro por grupo económico (currentPage y pageSize ya existen más abajo).
  const [filterGrupoId, setFilterGrupoId] = useState<string>("TODOS");

  // Geolocation states
  const [showGeoSelector, setShowGeoSelector] = useState(false);
  const [geoSelectedCountryId, setGeoSelectedCountryId] = useState<number>(1);
  const [geoSelections, setGeoSelections] = useState<{
    [levelIndex: number]: number | null;
  }>({});
  const [geoModalTarget, setGeoModalTarget] = useState<
    "EMPRESA" | "SUCURSAL"
  >("EMPRESA");

  const getInitialDivisionPaisMap = () => {
    const saved = localStorage.getItem("GEOGRAPHIC_DIVISION_PAIS_MAP");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        /* ignore */
      }
    }
    return { 1: 1, 6: 1, 9: 2 };
  };

  const getCountryOfDivision = (divId: number | null): number | null => {
    if (divId === null || !divId) return null;
    let current = db.divisionesGeograficas.find(
      (dg) => dg.id_division === divId
    );
    while (current && current.id_division_padre !== null) {
      current = db.divisionesGeograficas.find(
        (dg) => dg.id_division === current!.id_division_padre
      );
    }
    if (!current) return null;
    const mapping = getInitialDivisionPaisMap();
    return mapping[current.id_division] || 1;
  };

  const getFullHierarchyBreadcrumb = (divId: number | null): string => {
    if (divId === null || !divId) return "Seleccione Ubicación Geográfica...";
    const crumbs: string[] = [];
    let current = db.divisionesGeograficas.find(
      (dg) => dg.id_division === divId
    );
    while (current) {
      crumbs.unshift(current.nombre);
      current = db.divisionesGeograficas.find(
        (dg) => dg.id_division === current!.id_division_padre
      );
    }
    const countryId = getCountryOfDivision(divId);
    const country = db.paises.find((p) => p.id_pais === countryId);
    if (country) crumbs.unshift(country.nombre);
    return crumbs.join(" ➔ ");
  };

  const logAudit = (
    modulo: string,
    operacion: "CREACION" | "MODIFICACION" | "ELIMINACION",
    detalles: string,
    dbObj: MockDatabase
  ) => {
    const userEmail = currentUser?.correo || "admin@soporte.com";
    const nextAudId =
      dbObj.auditoriaOperaciones && dbObj.auditoriaOperaciones.length > 0
        ? Math.max(...dbObj.auditoriaOperaciones.map((o) => o.id_auditoria)) + 1
        : 1;
    const newAudit = {
      id_auditoria: nextAudId,
      usuario: userEmail,
      fecha_hora: new Date().toISOString().replace("T", " ").substring(0, 19),
      modulo,
      operacion,
      detalles,
    };
    if (!dbObj.auditoriaOperaciones) dbObj.auditoriaOperaciones = [];
    dbObj.auditoriaOperaciones = [newAudit, ...dbObj.auditoriaOperaciones];
  };

  const [integrityError, setIntegrityError] = useState<string | null>(null);

  // Search modals
  const [showRubroSearchModal, setShowRubroSearchModal] = useState(false);
  const [rubroSearchQuery, setRubroSearchQuery] = useState("");
  const [showGrupoSearchModal, setShowGrupoSearchModal] = useState(false);
  const [grupoSearchQuery, setGrupoSearchQuery] = useState("");
  const [showEmpresaSearchModal, setShowEmpresaSearchModal] = useState(false);
  const [empresaSearchQuery, setEmpresaSearchQuery] = useState("");
  const [empresaSearchTarget, setEmpresaSearchTarget] = useState<
    "SUCURSAL" | "CONTACTO"
  >("SUCURSAL");

  // Nuevo modal de búsqueda de sucursales para contactos
  const [showSucursalSearchModal, setShowSucursalSearchModal] = useState(false);
  const [sucursalSearchQuery, setSucursalSearchQuery] = useState("");

  // Modal / Form states
  const [showEditModal, setShowEditModal] = useState(false);
  const [editType, setEditType] = useState<ModeTab | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);

  // Form fields
  const [formRuc, setFormRuc] = useState("");
  // FIX v2.65 — Restaurar validación RUC: 11 dígitos numéricos.
  // FIX v2.48 — Checkboxes para decidir creación automática de sede.
  const [formTieneSedes, setFormTieneSedes] = useState<boolean>(false);
  const [formEsSedePrincipal, setFormEsSedePrincipal] = useState<boolean>(true);
  const [formRazonSocial, setFormRazonSocial] = useState("");
  const [formNombreComercial, setFormNombreComercial] = useState("");
  const [formTelefono, setFormTelefono] = useState("");
  const [formCorreo, setFormCorreo] = useState("");
  const [formRubroId, setFormRubroId] = useState<number>(1);
  const [formGrupoId, setFormGrupoId] = useState<number | "null">("null");
  const [formDireccion, setFormDireccion] = useState("");
  const [formReferencia, setFormReferencia] = useState("");
  const [formDivisionId, setFormDivisionId] = useState<number>(3);

  const [formGrupoNombre, setFormGrupoNombre] = useState("");
  const [formGrupoDesc, setFormGrupoDesc] = useState("");
  const [formRubroNombre, setFormRubroNombre] = useState("");
  const [formSucursalNombre, setFormSucursalNombre] = useState("");
  const [formSucursalEmpresa, setFormSucursalEmpresa] = useState<number>(1);
  const [formSucursalTel, setFormSucursalTel] = useState("");
  const [formSucursalPrincipal, setFormSucursalPrincipal] = useState(false);

  const [formContactNombre, setFormContactNombre] = useState("");
  const [formContactApellidoPat, setFormContactApellidoPat] = useState("");
  const [formContactApellidoMat, setFormContactApellidoMat] = useState("");
  const [formContactTipoDoc, setFormContactTipoDoc] = useState("DNI");
  const [formContactNumDoc, setFormContactNumDoc] = useState("");
  const [formContactCorreoPers, setFormContactCorreoPers] = useState("");
  const [formContactTelPers, setFormContactTelPers] = useState("");
  const [formContactCargo, setFormContactCargo] = useState("");
  const [formContactEmpresaId, setFormContactEmpresaId] = useState<number>(1);
  const [formContactSucursalId, setFormContactSucursalId] = useState<
    number | "null"
  >("null");
  const [formContactTelEmp, setFormContactTelEmp] = useState("");
  const [formContactCorrEmp, setFormContactCorrEmp] = useState("");
  const [formContactPrincipal, setFormContactPrincipal] = useState(false);

  const resetAllFormStates = () => {
    setFormRuc("");
    setFormRazonSocial("");
    setFormNombreComercial("");
    setFormTelefono("");
    setFormCorreo("");
    setFormRubroId(db.rubros[0]?.id_rubro || 1);
    setFormGrupoId("null");
    setFormDireccion("");
    setFormReferencia("");
    setFormDivisionId(3);
    setFormTieneSedes(false);
    setFormEsSedePrincipal(true);
    setFormGrupoNombre("");
    setFormGrupoDesc("");
    setFormRubroNombre("");
    setFormSucursalNombre("");
    setFormSucursalEmpresa(db.empresas[0]?.id_empresa || 1);
    setFormSucursalTel("");
    setFormSucursalPrincipal(false);
    setFormContactNombre("");
    setFormContactApellidoPat("");
    setFormContactApellidoMat("");
    setFormContactTipoDoc("DNI");
    setFormContactNumDoc("");
    setFormContactCorreoPers("");
    setFormContactTelPers("");
    setFormContactCargo("");
    setFormContactEmpresaId(db.empresas[0]?.id_empresa || 1);
    setFormContactSucursalId("null");
    setFormContactTelEmp("");
    setFormContactCorrEmp("");
    setFormContactPrincipal(false);
    setIntegrityError(null);
  };

  const getApiUrl = (action: string) => getDynamicApiUrl(action);

  const handleApiResponse = async (
    response: Response,
    successMessage: string,
    errorMessage: string
  ) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `${errorMessage} (HTTP ${response.status})`);
    }
    const data = await response.json();
    if (data.status !== "success") {
      throw new Error(data.message || errorMessage);
    }
    console.log(successMessage, data);
    return data;
  };

  // ==================== EMPRESA ====================
  const handleSaveEmpresa = async () => {
    // FIX v2.65 — RUC debe ser exactamente 11 dígitos numéricos.
    if (!/^[0-9]{11}$/.test(formRuc)) {
      setNotification({
        type: "warning",
        title: "RUC inválido",
        message: `El RUC debe tener exactamente 11 dígitos numéricos.\n\nActualmente tiene ${formRuc.length} carácter(es). Solo se permiten números (0-9).`,
      });
      return;
    }
    if (!formRuc || !formRazonSocial || !formCorreo || !formDireccion) {
      setNotification({
        type: "warning",
        title: "Campos obligatorios",
        message: "Por favor rellene los datos obligatorios (*): RUC, Razón Social, Correo y Dirección.",
      });
      return;
    }

    let nextDb = { ...db };

    try {
      if (editId === null) {
        if (db.empresas.some((comp) => comp.ruc === formRuc)) {
          setNotification({ type: "error", title: "Error", message: "CONSTRAINT ERROR: El RUC ya existe registrado en la base de datos." });
          return;
        }

        const nextUbiId =
          db.ubicaciones.length > 0
            ? Math.max(...db.ubicaciones.map((u) => u.id_ubicacion)) + 1
            : 1;
        const newUbicacion: Ubicacion = {
          id_ubicacion: nextUbiId,
          direccion: formDireccion,
          referencia: formReferencia || null,
          id_division: formDivisionId,
        };
        nextDb.ubicaciones.push(newUbicacion);

        const nextEmpId =
          db.empresas.length > 0
            ? Math.max(...db.empresas.map((e) => e.id_empresa)) + 1
            : 1;
        const newEmp: Empresa = {
          id_empresa: nextEmpId,
          ruc: formRuc,
          razon_social: formRazonSocial,
          nombre_comercial: formNombreComercial || null,
          telefono: formTelefono || null,
          correo: formCorreo,
          id_rubro: formRubroId,
          id_grupo: formGrupoId === "null" ? null : formGrupoId,
          id_ubicacion: nextUbiId,
          estado: true,
        };
        nextDb.empresas.push(newEmp);

        // FIX v2.85 — Solo crear la sede principal por defecto si el usuario
        // marcó "¿Esta empresa tiene sedes/sucursales?" como SÍ.
        // Antes se creaba siempre, ignorando la decisión del usuario.
        if (formTieneSedes) {
          const nextSucId =
            db.sucursales.length > 0
              ? Math.max(...db.sucursales.map((s) => s.id_sucursal)) + 1
              : 1;
          const defaultSuc: EmpresaSucursal = {
            id_sucursal: nextSucId,
            id_empresa: nextEmpId,
            nombre: "Sede Principal - " + (formNombreComercial || "Central"),
            id_ubicacion: nextUbiId,
            telefono: formTelefono || null,
            es_principal: true,
          };
          nextDb.sucursales.push(defaultSuc);
        }

        logAudit(
          "EMPRESAS",
          "CREACION",
          `Se registró la empresa '${formRazonSocial}' (RUC: ${formRuc}) con ubicación matriz en ${getFullHierarchyBreadcrumb(
            formDivisionId
          )}${formTieneSedes ? "" : " (sin sedes iniciales)"}`,
          nextDb
        );

        const response = await fetch(getApiUrl("save_empresa"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_empresa: 0,
            ruc: formRuc,
            razon_social: formRazonSocial,
            nombre_comercial: formNombreComercial || null,
            telefono: formTelefono || null,
            correo: formCorreo,
            id_rubro: formRubroId,
            id_grupo: formGrupoId === "null" ? null : formGrupoId,
            direccion: formDireccion,
            referencia: formReferencia || null,
            id_division: formDivisionId,
            crear_sede: formTieneSedes,
            es_sede_principal: formEsSedePrincipal,
          }),
        });
        await handleApiResponse(
          response,
          "Empresa guardada ",
          "Error al guardar empresa "
        );
      } else {
        const empresaOriginal = db.empresas.find((e) => e.id_empresa === editId);
        if (!empresaOriginal) {
          setNotification({ type: "warning", title: "Notificación", message: "La empresa a editar no existe." });
          return;
        }

        nextDb.empresas = db.empresas.map((emp) => {
          if (emp.id_empresa === editId) {
            nextDb.ubicaciones = db.ubicaciones.map((u) => {
              if (u.id_ubicacion === emp.id_ubicacion) {
                return {
                  ...u,
                  direccion: formDireccion,
                  referencia: formReferencia || null,
                  id_division: formDivisionId,
                };
              }
              return u;
            });
            return {
              ...emp,
              ruc: empresaOriginal.ruc,
              razon_social: formRazonSocial,
              nombre_comercial: formNombreComercial || null,
              telefono: formTelefono || null,
              correo: formCorreo,
              id_rubro: formRubroId,
              id_grupo: formGrupoId === "null" ? null : formGrupoId,
            };
          }
          return emp;
        });

        logAudit(
          "EMPRESAS",
          "MODIFICACION",
          `Se modificó la empresa ID #${editId} ('${formRazonSocial}') estableciendo ubicación en ${getFullHierarchyBreadcrumb(
            formDivisionId
          )}`,
          nextDb
        );

        const response = await fetch(getApiUrl("save_empresa"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_empresa: editId,
            ruc: empresaOriginal.ruc,
            razon_social: formRazonSocial,
            nombre_comercial: formNombreComercial || null,
            telefono: formTelefono || null,
            correo: formCorreo,
            id_rubro: formRubroId,
            id_grupo: formGrupoId === "null" ? null : formGrupoId,
            direccion: formDireccion,
            referencia: formReferencia || null,
            id_division: formDivisionId,
          }),
        });
        await handleApiResponse(
          response,
          "Empresa actualizada ",
          "Error al actualizar empresa "
        );
      }

      updateDb(nextDb);
      // FIX v2.85 — Mensaje claro sobre si se creó o no la sede inicial.
      const sedeMsg = editId === null
        ? (formTieneSedes
          ? "\n\n✓ Se creó automáticamente la sede principal con la dirección indicada."
          : "\n\nℹ No se crearon sedes iniciales. Puede agregarlas después desde la pestaña SUCURSALES.")
        : "";
      setNotification({
        type: "success", title: "Éxito", message:
          `✓ REGISTRO GUARDADO: La empresa '${formRazonSocial}' ha sido guardada exitosamente.${sedeMsg}`
      });
      setShowEditModal(false);

    } catch (error: any) {
      console.error("Error en handleSaveEmpresa:", error);
      setNotification({
        type: "error", title: "Error", message:
          `❌ Error al guardar la empresa: ${error.message || "Intente nuevamente."}`
      });
      logTechnicalError(error, {
        url: getApiUrl("save_empresa"),
        sqlStatus: "SAVE_EMPRESA_ERROR",
        currentUser,
      });
    }
  };

  // ==================== GRUPO ====================
  const handleSaveGrupo = async () => {
    if (!formGrupoNombre) {
      setNotification({ type: "warning", title: "Notificación", message: "El nombre del grupo es obligatorio." });
      return;
    }

    try {
      const payload = {
        id_grupo: editId || 0,
        nombre: formGrupoNombre,
        descripcion: formGrupoDesc || null,
      };

      const response = await fetch(getApiUrl("save_grupo"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await handleApiResponse(
        response,
        "Grupo guardado ",
        "Error al guardar grupo "
      );

      let nextDb = { ...db };
      if (editId === null) {
        const newGroup: GrupoEmpresarial = {
          id_grupo:
            data.id_grupo ||
            (db.gruposEmpresariales.length > 0
              ? Math.max(...db.gruposEmpresariales.map((g) => g.id_grupo)) + 1
              : 1),
          nombre: formGrupoNombre,
          descripcion: formGrupoDesc || null,
        };
        nextDb.gruposEmpresariales = [...db.gruposEmpresariales, newGroup];
        logAudit(
          "DIRECTORIOS",
          "CREACION",
          `Se registró el grupo empresarial '${formGrupoNombre}'`,
          nextDb
        );
      } else {
        nextDb.gruposEmpresariales = db.gruposEmpresariales.map((g) => {
          if (g.id_grupo === editId) {
            return { ...g, nombre: formGrupoNombre, descripcion: formGrupoDesc || null };
          }
          return g;
        });
        logAudit(
          "DIRECTORIOS",
          "MODIFICACION",
          `Se modificó el grupo empresarial ID #${editId} ('${formGrupoNombre}')`,
          nextDb
        );
      }

      updateDb(nextDb);
      setNotification({
        type: "success", title: "Éxito", message:
          `✓ REGISTRO GUARDADO: El grupo empresarial '${formGrupoNombre}' ha sido guardado exitosamente.`
      });
      setShowEditModal(false);

    } catch (error: any) {
      console.error("Error en handleSaveGrupo:", error);
      setNotification({
        type: "error", title: "Error", message:
          `❌ Error al guardar el grupo: ${error.message || "Intente nuevamente."}`
      });
      logTechnicalError(error, {
        url: getApiUrl("save_grupo"),
        sqlStatus: "SAVE_GRUPO_ERROR",
        currentUser,
      });
    }
  };

  // ==================== RUBRO ====================
  const handleSaveRubro = async () => {
    if (!formRubroNombre) {
      setNotification({ type: "warning", title: "Notificación", message: "El nombre del rubro es obligatorio." });
      return;
    }

    try {
      const payload = {
        id_rubro: editId || 0,
        nombre: formRubroNombre,
      };

      const response = await fetch(getApiUrl("save_rubro"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await handleApiResponse(
        response,
        "Rubro guardado ",
        "Error al guardar rubro "
      );

      let nextDb = { ...db };
      if (editId === null) {
        const newRubro: Rubro = {
          id_rubro:
            data.id_rubro ||
            (db.rubros.length > 0
              ? Math.max(...db.rubros.map((r) => r.id_rubro)) + 1
              : 1),
          nombre: formRubroNombre,
        };
        nextDb.rubros = [...db.rubros, newRubro];
        logAudit(
          "DIRECTORIOS",
          "CREACION",
          `Se registró el rubro de negocio '${formRubroNombre}'`,
          nextDb
        );
      } else {
        nextDb.rubros = db.rubros.map((r) => {
          if (r.id_rubro === editId) {
            return { ...r, nombre: formRubroNombre };
          }
          return r;
        });
        logAudit(
          "DIRECTORIOS",
          "MODIFICACION",
          `Se modificó el rubro de negocio ID #${editId} ('${formRubroNombre}')`,
          nextDb
        );
      }

      updateDb(nextDb);
      setNotification({
        type: "success", title: "Éxito", message:
          `✓ REGISTRO GUARDADO: El rubro '${formRubroNombre}' ha sido guardado exitosamente.`
      });
      setShowEditModal(false);

    } catch (error: any) {
      console.error("Error en handleSaveRubro:", error);
      setNotification({
        type: "error", title: "Error", message:
          `❌ Error al guardar el rubro: ${error.message || "Intente nuevamente."}`
      });
      logTechnicalError(error, {
        url: getApiUrl("save_rubro"),
        sqlStatus: "SAVE_RUBRO_ERROR",
        currentUser,
      });
    }
  };

  // ==================== SUCURSAL ====================
  const handleSaveSucursal = async () => {
    if (!formSucursalNombre || !formDireccion) {
      setNotification({
        type: "warning", title: "Notificación", message:
          "Por favor ingrese el nombre de la sucursal y la dirección física."
      });
      return;
    }

    let nextDb = { ...db };
    try {
      if (editId === null) {
        const nextUbiId =
          db.ubicaciones.length > 0
            ? Math.max(...db.ubicaciones.map((u) => u.id_ubicacion)) + 1
            : 1;
        const newUbicacion: Ubicacion = {
          id_ubicacion: nextUbiId,
          direccion: formDireccion,
          referencia: formReferencia || null,
          id_division: formDivisionId,
        };
        nextDb.ubicaciones.push(newUbicacion);

        const nextSucId =
          db.sucursales.length > 0
            ? Math.max(...db.sucursales.map((s) => s.id_sucursal)) + 1
            : 1;
        const newS: EmpresaSucursal = {
          id_sucursal: nextSucId,
          id_empresa: formSucursalEmpresa,
          nombre: formSucursalNombre,
          id_ubicacion: nextUbiId,
          telefono: formSucursalTel || null,
          es_principal: formSucursalPrincipal,
        };
        nextDb.sucursales.push(newS);

        logAudit(
          "SUCURSALES",
          "CREACION",
          `Se registró la sucursal '${formSucursalNombre}' para la empresa ID #${formSucursalEmpresa} en la ubicación ${getFullHierarchyBreadcrumb(
            formDivisionId
          )}`,
          nextDb
        );

        const response = await fetch(getApiUrl("save_sucursal"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_sucursal: 0,
            id_empresa: formSucursalEmpresa,
            nombre: formSucursalNombre,
            telefono: formSucursalTel || null,
            es_principal: formSucursalPrincipal,
            direccion: formDireccion,
            referencia: formReferencia || null,
            id_division: formDivisionId,
          }),
        });
        await handleApiResponse(
          response,
          "Sucursal guardada ",
          "Error al guardar sucursal "
        );
      } else {
        nextDb.sucursales = db.sucursales.map((s) => {
          if (s.id_sucursal === editId) {
            nextDb.ubicaciones = db.ubicaciones.map((u) => {
              if (u.id_ubicacion === s.id_ubicacion) {
                return {
                  ...u,
                  direccion: formDireccion,
                  referencia: formReferencia || null,
                  id_division: formDivisionId,
                };
              }
              return u;
            });
            return {
              ...s,
              id_empresa: formSucursalEmpresa,
              nombre: formSucursalNombre,
              telefono: formSucursalTel || null,
              es_principal: formSucursalPrincipal,
            };
          }
          return s;
        });

        logAudit(
          "SUCURSALES",
          "MODIFICACION",
          `Se modificó la sucursal ID #${editId} ('${formSucursalNombre}') estableciendo ubicación en ${getFullHierarchyBreadcrumb(
            formDivisionId
          )}`,
          nextDb
        );

        const response = await fetch(getApiUrl("save_sucursal"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_sucursal: editId,
            id_empresa: formSucursalEmpresa,
            nombre: formSucursalNombre,
            telefono: formSucursalTel || null,
            es_principal: formSucursalPrincipal,
            direccion: formDireccion,
            referencia: formReferencia || null,
            id_division: formDivisionId,
          }),
        });
        await handleApiResponse(
          response,
          "Sucursal actualizada ",
          "Error al actualizar sucursal "
        );
      }

      updateDb(nextDb);
      // FIX v2.81 — Refrescar desde la BD para que el cambio de empresa/sede
      // sea visible inmediatamente sin necesidad de F5.
      setNotification({
        type: "success",
        title: "Sucursal guardada",
        message: `La sucursal '${formSucursalNombre}' ha sido guardada exitosamente.`,
      });
      setShowEditModal(false);

    } catch (error: any) {
      console.error("Error en handleSaveSucursal:", error);
      setNotification({
        type: "error",
        title: "Error al guardar sucursal",
        message: error.message || "Intente nuevamente.",
      });
      logTechnicalError(error, {
        url: getApiUrl("save_sucursal"),
        sqlStatus: "SAVE_SUCURSAL_ERROR",
        currentUser,
      });
    }
  };

  // ==================== CONTACTO ====================
  const handleSaveContacto = async () => {
    // FIX v2.29: DNI no obligatorio para contactos de empresa
    if (
      !formContactNombre ||
      !formContactApellidoPat ||
      !formContactCargo ||
      !formContactCorrEmp
    ) {
      setNotification({ type: "warning", title: "Notificación", message: "Por favor rellene los datos obligatorios (*)" });
      return;
    }

    const nextDb = { ...db };

    try {
      if (editId === null) {
        const nextPersId =
          db.personas.length > 0
            ? Math.max(...db.personas.map((p) => p.id_persona)) + 1
            : 1;
        const newP: Persona = {
          id_persona: nextPersId,
          nombres: formContactNombre,
          apellido_paterno: formContactApellidoPat,
          apellido_materno: formContactApellidoMat || null,
          tipo_documento: formContactTipoDoc,
          numero_documento: formContactNumDoc,
          correo: formContactCorrEmp,
          telefono: formContactTelPers || null,
          fecha_nacimiento: null,
          direccion: null,
          sexo: null,
          estado: true,
        };
        nextDb.personas.push(newP);

        const nextContId =
          db.contactosEmpresariales.length > 0
            ? Math.max(
              ...db.contactosEmpresariales.map((c) => c.id_empresa_contacto)
            ) + 1
            : 1;
        const newC: EmpresaContacto = {
          id_empresa_contacto: nextContId,
          id_empresa: formContactEmpresaId,
          id_persona: nextPersId,
          cargo: formContactCargo,
          correo_empresa: formContactCorrEmp,
          telefono_empresa: formContactTelEmp || null,
          es_principal: formContactPrincipal,
          id_sucursal: formContactSucursalId === "null" ? null : Number(formContactSucursalId),
          estado: true,
        };
        nextDb.contactosEmpresariales.push(newC);

        logAudit(
          "DIRECTORIOS",
          "CREACION",
          `Se registró el contacto de empresa '${formContactNombre} ${formContactApellidoPat}' (Cargo: ${formContactCargo}, Documento: ${formContactNumDoc})`,
          nextDb
        );

        const personaResponse = await fetch(getApiUrl("save_persona"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_persona: 0,
            tipo_documento: formContactTipoDoc,
            numero_documento: formContactNumDoc || "",
            nombres: formContactNombre,
            apellido_paterno: formContactApellidoPat,
            apellido_materno: formContactApellidoMat || null,
            correo: formContactCorrEmp,
            telefono: formContactTelPers || null,
            id_rol: 4,
            estado: true,
            contrasena: "",
            bloqueado: false,
          }),
        });
        const personaData = await handleApiResponse(
          personaResponse,
          "Persona guardada ",
          "Error al guardar persona "
        );

        if (personaData.id_persona) {
          const contactoResponse = await fetch(getApiUrl("save_contacto"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id_empresa_contacto: 0,
              id_empresa: formContactEmpresaId,
              id_sucursal:
                formContactSucursalId === "null" ? null : Number(formContactSucursalId),
              id_persona: personaData.id_persona,
              cargo: formContactCargo,
              telefono_empresa: formContactTelEmp || "",
              correo_empresa: formContactCorrEmp,
              es_principal: formContactPrincipal,
              estado: true,
            }),
          });
          await handleApiResponse(
            contactoResponse,
            "Contacto guardado ",
            "Error al guardar contacto "
          );
        } else {
          throw new Error("No se recibió el ID de persona desde el servidor.");
        }
      } else {
        const targetContact = db.contactosEmpresariales.find(
          (c) => c.id_empresa_contacto === editId
        );
        if (!targetContact) {
          setNotification({ type: "warning", title: "Notificación", message: "Contacto no encontrado para editar." });
          return;
        }

        nextDb.contactosEmpresariales = db.contactosEmpresariales.map((c) => {
          if (c.id_empresa_contacto === editId) {
            return {
              ...c,
              id_empresa: formContactEmpresaId,
              cargo: formContactCargo,
              correo_empresa: formContactCorrEmp,
              telefono_empresa: formContactTelEmp || null,
              es_principal: formContactPrincipal,
              id_sucursal:
                formContactSucursalId === "null" ? null : Number(formContactSucursalId),
            };
          }
          return c;
        });

        nextDb.personas = db.personas.map((p) => {
          if (p.id_persona === targetContact.id_persona) {
            return {
              ...p,
              nombres: formContactNombre,
              apellido_paterno: formContactApellidoPat,
              apellido_materno: formContactApellidoMat || null,
              tipo_documento: formContactTipoDoc,
              numero_documento: formContactNumDoc,
              correo: formContactCorrEmp,
              telefono: formContactTelPers || null,
            };
          }
          return p;
        });

        logAudit(
          "DIRECTORIOS",
          "MODIFICACION",
          `Se modificó el contacto de empresa ID #${editId} ('${formContactNombre} ${formContactApellidoPat}')`,
          nextDb
        );

        await fetch(getApiUrl("save_persona"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_persona: targetContact.id_persona,
            tipo_documento: formContactTipoDoc,
            numero_documento: formContactNumDoc || "",
            nombres: formContactNombre,
            apellido_paterno: formContactApellidoPat,
            apellido_materno: formContactApellidoMat || null,
            correo: formContactCorrEmp,
            telefono: formContactTelPers || null,
            id_rol: 4,
            estado: true,
            contrasena: "",
            bloqueado: false,
          }),
        });

        const contactoResponse = await fetch(getApiUrl("save_contacto"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_empresa_contacto: editId,
            id_empresa: formContactEmpresaId,
            id_sucursal:
              formContactSucursalId === "null" ? null : Number(formContactSucursalId),
            id_persona: targetContact.id_persona,
            cargo: formContactCargo,
            telefono_empresa: formContactTelEmp || "",
            correo_empresa: formContactCorrEmp,
            es_principal: formContactPrincipal,
            estado: true,
          }),
        });
        await handleApiResponse(
          contactoResponse,
          "Contacto actualizado ",
          "Error al actualizar contacto "
        );
      }

      updateDb(nextDb);
      setNotification({
        type: "success", title: "Éxito", message:
          `✓ REGISTRO GUARDADO: El contacto '${formContactNombre} ${formContactApellidoPat}' ha sido guardado exitosamente.`
      });
      setShowEditModal(false);

    } catch (error: any) {
      console.error("Error en handleSaveContacto:", error);
      setNotification({
        type: "error", title: "Error", message:
          `❌ Error al guardar el contacto: ${error.message || "Intente nuevamente."}`
      });
      logTechnicalError(error, {
        url: getApiUrl("save_contacto"),
        sqlStatus: "SAVE_CONTACTO_ERROR",
        currentUser,
      });
    }
  };

  // ==================== DELETE ====================
  // ====================================================================
  // FIX v2.33 — handleBajaTrigger: Abre el modal "Dar de baja" con motivo.
  // NO elimina, solo marca como inactiva la entidad. Aplica a:
  // EMPRESAS, SUCURSALES, CONTACTOS. (Trabajadores = Personas con id_rol
  // operativo se gestionan desde UserManager.)
  // ====================================================================
  const handleBajaTrigger = (type: ModeTab, id: number) => {
    let nombre = "";
    if (type === "EMPRESAS") {
      const emp = db.empresas.find(e => e.id_empresa === id);
      nombre = emp ? (emp.nombre_comercial || emp.razon_social) : `Empresa #${id}`;
    } else if (type === "SUCURSALES") {
      const suc = db.sucursales.find(s => s.id_sucursal === id);
      nombre = suc ? suc.nombre : `Sucursal #${id}`;
    } else if (type === "CONTACTOS") {
      const cont = db.contactosEmpresariales.find(c => c.id_empresa_contacto === id);
      const per = cont ? db.personas.find(p => p.id_persona === cont.id_persona) : null;
      nombre = per ? `${per.nombres} ${per.apellido_paterno}` : `Contacto #${id}`;
    } else {
      // Tipos sin baja lógica (GRUPOS, RUBROS): usar eliminación directa
      handleDeleteTrigger(type, id);
      return;
    }
    setBajaTarget({ tipo: type, id, nombre });
    setBajaMotivo("");
    setShowBajaModal(true);
  };

  // ====================================================================
  // FIX v2.34 — confirmarBaja: ejecuta la baja lógica con motivo.
  // Persiste en BD via save_baja (tabla bajas_registro + activo=0 en entidad).
  // ====================================================================
  const confirmarBaja = async () => {
    if (!bajaTarget) return;
    if (!bajaMotivo.trim() || bajaMotivo.trim().length < 10) {
      setNotification({
        type: "warning",
        title: "Motivo obligatorio",
        message: "Debe ingresar el motivo de la baja (mínimo 10 caracteres) para el registro de auditoría.",
      });
      return;
    }

    // Mapear el tipo del frontend (EMPRESAS, SUCURSALES, CONTACTOS) al tipo del backend (singular)
    const tipoMap: Record<string, string> = {
      EMPRESAS: "EMPRESA",
      SUCURSALES: "SUCURSAL",
      CONTACTOS: "CONTACTO",
    };
    const tipo_entidad = tipoMap[bajaTarget.tipo] || bajaTarget.tipo;

    try {
      const response = await fetch(getApiUrl("save_baja"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo_entidad,
          id_entidad: bajaTarget.id,
          motivo: bajaMotivo.trim(),
          id_usuario: currentUser?.id_persona || 0,
        }),
      });
      const data = await response.json();
      if (data.status !== "success") {
        throw new Error(data.message || "Error al registrar la baja.");
      }

      // Actualizar estado local: remover la entidad de la lista activa
      const nuevaBaja = {
        id: Date.now(),
        tipo: bajaTarget.tipo,
        id_entidad: bajaTarget.id,
        nombre: bajaTarget.nombre,
        motivo: bajaMotivo.trim(),
        fecha: new Date().toISOString().replace("T", " ").substring(0, 19),
        usuario: currentUser?.correo || "sistema",
      };
      setBajasRegistradas(prev => [nuevaBaja, ...prev]);

      // FIX v2.37 — Baja en cascada cuando es EMPRESA.
      // Remover también sus sucursales y contactos de las listas activas locales.
      // El backend ya lo persistió en BD, esto es solo para reflejar el cambio al instante.
      let updatedDb = { ...db };
      let sucursalesBaja = 0;
      let contactosBaja = 0;
      if (bajaTarget.tipo === "EMPRESAS") {
        // Contar antes de filtrar
        sucursalesBaja = db.sucursales.filter(s => s.id_empresa === bajaTarget.id).length;
        contactosBaja = db.contactosEmpresariales.filter(c => c.id_empresa === bajaTarget.id).length;
        updatedDb.empresas = db.empresas.filter(e => e.id_empresa !== bajaTarget.id);
        updatedDb.sucursales = db.sucursales.filter(s => s.id_empresa !== bajaTarget.id);
        updatedDb.contactosEmpresariales = db.contactosEmpresariales.filter(c => c.id_empresa !== bajaTarget.id);
        // Registrar las bajas en cascada en bajasRegistradas local
        const ahora = new Date().toISOString().replace("T", " ").substring(0, 19);
        const cascadas = [
          ...db.sucursales.filter(s => s.id_empresa === bajaTarget.id).map(s => ({
            id: Date.now() + Math.random(),
            tipo: "SUCURSALES" as ModeTab,
            id_entidad: s.id_sucursal,
            nombre: s.nombre,
            motivo: bajaMotivo.trim(),
            fecha: ahora,
            usuario: currentUser?.correo || "sistema",
          })),
          ...db.contactosEmpresariales.filter(c => c.id_empresa === bajaTarget.id).map(c => {
            const per = db.personas.find(p => p.id_persona === c.id_persona);
            return {
              id: Date.now() + Math.random(),
              tipo: "CONTACTOS" as ModeTab,
              id_entidad: c.id_empresa_contacto,
              nombre: per ? `${per.nombres} ${per.apellido_paterno}` : `Contacto #${c.id_empresa_contacto}`,
              motivo: bajaMotivo.trim(),
              fecha: ahora,
              usuario: currentUser?.correo || "sistema",
            };
          }),
        ];
        if (cascadas.length > 0) {
          setBajasRegistradas(prev => [...cascadas, nuevaBaja, ...prev]);
        }
      } else if (bajaTarget.tipo === "SUCURSALES") {
        // FIX v2.37: Solo se da de baja la sucursal (sin cascada).
        updatedDb.sucursales = db.sucursales.filter(s => s.id_sucursal !== bajaTarget.id);
      } else if (bajaTarget.tipo === "CONTACTOS") {
        // FIX v2.37: Solo se da de baja el contacto (sin cascada).
        updatedDb.contactosEmpresariales = db.contactosEmpresariales.filter(c => c.id_empresa_contacto !== bajaTarget.id);
      }
      updateDb(updatedDb);

      logAudit(
        bajaTarget.tipo,
        "ELIMINACION",
        `Baja lógica de ${bajaTarget.tipo} '${bajaTarget.nombre}' (ID: #${bajaTarget.id}). Motivo: ${bajaMotivo.trim()}` +
        (bajaTarget.tipo === "EMPRESAS" && (sucursalesBaja > 0 || contactosBaja > 0)
          ? `. Cascada: ${sucursalesBaja} sucursal(es), ${contactosBaja} contacto(s).`
          : ""),
        db
      );
      setShowBajaModal(false);
      setBajaTarget(null);
      setBajaMotivo("");
      // FIX v2.37 — Notificación informativa sobre la cascada aplicada.
      const cascadaMsg = bajaTarget.tipo === "EMPRESAS" && (sucursalesBaja > 0 || contactosBaja > 0)
        ? `\n\n📋 Baja en cascada aplicada:\n• ${sucursalesBaja} sucursal(es) dada(s) de baja\n• ${contactosBaja} contacto(s) dado(s) de baja\n\nTodas las entidades reactivarán juntas desde la pestaña BAJAS.`
        : "";
      setNotification({
        type: "success",
        title: "Baja registrada",
        message: `${bajaTarget.tipo === "EMPRESAS" ? "Empresa" : bajaTarget.tipo === "SUCURSALES" ? "Sucursal" : "Contacto"} '${nuevaBaja.nombre}' dado de baja correctamente.\n\nMotivo: ${nuevaBaja.motivo}${cascadaMsg}`,
      });
    } catch (err: any) {
      console.error("Error en confirmarBaja:", err);
      setNotification({
        type: "error",
        title: "Error al dar de baja",
        message: err?.message || "No se pudo completar la operación. Intente nuevamente.",
      });
    }
  };

  // ====================================================================
  // FIX v2.41 — handleReactivar: llama al backend reactivar_baja y refresca.
  // Cuando es EMPRESA, el backend reactiva también sus sucursales y contactos.
  // ====================================================================
  const handleReactivar = async (baja: {
    id: number;
    tipo: ModeTab;
    id_entidad: number;
    nombre: string;
  }) => {
    // Mapear tipo del frontend (EMPRESAS, SUCURSALES, CONTACTOS) al backend (singular)
    const tipoMap: Record<string, string> = {
      EMPRESAS: "EMPRESA",
      SUCURSALES: "SUCURSAL",
      CONTACTOS: "CONTACTO",
    };
    const tipo_entidad = tipoMap[baja.tipo] || baja.tipo;

    if (!confirm(`¿Confirmar reactivación de ${baja.tipo === "EMPRESAS" ? "la empresa" : baja.tipo === "SUCURSALES" ? "la sucursal" : "el contacto"} '${baja.nombre}'?\n\n${baja.tipo === "EMPRESAS" ? "Se reactivarán también sus sucursales y contactos asociados." : "La entidad volverá a aparecer en su lista correspondiente."}`)) {
      return;
    }

    try {
      const response = await fetch(getApiUrl("reactivar_baja"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo_entidad,
          id_entidad: baja.id_entidad,
          id_usuario: currentUser?.id_persona || 0,
        }),
      });
      const data = await response.json();
      if (data.status !== "success") {
        throw new Error(data.message || "Error al reactivar.");
      }

      // Remover del estado local de bajas
      setBajasRegistradas(prev => prev.filter(x => !(x.tipo === baja.tipo && x.id_entidad === baja.id_entidad)));

      // Llamar sync_light para refrescar las listas activas desde la BD
      const cascadaMsg = baja.tipo === "EMPRESAS"
        ? "\n\n📋 Si la empresa tenía sucursales y contactos asociados, también han sido reactivados."
        : "";
      setNotification({
        type: "success",
        title: "Entidad reactivada",
        message: `'${baja.nombre}' ha sido reactivada correctamente. Ya aparece en la lista de activos.${cascadaMsg}`,
      });
    } catch (err: any) {
      console.error("Error en handleReactivar:", err);
      setNotification({
        type: "error",
        title: "Error al reactivar",
        message: err?.message || "No se pudo completar la reactivación. Intente nuevamente.",
      });
    }
  };

  // ====================================================================
  // FIX v2.33 — NotificationModal: reemplaza setNotification({type:"warning", title:"Notificación", message:}) por ventana modal.
  // ====================================================================
  const [notification, setNotification] = useState<{
    type: "success" | "error" | "warning" | "info";
    title: string;
    message: string;
  } | null>(null);

  const handleDeleteTrigger = async (type: ModeTab, id: number) => {
    setIntegrityError(null);

    if (type === "EMPRESAS") {
      const tickets = db.tickets.filter((t) => t.id_empresa === id);
      if (tickets.length > 0) {
        setIntegrityError(
          `No es posible eliminar la empresa '${empresa?.razon_social || ""}' (RUC: ${empresa?.ruc || ""}) debido a que tiene ${tickets.length} ticket(s) de soporte asociados.\n\nPara eliminar esta empresa, primero debe: \n1. Reabrir o eliminar los ${tickets.length} ticket(s) vinculados. \n2. Volver a intentar la eliminación.`
        );
        return;
      }
      if (db.sucursales.some((s) => s.id_empresa === id)) {
        const sucursalesDeLaEmpresa = db.sucursales.filter(s => s.id_empresa === id);
        setIntegrityError(
          `No es posible eliminar la empresa '${empresa?.razon_social || ""}' porque tiene ${sucursalesDeLaEmpresa.length} sucursal(es) registrada(s): ${sucursalesDeLaEmpresa.slice(0, 3).map(s => `"${s.nombre}"`).join(", ")}${sucursalesDeLaEmpresa.length > 3 ? ` y ${sucursalesDeLaEmpresa.length - 3} más` : ""}.\n\nPara eliminar la empresa: \n1. Elimine o reasigne cada sucursal desde la pestaña SUCURSALES. \n2. Vuelva a intentar la eliminación de la empresa.`
        );
        return;
      }
      if (!confirm("¿Confirmar eliminación de la empresa?")) return;
      try {
        const empresa = db.empresas.find((e) => e.id_empresa === id);
        const nextDb = {
          ...db,
          empresas: db.empresas.filter((e) => e.id_empresa !== id),
        };
        logAudit(
          "EMPRESAS",
          "ELIMINACION",
          `Se eliminó la empresa '${empresa?.razon_social || ""}' (ID: #${id})`,
          nextDb
        );
        updateDb(nextDb);
        const response = await fetch(getApiUrl("delete_empresa"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_empresa: id }),
        });
        await handleApiResponse(
          response,
          "Empresa eliminada de el sistema",
          "Error al eliminar empresa "
        );

      } catch (error: any) {
        console.error("Error en delete empresa:", error);
        setNotification({ type: "error", title: "Error", message: `❌ Error al eliminar empresa: ${error.message}` });
      }
    } else if (type === "GRUPOS") {
      const empresas = db.empresas.filter((e) => e.id_grupo === id);
      if (empresas.length > 0) {
        setIntegrityError(
          `No es posible eliminar el grupo '${grupo?.nombre || ""}' porque tiene ${empresas.length} empresa(s) asociada(s): ${empresas.slice(0, 3).map(e => `"${e.razon_social}"`).join(", ")}${empresas.length > 3 ? ` y ${empresas.length - 3} más` : ""}.\n\nPara eliminar el grupo: \n1. Reasigne cada empresa a otro grupo o déjela como "Independiente". \n2. Vuelva a intentar la eliminación.`
        );
        return;
      }
      if (!confirm("¿Borrar grupo empresarial de la base de datos?")) return;
      try {
        const grupo = db.gruposEmpresariales.find((g) => g.id_grupo === id);
        const nextDb = {
          ...db,
          gruposEmpresariales: db.gruposEmpresariales.filter(
            (g) => g.id_grupo !== id
          ),
        };
        logAudit(
          "DIRECTORIOS",
          "ELIMINACION",
          `Se eliminó el grupo empresarial '${grupo?.nombre || ""}' (ID: #${id})`,
          nextDb
        );
        updateDb(nextDb);
        const response = await fetch(getApiUrl("delete_grupo"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_grupo: id }),
        });
        await handleApiResponse(
          response,
          "Grupo eliminado de el sistema",
          "Error al eliminar grupo "
        );

      } catch (error: any) {
        setNotification({ type: "error", title: "Error", message: `❌ Error al eliminar grupo: ${error.message}` });
      }
    } else if (type === "RUBROS") {
      const empresas = db.empresas.filter((e) => e.id_rubro === id);
      if (empresas.length > 0) {
        setIntegrityError(
          `No es posible eliminar el rubro '${rubro?.nombre || ""}' porque está asignado a ${empresas.length} empresa(s): ${empresas.slice(0, 3).map(e => `"${e.razon_social}"`).join(", ")}${empresas.length > 3 ? ` y ${empresas.length - 3} más` : ""}.\n\nPara eliminar el rubro: \n1. Reasigne cada empresa a otro rubro. \n2. Vuelva a intentar la eliminación.`
        );
        return;
      }
      if (!confirm("¿Borrar rubro comercial de la base de datos?")) return;
      try {
        const rubro = db.rubros.find((r) => r.id_rubro === id);
        const nextDb = {
          ...db,
          rubros: db.rubros.filter((r) => r.id_rubro !== id),
        };
        logAudit(
          "DIRECTORIOS",
          "ELIMINACION",
          `Se eliminó el rubro de negocio '${rubro?.nombre || ""}' (ID: #${id})`,
          nextDb
        );
        updateDb(nextDb);
        const response = await fetch(getApiUrl("delete_rubro"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_rubro: id }),
        });
        await handleApiResponse(
          response,
          "Rubro eliminado de el sistema",
          "Error al eliminar rubro "
        );

      } catch (error: any) {
        setNotification({ type: "error", title: "Error", message: `❌ Error al eliminar rubro: ${error.message}` });
      }
    } else if (type === "SUCURSALES") {
      const tickets = db.tickets.filter((t) => t.id_sucursal === id);
      if (tickets.length > 0) {
        setIntegrityError(
          `No es posible eliminar la sucursal '${sucursal?.nombre || ""}' porque tiene ${tickets.length} ticket(s) de soporte asociados.\n\nPara eliminar la sucursal: \n1. Reasigne los tickets a otra sucursal o elimínelos. \n2. Vuelva a intentar la eliminación.`
        );
        return;
      }
      if (!confirm("¿Eliminar estación sucursal física?")) return;
      try {
        const sucursal = db.sucursales.find((s) => s.id_sucursal === id);
        const nextDb = {
          ...db,
          sucursales: db.sucursales.filter((s) => s.id_sucursal !== id),
        };
        logAudit(
          "SUCURSALES",
          "ELIMINACION",
          `Se eliminó la sucursal '${sucursal?.nombre || ""}' (ID: #${id})`,
          nextDb
        );
        updateDb(nextDb);
        const response = await fetch(getApiUrl("delete_sucursal"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_sucursal: id }),
        });
        await handleApiResponse(
          response,
          "Sucursal eliminada de el sistema",
          "Error al eliminar sucursal "
        );

      } catch (error: any) {
        setNotification({ type: "error", title: "Error", message: `❌ Error al eliminar sucursal: ${error.message}` });
      }
    } else if (type === "CONTACTOS") {
      const tickets = db.tickets.filter((t) => t.id_empresa_contacto === id);
      if (tickets.length > 0) {
        setIntegrityError(
          `No es posible eliminar el contacto '${persona?.nombres || ""} ${persona?.apellido_paterno || ""}' porque tiene ${tickets.length} ticket(s) de soporte asociados.\n\nPara eliminar el contacto: \n1. Reasigne los tickets a otro contacto. \n2. Vuelva a intentar la eliminación.`
        );
        return;
      }
      if (
        !confirm(
          "¿Desea eliminar la vinculación de este contacto de la base de datos?"
        )
      )
        return;
      try {
        const contacto = db.contactosEmpresariales.find(
          (c) => c.id_empresa_contacto === id
        );
        const persona = contacto
          ? db.personas.find((p) => p.id_persona === contacto.id_persona)
          : null;
        const nextDb = {
          ...db,
          contactosEmpresariales: db.contactosEmpresariales.filter(
            (c) => c.id_empresa_contacto !== id
          ),
          personas: contacto
            ? db.personas.filter((p) => p.id_persona !== contacto.id_persona)
            : db.personas,
        };
        logAudit(
          "DIRECTORIOS",
          "ELIMINACION",
          `Se eliminó el contacto de empresa '${persona?.nombres || ""}' (ID: #${id})`,
          nextDb
        );
        updateDb(nextDb);
        const response = await fetch(getApiUrl("delete_contacto"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_empresa_contacto: id }),
        });
        await handleApiResponse(
          response,
          "Contacto eliminado de el sistema",
          "Error al eliminar contacto "
        );

      } catch (error: any) {
        setNotification({ type: "error", title: "Error", message: `❌ Error al eliminar contacto: ${error.message}` });
      }
    }
  };

  // ==================== EDITAR ====================
  const handleEditTrigger = (type: ModeTab, id: number) => {
    setEditType(type);
    setEditId(id);
    if (type === "EMPRESAS") {
      const empresa = db.empresas.find((e) => e.id_empresa === id);
      if (empresa) {
        setFormRuc(empresa.ruc);
        setFormRazonSocial(empresa.razon_social);
        setFormNombreComercial(empresa.nombre_comercial || "");
        setFormTelefono(empresa.telefono || "");
        setFormCorreo(empresa.correo);
        setFormRubroId(empresa.id_rubro);
        setFormGrupoId(empresa.id_grupo === null ? "null" : empresa.id_grupo);
        const ubicacion = db.ubicaciones.find(
          (u) => u.id_ubicacion === empresa.id_ubicacion
        );
        if (ubicacion) {
          setFormDireccion(ubicacion.direccion);
          setFormReferencia(ubicacion.referencia || "");
          setFormDivisionId(ubicacion.id_division);
        }
      }
    } else if (type === "GRUPOS") {
      const grupo = db.gruposEmpresariales.find((g) => g.id_grupo === id);
      if (grupo) {
        setFormGrupoNombre(grupo.nombre);
        setFormGrupoDesc(grupo.descripcion || "");
      }
    } else if (type === "RUBROS") {
      const rubro = db.rubros.find((r) => r.id_rubro === id);
      if (rubro) setFormRubroNombre(rubro.nombre);
    } else if (type === "SUCURSALES") {
      const sucursal = db.sucursales.find((s) => s.id_sucursal === id);
      if (sucursal) {
        setFormSucursalNombre(sucursal.nombre);
        setFormSucursalEmpresa(sucursal.id_empresa);
        setFormSucursalTel(sucursal.telefono || "");
        setFormSucursalPrincipal(sucursal.es_principal);
        const ubicacion = db.ubicaciones.find(
          (u) => u.id_ubicacion === sucursal.id_ubicacion
        );
        if (ubicacion) {
          setFormDireccion(ubicacion.direccion);
          setFormReferencia(ubicacion.referencia || "");
          setFormDivisionId(ubicacion.id_division);
        }
      }
    } else if (type === "CONTACTOS") {
      const contacto = db.contactosEmpresariales.find(
        (c) => c.id_empresa_contacto === id
      );
      if (contacto) {
        const persona = db.personas.find(
          (p) => p.id_persona === contacto.id_persona
        );
        if (persona) {
          setFormContactNombre(persona.nombres);
          setFormContactApellidoPat(persona.apellido_paterno);
          setFormContactApellidoMat(persona.apellido_materno || "");
          setFormContactTipoDoc(persona.tipo_documento);
          setFormContactNumDoc(persona.numero_documento);
          setFormContactCorreoPers(persona.correo || "");
          setFormContactTelPers(persona.telefono || "");
        }
        setFormContactEmpresaId(contacto.id_empresa);
        setFormContactSucursalId(
          contacto.id_sucursal === null ? "null" : contacto.id_sucursal
        );
        setFormContactCargo(contacto.cargo || "");
        setFormContactTelEmp(contacto.telefono_empresa || "");
        setFormContactCorrEmp(contacto.correo_empresa || "");
        setFormContactPrincipal(contacto.es_principal);
      }
    }
    setShowEditModal(true);
  };

  // ==================== HELPER RESOLVERS ====================
  const resolveRubroName = (rubroId: number) => {
    return (
      db.rubros.find((r) => r.id_rubro === rubroId)?.nombre || `Rubro #${rubroId}`
    );
  };
  const resolveGroupName = (groupId: number | null) => {
    if (groupId === null) return "Independiente";
    return (
      db.gruposEmpresariales.find((g) => g.id_grupo === groupId)?.nombre ||
      `Grupo #${groupId}`
    );
  };
  const resolveEmpresaName = (empresaId: number) => {
    const e = db.empresas.find((emp) => emp.id_empresa === empresaId);
    return e ? e.nombre_comercial || e.razon_social : `Empresa #${empresaId}`;
  };
  const resolveUbiAddress = (ubiId: number) => {
    const u = db.ubicaciones.find((ub) => ub.id_ubicacion === ubiId);
    if (!u) return "Sede remota / Sin dirección";
    const div = db.divisionesGeograficas.find(
      (dg) => dg.id_division === u.id_division
    );
    return `${u.direccion}, ${div ? div.nombre : "Lima"}`;
  };
  const resolveSucursalName = (sucursalId: number | null) => {
    if (sucursalId === null) return "Sede Matriz (Principal)";
    const s = db.sucursales.find((suc) => suc.id_sucursal === sucursalId);
    return s ? s.nombre : `Sucursal #${sucursalId}`;
  };

  // ==================== FILTRADO Y PAGINACIÓN ====================
  // FIX v2.36: Usar debouncedSearchQuery para evitar refilter en cada tecla.
  // FIX v2.116: Agregar filtro por grupo económico + paginación de 20 en 20.
  const filteredDataList = useMemo(() => {
    const q = String(debouncedSearchQuery ?? "").toLowerCase();
    const matchesSearch = (value: unknown) =>
      String(value ?? "").toLowerCase().includes(q);

    if (activeSubTab === "EMPRESAS") {
      return db.empresas.filter(
        (e) =>
          (matchesSearch(e.ruc) ||
            matchesSearch(e.razon_social) ||
            matchesSearch(e.nombre_comercial)) &&
          // FIX v2.116 — Filtro por grupo económico
          (filterGrupoId === "TODOS" || String(e.id_grupo) === filterGrupoId)
      );
    } else if (activeSubTab === "GRUPOS") {
      return db.gruposEmpresariales.filter(
        (g) =>
          matchesSearch(g.nombre) || matchesSearch(g.descripcion)
      );
    } else if (activeSubTab === "RUBROS") {
      return db.rubros.filter((r) => matchesSearch(r.nombre));
    } else if (activeSubTab === "SUCURSALES") {
      return db.sucursales.filter(
        (s) =>
          matchesSearch(s.nombre) || matchesSearch(resolveEmpresaName(s.id_empresa))
      );
    } else {
      return db.contactosEmpresariales.filter((c) => {
        const p = db.personas.find((per) => per.id_persona === c.id_persona);
        const empName = String(resolveEmpresaName(c.id_empresa) ?? "").toLowerCase();
        const pos = String(c.cargo ?? "").toLowerCase();
        const contactName = p
          ? `${p.nombres ?? ""} ${p.apellido_paterno ?? ""} ${p.apellido_materno ?? ""}`.toLowerCase()
          : "";
        const docNum = String(p?.numero_documento ?? "").toLowerCase();
        const email = String(c.correo_empresa ?? "").toLowerCase();
        return (
          contactName.includes(q) ||
          docNum.includes(q) ||
          empName.includes(q) ||
          pos.includes(q) ||
          email.includes(q)
        );
      });
    }
  }, [db, activeSubTab, debouncedSearchQuery]);

  useEffect(() => setCurrentPage(1), [activeSubTab, debouncedSearchQuery]);

  const paginatedDataList = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredDataList.slice(startIndex, startIndex + pageSize);
  }, [filteredDataList, currentPage, pageSize]);

  const totalPages = useMemo(
    () => Math.ceil(filteredDataList.length / pageSize) || 1,
    [filteredDataList, pageSize]
  );

  const resolveCreateLabel = () => {
    if (activeSubTab === "EMPRESAS") return "Empresa";
    if (activeSubTab === "GRUPOS") return "Grupo";
    if (activeSubTab === "RUBROS") return "Rubro";
    if (activeSubTab === "SUCURSALES") return "Sucursal";
    if (activeSubTab === "BAJAS") return "";
    if (activeSubTab === "REPORTE") return "";
    return "Contacto";
  };

  // FIX v2.8: Exportar empresas con todos sus datos (RUC, contactos, sedes, rubros) a CSV y PDF.
  const handleExportCompaniesCsv = () => {
    const rows: string[][] = [["RUC", "Razón Social", "Nombre Comercial", "Rubro", "Grupo", "Teléfono", "Correo", "Sucursales", "Contactos"]];
    db.empresas.forEach(emp => {
      const rubro = db.rubros.find(r => r.id_rubro === emp.id_rubro);
      const grupo = emp.id_grupo ? db.gruposEmpresariales.find(g => g.id_grupo === emp.id_grupo) : null;
      const sucursales = db.sucursales.filter(s => s.id_empresa === emp.id_empresa);
      const sucursalNombres = sucursales.map(s => s.nombre).join("; ");
      const contactos = db.contactosEmpresariales.filter(c => c.id_empresa === emp.id_empresa);
      const contactoNombres = contactos.map(c => {
        const p = db.personas.find(per => per.id_persona === c.id_persona);
        return p ? `${p.nombres} ${p.apellido_paterno}` : `#${c.id_empresa_contacto}`;
      }).join("; ");
      rows.push([
        emp.ruc || "",
        emp.razon_social || "",
        emp.nombre_comercial || "",
        rubro ? rubro.nombre : "",
        grupo ? grupo.nombre : "",
        emp.telefono || "",
        emp.correo || "",
        sucursalNombres,
        contactoNombres,
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `empresas_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportCompaniesPdf = () => {
    const today = new Date().toLocaleString('es-PE');

    // FIX v2.10: Reporte completo con 3 secciones:
    // 1) Resumen de rubros por empresa (tabla agrupada)
    // 2) Directorio de empresas con TODOS los contactos
    // 3) Directorio de empresas con TODAS las sucursales

    // Sección 1: Rubros por empresa
    const rubrosHtml = db.rubros.map(rubro => {
      const empresasDelRubro = db.empresas.filter(e => e.id_rubro === rubro.id_rubro);
      if (empresasDelRubro.length === 0) return '';
      const filas = empresasDelRubro.map(e => `
        <tr>
          <td style="padding:4px 8px; border:1px solid #ddd;">${e.ruc || "—"}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${e.nombre_comercial || e.razon_social}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${e.telefono || "—"}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${e.correo || "—"}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${db.sucursales.filter(s => s.id_empresa === e.id_empresa).length}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${db.contactosEmpresariales.filter(c => c.id_empresa === e.id_empresa).length}</td>
        </tr>`).join('');
      return `
        <h3 style="font-size:13px; margin:12px 0 4px 0;">${rubro.nombre} (${empresasDelRubro.length} empresa${empresasDelRubro.length !== 1 ? 's' : ''})</h3>
        <table style="width:100%; font-size:10px; border-collapse:collapse; margin-bottom:8px;">
          <thead><tr style="background:#333; color:#fff;">
            <th style="padding:4px 8px; border:1px solid #555; text-align:left;">RUC</th>
            <th style="padding:4px 8px; border:1px solid #555; text-align:left;">Empresa</th>
            <th style="padding:4px 8px; border:1px solid #555;">Teléfono</th>
            <th style="padding:4px 8px; border:1px solid #555;">Correo</th>
            <th style="padding:4px 8px; border:1px solid #555;">Sucursales</th>
            <th style="padding:4px 8px; border:1px solid #555;">Contactos</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>`;
    }).join('');

    // Sección 2: Contactos por empresa
    const contactosHtml = db.empresas.map(emp => {
      const contactos = db.contactosEmpresariales.filter(c => c.id_empresa === emp.id_empresa);
      if (contactos.length === 0) return '';
      const filas = contactos.map(c => {
        const p = db.personas.find(per => per.id_persona === c.id_persona);
        const nombre = p ? `${p.nombres} ${p.apellido_paterno}` : `#${c.id_empresa_contacto}`;
        const doc = p ? `${p.tipo_documento}: ${p.numero_documento}` : "—";
        const telPersonal = p ? (p.telefono || "—") : "—";
        return `<tr>
          <td style="padding:4px 8px; border:1px solid #ddd;">${nombre}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${doc}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${c.cargo || "—"}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${c.telefono_empresa || telPersonal}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${c.correo_empresa || (p ? p.correo : "—")}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${c.es_principal ? "Sí" : "No"}</td>
        </tr>`;
      }).join('');
      return `
        <h3 style="font-size:12px; margin:10px 0 4px 0;">${emp.nombre_comercial || emp.razon_social} — RUC: ${emp.ruc}</h3>
        <table style="width:100%; font-size:10px; border-collapse:collapse; margin-bottom:8px;">
          <thead><tr style="background:#333; color:#fff;">
            <th style="padding:4px 8px; border:1px solid #555; text-align:left;">Nombre</th>
            <th style="padding:4px 8px; border:1px solid #555;">Documento</th>
            <th style="padding:4px 8px; border:1px solid #555;">Cargo</th>
            <th style="padding:4px 8px; border:1px solid #555;">Teléfono</th>
            <th style="padding:4px 8px; border:1px solid #555;">Correo</th>
            <th style="padding:4px 8px; border:1px solid #555;">Principal</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>`;
    }).join('');

    // Sección 3: Sucursales por empresa
    const sucursalesHtml = db.empresas.map(emp => {
      const sucursales = db.sucursales.filter(s => s.id_empresa === emp.id_empresa);
      if (sucursales.length === 0) return '';
      const filas = sucursales.map(s => {
        const ubi = db.ubicaciones.find(u => u.id_ubicacion === s.id_ubicacion);
        const div = ubi ? db.divisionesGeograficas.find(dg => dg.id_division === ubi.id_division) : null;
        const direccion = ubi ? ubi.direccion : "—";
        const distrito = div ? div.nombre : "—";
        return `<tr>
          <td style="padding:4px 8px; border:1px solid #ddd;">${s.nombre}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${direccion}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${distrito}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${s.telefono || "—"}</td>
          <td style="padding:4px 8px; border:1px solid #ddd;">${s.es_principal ? "Sí" : "No"}</td>
        </tr>`;
      }).join('');
      return `
        <h3 style="font-size:12px; margin:10px 0 4px 0;">${emp.nombre_comercial || emp.razon_social} — RUC: ${emp.ruc}</h3>
        <table style="width:100%; font-size:10px; border-collapse:collapse; margin-bottom:8px;">
          <thead><tr style="background:#333; color:#fff;">
            <th style="padding:4px 8px; border:1px solid #555; text-align:left;">Sucursal</th>
            <th style="padding:4px 8px; border:1px solid #555;">Dirección</th>
            <th style="padding:4px 8px; border:1px solid #555;">Distrito</th>
            <th style="padding:4px 8px; border:1px solid #555;">Teléfono</th>
            <th style="padding:4px 8px; border:1px solid #555;">Principal</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Reporte Completo de Empresas</title><style>
      body{font-family:'Segoe UI',Arial,sans-serif;padding:24px;max-width:1000px;margin:0 auto;color:#141414;}
      h1{font-size:20px;margin:0 0 4px 0;}
      h2{font-size:16px;margin:24px 0 8px 0;border-bottom:2px solid #141414;padding-bottom:4px;text-transform:uppercase;}
      .meta{font-size:11px;color:#555;margin-bottom:16px;}
      .footer{margin-top:32px;padding-top:12px;border-top:1px solid #ccc;font-size:10px;color:#888;text-align:center;}
      tr:nth-child(even) td{background:#f9f9f9;}
      @media print{body{padding:0;max-width:none;}}
    </style></head><body>
      <h1>Reporte Completo de Empresas</h1>
      <div class="meta">Generado el ${today} · ${db.empresas.length} empresas · ${db.contactosEmpresariales.length} contactos · ${db.sucursales.length} sucursales · ${db.rubros.length} rubros</div>

      <h2>1. Empresas Agrupadas por Rubro</h2>
      ${rubrosHtml || '<p style="font-size:11px;color:#888;">No hay empresas registradas.</p>'}

      <h2>2. Directorio de Contactos por Empresa</h2>
      ${contactosHtml || '<p style="font-size:11px;color:#888;">No hay contactos registrados.</p>'}

      <h2>3. Directorio de Sucursales por Empresa</h2>
      ${sucursalesHtml || '<p style="font-size:11px;color:#888;">No hay sucursales registradas.</p>'}

      <div class="footer">Documento generado por ERP SOPORTE</div>
      <script>window.onload=function(){window.print();};</script>
    </body></html>`;
    const w = window.open('', '_blank', 'width=1000,height=700');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    else { setNotification({ type: "warning", title: "Notificación", message: "El navegador bloqueó la ventana. Habilite las ventanas emergentes." }); }
  };

  // ==================== RENDER ====================
  return (
    <div className="space-y-6 text-[#141414]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b-2 border-[#141414] pb-4">
        <div>
          <h2 className="text-2xl font-serif italic text-[#141414]">
            Empresas
          </h2>
          <p className="text-[10px] uppercase font-bold tracking-widest text-[#141414]/70 mt-1">
            Gestión de empresas, grupos, rubros, sedes y contactos
          </p>
        </div>

        {/* Botones compactos (solo en pestaña REGISTROS, no en BAJAS ni REPORTES) */}
        {activeMainTab === "REGISTROS" && activeSubTab !== "BAJAS" && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* FIX v2.95 — Botón Actualizar para refrescar datos desde el backend. */}
            <button
              type="button"
              onClick={() => {
                if (onSync) onSync();
              }}
              className="flex items-center gap-1 border border-[#141414] bg-white text-[#141414] px-2 py-1 text-[9px] font-mono font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
              title="Actualizar datos desde el servidor"
              aria-label="Actualizar"
            >
              ↻ Actualizar
            </button>
            <button
              type="button"
              onClick={handleExportCompaniesCsv}
              className="flex items-center gap-1 border border-[#141414] bg-white text-[#141414] px-2 py-1 text-[9px] font-mono font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
              title="Exportar a CSV"
              aria-label="Exportar a CSV"
            >
              <FileText className="w-3 h-3" /> CSV
            </button>
            <button
              type="button"
              onClick={handleExportCompaniesPdf}
              className="flex items-center gap-1 border border-[#141414] bg-[#141414] text-[#E4E3E0] px-2 py-1 text-[9px] font-mono font-bold uppercase hover:bg-[#141414]/90 transition-colors cursor-pointer"
              title="Exportar a PDF"
              aria-label="Exportar a PDF"
            >
              <FileDown className="w-3 h-3" /> PDF
            </button>
            <button
              type="button"
              onClick={() => {
                setEditId(null);
                resetAllFormStates();
                setEditType(activeSubTab);
                setShowEditModal(true);
              }}
              className="flex items-center gap-1 bg-[#141414] text-[#E4E3E0] border border-[#141414] px-2 py-1 text-[9px] font-mono font-bold uppercase hover:bg-[#141414]/90 transition-colors cursor-pointer"
              aria-label={`Crear ${resolveCreateLabel()}`}
            >
              <Plus className="w-3 h-3" /> Crear {resolveCreateLabel()}
            </button>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* FIX v2.32 — DOS PESTAÑAS PRINCIPALES                         */}
      {/* 1) REGISTROS: Altas, bajas, modificaciones, eliminaciones    */}
      {/* 2) DASHBOARD: Visualizaciones + reportes                     */}
      {/* ============================================================ */}
      <div className="flex border-2 border-[#141414] bg-[#141414]">
        {([
          { key: "REGISTROS", label: "REGISTROS · Altas / Bajas / Modificaciones" },
          { key: "DASHBOARD", label: "DASHBOARD · Reportes y Visualizaciones" },
        ] as const).map((tab) => {
          const isActive = activeMainTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveMainTab(tab.key);
                setSearchQuery("");
                setIntegrityError(null);
              }}
              className={`flex-1 px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest transition-colors cursor-pointer ${isActive
                ? "bg-[#E4E3E0] text-[#141414] font-bold"
                : "bg-[#141414] text-[#E4E3E0]/70 hover:text-[#E4E3E0] hover:bg-[#141414]/80"
                }`}
              aria-pressed={isActive}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ============================================================ */}
      {/* PESTAÑA PRINCIPAL: REGISTROS                                  */}
      {/* ============================================================ */}
      {activeMainTab === "REGISTROS" && (
        <>
          {/* Sub-pestañas de REGISTROS */}
          <div className="flex border-b border-[#141414] overflow-x-auto bg-[#E4E3E0]" role="tablist">
            {([
              { key: "EMPRESAS", label: "Empresas" },
              { key: "GRUPOS", label: "Grupos" },
              { key: "RUBROS", label: "Rubros" },
              { key: "SUCURSALES", label: "Sedes" },
              { key: "CONTACTOS", label: "Contactos" },
              { key: "BAJAS", label: "Bajas" },
            ] as const).map((tab) => {
              const isActive = activeSubTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    setActiveSubTab(tab.key as ModeTab);
                    setSearchQuery("");
                    setIntegrityError(null);
                  }}
                  className={`px-4 py-2 border-b-2 text-[10px] font-mono uppercase transition-colors whitespace-nowrap cursor-pointer ${isActive
                    ? "border-[#141414] text-[#141414] font-bold bg-white"
                    : "border-transparent text-[#141414]/60 hover:text-[#141414] hover:bg-white/40"
                    }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Integrity Error */}
          {/* FIX v2.87 — Modal de error de integridad referencial (antes era un panel inline). */}
          {integrityError && (
            <div className="fixed inset-0 bg-[#141414]/70 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
              <div className="bg-[#E4E3E0] border-4 border-red-700 shadow-[8px_8px_0px_0px_rgba(185,28,28,1)] max-w-lg w-full rounded-none" role="dialog" aria-modal="true">
                <div className="p-4 bg-red-700 text-white flex justify-between items-center border-b-2 border-red-800">
                  <h3 className="text-xs font-mono uppercase font-bold tracking-widest flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    No se puede eliminar
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIntegrityError(null)}
                    className="text-white hover:text-red-200 font-mono font-bold text-sm cursor-pointer"
                    aria-label="Cerrar"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-5 space-y-3">
                  <h4 className="text-sm font-serif italic font-bold text-red-950">
                    Restricción de integridad referencial
                  </h4>
                  <p className="text-xs font-mono text-[#141414]/90 whitespace-pre-line leading-relaxed">
                    {integrityError}
                  </p>
                  <div className="bg-amber-50 border border-amber-400 p-2.5 text-[10px] font-mono text-amber-900 leading-relaxed">
                    💡 <strong>Sugerencia:</strong> Para completar esta acción, primero debe desvincular o eliminar los registros dependientes que se mencionan arriba. Una vez que no haya dependencias, podrá repetir esta operación con éxito.
                  </div>
                  <div className="flex justify-end border-t border-red-700 pt-3">
                    <button
                      type="button"
                      onClick={() => setIntegrityError(null)}
                      className="px-4 py-1.5 text-xs bg-red-700 text-white border border-red-700 hover:bg-red-800 transition-colors font-mono font-bold uppercase cursor-pointer"
                    >
                      Entendido
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Search (no en BAJAS — ahí usamos su propia lista) */}
          {activeSubTab !== "BAJAS" && (
            <div className="flex items-center gap-2">
              {/* FIX v2.117 — Buscador de grupo económico en lista de empresas. */}
              {activeSubTab === "EMPRESAS" && (
                <select
                  value={filterGrupoId}
                  onChange={(e) => { setFilterGrupoId(e.target.value); setCurrentPage(1); }}
                  className="text-xs bg-white border border-[#141414] px-2 py-2 text-[#141414] font-mono font-bold focus:outline-none cursor-pointer"
                  aria-label="Filtrar por grupo económico"
                >
                  <option value="TODOS">Todos los grupos</option>
                  {db.gruposEmpresariales.map(g => (
                    <option key={g.id_grupo} value={String(g.id_grupo)}>{g.nombre}</option>
                  ))}
                </select>
              )}
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 opacity-50" />
                </span>
                <input
                  type="text"
                  className="text-xs bg-transparent border border-[#141414] pl-9 pr-3 py-2 text-[#141414] font-mono focus:bg-white focus:outline-none"
                  placeholder={`Filtrar ${activeSubTab.toLowerCase()}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Filtrar listado"
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* ============================================================ */}
      {/* PESTAÑA PRINCIPAL: DASHBOARD                                  */}
      {/* ============================================================ */}
      {activeMainTab === "DASHBOARD" && (
        <>
          <DashboardEmpresarial
            db={db}
            onIrAReporte={() => {
              setActiveSubTab("REPORTE");
              setSearchQuery("");
              setIntegrityError(null);
            }}
          />
        </>
      )}

      {/* ============================================================ */}
      {/* TABLAS CON ANCHOS FIJOS Y TRUNCAMIENTO                       */}
      {/* FIX v2.32: Solo se muestran en MainTab=REGISTROS (no BAJAS) */}
      {/* ============================================================ */}
      {activeMainTab === "REGISTROS" && activeSubTab !== "BAJAS" && (
        <>
          <div className="border border-[#141414] bg-white/20 overflow-x-auto rounded-none">
            {/* EMPRESAS */}
            {activeSubTab === "EMPRESAS" && (
              <table className="w-full table-fixed text-left border-collapse text-xs font-mono text-[#141414]">
                <thead>
                  <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase tracking-wider font-mono border-b border-[#141414]">
                    <th className="py-3 px-4 w-[100px] min-w-[100px]">RUC</th>
                    <th className="py-3 px-4 w-[200px] min-w-[200px]">Razón Social y Comercial</th>
                    <th className="py-3 px-4 w-[180px] min-w-[180px]">Contacto y Correo</th>
                    <th className="py-3 px-4 w-[120px] min-w-[120px]">Rubro Comercial</th>
                    <th className="py-3 px-4 w-[180px] min-w-[180px]">Corporativo / Sede principal</th>
                    <th className="py-3 px-4 w-[120px] min-w-[120px] text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/15">
                  {paginatedDataList.map((emp) => (
                    <tr key={emp.id_empresa} className="hover:bg-[#141414]/5 transition-colors">
                      <td className="py-4 px-4 font-mono font-bold text-[#141414] text-[13px] truncate" title={emp.ruc}>
                        {emp.ruc}
                      </td>
                      <td className="py-4 px-4 truncate" title={emp.razon_social}>
                        <span className="font-bold text-[#141414] block uppercase text-[12px] truncate">
                          {emp.razon_social}
                        </span>
                        {emp.nombre_comercial && (
                          <span className="text-[10px] border border-[#141414]/20 bg-[#141414]/5 text-[#141414]/80 px-1.5 py-0.5 font-bold uppercase mt-1 inline-block truncate max-w-full" title={emp.nombre_comercial}>
                            {emp.nombre_comercial}
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 truncate" title={emp.correo}>
                        <span className="text-[#141414] block flex items-center gap-1 truncate">
                          <Mail className="w-3 h-3 text-slate-500 shrink-0" /> {emp.correo}
                        </span>
                        {emp.telefono && (
                          <span className="text-[#141414]/70 text-[11px] block mt-1 flex items-center gap-1 truncate" title={emp.telefono}>
                            <Phone className="w-3 h-3 text-slate-500 shrink-0" /> {emp.telefono}
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 truncate" title={resolveRubroName(emp.id_rubro)}>
                        <span className="px-2 py-0.5 bg-white border border-[#141414]/30 text-[#141414] font-bold text-[10.5px] truncate block">
                          {resolveRubroName(emp.id_rubro).toUpperCase()}
                        </span>
                      </td>
                      <td className="py-4 px-4 truncate" title={resolveGroupName(emp.id_grupo)}>
                        <span className="text-[#141414] font-bold block text-[11px] truncate">
                          🏢 {resolveGroupName(emp.id_grupo).toUpperCase()}
                        </span>
                        <span className="text-[#141414]/65 text-[10px] font-mono block mt-1 truncate" title={resolveUbiAddress(emp.id_ubicacion)}>
                          📍 {resolveUbiAddress(emp.id_ubicacion).toUpperCase()}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditTrigger("EMPRESAS", emp.id_empresa)}
                            className="p-1.5 border border-[#141414] bg-white hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
                            title="Editar empresa"
                            aria-label="Editar empresa"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBajaTrigger("EMPRESAS", emp.id_empresa)}
                            className="p-1.5 border border-[#141414] bg-white hover:bg-amber-600 hover:text-white transition-colors cursor-pointer"
                            title="Dar de baja (con motivo)"
                            aria-label="Dar de baja empresa"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTrigger("EMPRESAS", emp.id_empresa)}
                            className="p-1.5 border border-[#141414] bg-white hover:bg-red-900 hover:text-[#E4E3E0] transition-colors cursor-pointer"
                            title="Eliminar permanentemente"
                            aria-label="Eliminar empresa"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* GRUPOS */}
            {activeSubTab === "GRUPOS" && (
              <table className="w-full table-fixed text-left border-collapse text-xs font-mono text-[#141414]">
                <thead>
                  <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase tracking-wider font-mono border-b border-[#141414]">
                    <th className="py-3 px-4 w-[120px] min-w-[120px]">Grupo ID (PK)</th>
                    <th className="py-3 px-4 w-[200px] min-w-[200px]">Denominación del Conglomerado</th>
                    <th className="py-3 px-4 w-auto min-w-[200px]">Resumen y Descripción de Línea</th>
                    <th className="py-3 px-4 w-[90px] min-w-[90px] text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/15">
                  {paginatedDataList.map((grupo) => (
                    <tr key={grupo.id_grupo} className="hover:bg-[#141414]/5 transition-colors">
                      <td className="py-4 px-4 font-mono font-bold text-[#141414] truncate" title={`GRUPO #${grupo.id_grupo}`}>
                        GRUPO #{grupo.id_grupo}
                      </td>
                      <td className="py-4 px-4 font-bold uppercase truncate" title={grupo.nombre}>
                        {grupo.nombre}
                      </td>
                      <td className="py-4 px-4 max-w-lg leading-relaxed text-[#141414]/85 font-sans truncate" title={grupo.descripcion || ""}>
                        {grupo.descripcion || <span className="text-slate-400 italic">No contiene descripción asociada</span>}
                      </td>
                      <td className="py-4 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditTrigger("GRUPOS", grupo.id_grupo)}
                            className="p-1.5 border border-[#141414] bg-white hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTrigger("GRUPOS", grupo.id_grupo)}
                            className="p-1.5 border border-[#141414] bg-white hover:bg-red-900 hover:text-[#E4E3E0] transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* RUBROS */}
            {activeSubTab === "RUBROS" && (
              <table className="w-full table-fixed text-left border-collapse text-xs font-mono text-[#141414]">
                <thead>
                  <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase tracking-wider font-mono border-b border-[#141414]">
                    <th className="py-3 px-4 w-[120px] min-w-[120px]">Rubro ID (PK)</th>
                    <th className="py-3 px-4 w-auto min-w-[200px]">Actividad o Giro de Negocio</th>
                    <th className="py-3 px-4 w-[90px] min-w-[90px] text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/15">
                  {paginatedDataList.map((rubro) => (
                    <tr key={rubro.id_rubro} className="hover:bg-[#141414]/5 transition-colors">
                      <td className="py-4 px-4 font-mono font-bold text-[#141414] truncate" title={`RUBRO #${rubro.id_rubro}`}>
                        RUBRO #{rubro.id_rubro}
                      </td>
                      <td className="py-4 px-4 font-bold uppercase text-[12px] truncate" title={rubro.nombre}>
                        {rubro.nombre}
                      </td>
                      <td className="py-4 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditTrigger("RUBROS", rubro.id_rubro)}
                            className="p-1.5 border border-[#141414] bg-white hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTrigger("RUBROS", rubro.id_rubro)}
                            className="p-1.5 border border-[#141414] bg-white hover:bg-red-900 hover:text-[#E4E3E0] transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* SUCURSALES */}
            {activeSubTab === "SUCURSALES" && (
              <table className="w-full table-fixed text-left border-collapse text-xs font-mono text-[#141414]">
                <thead>
                  <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase tracking-wider font-mono border-b border-[#141414]">
                    <th className="py-3 px-4 w-[100px] min-w-[100px]">Sucursal ID (PK)</th>
                    <th className="py-3 px-4 w-[180px] min-w-[180px]">Empresa Propietaria (FK)</th>
                    <th className="py-3 px-4 w-[180px] min-w-[180px]">Denominación del Establecimiento</th>
                    <th className="py-3 px-4 w-auto min-w-[200px]">Dirección Física Registrada</th>
                    <th className="py-3 px-4 w-[120px] min-w-[120px]">Jerarquía Principal</th>
                    <th className="py-3 px-4 w-[120px] min-w-[120px] text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/15">
                  {paginatedDataList.map((suc) => (
                    <tr key={suc.id_sucursal} className="hover:bg-[#141414]/5 transition-colors">
                      <td className="py-4 px-4 font-mono font-bold text-[#141414] truncate" title={`SUCURSAL #${suc.id_sucursal}`}>
                        SUCURSAL {suc.nombre}
                      </td>
                      <td className="py-4 px-4 font-bold uppercase truncate" title={resolveEmpresaName(suc.id_empresa)}>
                        🏢 {resolveEmpresaName(suc.id_empresa)}
                      </td>
                      <td className="py-4 px-4 font-bold text-[#141414] uppercase truncate" title={suc.nombre}>
                        {suc.nombre}
                      </td>
                      <td className="py-4 px-4 text-[#141414]/75 truncate" title={resolveUbiAddress(suc.id_ubicacion)}>
                        📍 {resolveUbiAddress(suc.id_ubicacion).toUpperCase()}
                      </td>
                      <td className="py-4 px-4">
                        {suc.es_principal ? (
                          <span className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-700 text-indigo-900 text-[10px] font-bold uppercase whitespace-nowrap">
                            Sede Matriz
                          </span>
                        ) : (
                          <span className="text-[#141414]/50 text-[10px] uppercase font-bold whitespace-nowrap">
                            Sucursal Física
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditTrigger("SUCURSALES", suc.id_sucursal)}
                            className="p-1.5 border border-[#141414] bg-white hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
                            title="Editar sucursal"
                            aria-label="Editar sucursal"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBajaTrigger("SUCURSALES", suc.id_sucursal)}
                            className="p-1.5 border border-[#141414] bg-white hover:bg-amber-600 hover:text-white transition-colors cursor-pointer"
                            title="Dar de baja (con motivo)"
                            aria-label="Dar de baja sucursal"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTrigger("SUCURSALES", suc.id_sucursal)}
                            className="p-1.5 border border-[#141414] bg-white hover:bg-red-900 hover:text-[#E4E3E0] transition-colors cursor-pointer"
                            title="Eliminar permanentemente"
                            aria-label="Eliminar sucursal"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* CONTACTOS */}
            {activeSubTab === "CONTACTOS" && (
              <table className="w-full table-fixed text-left border-collapse text-xs font-mono text-[#141414]">
                <thead>
                  <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase tracking-wider font-mono border-b border-[#141414]">
                    <th className="py-3 px-4 w-[100px] min-w-[100px]">Contacto (PK)</th>
                    <th className="py-3 px-4 w-[180px] min-w-[180px]">Empresa (FK) / Sucursal</th>
                    <th className="py-3 px-4 w-[200px] min-w-[200px]">Información de Contacto</th>
                    <th className="py-3 px-4 w-auto min-w-[200px]">Cargo / Email Corporativo</th>
                    <th className="py-3 px-4 w-[100px] min-w-[100px]">Jerarquía Principal</th>
                    <th className="py-3 px-4 w-[120px] min-w-[120px] text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/15">
                  {paginatedDataList.map((cont) => {
                    const persona = db.personas.find(
                      (p) => p.id_persona === cont.id_persona
                    );
                    return (
                      <tr key={cont.id_empresa_contacto} className="hover:bg-[#141414]/5 transition-colors">
                        <td className="py-4 px-4 font-mono font-bold text-[#141414] truncate" title={`CNT_${cont.id_empresa_contacto}`}>
                          CNT_{cont.id_empresa_contacto}
                        </td>
                        <td className="py-4 px-4 truncate" title={resolveEmpresaName(cont.id_empresa)}>
                          <span className="font-bold uppercase text-[11.5px] block truncate">
                            🏢 {resolveEmpresaName(cont.id_empresa)}
                          </span>
                          {cont.id_sucursal && (
                            <div className="text-[10px] text-indigo-800 font-mono mt-0.5 uppercase truncate" title={db.sucursales.find(s => s.id_sucursal === cont.id_sucursal)?.nombre || `Sucursal #${cont.id_sucursal}`}>
                              📍 Sede: {db.sucursales.find(s => s.id_sucursal === cont.id_sucursal)?.nombre || `Sucursal #${cont.id_sucursal}`}
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-4 truncate" title={persona ? `${persona.nombres} ${persona.apellido_paterno} ${persona.apellido_materno || ""}` : ""}>
                          {persona ? (
                            <>
                              <span className="font-bold text-[#141414] block uppercase text-[12px] truncate">
                                {persona.nombres} {persona.apellido_paterno} {persona.apellido_materno || ""}
                              </span>
                              <span className="text-[10.5px] text-[#141414]/70 block mt-0.5 uppercase truncate" title={`${persona.tipo_documento}: ${persona.numero_documento}`}>
                                {persona.tipo_documento}: {persona.numero_documento}
                              </span>
                              {persona.telefono && (
                                <span className="text-[10px] text-[#141414]/60 block mt-0.5 truncate" title={persona.telefono}>
                                  Pers. Tel: {persona.telefono}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-red-500 italic lowercase truncate">
                              [No se halló relación en tabla personas]
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4 truncate">
                          <span className="px-1.5 py-0.5 bg-zinc-200 border border-[#141414]/30 text-[#141414] font-bold text-[9.5px] uppercase block w-fit mb-1 truncate" title={cont.cargo || "OPERADOR"}>
                            {cont.cargo || "OPERADOR"}
                          </span>
                          <span className="text-[#141414] block flex items-center gap-1 truncate" title={cont.correo_empresa}>
                            <Mail className="w-3 h-3 text-slate-500 shrink-0" /> {cont.correo_empresa}
                          </span>
                          {cont.telefono_empresa && (
                            <span className="text-[#141414]/70 text-[10.5px] block mt-0.5 flex items-center gap-1 truncate" title={cont.telefono_empresa}>
                              <Phone className="w-3 h-3 text-slate-500 shrink-0" /> {cont.telefono_empresa}
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4">
                          {cont.es_principal ? (
                            <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-700 text-emerald-900 text-[10px] font-bold uppercase whitespace-nowrap">
                              ⚙ Principal
                            </span>
                          ) : (
                            <span className="text-[#141414]/50 text-[10px] uppercase font-bold whitespace-nowrap">
                              Contacto Auxiliar
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex gap-1">
                            <button
                              type="button"
                              onClick={() => handleEditTrigger("CONTACTOS", cont.id_empresa_contacto)}
                              className="p-1.5 border border-[#141414] bg-white hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer"
                              title="Editar contacto"
                              aria-label="Editar contacto"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleBajaTrigger("CONTACTOS", cont.id_empresa_contacto)}
                              className="p-1.5 border border-[#141414] bg-white hover:bg-amber-600 hover:text-white transition-colors cursor-pointer"
                              title="Dar de baja (con motivo)"
                              aria-label="Dar de baja contacto"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTrigger("CONTACTOS", cont.id_empresa_contacto)}
                              className="p-1.5 border border-[#141414] bg-white hover:bg-red-900 hover:text-[#E4E3E0] transition-colors cursor-pointer"
                              title="Eliminar permanentemente"
                              aria-label="Eliminar contacto"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {paginatedDataList.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-zinc-500 text-[11px]">
                        {debouncedSearchQuery
                          ? "No se encontraron contactos con ese filtro."
                          : "No hay contactos activos para mostrar."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Paginación */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-[#141414] bg-[#E4E3E0]/30 font-mono text-[11px] no-print">
            <div className="text-slate-700 font-medium">
              Mostrando registros{" "}
              <span className="font-bold">
                {filteredDataList.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}
              </span>{" "}
              al{" "}
              <span className="font-bold">
                {Math.min(currentPage * pageSize, filteredDataList.length)}
              </span>{" "}
              de un total de{" "}
              <span className="font-bold">{filteredDataList.length}</span>{" "}
              {activeSubTab.toLowerCase()}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(1)}
                className="px-2.5 py-1.5 border border-[#141414] bg-white hover:bg-zinc-100 font-bold uppercase transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                « Primero
              </button>
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1.5 border border-[#141414] bg-white hover:bg-zinc-100 font-bold uppercase transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ‹ Ant
              </button>
              <span className="px-3 py-1.5 bg-[#141414] text-white font-bold border border-[#141414]">
                Página {currentPage} de {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1.5 border border-[#141414] bg-white hover:bg-zinc-100 font-bold uppercase transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Sig ›
              </button>
              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(totalPages)}
                className="px-2.5 py-1.5 border border-[#141414] bg-white hover:bg-zinc-100 font-bold uppercase transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Último »
              </button>
            </div>
          </div>
        </>
      )}

      {/* ============================================================ */}
      {/* FIX v2.12: PESTAÑA REPORTE GENERAL — filtrable por rubro, empresa, etc. */}
      {/* FIX v2.32: Solo visible cuando MainTab = DASHBOARD            */}
      {/* ============================================================ */}
      {activeMainTab === "DASHBOARD" && (
        <ReporteEmpresarial db={db} />
      )}

      {/* ============================================================ */}
      {/* FIX v2.32 — TABLA DE EMPRESAS/ENTIDADES DADAS DE BAJA        */}
      {/* ============================================================ */}
      {activeMainTab === "REGISTROS" && activeSubTab === "BAJAS" && (
        <div className="border border-[#141414] bg-white/20 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono text-[#141414]" aria-label="Listado de bajas">
            <thead>
              <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase tracking-wider">
                <th scope="col" className="py-3 px-4 w-[100px]">Fecha</th>
                <th scope="col" className="py-3 px-4 w-[100px]">Tipo</th>
                <th scope="col" className="py-3 px-4 w-[260px]">Entidad</th>
                <th scope="col" className="py-3 px-4">Motivo</th>
                <th scope="col" className="py-3 px-4 w-[140px]">Usuario</th>
                <th scope="col" className="py-3 px-4 w-[90px] text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/15">
              {bajasUnificadas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#141414]/50 italic uppercase text-[11px]">
                    No hay entidades dadas de baja. Para dar de baja una empresa, sucursal o contacto,
                    use el botón "Dar de baja" en su pestaña correspondiente.
                  </td>
                </tr>
              ) : (
                bajasUnificadas.map((b) => (
                  <tr key={b.id} className="hover:bg-[#141414]/5">
                    <td className="py-3 px-4 text-[11px]">{b.fecha}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 bg-red-900 text-white text-[10px] uppercase font-bold">
                        {b.tipo}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold uppercase truncate" title={b.nombre}>
                      {b.nombre}
                    </td>
                    <td className="py-3 px-4 text-[#141414]/80 truncate" title={b.motivo}>
                      {b.motivo}
                    </td>
                    <td className="py-3 px-4 text-[10px] text-[#141414]/70">{b.usuario}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleReactivar(b)}
                        className="px-2 py-1 border border-[#141414] bg-white hover:bg-emerald-900 hover:text-white text-[9px] font-bold uppercase cursor-pointer transition-colors"
                        title="Reactivar entidad"
                        aria-label={`Reactivar ${b.nombre}`}
                      >
                        Reactivar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ============================================================ */}
      {/* FIX v2.32 — PIE DE PÁGINA COMÚN A TODAS LAS PESTAÑAS        */}
      {/* ============================================================ */}
      <footer className="border-t-2 border-[#141414] mt-8 pt-3 pb-2 px-4 bg-[#141414]/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[9px] font-mono uppercase tracking-widest text-[#141414]/60">
        <span>
          ERP SOPORTE · v2.32 · Módulo Empresas
        </span>
        <span className="hidden sm:inline">
          Pestaña: {activeMainTab}{activeMainTab === "REGISTROS" ? ` › ${activeSubTab}` : " › Dashboard + Reporte"}
        </span>
        <span>
          © {new Date().getFullYear()} ERP SOPORTE
        </span>
      </footer>

      {/* ============================================================ */}
      {/* MODAL DE EDICIÓN / CREACIÓN */}
      {/* ============================================================ */}
      {showEditModal && editType && (
        <div className="fixed inset-0 bg-[#141414]/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#E4E3E0] border-4 border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-xl w-full max-h-[90vh] overflow-y-auto rounded-none">
            <div className="p-4 bg-[#141414] border-b-2 border-[#141414] flex justify-between items-center text-[#E4E3E0]">
              <h3 className="text-xs font-mono uppercase font-bold text-white tracking-widest">
                {editId === null
                  ? `REGISTRAR NUEVO : [ ${editType} ]`
                  : `MODIFICAR EXISTENTE : [ ${editType} ]`}
              </h3>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="text-white hover:text-red-400 font-mono font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-5 text-xs">
              {/* Formulario EMPRESA */}
              {editType === "EMPRESAS" && (
                <div className="space-y-4 border border-[#141414] p-4 bg-white rounded-none">
                  <span className="font-bold text-[11px] font-mono uppercase text-[#141414] block tracking-wide border-b border-[#141414]/20 pb-1">
                    IDENTIDAD DE EMPRESA
                  </span>
                  {/* FIX v2.81 — Panel de contexto para edición de empresa. */}
                  {editId !== null && (() => {
                    const empActual = db.empresas.find(e => e.id_empresa === editId);
                    if (!empActual) return null;
                    const sucursalesEmpresa = db.sucursales.filter(s => s.id_empresa === editId).length;
                    const contactosEmpresa = db.contactosEmpresariales.filter(c => c.id_empresa === editId).length;
                    const ticketsEmpresa = db.tickets.filter(t => t.id_empresa === editId).length;
                    return (
                      <div className="grid grid-cols-4 gap-2 bg-[#141414]/5 border border-[#141414]/20 p-2 text-[9px] font-mono uppercase">
                        <div>
                          <div className="text-zinc-500">Empresa</div>
                          <div className="font-bold text-[#141414]">{empActual.nombre_comercial || empActual.razon_social}</div>
                        </div>
                        <div>
                          <div className="text-zinc-500">Sedes</div>
                          <div className="font-bold text-[#141414]">{sucursalesEmpresa}</div>
                        </div>
                        <div>
                          <div className="text-zinc-500">Contactos</div>
                          <div className="font-bold text-[#141414]">{contactosEmpresa}</div>
                        </div>
                        <div>
                          <div className="text-zinc-500">Tickets</div>
                          <div className="font-bold text-[#141414]">{ticketsEmpresa}</div>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                        RUC Fiscal <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        required
                        minLength={11}
                        maxLength={11}
                        pattern="[0-9]{11}"
                        value={formRuc}
                        onChange={(e) => {
                          const sanitized = e.target.value.replace(/[^0-9]/g, "").slice(0, 11);
                          setFormRuc(sanitized);
                        }}
                        onKeyDown={(e) => {
                          const allowed = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
                          if (allowed.includes(e.key)) return;
                          if (e.ctrlKey || e.metaKey) return;
                          if (!/^[0-9]$/.test(e.key)) { e.preventDefault(); }
                        }}
                        onPaste={(e) => {
                          e.preventDefault();
                          const text = (e.clipboardData || (window as any).clipboardData).getData('text');
                          const sanitized = text.replace(/[^0-9]/g, "").slice(0, 11);
                          setFormRuc(sanitized);
                        }}
                        placeholder="20102030401 (11 dígitos)"
                        title="El RUC debe tener exactamente 11 dígitos numéricos"
                        className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none disabled:bg-zinc-100 disabled:text-[#141414]/60"
                      />
                      {formRuc.length > 0 && formRuc.length < 11 && (
                        <p className="text-[9px] text-amber-700 font-mono mt-0.5">⚠ Faltan {11 - formRuc.length} dígito(s)</p>
                      )}
                      {formRuc.length === 11 && (
                        <p className="text-[9px] text-emerald-700 font-mono mt-0.5">✓ RUC completo</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                        Nombre Comercial
                      </label>
                      <input
                        type="text"
                        value={formNombreComercial}
                        onChange={(e) => setFormNombreComercial(e.target.value)}
                        placeholder="Interbank"
                        className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                      Razón Social Legal <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formRazonSocial}
                      onChange={(e) => setFormRazonSocial(e.target.value)}
                      placeholder="Empresa Internacional de Servicios S.A."
                      className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                        Teléfono
                      </label>
                      <input
                        type="text"
                        value={formTelefono}
                        onChange={(e) => setFormTelefono(e.target.value)}
                        placeholder="+51 1 3110200"
                        className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                        Correo Electrónico <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        required
                        value={formCorreo}
                        onChange={(e) => setFormCorreo(e.target.value)}
                        placeholder="admin@empresa.com"
                        className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pb-2">
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                        Rubro de Comercio
                      </label>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          readOnly
                          className="w-full bg-zinc-100 border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414]/70 focus:outline-none rounded-none"
                          value={
                            db.rubros.find((r) => r.id_rubro === formRubroId)
                              ?.nombre || ""
                          }
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setRubroSearchQuery("");
                            setShowRubroSearchModal(true);
                          }}
                          className="px-3 py-2 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] text-[11px] font-bold font-mono uppercase border border-[#141414] transition-all flex items-center justify-center gap-1 cursor-pointer rounded-none"
                        >
                          Buscar
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                        Grupo Empresarial
                      </label>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          readOnly
                          className="w-full bg-zinc-100 border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414]/70 focus:outline-none rounded-none"
                          value={
                            formGrupoId === "null"
                              ? "NINGUNO / INDEPENDIENTE"
                              : db.gruposEmpresariales.find(
                                (g) => g.id_grupo === formGrupoId
                              )?.nombre || ""
                          }
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setGrupoSearchQuery("");
                            setShowGrupoSearchModal(true);
                          }}
                          className="px-3 py-2 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] text-[11px] font-bold font-mono uppercase border border-[#141414] transition-all flex items-center justify-center gap-1 cursor-pointer rounded-none"
                        >
                          Buscar
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3 pt-3 border-t border-[#141414]/20">
                    <span className="font-bold text-[11px] font-mono uppercase text-[#141414] block tracking-wide pb-1">
                      📍 UBICACIÓN E INTEGRIDAD GEOGRÁFICA
                    </span>
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                        Dirección Detallada <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formDireccion}
                        onChange={(e) => setFormDireccion(e.target.value)}
                        placeholder="Av. Javier Prado Este Nro 1250"
                        className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Referencia
                        </label>
                        <input
                          type="text"
                          value={formReferencia}
                          onChange={(e) => setFormReferencia(e.target.value)}
                          placeholder="Frente a Clínica Sanna"
                          className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Ubicación Geográfica Validada{" "}
                          <span className="text-red-500">*</span>
                        </label>
                        <div className="flex gap-1">
                          <div className="flex-1 bg-zinc-100 border border-[#141414] px-2 py-2 min-h-[36px] flex items-center">
                            <span className="text-[10px] font-bold text-zinc-700 font-mono tracking-tight leading-none uppercase">
                              {getFullHierarchyBreadcrumb(formDivisionId)}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setGeoModalTarget("EMPRESA");
                              setGeoSelectedCountryId(
                                getCountryOfDivision(formDivisionId) || 1
                              );
                              setGeoSelections({});
                              setShowGeoSelector(true);
                            }}
                            className="px-3 py-2 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] text-[11px] font-bold font-mono uppercase border border-[#141414] transition-all flex items-center justify-center gap-1 cursor-pointer rounded-none"
                          >
                            <Search className="w-3.5 h-3.5" /> BUSCAR
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* FIX v2.65 — Checkboxes para decidir creación automática de sede */}
                    {editId === null && (
                      <div className="border-2 border-[#141414] bg-[#141414]/5 p-3 space-y-3">
                        <span className="font-bold text-[10px] font-mono uppercase text-[#141414] block tracking-wide border-b border-[#141414]/20 pb-1">
                          🏢 CONFIGURACIÓN DE SEDES
                        </span>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formTieneSedes}
                            onChange={(e) => setFormTieneSedes(e.target.checked)}
                            className="mt-0.5 w-4 h-4 border-2 border-[#141414] cursor-pointer"
                            aria-label="La empresa tiene sedes"
                          />
                          <span className="text-[11px] font-bold uppercase tracking-wide text-[#141414]">
                            ¿Esta empresa tiene sedes/sucursales?
                          </span>
                        </label>
                        {formTieneSedes && (
                          <div className="ml-6 space-y-2">
                            <label className="flex items-start gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={formEsSedePrincipal}
                                onChange={(e) => setFormEsSedePrincipal(e.target.checked)}
                                className="mt-0.5 w-4 h-4 border-2 border-[#141414] cursor-pointer"
                                aria-label="Es sede principal"
                              />
                              <span className="text-[11px] font-bold uppercase tracking-wide text-[#141414]">
                                ¿La dirección registrada es la sede principal (matriz)?
                              </span>
                            </label>
                            <p className="text-[10px] font-mono text-[#141414]/60 ml-6">
                              {formEsSedePrincipal
                                ? '✓ Se creará automáticamente una sucursal "Sede Principal - {empresa}" con la dirección indicada, marcada como matriz.'
                                : '✓ Se creará automáticamente una sucursal "Sede - {empresa}" con la dirección indicada, NO marcada como matriz.'}
                            </p>
                          </div>
                        )}
                        {!formTieneSedes && (
                          <p className="text-[10px] font-mono text-[#141414]/60 ml-6">
                            ✓ No se creará ninguna sede automáticamente. Podrá agregar sedes después desde la pestaña "Sedes".
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Formulario GRUPO */}
              {editType === "GRUPOS" && (
                <div className="space-y-4 border border-[#141414] p-4 bg-white rounded-none">
                  <span className="font-bold text-[11px] font-mono uppercase text-[#141414] block tracking-wide border-b border-[#141414]/20 pb-1">
                    GRUPO ECONÓMICO
                  </span>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                      Nombre del Conglomerado <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formGrupoNombre}
                      onChange={(e) => setFormGrupoNombre(e.target.value)}
                      placeholder="Grupo Romero, Grupo Aval"
                      className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                      Resumen / Descripción Corporativa
                    </label>
                    <textarea
                      rows={4}
                      value={formGrupoDesc}
                      onChange={(e) => setFormGrupoDesc(e.target.value)}
                      placeholder="Indique líneas de inversión, países con presencia y principales directores..."
                      className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                    />
                  </div>
                </div>
              )}

              {/* Formulario RUBRO */}
              {editType === "RUBROS" && (
                <div className="space-y-4 border border-[#141414] p-4 bg-white rounded-none">
                  <span className="font-bold text-[11px] font-mono uppercase text-[#141414] block tracking-wide border-b border-[#141414]/20 pb-1">
                    RUBRO Y GIRO
                  </span>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                      Giro de Actividad Comercial{" "}
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formRubroNombre}
                      onChange={(e) => setFormRubroNombre(e.target.value)}
                      placeholder="Banca, Retail, Minería, Telecomunicaciones..."
                      className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                    />
                  </div>
                </div>
              )}

              {/* Formulario SUCURSAL */}
              {editType === "SUCURSALES" && (
                <div className="space-y-4 border border-[#141414] p-4 bg-white rounded-none">
                  <span className="font-bold text-[11px] font-mono uppercase text-[#141414] block tracking-wide border-b border-[#141414]/20 pb-1">
                    ESTABLECIMIENTO
                  </span>
                  {/* FIX v2.81 — Panel de contexto que aprovecha el espacio vacío:
                      muestra info útil de la sede que se está editando. */}
                  {editId !== null && (() => {
                    const sucActual = db.sucursales.find(s => s.id_sucursal === editId);
                    if (!sucActual) return null;
                    const empresaActual = db.empresas.find(e => e.id_empresa === sucActual.id_empresa);
                    const ticketsAsociados = db.tickets.filter(t => t.id_sucursal === editId).length;
                    const ubicacionActual = db.ubicaciones.find(u => u.id_ubicacion === sucActual.id_ubicacion);
                    return (
                      <div className="grid grid-cols-3 gap-2 bg-[#141414]/5 border border-[#141414]/20 p-2 text-[9px] font-mono uppercase">
                        <div>
                          <div className="text-zinc-500">Sede</div>
                          <div className="font-bold text-[#141414]">{sucActual.nombre}</div>
                        </div>
                        <div>
                          <div className="text-zinc-500">Tickets</div>
                          <div className="font-bold text-[#141414]">{ticketsAsociados} asociado(s)</div>
                        </div>
                        <div>
                          <div className="text-zinc-500">¿Matriz?</div>
                          <div className="font-bold text-[#141414]">{sucActual.es_principal ? "Sí" : "No"}</div>
                        </div>
                        {empresaActual && (
                          <div className="col-span-3 border-t border-[#141414]/15 pt-1.5">
                            <div className="text-zinc-500">Empresa Actual</div>
                            <div className="font-bold text-[#141414]">
                              {empresaActual.nombre_comercial || empresaActual.razon_social} · RUC {empresaActual.ruc}
                            </div>
                          </div>
                        )}
                        {ubicacionActual && (
                          <div className="col-span-3">
                            <div className="text-zinc-500">Ubicación Actual</div>
                            <div className="font-bold text-[#141414] truncate">
                              {ubicacionActual.direccion}{ubicacionActual.referencia ? ` — ${ubicacionActual.referencia}` : ""}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                      Denominación del Establecimiento{" "}
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formSucursalNombre}
                      onChange={(e) => setFormSucursalNombre(e.target.value)}
                      placeholder="Sede Central - Surco, Sucursal Trujillo"
                      className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                        Empresa Propietaria (FK)
                      </label>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          readOnly
                          className="w-full bg-zinc-100 border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414]/70 focus:outline-none rounded-none"
                          value={
                            db.empresas.find(
                              (e) => e.id_empresa === formSucursalEmpresa
                            )?.nombre_comercial ||
                            db.empresas.find(
                              (e) => e.id_empresa === formSucursalEmpresa
                            )?.razon_social ||
                            ""
                          }
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setEmpresaSearchTarget("SUCURSAL");
                            setEmpresaSearchQuery("");
                            setShowEmpresaSearchModal(true);
                          }}
                          className="px-3 py-2 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] text-[11px] font-bold font-mono uppercase border border-[#141414] transition-all flex items-center justify-center gap-1 cursor-pointer rounded-none"
                        >
                          Buscar
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                        Teléfono de Sede
                      </label>
                      <input
                        type="text"
                        value={formSucursalTel}
                        onChange={(e) => setFormSucursalTel(e.target.value)}
                        placeholder="+51 1 6100250"
                        className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border border-[#141414] p-3 bg-zinc-50 rounded-none">
                    <input
                      type="checkbox"
                      id="formSucursalPrincipalCheck"
                      checked={formSucursalPrincipal}
                      onChange={(e) => setFormSucursalPrincipal(e.target.checked)}
                      className="w-4 h-4 text-black focus:ring-0 cursor-pointer rounded-none"
                    />
                    <label
                      htmlFor="formSucursalPrincipalCheck"
                      className="font-mono text-[10px] font-bold uppercase text-zinc-700 cursor-pointer select-none"
                    >
                      ¿Es la Sucursal / Sede Matriz Principal de la Empresa?
                    </label>
                  </div>
                  <div className="space-y-3 pt-3 border-t border-[#141414]/20">
                    <span className="font-bold text-[11px] font-mono uppercase text-[#141414] block tracking-wide pb-1">
                      📍 BINDING GEOGRÁFICO DE SUCURSAL
                    </span>
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                        Dirección Sucursal <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formDireccion}
                        onChange={(e) => setFormDireccion(e.target.value)}
                        placeholder="Pasaje Las Margaritas 123"
                        className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Referencia
                        </label>
                        <input
                          type="text"
                          value={formReferencia}
                          onChange={(e) => setFormReferencia(e.target.value)}
                          placeholder="A espaldas del Banco de la Alianza"
                          className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Ubicación Geográfica Validada{" "}
                          <span className="text-red-500">*</span>
                        </label>
                        <div className="flex gap-1">
                          <div className="flex-1 bg-zinc-100 border border-[#141414] px-2 py-2 min-h-[36px] flex items-center">
                            <span className="text-[10px] font-bold text-zinc-700 font-mono tracking-tight leading-none uppercase">
                              {getFullHierarchyBreadcrumb(formDivisionId)}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setGeoModalTarget("SUCURSAL");
                              setGeoSelectedCountryId(
                                getCountryOfDivision(formDivisionId) || 1
                              );
                              setGeoSelections({});
                              setShowGeoSelector(true);
                            }}
                            className="px-3 py-2 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] text-[11px] font-bold font-mono uppercase border border-[#141414] transition-all flex items-center justify-center gap-1 cursor-pointer rounded-none"
                          >
                            <Search className="w-3.5 h-3.5" /> BUSCAR
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Formulario CONTACTO */}
              {editType === "CONTACTOS" && (
                <div className="space-y-4">
                  {/* FIX v2.81 — Panel de contexto para edición de contacto. */}
                  {editId !== null && (() => {
                    const contActual = db.contactosEmpresariales.find(c => c.id_empresa_contacto === editId);
                    if (!contActual) return null;
                    const empActual = db.empresas.find(e => e.id_empresa === contActual.id_empresa);
                    const sucActual = contActual.id_sucursal ? db.sucursales.find(s => s.id_sucursal === contActual.id_sucursal) : null;
                    const ticketsContacto = db.tickets.filter(t => t.id_empresa_contacto === editId).length;
                    return (
                      <div className="grid grid-cols-4 gap-2 bg-[#141414]/5 border border-[#141414]/20 p-2 text-[9px] font-mono uppercase">
                        <div>
                          <div className="text-zinc-500">Contacto</div>
                          <div className="font-bold text-[#141414]">{contActual.cargo || "Contacto"}</div>
                        </div>
                        <div>
                          <div className="text-zinc-500">Tickets</div>
                          <div className="font-bold text-[#141414]">{ticketsContacto}</div>
                        </div>
                        <div>
                          <div className="text-zinc-500">¿Principal?</div>
                          <div className="font-bold text-[#141414]">{contActual.es_principal ? "Sí" : "No"}</div>
                        </div>
                        <div>
                          <div className="text-zinc-500">Estado</div>
                          <div className="font-bold text-[#141414]">{contActual.estado ? "Activo" : "Inactivo"}</div>
                        </div>
                        {empActual && (
                          <div className="col-span-4 border-t border-[#141414]/15 pt-1.5">
                            <div className="text-zinc-500">Empresa Actual</div>
                            <div className="font-bold text-[#141414]">
                              {empActual.nombre_comercial || empActual.razon_social} · RUC {empActual.ruc}
                              {sucActual ? ` · Sede: ${sucActual.nombre}` : " · Sin sede específica"}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <div className="space-y-4 border border-[#141414] p-4 bg-white rounded-none">
                    <span className="font-bold text-[11px] font-mono uppercase text-[#141414] block tracking-wide border-b border-[#141414]/20 pb-1">
                      👤 DATOS PERSONALES IDENTITARIOS
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Nombres <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={formContactNombre}
                          onChange={(e) => setFormContactNombre(e.target.value)}
                          placeholder="Alberto"
                          className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Ap. Paterno <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={formContactApellidoPat}
                          onChange={(e) =>
                            setFormContactApellidoPat(e.target.value)
                          }
                          placeholder="López"
                          className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Ap. Materno
                        </label>
                        <input
                          type="text"
                          value={formContactApellidoMat}
                          onChange={(e) =>
                            setFormContactApellidoMat(e.target.value)
                          }
                          placeholder="Quispe"
                          className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                            Tipo Doc
                          </label>
                          <select
                            value={formContactTipoDoc}
                            onChange={(e) =>
                              setFormContactTipoDoc(e.target.value)
                            }
                            className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none font-bold"
                          >
                            <option value="DNI">DNI</option>
                            <option value="RUC">RUC</option>
                            <option value="CE">C.E.</option>
                            <option value="PASAPORTE">PAS.</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                            Num Doc
                          </label>
                          <input
                            type="text"
                            value={formContactNumDoc}
                            onChange={(e) =>
                              setFormContactNumDoc(e.target.value)
                            }
                            placeholder="71020304 (opcional)"
                            className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none font-bold"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Correo Personal
                        </label>
                        <input
                          type="email"
                          value={formContactCorreoPers}
                          onChange={(e) =>
                            setFormContactCorreoPers(e.target.value)
                          }
                          placeholder="alberto@gmail.com"
                          className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Teléfono Personal
                        </label>
                        <input
                          type="text"
                          value={formContactTelPers}
                          onChange={(e) =>
                            setFormContactTelPers(e.target.value)
                          }
                          placeholder="999888777"
                          className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 border border-[#141414] p-4 bg-white rounded-none">
                    <span className="font-bold text-[11px] font-mono uppercase text-[#141414] block tracking-wide border-b border-[#141414]/20 pb-1">
                      💼 CARGO Y VÍNCULO CORPORATIVO
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Empresa Habilitante <span className="text-red-500">*</span>
                        </label>
                        <div className="flex gap-1">
                          <input
                            type="text"
                            readOnly
                            className="w-full bg-zinc-100 border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414]/70 focus:outline-none rounded-none font-bold"
                            value={
                              db.empresas.find(
                                (e) => e.id_empresa === formContactEmpresaId
                              )?.nombre_comercial ||
                              db.empresas.find(
                                (e) => e.id_empresa === formContactEmpresaId
                              )?.razon_social ||
                              ""
                            }
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setEmpresaSearchTarget("CONTACTO");
                              setEmpresaSearchQuery("");
                              setShowEmpresaSearchModal(true);
                            }}
                            className="px-3 py-2 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] text-[11px] font-bold font-mono uppercase border border-[#141414] transition-all flex items-center justify-center gap-1 cursor-pointer rounded-none"
                          >
                            Buscar
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Asignar Sede / Sucursal
                        </label>
                        <div className="flex gap-1">
                          <input
                            type="text"
                            readOnly
                            className="w-full bg-zinc-100 border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414]/70 focus:outline-none rounded-none font-bold"
                            value={resolveSucursalName(
                              formContactSucursalId === "null"
                                ? null
                                : Number(formContactSucursalId)
                            )}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setSucursalSearchQuery("");
                              setShowSucursalSearchModal(true);
                            }}
                            className="px-3 py-2 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] text-[11px] font-bold font-mono uppercase border border-[#141414] transition-all flex items-center justify-center gap-1 cursor-pointer rounded-none"
                          >
                            Buscar
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Cargo / Puesto de Trabajo{" "}
                          <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={formContactCargo}
                          onChange={(e) => setFormContactCargo(e.target.value)}
                          placeholder="GERENTE DE OPERACIONES"
                          className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Correo Corporativo{" "}
                          <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="email"
                          required
                          value={formContactCorrEmp}
                          onChange={(e) => setFormContactCorrEmp(e.target.value)}
                          placeholder="alopez@corporativos.com"
                          className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none font-bold"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                          Teléfono Corporativo
                        </label>
                        <input
                          type="text"
                          value={formContactTelEmp}
                          onChange={(e) => setFormContactTelEmp(e.target.value)}
                          placeholder="+51 1 3110200 anexo 14"
                          className="w-full bg-white border border-[#141414] p-2 text-xs font-mono uppercase text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:bg-yellow-50 focus:border-black rounded-none"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 pt-4">
                        <input
                          type="checkbox"
                          id="formContactPrincipalCheck"
                          checked={formContactPrincipal}
                          onChange={(e) =>
                            setFormContactPrincipal(e.target.checked)
                          }
                          className="w-4 h-4 text-black focus:ring-0 cursor-pointer rounded-none"
                        />
                        <label
                          htmlFor="formContactPrincipalCheck"
                          className="text-[10px] font-bold text-zinc-700 cursor-pointer select-none font-mono uppercase tracking-wider"
                        >
                          ¿Es Contacto Principal?
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Botones de guardado */}
              <div className="flex justify-end gap-3 border-t border-[#141414]/20 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-3 py-1.5 bg-[#E4E3E0] hover:bg-white text-[#141414] border border-[#141414] font-mono font-bold uppercase text-xs transition-all cursor-pointer rounded-none"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (editType === "EMPRESAS") handleSaveEmpresa();
                    else if (editType === "GRUPOS") handleSaveGrupo();
                    else if (editType === "RUBROS") handleSaveRubro();
                    else if (editType === "SUCURSALES") handleSaveSucursal();
                    else if (editType === "CONTACTOS") handleSaveContacto();
                  }}
                  className="px-3 py-1.5 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] border border-[#141414] font-mono font-bold uppercase text-xs transition-all cursor-pointer rounded-none"
                >
                  Completar Registro
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODALES DE BÚSQUEDA */}
      {/* ============================================================ */}
      {showRubroSearchModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-55">
          <div className="bg-[#E4E3E0] max-w-md w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col max-h-[80vh] font-mono text-[#141414] text-xs">
            <div className="p-3 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <span className="font-bold uppercase tracking-wider text-[11px]">
                🔎 BUSCAR Y SELECCIONAR RUBRO
              </span>
              <button
                type="button"
                onClick={() => setShowRubroSearchModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-bold"
              >
                [X]
              </button>
            </div>
            <div className="p-3 bg-zinc-200 border-b border-[#141414]">
              <input
                type="text"
                autoFocus
                placeholder="ESCRIBA EL NOMBRE DEL RUBRO..."
                value={rubroSearchQuery}
                onChange={(e) => setRubroSearchQuery(e.target.value)}
                className="w-full bg-white border border-[#141414] p-1.5 focus:outline-none placeholder-zinc-400 font-mono text-xs uppercase"
              />
            </div>
            <div className="overflow-y-auto flex-1 p-3">
              <table className="w-full text-left border-collapse border border-[#141414]">
                <thead>
                  <tr className="bg-[#141414]/10 font-bold text-[10px] uppercase border-b border-[#141414]">
                    <th className="p-2 border-r border-[#141414]">ID</th>
                    <th className="p-2 border-r border-[#141414]">Nombre Rubro</th>
                    <th className="p-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/45 bg-white">
                  {db.rubros
                    .filter((r) =>
                      r.nombre.toLowerCase().includes(rubroSearchQuery.toLowerCase())
                    )
                    .map((rubro) => (
                      <tr
                        key={rubro.id_rubro}
                        className="hover:bg-[#141414]/5 cursor-pointer"
                        onClick={() => {
                          setFormRubroId(rubro.id_rubro);
                          setShowRubroSearchModal(false);
                        }}
                      >
                        <td className="p-2 border-r border-[#141414] font-bold">
                          RUB_{rubro.id_rubro}
                        </td>
                        <td className="p-2 border-r border-[#141414] uppercase">
                          {rubro.nombre}
                        </td>
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
                onClick={() => setShowRubroSearchModal(false)}
                className="px-3 py-1 bg-white border border-[#141414] font-bold text-[10.5px] uppercase hover:bg-zinc-100 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {showGrupoSearchModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-55">
          <div className="bg-[#E4E3E0] max-w-md w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col max-h-[80vh] font-mono text-[#141414] text-xs">
            <div className="p-3 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <span className="font-bold uppercase tracking-wider text-[11px]">
                🔎 BUSCAR Y SELECCIONAR GRUPO EMPRESARIAL
              </span>
              <button
                type="button"
                onClick={() => setShowGrupoSearchModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-bold"
              >
                [X]
              </button>
            </div>
            <div className="p-3 bg-zinc-200 border-b border-[#141414]">
              <input
                type="text"
                autoFocus
                placeholder="ESCRIBA EL NOMBRE DEL GRUPO..."
                value={grupoSearchQuery}
                onChange={(e) => setGrupoSearchQuery(e.target.value)}
                className="w-full bg-white border border-[#141414] p-1.5 focus:outline-none placeholder-zinc-400 font-mono text-xs uppercase"
              />
            </div>
            <div className="overflow-y-auto flex-1 p-3">
              <table className="w-full text-left border-collapse border border-[#141414]">
                <thead>
                  <tr className="bg-[#141414]/10 font-bold text-[10px] uppercase border-b border-[#141414]">
                    <th className="p-2 border-r border-[#141414]">ID</th>
                    <th className="p-2 border-r border-[#141414]">Nombre Grupo</th>
                    <th className="p-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/45 bg-white">
                  <tr
                    className="hover:bg-[#141414]/5 cursor-pointer text-blue-900 font-bold"
                    onClick={() => {
                      setFormGrupoId("null");
                      setShowGrupoSearchModal(false);
                    }}
                  >
                    <td className="p-2 border-r border-[#141414]">GRP_NULL</td>
                    <td className="p-2 border-r border-[#141414] uppercase">
                      -- Ninguno / Independiente --
                    </td>
                    <td className="p-2 text-right">
                      <button
                        type="button"
                        className="bg-blue-900 text-white hover:bg-blue-950 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                      >
                        [Quitar]
                      </button>
                    </td>
                  </tr>
                  {db.gruposEmpresariales
                    .filter((g) =>
                      g.nombre.toLowerCase().includes(grupoSearchQuery.toLowerCase())
                    )
                    .map((grupo) => (
                      <tr
                        key={grupo.id_grupo}
                        className="hover:bg-[#141414]/5 cursor-pointer"
                        onClick={() => {
                          setFormGrupoId(grupo.id_grupo);
                          setShowGrupoSearchModal(false);
                        }}
                      >
                        <td className="p-2 border-r border-[#141414] font-bold">
                          GRP_{grupo.id_grupo}
                        </td>
                        <td className="p-2 border-r border-[#141414] uppercase">
                          {grupo.nombre}
                        </td>
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
                onClick={() => setShowGrupoSearchModal(false)}
                className="px-3 py-1 bg-white border border-[#141414] font-bold text-[10.5px] uppercase hover:bg-zinc-100 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {showEmpresaSearchModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-55">
          <div className="bg-[#E4E3E0] max-w-lg w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col max-h-[80vh] font-mono text-[#141414] text-xs">
            <div className="p-3 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <span className="font-bold uppercase tracking-wider text-[11px]">
                🔎 BUSCAR Y SELECCIONAR EMPRESA
              </span>
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
                    <th className="p-2 border-r border-[#141414]">
                      Razón Social / Comercial
                    </th>
                    <th className="p-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/45 bg-white">
                  {db.empresas
                    .filter(
                      (e) =>
                        e.ruc.includes(empresaSearchQuery) ||
                        e.razon_social
                          .toLowerCase()
                          .includes(empresaSearchQuery.toLowerCase()) ||
                        (e.nombre_comercial &&
                          e.nombre_comercial
                            .toLowerCase()
                            .includes(empresaSearchQuery.toLowerCase()))
                    )
                    .map((emp) => (
                      <tr
                        key={emp.id_empresa}
                        className="hover:bg-[#141414]/5 cursor-pointer"
                        onClick={() => {
                          if (empresaSearchTarget === "SUCURSAL") {
                            setFormSucursalEmpresa(emp.id_empresa);
                          } else if (empresaSearchTarget === "CONTACTO") {
                            setFormContactEmpresaId(emp.id_empresa);
                            setFormContactSucursalId("null");
                          }
                          setShowEmpresaSearchModal(false);
                        }}
                      >
                        <td className="p-2 border-r border-[#141414] font-bold">
                          {emp.ruc}
                        </td>
                        <td className="p-2 border-r border-[#141414] uppercase">
                          {emp.nombre_comercial || emp.razon_social}
                        </td>
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

      {/* NUEVO MODAL DE BÚSQUEDA DE SUCURSALES PARA CONTACTOS */}
      {showSucursalSearchModal && (
        <div className="fixed inset-0 bg-[#141414]/65 backdrop-blur-xs flex items-center justify-center p-4 z-55">
          <div className="bg-[#E4E3E0] max-w-lg w-full border-2 border-[#141414] rounded-none shadow-none flex flex-col max-h-[80vh] font-mono text-[#141414] text-xs">
            <div className="p-3 bg-[#141414] text-[#E4E3E0] flex items-center justify-between border-b border-[#141414]">
              <span className="font-bold uppercase tracking-wider text-[11px]">
                🔎 BUSCAR Y SELECCIONAR SUCURSAL
              </span>
              <button
                type="button"
                onClick={() => setShowSucursalSearchModal(false)}
                className="text-[#E4E3E0] hover:text-red-500 font-bold"
              >
                [X]
              </button>
            </div>
            <div className="p-3 bg-zinc-200 border-b border-[#141414]">
              <input
                type="text"
                autoFocus
                placeholder="NOMBRE DE LA SUCURSAL..."
                value={sucursalSearchQuery}
                onChange={(e) => setSucursalSearchQuery(e.target.value)}
                className="w-full bg-white border border-[#141414] p-1.5 focus:outline-none placeholder-zinc-400 font-mono text-xs uppercase"
              />
              <div className="mt-1 text-[10px] text-zinc-500">
                Mostrando sucursales de la empresa seleccionada
              </div>
            </div>
            <div className="overflow-y-auto flex-1 p-3">
              {db.sucursales.filter((s) => s.id_empresa === formContactEmpresaId)
                .length === 0 ? (
                <div className="text-center text-slate-500 py-6 font-mono text-xs">
                  ⚠️ Esta empresa no tiene sucursales registradas.
                  <br />
                  Se usará la Sede Matriz por defecto.
                </div>
              ) : (
                <table className="w-full text-left border-collapse border border-[#141414]">
                  <thead>
                    <tr className="bg-[#141414]/10 font-bold text-[10px] uppercase border-b border-[#141414]">
                      <th className="p-2 border-r border-[#141414]">ID</th>
                      <th className="p-2 border-r border-[#141414]">Nombre</th>
                      <th className="p-2 border-r border-[#141414]">Principal</th>
                      <th className="p-2 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141414]/45 bg-white">
                    <tr
                      className="hover:bg-[#141414]/5 cursor-pointer text-blue-900 font-bold"
                      onClick={() => {
                        setFormContactSucursalId("null");
                        setShowSucursalSearchModal(false);
                      }}
                    >
                      <td className="p-2 border-r border-[#141414]">—</td>
                      <td className="p-2 border-r border-[#141414] uppercase">
                        Sede Matriz (Principal)
                      </td>
                      <td className="p-2 border-r border-[#141414]">—</td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          className="bg-blue-900 text-white hover:bg-blue-950 px-2 py-1 font-bold text-[10px] uppercase cursor-pointer"
                        >
                          [Seleccionar]
                        </button>
                      </td>
                    </tr>
                    {db.sucursales
                      .filter((s) => s.id_empresa === formContactEmpresaId)
                      .filter((s) =>
                        s.nombre
                          .toLowerCase()
                          .includes(sucursalSearchQuery.toLowerCase())
                      )
                      .map((suc) => (
                        <tr
                          key={suc.id_sucursal}
                          className="hover:bg-[#141414]/5 cursor-pointer"
                          onClick={() => {
                            setFormContactSucursalId(suc.id_sucursal);
                            setShowSucursalSearchModal(false);
                          }}
                        >
                          <td className="p-2 border-r border-[#141414] font-bold">
                            SUC_{suc.id_sucursal}
                          </td>
                          <td className="p-2 border-r border-[#141414] uppercase">
                            {suc.nombre}
                          </td>
                          <td className="p-2 border-r border-[#141414]">
                            {suc.es_principal ? (
                              <span className="text-[10px] font-bold text-indigo-700">
                                ✅ Sí
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">
                                No
                              </span>
                            )}
                          </td>
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
              )}
            </div>
            <div className="p-3 border-t border-[#141414] bg-zinc-200 text-right">
              <button
                type="button"
                onClick={() => setShowSucursalSearchModal(false)}
                className="px-3 py-1 bg-white border border-[#141414] font-bold text-[10.5px] uppercase hover:bg-zinc-100 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* GEOLOCALIZACIÓN MODAL */}
      {/* ============================================================ */}
      {showGeoSelector && (
        <div className="fixed inset-0 bg-[#141414]/80 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]">
          <div className="bg-[#E4E3E0] border-4 border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-lg w-full p-6 relative rounded-none">
            <div className="flex justify-between items-center border-b-2 border-[#141414] pb-3 mb-4">
              <h3 className="text-sm font-bold font-mono text-[#141414] flex items-center gap-2">
                📍 ASISTENTE DE SELECCIÓN GEOGRÁFICA
              </h3>
              <button
                type="button"
                onClick={() => setShowGeoSelector(false)}
                className="text-[#141414]/50 hover:text-[#141414] font-bold font-mono text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="bg-blue-50/80 border border-blue-400/30 p-3 mb-4 rounded-none text-[11px] text-blue-900 leading-relaxed">
              Seleccione jerárquicamente cada nivel administrativo. El sistema
              bloqueará e inhabilitará las opciones que no pertenezcan al ámbito
              regional previo.
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-[#141414]/70 uppercase mb-1 font-mono">
                  1. País de Origen / Operación
                </label>
                <select
                  value={geoSelectedCountryId}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setGeoSelectedCountryId(val);
                    setGeoSelections({});
                  }}
                  className="w-full bg-white border border-[#141414] p-2 focus:outline-none focus:border-[#141414] text-xs font-bold font-mono uppercase rounded-none"
                >
                  {db.paises
                    .sort((a, b) => a.nombre.localeCompare(b.nombre))
                    .map((p) => (
                      <option key={p.id_pais} value={p.id_pais}>
                        {p.nombre} ({p.codigo_iso})
                      </option>
                    ))}
                </select>
              </div>

              {(() => {
                const divisionTypes =
                  geoSelectedCountryId === 3 ? [1, 3] : [1, 2, 3];
                return divisionTypes.map((tipo, idx) => {
                  const previousDiv = idx === 0 ? null : geoSelections[idx - 1];
                  const selected = geoSelections[idx] || null;
                  const options = db.divisionesGeograficas
                    .filter((d) => {
                      if (idx === 0) {
                        return (
                          d.id_tipo_division === tipo &&
                          d.id_division_padre === null &&
                          getCountryOfDivision(d.id_division) ===
                          geoSelectedCountryId
                        );
                      } else {
                        return (
                          d.id_tipo_division === tipo &&
                          d.id_division_padre === previousDiv
                        );
                      }
                    })
                    .sort((a, b) => a.nombre.localeCompare(b.nombre));
                  return (
                    <div key={tipo} className="transition-all duration-200">
                      <label className="block text-[10px] font-bold text-[#141414]/70 uppercase mb-1 font-mono">
                        {idx + 2}. Nivel Administrativo:{" "}
                        {db.tiposDivision.find(
                          (t) => t.id_tipo_division === tipo
                        )?.nombre || `Nivel #${tipo}`}
                      </label>
                      <select
                        disabled={idx > 0 && !previousDiv}
                        value={selected || ""}
                        onChange={(e) => {
                          const val = e.target.value ? Number(e.target.value) : null;
                          setGeoSelections((prev) => {
                            const newSelections = { ...prev };
                            newSelections[idx] = val;
                            for (let i = idx + 1; i < divisionTypes.length; i++) {
                              delete newSelections[i];
                            }
                            return newSelections;
                          });
                        }}
                        className={`w-full p-2 border text-xs font-mono uppercase ${idx > 0 && !previousDiv
                          ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed rounded-none"
                          : "bg-white border-[#141414] text-[#141414] font-bold focus:border-[#141414] rounded-none"
                          }`}
                      >
                        <option value="">-- Seleccionar opción --</option>
                        {options.map((d) => (
                          <option key={d.id_division} value={d.id_division}>
                            {d.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                });
              })()}

              <div className="bg-white/80 border border-[#141414] p-3 rounded-none font-mono text-[11px] text-[#141414]">
                <div className="font-bold text-[9px] text-[#141414]/60 uppercase mb-1 font-mono">
                  Previsualización de Ruta:
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="bg-[#141414]/10 px-1.5 py-0.5 rounded-none text-[10px] font-mono">
                    {db.paises.find((p) => p.id_pais === geoSelectedCountryId)
                      ?.nombre || "País"}
                  </span>
                  {Object.keys(geoSelections)
                    .sort((a, b) => Number(a) - Number(b))
                    .map((key) => {
                      const divId = geoSelections[Number(key)];
                      if (!divId) return null;
                      const div = db.divisionesGeograficas.find(
                        (d) => d.id_division === divId
                      );
                      if (!div) return null;
                      return (
                        <div key={key} className="flex items-center gap-1">
                          <span>➔</span>
                          <span className="bg-[#141414]/10 text-[#141414] px-1.5 py-0.5 rounded-none text-[10px] font-bold">
                            {div.nombre}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-[#141414]/20">
                <button
                  type="button"
                  onClick={() => setShowGeoSelector(false)}
                  className="px-3 py-1.5 bg-white hover:bg-slate-100 text-[#141414] border border-[#141414] text-xs font-bold font-mono uppercase rounded-none cursor-pointer"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  disabled={!(() => {
                    const types =
                      geoSelectedCountryId === 3 ? [1, 3] : [1, 2, 3];
                    return types.every(
                      (_, idx) =>
                        geoSelections[idx] !== undefined &&
                        geoSelections[idx] !== null
                    );
                  })()}
                  onClick={() => {
                    const types =
                      geoSelectedCountryId === 3 ? [1, 3] : [1, 2, 3];
                    const last = geoSelections[types.length - 1];
                    if (last) {
                      setFormDivisionId(last);
                      setShowGeoSelector(false);
                    } else {
                      setNotification({ type: "warning", title: "Notificación", message: "Debe seleccionar todos los niveles jerárquicos." });
                    }
                  }}
                  className={`px-3 py-1.5 bg-[#141414] hover:bg-slate-800 text-[#E4E3E0] border border-[#141414] font-mono font-bold text-xs uppercase rounded-none transition-all cursor-pointer ${!(() => {
                    const types =
                      geoSelectedCountryId === 3 ? [1, 3] : [1, 2, 3];
                    return types.every(
                      (_, idx) =>
                        geoSelections[idx] !== undefined &&
                        geoSelections[idx] !== null
                    );
                  })()
                    ? "opacity-50 cursor-not-allowed"
                    : ""
                    }`}
                >
                  ✓ Confirmar Sede Geográfica
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* FIX v2.34 — MODAL "DAR DE BAJA" CON MOTIVO                  */}
      {/* Colores unificados a paleta de la página (#141414/#E4E3E0).  */}
      {/* ============================================================ */}
      {showBajaModal && bajaTarget && (
        <div className="fixed inset-0 bg-[#141414]/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#E4E3E0] border-4 border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-lg w-full rounded-none">
            <div className="p-4 bg-[#141414] text-[#E4E3E0] flex justify-between items-center border-b-2 border-[#141414]">
              <h3 className="text-xs font-mono uppercase font-bold tracking-widest flex items-center gap-2">
                <Archive className="w-4 h-4" /> Dar de baja · {bajaTarget.tipo}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowBajaModal(false);
                  setBajaTarget(null);
                  setBajaMotivo("");
                }}
                className="text-[#E4E3E0] hover:text-red-400 font-mono font-bold text-sm cursor-pointer"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="border-2 border-[#141414] bg-[#141414]/5 p-3">
                <p className="text-[10px] font-mono uppercase tracking-widest text-[#141414]/70 font-bold mb-1">
                  Entidad seleccionada
                </p>
                <p className="text-sm font-bold uppercase text-[#141414]">
                  {bajaTarget.nombre}
                </p>
                <p className="text-[10px] text-[#141414]/60 mt-1 font-mono">
                  ID: #{bajaTarget.id} · Tipo: {bajaTarget.tipo}
                </p>
              </div>

              {/* FIX v2.37 — Aviso de cascada cuando es EMPRESA */}
              {bajaTarget.tipo === "EMPRESAS" && (() => {
                const numSuc = db.sucursales.filter(s => s.id_empresa === bajaTarget.id).length;
                const numCon = db.contactosEmpresariales.filter(c => c.id_empresa === bajaTarget.id).length;
                if (numSuc === 0 && numCon === 0) return null;
                return (
                  <div className="border-2 border-[#141414] bg-[#141414] text-[#E4E3E0] p-3">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-[#E4E3E0]/70 font-bold mb-1">
                      ⚠ Baja en cascada
                    </p>
                    <p className="text-xs font-mono leading-relaxed">
                      Al dar de baja esta empresa, también se darán de baja automáticamente:
                    </p>
                    <ul className="list-disc ml-5 mt-1 text-xs font-mono">
                      {numSuc > 0 && <li>{numSuc} sucursal(es) asociada(s)</li>}
                      {numCon > 0 && <li>{numCon} contacto(s) empresarial(es)</li>}
                    </ul>
                    <p className="text-[10px] mt-2 text-[#E4E3E0]/70 italic">
                      Todas se reactivarán juntas al reactivar la empresa desde BAJAS.
                    </p>
                  </div>
                );
              })()}
              <div>
                <label className="block text-[10px] font-bold text-zinc-700 uppercase mb-1 font-mono tracking-wider">
                  Motivo de la baja <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={bajaMotivo}
                  onChange={(e) => setBajaMotivo(e.target.value)}
                  placeholder="Explique el motivo de la baja (mínimo 10 caracteres). Este motivo quedará registrado en la auditoría del sistema."
                  rows={4}
                  required
                  minLength={10}
                  maxLength={500}
                  className="w-full bg-white border-2 border-[#141414] p-2 text-xs font-mono text-[#141414] focus:outline-none focus:bg-yellow-50 resize-none"
                  aria-label="Motivo de la baja"
                />
                <p className="text-[9px] text-[#141414]/60 mt-1 font-mono">
                  {bajaMotivo.length} / 500 caracteres
                </p>
              </div>
              <div className="bg-[#141414]/5 border-l-4 border-[#141414] p-2 text-[10px] font-mono text-[#141414]/80">
                <strong>NOTA:</strong> La baja es lógica. La entidad queda inactiva pero NO se elimina.
                Puede reactivarla desde la pestaña <strong>BAJAS</strong>.
              </div>
              <div className="flex justify-end gap-2 border-t border-[#141414] pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowBajaModal(false);
                    setBajaTarget(null);
                    setBajaMotivo("");
                  }}
                  className="px-3 py-1.5 text-[11px] bg-white border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors font-mono font-bold uppercase cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmarBaja}
                  disabled={bajaMotivo.trim().length < 10}
                  className="px-3 py-1.5 text-[11px] bg-[#141414] text-[#E4E3E0] border border-[#141414] hover:bg-[#141414]/90 transition-colors font-mono font-bold uppercase cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirmar baja
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* FIX v2.34 — MODAL DE NOTIFICACIÓN (reemplaza setNotification({type:"warning", title:"Notificación", message:}))        */}
      {/* Colores unificados a paleta de la página (#141414/#E4E3E0).  */}
      {/* El tipo se distingue por icono, no por color.                */}
      {/* ============================================================ */}
      {notification && (
        <div className="fixed inset-0 bg-[#141414]/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div
            className="bg-[#E4E3E0] border-4 border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-md w-full rounded-none"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notif-title"
          >
            <div className="p-4 bg-[#141414] text-[#E4E3E0] flex justify-between items-center border-b-2 border-[#141414]">
              <h3 id="notif-title" className="text-xs font-mono uppercase font-bold tracking-widest">
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