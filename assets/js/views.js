/* ============================================================================
 *  views.js - Sistema de Atenciones v6 (selector modal + jerarquia + validacion)
 * ========================================================================== */

/* Helper: modal generico */
App.showModal = function (title, bodyHtml, footerHtml) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
        <div class="modal-overlay">
            <div class="modal" role="dialog" aria-modal="true">
                <div class="modal-header">
                    <div class="modal-title">${title}</div>
                    <button class="modal-close" type="button" onclick="App.closeModal()" aria-label="Cerrar">&times;</button>
                </div>
                <div class="modal-body">${bodyHtml}</div>
                ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
            </div>
        </div>`;
    root.querySelector('.modal-overlay').addEventListener('click', event => {
        if (event.target.classList.contains('modal-overlay')) App.closeModal();
    });
};

App.closeModal = function () {
    document.getElementById('modal-root').innerHTML = '';
};

App.showSearchModal = function (title, fields, onSearch) {
    const bodyHtml = fields.map(field => {
        if (field.type === 'select') {
            const options = (field.options || []).map(option =>
                `<option value="${App.escapeHtml(option.value)}">${App.escapeHtml(option.label)}</option>`
            ).join('');
            return `<div class="form-group"><label class="form-label" for="search_${field.name}">${App.escapeHtml(field.label)}</label>
                <select class="form-select" id="search_${field.name}"><option value="">Todos</option>${options}</select></div>`;
        }
        return `<div class="form-group"><label class="form-label" for="search_${field.name}">${App.escapeHtml(field.label)}</label>
            <input type="${field.type || 'text'}" class="form-input" id="search_${field.name}" placeholder="${App.escapeHtml(field.placeholder || '')}"></div>`;
    }).join('');

    App.showModal('Buscar: ' + App.escapeHtml(title), bodyHtml,
        `<button class="btn" type="button" onclick="App.closeModal()">Cancelar</button>
         <button class="btn" type="button" id="btnClearSearch">Limpiar</button>
         <button class="btn btn-primary" type="button" id="btnSearchModal">Buscar</button>`);
    document.getElementById('btnSearchModal').addEventListener('click', () => {
        const values = {};
        fields.forEach(field => {
            const element = document.getElementById('search_' + field.name);
            if (element && element.value.trim()) values[field.name] = element.value.trim();
        });
        App.closeModal();
        onSearch(values);
    });
    document.getElementById('btnClearSearch').addEventListener('click', () => {
        App.closeModal();
        onSearch({});
    });
};

App.showSelectorModal = function (title, searchEndpoint, columns, onSelect, searchParamName = 'query') {
    const selectorInstance = (App._selectorInstance || 0) + 1;
    App._selectorInstance = selectorInstance;
    let requestVersion = 0;
    const root = document.getElementById('modal-root');
    const overlay = document.createElement('div');
    overlay.className = 'selector-overlay';
    overlay.innerHTML = `
        <section class="modal selector-modal" role="dialog" aria-modal="true" aria-labelledby="selectorTitle">
            <div class="modal-header">
                <h2 class="modal-title" id="selectorTitle">${App.escapeHtml(title)}</h2>
                <button type="button" class="modal-close" data-selector-close aria-label="Cerrar">&times;</button>
            </div>
            <div class="modal-body">
                <div class="selector-search-row">
                    <input type="search" class="form-input" id="selectorSearch" placeholder="Buscar en todas las opciones..." aria-label="Buscar opciones">
                    <button type="button" class="btn btn-primary" id="btnSelectorSearch"><i class="bi bi-search" aria-hidden="true"></i> Buscar</button>
                </div>
                <div id="selectorResults" class="selector-results" aria-live="polite"><p class="text-muted">Cargando opciones...</p></div>
            </div>
            <div class="modal-footer"><button class="btn" type="button" data-selector-close>Cancelar</button></div>
        </section>`;
    root.appendChild(overlay);
    const closeSelector = () => {
        if (App._selectorInstance === selectorInstance) App._selectorInstance++;
        overlay.remove();
    };
    overlay.addEventListener('click', event => {
        if (event.target === overlay || event.target.closest('[data-selector-close]')) closeSelector();
    });
    const renderResults = async query => {
        const currentVersion = ++requestVersion;
        const url = searchEndpoint + (searchEndpoint.includes('?') ? '&' : '?') + searchParamName + '=' + encodeURIComponent(query || '');
        const results = overlay.querySelector('#selectorResults');
        if (!results || !overlay.isConnected) return;
        results.innerHTML = '<p class="text-muted text-center" style="padding:16px">Buscando...</p>';
        try {
            const response = await App.request(url);
            if (selectorInstance !== App._selectorInstance || currentVersion !== requestVersion || !overlay.isConnected) return;
            const items = Array.isArray(response) ? response : [];
            if (!items.length) {
                results.innerHTML = '<p class="text-muted text-center" style="padding:20px">Sin resultados para esta busqueda.</p>';
                return;
            }
            results.innerHTML = items.map((item, index) => `
                <article class="selector-result">
                    <div class="selector-result__details">${columns.map(column => {
                const value = item[column.key];
                return `<div><strong>${App.escapeHtml(column.label)}:</strong> ${App.escapeHtml(value == null || value === '' ? '-' : value)}</div>`;
            }).join('')}</div>
                    <button type="button" class="btn btn-sm btn-primary" data-selector-index="${index}"><i class="bi bi-check2-circle" aria-hidden="true"></i> Seleccionar</button>
                </article>`).join('');
            results.querySelectorAll('[data-selector-index]').forEach(button => {
                button.addEventListener('click', () => {
                    onSelect(items[Number(button.dataset.selectorIndex)]);
                    closeSelector();
                });
            });
        } catch (error) {
            if (selectorInstance === App._selectorInstance && currentVersion === requestVersion && overlay.isConnected) {
                results.innerHTML = `<p class="text-danger">Error: ${App.escapeHtml(error.message)}</p>`;
            }
        }
    };
    overlay.querySelector('#selectorSearch').addEventListener('input', event => {
        clearTimeout(window._selectorTimer);
        window._selectorTimer = setTimeout(() => renderResults(event.target.value), 300);
    });
    overlay.querySelector('#selectorSearch').addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            clearTimeout(window._selectorTimer);
            renderResults(event.currentTarget.value);
        }
    });
    overlay.querySelector('#btnSelectorSearch').addEventListener('click', () => {
        clearTimeout(window._selectorTimer);
        renderResults(overlay.querySelector('#selectorSearch').value);
    });
    renderResults('');
};

App.confirmDelete = function (itemName, onConfirm) {
    App.showModal('Confirmar eliminacion',
        `<p>Esta seguro que desea eliminar <strong>${App.escapeHtml(itemName)}</strong>?</p>
         <p class="text-muted text-sm">Esta accion no se puede deshacer.</p>`,
        `<button class="btn" type="button" onclick="App.closeModal()">Cancelar</button>
         <button class="btn btn-danger" type="button" id="btnConfirmDelete">Eliminar</button>`);
    document.getElementById('btnConfirmDelete').addEventListener('click', () => {
        App.closeModal();
        onConfirm();
    });
};

App.validateDuplicate = async function (tabla, campo, valor, idExcluir = null, extraParams = {}) {
    const params = new URLSearchParams({ tabla, campo, valor });
    if (idExcluir) params.set('id_excluir', idExcluir);
    Object.entries(extraParams).forEach(([key, value]) => params.set(key, value));
    try {
        const result = await App.request('/geografia/validate?' + params.toString());
        return result.existe;
    } catch (error) { return false; }
};

/* ============================================================================
 *  VISTA: DASHBOARD
 * ========================================================================== */
App.views.dashboard = {
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4">
                <h1 style="color:var(--c-primary)">Dashboard</h1>
                <button class="btn" id="btnRefresh">Actualizar</button>
            </div>
            <div class="kpi-grid" id="kpisContainer">
                <div class="kpi-tile"><div class="kpi-tile__label">Cargando...</div><div class="kpi-tile__value"><div class="spinner"></div></div></div>
            </div>
            <div class="card-grid">
                <div class="card"><div class="card-header"><div class="card-title">Tickets por dia</div></div><div style="height:280px"><canvas id="chartTicketsDia"></canvas></div></div>
                <div class="card"><div class="card-header"><div class="card-title">Tickets por Estado</div></div><div style="height:280px"><canvas id="chartTicketsEstado"></canvas></div></div>
                <div class="card"><div class="card-header"><div class="card-title">Tickets por Prioridad</div></div><div style="height:280px"><canvas id="chartTicketsPrioridad"></canvas></div></div>
                <div class="card"><div class="card-header"><div class="card-title">Atenciones por Tecnico</div></div><div style="height:280px"><canvas id="chartAtencionesTecnico"></canvas></div></div>
            </div>`;
        document.getElementById('btnRefresh').addEventListener('click', () => this.render(container));
        await Promise.all([
            this.loadKPIs(),
            this.loadChart('TICKETS_POR_DIA', 'chartTicketsDia'),
            this.loadChart('TICKETS_POR_ESTADO', 'chartTicketsEstado'),
            this.loadChart('TICKETS_POR_PRIORIDAD', 'chartTicketsPrioridad'),
            this.loadChart('ATENCIONES_POR_TECNICO', 'chartAtencionesTecnico'),
        ]);
    },
    async loadKPIs() {
        try {
            const k = await App.request('/dashboard/kpis');
            document.getElementById('kpisContainer').innerHTML = `
                <div class="kpi-tile success"><div class="kpi-tile__label">Tickets Cerrados</div><div class="kpi-tile__value">${App.formatNumber(k.tickets_cerrados_periodo || 0)}</div></div>
                <div class="kpi-tile info"><div class="kpi-tile__label">Tickets Totales</div><div class="kpi-tile__value">${App.formatNumber(k.tickets_total || 0)}</div></div>
                <div class="kpi-tile warn"><div class="kpi-tile__label">Pendientes</div><div class="kpi-tile__value">${App.formatNumber(k.tickets_pendientes || 0)}</div></div>
                <div class="kpi-tile info"><div class="kpi-tile__label">En Atencion</div><div class="kpi-tile__value">${App.formatNumber(k.tickets_en_atencion || 0)}</div></div>
                <div class="kpi-tile danger"><div class="kpi-tile__label">Criticos Abiertos</div><div class="kpi-tile__value">${App.formatNumber(k.tickets_criticos || 0)}</div></div>
                <div class="kpi-tile success"><div class="kpi-tile__label">Tiempo Promedio (min)</div><div class="kpi-tile__value">${App.formatNumber(k.tiempo_promedio_minutos || 0, 1)}</div></div>`;
        } catch (e) { console.error('KPIs', e); }
    },
    async loadChart(tipo, canvasId) {
        try {
            const data = await App.request(`/dashboard/series?tipo=${encodeURIComponent(tipo)}`);
            this.renderChart(canvasId, tipo, data);
        } catch (e) { console.error('Chart', tipo, e); }
    },
    renderChart(canvasId, tipo, data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        if (window.Dashboard?.charts?.[canvasId]) window.Dashboard.charts[canvasId].destroy();
        const ctx = canvas.getContext('2d');
        const palette = ['#304753', '#2590c6', '#5889a1', '#459660', '#977b43', '#955650', '#4a7bab'];
        if (!data || data.length === 0) {
            ctx.font = '14px sans-serif'; ctx.fillStyle = '#848a8e'; ctx.textAlign = 'center';
            ctx.fillText('Sin datos', canvas.width / 2, canvas.height / 2); return;
        }
        if (tipo === 'TICKETS_POR_DIA') {
            window.Dashboard.charts[canvasId] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: data.map(d => d.fecha),
                    datasets: [
                        { label: 'Total', data: data.map(d => d.total), borderColor: palette[1], backgroundColor: 'rgba(37,144,198,0.1)', fill: true, tension: 0.3 },
                        { label: 'Cerrados', data: data.map(d => d.cerrados), borderColor: palette[3], fill: false, tension: 0.3 },
                        { label: 'Pendientes', data: data.map(d => d.pendientes), borderColor: palette[4], fill: false, tension: 0.3 },
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
            });
        } else if (tipo === 'TICKETS_POR_ESTADO' || tipo === 'TICKETS_POR_PRIORIDAD') {
            window.Dashboard.charts[canvasId] = new Chart(ctx, {
                type: 'doughnut',
                data: { labels: data.map(d => d.estado || d.prioridad), datasets: [{ data: data.map(d => d.total), backgroundColor: palette }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
            });
        } else if (tipo === 'ATENCIONES_POR_TECNICO') {
            window.Dashboard.charts[canvasId] = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: data.map(d => d.tecnico),
                    datasets: [
                        { label: 'Atenciones', data: data.map(d => d.atenciones), backgroundColor: palette[1] },
                        { label: 'Promedio (min)', data: data.map(d => d.promedio_minutos), backgroundColor: palette[2] }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
            });
        }
    },
};

/* ============================================================================
 *  VISTA: TICKETS
 * ========================================================================== */
