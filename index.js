const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const compression = require('compression'); 
const rateLimit = require('express-rate-limit'); 
const path = require('path');
const multer = require('multer');

// LIBRERÍAS DE SEGURIDAD EMPRESARIAL
const helmet = require('helmet'); 
const sanitizeHtml = require('sanitize-html'); 

const app = express();
app.use(helmet({ contentSecurityPolicy: false })); 
app.use(compression());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: { success: false, mensaje: "Tráfico inusual detectado." } });
app.use(limiter);

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { success: false, mensaje: "IP bloqueada temporalmente." }});

app.use(express.static('public')); 
app.use(express.json({ limit: '1mb' })); 

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); 

const limpiar = (texto) => {
    if (typeof texto !== 'string') return texto;
    return sanitizeHtml(texto, { allowedTags: [], allowedAttributes: {} }).trim(); 
};

const JWT_SECRET = process.env.JWT_SECRET || 'SuperFirmaSecretaBuffet2024';
const DB_PATH = process.env.DB_PATH || './buffet.db'; 
let db;

(async () => {
    try {
        db = await open({ filename: DB_PATH, driver: sqlite3.Database });
        console.log(`🛠️ Base de datos conectada.`);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS clubes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE, logo TEXT, estado TEXT DEFAULT 'ACTIVO');
            CREATE TABLE IF NOT EXISTS deportes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, imagen TEXT, club_id INTEGER, estado TEXT DEFAULT 'ACTIVO');
            CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, email TEXT UNIQUE, password TEXT, rol TEXT, club_id INTEGER, deporte_id INTEGER);
            CREATE TABLE IF NOT EXISTS productos (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, precio REAL, stock INTEGER, imagen TEXT, categoria TEXT DEFAULT 'OTROS', club_id INTEGER, deporte_id INTEGER);
            CREATE TABLE IF NOT EXISTS cajas (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, club_id INTEGER, deporte_id INTEGER, monto_apertura REAL, fecha_apertura DATETIME DEFAULT (datetime('now', 'localtime')), estado TEXT DEFAULT 'ABIERTA');
            CREATE TABLE IF NOT EXISTS ventas (id INTEGER PRIMARY KEY AUTOINCREMENT, caja_id INTEGER, club_id INTEGER, deporte_id INTEGER, total REAL, metodoPago TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')), estado_entrega TEXT DEFAULT 'ENTREGADO', codigo_retiro TEXT);
            CREATE TABLE IF NOT EXISTS gastos (id INTEGER PRIMARY KEY AUTOINCREMENT, caja_id INTEGER, club_id INTEGER, deporte_id INTEGER, descripcion TEXT, monto REAL, tipo TEXT DEFAULT 'GASTO', fecha DATETIME DEFAULT (datetime('now', 'localtime')));
            CREATE TABLE IF NOT EXISTS movimientos (id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER, deporte_id INTEGER, tipo TEXT, concepto TEXT, monto REAL, cuenta_origen TEXT DEFAULT 'EFECTIVO', cuenta_destino TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')));
            CREATE TABLE IF NOT EXISTS ventas_detalles (id INTEGER PRIMARY KEY AUTOINCREMENT, venta_id INTEGER, producto_nombre TEXT, cantidad INTEGER);
            CREATE TABLE IF NOT EXISTS comentarios (id INTEGER PRIMARY KEY AUTOINCREMENT, deporte_id INTEGER, autor TEXT, mensaje TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')));
        `);

        // LIMPIEZA PROFUNDA DE LA DEMO
        await db.run('DELETE FROM clubes WHERE id = 9999 OR nombre = "CLUB DEMOSTRACIÓN"');
        await db.run('DELETE FROM deportes WHERE id = 9999 OR nombre = "BUFFET INTERACTIVO"');
        await db.run('DELETE FROM usuarios WHERE email IN ("cajero@demo.com", "admin@demo.com")');
        await db.run('DELETE FROM productos WHERE club_id = 9999');
        await db.run('DELETE FROM cajas WHERE club_id = 9999');
        await db.run('DELETE FROM ventas WHERE club_id = 9999');
        await db.run('DELETE FROM gastos WHERE club_id = 9999');
        await db.run('DELETE FROM movimientos WHERE club_id = 9999');

        // RECONSTRUCCIÓN DEL ENTORNO DEMO CON SALDOS COHERENTES
        await db.run('INSERT INTO clubes (id, nombre, logo, estado) VALUES (9999, "CLUB DEMOSTRACIÓN", "https://cdn-icons-png.flaticon.com/512/8082/8082801.png", "ACTIVO")');
        await db.run('INSERT INTO deportes (id, nombre, imagen, club_id, estado) VALUES (9999, "BUFFET INTERACTIVO", "https://cdn-icons-png.flaticon.com/512/3075/3075977.png", 9999, "ACTIVO")');

        const hashedDemoPass = await bcrypt.hash("demo123", 10);
        await db.run('INSERT INTO usuarios (nombre, email, password, rol, club_id, deporte_id) VALUES (?, ?, ?, ?, ?, ?)', ["Cajero Demo", "cajero@demo.com", hashedDemoPass, "CAJERO", 9999, 9999]);
        await db.run('INSERT INTO usuarios (nombre, email, password, rol, club_id, deporte_id) VALUES (?, ?, ?, ?, ?, ?)', ["Presidente Demo", "admin@demo.com", hashedDemoPass, "SPORTADMIN", 9999, 9999]);

        // PRODUCTOS PARA EL SIMULADOR
        const prods = [
            ["Hamburguesa Completa", 5000, 100, "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=300", "COMIDA"],
            ["Papas Fritas", 3000, 100, "https://images.unsplash.com/photo-1576107232684-1279f390859f?w=300", "COMIDA"],
            ["Gaseosa 500ml", 2200, 100, "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=300", "BEBIDA"],
            ["Cerveza Lata", 2800, 100, "https://images.unsplash.com/photo-1584225064785-c62a8b438148?w=300", "BEBIDA"],
            ["Vaso Térmico Club", 8500, 50, "https://images.unsplash.com/photo-1517254456976-ee8682099819?w=300", "OTROS"],
            ["Súper Choripán", 4500, 100, "https://images.unsplash.com/photo-1628191137573-dee64e727614?w=300", "COMIDA"]
        ];
        for (let p of prods) { await db.run('INSERT INTO productos (nombre, precio, stock, imagen, categoria, club_id, deporte_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [...p, 9999, 9999]); }

        // ==============================================================================
        // MOVIMIENTOS INICIALES TRANSPARENTES (TODO EN EL LIBRO MAYOR PARA PODER BORRARSE)
        // ==============================================================================
        
        // 1. Ingreso de Efectivo ($20.000)
        await db.run('INSERT INTO movimientos (club_id, deporte_id, tipo, concepto, monto, cuenta_origen, cuenta_destino) VALUES (?, ?, ?, ?, ?, ?, ?)', [9999, 9999, 'INGRESO', 'Fondo de Caja para Cambio', 20000, 'EFECTIVO', null]);
        
        // 2. Ingreso de Banco ($50.000)
        await db.run('INSERT INTO movimientos (club_id, deporte_id, tipo, concepto, monto, cuenta_origen, cuenta_destino) VALUES (?, ?, ?, ?, ?, ?, ?)', [9999, 9999, 'INGRESO', 'Sponsor Temporada 2026', 50000, 'BANCO', null]);
        
        // 3. Egreso de Efectivo ($15.000) - AHORA ES UN EGRESO VISIBLE EN EL PANEL
        await db.run('INSERT INTO movimientos (club_id, deporte_id, tipo, concepto, monto, cuenta_origen, cuenta_destino) VALUES (?, ?, ?, ?, ?, ?, ?)', [9999, 9999, 'EGRESO', 'Compra de Pan y Carne', 15000, 'EFECTIVO', null]);

        console.log("✅ Servidor Seguro Iniciado. Movimientos 100% transparentes.");
    } catch (error) { console.error("❌ Error:", error); }
})();

const verificarToken = (req, res, next) => { 
    const authHeader = req.headers['authorization']; 
    if (!authHeader) return res.status(403).json({ success: false, mensaje: "No hay token." }); 
    const token = authHeader.split(' ')[1]; 
    jwt.verify(token, JWT_SECRET, (err, decoded) => { 
        if (err) return res.status(401).json({ success: false }); 
        req.usuarioVerificado = decoded; 
        next(); 
    }); 
};

// =======================================================
// ESTADÍSTICAS (BLINDADAS)
// =======================================================
app.get('/estadisticas-subcomision/:deporteId', verificarToken, async (req, res) => { 
    try { 
        const id = req.params.deporteId;
        const vEf = await db.get(`SELECT SUM(total) as t FROM ventas WHERE deporte_id = ? AND metodoPago = 'Efectivo'`, [id]);
        const vBa = await db.get(`SELECT SUM(total) as t FROM ventas WHERE deporte_id = ? AND metodoPago = 'Transferencia'`, [id]);
        const g = await db.get(`SELECT SUM(monto) as t FROM gastos WHERE deporte_id = ? AND (tipo = 'GASTO' OR tipo IS NULL)`, [id]); 
        const movs = await db.all(`SELECT cuenta_origen, cuenta_destino, tipo, SUM(monto) as t FROM movimientos WHERE deporte_id = ? GROUP BY cuenta_origen, cuenta_destino, tipo`, [id]);
        
        let saldo_efectivo = (vEf.t || 0) - (g.t || 0); 
        let saldo_banco = (vBa.t || 0); 
        let saldo_mutual = 0;

        movs.forEach(m => {
            if (m.tipo === 'INGRESO') {
                if (m.cuenta_origen === 'EFECTIVO') saldo_efectivo += m.t;
                if (m.cuenta_origen === 'BANCO') saldo_banco += m.t;
                if (m.cuenta_origen === 'MUTUAL') saldo_mutual += m.t;
            } else if (m.tipo === 'EGRESO') {
                if (m.cuenta_origen === 'EFECTIVO') saldo_efectivo -= m.t;
                if (m.cuenta_origen === 'BANCO') saldo_banco -= m.t;
                if (m.cuenta_origen === 'MUTUAL') saldo_mutual -= m.t;
            } else if (m.tipo === 'TRANSFERENCIA') {
                if (m.cuenta_origen === 'EFECTIVO') saldo_efectivo -= m.t;
                if (m.cuenta_origen === 'BANCO') saldo_banco -= m.t;
                if (m.cuenta_origen === 'MUTUAL') saldo_mutual -= m.t;
                
                if (m.cuenta_destino === 'EFECTIVO') saldo_efectivo += m.t;
                if (m.cuenta_destino === 'BANCO') saldo_banco += m.t;
                if (m.cuenta_destino === 'MUTUAL') saldo_mutual += m.t;
            }
        });

        res.json({ saldo_efectivo, saldo_banco, saldo_mutual, total: saldo_efectivo + saldo_banco + saldo_mutual }); 
    } catch (e) { 
        console.error("Error stats:", e);
        res.status(500).json({ error: "Error interno" }); 
    } 
});

// =======================================================
// RESUMEN DE CAJA (CORRECCIÓN CRÍTICA DE CRASHEO)
// =======================================================
app.get('/resumen-caja/:id', verificarToken, async (req, res) => { 
    try { 
        const info = await db.get('SELECT * FROM cajas WHERE id = ?', [req.params.id]);
        
        const apertura_segura = info ? (info.monto_apertura || 0) : 0;
        
        const v = await db.all('SELECT metodoPago as metodo, SUM(total) as total FROM ventas WHERE caja_id = ? GROUP BY metodoPago', [req.params.id]);
        const g = await db.all('SELECT tipo, SUM(monto) as total FROM gastos WHERE caja_id = ? GROUP BY tipo', [req.params.id]);
        
        let gast = 0, ret = 0; 
        g.forEach(x => { 
            if(x.tipo === 'GASTO' || x.tipo === null) gast = x.total; 
            if(x.tipo === 'RETIRO') ret = x.total; 
        });
        
        res.json({ ventas: v, gastos: gast, retiros: ret, apertura: apertura_segura }); 
    } catch (e) { 
        console.error("Error crítico en resumen de caja:", e); 
        res.status(500).json({ error: "Error en base de datos" }); 
    } 
});

// =======================================================
// LOGIN Y DEMÁS RUTAS
// =======================================================
app.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await db.get(`SELECT u.*, c.nombre as club_nombre, c.estado as club_estado, d.nombre as deporte_nombre, d.imagen as deporte_logo, d.estado as deporte_estado FROM usuarios u LEFT JOIN clubes c ON u.club_id = c.id LEFT JOIN deportes d ON u.deporte_id = d.id WHERE u.email = ?`, [limpiar(email)]);
        if (user) {
            const passValida = await bcrypt.compare(password, user.password);
            if (passValida) {
                if (user.rol !== 'SYSADMIN' && user.club_estado === 'INACTIVO') return res.json({ success: false, mensaje: "Club Suspendido" });
                if ((user.rol === 'SPORTADMIN' || user.rol === 'CAJERO') && user.deporte_estado === 'INACTIVO') return res.json({ success: false, mensaje: "Subcomisión Suspendida" });
                
                const caja = await db.get('SELECT id FROM cajas WHERE usuario_id = ? AND estado = "ABIERTA" ORDER BY id DESC LIMIT 1', [user.id]);
                delete user.password; 
                const token = jwt.sign({ id: user.id, rol: user.rol, email: user.email }, JWT_SECRET, { expiresIn: '12h' });
                res.json({ success: true, user, cajaAbierta: caja ? caja.id : null, token });
            } else res.json({ success: false, mensaje: "Contraseña incorrecta" });
        } else res.json({ success: false, mensaje: "Usuario no encontrado" });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/abrir-caja', verificarToken, async (req, res) => { 
    try { 
        const monto = parseFloat(req.body.monto_inicial) || 0;
        const result = await db.run('INSERT INTO cajas (usuario_id, monto_apertura, club_id, deporte_id) VALUES (?, ?, ?, ?)', [req.body.usuario_id, monto, req.body.club_id, req.body.deporte_id]); 
        res.json({ success: true, cajaId: result.lastID }); 
    } catch (e) { 
        res.json({ success: false, mensaje: e.message }); 
    } 
});

app.put('/cerrar-caja/:id', verificarToken, async (req, res) => { 
    try {
        await db.run('UPDATE cajas SET estado = "CERRADA" WHERE id = ?', [req.params.id]); 
        res.json({ success: true }); 
    } catch (e) {
        res.json({ success: false });
    }
});

// RUTAS GENERALES (Unificadas y Seguras)
app.get('/api/backup', verificarToken, (req, res) => { if (req.usuarioVerificado.rol !== 'SYSADMIN') return res.status(403).send("DENEGADO"); res.download(path.resolve(__dirname, DB_PATH)); });
app.get('/public/info-deporte/:id', async (req, res) => { try { const info = await db.get('SELECT d.nombre as deporte, c.nombre as club, d.imagen as logo FROM deportes d JOIN clubes c ON d.club_id = c.id WHERE d.id = ?', [req.params.id]); res.json({ success: true, data: info }); } catch (e) { res.json({ success: false }); } });
app.post('/public/comentarios', async (req, res) => { try { await db.run('INSERT INTO comentarios (deporte_id, autor, mensaje) VALUES (?, ?, ?)', [req.body.deporte_id, limpiar(req.body.autor) || 'Anónimo', limpiar(req.body.mensaje)]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });
app.get('/clubes', verificarToken, async (req, res) => { res.json(await db.all('SELECT * FROM clubes WHERE id != 1')); });
app.post('/clubes', verificarToken, async (req, res) => { await db.run('INSERT INTO clubes (nombre, logo) VALUES (?, ?)', [limpiar(req.body.nombre).toUpperCase(), limpiar(req.body.logo)]); res.json({ success: true }); });
app.put('/clubes/:id', verificarToken, async (req, res) => { await db.run('UPDATE clubes SET nombre = ?, logo = ? WHERE id = ?', [limpiar(req.body.nombre).toUpperCase(), limpiar(req.body.logo), req.params.id]); res.json({ success: true }); });
app.put('/clubes/:id/estado', verificarToken, async (req, res) => { await db.run('UPDATE clubes SET estado = ? WHERE id = ?', [limpiar(req.body.estado), req.params.id]); res.json({ success: true }); });
app.get('/deportes', verificarToken, async (req, res) => { res.json(await db.all(`SELECT d.*, c.nombre as club_nombre FROM deportes d LEFT JOIN clubes c ON d.club_id = c.id WHERE d.id != 1`)); });
app.get('/deportes/:clubId', verificarToken, async (req, res) => { res.json(await db.all('SELECT * FROM deportes WHERE club_id = ? AND id != 1', [req.params.clubId])); });
app.post('/deportes', verificarToken, async (req, res) => { await db.run('INSERT INTO deportes (nombre, imagen, club_id) VALUES (?, ?, ?)', [limpiar(req.body.nombre).toUpperCase(), limpiar(req.body.imagen), req.body.club_id]); res.json({ success: true }); });
app.put('/deportes/:id', verificarToken, async (req, res) => { await db.run('UPDATE deportes SET nombre = ?, imagen = ?, club_id = ? WHERE id = ?', [limpiar(req.body.nombre).toUpperCase(), limpiar(req.body.imagen), req.body.club_id, req.params.id]); res.json({ success: true }); });
app.put('/deportes/:id/estado', verificarToken, async (req, res) => { await db.run('UPDATE deportes SET estado = ? WHERE id = ?', [limpiar(req.body.estado), req.params.id]); res.json({ success: true }); });
app.get('/estadisticas-sysadmin', verificarToken, async (req, res) => { res.json(await db.all(`SELECT c.id, c.nombre, c.logo, COALESCE((SELECT SUM(total) FROM ventas WHERE club_id = c.id), 0) as total_ventas, COALESCE((SELECT SUM(monto) FROM gastos WHERE club_id = c.id AND (tipo = "GASTO" OR tipo IS NULL)), 0) as total_gastos FROM clubes c WHERE c.id != 1`)); });
app.get('/estadisticas-club/:clubId', verificarToken, async (req, res) => { res.json(await db.all(`SELECT d.id, d.nombre, d.imagen as logo, COALESCE((SELECT SUM(total) FROM ventas WHERE deporte_id = d.id), 0) as total_ventas, COALESCE((SELECT SUM(monto) FROM gastos WHERE deporte_id = d.id AND (tipo = "GASTO" OR tipo IS NULL)), 0) as total_gastos FROM deportes d WHERE d.club_id = ? AND d.id != 1`, [req.params.clubId])); });
app.get('/cajas-subcomision/:deporteId', verificarToken, async (req, res) => { res.json(await db.all(`SELECT c.*, u.nombre as cajero_nombre, COALESCE((SELECT SUM(total) FROM ventas WHERE caja_id = c.id), 0) as total_ingresos, COALESCE((SELECT SUM(monto) FROM gastos WHERE caja_id = c.id AND (tipo = 'GASTO' OR tipo IS NULL)), 0) as total_gastos, COALESCE((SELECT SUM(monto) FROM gastos WHERE caja_id = c.id AND tipo = 'RETIRO'), 0) as total_retiros FROM cajas c LEFT JOIN usuarios u ON c.usuario_id = u.id WHERE c.deporte_id = ? ORDER BY c.id DESC LIMIT 30`, [req.params.deporteId])); });
app.get('/movimientos/:deporteId', verificarToken, async (req, res) => { res.json(await db.all('SELECT * FROM movimientos WHERE deporte_id = ? ORDER BY id DESC', [req.params.deporteId])); });
app.post('/movimientos', verificarToken, async (req, res) => { await db.run('INSERT INTO movimientos (club_id, deporte_id, tipo, concepto, monto, cuenta_origen, cuenta_destino) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.body.club_id, req.body.deporte_id, limpiar(req.body.tipo), limpiar(req.body.concepto), req.body.monto, limpiar(req.body.cuenta_origen), limpiar(req.body.cuenta_destino)]); res.json({ success: true }); });
app.delete('/movimientos/:id', verificarToken, async (req, res) => { await db.run('DELETE FROM movimientos WHERE id = ?', [req.params.id]); res.json({ success: true }); });
app.get('/comentarios/:deporteId', verificarToken, async (req, res) => { res.json(await db.all('SELECT * FROM comentarios WHERE deporte_id = ? ORDER BY id DESC', [req.params.deporteId])); });
app.delete('/comentarios/:id', verificarToken, async (req, res) => { await db.run('DELETE FROM comentarios WHERE id = ?', [req.params.id]); res.json({ success: true }); });
app.get('/usuarios-all', verificarToken, async (req, res) => { res.json(await db.all(`SELECT u.id, u.nombre, u.email, u.rol, u.club_id, u.deporte_id, c.nombre as club_nombre, d.nombre as deporte_nombre FROM usuarios u LEFT JOIN clubes c ON u.club_id = c.id LEFT JOIN deportes d ON u.deporte_id = d.id WHERE u.id != 1`)); });
app.get('/usuarios/:clubId', verificarToken, async (req, res) => { res.json(await db.all(`SELECT u.id, u.nombre, u.email, u.rol, u.club_id, u.deporte_id, d.nombre as deporte_nombre FROM usuarios u LEFT JOIN deportes d ON u.deporte_id = d.id WHERE u.club_id = ? AND u.id != 1`, [req.params.clubId])); });
app.post('/usuarios', verificarToken, async (req, res) => { const d_id = req.body.deporte_id || null; const hashedPass = await bcrypt.hash(req.body.password, 10); try { await db.run('INSERT INTO usuarios (nombre, email, password, rol, club_id, deporte_id) VALUES (?, ?, ?, ?, ?, ?)', [limpiar(req.body.nombre), limpiar(req.body.email), hashedPass, limpiar(req.body.rol), req.body.club_id, d_id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });
app.delete('/usuarios/:id', verificarToken, async (req, res) => { await db.run('DELETE FROM usuarios WHERE id = ?', [req.params.id]); res.json({ success: true }); });
app.get('/productos/:deporteId', verificarToken, async (req, res) => { res.json(await db.all('SELECT * FROM productos WHERE deporte_id = ? ORDER BY id DESC', [req.params.deporteId])); });
app.post('/productos', verificarToken, upload.single('imagen_file'), async (req, res) => { try { let img = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : (req.body.imagen_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(req.body.nombre)}`); await db.run('INSERT INTO productos (nombre, precio, stock, imagen, categoria, club_id, deporte_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [limpiar(req.body.nombre), req.body.precio, req.body.stock, img, limpiar(req.body.categoria), req.body.club_id, req.body.deporte_id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });
app.put('/productos/:id', verificarToken, upload.single('imagen_file'), async (req, res) => { let img = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : req.body.imagen_url; if (img) { await db.run('UPDATE productos SET nombre = ?, precio = ?, stock = ?, imagen = ?, categoria = ? WHERE id = ?', [limpiar(req.body.nombre), req.body.precio, req.body.stock, img, limpiar(req.body.categoria), req.params.id]); } else { await db.run('UPDATE productos SET nombre = ?, precio = ?, stock = ?, categoria = ? WHERE id = ?', [limpiar(req.body.nombre), req.body.precio, req.body.stock, limpiar(req.body.categoria), req.params.id]); } res.json({ success: true }); });
app.delete('/productos/:id', verificarToken, async (req, res) => { await db.run('DELETE FROM productos WHERE id = ?', [req.params.id]); res.json({ success: true }); });
app.post('/confirmar-venta', verificarToken, async (req, res) => { const { items, metodoPago, caja_id, club_id, deporte_id, requiere_despacho } = req.body; try { let total = 0; items.forEach(i => total += (i.precio * i.cantidad)); let cod = requiere_despacho ? `T-${Math.floor(1000 + Math.random() * 9000)}` : null; const result = await db.run('INSERT INTO ventas (total, metodoPago, caja_id, club_id, deporte_id, estado_entrega, codigo_retiro) VALUES (?, ?, ?, ?, ?, ?, ?)', [total, limpiar(metodoPago), caja_id, club_id, deporte_id, requiere_despacho?'PENDIENTE':'ENTREGADO', cod]); for (const i of items) { await db.run('UPDATE productos SET stock = stock - ? WHERE id = ?', [i.cantidad, i.id]); await db.run('INSERT INTO ventas_detalles (venta_id, producto_nombre, cantidad) VALUES (?, ?, ?)', [result.lastID, limpiar(i.nombre), i.cantidad]); } res.json({ success: true, codigo_retiro: cod }); } catch (e) { res.status(500).json({ success: false }); } });
app.post('/gastos', verificarToken, async (req, res) => { await db.run('INSERT INTO gastos (descripcion, monto, caja_id, club_id, deporte_id, tipo) VALUES (?, ?, ?, ?, ?, ?)', [limpiar(req.body.descripcion), req.body.monto, req.body.caja_id, req.body.club_id, req.body.deporte_id, limpiar(req.body.tipo) || 'GASTO']); res.json({ success: true }); });
app.get('/despacho/pendientes/:deporteId', verificarToken, async (req, res) => { const v = await db.all(`SELECT id, codigo_retiro, fecha FROM ventas WHERE deporte_id = ? AND estado_entrega = 'PENDIENTE'`, [req.params.deporteId]); for (let x of v) { x.items = await db.all(`SELECT producto_nombre, cantidad FROM ventas_detalles WHERE venta_id = ?`, [x.id]); } res.json(v); });
app.get('/despacho/entregados/:deporteId', verificarToken, async (req, res) => { const v = await db.all(`SELECT id, codigo_retiro, fecha FROM ventas WHERE deporte_id = ? AND estado_entrega = 'ENTREGADO' AND codigo_retiro IS NOT NULL LIMIT 10`, [req.params.deporteId]); for (let x of v) { x.items = await db.all(`SELECT producto_nombre, cantidad FROM ventas_detalles WHERE venta_id = ?`, [x.id]); } res.json(v); });
app.get('/despacho/buscar/:codigo/:deporteId', verificarToken, async (req, res) => { const v = await db.get(`SELECT id, codigo_retiro, estado_entrega FROM ventas WHERE codigo_retiro = ? AND deporte_id = ?`, [req.params.codigo.toUpperCase(), req.params.deporteId]); if (!v) return res.json({ success: false }); v.items = await db.all(`SELECT producto_nombre, cantidad FROM ventas_detalles WHERE venta_id = ?`, [v.id]); res.json({ success: true, venta: v }); });
app.put('/despacho/entregar/:id', verificarToken, async (req, res) => { await db.run(`UPDATE ventas SET estado_entrega = 'ENTREGADO' WHERE id = ?`, [req.params.id]); res.json({success:true}); });
app.get('/historial-ventas/:cajaId', verificarToken, async (req, res) => { res.json(await db.all("SELECT * FROM ventas WHERE caja_id = ? ORDER BY id DESC", [req.params.cajaId])); });
app.get('/historial-gastos/:cajaId', verificarToken, async (req, res) => { res.json(await db.all("SELECT * FROM gastos WHERE caja_id = ? ORDER BY id DESC", [req.params.cajaId])); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Puerto ${PORT}`));