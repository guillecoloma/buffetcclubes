// =========================================================
// VARIABLES GLOBALES Y SEGURIDAD (TOKENS)
// =========================================================
let tokenGlobal = null;
let carrito = []; 
let metodoSeleccionado = 'Efectivo'; 
let listaProductosGlobal = []; 
let usuarioActual = null; 
let cajaActualId = null; 
let categoriaActiva = 'TODOS'; 
let totalCarritoValor = 0; 
let idProductoEditar = null; 
let ticketCierreDatos = {};

function authH() { return { 'Authorization': 'Bearer ' + tokenGlobal }; }
function authJsonH() { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tokenGlobal }; }

// =========================================================
// AUTENTICACIÓN Y ROLES
// =========================================================
async function intentarLogin() {
    const email = document.getElementById('login-email').value; 
    const password = document.getElementById('login-pass').value;
    try {
        const res = await fetch('/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email, password }) });
        const data = await res.json();
        if(data.success) { 
            usuarioActual = data.user; 
            cajaActualId = data.cajaAbierta; 
            tokenGlobal = data.token; 
            document.getElementById('pantalla-login').style.display = 'none'; 
            configurarInterfazPorRol(); 
        } else { alert(data.mensaje); }
    } catch (e) { alert("Error de conexión al servidor"); }
}

function configurarInterfazPorRol() {
    document.getElementById('panel-dashboard').classList.add('hidden');
    document.getElementById('panel-pos').classList.add('hidden');
    ['btn-clubes', 'btn-deportes', 'btn-usuarios', 'btn-cierre', 'btn-gastos', 'btn-nuevo-prod', 'btn-dash-sport', 'btn-pos-sport'].forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById('header-rol').innerText = usuarioActual.rol;
    document.getElementById('label-usuario-caja').innerText = usuarioActual.nombre;

    if (usuarioActual.rol === 'SYSADMIN') {
        document.getElementById('header-entidad-nombre').innerText = "SaaS Central";
        document.getElementById('main-header').classList.replace('header-gradient-club', 'header-gradient');
        ['btn-clubes', 'btn-deportes', 'btn-usuarios'].forEach(id => document.getElementById(id).classList.remove('hidden'));
        document.getElementById('panel-dashboard').classList.remove('hidden');
        cargarDashboard('HOME');
    } 
    else if (usuarioActual.rol === 'CLUBADMIN') {
        document.getElementById('header-entidad-nombre').innerText = usuarioActual.club_nombre;
        document.getElementById('main-header').classList.replace('header-gradient', 'header-gradient-club');
        ['btn-deportes', 'btn-usuarios'].forEach(id => document.getElementById(id).classList.remove('hidden'));
        document.getElementById('panel-dashboard').classList.remove('hidden');
        cargarDashboard();
    }
    else if (usuarioActual.rol === 'SPORTADMIN') {
        document.getElementById('header-entidad-nombre').innerText = `${usuarioActual.club_nombre} | ${usuarioActual.deporte_nombre}`;
        if(usuarioActual.deporte_logo) { document.getElementById('header-logo').src = usuarioActual.deporte_logo; document.getElementById('header-logo').classList.remove('hidden'); document.getElementById('logo-default').classList.add('hidden'); }
        ['btn-usuarios', 'btn-dash-sport', 'btn-pos-sport'].forEach(id => document.getElementById(id).classList.remove('hidden'));
        verDashboardSport(); 
    }
    else if (usuarioActual.rol === 'CAJERO') {
        document.getElementById('header-entidad-nombre').innerText = `${usuarioActual.club_nombre} | ${usuarioActual.deporte_nombre}`;
        if(usuarioActual.deporte_logo) { document.getElementById('header-logo').src = usuarioActual.deporte_logo; document.getElementById('header-logo').classList.remove('hidden'); document.getElementById('logo-default').classList.add('hidden'); }
        ['btn-cierre', 'btn-gastos', 'btn-nuevo-prod'].forEach(id => document.getElementById(id).classList.remove('hidden'));
        document.getElementById('panel-pos').classList.remove('hidden');
        if (!cajaActualId) abrirModal('modal-apertura'); else { cargarProductos(); setTimeout(() => document.getElementById('buscador').focus(), 300); }
    }
}

function cerrarSesion() { tokenGlobal = null; window.location.reload(); }

// =========================================================
// NAVEGACIÓN Y DASHBOARDS
// =========================================================
function verPOS() {
    document.getElementById('panel-dashboard').classList.add('hidden');
    document.getElementById('panel-pos').classList.remove('hidden');
    ['btn-cierre', 'btn-gastos', 'btn-nuevo-prod'].forEach(id => document.getElementById(id).classList.remove('hidden'));
    if (!cajaActualId) abrirModal('modal-apertura'); else { cargarProductos(); setTimeout(() => document.getElementById('buscador').focus(), 300); }
}

async function verDashboardSport() {
    document.getElementById('panel-pos').classList.add('hidden');
    ['btn-cierre', 'btn-gastos', 'btn-nuevo-prod'].forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById('panel-dashboard').classList.remove('hidden');
    
    const divContenido = document.getElementById('contenido-dashboard');
    divContenido.innerHTML = '<p class="text-center text-slate-400 font-bold mt-10">Calculando finanzas de la subcomisión...</p>';

    try {
        const resStats = await fetch(`/estadisticas-subcomision/${usuarioActual.deporte_id}`, { headers: authH() }); const stats = await resStats.json();
        const resCajas = await fetch(`/cajas-subcomision/${usuarioActual.deporte_id}`, { headers: authH() }); const cajas = await resCajas.json();
        const resMovs = await fetch(`/movimientos/${usuarioActual.deporte_id}`, { headers: authH() }); const movimientos = await resMovs.json();
        const resProds = await fetch(`/productos/${usuarioActual.deporte_id}`, { headers: authH() }); const prods = await resProds.json();
        const prodsBajoStock = prods.filter(p => p.stock <= 10).sort((a,b) => a.stock - b.stock);

        const totalIngresos = stats.ventas_pos + stats.ingresos_extra;
        const totalEgresos = stats.gastos_pos + stats.egresos_extra;
        const neto = totalIngresos - totalEgresos;

        let htmlCajas = cajas.map(c => `<div class="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100 shadow-sm mb-2"><div class="flex items-center gap-4"><div class="w-10 h-10 rounded-full flex items-center justify-center font-black text-xs ${c.estado === 'ABIERTA' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}">${c.estado === 'ABIERTA' ? 'ON' : 'OFF'}</div><div><p class="font-bold text-slate-800 text-sm">${c.cajero_nombre || 'Desconocido'}</p><p class="text-[10px] text-slate-400 mt-0.5">Apertura: ${c.fecha_apertura}</p></div></div><div class="text-right"><p class="font-black text-slate-800">$${c.total_ingresos}</p><p class="text-[10px] text-rose-500 font-bold">Gastos: -$${c.total_gastos}</p></div></div>`).join('');
        if(cajas.length === 0) htmlCajas = '<p class="text-sm text-slate-400 italic p-4">No hay turnos registrados.</p>';

        let htmlMovs = movimientos.map(m => `<div class="flex justify-between items-center p-4 bg-white rounded-2xl border border-slate-100 shadow-sm mb-2 hover:border-slate-300 transition-colors"><div><span class="text-[9px] font-black px-2 py-1 rounded-md uppercase tracking-widest ${m.tipo === 'INGRESO' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}">${m.tipo}</span><p class="font-bold text-slate-800 text-sm mt-1">${m.concepto}</p><p class="text-[9px] text-slate-400 mt-0.5">${m.fecha}</p></div><div class="flex items-center gap-4"><span class="font-black text-lg ${m.tipo === 'INGRESO' ? 'text-emerald-600' : 'text-rose-600'}">${m.tipo === 'INGRESO' ? '+' : '-'}$${m.monto}</span><button onclick="eliminarMovimiento(${m.id})" class="text-rose-300 hover:text-rose-600 transition-colors font-black">X</button></div></div>`).join('');
        if(movimientos.length === 0) htmlMovs = '<p class="text-sm text-slate-400 italic p-4">El libro mayor está vacío.</p>';

        let htmlStock = prodsBajoStock.map(p => `<div class="flex justify-between items-center p-3 bg-rose-50 rounded-xl border border-rose-100 mb-2"><span class="font-bold text-rose-900 text-xs">${p.nombre}</span><span class="bg-rose-500 text-white px-2 py-1 rounded-lg font-black text-[10px]">Stock: ${p.stock}</span></div>`).join('');
        if(prodsBajoStock.length === 0) htmlStock = '<p class="text-sm text-emerald-500 italic p-4 font-bold">Todo el stock está en orden.</p>';

        divContenido.innerHTML = `<div class="mb-8 border-b border-slate-200 pb-6 flex justify-between items-end"><div><h2 class="text-4xl font-black text-slate-800 tracking-tighter">Tesorería General</h2><div class="mt-2 text-slate-500 font-bold">Balance total de la subcomisión (Cajas POS + Libro Mayor)</div></div><button onclick="verDashboardSport()" class="bg-white text-slate-600 px-6 py-3 rounded-xl font-bold shadow-sm border border-slate-200 hover:bg-slate-100 transition-all">🔄 Actualizar</button></div><div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8"><div class="bg-emerald-50 p-6 rounded-[32px] border border-emerald-100 flex flex-col justify-between"><div><span class="text-emerald-600 font-black text-xs uppercase tracking-widest block mb-1">Ingresos Totales</span><span class="text-4xl font-black text-emerald-700">$${totalIngresos}</span></div><div class="mt-4 text-[10px] text-emerald-600/70 font-bold border-t border-emerald-200/50 pt-2 flex justify-between"><span>POS: $${stats.ventas_pos}</span><span>Extras: $${stats.ingresos_extra}</span></div></div><div class="bg-rose-50 p-6 rounded-[32px] border border-rose-100 flex flex-col justify-between"><div><span class="text-rose-600 font-black text-xs uppercase tracking-widest block mb-1">Egresos Totales</span><span class="text-4xl font-black text-rose-700">-$${totalEgresos}</span></div><div class="mt-4 text-[10px] text-rose-600/70 font-bold border-t border-rose-200/50 pt-2 flex justify-between"><span>POS: $${stats.gastos_pos}</span><span>Extras: $${stats.egresos_extra}</span></div></div><div class="bg-slate-900 p-6 rounded-[32px] shadow-xl flex flex-col justify-center"><span class="text-slate-400 font-black text-xs uppercase tracking-widest block mb-2">Balance Neto Actual</span><span class="text-5xl font-black ${neto >= 0 ? 'text-white' : 'text-rose-400'}">$${neto}</span></div></div><div class="grid grid-cols-1 lg:grid-cols-3 gap-8"><div class="lg:col-span-2"><div class="flex justify-between items-end mb-6"><h3 class="font-black text-slate-800 uppercase tracking-widest text-sm flex items-center gap-2">📒 Libro Mayor (Movimientos Extra)</h3><div class="flex gap-2"><button onclick="abrirModalMovimiento('INGRESO')" class="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-4 py-2 rounded-xl font-black text-xs transition-colors">+ Ingreso</button><button onclick="abrirModalMovimiento('EGRESO')" class="bg-rose-100 hover:bg-rose-200 text-rose-700 px-4 py-2 rounded-xl font-black text-xs transition-colors">- Egreso</button></div></div><div class="bg-slate-50 p-4 rounded-[32px] border border-slate-200 shadow-inner h-[400px] overflow-y-auto">${htmlMovs}</div></div><div class="space-y-8"><div><h3 class="font-black text-slate-800 mb-4 uppercase tracking-widest text-sm flex items-center gap-2">🛒 Turnos de Caja (POS)</h3><div class="bg-white p-4 rounded-[32px] border border-slate-200 shadow-sm max-h-[220px] overflow-y-auto">${htmlCajas}</div></div><div><h3 class="font-black text-rose-600 mb-4 uppercase tracking-widest text-sm flex items-center gap-2">⚠️ Alerta Stock Crítico</h3><div class="bg-white p-4 rounded-[32px] border border-slate-200 shadow-sm max-h-[160px] overflow-y-auto">${htmlStock}</div></div></div></div>`;
    } catch (e) { divContenido.innerHTML = '<p class="text-center text-rose-500 font-bold mt-10">Error al cargar métricas.</p>'; }
}

let vistaDashboardActual = null;
async function cargarDashboard(clubIdToView = null) {
    if (clubIdToView === 'HOME') vistaDashboardActual = null; else if (clubIdToView !== null) vistaDashboardActual = clubIdToView;
    const divContenido = document.getElementById('contenido-dashboard'); let url = ''; let titulo = ''; let subtitulo = '';
    
    if (usuarioActual.rol === 'SYSADMIN') {
        if (vistaDashboardActual) { url = `/estadisticas-club/${vistaDashboardActual}`; titulo = `Detalle de Actividades`; subtitulo = `<button onclick="cargarDashboard('HOME')" class="text-blue-600 hover:bg-blue-100 bg-blue-50 px-3 py-1 rounded-lg font-black flex items-center gap-1 transition-colors mt-2">⬅ Volver a Empresas</button>`; } 
        else { url = '/estadisticas-sysadmin'; titulo = "Empresas Clientes"; subtitulo = '<span class="text-slate-500 font-bold mt-2">Resumen financiero global</span>'; }
    } else { url = `/estadisticas-club/${usuarioActual.club_id}`; titulo = "Mis Subcomisiones"; subtitulo = '<span class="text-slate-500 font-bold mt-2">Resumen financiero por deporte</span>'; }
    
    try {
        const res = await fetch(url, { headers: authH() }); const data = await res.json();
        let grillaHTML = '';
        if(data.length === 0) { grillaHTML = '<p class="text-slate-400 italic mt-4">Sin datos registrados.</p>'; } 
        else { grillaHTML = `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">` + data.map(d => { const neto = d.total_ventas - d.total_gastos; let btnEntrar = ''; if (usuarioActual.rol === 'SYSADMIN' && !vistaDashboardActual) { btnEntrar = `<button onclick="cargarDashboard(${d.id})" class="mt-5 w-full bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-600 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all">Ver Actividades ➔</button>`; } return `<div class="bg-white p-6 rounded-[32px] shadow-sm border flex flex-col hover:shadow-lg transition-shadow"><div class="flex items-center gap-4 mb-4"><img src="${d.logo || d.imagen || 'https://via.placeholder.com/50'}" class="w-12 h-12 rounded-xl object-cover"><h3 class="text-xl font-black text-slate-800 leading-tight">${d.nombre}</h3></div><div class="space-y-2 mb-4"><div class="bg-emerald-50 p-3 rounded-xl flex justify-between"><span class="text-[10px] font-bold text-emerald-600">INGRESOS</span><span class="font-black text-emerald-600">$${d.total_ventas}</span></div><div class="bg-rose-50 p-3 rounded-xl flex justify-between"><span class="text-[10px] font-bold text-rose-600">GASTOS</span><span class="font-black text-rose-600">-$${d.total_gastos}</span></div></div><div class="border-t pt-3 flex justify-between items-center"><span class="text-[10px] font-bold text-slate-400">NETO</span><span class="text-2xl font-black ${neto>=0?'text-slate-800':'text-rose-500'}">$${neto}</span></div>${btnEntrar}</div>`; }).join('') + `</div>`; }
        divContenido.innerHTML = `<div class="mb-10 border-b border-slate-200 pb-6 flex justify-between items-end"><div><h2 class="text-4xl font-black text-slate-800 tracking-tighter">${titulo}</h2><div class="mt-2">${subtitulo}</div></div><button onclick="cargarDashboard()" class="bg-white text-slate-600 px-6 py-3 rounded-xl font-bold shadow-sm border border-slate-200 hover:bg-slate-100 transition-all">🔄 Actualizar</button></div>${grillaHTML}`;
    } catch (e) {}
}

// =========================================================
// CRUD MAESTRO (CLUBES, DEPORTES, USUARIOS)
// =========================================================
function abrirModal(id) { document.getElementById(id).classList.replace('hidden', 'flex'); }
function cerrarModalGenerico(id) { document.getElementById(id).classList.replace('flex', 'hidden'); }

function abrirModalClubes() { listarClubes(); abrirModal('modal-clubes'); }
async function listarClubes() { const res = await fetch('/clubes', {headers: authH()}); const data = await res.json(); document.getElementById('lista-clubes-db').innerHTML = data.map(c => `<div class="p-4 bg-slate-50 rounded-2xl mb-2 font-bold flex items-center gap-3 border border-slate-100"><img src="${c.logo}" class="w-8 h-8 rounded shadow-sm object-cover">${c.nombre}</div>`).join(''); }
async function crearClub() { const n = document.getElementById('club-nombre').value, l = document.getElementById('club-logo').value; if(!n) return; await fetch('/clubes', {method:'POST', headers: authJsonH(), body: JSON.stringify({nombre:n, logo:l}) }); listarClubes(); document.getElementById('club-nombre').value=''; document.getElementById('club-logo').value='';}

async function abrirModalDeportes() { const selClub = document.getElementById('dep-club'); const lblClub = document.getElementById('label-dep-club'); if (usuarioActual.rol === 'SYSADMIN') { lblClub.classList.remove('hidden'); selClub.classList.remove('hidden'); const res = await fetch('/clubes', {headers:authH()}); const clubes = await res.json(); selClub.innerHTML = clubes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join(''); } else { lblClub.classList.add('hidden'); selClub.classList.add('hidden'); } listarDeportes(); abrirModal('modal-deportes'); }
async function listarDeportes() { let url = usuarioActual.rol === 'SYSADMIN' ? '/deportes' : `/deportes/${usuarioActual.club_id}`; const res = await fetch(url, {headers:authH()}); const deps = await res.json(); document.getElementById('lista-deportes-db').innerHTML = deps.map(d => `<div class="p-4 bg-slate-50 rounded-2xl mb-2 flex justify-between items-center border border-slate-100 shadow-sm"><div class="flex items-center gap-3"><img src="${d.imagen || 'https://via.placeholder.com/50'}" class="w-8 h-8 rounded-lg object-cover ${d.estado === 'INACTIVO' ? 'grayscale opacity-50' : ''}"><div><b class="text-sm ${d.estado === 'INACTIVO' ? 'text-slate-400 line-through' : 'text-slate-800'}">${d.nombre}</b>${usuarioActual.rol === 'SYSADMIN' && d.club_nombre ? `<p class="text-[10px] text-slate-400 uppercase tracking-widest">${d.club_nombre}</p>` : ''}</div></div>${usuarioActual.rol === 'SYSADMIN' ? `<button onclick="toggleEstadoDeporte(${d.id}, '${d.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO'})" class="text-[10px] font-black px-3 py-1.5 rounded-xl uppercase tracking-widest transition-colors ${d.estado === 'ACTIVO' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-rose-100 text-rose-700 hover:bg-rose-200'}">${d.estado === 'ACTIVO' ? 'Habilitado' : 'Suspendido'}</button>` : `<span class="text-[10px] font-black px-3 py-1.5 rounded-xl uppercase tracking-widest ${d.estado === 'ACTIVO' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">${d.estado}</span>`}</div>`).join(''); }
async function toggleEstadoDeporte(id, nuevoEstado) { if(!confirm(`¿Seguro?`)) return; await fetch(`/deportes/${id}/estado`, { method: 'PUT', headers: authJsonH(), body: JSON.stringify({ estado: nuevoEstado }) }); listarDeportes(); }
async function crearDeporte() { const n = document.getElementById('dep-nombre').value, i = document.getElementById('dep-imagen').value, c = usuarioActual.rol === 'SYSADMIN' ? document.getElementById('dep-club').value : usuarioActual.club_id; if(!n || !c) return alert("Faltan datos"); await fetch('/deportes', { method:'POST', headers: authJsonH(), body: JSON.stringify({nombre:n, imagen:i, club_id: c}) }); listarDeportes(); document.getElementById('dep-nombre').value=''; document.getElementById('dep-imagen').value=''; }

async function abrirModalUsuarios() { const selRol = document.getElementById('user-rol'); if(usuarioActual.rol === 'SYSADMIN') { selRol.innerHTML = `<option value="CLUBADMIN">PRESIDENTE DE CLUB</option><option value="SPORTADMIN">ADMIN SUBCOMISIÓN</option><option value="CAJERO">CAJERO</option>`; const res = await fetch('/clubes', {headers:authH()}); const clubes = await res.json(); document.getElementById('user-club').innerHTML = clubes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join(''); } else if(usuarioActual.rol === 'CLUBADMIN') { selRol.innerHTML = `<option value="SPORTADMIN">ADMIN SUBCOMISIÓN</option><option value="CAJERO">CAJERO</option>`; document.getElementById('user-club').innerHTML = `<option value="${usuarioActual.club_id}">${usuarioActual.club_nombre}</option>`; } else if(usuarioActual.rol === 'SPORTADMIN') { selRol.innerHTML = '<option value="CAJERO">CAJERO</option>'; } await adaptarFormUsuario(); listarUsuarios(); abrirModal('modal-usuarios'); }
async function adaptarFormUsuario() { const rolSel = document.getElementById('user-rol').value; const selClub = document.getElementById('user-club'); const lblClub = document.getElementById('label-club'); const selDep = document.getElementById('user-deporte'); const lblDep = document.getElementById('label-deporte'); if(usuarioActual.rol === 'SYSADMIN') { selClub.classList.remove('hidden'); lblClub.classList.remove('hidden'); } else { selClub.classList.add('hidden'); lblClub.classList.add('hidden'); } if(rolSel === 'CLUBADMIN') { selDep.classList.add('hidden'); lblDep.classList.add('hidden'); } else { if(usuarioActual.rol === 'SPORTADMIN') { selDep.classList.add('hidden'); lblDep.classList.add('hidden'); selDep.innerHTML = `<option value="${usuarioActual.deporte_id}"></option>`; } else { selDep.classList.remove('hidden'); lblDep.classList.remove('hidden'); await cargarDeportesEnSelect(); } } }
async function cargarDeportesEnSelect() { const cid = document.getElementById('user-club').value || usuarioActual.club_id; if(!cid) return; const res = await fetch(`/deportes/${cid}`, {headers:authH()}); const deps = await res.json(); const selDep = document.getElementById('user-deporte'); if(deps.length === 0) selDep.innerHTML = '<option value="">-- Sin deportes --</option>'; else selDep.innerHTML = deps.map(d => `<option value="${d.id}">${d.nombre}</option>`).join(''); }
async function listarUsuarios() { let url = usuarioActual.rol === 'SYSADMIN' ? `/usuarios-all` : `/usuarios/${usuarioActual.club_id}`; const res = await fetch(url, {headers:authH()}); const users = await res.json(); document.getElementById('lista-usuarios-db').innerHTML = users.map(u => `<div class="flex justify-between items-center p-4 bg-white rounded-2xl border border-slate-100 shadow-sm mb-2"><div><b class="text-sm text-slate-800">${u.nombre}</b> <span class="text-[9px] bg-blue-50 text-blue-600 px-2 py-1 rounded-md ml-2 font-black">${u.rol}</span><p class="text-[11px] text-slate-500 mt-1 font-bold">Email de ingreso: <span class="text-slate-800 font-normal">${u.email}</span></p><p class="text-[10px] text-slate-400 mt-1 uppercase">${u.club_nombre || ''} | ${u.deporte_nombre || 'General'}</p></div>${u.rol !== 'SYSADMIN' ? `<button onclick="eliminarUsuario(${u.id})" class="text-rose-500 font-black text-xs hover:bg-rose-50 p-3 rounded-lg">X</button>` : ''}</div>`).join(''); }
async function crearUsuario() { const n = document.getElementById('user-nombre').value, e = document.getElementById('user-email').value, p = document.getElementById('user-pass').value, r = document.getElementById('user-rol').value, c = document.getElementById('user-club').value, d = document.getElementById('user-deporte').value; if(!n || !e || !p) return alert("Faltan datos"); try { const res = await fetch('/usuarios', { method: 'POST', headers: authJsonH(), body: JSON.stringify({ nombre: n, email: e, password: p, rol: r, club_id: c, deporte_id: d }) }); const data = await res.json(); if(data.success){ document.getElementById('user-nombre').value=''; document.getElementById('user-email').value=''; document.getElementById('user-pass').value=''; listarUsuarios(); } else alert("❌ Error: " + data.mensaje); } catch(err) { alert("Error de conexión"); } }
async function eliminarUsuario(id) { if(confirm("¿Eliminar permanentemente?")) { await fetch(`/usuarios/${id}`, {method: 'DELETE', headers:authH()}); listarUsuarios(); } }

// =========================================================
// MOVIMIENTOS Y LIBRO MAYOR
// =========================================================
function abrirModalMovimiento(tipo) {
    document.getElementById('movimiento-tipo').value = tipo; document.getElementById('titulo-movimiento').innerText = tipo === 'INGRESO' ? 'Nuevo Ingreso' : 'Nuevo Egreso'; document.getElementById('icono-movimiento').innerText = tipo === 'INGRESO' ? '💰' : '📉'; document.getElementById('icono-movimiento').className = tipo === 'INGRESO' ? 'w-16 h-16 rounded-full flex items-center justify-center text-3xl mx-auto mb-4 bg-emerald-100' : 'w-16 h-16 rounded-full flex items-center justify-center text-3xl mx-auto mb-4 bg-rose-100'; document.getElementById('btn-guardar-mov').className = tipo === 'INGRESO' ? 'flex-1 text-white py-4 rounded-2xl font-black shadow-lg bg-emerald-500 hover:bg-emerald-600' : 'flex-1 text-white py-4 rounded-2xl font-black shadow-lg bg-rose-500 hover:bg-rose-600';
    document.getElementById('movimiento-concepto').value = ''; document.getElementById('movimiento-monto').value = ''; abrirModal('modal-movimiento');
}
async function guardarMovimiento() {
    const t = document.getElementById('movimiento-tipo').value; const c = document.getElementById('movimiento-concepto').value; const m = document.getElementById('movimiento-monto').value;
    if(!c || !m) return alert("Completa el concepto y el monto.");
    await fetch('/movimientos', { method: 'POST', headers: authJsonH(), body: JSON.stringify({ club_id: usuarioActual.club_id, deporte_id: usuarioActual.deporte_id, tipo: t, concepto: c, monto: m }) });
    cerrarModalGenerico('modal-movimiento'); verDashboardSport();
}
async function eliminarMovimiento(id) { if(confirm("¿Seguro que deseas eliminar este registro?")) { await fetch(`/movimientos/${id}`, { method: 'DELETE', headers: authH() }); verDashboardSport(); } }

// =========================================================
// TERMINAL POS (VENTAS, PRODUCTOS, CAJA)
// =========================================================
async function abrirCaja() { const m = document.getElementById('monto-apertura').value; if(m === '') return alert("Ingresa monto inicial"); const res = await fetch('/abrir-caja', { method: 'POST', headers: authJsonH(), body: JSON.stringify({ usuario_id: usuarioActual.id, monto_inicial: parseFloat(m), club_id: usuarioActual.club_id, deporte_id: usuarioActual.deporte_id }) }); const data = await res.json(); if(data.success) { cajaActualId = data.cajaId; cerrarModalGenerico('modal-apertura'); cargarProductos(); setTimeout(() => document.getElementById('buscador').focus(), 300); } }

function filtrarCategoria(cat) { categoriaActiva = cat; ['TODOS', 'COMIDA', 'BEBIDA', 'OTROS'].forEach(c => { const btn = document.getElementById(`cat-${c}`); if(c === cat) btn.className = "bg-slate-800 text-white px-5 py-2.5 rounded-2xl font-black shadow-md transition-all text-xs uppercase"; else btn.className = "bg-white text-slate-500 border border-slate-200 px-5 py-2.5 rounded-2xl font-black shadow-sm hover:bg-slate-50 transition-all text-xs uppercase"; }); aplicarFiltros(); document.getElementById('buscador').focus(); }
function aplicarFiltros() { const txt = document.getElementById('buscador').value.toLowerCase(); const filtrados = listaProductosGlobal.filter(p => { const matchTxt = p.nombre.toLowerCase().includes(txt); const matchCat = categoriaActiva === 'TODOS' || p.categoria === categoriaActiva; return matchTxt && matchCat; }); renderizarProductos(filtrados); }

async function cargarProductos() { const res = await fetch(`/productos/${usuarioActual.deporte_id}`, {headers:authH()}); listaProductosGlobal = await res.json(); aplicarFiltros(); cargarHistoriales(); renderizarProductosModal(); }
function renderizarProductos(p) { document.getElementById('grilla-productos').innerHTML = p.map(x => { let badge = ''; if(x.categoria === 'COMIDA') badge = '<span class="absolute top-3 left-3 bg-amber-400 text-amber-950 px-2 py-1 text-[9px] font-black rounded-lg uppercase z-20 shadow-sm pointer-events-none">🍔 Comida</span>'; else if(x.categoria === 'BEBIDA') badge = '<span class="absolute top-3 left-3 bg-cyan-400 text-cyan-950 px-2 py-1 text-[9px] font-black rounded-lg uppercase z-20 shadow-sm pointer-events-none">🥤 Bebida</span>'; else badge = '<span class="absolute top-3 left-3 bg-slate-200 text-slate-700 px-2 py-1 text-[9px] font-black rounded-lg uppercase z-20 shadow-sm pointer-events-none">🛒 Otros</span>'; return `<div class="product-card cursor-pointer group select-none relative" onclick="agregarAlCarrito(${x.id}, '${x.nombre}', ${x.precio}, ${x.stock}, '${x.categoria}')">${badge}<button onclick="event.stopPropagation(); abrirModalEditar(${x.id})" class="absolute top-2 right-2 bg-white/90 backdrop-blur text-slate-400 w-8 h-8 flex items-center justify-center rounded-xl shadow-sm z-30 hover:bg-blue-50 hover:text-blue-600 transition-colors border border-slate-100 opacity-0 group-hover:opacity-100" title="Editar Producto">✏️</button><div class="absolute inset-0 bg-blue-600/10 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex items-center justify-center backdrop-blur-[1px] pointer-events-none"><span class="bg-blue-600 text-white font-black text-xs px-5 py-3 rounded-2xl shadow-xl translate-y-4 group-hover:translate-y-0 transition-all uppercase tracking-widest">+ AGREGAR</span></div><img src="${x.imagen || 'https://via.placeholder.com/200'}" class="w-full h-28 object-cover border-b pointer-events-none"><div class="p-4 relative z-0"><h3 class="font-bold text-slate-800 text-xs mb-2 h-8 overflow-hidden pointer-events-none">${x.nombre}</h3><div class="flex justify-between items-end pointer-events-none"><span class="text-xl font-black text-blue-600 leading-none">$${x.precio}</span><span class="text-[9px] font-black text-slate-400 bg-slate-100 px-2 py-1 rounded-md">Stock:${x.stock}</span></div></div></div>` }).join(''); }
function renderizarProductosModal() { const lista = document.getElementById('lista-productos-modal'); if(!lista) return; if(listaProductosGlobal.length === 0) { lista.innerHTML = '<p class="text-xs text-slate-400 italic">No hay productos creados aún.</p>'; return; } lista.innerHTML = listaProductosGlobal.map(p => `<div class="flex justify-between items-center p-3 bg-white rounded-xl border border-slate-200 shadow-sm cursor-pointer hover:border-blue-400 transition-colors group" onclick="abrirModalEditar(${p.id})"><div class="flex items-center gap-3"><img src="${p.imagen || 'https://via.placeholder.com/100'}" class="w-10 h-10 rounded-lg object-cover bg-slate-50"><div><p class="font-bold text-xs text-slate-800 group-hover:text-blue-600 transition-colors">${p.nombre}</p><p class="text-[10px] text-slate-500 mt-0.5"><b class="text-blue-600 font-black">$${p.precio}</b> <span class="mx-1">|</span> Stock: <b>${p.stock}</b></p></div></div><span class="text-[9px] bg-slate-100 text-slate-500 px-2 py-1 rounded-md uppercase font-black tracking-widest">${p.categoria}</span></div>`).join(''); }

function limpiarFormularioProducto() { idProductoEditar = null; document.getElementById('titulo-modal-producto').innerText = "Nuevo Producto"; document.getElementById('prod-nombre').value = ''; document.getElementById('prod-precio').value = ''; document.getElementById('prod-stock').value = ''; document.getElementById('prod-imagen').value = ''; document.getElementById('prod-categoria').value = 'OTROS'; document.getElementById('btn-eliminar-prod').classList.add('hidden'); document.getElementById('prod-nombre').focus(); }
function abrirModalNuevo() { limpiarFormularioProducto(); abrirModal('modal-producto'); }
function abrirModalEditar(id) { const p = listaProductosGlobal.find(x => x.id === id); if(!p) return; idProductoEditar = id; document.getElementById('titulo-modal-producto').innerText = "Editar Producto"; document.getElementById('prod-nombre').value = p.nombre; document.getElementById('prod-precio').value = p.precio; document.getElementById('prod-stock').value = p.stock; document.getElementById('prod-imagen').value = p.imagen; document.getElementById('prod-categoria').value = p.categoria; document.getElementById('btn-eliminar-prod').classList.remove('hidden'); abrirModal('modal-producto'); }
async function guardarProducto() { const n = document.getElementById('prod-nombre').value, p = document.getElementById('prod-precio').value, s = document.getElementById('prod-stock').value, i = document.getElementById('prod-imagen').value, c = document.getElementById('prod-categoria').value; if(!n || !p || !s) return alert("⚠️ Completa Nombre, Precio y Stock."); if (idProductoEditar) { await fetch(`/productos/${idProductoEditar}`, { method: 'PUT', headers: authJsonH(), body: JSON.stringify({ nombre: n, precio: p, stock: s, imagen: i, categoria: c }) }); } else { await fetch('/productos', { method: 'POST', headers: authJsonH(), body: JSON.stringify({ nombre: n, precio: p, stock: s, imagen: i, categoria: c, club_id: usuarioActual.club_id, deporte_id: usuarioActual.deporte_id }) }); } await cargarProductos(); limpiarFormularioProducto(); }
async function eliminarProducto() { if(!idProductoEditar) return; if(confirm("⚠️ ¿Eliminar permanentemente?")) { await fetch(`/productos/${idProductoEditar}`, { method: 'DELETE', headers: authH() }); await cargarProductos(); limpiarFormularioProducto(); } }

function agregarAlCarrito(id, nombre, precio, stock, categoria) { const item = carrito.find(x => x.id === id); if(item) { if(item.cantidad < stock) item.cantidad++; else alert("Sin stock suficiente"); } else { if(stock > 0) carrito.push({id, nombre, precio, cantidad: 1, stockMax: stock, categoria: categoria || 'OTROS'}); else alert("Sin stock"); } actualizarCarrito(); }
function actualizarCarrito() { const lista = document.getElementById('lista-carrito'); let t = 0; if(!carrito.length) { lista.innerHTML = '<div class="h-full flex flex-col items-center justify-center opacity-30 mt-6"><span class="text-4xl mb-2">🛒</span><p class="font-bold text-sm">Carrito Vacío</p></div>'; document.getElementById('total-carrito').innerText = '$0'; document.getElementById('btn-confirmar').disabled = true; totalCarritoValor = 0; gestionarCalculadoraVuelto(); return; } document.getElementById('btn-confirmar').disabled = false; lista.innerHTML = carrito.map((x, i) => { t += x.precio * x.cantidad; let icono = x.categoria === 'COMIDA' ? '🍔' : (x.categoria === 'BEBIDA' ? '🥤' : '🏷️'); return `<div class="flex justify-between items-center bg-white p-2.5 rounded-2xl border border-slate-200 shadow-sm gap-2"><div class="flex gap-2 items-center min-w-0 flex-1"><span class="text-base bg-slate-50 p-1.5 rounded-xl border">${icono}</span><div class="min-w-0 flex-1"><p class="font-bold text-[11px] truncate text-slate-800">${x.nombre}</p><p class="text-blue-600 font-black text-sm">$${x.precio}</p></div></div><div class="flex gap-1 items-center bg-slate-100 p-1 rounded-xl border border-slate-200 shrink-0"><button onclick="cambiarCantidad(${i},-1)" class="w-6 h-6 bg-white rounded-lg shadow-sm font-black text-slate-600 hover:text-rose-500 transition-colors">-</button><span class="font-black text-xs w-4 text-center select-none">${x.cantidad}</span><button onclick="cambiarCantidad(${i},1)" class="w-6 h-6 bg-white rounded-lg shadow-sm font-black text-slate-600 hover:text-emerald-500 transition-colors">+</button></div></div>`; }).join(''); totalCarritoValor = t; document.getElementById('total-carrito').innerText = `$${t}`; gestionarCalculadoraVuelto(); }
function cambiarCantidad(i, d) { if(d > 0 && carrito[i].cantidad >= carrito[i].stockMax) return; carrito[i].cantidad += d; if(carrito[i].cantidad <= 0) carrito.splice(i, 1); actualizarCarrito(); }

function gestionarCalculadoraVuelto() { const panel = document.getElementById('panel-vuelto'); if (totalCarritoValor > 0 && metodoSeleccionado === 'Efectivo') { panel.classList.remove('hidden'); panel.classList.add('flex'); let sugerencias = new Set(); let redondeoMil = Math.ceil(totalCarritoValor / 1000) * 1000; if(redondeoMil >= totalCarritoValor) sugerencias.add(redondeoMil); if(totalCarritoValor <= 2000) sugerencias.add(2000); if(totalCarritoValor <= 5000) sugerencias.add(5000); if(totalCarritoValor <= 10000) sugerencias.add(10000); if(totalCarritoValor <= 20000) sugerencias.add(20000); let htmlBotones = Array.from(sugerencias).sort((a,b)=>a-b).map(b => `<button onclick="setPagaCon(${b})" class="bg-white border border-slate-200 px-2 py-1 rounded border-b-2 font-black text-[9px] text-slate-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 transition-colors shadow-sm">$${b}</button>`).join(''); document.getElementById('botones-billetes').innerHTML = htmlBotones; calcularVuelto(document.getElementById('input-paga-con').value); } else { panel.classList.add('hidden'); panel.classList.remove('flex'); } }
function setPagaCon(monto) { document.getElementById('input-paga-con').value = monto; calcularVuelto(monto); }
function calcularVuelto(pagaCon) { const paga = parseInt(pagaCon) || 0; const vuelto = paga - totalCarritoValor; const label = document.getElementById('label-vuelto'); if (vuelto >= 0 && paga > 0) { label.innerText = `$${vuelto}`; label.classList.replace('text-rose-500', 'text-emerald-500'); } else { label.innerText = `$0`; label.classList.replace('text-emerald-500', 'text-rose-500'); } }
function setMetodo(m) { metodoSeleccionado = m; document.getElementById('pago-efectivo').className = m === 'Efectivo' ? "relative py-2.5 rounded-xl border-2 border-blue-600 bg-blue-50 text-blue-700 font-black shadow-sm transition-all text-xs" : "relative py-2.5 rounded-xl border-2 border-transparent bg-slate-100 text-slate-500 font-black shadow-sm transition-all text-xs"; document.getElementById('pago-transf').className = m === 'Transferencia' ? "relative py-2.5 rounded-xl border-2 border-blue-600 bg-blue-50 text-blue-700 font-black shadow-sm transition-all text-xs" : "relative py-2.5 rounded-xl border-2 border-transparent bg-slate-100 text-slate-500 font-black shadow-sm transition-all text-xs"; gestionarCalculadoraVuelto(); document.getElementById('buscador').focus(); }

document.addEventListener('keydown', function(e) { const modales = ['modal-apertura', 'modal-clubes', 'modal-deportes', 'modal-usuarios', 'modal-producto', 'modal-gasto', 'modal-cierre', 'modal-movimiento']; const algunModalAbierto = modales.some(id => document.getElementById(id) && document.getElementById(id).classList.contains('flex')); if(algunModalAbierto) return; if (e.key === 'F1') { e.preventDefault(); setMetodo('Efectivo'); } if (e.key === 'F2') { e.preventDefault(); setMetodo('Transferencia'); } if (e.key === 'Escape') { e.preventDefault(); carrito = []; document.getElementById('input-paga-con').value = ''; actualizarCarrito(); document.getElementById('buscador').focus(); } if (e.key === 'Enter') { if(document.activeElement.id === 'input-paga-con') return; if (carrito.length > 0 && !document.getElementById('btn-confirmar').disabled) { e.preventDefault(); confirmarVenta(); } } });

async function confirmarVenta() { if (!cajaActualId) return; const res = await fetch('/confirmar-venta', { method: 'POST', headers: authJsonH(), body: JSON.stringify({ items: carrito, metodoPago: metodoSeleccionado, caja_id: cajaActualId, club_id: usuarioActual.club_id, deporte_id: usuarioActual.deporte_id }) }); const data = await res.json(); if(data.success) { generarTicketVenta(); setTimeout(() => { window.print(); carrito = []; document.getElementById('input-paga-con').value = ''; actualizarCarrito(); cargarProductos(); document.getElementById('ticket-impresion').style.display = 'none'; document.getElementById('buscador').focus(); }, 500); } }

// =========================================================
// TICKET TÉRMICO CON CORTE DE PAPEL
// =========================================================
function generarTicketVenta() { 
    const t = document.getElementById('ticket-impresion'); 
    const fechaStr = new Date().toLocaleString('es-AR'); 
    let totalGeneral = 0; 
    const comidas = carrito.filter(i => i.categoria === 'COMIDA'); 
    const bebidas = carrito.filter(i => i.categoria === 'BEBIDA'); 
    const otros = carrito.filter(i => i.categoria !== 'COMIDA' && i.categoria !== 'BEBIDA'); 
    
    let htmlTicket = ''; 
    
    // TICKET BEBIDAS (BARRA)
    if (bebidas.length > 0) { 
        let itemsBebida = bebidas.map(x => { 
            totalGeneral += (x.precio*x.cantidad); 
            return `<div class="ticket-item"><span>${x.cantidad}x ${x.nombre.substring(0,18)}</span></div>`; 
        }).join(''); 
        htmlTicket += `
            <div class="ticket-section">
                <div class="ticket-title">TICKET BEBIDA 🥤</div>
                <div style="text-align:center; font-size:10px; margin-bottom:5px;">${fechaStr}</div>
                ${itemsBebida}
            </div>
            <div class="cut-line">✂ - CORTE AQUI - ✂</div>`; 
    } 
    
    // TICKET COMIDAS (COCINA)
    if (comidas.length > 0) { 
        let itemsComida = comidas.map(x => { 
            totalGeneral += (x.precio*x.cantidad); 
            return `<div class="ticket-item"><span>${x.cantidad}x ${x.nombre.substring(0,18)}</span></div>`; 
        }).join(''); 
        htmlTicket += `
            <div class="ticket-section">
                <div class="ticket-title">TICKET COMIDA 🍔</div>
                <div style="text-align:center; font-size:10px; margin-bottom:5px;">${fechaStr}</div>
                ${itemsComida}
            </div>
            <div class="cut-line">✂ - CORTE AQUI - ✂</div>`; 
    } 
    
    otros.forEach(x => { totalGeneral += (x.precio*x.cantidad); }); 
    
    // TICKET CLIENTE (COMPROBANTE GENERAL)
    htmlTicket += `
        <div style="margin-top:10px; text-align:center;">
            <h3 style="margin:0; font-size:16px; font-weight:bold;">${usuarioActual.club_nombre}</h3>
            <p style="margin:0; font-size:12px;">${usuarioActual.deporte_nombre}</p>
        </div>
        <div style="margin-top:10px; font-size:14px;">
            <p style="margin:2px 0;"><b>FECHA:</b> ${fechaStr}</p>
            <p style="margin:2px 0;"><b>PAGO:</b> ${metodoSeleccionado.toUpperCase()}</p>
            <p style="margin:2px 0;"><b>CAJERO:</b> ${usuarioActual.nombre}</p>
        </div>
        <div style="border-top:2px solid #000; margin-top:10px; padding-top:5px; display:flex; justify-content:space-between; font-size:20px; font-weight:900;">
            <span>TOTAL</span><span>$${totalGeneral}</span>
        </div>
        <p style="text-align:center; font-size:10px; margin-top:20px;">Válido únicamente para la fecha de emisión.</p>
    `; 
    
    t.style.display = 'block'; 
    t.innerHTML = htmlTicket; 
}

function abrirModalGasto() { if(!cajaActualId) return alert("Abre caja primero"); document.getElementById('gasto-desc').value=''; document.getElementById('gasto-monto').value=''; abrirModal('modal-gasto'); }
async function guardarGasto() { const d = document.getElementById('gasto-desc').value, m = document.getElementById('gasto-monto').value; if(!d || !m) return; await fetch('/gastos', { method: 'POST', headers: authJsonH(), body: JSON.stringify({ descripcion: d, monto: m, caja_id: cajaActualId, club_id: usuarioActual.club_id, deporte_id: usuarioActual.deporte_id }) }); cerrarModalGenerico('modal-gasto'); cargarHistoriales(); }

async function cargarHistoriales() { if(!cajaActualId) return; const resV = await fetch(`/historial-ventas/${cajaActualId}`, {headers:authH()}); const resG = await fetch(`/historial-gastos/${cajaActualId}`, {headers:authH()}); const vts = await resV.json(); const gst = await resG.json(); document.getElementById('tabla-ventas').innerHTML = vts.slice(0,5).map(v => `<div class="flex justify-between p-3 bg-slate-50 rounded-xl border text-xs"><b>$${v.total}</b><span class="text-slate-400 font-bold">${v.metodoPago}</span></div>`).join('') || '<p>Vacio</p>'; document.getElementById('tabla-gastos').innerHTML = gst.slice(0,5).map(g => `<div class="flex justify-between p-3 bg-rose-50 rounded-xl border text-rose-900 text-xs"><b>$${g.monto}</b><span>${g.descripcion}</span></div>`).join('') || '<p>Vacio</p>'; }

async function verCierreCaja() { 
    const res = await fetch(`/resumen-caja/${cajaActualId}`, {headers:authH()}); const data = await res.json(); 
    let totalEfectivo = 0; let totalTransferencia = 0;
    data.ventas.forEach(v => { if(v.metodo === 'Efectivo') totalEfectivo += v.total; if(v.metodo === 'Transferencia') totalTransferencia += v.total; }); 
    const apertura = data.apertura || 0; const gastos = data.gastos || 0;
    const efectivoEnCaja = (apertura + totalEfectivo) - gastos;
    const totalFacturado = totalEfectivo + totalTransferencia;

    ticketCierreDatos = { apertura, totalEfectivo, gastos, efectivoEnCaja, totalTransferencia, totalFacturado };

    document.getElementById('detalle-cierre').innerHTML = `
        <h3 class="font-black text-center mb-6 text-2xl text-slate-800 tracking-tight">Cierre de Turno</h3>
        <div class="space-y-3 mb-4 bg-slate-50 p-5 rounded-2xl border border-slate-200">
            <div class="flex justify-between items-center text-sm font-bold text-slate-500 pb-2 border-b border-slate-200"><span>Fondo Inicial de Caja</span><span>$${apertura}</span></div>
            <div class="flex justify-between items-center text-sm font-black text-blue-600"><span>+ Ventas Efectivo</span><span>$${totalEfectivo}</span></div>
            <div class="flex justify-between items-center text-sm font-black text-rose-500 pb-2 border-b border-slate-200"><span>- Gastos / Retiros</span><span>-$${gastos}</span></div>
            <div class="flex justify-between items-center text-xl font-black text-emerald-600 pt-2"><span>EFECTIVO EN CAJÓN</span><span>$${efectivoEnCaja}</span></div>
        </div>
        <div class="space-y-2 mb-6 bg-slate-100 p-4 rounded-xl border border-slate-200">
            <div class="flex justify-between items-center text-xs font-bold text-slate-500"><span>Ventas por Transferencia</span><span>$${totalTransferencia}</span></div>
            <div class="flex justify-between items-center text-sm font-black text-slate-800 pt-2 border-t border-slate-300"><span>TOTAL FACTURADO</span><span>$${totalFacturado}</span></div>
        </div>
    `; 
    document.getElementById('botones-cierre-modal').innerHTML = `<div class="flex gap-2"><button onclick="cerrarModalGenerico('modal-cierre')" class="flex-1 bg-slate-200 text-slate-600 py-4 rounded-xl font-black hover:bg-slate-300 transition-colors">Volver</button><button onclick="ejecutarCierreDefinitivo()" class="flex-[2] bg-slate-900 text-white py-4 rounded-xl font-black shadow-lg hover:bg-rose-600 transition-colors">🔒 CERRAR TURNO</button></div>`;
    abrirModal('modal-cierre'); 
}

async function ejecutarCierreDefinitivo() {
    if(confirm("⚠️ ¿Estás seguro de CERRAR EL TURNO? Ya no podrás registrar más ventas ni gastos.")) {
        const res = await fetch(`/cerrar-caja/${cajaActualId}`, { method: 'PUT', headers:authH() });
        const data = await res.json();
        if(data.success) { imprimirCierreTicket(); setTimeout(() => { window.location.reload(); }, 1000); } 
        else { alert("Error al cerrar la caja."); }
    }
}

function imprimirCierreTicket() { const t = document.getElementById('ticket-impresion'); t.style.display = 'block'; t.innerHTML = `<div style="text-align:center; margin-bottom:15px;"><h2 style="margin:0; font-size: 16px; font-weight: bold;">CIERRE DE TURNO</h2><p style="margin:2px 0; font-size: 10px;">${new Date().toLocaleString('es-AR')}</p><p style="margin:2px 0; font-size: 10px; font-weight: bold;">CAJERO: ${usuarioActual.nombre.toUpperCase()}</p></div><div style="border-top:1px dashed #000; padding-top:10px; font-size:12px;"><div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Fondo Inicial:</span> <span>$${ticketCierreDatos.apertura}</span></div><div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Ventas Efectivo:</span> <span>$${ticketCierreDatos.totalEfectivo}</span></div><div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Gastos/Retiros:</span> <span>-$${ticketCierreDatos.gastos}</span></div><div style="display:flex; justify-content:space-between; margin-top:5px; border-top:1px solid #000; padding-top:5px; font-weight:bold; font-size:14px;"><span>EFECTIVO EN CAJA:</span> <span>$${ticketCierreDatos.efectivoEnCaja}</span></div></div><div style="border-top:1px dashed #000; margin-top:10px; padding-top:10px; font-size:12px;"><div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>Transferencias:</span> <span>$${ticketCierreDatos.totalTransferencia}</span></div><div style="display:flex; justify-content:space-between; margin-top:5px; border-top:1px solid #000; padding-top:5px; font-weight:bold;"><span>TOTAL FACTURADO:</span> <span>$${ticketCierreDatos.totalFacturado}</span></div></div><div style="text-align:center; font-size:10px; margin-top:30px; border-top:1px dashed #000; padding-top:20px;">Firma Responsable<br><br><br>___________________________</div>`; window.print(); t.style.display = 'none'; }
function toggleHistorial() { document.getElementById('contenedor-historial').classList.toggle('abierto'); }