App.views.tickets = {
    currentFilters: {},
    async render(container, params) {
        if (params[0] === 'new') return this.showFormModal(null);
        if (params[0]) return this.renderDetail(container, params[0]);
        return this.renderList(container);
    },

    async renderList(container) {
        container.innerHTML = `
            <div class="card-header mb-4">
                <h1 style="color:var(--c-primary)">Tickets</h1>
                <div class="card-actions">
                    <button class="btn" id="btnSearch">🔍 Buscar</button>
                    <button class="btn btn-primary" id="btnNew">+ Nuevo Ticket</button>
                </div>
            </div>
        <div class="card"><div id="tableContainer"><div class="loading-container"><div class="spinner"></div><p>Cargando tickets...</p></div></div></div>`;
        document.getElementById('btnNew').addEventListener('click', () => this.showFormModal(null));
        document.getElementById('btnSearch').addEventListener('click', () => {
            App.showSearchModal('Buscar Tickets', [
                { name: 'search', label: 'Texto', placeholder: 'Nro, detalle, empresa...' },
                {
                    name: 'estado', label: 'Estado', type: 'select', options: [
                        { value: 'PENDIENTE', label: 'Pendiente' },
                        { value: 'EN_ATENCION', label: 'En Atencion' },
                        { value: 'RESUELTO', label: 'Resuelto' },
                        { value: 'CERRADO', label: 'Cerrado' },
                        { value: 'REABIERTO', label: 'Reabierto' },
                        { value: 'ANULADO', label: 'Anulado' },
                    ]
                },
                {
                    name: 'prioridad', label: 'Prioridad', type: 'select', options: [
                        { value: 'CRITICA', label: 'Critica' },
                        { value: 'ALTA', label: 'Alta' },
                        { value: 'MEDIA', label: 'Media' },
                        { value: 'BAJA', label: 'Baja' },
                    ]
                },
            ], (filters) => { this.currentFilters = filters; this.load(); });
        });
        await this.load();
    },

    async load() {
        const params = new URLSearchParams();
        if (this.currentFilters.search) params.set('search', this.currentFilters.search);
        if (this.currentFilters.estado) params.set('estado', this.currentFilters.estado);
        if (this.currentFilters.prioridad) params.set('prioridad', this.currentFilters.prioridad);
        params.set('per_page', '50');
        try {
            const data = await App.request('/tickets?' + params.toString());
            const rows = Array.isArray(data) ? data : (data.data || []);
            const columns = [
                { key: 'nro_ticket', label: 'Nro', render: r => `<a href="#/tickets/${r.id_ticket}" style="color:var(--c-accent);font-weight:600">${App.escapeHtml(r.nro_ticket)}</a>` },
                { key: 'fecha_registro', label: 'Fecha', render: r => App.formatDate(r.fecha_registro) },
                { key: 'empresa_razon_social', label: 'Empresa' },
                { key: 'prioridad', label: 'Prioridad', render: r => App.badge(r.prioridad, r.prioridad.toLowerCase()) },
                { key: 'estado', label: 'Estado', render: r => App.badge(r.estado, r.estado.toLowerCase()) },
                { key: 'acciones', label: '', render: r => `<button class="btn btn-sm btn-primary" onclick="App.navigate('/tickets/${r.id_ticket}')">Ver</button>` },
            ];
            document.getElementById('tableContainer').innerHTML = App.table({ columns, rows, empty: 'No hay tickets' });
        } catch (e) {
            document.getElementById('tableContainer').innerHTML = App.emptyState('📋', 'Error al cargar', e.message);
        }
    },

    async renderDetail(container, id) {
        container.innerHTML = '<div class="loading-container"><div class="spinner spinner-lg"></div><p>Cargando ticket...</p></div>';
        try {
            const data = await App.request(`/tickets/${id}`);
            const documents = await App.request(`/tickets/${id}/files`).catch((error) => {
                console.error('[Tickets] Error al cargar documentos', error);
                return [];
            });
            const t = data.ticket || data;
            container.innerHTML = `
                <div class="card-header mb-4">
                    <h1 style="color:var(--c-primary)">Ticket ${App.escapeHtml(t.nro_ticket)}</h1>
                    <div class="card-actions">
                        <button class="btn" onclick="App.navigate('/tickets')">Volver</button>
                        <button class="btn btn-primary" id="btnChangeStatus">Cambiar Estado</button>
                    </div>
                </div>
                <div class="card-grid">
                    <div class="card" style="grid-column: span 2">
                        <div class="card-header"><div class="card-title">Detalle</div></div>
                        <p>${App.escapeHtml(t.detalle_reporte || 'Sin descripcion')}</p>
                    </div>
                    <div class="card">
                        <div class="card-header"><div class="card-title">Empresa y ticket</div></div>
                        <div style="display:grid;gap:8px;font-size:14px">
                            <div><strong>Empresa:</strong> <a href="#/empresas/${Number(t.id_empresa)}">${App.escapeHtml(t.empresa_razon_social || '-')}</a></div>
                            <div><strong>RUC:</strong> ${App.escapeHtml(t.ruc || '-')}</div>
                            <div><strong>Nombre comercial:</strong> ${App.escapeHtml(t.empresa_nombre_comercial || '-')}</div>
                            <div><strong>Telefono empresa:</strong> ${App.escapeHtml(t.empresa_telefono || '-')}</div>
                            <div><strong>Correo empresa:</strong> ${App.escapeHtml(t.empresa_correo || '-')}</div>
                            <div><strong>Rubro:</strong> ${App.escapeHtml(t.rubro_nombre || '-')}</div>
                            <div><strong>Direccion:</strong> ${App.escapeHtml(t.empresa_direccion || '-')}</div>
                            <div><strong>Referencia:</strong> ${App.escapeHtml(t.empresa_referencia || '-')}</div>
                            <div><strong>Ubicacion:</strong> ${App.escapeHtml(t.division_nombre || '-')}</div>
                            <div><strong>Sede:</strong> ${App.escapeHtml(t.sucursal_nombre || 'Sede principal')}</div>
                            <div><strong>Estado:</strong> ${App.badge(t.estado, t.estado.toLowerCase())}</div>
                            <div><strong>Prioridad:</strong> ${App.badge(t.prioridad, t.prioridad.toLowerCase())}</div>
                            <div><strong>Contacto:</strong> ${App.escapeHtml(`${t.contacto_nombres || ''} ${t.contacto_apellido || ''}`.trim() || '-')}</div>
                            <div><strong>Correo contacto:</strong> ${App.escapeHtml(t.contacto_correo || t.contacto_personal_correo || '-')}</div>
                            <div><strong>Telefono contacto:</strong> ${App.escapeHtml(t.contacto_telefono || t.contacto_personal_telefono || '-')}</div>
                            <div><strong>Creado:</strong> ${App.formatDateTime(t.fecha_registro)}</div>
                        </div>
                    </div>
                </div>
                <div class="card">
                    <div class="card-header"><div class="card-title">Documentos asociados</div></div>
                    <div class="form-row" style="align-items:end">
                        <div class="form-group"><label class="form-label" for="ticketDocument">Adjuntar documento (max. 10 MB)</label>
                            <input class="form-input" type="file" id="ticketDocument" accept=".pdf,.jpg,.jpeg,.png,.gif,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx"></div>
                        <button class="btn btn-primary" id="btnUploadDocument" type="button">Adjuntar</button>
                    </div>
                    <div class="table-wrap"><table><thead><tr><th>Documento</th><th>Tamano</th><th>Fecha</th><th></th></tr></thead><tbody>
                        ${documents.map(d => `<tr>
                            <td><a href="/api/v1/tickets/${encodeURIComponent(id)}/files/${Number(d.id_documento)}">${App.escapeHtml(d.nombre_original)}</a></td>
                            <td>${App.formatNumber(Number(d.tamano_bytes) / 1024, 1)} KB</td>
                            <td>${App.formatDateTime(d.fecha_registro)}</td>
                            <td><button class="btn btn-sm btn-danger" type="button" data-delete-document="${Number(d.id_documento)}">Eliminar</button></td>
                        </tr>`).join('') || '<tr><td colspan="4" class="text-muted">Sin documentos adjuntos</td></tr>'}
                    </tbody></table></div>
                </div>
                <div class="card">
                    <div class="card-header"><div class="card-title">Historial</div></div>
                    <div class="timeline">
                        ${(data.historial || []).map(h => `
                            <div class="timeline-item">
                                <div class="timeline-item__title">${App.badge(h.estado_nuevo, (h.estado_nuevo || '').toLowerCase())}</div>
                                <div class="timeline-item__date">${App.formatDateTime(h.fecha_cambio)}</div>
                                <div class="timeline-item__desc">${App.escapeHtml(h.motivo || '')}</div>
                            </div>`).join('') || '<p class="text-muted">Sin historial</p>'}
                    </div>
                </div>
                <div class="card">
                    <div class="card-header"><div class="card-title">Atenciones</div>
                        <button class="btn btn-sm btn-primary" id="btnAddAtencion">+ Nueva</button>
                    </div>
                    <div>
                        ${(data.atenciones || []).map(a => `
                            <div style="border-left:3px solid var(--c-accent);padding:12px;margin-bottom:12px;background:var(--c-card);border-radius:4px">
                                <div style="display:flex;justify-content:space-between">
                                    <strong>${App.escapeHtml(a.tecnico_nombre || 'Tecnico')}</strong>
                                    ${App.badge(a.estado, (a.estado || '').toLowerCase().replace('_', ''))}
                                </div>
                                <p class="text-sm">${App.escapeHtml(a.detalle_atencion || '')}</p>
                            </div>`).join('') || '<p class="text-muted">Sin atenciones</p>'}
                    </div>
                </div>`;
            document.getElementById('btnChangeStatus').addEventListener('click', () => this.showStatusModal(t));
            document.getElementById('btnAddAtencion')?.addEventListener('click', () => this.showAtencionModal(t));
            document.getElementById('btnUploadDocument').addEventListener('click', async () => {
                const input = document.getElementById('ticketDocument');
                if (!input.files.length) { App.toast('Seleccione un documento', 'warning'); return; }
                const form = new FormData();
                form.append('documento', input.files[0]);
                try {
                    await App.request(`/tickets/${id}/files`, { method: 'POST', body: form });
                    App.toast('Documento adjuntado', 'success');
                    this.renderDetail(container, id);
                } catch (e) { App.toast('Error: ' + e.message, 'error'); }
            });
            container.querySelectorAll('[data-delete-document]').forEach(button => {
                button.addEventListener('click', () => {
                    const documentId = Number(button.dataset.deleteDocument);
                    const documentInfo = documents.find(d => Number(d.id_documento) === documentId);
                    App.confirmDelete(documentInfo?.nombre_original || 'documento', async () => {
                        try {
                            await App.request(`/tickets/${id}/files/${documentId}`, { method: 'DELETE' });
                            App.toast('Documento eliminado', 'success');
                            this.renderDetail(container, id);
                        } catch (e) { App.toast('Error: ' + e.message, 'error'); }
                    });
                });
            });
        } catch (e) {
            container.innerHTML = App.emptyState('⚠️', 'Error al cargar ticket', e.message);
        }
    },

    async showFormModal(ticket) {
        let empresas = [], motivos = [];
        try {
            [empresas, motivos] = await Promise.all([App.request('/empresas'), App.request('/motivos')]);
        } catch (e) { App.toast('Error al cargar catalogos', 'error'); return; }

        App.showModal('Nuevo Ticket',
            `<form id="formTicket">
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Empresa <span class="req">*</span></label>
                        <div style="display:flex;gap:6px">
                            <input type="text" class="form-input" id="empresa_display" placeholder="Click en buscar" readonly>
                            <input type="hidden" id="id_empresa">
                            <button type="button" class="btn" onclick="App.showSelectorModal('Seleccionar Empresa', '/empresas', [{key:'ruc',label:'RUC'},{key:'razon_social',label:'Razon Social'},{key:'correo',label:'Correo'}], (item) => { document.getElementById('id_empresa').value = item.id_empresa; document.getElementById('empresa_display').value = item.razon_social; document.getElementById('id_empresa_contacto').innerHTML = '<option value=>Cargando contactos...</option>'; App.request('/contactos?id_empresa=' + item.id_empresa).then(cs => { const sel = document.getElementById('id_empresa_contacto'); sel.innerHTML = '<option value=>Seleccione...</option>' + cs.map(c => '<option value=' + c.id_empresa_contacto + '>' + App.escapeHtml((c.nombres||'')+' '+(c.apellido_paterno||'')) + '</option>').join(''); }); })">🔍 Buscar</button>
                        </div></div>
                    <div class="form-group"><label class="form-label">Contacto <span class="req">*</span></label>
                        <select class="form-select" id="id_empresa_contacto" required>
                            <option value="">Seleccione empresa primero</option>
                        </select></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Motivo</label>
                        <select class="form-select" id="id_motivo_contacto">
                            <option value="">Sin motivo</option>
                            ${motivos.map(m => `<option value="${m.id_motivo}">${App.escapeHtml(m.nombre)}</option>`).join('')}
                        </select></div>
                    <div class="form-group"><label class="form-label">Prioridad</label>
                        <select class="form-select" id="prioridad">
                            <option value="MEDIA">Media</option>
                            <option value="BAJA">Baja</option>
                            <option value="ALTA">Alta</option>
                            <option value="CRITICA">Critica</option>
                        </select></div>
                </div>
                <div class="form-group"><label class="form-label">Detalle <span class="req">*</span></label>
                    <textarea class="form-textarea" id="detalle_reporte" rows="5" required placeholder="Describa el problema..."></textarea></div>
            </form>`,
            `<button class="btn" onclick="App.closeModal()">Cancelar</button>
             <button class="btn btn-primary" id="btnSaveTicket">Crear Ticket</button>`);

        document.getElementById('btnSaveTicket').addEventListener('click', async () => {
            const data = {
                id_usuario: App.config.user.id_persona,
                id_empresa: parseInt(document.getElementById('id_empresa').value),
                id_empresa_contacto: parseInt(document.getElementById('id_empresa_contacto').value),
                id_motivo_contacto: parseInt(document.getElementById('id_motivo_contacto').value) || null,
                detalle_reporte: document.getElementById('detalle_reporte').value,
                prioridad: document.getElementById('prioridad').value,
                medio_contacto: 'SISTEMA',
            };
            if (!data.id_empresa || !data.id_empresa_contacto || !data.detalle_reporte) {
                App.toast('Complete los campos requeridos', 'warning'); return;
            }
            try {
                const result = await App.request('/tickets', { method: 'POST', body: data });
                App.toast(`Ticket ${result.nro_ticket} creado`, 'success');
                App.closeModal();
                App.navigate('/tickets/' + result.id_ticket);
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },

    showStatusModal(ticket) {
        App.showModal(`Cambiar estado - ${ticket.nro_ticket}`,
            `<div class="form-group"><label class="form-label">Nuevo estado <span class="req">*</span></label>
                <select class="form-select" id="newEstado">
                    <option value="">Seleccione...</option>
                    <option value="PENDIENTE">Pendiente</option>
                    <option value="EN_ATENCION">En Atencion</option>
                    <option value="RESUELTO">Resuelto</option>
                    <option value="CERRADO">Cerrado</option>
                    <option value="REABIERTO">Reabierto</option>
                    <option value="ANULADO">Anulado</option>
                </select></div>
             <div class="form-group"><label class="form-label">Motivo <span class="req">*</span></label>
                <textarea class="form-textarea" id="motivo" required></textarea></div>`,
            `<button class="btn" onclick="App.closeModal()">Cancelar</button>
             <button class="btn btn-primary" id="btnSaveStatus">Guardar</button>`);
        document.getElementById('btnSaveStatus').addEventListener('click', async () => {
            const estado = document.getElementById('newEstado').value;
            const motivo = document.getElementById('motivo').value.trim();
            if (!estado || !motivo) { App.toast('Complete todos los campos', 'warning'); return; }
            try {
                await App.request(`/tickets/${ticket.id_ticket}/status`, { method: 'PATCH', body: { nuevo_estado: estado, motivo } });
                App.toast('Estado actualizado', 'success');
                App.closeModal();
                this.renderDetail(document.getElementById('appView'), ticket.id_ticket);
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },

    showAtencionModal(ticket) {
        App.showModal(`Nueva atencion - ${ticket.nro_ticket}`,
            `<div class="form-group"><label class="form-label">Detalle <span class="req">*</span></label>
                <textarea class="form-textarea" id="detalleAtencion" required></textarea></div>
             <div class="form-group"><label class="form-label">Solucion</label>
                <textarea class="form-textarea" id="solucionAtencion"></textarea></div>
             <div class="form-group"><label class="form-label">Estado</label>
                <select class="form-select" id="estadoAtencion">
                    <option value="EN_PROCESO">En Proceso</option>
                    <option value="COMPLETADO">Completado</option>
                    <option value="PAUSADO">Pausado</option>
                </select></div>`,
            `<button class="btn" onclick="App.closeModal()">Cancelar</button>
             <button class="btn btn-primary" id="btnSaveAtencion">Guardar</button>`);
        document.getElementById('btnSaveAtencion').addEventListener('click', async () => {
            const detalle = document.getElementById('detalleAtencion').value.trim();
            if (!detalle) { App.toast('Detalle requerido', 'warning'); return; }
            try {
                await App.request('/atenciones', {
                    method: 'POST', body: {
                        id_ticket: ticket.id_ticket,
                        detalle_atencion: detalle,
                        solucion_aplicada: document.getElementById('solucionAtencion').value || null,
                        estado: document.getElementById('estadoAtencion').value,
                    }
                });
                App.toast('Atencion registrada', 'success');
                App.closeModal();
                this.renderDetail(document.getElementById('appView'), ticket.id_ticket);
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },
};

/* ============================================================================
 *  VISTA: EMPRESAS (CRUD + selector modal + jerarquia + contactos/sucursales)
 * ========================================================================== */
App.views.empresas = {
    currentFilters: {},
    showInactive: false,
    relatedStatus: { sucursales: 'activas', contactos: 'activas' },
    async render(container, params = []) {
        if (params[0]) return this.renderDetail(container, params[0]);
        container.innerHTML = `
            <div class="card-header mb-4">
                <h1 style="color:var(--c-primary)">Empresas</h1>
                <div class="card-actions">
                    <button class="btn" id="btnSearch">🔍 Buscar</button>
                    <button class="btn" id="btnToggleInactive">Ver dadas de baja</button>
                    <button class="btn btn-primary" id="btnNew">+ Nueva Empresa</button>
                </div>
            </div>
            <div class="card"><div id="tableContainer"><div class="loading-container"><div class="spinner"></div><p>Cargando...</p></div></div></div>`;
        document.getElementById('btnNew').addEventListener('click', () => this.showFormModal(null));
        document.getElementById('btnToggleInactive').addEventListener('click', (event) => {
            this.showInactive = !this.showInactive;
            event.currentTarget.textContent = this.showInactive ? 'Ver activas' : 'Ver dadas de baja';
            document.getElementById('btnNew').hidden = this.showInactive;
            this.load();
        });
        document.getElementById('btnSearch').addEventListener('click', () => {
            App.showSearchModal('Buscar Empresas', [
                { name: 'query', label: 'Buscar', placeholder: 'RUC, razon social, correo...' },
            ], (filters) => { this.currentFilters = filters; this.load(); });
        });
        await this.load();
    },

    async load() {
        const params = new URLSearchParams();
        if (this.currentFilters.query) params.set('query', this.currentFilters.query);
        if (this.showInactive) params.set('estado', 'baja');
        try {
            const rows = await App.request('/empresas' + (params.toString() ? '?' + params.toString() : ''));
            const columns = [
                { key: 'ruc', label: 'RUC' },
                { key: 'razon_social', label: 'Razon Social', render: r => `<a href="#/empresas/${r.id_empresa}" style="color:var(--c-accent);font-weight:600">${App.escapeHtml(r.razon_social)}</a>` },
                { key: 'correo', label: 'Correo' },
                { key: 'telefono', label: 'Telefono', render: r => App.escapeHtml(r.telefono || '-') },
                { key: 'rubro', label: 'Rubro', render: r => App.escapeHtml(r.rubro || '-') },
                ...(this.showInactive ? [{ key: 'fecha_baja', label: 'Fecha de baja', render: r => App.formatDateTime(r.fecha_baja) }] : []),
                {
                    key: 'acciones', label: '', render: r => `
                    <button class="btn btn-sm" onclick="App.navigate('/empresas/${r.id_empresa}')">Ver</button>
                    ${this.showInactive
                            ? `<button class="btn btn-sm btn-primary" onclick="App.views.empresas.reactivate(${r.id_empresa})">Reactivar</button>
                               <button class="btn btn-sm btn-danger" onclick="App.views.empresas.deletePermanent(${r.id_empresa}, '${App.escapeHtml(r.razon_social)}')">Eliminar definitivamente</button>`
                            : `<button class="btn btn-sm btn-primary" onclick="App.views.empresas.showFormModal(${r.id_empresa})">Editar</button>
                           <button class="btn btn-sm btn-danger" onclick="App.views.empresas.delete(${r.id_empresa}, '${App.escapeHtml(r.razon_social)}')">Dar de baja</button>`}`
                },
            ];
            document.getElementById('tableContainer').innerHTML = App.table({ columns, rows, empty: 'No hay empresas' });
        } catch (e) {
            document.getElementById('tableContainer').innerHTML = App.emptyState('🏢', 'Error', e.message);
        }
    },

    async showFormModal(id) {
        let empresa = {};
        if (id) {
            try { empresa = await App.request(`/empresas/${id}`); } catch (e) { App.toast('Error al cargar empresa', 'error'); return; }
        }
        const locationLocked = Boolean(id && Number(empresa.tiene_sede_principal) === 1);

        App.showModal(id ? 'Editar Empresa' : 'Nueva Empresa',
            `<form id="formEmpresa">
                <div class="form-row">
                    <div class="form-group"><label class="form-label">RUC <span class="req">*</span></label>
                        <input type="text" class="form-input" id="ruc" required value="${App.escapeHtml(empresa.ruc || '')}" maxlength="11" inputmode="numeric" pattern="[0-9]{1,11}" title="Solo numeros, maximo 11 digitos" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,11)" onblur="App.views.empresas.validateField('ruc')">
                        <div id="err_ruc" class="form-error"></div></div>
                    <div class="form-group"><label class="form-label">Razon Social <span class="req">*</span></label>
                        <input type="text" class="form-input" id="razon_social" required value="${App.escapeHtml(empresa.razon_social || '')}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Nombre Comercial</label>
                        <input type="text" class="form-input" id="nombre_comercial" value="${App.escapeHtml(empresa.nombre_comercial || '')}"></div>
                    <div class="form-group"><label class="form-label">Correo <span class="req">*</span></label>
                        <input type="email" class="form-input" id="correo" required value="${App.escapeHtml(empresa.correo || '')}" onblur="App.views.empresas.validateField('correo')">
                        <div id="err_correo" class="form-error"></div></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Telefono</label>
                        <input type="text" class="form-input" id="telefono" value="${App.escapeHtml(empresa.telefono || '')}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Rubro <span class="req">*</span></label>
                        <div style="display:flex;gap:6px">
                            <input type="text" class="form-input" id="rubro_display" placeholder="Click en buscar" readonly value="${App.escapeHtml(empresa.rubro || '')}">
                            <input type="hidden" id="id_rubro" value="${empresa.id_rubro || ''}">
                            <button type="button" class="btn" onclick="App.showSelectorModal('Seleccionar Rubro', '/rubros', [{key:'nombre',label:'Rubro'}], (item) => { document.getElementById('id_rubro').value = item.id_rubro; document.getElementById('rubro_display').value = item.nombre; })">🔍</button>
                        </div></div>
                    <div class="form-group"><label class="form-label">Grupo Empresarial</label>
                        <div style="display:flex;gap:6px">
                            <input type="text" class="form-input" id="grupo_display" placeholder="Click en buscar" readonly value="${App.escapeHtml(empresa.grupo || '')}">
                            <input type="hidden" id="id_grupo" value="${empresa.id_grupo || ''}">
                            <button type="button" class="btn" onclick="App.showSelectorModal('Seleccionar Grupo', '/grupos', [{key:'nombre',label:'Grupo'},{key:'descripcion',label:'Desc'}], (item) => { document.getElementById('id_grupo').value = item.id_grupo; document.getElementById('grupo_display').value = item.nombre; })">🔍</button>
                        </div></div>
                </div>
                ${locationLocked
                ? `<section class="location-readonly">
                        <h3>Ubicacion de la sede principal</h3>
                        <p>${App.escapeHtml(empresa.direccion || '-')}</p>
                        <p class="text-muted">${App.escapeHtml(empresa.ubicacion_completa || '-')}</p>
                        <p class="text-sm text-muted">La direccion y la ubicacion se administran desde Sucursales.</p>
                    </section>`
                : `<h3 style="margin-top:20px;margin-bottom:10px;color:var(--c-primary)">Ubicacion Geografica</h3>
                       <div class="form-row">
                           <div class="form-group"><label class="form-label">Pais</label>
                               <select class="form-select" id="id_pais" onchange="App.views.empresas.loadDivisionesHijas(0, 'id_departamento')"><option value="">Cargando...</option></select></div>
                           <div class="form-group"><label class="form-label">Departamento</label>
                               <select class="form-select" id="id_departamento" onchange="App.views.empresas.loadDivisionesHijas(null, 'id_provincia', 'id_departamento')"><option value="">Seleccione pais primero</option></select></div>
                       </div>
                       <div class="form-row">
                           <div class="form-group"><label class="form-label">Provincia</label>
                               <select class="form-select" id="id_provincia" onchange="App.views.empresas.loadDivisionesHijas(null, 'id_distrito', 'id_provincia')"><option value="">Seleccione departamento</option></select></div>
                           <div class="form-group"><label class="form-label">Distrito <span class="req">*</span></label>
                               <select class="form-select" id="id_distrito" required><option value="">Seleccione provincia</option></select></div>
                       </div>
                       ${id ? `<input type="hidden" id="division_actual" value="${Number(empresa.id_division) || ''}">` : ''}
                       <div class="form-group"><label class="form-label">Direccion <span class="req">*</span></label>
                           <input type="text" class="form-input" id="direccion" required value="${App.escapeHtml(empresa.direccion || '')}"></div>
                       <div class="form-group"><label class="form-label">Referencia</label>
                           <input type="text" class="form-input" id="referencia" value="${App.escapeHtml(empresa.referencia || '')}"></div>
                       ${id ? '' : `<div class="form-group"><label><input type="checkbox" id="crear_sede_principal" checked> Registrar esta direccion como sede principal</label></div>`}`}
            </form>`,
            `<button class="btn" onclick="App.closeModal()">Cancelar</button>
             <button class="btn btn-primary" id="btnSaveEmpresa">${id ? 'Guardar' : 'Crear'}</button>`);

        // Cargar paises
        try {
            const paisSelect = document.getElementById('id_pais');
            if (paisSelect) {
                const paises = await App.request('/geografia/paises');
                paisSelect.innerHTML = '<option value="">Seleccione...</option>' +
                    paises.map(p => `<option value="${p.id_pais}">${App.escapeHtml(p.nombre)}</option>`).join('');
            }
            if (!locationLocked && id && empresa.id_division && empresa.id_pais) {
                document.getElementById('id_pais').value = empresa.id_pais;
                const divisions = await App.request(`/geografia/divisiones?id_pais=${empresa.id_pais}`);
                const selectedDivision = divisions.find(d => Number(d.id_division) === Number(empresa.id_division));
                if (selectedDivision) {
                    const divisionType = Number(selectedDivision.id_tipo_division);
                    const province = divisionType === 3
                        ? divisions.find(d => Number(d.id_division) === Number(selectedDivision.id_division_padre))
                        : divisionType === 2 ? selectedDivision : null;
                    const departmentId = divisionType === 1
                        ? selectedDivision.id_division
                        : province?.id_division_padre;
                    await this.loadDivisionesHijas(0, 'id_departamento');
                    if (departmentId) {
                        document.getElementById('id_departamento').value = departmentId;
                        await this.loadDivisionesHijas(null, 'id_provincia', 'id_departamento');
                    }
                    if (province) {
                        document.getElementById('id_provincia').value = province.id_division;
                        await this.loadDivisionesHijas(null, 'id_distrito', 'id_provincia');
                    }
                    if (divisionType === 3) {
                        document.getElementById('id_distrito').value = selectedDivision.id_division;
                    } else if (divisionType === 2) {
                        document.getElementById('id_provincia').value = selectedDivision.id_division;
                    } else if (divisionType === 1) {
                        document.getElementById('id_departamento').value = selectedDivision.id_division;
                    }
                }
            }
        } catch (e) { App.toast('No se pudo cargar la ubicacion geografica', 'error'); }

        document.getElementById('btnSaveEmpresa').addEventListener('click', async () => {
            const data = {
                ruc: document.getElementById('ruc').value,
                razon_social: document.getElementById('razon_social').value,
                nombre_comercial: document.getElementById('nombre_comercial').value,
                correo: document.getElementById('correo').value,
                telefono: document.getElementById('telefono').value,
                id_rubro: parseInt(document.getElementById('id_rubro').value) || null,
                id_grupo: parseInt(document.getElementById('id_grupo').value) || null,
                id_division: locationLocked ? undefined : (
                    parseInt(document.getElementById('id_distrito')?.value) ||
                    parseInt(document.getElementById('id_provincia')?.value) ||
                    parseInt(document.getElementById('id_departamento')?.value) ||
                    parseInt(document.getElementById('division_actual')?.value) || null
                ),
                crear_sede_principal: document.getElementById('crear_sede_principal')?.checked ? 1 : 0,
                direccion: locationLocked ? undefined : document.getElementById('direccion')?.value,
                referencia: locationLocked ? undefined : document.getElementById('referencia')?.value,
            };
            if (!data.ruc || !data.razon_social || !data.correo || (!locationLocked && (!data.direccion || !data.id_division))) {
                App.toast('Complete los datos requeridos y seleccione la ubicacion', 'warning'); return;
            }
            // Validar duplicados
            const existeRuc = await App.validateDuplicate('empresa', 'ruc', data.ruc, id);
            if (existeRuc) { App.toast('El RUC ya existe en otra empresa', 'error'); return; }
            const existeCorreo = await App.validateDuplicate('empresa', 'correo', data.correo, id);
            if (existeCorreo) { App.toast('El correo ya existe en otra empresa', 'error'); return; }

            try {
                if (id) {
                    await App.request(`/empresas/${id}`, { method: 'PUT', body: data });
                    App.toast('Empresa actualizada', 'success');
                } else {
                    await App.request('/empresas', { method: 'POST', body: data });
                    App.toast(data.crear_sede_principal ? 'Empresa creada con sede principal' : 'Empresa creada');
                }
                App.closeModal();
                this.load();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },

    // Cargar divisiones por nivel usando endpoint /divisiones/nivel?nivel=X
    // nivel 1 = departamentos del pais seleccionado
    // nivel 2 = provincias del departamento seleccionado
    // nivel 3 = distritos de la provincia seleccionada
    async loadDivisionesHijas(parentId, targetSelectId, sourceSelectId = null) {
        const targetSel = document.getElementById(targetSelectId);
        if (!targetSel) return;

        // Mapa de selects a nivel
        const niveles = {
            'id_departamento': 1,
            'id_provincia': 2,
            'id_distrito': 3,
        };

        // Limpiar hijos en cascada
        this.clearChildSelects(targetSelectId);

        // Determinar el filtro padre
        let idPais = null, idPadre = null;
        if (targetSelectId === 'id_departamento') {
            idPais = document.getElementById('id_pais')?.value;
            if (!idPais) {
                targetSel.innerHTML = '<option value="">Seleccione pais primero</option>';
                return;
            }
        } else {
            // Para provincia/distrito, usar el select padre
            const sourceSel = document.getElementById(sourceSelectId);
            if (!sourceSel || !sourceSel.value) {
                targetSel.innerHTML = '<option value="">Seleccione el nivel anterior</option>';
                return;
            }
            idPadre = parseInt(sourceSel.value);
        }

        targetSel.innerHTML = '<option value="">Cargando...</option>';
        try {
            let url = '/geografia/divisiones/hijas?id_padre=' + idPadre;
            if (idPais) {
                // Para departamentos, usar /divisiones?id_pais=X y filtrar por tipo=2
                url = '/geografia/divisiones?id_pais=' + idPais;
            }
            const all = await App.request(url);
            // Filtrar por tipo de division segun el target
            const nivel = niveles[targetSelectId];
            let rows = all;
            if (targetSelectId === 'id_departamento') {
                rows = all.filter(d => Number(d.id_tipo_division) === nivel);
            } else if (targetSelectId === 'id_provincia') {
                rows = all.filter(d => Number(d.id_tipo_division) === nivel && Number(d.id_division_padre) === idPadre);
            } else if (targetSelectId === 'id_distrito') {
                rows = all.filter(d => Number(d.id_tipo_division) === nivel && Number(d.id_division_padre) === idPadre);
            }
            targetSel.innerHTML = '<option value="">Seleccione...</option>' +
                rows.map(d => `<option value="${d.id_division}">${App.escapeHtml(d.nombre)}</option>`).join('');
        } catch (e) {
            console.error('loadDivisionesHijas error', e);
            targetSel.innerHTML = '<option value="">Error al cargar</option>';
        }
    },

    clearChildSelects(currentId) {
        const order = ['id_pais', 'id_departamento', 'id_provincia', 'id_distrito'];
        const idx = order.indexOf(currentId);
        for (let i = idx + 1; i < order.length; i++) {
            const sel = document.getElementById(order[i]);
            if (sel) sel.innerHTML = '<option value="">Seleccione nivel anterior</option>';
        }
    },

    async validateField(field) {
        const value = document.getElementById(field).value.trim();
        if (!value) return;
        const existe = await App.validateDuplicate('empresa', field, value);
        const errEl = document.getElementById('err_' + field);
        if (existe) {
            errEl.textContent = '⚠ Ya existe una empresa con este ' + field;
            errEl.style.color = 'var(--c-danger)';
        } else {
            errEl.textContent = '✓ Disponible';
            errEl.style.color = 'var(--c-success)';
        }
    },

    async renderDetail(container, id) {
        container.innerHTML = '<div class="loading-container"><div class="spinner spinner-lg"></div><p>Cargando empresa...</p></div>';
        try {
            const e = await App.request(`/empresas/${id}`);

            // Cargar contactos y sucursales asociados en paralelo
            const [contactosResult, sucursalesResult] = await Promise.allSettled([
                App.request(`/contactos?id_empresa=${id}&filtro_estado=${this.relatedStatus.contactos}`),
                App.request(`/sucursales?id_empresa=${id}&filtro_estado=${this.relatedStatus.sucursales}`),
            ]);
            const contactos = contactosResult.status === 'fulfilled' && Array.isArray(contactosResult.value)
                ? contactosResult.value : [];
            const sucursales = sucursalesResult.status === 'fulfilled' && Array.isArray(sucursalesResult.value)
                ? sucursalesResult.value : [];

            container.innerHTML = `
                <div class="card-header mb-4">
                    <h1 style="color:var(--c-primary)">${App.escapeHtml(e.razon_social)}</h1>
                    <div class="card-actions">
                        <button class="btn" onclick="App.navigate('/empresas')">Volver</button>
                        <button class="btn" id="btnPrintEmpresa" type="button">Imprimir ficha</button>
                        <button class="btn" id="btnExportEmpresa" type="button">Excel CSV</button>
                        ${Number(e.activo) === 1
                    ? `<button class="btn btn-primary" onclick="App.views.empresas.showFormModal(${id})">Editar</button>
                               <button class="btn btn-danger" onclick="App.views.empresas.delete(${id}, '${App.escapeHtml(e.razon_social)}')">Dar de baja</button>`
                    : `<button class="btn btn-primary" onclick="App.views.empresas.reactivate(${id})">Reactivar</button>
                               <button class="btn btn-danger" onclick="App.views.empresas.deletePermanent(${id}, '${App.escapeHtml(e.razon_social)}')">Eliminar definitivamente</button>`}
                    </div>
                </div>
                <div class="card-grid">
                    <div class="card">
                        <div class="card-header"><div class="card-title">Informacion General</div></div>
                        <div style="display:grid;gap:8px;font-size:14px">
                            <div><strong>RUC:</strong> ${App.escapeHtml(e.ruc)}</div>
                            <div><strong>Nombre Comercial:</strong> ${App.escapeHtml(e.nombre_comercial || '-')}</div>
                            <div><strong>Correo:</strong> ${App.escapeHtml(e.correo)}</div>
                            <div><strong>Telefono:</strong> ${App.escapeHtml(e.telefono || '-')}</div>
                            <div><strong>Rubro:</strong> ${App.escapeHtml(e.rubro || '-')}</div>
                            <div><strong>Grupo:</strong> ${App.escapeHtml(e.grupo || '-')}</div>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-header"><div class="card-title">Ubicacion</div></div>
                        <div style="display:grid;gap:8px;font-size:14px">
                            <div><strong>Direccion:</strong> <span class="address-display" title="${App.escapeHtml(e.direccion || '')}">${App.escapeHtml(e.direccion || '-')}</span></div>
                            <div><strong>Referencia:</strong> ${App.escapeHtml(e.referencia || '-')}</div>
                            <div><strong>Ubicacion Completa:</strong> ${App.escapeHtml(e.ubicacion_completa || '-')}</div>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <div class="card-title" data-related-count="sucursales">Sucursales (${sucursales.length})</div>
                        ${this.relatedStatusButtons('sucursales')}
                        ${Number(e.activo) === 1 ? `<button class="btn btn-sm btn-primary" id="btnAddSucursalEmpresa" type="button">+ Agregar Sucursal</button>` : ''}
                    </div>
                    ${sucursalesResult.status === 'rejected' ? App.emptyState('⚠️', 'Sedes no disponibles', sucursalesResult.reason.message) : ''}
                    <div id="company-sucursales-table">${this.relatedTable('sucursales', sucursales)}</div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <div class="card-title" data-related-count="contactos">Contactos (${contactos.length})</div>
                        ${this.relatedStatusButtons('contactos')}
                        ${Number(e.activo) === 1 ? `<button class="btn btn-sm btn-primary" id="btnAddContactoEmpresa" type="button">+ Agregar Contacto</button>` : ''}
                    </div>
                    ${contactosResult.status === 'rejected' ? App.emptyState('⚠️', 'Contactos no disponibles', contactosResult.reason.message) : ''}
                    <div id="company-contactos-table">${this.relatedTable('contactos', contactos)}</div>
                </div>
            `;
            document.getElementById('btnPrintEmpresa').addEventListener('click', () => window.print());
            document.getElementById('btnExportEmpresa').addEventListener('click', () => this.exportDetailToCsv(e, contactos, sucursales));
            document.getElementById('btnAddSucursalEmpresa')?.addEventListener('click', () =>
                App.views.sucursales.showFormModalForEmpresa(id, e.razon_social));
            document.getElementById('btnAddContactoEmpresa')?.addEventListener('click', () =>
                App.views.contactos.showFormModalForEmpresa(id, e.razon_social));
            container.querySelectorAll('[data-related-state]').forEach(button => {
                button.addEventListener('click', () => this.setRelatedStatus(
                    button.dataset.relatedType,
                    button.dataset.relatedState,
                    id
                ));
            });
        } catch (err) { container.innerHTML = App.emptyState('⚠️', 'Error', err.message); }
    },

    relatedStatusButtons(type) {
        const active = this.relatedStatus[type];
        return `<div class="segmented-control" role="group" aria-label="Estado ${type}">
            ${['activas', 'bajas', 'todas'].map(state => `<button type="button" class="segmented-control__item" data-related-type="${type}" data-related-state="${state}" aria-pressed="${active === state}">${state[0].toUpperCase() + state.slice(1)}</button>`).join('')}
        </div>`;
    },

    setRelatedStatus(type, state, id) {
        if (!['sucursales', 'contactos'].includes(type) || !['activas', 'bajas', 'todas'].includes(state)) return;
        this.relatedStatus[type] = state;
        document.querySelectorAll(`[data-related-type="${type}"]`).forEach(button =>
            button.setAttribute('aria-pressed', String(button.dataset.relatedState === state)));
        this.loadRelatedSection(type, id);
    },

    relatedTable(type, rows) {
        const columns = type === 'sucursales'
            ? [
                { key: 'nombre', label: 'Sede' },
                { key: 'pais', label: 'Pais', render: r => App.escapeHtml(r.pais || '-') },
                { key: 'departamento', label: 'Departamento', render: r => App.escapeHtml(r.departamento || '-') },
                { key: 'provincia', label: 'Provincia', render: r => App.escapeHtml(r.provincia || '-') },
                { key: 'distrito', label: 'Distrito', render: r => App.escapeHtml(r.distrito || '-') },
                { key: 'telefono', label: 'Telefono', render: r => App.escapeHtml(r.telefono || '-') },
                { key: 'direccion', label: 'Direccion', render: r => `<span class="address-cell" title="${App.escapeHtml(r.direccion || '')}">${App.escapeHtml(r.direccion || '-')}</span>` },
                { key: 'es_principal', label: 'Principal', render: r => Number(r.es_principal) ? App.badge('Si', 'success') : '-' },
                {
                    key: 'acciones', label: 'Acciones', render: r => Number(r.activo)
                        ? `<button class="btn btn-sm btn-primary" title="Editar sede" aria-label="Editar sede" onclick="App.views.sucursales.showFormModal(${r.id_sucursal})"><i class="bi bi-pencil-square" aria-hidden="true"></i></button> <button class="btn btn-sm btn-danger" title="Dar de baja" aria-label="Dar de baja" onclick="App.views.sucursales.delete(${r.id_sucursal}, '${App.escapeHtml(r.nombre)}')"><i class="bi bi-person-dash" aria-hidden="true"></i></button>`
                        : `<button class="btn btn-sm btn-success" title="Reactivar sede" aria-label="Reactivar sede" onclick="App.views.sucursales.reactivate(${r.id_sucursal})"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i></button> <button class="btn btn-sm btn-danger" title="Eliminar sede definitivamente" aria-label="Eliminar sede definitivamente" onclick="App.views.sucursales.deletePermanent(${r.id_sucursal}, '${App.escapeHtml(r.nombre)}')"><i class="bi bi-trash3" aria-hidden="true"></i></button>`
                },
            ]
            : [
                { key: 'nombres', label: 'Nombre', render: r => App.escapeHtml(`${r.nombres || ''} ${r.apellido_paterno || ''}`.trim()) },
                { key: 'cargo', label: 'Cargo', render: r => App.escapeHtml(r.cargo || '-') },
                { key: 'correo_empresa', label: 'Correo', render: r => App.escapeHtml(r.correo_empresa || '-') },
                { key: 'telefono_empresa', label: 'Telefono', render: r => App.escapeHtml(r.telefono_empresa || '-') },
                { key: 'es_principal', label: 'Principal', render: r => Number(r.es_principal) ? App.badge('Si', 'success') : '-' },
                {
                    key: 'acciones', label: 'Acciones', render: r => Number(r.activo)
                        ? `<button class="btn btn-sm btn-primary" title="Editar contacto" aria-label="Editar contacto" onclick="App.views.contactos.showFormModal(${r.id_empresa_contacto})"><i class="bi bi-pencil-square" aria-hidden="true"></i></button> <button class="btn btn-sm btn-danger" title="Dar de baja" aria-label="Dar de baja" onclick="App.views.contactos.delete(${r.id_empresa_contacto}, '${App.escapeHtml((r.nombres || '') + ' ' + (r.apellido_paterno || ''))}')"><i class="bi bi-person-dash" aria-hidden="true"></i></button>`
                        : `<button class="btn btn-sm btn-success" title="Reactivar contacto" aria-label="Reactivar contacto" onclick="App.views.contactos.reactivate(${r.id_empresa_contacto})"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i></button> <button class="btn btn-sm btn-danger" title="Eliminar contacto definitivamente" aria-label="Eliminar contacto definitivamente" onclick="App.views.contactos.deletePermanent(${r.id_empresa_contacto}, '${App.escapeHtml((r.nombres || '') + ' ' + (r.apellido_paterno || ''))}')"><i class="bi bi-trash3" aria-hidden="true"></i></button>`
                },
            ];
        return App.table({ columns, rows, empty: type === 'sucursales' ? 'Sin sedes asociadas' : 'Sin contactos asociados' });
    },

    async loadRelatedSection(type, id) {
        const target = document.getElementById(`company-${type}-table`);
        if (!target) return;
        target.innerHTML = '<div class="loading-container"><div class="spinner"></div><p>Cargando...</p></div>';
        try {
            const rows = await App.request(`/${type}?id_empresa=${encodeURIComponent(id)}&filtro_estado=${this.relatedStatus[type]}`);
            const data = Array.isArray(rows) ? rows : [];
            const count = document.querySelector(`[data-related-count="${type}"]`);
            if (count) count.textContent = `${type === 'sucursales' ? 'Sedes' : 'Contactos'} (${data.length})`;
            target.innerHTML = this.relatedTable(type, data);
        } catch (error) {
            target.innerHTML = App.emptyState('⚠️', 'Error al cargar', error.message);
        }
    },

    exportDetailToCsv(empresa, contactos, sucursales) {
        const rows = [
            ['FICHA DE EMPRESA'],
            ['Razon social', empresa.razon_social],
            ['RUC', empresa.ruc],
            ['Nombre comercial', empresa.nombre_comercial],
            ['Correo', empresa.correo],
            ['Telefono', empresa.telefono],
            ['Rubro', empresa.rubro],
            ['Grupo', empresa.grupo],
            ['Direccion', empresa.direccion],
            ['Referencia', empresa.referencia],
            ['Ubicacion', empresa.ubicacion_completa],
            [],
            ['SEDES'],
            ['Nombre', 'Telefono', 'Direccion', 'Principal'],
            ...sucursales.map(s => [s.nombre, s.telefono, s.direccion, Number(s.es_principal) ? 'Si' : 'No']),
            [],
            ['CONTACTOS'],
            ['Nombre', 'Cargo', 'Correo', 'Telefono', 'Sede'],
            ...contactos.map(c => [
                `${c.nombres || ''} ${c.apellido_paterno || ''}`.trim(),
                c.cargo, c.correo_empresa, c.telefono_empresa, c.sucursal,
            ]),
        ];
        const csv = '\uFEFF' + rows.map(row => row.map(value =>
            `"${String(value ?? '').replace(/"/g, '""')}"`
        ).join(';')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `empresa_${String(empresa.ruc || empresa.id_empresa).replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    async delete(id, nombre) {
        App.confirmDelete(nombre, async () => {
            try {
                await App.request(`/empresas/${id}`, { method: 'DELETE' });
                App.toast('Empresa dada de baja', 'success');
                if (App.state.currentRoute?.params?.length) App.navigate('/empresas');
                else this.load();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },
    async reactivate(id) {
        try {
            await App.request(`/empresas/${id}/reactivar`, { method: 'PATCH' });
            App.toast('Empresa reactivada', 'success');
            if (App.state.currentRoute?.params?.length) App.navigate('/empresas');
            else this.load();
        } catch (e) { App.toast('Error: ' + e.message, 'error'); }
    },
    deletePermanent(id, nombre) {
        App.confirmDelete(nombre + ' de forma definitiva', async () => {
            try {
                await App.request(`/empresas/${id}?permanente=1`, { method: 'DELETE' });
                App.toast('Empresa eliminada definitivamente', 'success');
                App.navigate('/empresas');
            } catch (e) { App.toast('No se pudo eliminar: ' + e.message, 'error'); }
        });
    },
};

/* ============================================================================
 *  VISTA: SUCURSALES
 * ========================================================================== */
App.views.sucursales = {
    currentFilters: {},
    statusFilter: 'activas',
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4">
                <h1 style="color:var(--c-primary)">Sucursales</h1>
                <div class="card-actions">
                    <div class="segmented-control" role="group" aria-label="Estado de sedes">
                        ${['activas', 'bajas', 'todas'].map(state => `<button type="button" class="segmented-control__item" data-sucursal-state="${state}" aria-pressed="${this.statusFilter === state}">${state[0].toUpperCase() + state.slice(1)}</button>`).join('')}
                    </div>
                    <button class="btn" id="btnSearch">🔍 Buscar</button>
                    <button class="btn btn-primary" id="btnNew">+ Nueva Sucursal</button>
                </div>
            </div>
            <div class="card"><div id="tableContainer"><div class="loading-container"><div class="spinner"></div><p>Cargando...</p></div></div></div>`;
        let empresas = [];
        try { empresas = await App.request('/empresas'); } catch (e) { }
        container.querySelectorAll('[data-sucursal-state]').forEach(button => {
            button.addEventListener('click', () => {
                this.statusFilter = button.dataset.sucursalState;
                container.querySelectorAll('[data-sucursal-state]').forEach(item =>
                    item.setAttribute('aria-pressed', String(item === button)));
                this.load();
            });
        });
        document.getElementById('btnNew').addEventListener('click', () => this.showFormModal(null));
        document.getElementById('btnSearch').addEventListener('click', () => {
            App.showSearchModal('Buscar Sucursales', [
                { name: 'query', label: 'Nombre', placeholder: 'Nombre sucursal...' },
                { name: 'id_empresa', label: 'Empresa', type: 'select', options: empresas.map(e => ({ value: e.id_empresa, label: e.razon_social })) },
            ], (filters) => { this.currentFilters = filters; this.load(); });
        });
        await this.load();
    },

    async load() {
        const params = new URLSearchParams();
        params.set('filtro_estado', this.statusFilter);
        if (this.currentFilters.id_empresa) params.set('id_empresa', this.currentFilters.id_empresa);
        if (this.currentFilters.query) params.set('query', this.currentFilters.query);
        try {
            const rows = await App.request('/sucursales?' + params.toString());
            const columns = [
                { key: 'nombre', label: 'Sucursal' },
                { key: 'empresa', label: 'Empresa', render: r => App.escapeHtml(r.empresa || '-') },
                { key: 'pais', label: 'Pais', render: r => App.escapeHtml(r.pais || '-') },
                { key: 'departamento', label: 'Departamento', render: r => App.escapeHtml(r.departamento || '-') },
                { key: 'provincia', label: 'Provincia', render: r => App.escapeHtml(r.provincia || '-') },
                { key: 'distrito', label: 'Distrito', render: r => App.escapeHtml(r.distrito || '-') },
                { key: 'telefono', label: 'Telefono', render: r => App.escapeHtml(r.telefono || '-') },
                { key: 'direccion', label: 'Direccion', render: r => `<span class="address-cell" title="${App.escapeHtml(r.direccion || '')}">${App.escapeHtml(r.direccion || '-')}</span>` },
                { key: 'es_principal', label: 'Principal', render: r => r.es_principal ? App.badge('Si', 'success') : '-' },
                { key: 'estado', label: 'Estado', render: r => Number(r.activo) ? App.badge('Activa', 'success') : App.badge('De baja', 'muted') },
                {
                    key: 'acciones', label: '', render: r => `
                    ${Number(r.activo)
                            ? `<button class="btn btn-sm btn-primary" title="Editar sede" aria-label="Editar sede" onclick="App.views.sucursales.showFormModal(${r.id_sucursal})"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>
                                    <button class="btn btn-sm btn-danger" title="Dar de baja" aria-label="Dar de baja" onclick="App.views.sucursales.delete(${r.id_sucursal}, '${App.escapeHtml(r.nombre)}')"><i class="bi bi-person-dash" aria-hidden="true"></i></button>`
                            : `<button class="btn btn-sm btn-success" title="Reactivar sede" aria-label="Reactivar sede" onclick="App.views.sucursales.reactivate(${r.id_sucursal})"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i></button>
                                         <button class="btn btn-sm btn-danger" title="Eliminar sede definitivamente" aria-label="Eliminar sede definitivamente" onclick="App.views.sucursales.deletePermanent(${r.id_sucursal}, '${App.escapeHtml(r.nombre)}')"><i class="bi bi-trash3" aria-hidden="true"></i></button>`}`
                },
            ];
            document.getElementById('tableContainer').innerHTML = App.table({ columns, rows, empty: 'No hay sucursales' });
        } catch (e) { document.getElementById('tableContainer').innerHTML = App.emptyState('📍', 'Error', e.message); }
    },

    async showFormModal(id, presetEmpresaId = null, presetEmpresaName = '') {
        let suc = {};
        if (id) {
            try { suc = await App.request(`/sucursales/${id}`); } catch (e) { App.toast('Error al cargar sucursal', 'error'); return; }
        }

        App.showModal(id ? 'Editar Sucursal' : 'Nueva Sucursal',
            `<form id="formSuc">
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Empresa <span class="req">*</span></label>
                        <div style="display:flex;gap:6px">
                            <input type="text" class="form-input" id="empresa_display" placeholder="Click en buscar" readonly value="${App.escapeHtml(suc.empresa || presetEmpresaName)}">
                            <input type="hidden" id="id_empresa" value="${suc.id_empresa || presetEmpresaId || ''}">
                            <button type="button" class="btn" onclick="App.showSelectorModal('Seleccionar Empresa', '/empresas', [{key:'ruc',label:'RUC'},{key:'razon_social',label:'Razon Social'}], (item) => { document.getElementById('id_empresa').value = item.id_empresa; document.getElementById('empresa_display').value = item.razon_social; })">🔍</button>
                        </div></div>
                    <div class="form-group"><label class="form-label">Nombre <span class="req">*</span></label>
                        <input type="text" class="form-input" id="nombre" required value="${App.escapeHtml(suc.nombre || '')}" onblur="App.views.sucursales.validateNombre()">
                        <div id="err_nombre" class="form-error"></div></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Telefono</label>
                        <input type="text" class="form-input" id="telefono" value="${App.escapeHtml(suc.telefono || '')}"></div>
                    <div class="form-group"><label><input type="checkbox" id="es_principal" ${suc.es_principal ? 'checked' : ''}> Sucursal principal</label></div>
                </div>
                <h3 style="margin-top:20px;margin-bottom:10px;color:var(--c-primary)">Ubicacion Geografica</h3>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Pais</label>
                        <select class="form-select" id="id_pais" onchange="App.views.sucursales.loadDivisionesHijas(0, 'id_departamento')">
                            <option value="">Cargando...</option>
                        </select></div>
                    <div class="form-group"><label class="form-label">Departamento</label>
                        <select class="form-select" id="id_departamento" onchange="App.views.sucursales.loadDivisionesHijas(null, 'id_provincia', 'id_departamento')">
                            <option value="">Seleccione pais</option>
                        </select></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Provincia</label>
                        <select class="form-select" id="id_provincia" onchange="App.views.sucursales.loadDivisionesHijas(null, 'id_distrito', 'id_provincia')">
                            <option value="">Seleccione departamento</option>
                        </select></div>
                    <div class="form-group"><label class="form-label">Distrito <span class="req">*</span></label>
                        <select class="form-select" id="id_distrito" required>
                            <option value="">Seleccione provincia</option>
                        </select></div>
                </div>
                ${id ? `<input type="hidden" id="division_actual" value="${Number(suc.id_division) || ''}">` : ''}
                <div class="form-group"><label class="form-label">Direccion <span class="req">*</span></label>
                    <input type="text" class="form-input" id="direccion" required value="${App.escapeHtml(suc.direccion || '')}"></div>
            </form>`,
            `<button class="btn" onclick="App.closeModal()">Cancelar</button>
             <button class="btn btn-primary" id="btnSaveSuc">${id ? 'Guardar' : 'Crear'}</button>`);

        // Cargar paises
        try {
            const paises = await App.request('/geografia/paises');
            document.getElementById('id_pais').innerHTML = '<option value="">Seleccione...</option>' +
                paises.map(p => `<option value="${p.id_pais}">${App.escapeHtml(p.nombre)}</option>`).join('');
            if (id && suc.id_division && suc.id_pais) {
                document.getElementById('id_pais').value = suc.id_pais;
                const divisions = await App.request(`/geografia/divisiones?id_pais=${encodeURIComponent(suc.id_pais)}`);
                const selectedDivision = divisions.find(d => Number(d.id_division) === Number(suc.id_division));
                if (selectedDivision) {
                    const divisionType = Number(selectedDivision.id_tipo_division);
                    const province = divisionType === 3
                        ? divisions.find(d => Number(d.id_division) === Number(selectedDivision.id_division_padre))
                        : divisionType === 2 ? selectedDivision : null;
                    const departmentId = divisionType === 1
                        ? selectedDivision.id_division
                        : province?.id_division_padre;
                    await this.loadDivisionesHijas(0, 'id_departamento');
                    if (departmentId) {
                        document.getElementById('id_departamento').value = departmentId;
                        await this.loadDivisionesHijas(null, 'id_provincia', 'id_departamento');
                    }
                    if (province) {
                        document.getElementById('id_provincia').value = province.id_division;
                        await this.loadDivisionesHijas(null, 'id_distrito', 'id_provincia');
                    }
                    if (divisionType === 3) document.getElementById('id_distrito').value = selectedDivision.id_division;
                    else if (divisionType === 2) document.getElementById('id_provincia').value = selectedDivision.id_division;
                    else if (divisionType === 1) document.getElementById('id_departamento').value = selectedDivision.id_division;
                }
            }
        } catch (e) { }

        document.getElementById('btnSaveSuc').addEventListener('click', async () => {
            const idEmpresa = parseInt(document.getElementById('id_empresa').value);
            const data = {
                id_empresa: idEmpresa,
                nombre: document.getElementById('nombre').value,
                telefono: document.getElementById('telefono').value,
                es_principal: document.getElementById('es_principal').checked ? 1 : 0,
                direccion: document.getElementById('direccion').value,
                referencia: '',
                id_division: parseInt(document.getElementById('id_distrito').value) ||
                    parseInt(document.getElementById('id_provincia').value) ||
                    parseInt(document.getElementById('id_departamento').value) ||
                    parseInt(document.getElementById('division_actual')?.value) || 1,
            };
            if (!data.id_empresa || !data.nombre || !data.direccion) {
                App.toast('Complete los campos requeridos', 'warning'); return;
            }
            // Validar duplicados
            const existe = await App.validateDuplicate('sucursal', 'nombre', data.nombre, id, { id_empresa: data.id_empresa });
            if (existe) { App.toast('Ya existe una sucursal con ese nombre en esta empresa', 'error'); return; }

            try {
                if (id) {
                    await App.request(`/sucursales/${id}`, { method: 'PUT', body: data });
                    App.toast('Sucursal actualizada', 'success');
                } else {
                    await App.request('/sucursales', { method: 'POST', body: data });
                    App.toast('Sucursal creada', 'success');
                }
                App.closeModal();
                const route = App.state.currentRoute;
                if (route?.viewName === 'empresas' && route.params[0]) {
                    App.views.empresas.renderDetail(document.getElementById('appView'), route.params[0]);
                } else {
                    this.load();
                }
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },

    // Si viene desde vista de empresa, pre-setear id_empresa
    showFormModalForEmpresa(empresaId, empresaNombre = '') {
        this.showFormModal(null, empresaId, empresaNombre);
    },

    async loadDivisionesHijas(parentId, targetSelectId, sourceSelectId = null) {
        return App.views.empresas.loadDivisionesHijas.call(this, parentId, targetSelectId, sourceSelectId);
    },
    clearChildSelects(currentId) { App.views.empresas.clearChildSelects(currentId); },

    async validateNombre() {
        const value = document.getElementById('nombre').value.trim();
        if (!value) return;
        const idEmpresa = document.getElementById('id_empresa').value;
        if (!idEmpresa) { App.toast('Seleccione empresa primero', 'warning'); return; }
        const existe = await App.validateDuplicate('sucursal', 'nombre', value, null, { id_empresa: idEmpresa });
        const errEl = document.getElementById('err_nombre');
        if (existe) {
            errEl.textContent = '⚠ Ya existe sucursal con ese nombre en esta empresa';
            errEl.style.color = 'var(--c-danger)';
        } else {
            errEl.textContent = '✓ Disponible';
            errEl.style.color = 'var(--c-success)';
        }
    },

    async delete(id, nombre) {
        App.confirmDelete(nombre, async () => {
            try {
                await App.request(`/sucursales/${id}`, { method: 'DELETE' });
                App.toast('Sede dada de baja', 'success');
                this.refreshCurrentView();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },
    async reactivate(id) {
        try {
            await App.request(`/sucursales/${id}/reactivar`, { method: 'PATCH' });
            App.toast('Sede reactivada', 'success');
            this.refreshCurrentView();
        } catch (e) { App.toast('Error: ' + e.message, 'error'); }
    },
    deletePermanent(id, nombre) {
        App.confirmDelete('sede ' + nombre + ' de forma definitiva', async () => {
            try {
                await App.request(`/sucursales/${id}?permanente=1`, { method: 'DELETE' });
                App.toast('Sede eliminada definitivamente', 'success');
                this.refreshCurrentView();
            } catch (e) { App.toast('No se pudo eliminar: ' + e.message, 'error'); }
        });
    },
    refreshCurrentView() {
        const route = App.state.currentRoute;
        if (route?.viewName === 'empresas' && route.params[0]) {
            App.views.empresas.renderDetail(document.getElementById('appView'), route.params[0]);
        } else {
            this.render(document.getElementById('appView'));
        }
    },
};

/* ============================================================================
 *  VISTA: CONTACTOS
 * ========================================================================== */
App.views.contactos = {
    currentFilters: {},
    statusFilter: 'activas',
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4">
                <h1 style="color:var(--c-primary)">Contactos</h1>
                <div class="card-actions">
                    <div class="segmented-control" role="group" aria-label="Estado de contactos">
                        ${['activas', 'bajas', 'todas'].map(state => `<button type="button" class="segmented-control__item" data-contacto-state="${state}" aria-pressed="${this.statusFilter === state}">${state[0].toUpperCase() + state.slice(1)}</button>`).join('')}
                    </div>
                    <button class="btn" id="btnSearch">🔍 Buscar</button>
                    <button class="btn btn-primary" id="btnNew">+ Nuevo Contacto</button>
                </div>
            </div>
            <div class="card"><div id="tableContainer"><div class="loading-container"><div class="spinner"></div><p>Cargando...</p></div></div></div>`;
        let empresas = [];
        try { empresas = await App.request('/empresas'); } catch (e) { }
        container.querySelectorAll('[data-contacto-state]').forEach(button => {
            button.addEventListener('click', () => {
                this.statusFilter = button.dataset.contactoState;
                container.querySelectorAll('[data-contacto-state]').forEach(item =>
                    item.setAttribute('aria-pressed', String(item === button)));
                this.load();
            });
        });
        document.getElementById('btnNew').addEventListener('click', () => this.showFormModal(null));
        document.getElementById('btnSearch').addEventListener('click', () => {
            App.showSearchModal('Buscar Contactos', [
                { name: 'query', label: 'Nombre o cargo', placeholder: 'Buscar...' },
                { name: 'id_empresa', label: 'Empresa', type: 'select', options: empresas.map(e => ({ value: e.id_empresa, label: e.razon_social })) },
            ], (filters) => { this.currentFilters = filters; this.load(); });
        });
        await this.load();
    },

    async load() {
        const params = new URLSearchParams();
        params.set('filtro_estado', this.statusFilter);
        if (this.currentFilters.id_empresa) params.set('id_empresa', this.currentFilters.id_empresa);
        if (this.currentFilters.query) params.set('query', this.currentFilters.query);
        try {
            const rows = await App.request('/contactos?' + params.toString());
            const columns = [
                { key: 'empresa', label: 'Empresa', render: r => App.escapeHtml(r.empresa || '-') },
                { key: 'nombres', label: 'Nombre', render: r => App.escapeHtml((r.nombres || '') + ' ' + (r.apellido_paterno || '')) },
                { key: 'cargo', label: 'Cargo', render: r => App.escapeHtml(r.cargo || '-') },
                { key: 'correo_empresa', label: 'Correo', render: r => App.escapeHtml(r.correo_empresa || '-') },
                { key: 'telefono_empresa', label: 'Telefono', render: r => App.escapeHtml(r.telefono_empresa || '-') },
                { key: 'es_principal', label: 'Principal', render: r => r.es_principal ? App.badge('Si', 'success') : '-' },
                { key: 'estado_registro', label: 'Estado', render: r => Number(r.activo) ? App.badge('Activo', 'success') : App.badge('De baja', 'muted') },
                {
                    key: 'acciones', label: '', render: r => Number(r.activo)
                        ? `<button class="btn btn-sm btn-primary" title="Editar contacto" aria-label="Editar contacto" onclick="App.views.contactos.showFormModal(${r.id_empresa_contacto})"><i class="bi bi-pencil-square" aria-hidden="true"></i></button> <button class="btn btn-sm btn-danger" title="Dar de baja" aria-label="Dar de baja" onclick="App.views.contactos.delete(${r.id_empresa_contacto}, '${App.escapeHtml((r.nombres || '') + ' ' + (r.apellido_paterno || ''))}')"><i class="bi bi-person-dash" aria-hidden="true"></i></button>`
                        : `<button class="btn btn-sm btn-success" title="Reactivar contacto" aria-label="Reactivar contacto" onclick="App.views.contactos.reactivate(${r.id_empresa_contacto})"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i></button>
                               <button class="btn btn-sm btn-danger" title="Eliminar contacto definitivamente" aria-label="Eliminar contacto definitivamente" onclick="App.views.contactos.deletePermanent(${r.id_empresa_contacto}, '${App.escapeHtml((r.nombres || '') + ' ' + (r.apellido_paterno || ''))}')"><i class="bi bi-trash3" aria-hidden="true"></i></button>`
                },
            ];
            document.getElementById('tableContainer').innerHTML = App.table({ columns, rows, empty: 'No hay contactos' });
        } catch (e) { document.getElementById('tableContainer').innerHTML = App.emptyState('👥', 'Error', e.message); }
    },

    async showFormModal(id, presetEmpresaId = null, presetEmpresaName = '') {
        let empresas = [];
        let contacto = {};
        try {
            empresas = await App.request('/empresas');
            if (id) contacto = await App.request(`/contactos/${id}`);
        } catch (e) { App.toast('Error al cargar catalogos', 'error'); return; }

        const companyName = presetEmpresaName || contacto.empresa ||
            (presetEmpresaId ? empresas.find(e => Number(e.id_empresa) === Number(presetEmpresaId))?.razon_social : '') || '';
        App.showModal(id ? 'Editar Contacto' : 'Nuevo Contacto',
            `<form id="formContacto">
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Empresa <span class="req">*</span></label>
                        <div style="display:flex;gap:6px">
                            <input type="text" class="form-input" id="empresa_display" placeholder="Seleccione empresa" readonly value="${App.escapeHtml(companyName)}">
                            <input type="hidden" id="id_empresa" value="${contacto.id_empresa || presetEmpresaId || ''}">
                            ${id ? '' : `<button type="button" class="btn" onclick="App.showSelectorModal('Seleccionar Empresa', '/empresas', [{key:'ruc',label:'RUC'},{key:'razon_social',label:'Razon Social'}], (item) => { document.getElementById('id_empresa').value = item.id_empresa; document.getElementById('empresa_display').value = item.razon_social; })">🔍</button>`}
                        </div></div>
                    <div class="form-group"><label class="form-label">Tipo de documento</label>
                        <select class="form-select" id="tipo_documento">
                            <option value="" ${!contacto.tipo_documento ? 'selected' : ''}>Sin especificar</option>
                            <option value="DNI" ${contacto.tipo_documento === 'DNI' ? 'selected' : ''}>DNI</option>
                            <option value="RUC" ${contacto.tipo_documento === 'RUC' ? 'selected' : ''}>RUC</option>
                            <option value="CE" ${contacto.tipo_documento === 'CE' ? 'selected' : ''}>CE</option>
                        </select></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Numero de documento</label><input type="text" class="form-input" id="numero_documento" value="${App.escapeHtml(contacto.numero_documento || '')}"></div>
                    <div class="form-group"><label class="form-label">Nombres <span class="req">*</span></label><input type="text" class="form-input" id="nombres" required value="${App.escapeHtml(contacto.nombres || '')}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Apellido paterno <span class="req">*</span></label><input type="text" class="form-input" id="apellido_paterno" required value="${App.escapeHtml(contacto.apellido_paterno || '')}"></div>
                    <div class="form-group"><label class="form-label">Apellido materno</label><input type="text" class="form-input" id="apellido_materno" value="${App.escapeHtml(contacto.apellido_materno || '')}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Correo personal</label><input type="email" class="form-input" id="correo_persona" value="${App.escapeHtml(contacto.correo_personal || '')}"></div>
                    <div class="form-group"><label class="form-label">Telefono</label><input type="text" class="form-input" id="telefono_empresa" value="${App.escapeHtml(contacto.telefono_empresa || '')}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Cargo</label><input type="text" class="form-input" id="cargo" value="${App.escapeHtml(contacto.cargo || '')}"></div>
                    <div class="form-group"><label class="form-label">Correo de empresa</label><input type="email" class="form-input" id="correo_empresa" value="${App.escapeHtml(contacto.correo_empresa || '')}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label><input type="checkbox" id="es_principal" ${contacto.es_principal ? 'checked' : ''}> Contacto principal</label></div>
                </div>
            </form>`,
            `<button class="btn" onclick="App.closeModal()">Cancelar</button>
             <button class="btn btn-primary" id="btnSaveContacto">${id ? 'Guardar cambios' : 'Crear Contacto'}</button>`);

        document.getElementById('btnSaveContacto').addEventListener('click', async () => {
            const data = {
                id_empresa: parseInt(document.getElementById('id_empresa').value),
                tipo_documento: document.getElementById('tipo_documento').value || null,
                numero_documento: document.getElementById('numero_documento').value.trim() || null,
                nombres: document.getElementById('nombres').value.trim(),
                apellido_paterno: document.getElementById('apellido_paterno').value.trim(),
                apellido_materno: document.getElementById('apellido_materno').value.trim() || null,
                correo: document.getElementById('correo_persona').value.trim() || null,
                cargo: document.getElementById('cargo').value,
                correo_empresa: document.getElementById('correo_empresa').value,
                telefono_empresa: document.getElementById('telefono_empresa').value,
                es_principal: document.getElementById('es_principal').checked ? 1 : 0,
                estado: contacto.estado ?? 1,
            };
            if (!data.id_empresa || !data.nombres || !data.apellido_paterno) {
                App.toast('Complete empresa y datos obligatorios del contacto', 'warning'); return;
            }
            try {
                await App.request(id ? `/contactos/${id}` : '/contactos', { method: id ? 'PUT' : 'POST', body: data });
                App.toast(id ? 'Contacto actualizado' : 'Contacto creado', 'success');
                App.closeModal();
                const route = App.state.currentRoute;
                if (route?.viewName === 'empresas' && route.params[0]) {
                    App.views.empresas.renderDetail(document.getElementById('appView'), route.params[0]);
                } else {
                    this.render(document.getElementById('appView'));
                }
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },

    showFormModalForEmpresa(empresaId, empresaNombre = '') { this.showFormModal(null, empresaId, empresaNombre); },

    async delete(id, nombre) {
        App.confirmDelete(nombre, async () => {
            try {
                await App.request(`/contactos/${id}`, { method: 'DELETE' });
                App.toast('Contacto dado de baja', 'success');
                this.refreshCurrentView();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },
    async reactivate(id) {
        try {
            await App.request(`/contactos/${id}/reactivar`, { method: 'PATCH' });
            App.toast('Contacto reactivado', 'success');
            this.refreshCurrentView();
        } catch (e) { App.toast('Error: ' + e.message, 'error'); }
    },
    deletePermanent(id, nombre) {
        App.confirmDelete('contacto ' + nombre + ' de forma definitiva', async () => {
            try {
                await App.request(`/contactos/${id}?permanente=1`, { method: 'DELETE' });
                App.toast('Contacto eliminado definitivamente', 'success');
                this.refreshCurrentView();
            } catch (e) { App.toast('No se pudo eliminar: ' + e.message, 'error'); }
        });
    },
    refreshCurrentView() {
        const route = App.state.currentRoute;
        if (route?.viewName === 'empresas' && route.params[0]) {
            App.views.empresas.renderDetail(document.getElementById('appView'), route.params[0]);
        } else {
            this.render(document.getElementById('appView'));
        }
    },
};

/* ============================================================================
 *  VISTA: USUARIOS (Trabajadores - personal interno que registra tickets)
 * ========================================================================== */
App.views.usuarios = {
    currentFilters: {},
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4">
                <h1 style="color:var(--c-primary)">Trabajadores</h1>
                <div class="card-actions">
                    <button class="btn" id="btnSearch">🔍 Buscar</button>
                    <button class="btn btn-primary" id="btnNew">+ Nuevo Trabajador</button>
                </div>
            </div>
            <div class="card" style="margin-bottom:16px;background:var(--c-card);padding:12px">
                <p class="text-sm text-muted">Trabajadores internos que registran y atienden tickets. No son contactos de empresas externas.</p>
            </div>
            <div class="card"><div id="tableContainer"><div class="loading-container"><div class="spinner"></div><p>Cargando...</p></div></div></div>`;
        document.getElementById('btnNew').addEventListener('click', () => this.showFormModal(null));
        document.getElementById('btnSearch').addEventListener('click', () => {
            App.showSearchModal('Buscar Trabajadores', [
                { name: 'query', label: 'Buscar', placeholder: 'Nombre, documento, correo...' },
            ], (filters) => { this.currentFilters = filters; this.load(); });
        });
        await this.load();
    },

    async load() {
        const search = this.currentFilters.query || '';
        try {
            const rows = await App.request('/personas' + (search ? '?query=' + encodeURIComponent(search) : ''));
            const columns = [
                { key: 'numero_documento', label: 'Documento', render: r => App.escapeHtml(r.numero_documento || '-') },
                { key: 'nombres', label: 'Nombre', render: r => App.escapeHtml((r.nombres || '') + ' ' + (r.apellido_paterno || '')) },
                { key: 'correo', label: 'Correo' },
                { key: 'telefono', label: 'Telefono', render: r => App.escapeHtml(r.telefono || '-') },
                { key: 'estado', label: 'Estado', render: r => r.estado ? App.badge('Activo', 'success') : App.badge('Inactivo', 'muted') },
                {
                    key: 'acciones', label: '', render: r => `
                    <button class="btn btn-sm btn-primary" onclick="App.views.usuarios.showFormModal(${r.id_persona})">Editar</button>
                    <button class="btn btn-sm btn-danger" onclick="App.views.usuarios.delete(${r.id_persona})">Eliminar</button>`
                },
            ];
            document.getElementById('tableContainer').innerHTML = App.table({ columns, rows, empty: 'No hay trabajadores' });
        } catch (e) { document.getElementById('tableContainer').innerHTML = App.emptyState('👤', 'Error', e.message); }
    },

    async showFormModal(id) {
        let roles = [];
        try { roles = await App.request('/permisos/roles'); } catch (e) { }
        let p = {};
        if (id) {
            try { p = await App.request(`/personas/${id}`); } catch (e) { App.toast('Error al cargar', 'error'); return; }
        }

        App.showModal(id ? 'Editar Trabajador' : 'Nuevo Trabajador',
            `<form id="formUsuario">
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Tipo Doc</label>
                        <select class="form-select" id="tipo_documento">
                            <option value="DNI" ${p.tipo_documento == 'DNI' ? 'selected' : ''}>DNI</option>
                            <option value="RUC" ${p.tipo_documento == 'RUC' ? 'selected' : ''}>RUC</option>
                            <option value="CE" ${p.tipo_documento == 'CE' ? 'selected' : ''}>CE</option>
                        </select></div>
                    <div class="form-group"><label class="form-label">Nro Documento</label>
                        <input type="text" class="form-input" id="numero_documento" value="${App.escapeHtml(p.numero_documento || '')}" onblur="App.views.usuarios.validateField('numero_documento')">
                        <div id="err_numero_documento" class="form-error"></div></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Nombres <span class="req">*</span></label><input type="text" class="form-input" id="nombres" required value="${App.escapeHtml(p.nombres || '')}"></div>
                    <div class="form-group"><label class="form-label">Apellido Paterno <span class="req">*</span></label><input type="text" class="form-input" id="apellido_paterno" required value="${App.escapeHtml(p.apellido_paterno || '')}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Correo <span class="req">*</span></label>
                        <input type="email" class="form-input" id="correo" required value="${App.escapeHtml(p.correo || '')}" onblur="App.views.usuarios.validateField('correo')">
                        <div id="err_correo" class="form-error"></div></div>
                    <div class="form-group"><label class="form-label">Telefono</label><input type="text" class="form-input" id="telefono" value="${App.escapeHtml(p.telefono || '')}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label">Rol de Trabajo</label>
                        <select class="form-select" id="id_rol">
                            <option value="">Sin rol</option>
                            ${roles.map(r => `<option value="${r.id_rol}" ${p.id_rol == r.id_rol ? 'selected' : ''}>${App.escapeHtml(r.nombre)}</option>`).join('')}
                        </select></div>
                    <div class="form-group"><label class="form-label">Contrasena ${id ? '(dejar en blanco para mantener)' : ''}</label><input type="password" class="form-input" id="contrasena"></div>
                </div>
            </form>`,
            `<button class="btn" onclick="App.closeModal()">Cancelar</button>
             <button class="btn btn-primary" id="btnSaveUsuario">${id ? 'Guardar' : 'Crear'}</button>`);

        document.getElementById('btnSaveUsuario').addEventListener('click', async () => {
            const data = {
                tipo_documento: document.getElementById('tipo_documento').value,
                numero_documento: document.getElementById('numero_documento').value,
                nombres: document.getElementById('nombres').value,
                apellido_paterno: document.getElementById('apellido_paterno').value,
                apellido_materno: '',
                correo: document.getElementById('correo').value,
                telefono: document.getElementById('telefono').value,
                id_rol: parseInt(document.getElementById('id_rol').value) || null,
            };
            const pass = document.getElementById('contrasena').value;
            if (pass) data.contrasena = pass;
            if (!data.nombres || !data.apellido_paterno || !data.correo) {
                App.toast('Complete los campos requeridos', 'warning'); return;
            }
            // Validar duplicados
            if (data.correo) {
                const existeCorreo = await App.validateDuplicate('persona', 'correo', data.correo, id);
                if (existeCorreo) { App.toast('El correo ya existe', 'error'); return; }
            }
            if (data.numero_documento) {
                const existeDoc = await App.validateDuplicate('persona', 'numero_documento', data.numero_documento, id);
                if (existeDoc) { App.toast('El documento ya existe', 'error'); return; }
            }

            try {
                if (id) {
                    await App.request(`/personas/${id}`, { method: 'PUT', body: data });
                    App.toast('Trabajador actualizado', 'success');
                } else {
                    await App.request('/personas', { method: 'POST', body: data });
                    App.toast('Trabajador creado', 'success');
                }
                App.closeModal();
                this.load();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },

    async validateField(field) {
        const value = document.getElementById(field).value.trim();
        if (!value) return;
        const existe = await App.validateDuplicate('persona', field, value);
        const errEl = document.getElementById('err_' + field);
        if (existe) {
            errEl.textContent = '⚠ Ya existe';
            errEl.style.color = 'var(--c-danger)';
        } else {
            errEl.textContent = '✓ Disponible';
            errEl.style.color = 'var(--c-success)';
        }
    },

    async delete(id) {
        App.confirmDelete('trabajador ID ' + id, async () => {
            try {
                await App.request(`/personas/${id}`, { method: 'DELETE' });
                App.toast('Trabajador desactivado', 'success');
                this.load();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },
};

/* ============================================================================
 *  VISTAS: ATENCIONES, ROLES, REPORTES, etc. (iguales que antes)
 * ========================================================================== */
App.views.atenciones = {
    currentFilters: {},
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4">
                <h1 style="color:var(--c-primary)">Atenciones</h1>
                <div class="card-actions">
                    <button class="btn" id="btnSearch">🔍 Buscar</button>
                    <button class="btn btn-primary" id="btnNewAtencion">+ Nueva atencion</button>
                </div>
            </div>
            <div class="card"><div id="tableContainer"><div class="loading-container"><div class="spinner"></div><p>Cargando...</p></div></div></div>`;
        document.getElementById('btnSearch').addEventListener('click', () => {
            App.showSearchModal('Buscar Atenciones', [
                { name: 'id_ticket', label: 'ID Ticket', type: 'number' },
                {
                    name: 'estado', label: 'Estado', type: 'select', options: [
                        { value: 'EN_PROCESO', label: 'En Proceso' },
                        { value: 'COMPLETADO', label: 'Completado' },
                        { value: 'PAUSADO', label: 'Pausado' },
                    ]
                },
            ], (filters) => { this.currentFilters = filters; this.load(); });
        });
        document.getElementById('btnNewAtencion').addEventListener('click', () => this.showForm(null));
        await this.load();
    },
    async load() {
        const params = new URLSearchParams();
        if (this.currentFilters.id_ticket) params.set('id_ticket', this.currentFilters.id_ticket);
        if (this.currentFilters.estado) params.set('estado', this.currentFilters.estado);
        try {
            const rows = await App.request('/atenciones?' + params.toString());
            const columns = [
                { key: 'nro_ticket', label: 'Ticket', render: r => `<a href="#/tickets/${r.id_ticket}" style="color:var(--c-accent)">${App.escapeHtml(r.nro_ticket)}</a>` },
                { key: 'empresa_nombre', label: 'Empresa', render: r => App.escapeHtml(r.empresa_nombre || '-') },
                { key: 'tecnico_nombre', label: 'Tecnico' },
                { key: 'fecha_inicio', label: 'Fecha', render: r => App.formatDate(r.fecha_inicio) },
                { key: 'duracion_formato', label: 'Duracion', render: r => App.escapeHtml(r.duracion_formato || '-') },
                { key: 'estado', label: 'Estado', render: r => App.badge(r.estado, (r.estado || '').toLowerCase().replace('_', '')) },
                { key: 'detalle_atencion', label: 'Detalle', render: r => App.escapeHtml((r.detalle_atencion || '').substring(0, 80)) },
                { key: 'documentos', label: 'Documentos', render: r => (r.documentos || []).map(d => `<a href="/api/v1/tickets/${Number(r.id_ticket)}/files/${Number(d.id_documento)}">${App.escapeHtml(d.nombre_original)}</a>`).join('<br>') || '<span class="text-muted">Sin documentos</span>' },
                { key: 'acciones', label: 'Acciones', render: r => `<button class="btn btn-sm btn-primary" onclick="App.views.atenciones.showForm(${Number(r.id_atencion)})">Editar</button> <button class="btn btn-sm btn-danger" onclick="App.views.atenciones.delete(${Number(r.id_atencion)}, '${App.escapeHtml(r.nro_ticket)}')">Eliminar</button>` },
            ];
            document.getElementById('tableContainer').innerHTML = App.table({ columns, rows, empty: 'Sin atenciones' });
        } catch (e) { document.getElementById('tableContainer').innerHTML = App.emptyState('⚠️', 'Error', e.message); }
    },
    async showForm(id) {
        let attention = {};
        if (id) {
            try { attention = await App.request(`/atenciones/${id}`); }
            catch (e) { App.toast('Error al cargar atencion', 'error'); return; }
        }
        App.showModal(id ? 'Editar atencion' : 'Nueva atencion',
            `<form id="formAtencion">
                <div class="form-group"><label class="form-label">ID Ticket <span class="req">*</span></label>
                    <input class="form-input" id="atencionTicket" type="number" min="1" required value="${Number(attention.id_ticket || '')}" ${id ? 'readonly' : ''}></div>
                <div class="form-group"><label class="form-label">Detalle <span class="req">*</span></label>
                    <textarea class="form-textarea" id="atencionDetalle" required>${App.escapeHtml(attention.detalle_atencion || '')}</textarea></div>
                <div class="form-group"><label class="form-label">Solucion aplicada</label>
                    <textarea class="form-textarea" id="atencionSolucion">${App.escapeHtml(attention.solucion_aplicada || '')}</textarea></div>
                <div class="form-group"><label class="form-label">Estado</label>
                    <select class="form-select" id="atencionEstado">
                        <option value="EN_PROCESO" ${attention.estado === 'EN_PROCESO' || !attention.estado ? 'selected' : ''}>En proceso</option>
                        <option value="COMPLETADO" ${attention.estado === 'COMPLETADO' ? 'selected' : ''}>Completado</option>
                        <option value="PAUSADO" ${attention.estado === 'PAUSADO' ? 'selected' : ''}>Pausado</option>
                    </select></div>
            </form>`,
            `<button class="btn" onclick="App.closeModal()">Cancelar</button>
             <button class="btn btn-primary" id="btnSaveAtencion">Guardar</button>`);
        document.getElementById('btnSaveAtencion').addEventListener('click', async () => {
            const detalle = document.getElementById('atencionDetalle').value.trim();
            const ticketId = Number(document.getElementById('atencionTicket').value);
            if (!detalle || (!id && (!Number.isInteger(ticketId) || ticketId < 1))) {
                App.toast('Complete el ticket y el detalle', 'warning'); return;
            }
            const body = {
                id_ticket: ticketId,
                detalle_atencion: detalle,
                solucion_aplicada: document.getElementById('atencionSolucion').value.trim() || null,
                estado: document.getElementById('atencionEstado').value,
            };
            try {
                await App.request(id ? `/atenciones/${id}` : '/atenciones', { method: id ? 'PUT' : 'POST', body });
                App.closeModal();
                App.toast(id ? 'Atencion actualizada' : 'Atencion creada', 'success');
                this.load();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },
    delete(id, ticketNumber) {
        App.confirmDelete('atencion del ticket ' + ticketNumber, async () => {
            try {
                await App.request(`/atenciones/${id}`, { method: 'DELETE' });
                App.toast('Atencion eliminada', 'success');
                this.load();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },
};

App.views.seguridad = {
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4">
                <h1 style="color:var(--c-primary)">Roles y Permisos</h1>
                <button class="btn btn-primary" id="btnNewRol">+ Nuevo Rol</button>
            </div>
            <div class="card-grid">
                <div class="card" style="max-width:400px">
                    <div class="card-header"><div class="card-title">Roles</div></div>
                    <div id="rolesList"><div class="loading-container"><div class="spinner"></div></div></div>
                </div>
                <div class="card">
                    <div class="card-header"><div class="card-title">Permisos: <span id="rolNombre" class="text-muted">Seleccione un rol</span></div></div>
                    <div id="permisosContainer"><p class="text-muted">Seleccione un rol.</p></div>
                </div>
            </div>`;
        document.getElementById('btnNewRol').addEventListener('click', () => this.showNewRolModal());
        await this.loadRoles();
    },
    async loadRoles() {
        try {
            const roles = await App.request('/permisos/roles');
            const html = (roles || []).map(r => `
                <div style="padding:10px;border-bottom:1px solid var(--c-border);cursor:pointer" onclick="App.views.seguridad.loadPermisos(${r.id_rol}, '${App.escapeHtml(r.nombre)}')">
                    <div style="display:flex;justify-content:space-between">
                        <strong>${App.escapeHtml(r.nombre)}</strong>
                        <span class="badge badge-info">${r.usuarios_count || 0}</span>
                    </div>
                </div>`).join('');
            document.getElementById('rolesList').innerHTML = html || '<p class="text-muted">Sin roles</p>';
        } catch (e) { document.getElementById('rolesList').innerHTML = App.emptyState('⚠️', 'Error', e.message); }
    },
    async loadPermisos(idRol, nombreRol) {
        document.getElementById('rolNombre').textContent = nombreRol;
        document.getElementById('permisosContainer').innerHTML = '<div class="loading-container"><div class="spinner"></div></div>';
        try {
            const data = await App.request(`/permisos/${idRol}`);
            const modulos = data.modulos || [];
            const permisos = data.permisos || {};
            const acciones = ['ver', 'registrar', 'modificar', 'eliminar', 'aprobar', 'exportar', 'imprimir'];
            let html = `<div class="table-wrap"><table><thead><tr><th>Modulo</th>`;
            acciones.forEach(a => html += `<th style="text-align:center">${a}</th>`);
            html += `</tr></thead><tbody>`;
            modulos.forEach(m => {
                const p = permisos[m.codigo] || {};
                html += `<tr><td><strong>${App.escapeHtml(m.nombre)}</strong></td>`;
                acciones.forEach(a => {
                    const checked = p[a] == 1 ? 'checked' : '';
                    html += `<td style="text-align:center"><input type="checkbox" data-mod="${m.codigo}" data-acc="${a}" ${checked}></td>`;
                });
                html += `</tr>`;
            });
            html += `</tbody></table></div>
                <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
                    <button class="btn" id="btnSelectAll">Marcar Todos</button>
                    <button class="btn btn-primary" id="btnSavePermisos">Guardar Permisos</button>
                </div>`;
            document.getElementById('permisosContainer').innerHTML = html;
            document.getElementById('btnSavePermisos').addEventListener('click', () => this.savePermisos(idRol));
            document.getElementById('btnSelectAll').addEventListener('click', () => {
                document.querySelectorAll('#permisosContainer input[type=checkbox]').forEach(cb => cb.checked = true);
            });
        } catch (e) {
            document.getElementById('permisosContainer').innerHTML = App.emptyState('⚠️', 'Error', e.message);
        }
    },
    async savePermisos(idRol) {
        const permisos = {};
        document.querySelectorAll('#permisosContainer input[type=checkbox]').forEach(cb => {
            const mod = cb.dataset.mod, acc = cb.dataset.acc;
            if (!permisos[mod]) permisos[mod] = {};
            permisos[mod][acc] = cb.checked;
        });
        try {
            await App.request(`/permisos/${idRol}`, { method: 'POST', body: { permisos } });
            App.toast('Permisos guardados', 'success');
        } catch (e) { App.toast('Error: ' + e.message, 'error'); }
    },
    showNewRolModal() {
        App.showModal('Nuevo Rol',
            `<div class="form-group"><label class="form-label">Nombre <span class="req">*</span></label>
                <input type="text" class="form-input" id="rolNombreInput" required></div>
             <div class="form-group"><label class="form-label">Descripcion</label>
                <textarea class="form-textarea" id="rolDescInput"></textarea></div>`,
            `<button class="btn" onclick="App.closeModal()">Cancelar</button>
             <button class="btn btn-primary" id="btnCreateRol">Crear</button>`);
        document.getElementById('btnCreateRol').addEventListener('click', async () => {
            const nombre = document.getElementById('rolNombreInput').value.trim();
            if (!nombre) { App.toast('Nombre requerido', 'warning'); return; }
            try {
                await App.request('/permisos/roles', { method: 'POST', body: { nombre, descripcion: document.getElementById('rolDescInput').value } });
                App.toast('Rol creado', 'success');
                App.closeModal();
                this.loadRoles();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },
};

App.views.reportes = {
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4"><h1 style="color:var(--c-primary)">Reportes</h1></div>
            <div class="card-grid">
                <div class="card"><div class="card-header"><div class="card-title">Tickets por Estado</div></div><div id="rep1"><div class="loading-container"><div class="spinner"></div></div></div></div>
                <div class="card"><div class="card-header"><div class="card-title">Tickets por Prioridad</div></div><div id="rep2"><div class="loading-container"><div class="spinner"></div></div></div></div>
                <div class="card"><div class="card-header"><div class="card-title">Tickets por Empresa</div></div><div id="rep3"><div class="loading-container"><div class="spinner"></div></div></div></div>
                <div class="card"><div class="card-header"><div class="card-title">Atenciones por Tecnico</div></div><div id="rep4"><div class="loading-container"><div class="spinner"></div></div></div></div>
            </div>`;
        await Promise.all([
            this.loadReport('rep1', 'TICKETS_POR_ESTADO'),
            this.loadReport('rep2', 'TICKETS_POR_PRIORIDAD'),
            this.loadReport('rep3', 'TICKETS_POR_EMPRESA'),
            this.loadReport('rep4', 'ATENCIONES_POR_TECNICO'),
        ]);
    },
    async loadReport(containerId, tipo) {
        try {
            const data = await App.request(`/dashboard/series?tipo=${tipo}`);
            const columns = [
                { key: Object.keys(data[0] || {})[0], label: 'Categoria', render: r => App.escapeHtml(r[Object.keys(r)[0]]) },
                { key: 'total', label: 'Total', render: r => App.formatNumber(r.total || r.atenciones || 0) },
            ];
            if (tipo === 'ATENCIONES_POR_TECNICO') {
                columns.push({ key: 'promedio_minutos', label: 'Promedio (min)', render: r => App.formatNumber(r.promedio_minutos || 0, 1) });
            }
            document.getElementById(containerId).innerHTML = App.table({ columns, rows: data, empty: 'Sin datos' });
        } catch (e) {
            document.getElementById(containerId).innerHTML = App.emptyState('⚠️', 'Error', e.message);
        }
    },
};

App.views.paises = {
    async render(container) {
        container.innerHTML = `<div class="card-header mb-4"><h1 style="color:var(--c-primary)">Paises</h1></div>
            <div class="card"><div id="tableContainer"><div class="loading-container"><div class="spinner"></div></div></div></div>`;
        try {
            const rows = await App.request('/geografia/paises');
            const columns = [
                { key: 'id_pais', label: 'ID' },
                { key: 'nombre', label: 'Pais' },
                { key: 'codigo_iso', label: 'Codigo ISO' },
            ];
            document.getElementById('tableContainer').innerHTML = App.table({ columns, rows, empty: 'Sin paises' });
        } catch (e) {
            document.getElementById('tableContainer').innerHTML = App.emptyState('⚠️', 'Error', e.message);
        }
    },
};

App.views.divisiones = {
    currentFilters: {},
    async render(container) {
        container.innerHTML = `<div class="card-header mb-4">
            <h1 style="color:var(--c-primary)">Divisiones Geograficas</h1>
            <div class="card-actions">
                <select class="form-select" id="filterPais" aria-label="Filtrar por pais"><option value="">Todos los paises</option></select>
                <button class="btn btn-primary" id="btnNewDivision"><i class="bi bi-plus-lg" aria-hidden="true"></i> Nueva division</button>
            </div>
        </div>
        <div class="card"><div id="tableContainer"><div class="loading-container"><div class="spinner"></div></div></div></div>`;
        try {
            const paises = await App.request('/geografia/paises');
            document.getElementById('filterPais').innerHTML = '<option value="">Todos los paises</option>' +
                paises.map(country => `<option value="${country.id_pais}">${App.escapeHtml(country.nombre)}</option>`).join('');
        } catch (error) { App.toast('No se pudieron cargar los paises', 'error'); }
        document.getElementById('filterPais').value = this.currentFilters.id_pais || '';
        document.getElementById('filterPais').addEventListener('change', event => {
            this.currentFilters.id_pais = event.target.value;
            this.load();
        });
        document.getElementById('btnNewDivision').addEventListener('click', () => this.showFormModal(null));
        await this.load();
    },
    async load() {
        const idPais = this.currentFilters.id_pais || '';
        try {
            const rows = await App.request('/geografia/divisiones' + (idPais ? '?id_pais=' + idPais : ''));
            const columns = [
                { key: 'nombre', label: 'Nombre' },
                { key: 'id_tipo_division', label: 'Nivel', render: r => this.typeName(Number(r.id_tipo_division)) },
                { key: 'pais', label: 'Pais', render: r => App.escapeHtml(r.pais || '-') },
                { key: 'padre', label: 'Depende de', render: r => App.escapeHtml(r.padre || '-') },
                {
                    key: 'acciones', label: 'Acciones', render: r => `
                    <button class="btn btn-sm btn-primary" title="Editar division" aria-label="Editar division" onclick="App.views.divisiones.showFormModal(${r.id_division})"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>
                    <button class="btn btn-sm btn-danger" title="Eliminar division" aria-label="Eliminar division" onclick="App.views.divisiones.delete(${r.id_division}, '${App.escapeHtml(r.nombre)}')"><i class="bi bi-trash3" aria-hidden="true"></i></button>`
                },
            ];
            document.getElementById('tableContainer').innerHTML = App.table({ columns, rows, empty: 'Sin divisiones' });
        } catch (e) {
            document.getElementById('tableContainer').innerHTML = App.emptyState('⚠️', 'Error', e.message);
        }
    },
    typeName(type) {
        return ({ 1: 'Departamento / Region', 2: 'Provincia', 3: 'Distrito / Municipio' })[type] || 'Desconocido';
    },
    async showFormModal(id) {
        let countries = [], divisions = [], division = null;
        try {
            [countries, divisions] = await Promise.all([
                App.request('/geografia/paises'),
                App.request('/geografia/divisiones'),
            ]);
            if (id) division = divisions.find(row => Number(row.id_division) === Number(id));
            if (id && !division) throw new Error('Division no encontrada');
        } catch (error) { App.toast('No se pudieron cargar los datos geograficos', 'error'); return; }

        App.showModal(id ? 'Editar division geografica' : 'Nueva division geografica',
            `<form id="divisionForm">
                <div class="form-group"><label class="form-label" for="divisionNombre">Nombre <span class="req">*</span></label>
                    <input class="form-input" id="divisionNombre" maxlength="100" required value="${App.escapeHtml(division?.nombre || '')}"></div>
                <div class="form-row">
                    <div class="form-group"><label class="form-label" for="divisionTipo">Nivel <span class="req">*</span></label>
                        <select class="form-select" id="divisionTipo" ${id ? 'disabled' : ''}>
                            ${[1, 2, 3].map(type => `<option value="${type}" ${Number(division?.id_tipo_division || 1) === type ? 'selected' : ''}>${this.typeName(type)}</option>`).join('')}
                        </select></div>
                    <div class="form-group"><label class="form-label" for="divisionPais">Pais <span class="req">*</span></label>
                        <select class="form-select" id="divisionPais">${countries.map(country => `<option value="${country.id_pais}" ${Number(division?.id_pais) === Number(country.id_pais) ? 'selected' : ''}>${App.escapeHtml(country.nombre)}</option>`).join('')}</select></div>
                </div>
                <div class="form-group" id="divisionParentGroup"><label class="form-label" for="divisionParent">Nivel superior <span class="req">*</span></label>
                    <select class="form-select" id="divisionParent"></select></div>
            </form>`,
            `<button class="btn" type="button" onclick="App.closeModal()">Cancelar</button>
             <button class="btn btn-primary" type="button" id="btnSaveDivision"><i class="bi bi-check-lg" aria-hidden="true"></i> Guardar</button>`);

        const typeSelect = document.getElementById('divisionTipo');
        const countrySelect = document.getElementById('divisionPais');
        const parentSelect = document.getElementById('divisionParent');
        const parentGroup = document.getElementById('divisionParentGroup');
        const updateParents = () => {
            const type = Number(typeSelect.value);
            const parentType = type - 1;
            parentGroup.hidden = type === 1;
            if (type === 1) {
                parentSelect.innerHTML = '';
                return;
            }
            const parents = divisions.filter(row => Number(row.id_tipo_division) === parentType &&
                Number(row.id_pais) === Number(countrySelect.value));
            parentSelect.innerHTML = '<option value="">Seleccione...</option>' + parents.map(row =>
                `<option value="${row.id_division}" ${Number(division?.id_division_padre) === Number(row.id_division) ? 'selected' : ''}>${App.escapeHtml(row.nombre)}</option>`
            ).join('');
        };
        typeSelect.addEventListener('change', updateParents);
        countrySelect.addEventListener('change', updateParents);
        updateParents();

        document.getElementById('btnSaveDivision').addEventListener('click', async () => {
            const type = Number(typeSelect.value);
            const parentId = type === 1 ? null : Number(parentSelect.value);
            const body = {
                nombre: document.getElementById('divisionNombre').value.trim(),
                id_tipo_division: type,
                id_pais: Number(countrySelect.value),
                id_division_padre: parentId,
            };
            if (!body.nombre || !body.id_pais || (type > 1 && !parentId)) {
                App.toast('Complete nombre, pais y nivel superior', 'warning'); return;
            }
            try {
                await App.request(id ? `/geografia/divisiones/${id}` : '/geografia/divisiones', {
                    method: id ? 'PUT' : 'POST', body,
                });
                App.closeModal();
                App.toast(id ? 'Division actualizada' : 'Division creada', 'success');
                this.load();
            } catch (error) { App.toast('Error: ' + error.message, 'error'); }
        });
    },
    delete(id, name) {
        App.confirmDelete('division ' + name, async () => {
            try {
                await App.request(`/geografia/divisiones/${id}`, { method: 'DELETE' });
                App.toast('Division eliminada', 'success');
                this.load();
            } catch (error) { App.toast('No se pudo eliminar: ' + error.message, 'error'); }
        });
    },
};

App.views.ubicaciones = App.views.paises;

App.views.rubros = {
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4">
                <h1 style="color:var(--c-primary)">Rubros</h1>
                <button class="btn btn-primary" id="btnNew">+ Nuevo Rubro</button>
            </div>
            <div class="card"><div id="tableContainer"><div class="loading-container"><div class="spinner"></div></div></div></div>`;
        document.getElementById('btnNew').addEventListener('click', () => this.showFormModal(null));
        await this.load();
    },
    async load() {
        try {
            const rows = await App.request('/rubros');
            const columns = [
                { key: 'id_rubro', label: 'ID' },
                { key: 'nombre', label: 'Rubro' },
                {
                    key: 'acciones', label: '', render: r => `
                    <button class="btn btn-sm btn-primary" onclick="App.views.rubros.showFormModal(${r.id_rubro}, '${App.escapeHtml(r.nombre)}')">Editar</button>
                    <button class="btn btn-sm btn-danger" onclick="App.views.rubros.delete(${r.id_rubro}, '${App.escapeHtml(r.nombre)}')">Eliminar</button>`
                },
            ];
            document.getElementById('tableContainer').innerHTML = App.table({ columns, rows, empty: 'Sin rubros' });
        } catch (e) { document.getElementById('tableContainer').innerHTML = App.emptyState('⚠️', 'Error', e.message); }
    },
    showFormModal(id, nombre) {
        App.showModal(id ? 'Editar Rubro' : 'Nuevo Rubro',
            `<div class="form-group"><label class="form-label">Nombre <span class="req">*</span></label>
                <input type="text" class="form-input" id="rubroNombre" required value="${App.escapeHtml(nombre || '')}" onblur="App.views.rubros.validateField()">
                <div id="err_nombre" class="form-error"></div></div>`,
            `<button class="btn" onclick="App.closeModal()">Cancelar</button>
             <button class="btn btn-primary" id="btnSave">Guardar</button>`);
        document.getElementById('btnSave').addEventListener('click', async () => {
            const nombre = document.getElementById('rubroNombre').value.trim();
            if (!nombre) { App.toast('Nombre requerido', 'warning'); return; }
            const existe = await App.validateDuplicate('rubro', 'nombre', nombre, id);
            if (existe) { App.toast('Ya existe un rubro con ese nombre', 'error'); return; }
            try {
                if (id) {
                    await App.request(`/rubros/${id}`, { method: 'PUT', body: { nombre } });
                } else {
                    await App.request('/rubros', { method: 'POST', body: { nombre } });
                }
                App.toast('Rubro guardado', 'success');
                App.closeModal();
                this.load();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },
    async validateField() {
        const value = document.getElementById('rubroNombre').value.trim();
        if (!value) return;
        const existe = await App.validateDuplicate('rubro', 'nombre', value);
        const errEl = document.getElementById('err_nombre');
        if (existe) {
            errEl.textContent = '⚠ Ya existe';
            errEl.style.color = 'var(--c-danger)';
        } else {
            errEl.textContent = '✓ Disponible';
            errEl.style.color = 'var(--c-success)';
        }
    },
    async delete(id, nombre) {
        App.confirmDelete('rubro ' + nombre, async () => {
            try {
                await App.request(`/rubros/${id}`, { method: 'DELETE' });
                App.toast('Rubro eliminado', 'success');
                this.load();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },
};

App.views.grupos = {
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4">
                <h1 style="color:var(--c-primary)">Grupos Empresariales</h1>
                <button class="btn btn-primary" id="btnNew">+ Nuevo Grupo</button>
            </div>
            <div class="card"><div id="tableContainer"><div class="loading-container"><div class="spinner"></div></div></div></div>`;
        document.getElementById('btnNew').addEventListener('click', () => this.showFormModal(null));
        await this.load();
    },
    async load() {
        try {
            const rows = await App.request('/grupos');
            const columns = [
                { key: 'id_grupo', label: 'ID' },
                { key: 'nombre', label: 'Grupo' },
                { key: 'descripcion', label: 'Descripcion', render: r => App.escapeHtml(r.descripcion || '-') },
                {
                    key: 'acciones', label: '', render: r => `
                    <button class="btn btn-sm btn-primary" onclick="App.views.grupos.showFormModal(${r.id_grupo}, '${App.escapeHtml(r.nombre)}', '${App.escapeHtml(r.descripcion || '')}')">Editar</button>
                    <button class="btn btn-sm btn-danger" onclick="App.views.grupos.delete(${r.id_grupo}, '${App.escapeHtml(r.nombre)}')">Eliminar</button>`
                },
            ];
            document.getElementById('tableContainer').innerHTML = App.table({ columns, rows, empty: 'Sin grupos' });
        } catch (e) { document.getElementById('tableContainer').innerHTML = App.emptyState('⚠️', 'Error', e.message); }
    },
    showFormModal(id, nombre, descripcion) {
        App.showModal(id ? 'Editar Grupo' : 'Nuevo Grupo',
            `<div class="form-group"><label class="form-label">Nombre <span class="req">*</span></label>
                <input type="text" class="form-input" id="grupoNombre" required value="${App.escapeHtml(nombre || '')}" onblur="App.views.grupos.validateField()">
                <div id="err_nombre" class="form-error"></div></div>
             <div class="form-group"><label class="form-label">Descripcion</label>
                <textarea class="form-textarea" id="grupoDesc">${App.escapeHtml(descripcion || '')}</textarea></div>`,
            `<button class="btn" onclick="App.closeModal()">Cancelar</button>
             <button class="btn btn-primary" id="btnSave">Guardar</button>`);
        document.getElementById('btnSave').addEventListener('click', async () => {
            const nombre = document.getElementById('grupoNombre').value.trim();
            const descripcion = document.getElementById('grupoDesc').value;
            if (!nombre) { App.toast('Nombre requerido', 'warning'); return; }
            const existe = await App.validateDuplicate('grupo', 'nombre', nombre, id);
            if (existe) { App.toast('Ya existe un grupo con ese nombre', 'error'); return; }
            try {
                if (id) {
                    await App.request(`/grupos/${id}`, { method: 'PUT', body: { nombre, descripcion } });
                } else {
                    await App.request('/grupos', { method: 'POST', body: { nombre, descripcion } });
                }
                App.toast('Grupo guardado', 'success');
                App.closeModal();
                this.load();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },
    async validateField() {
        const value = document.getElementById('grupoNombre').value.trim();
        if (!value) return;
        const existe = await App.validateDuplicate('grupo', 'nombre', value);
        const errEl = document.getElementById('err_nombre');
        if (existe) {
            errEl.textContent = '⚠ Ya existe';
            errEl.style.color = 'var(--c-danger)';
        } else {
            errEl.textContent = '✓ Disponible';
            errEl.style.color = 'var(--c-success)';
        }
    },
    async delete(id, nombre) {
        App.confirmDelete('grupo ' + nombre, async () => {
            try {
                await App.request(`/grupos/${id}`, { method: 'DELETE' });
                App.toast('Grupo eliminado', 'success');
                this.load();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },
};

App.views.motivos = {
    async render(container) {
        container.innerHTML = `<div class="card-header mb-4"><h1 style="color:var(--c-primary)">Motivos de Contacto</h1></div>
            <div class="card"><div id="tableContainer"><div class="loading-container"><div class="spinner"></div></div></div></div>`;
        try {
            const rows = await App.request('/motivos');
            const columns = [
                { key: 'id_motivo', label: 'ID' },
                { key: 'nombre', label: 'Motivo' },
                { key: 'descripcion', label: 'Descripcion', render: r => App.escapeHtml(r.descripcion || '-') },
                { key: 'orden', label: 'Orden' },
            ];
            document.getElementById('tableContainer').innerHTML = App.table({ columns, rows, empty: 'Sin motivos' });
        } catch (e) {
            document.getElementById('tableContainer').innerHTML = App.emptyState('⚠️', 'Error', e.message);
        }
    },
};

App.views.configuracion = {
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4"><h1 style="color:var(--c-primary)">Configuracion</h1></div>
            <div class="card-grid">
                <div class="card"><div class="card-header"><div class="card-title">Informacion del Sistema</div></div>
                    <div style="display:grid;gap:8px;font-size:14px">
                        <div><strong>Version:</strong> 2.0.0</div>
                        <div><strong>PHP:</strong> 8.3.29</div>
                        <div><strong>Servidor:</strong> IIS 10.0</div>
                        <div><strong>Base de Datos:</strong> SQL Server 2025</div>
                    </div>
                </div>
                <div class="card"><div class="card-header"><div class="card-title">Rubros</div></div>
                    <button class="btn btn-primary mt-2" onclick="App.navigate('/rubros')">Gestionar Rubros</button></div>
                <div class="card"><div class="card-header"><div class="card-title">Grupos Empresariales</div></div>
                    <button class="btn btn-primary mt-2" onclick="App.navigate('/grupos')">Gestionar Grupos</button></div>
                <div class="card"><div class="card-header"><div class="card-title">Motivos de Contacto</div></div>
                    <button class="btn btn-primary mt-2" onclick="App.navigate('/motivos')">Ver Motivos</button></div>
            </div>`;
    },
};

App.views.notificaciones = {
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4"><h1 style="color:var(--c-primary)">Notificaciones</h1>
                <div class="card-actions">
                    <button class="btn" id="btnMarkAllRead">Marcar todo leido</button>
                    <button class="btn btn-primary" id="btnRefresh">Actualizar</button>
                </div></div>
            <div class="card"><div id="notifList"><div class="loading-container"><div class="spinner"></div><p>Cargando...</p></div></div></div>`;
        document.getElementById('btnRefresh').addEventListener('click', () => this.render(container));
        document.getElementById('btnMarkAllRead').addEventListener('click', () => this.markAllRead());
        await this.load();
    },
    async load() {
        try {
            const list = await App.request('/notificaciones?limit=50');
            const container = document.getElementById('notifList');
            if (!list || list.length === 0) {
                container.innerHTML = App.emptyState('🔔', 'Sin notificaciones', 'No tienes notificaciones en este momento'); return;
            }
            container.innerHTML = list.map(n => `
                <div style="padding:12px;border-bottom:1px solid var(--c-border);${n.leida == 0 ? 'background:rgba(37,144,198,0.05)' : ''}">
                    <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
                        <div style="flex:1">
                            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
                                <strong>${App.escapeHtml(n.titulo)}</strong>
                                ${n.leida == 0 ? '<span class="badge badge-info">Nueva</span>' : ''}
                            </div>
                            <p class="text-sm text-muted">${App.escapeHtml(n.mensaje)}</p>
                            <p class="text-xs text-muted mt-2">${App.formatDateTime(n.fecha)}</p>
                        </div>
                        ${n.leida == 0 ? `<button class="btn btn-sm" onclick="App.views.notificaciones.markRead(${n.id_notificacion_usuario})">Marcar leida</button>` : ''}
                    </div>
                </div>`).join('');
        } catch (e) { document.getElementById('notifList').innerHTML = App.emptyState('⚠️', 'Error', e.message); }
    },
    async markRead(id) {
        try {
            await App.request(`/notificaciones/${id}/read`, { method: 'POST' });
            this.load();
            App.state.notificationsBadge = Math.max(0, App.state.notificationsBadge - 1);
            App.updateNotificationsBadge();
        } catch (e) { App.toast('Error: ' + e.message, 'error'); }
    },
    async markAllRead() {
        try {
            const list = await App.request('/notificaciones?limit=50');
            for (const n of list) {
                if (n.leida == 0) await App.request(`/notificaciones/${n.id_notificacion_usuario}/read`, { method: 'POST' });
            }
            App.toast('Todas marcadas como leidas', 'success');
            this.load();
            App.state.notificationsBadge = 0;
            App.updateNotificationsBadge();
        } catch (e) { App.toast('Error: ' + e.message, 'error'); }
    },
};

App.views.auditoria = {
    currentFilters: {},
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4"><h1 style="color:var(--c-primary)">Auditoria</h1>
                <button class="btn" id="btnSearch">🔍 Buscar</button></div>
            <div class="card"><div id="auditTable"><div class="loading-container"><div class="spinner"></div><p>Cargando...</p></div></div></div>`;
        document.getElementById('btnSearch').addEventListener('click', () => {
            App.showSearchModal('Buscar en Auditoria', [
                { name: 'tabla', label: 'Tabla', placeholder: 'ticket, persona...' },
                {
                    name: 'operacion', label: 'Operacion', type: 'select', options: [
                        { value: 'INSERT', label: 'Insert' },
                        { value: 'UPDATE', label: 'Update' },
                        { value: 'DELETE', label: 'Delete' },
                    ]
                },
            ], (filters) => { this.currentFilters = filters; this.load(); });
        });
        await this.load();
    },
    async load() {
        const params = new URLSearchParams();
        if (this.currentFilters.tabla) params.set('tabla', this.currentFilters.tabla);
        if (this.currentFilters.operacion) params.set('operacion', this.currentFilters.operacion);
        params.set('limite', '200');
        try {
            const list = await App.request('/auditoria/cambios?' + params.toString());
            const columns = [
                { key: 'fecha_hora', label: 'Fecha', render: r => App.formatDateTime(r.fecha_hora) },
                { key: 'tabla', label: 'Tabla' },
                { key: 'operacion', label: 'Op', render: r => App.badge(r.operacion, r.operacion === 'DELETE' ? 'danger' : r.operacion === 'INSERT' ? 'success' : 'info') },
                { key: 'pk_tabla', label: 'Registro' },
                { key: 'campo', label: 'Campo' },
                { key: 'usuario_nombre', label: 'Usuario' },
                { key: 'ip_origen', label: 'IP' },
            ];
            document.getElementById('auditTable').innerHTML = App.table({ columns, rows: list, empty: 'Sin registros' });
        } catch (e) { document.getElementById('auditTable').innerHTML = App.emptyState('⚠️', 'Error', e.message); }
    },
};

App.views.exportaciones = {
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4"><h1 style="color:var(--c-primary)">Exportaciones</h1>
                <button class="btn btn-primary" id="btnNewExport">+ Nueva Exportacion</button></div>
            <div class="card"><div id="exportsList"><div class="loading-container"><div class="spinner"></div><p>Cargando...</p></div></div></div>`;
        document.getElementById('btnNewExport').addEventListener('click', () => this.showNewModal());
        await this.load();
    },
    async load() {
        try {
            const list = await App.request('/exportaciones');
            const columns = [
                { key: 'id_job', label: 'ID' },
                { key: 'modulo', label: 'Modulo' },
                { key: 'formato', label: 'Formato' },
                { key: 'estado', label: 'Estado', render: r => App.badge(r.estado, r.estado === 'COMPLETADO' ? 'success' : r.estado === 'FALLIDO' ? 'danger' : 'warning') },
                { key: 'total_registros', label: 'Registros' },
                { key: 'fecha_solicitud', label: 'Solicitado', render: r => App.formatDateTime(r.fecha_solicitud) },
                { key: 'acciones', label: '', render: r => r.estado === 'COMPLETADO' && r.ruta_archivo ? `<a class="btn btn-sm btn-primary" href="/api/v1/exportaciones/${r.id_job}/download">Descargar</a>` : '' },
            ];
            document.getElementById('exportsList').innerHTML = App.table({ columns, rows: list, empty: 'Sin exportaciones' });
        } catch (e) { document.getElementById('exportsList').innerHTML = App.emptyState('⚠️', 'Error', e.message); }
    },
    showNewModal() {
        App.showModal('Nueva Exportacion',
            `<div class="form-group"><label class="form-label">Modulo</label>
                <select class="form-select" id="expModulo">
                    <option value="TICKETS">Tickets</option>
                    <option value="ATENCIONES">Atenciones</option>
                    <option value="AUDITORIA">Auditoria</option>
                </select></div>
             <div class="form-group"><label class="form-label">Formato</label>
                <select class="form-select" id="expFormato">
                    <option value="XLSX">Excel (.xlsx)</option>
                    <option value="CSV">CSV (.csv)</option>
                    <option value="JSON">JSON (.json)</option>
                </select></div>`,
            `<button class="btn" onclick="App.closeModal()">Cancelar</button>
             <button class="btn btn-primary" id="btnCreateExport">Crear</button>`);
        document.getElementById('btnCreateExport').addEventListener('click', async () => {
            try {
                await App.request('/exportaciones', {
                    method: 'POST', body: {
                        modulo: document.getElementById('expModulo').value,
                        formato: document.getElementById('expFormato').value,
                    }
                });
                App.toast('Exportacion encolada', 'success');
                App.closeModal();
                this.load();
            } catch (e) { App.toast('Error: ' + e.message, 'error'); }
        });
    },
};

App.views.encuestas = {
    async render(container) {
        container.innerHTML = `
            <div class="card-header mb-4"><h1 style="color:var(--c-primary)">Encuestas de Satisfaccion</h1></div>
            <div class="card"><div class="card-header"><div class="card-title">Reporte</div></div>
                <div id="encuestaReporte"><div class="loading-container"><div class="spinner"></div><p>Cargando...</p></div></div></div>`;
        try {
            const list = await App.request('/encuestas/reporte');
            if (!list || list.length === 0) {
                document.getElementById('encuestaReporte').innerHTML = App.emptyState('📝', 'Sin datos', 'Aun no hay respuestas de encuestas'); return;
            }
            const html = list.map(r => `
                <div style="padding:12px;border-bottom:1px solid var(--c-border)">
                    <div style="font-weight:600;margin-bottom:4px">${App.escapeHtml(r.pregunta)}</div>
                    <div style="display:flex;gap:16px;font-size:14px">
                        <span>Promedio: <strong>${App.formatNumber(r.promedio, 2)}</strong></span>
                        <span>Respuestas: <strong>${r.respuestas}</strong></span>
                    </div>
                </div>`).join('');
            document.getElementById('encuestaReporte').innerHTML = html;
        } catch (e) { document.getElementById('encuestaReporte').innerHTML = App.emptyState('⚠️', 'Error', e.message); }
    },
};

App.views.notFound = {
    render(container, params) {
        const path = params.join('/');
        container.innerHTML = `<div class="card">${App.emptyState('🔍', 'Pagina no encontrada',
            `La ruta <code>${App.escapeHtml(path)}</code> no existe.`,
            '<button class="btn btn-primary" onclick="App.navigate(\'/dashboard\')">Ir al Dashboard</button>')}</div>`;
    },
};
