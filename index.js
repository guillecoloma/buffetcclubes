const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const compression = require('compression'); 
const rateLimit = require('express-rate-limit'); 

const app = express();
app.use(compression());
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, message: "Demasiadas peticiones" });
app.use(limiter);

app.use(express.static('public')); 
app.use(express.json()); 

const JWT_SECRET = process.env.JWT_SECRET || 'SuperFirmaSecretaBuffet2024';
let db;

(async () => {
    try {
        const dbPath = process.env.DB_PATH || './buffet.db';
        db = await open({ filename: dbPath, driver: sqlite3.Database });

        console.log(`🛠️ Conectado a la Base de Datos en: ${dbPath}`);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS clubes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE, logo TEXT, estado TEXT DEFAULT 'ACTIVO');
            CREATE TABLE IF NOT EXISTS deportes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, imagen TEXT, club_id INTEGER, estado TEXT DEFAULT 'ACTIVO');
            CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, email TEXT UNIQUE, password TEXT, rol TEXT, club_id INTEGER, deporte_id INTEGER);
            CREATE TABLE IF NOT EXISTS productos (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, precio REAL, stock INTEGER, imagen TEXT, categoria TEXT DEFAULT 'OTROS', club_id INTEGER, deporte_id INTEGER);
            CREATE TABLE IF NOT EXISTS cajas (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, club_id INTEGER, deporte_id INTEGER, monto_apertura REAL, fecha_apertura DATETIME DEFAULT (datetime('now', 'localtime')), estado TEXT DEFAULT 'ABIERTA');
            CREATE TABLE IF NOT EXISTS ventas (id INTEGER PRIMARY KEY AUTOINCREMENT, caja_id INTEGER, club_id INTEGER, deporte_id INTEGER, total REAL, metodoPago TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')), estado_entrega TEXT DEFAULT 'ENTREGADO', codigo_retiro TEXT);
            CREATE TABLE IF NOT EXISTS gastos (id INTEGER PRIMARY KEY AUTOINCREMENT, caja_id INTEGER, club_id INTEGER, deporte_id INTEGER, descripcion TEXT, monto REAL, fecha DATETIME DEFAULT (datetime('now', 'localtime')));
            CREATE TABLE IF NOT EXISTS movimientos (id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER, deporte_id INTEGER, tipo TEXT, concepto TEXT, monto REAL, fecha DATETIME DEFAULT (datetime('now', 'localtime')));
            CREATE TABLE IF NOT EXISTS ventas_detalles (id INTEGER PRIMARY KEY AUTOINCREMENT, venta_id INTEGER, producto_nombre TEXT, cantidad INTEGER);
        `);

        // OPTIMIZACIONES DE VELOCIDAD
        await db.exec(`
            CREATE INDEX IF NOT EXISTS idx_ventas_deporte ON ventas(deporte_id);
            CREATE INDEX IF NOT EXISTS idx_ventas_caja ON ventas(caja_id);
            CREATE INDEX IF NOT EXISTS idx_ventas_codigo ON ventas(codigo_retiro);
            CREATE INDEX IF NOT EXISTS idx_productos_deporte ON productos(deporte_id);
            CREATE INDEX IF NOT EXISTS idx_gastos_caja ON gastos(caja_id);
        `);

        // INYECCIÓN DE NUEVAS COLUMNAS (MULTICUENTAS)
        const tablasConClubYDeporte = ['usuarios', 'productos', 'cajas', 'ventas', 'gastos', 'movimientos'];
        for(let t of tablasConClubYDeporte) {
            try { await db.exec(`ALTER TABLE ${t} ADD COLUMN club_id INTEGER`); } catch(e){}
            try { await db.exec(`ALTER TABLE ${t} ADD COLUMN deporte_id INTEGER`); } catch(e){}
        }
        try { await db.exec(`ALTER TABLE productos ADD COLUMN categoria TEXT DEFAULT 'OTROS'`); } catch(e){}
        try { await db.exec(`ALTER TABLE deportes ADD COLUMN estado TEXT DEFAULT 'ACTIVO'`); } catch(e){} 
        try { await db.exec(`ALTER TABLE ventas ADD COLUMN estado_entrega TEXT DEFAULT 'ENTREGADO'`); } catch(e){}
        try { await db.exec(`ALTER TABLE ventas ADD COLUMN codigo_retiro TEXT`); } catch(e){}
        try { await db.exec(`ALTER TABLE movimientos ADD COLUMN cuenta_origen TEXT DEFAULT 'EFECTIVO'`); } catch(e){}
        try { await db.exec(`ALTER TABLE movimientos ADD COLUMN cuenta_destino TEXT`); } catch(e){}

        const adminEmail = "admin@buffet.com";
        const adminExists = await db.get('SELECT * FROM usuarios WHERE email = ?', [adminEmail]);
        if (!adminExists) {
            const hashedAdminPass = await bcrypt.hash("1234", 10);
            await db.run('INSERT INTO usuarios (nombre, email, password, rol, club_id, deporte_id) VALUES (?, ?, ?, ?, ?, ?)', ["Dueño del Sistema", adminEmail, hashedAdminPass, "SYSADMIN", 1, 1]);
            await db.run('INSERT OR IGNORE INTO clubes (id, nombre, logo) VALUES (1, "SISTEMA CENTRAL", "https://cdn-icons-png.flaticon.com/512/857/857681.png")');
            await db.run('INSERT OR IGNORE INTO deportes (id, nombre, club_id) VALUES (1, "ADMINISTRACIÓN", 1)');
        }

        console.log("✅ Servidor iniciado. 🛡️ Módulo Financiero Multicuentas Activo.");
    } catch (error) { console.error("❌ Error crítico:", error); }
})();

const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(403).json({ success: false, mensaje: "Acceso denegado. No hay token." });
    const token = authHeader.split(' ')[1]; 
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ success: false, mensaje: "Token inválido o expirado." });
        req.usuarioVerificado = decoded; 
        next(); 
    });
};

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await db.get(`SELECT u.*, c.nombre as club_nombre, d.nombre as deporte_nombre, d.imagen as deporte_logo, d.estado as deporte_estado FROM usuarios u LEFT JOIN clubes c ON u.club_id = c.id LEFT JOIN deportes d ON u.deporte_id = d.id WHERE u.email = ?`, [email]);
        if (user) {
            const passwordValida = await bcrypt.compare(password, user.password);
            if (passwordValida) {
                if ((user.rol === 'SPORTADMIN' || user.rol === 'CAJERO') && user.deporte_estado === 'INACTIVO') return res.json({ success: false, mensaje: "⚠️ Acceso denegado: Subcomisión suspendida." });
                const caja = await db.get('SELECT id FROM cajas WHERE usuario_id = ? AND estado = "ABIERTA"', [user.id]);
                delete user.password; 
                const token = jwt.sign({ id: user.id, rol: user.rol, email: user.email }, JWT_SECRET, { expiresIn: '12h' });
                res.json({ success: true, user, cajaAbierta: caja ? caja.id : null, token });
            } else { res.json({ success: false, mensaje: "Credenciales incorrectas" }); }
        } else { res.json({ success: false, mensaje: "Credenciales incorrectas" }); }
    } catch (e) { res.status(500).json({ success: false, mensaje: "Error interno" }); }
});

app.get('/clubes', verificarToken, async (req, res) => { try { res.json(await db.all('SELECT * FROM clubes WHERE id != 1')); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/clubes', verificarToken, async (req, res) => { try { await db.run('INSERT INTO clubes (nombre, logo) VALUES (?, ?)', [req.body.nombre.toUpperCase(), req.body.logo]); res.json({ success: true }); } catch (e) { res.json({ success: false, mensaje: "Error al crear club. ¿Nombre duplicado?" }); } });

// PANELES DE ESTADÍSTICAS
app.get('/estadisticas-sysadmin', verificarToken, async (req, res) => { try { const stats = await db.all(`SELECT c.id, c.nombre, c.logo, COALESCE((SELECT SUM(total) FROM ventas WHERE club_id = c.id), 0) as total_ventas, COALESCE((SELECT SUM(monto) FROM gastos WHERE club_id = c.id), 0) as total_gastos FROM clubes c WHERE c.id != 1`); res.json(stats); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/estadisticas-club/:clubId', verificarToken, async (req, res) => { try { const stats = await db.all(`SELECT d.id, d.nombre, d.imagen as logo, COALESCE((SELECT SUM(total) FROM ventas WHERE deporte_id = d.id), 0) as total_ventas, COALESCE((SELECT SUM(monto) FROM gastos WHERE deporte_id = d.id), 0) as total_gastos FROM deportes d WHERE d.club_id = ? AND d.id != 1`, [req.params.clubId]); res.json(stats); } catch (e) { res.status(500).json({ error: e.message }); } });

app.get('/deportes', verificarToken, async (req, res) => { try { res.json(await db.all(`SELECT d.*, c.nombre as club_nombre FROM deportes d LEFT JOIN clubes c ON d.club_id = c.id WHERE d.id != 1`)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/deportes/:clubId', verificarToken, async (req, res) => { try { res.json(await db.all('SELECT * FROM deportes WHERE club_id = ? AND id != 1', [req.params.clubId])); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/deportes', verificarToken, async (req, res) => { try { await db.run('INSERT INTO deportes (nombre, imagen, club_id) VALUES (?, ?, ?)', [req.body.nombre.toUpperCase(), req.body.imagen, req.body.club_id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });
app.put('/deportes/:id/estado', verificarToken, async (req, res) => { try { await db.run('UPDATE deportes SET estado = ? WHERE id = ?', [req.body.estado, req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } });

// ESTADÍSTICAS AVANZADAS: MULTICUENTAS
app.get('/estadisticas-subcomision/:deporteId', verificarToken, async (req, res) => { 
    try { 
        const id = req.params.deporteId;
        
        // Ventas de Caja
        const ventasEf = await db.get(`SELECT SUM(total) as t FROM ventas WHERE deporte_id = ? AND metodoPago = 'Efectivo'`, [id]);
        const ventasBa = await db.get(`SELECT SUM(total) as t FROM ventas WHERE deporte_id = ? AND metodoPago = 'Transferencia'`, [id]);
        const gastos = await db.get(`SELECT SUM(monto) as t FROM gastos WHERE deporte_id = ?`, [id]); // Gastos siempre descuentan de efectivo por defecto en el POS

        // Movimientos Extra (Ingresos/Egresos directos)
        const movIng = await db.all(`SELECT cuenta_origen, SUM(monto) as t FROM movimientos WHERE deporte_id = ? AND tipo = 'INGRESO' GROUP BY cuenta_origen`, [id]);
        const movEgr = await db.all(`SELECT cuenta_origen, SUM(monto) as t FROM movimientos WHERE deporte_id = ? AND tipo = 'EGRESO' GROUP BY cuenta_origen`, [id]);
        
        // Transferencias Internas
        const transfOut = await db.all(`SELECT cuenta_origen, SUM(monto) as t FROM movimientos WHERE deporte_id = ? AND tipo = 'TRANSFERENCIA' GROUP BY cuenta_origen`, [id]);
        const transfIn = await db.all(`SELECT cuenta_destino, SUM(monto) as t FROM movimientos WHERE deporte_id = ? AND tipo = 'TRANSFERENCIA' GROUP BY cuenta_destino`, [id]);

        let saldo_efectivo = (ventasEf.t || 0) - (gastos.t || 0);
        let saldo_banco = (ventasBa.t || 0);
        let saldo_mutual = 0;

        // Sumar y restar según origen y destino
        movIng.forEach(m => { if(m.cuenta_origen === 'EFECTIVO') saldo_efectivo += m.t; if(m.cuenta_origen === 'BANCO') saldo_banco += m.t; if(m.cuenta_origen === 'MUTUAL') saldo_mutual += m.t; });
        movEgr.forEach(m => { if(m.cuenta_origen === 'EFECTIVO') saldo_efectivo -= m.t; if(m.cuenta_origen === 'BANCO') saldo_banco -= m.t; if(m.cuenta_origen === 'MUTUAL') saldo_mutual -= m.t; });
        
        transfOut.forEach(m => { if(m.cuenta_origen === 'EFECTIVO') saldo_efectivo -= m.t; if(m.cuenta_origen === 'BANCO') saldo_banco -= m.t; if(m.cuenta_origen === 'MUTUAL') saldo_mutual -= m.t; });
        transfIn.forEach(m => { if(m.cuenta_destino === 'EFECTIVO') saldo_efectivo += m.t; if(m.cuenta_destino === 'BANCO') saldo_banco += m.t; if(m.cuenta_destino === 'MUTUAL') saldo_mutual += m.t; });

        res.json({ saldo_efectivo, saldo_banco, saldo_mutual, total: saldo_efectivo + saldo_banco + saldo_mutual }); 
    } catch (e) { res.status(500).json({ error: e.message }); } 
});

app.get('/cajas-subcomision/:deporteId', verificarToken, async (req, res) => { try { const cajas = await db.all(`SELECT c.*, u.nombre as cajero_nombre, COALESCE((SELECT SUM(total) FROM ventas WHERE caja_id = c.id), 0) as total_ingresos, COALESCE((SELECT SUM(monto) FROM gastos WHERE caja_id = c.id), 0) as total_gastos FROM cajas c LEFT JOIN usuarios u ON c.usuario_id = u.id WHERE c.deporte_id = ? ORDER BY c.id DESC LIMIT 30`, [req.params.deporteId]); res.json(cajas); } catch (e) { res.status(500).json({ error: e.message }); } });

// RUTAS DE LIBRO MAYOR Y MOVIMIENTOS
app.get('/movimientos/:deporteId', verificarToken, async (req, res) => { try { res.json(await db.all('SELECT * FROM movimientos WHERE deporte_id = ? ORDER BY id DESC', [req.params.deporteId])); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/movimientos', verificarToken, async (req, res) => { 
    try { 
        await db.run('INSERT INTO movimientos (club_id, deporte_id, tipo, concepto, monto, cuenta_origen, cuenta_destino) VALUES (?, ?, ?, ?, ?, ?, ?)', 
        [req.body.club_id, req.body.deporte_id, req.body.tipo, req.body.concepto, req.body.monto, req.body.cuenta_origen, req.body.cuenta_destino]); 
        res.json({ success: true }); 
    } catch (e) { res.json({ success: false }); } 
});
app.delete('/movimientos/:id', verificarToken, async (req, res) => { try { await db.run('DELETE FROM movimientos WHERE id = ?', [req.params.id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });

// USUARIOS Y PRODUCTOS
app.get('/usuarios-all', verificarToken, async (req, res) => { try { res.json(await db.all(`SELECT u.id, u.nombre, u.email, u.rol, u.club_id, u.deporte_id, c.nombre as club_nombre, d.nombre as deporte_nombre FROM usuarios u LEFT JOIN clubes c ON u.club_id = c.id LEFT JOIN deportes d ON u.deporte_id = d.id WHERE u.id != 1`)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/usuarios/:clubId', verificarToken, async (req, res) => { try { res.json(await db.all(`SELECT u.id, u.nombre, u.email, u.rol, u.club_id, u.deporte_id, d.nombre as deporte_nombre FROM usuarios u LEFT JOIN deportes d ON u.deporte_id = d.id WHERE u.club_id = ? AND u.id != 1`, [req.params.clubId])); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/usuarios', verificarToken, async (req, res) => { const d_id = (req.body.deporte_id === "" || !req.body.deporte_id) ? null : req.body.deporte_id; try { const hashedPass = await bcrypt.hash(req.body.password, 10); await db.run('INSERT INTO usuarios (nombre, email, password, rol, club_id, deporte_id) VALUES (?, ?, ?, ?, ?, ?)', [req.body.nombre, req.body.email, hashedPass, req.body.rol, req.body.club_id, d_id]); res.json({ success: true }); } catch (e) { res.json({ success: false, mensaje: "El correo ya está registrado o faltan datos." }); } });
app.delete('/usuarios/:id', verificarToken, async (req, res) => { try { await db.run('DELETE FROM usuarios WHERE id = ?', [req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } });

app.post('/abrir-caja', verificarToken, async (req, res) => { try { const result = await db.run('INSERT INTO cajas (usuario_id, monto_apertura, club_id, deporte_id) VALUES (?, ?, ?, ?)', [req.body.usuario_id, req.body.monto_inicial, req.body.club_id, req.body.deporte_id]); res.json({ success: true, cajaId: result.lastID }); } catch (e) { res.json({ success: false }); } });
app.put('/cerrar-caja/:id', verificarToken, async (req, res) => { try { await db.run('UPDATE cajas SET estado = "CERRADA" WHERE id = ?', [req.params.id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });

app.get('/productos/:deporteId', verificarToken, async (req, res) => { try { res.json(await db.all('SELECT * FROM productos WHERE deporte_id = ? ORDER BY id DESC', [req.params.deporteId])); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/productos', verificarToken, async (req, res) => { try { await db.run('INSERT INTO productos (nombre, precio, stock, imagen, categoria, club_id, deporte_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.body.nombre, req.body.precio, req.body.stock, req.body.imagen, req.body.categoria, req.body.club_id, req.body.deporte_id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });
app.put('/productos/:id', verificarToken, async (req, res) => { try { await db.run('UPDATE productos SET nombre = ?, precio = ?, stock = ?, imagen = ?, categoria = ? WHERE id = ?', [req.body.nombre, req.body.precio, req.body.stock, req.body.imagen, req.body.categoria, req.params.id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });
app.delete('/productos/:id', verificarToken, async (req, res) => { try { await db.run('DELETE FROM productos WHERE id = ?', [req.params.id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });

// RUTAS DE VENTAS Y DESPACHO BLINDADAS
app.post('/confirmar-venta', verificarToken, async (req, res) => {
    const { items, metodoPago, caja_id, club_id, deporte_id, requiere_despacho } = req.body;
    try {
        let total = 0;
        for (const item of items) { 
            if (item.cantidad <= 0 || item.precio < 0) return res.status(400).json({ success: false, error: "SEGURIDAD: Cantidad o precio inválido." });
            total += (item.precio * item.cantidad); 
        }

        let codigo_retiro = null;
        let estado = 'ENTREGADO';
        
        if (requiere_despacho) { estado = 'PENDIENTE'; codigo_retiro = `T-${Math.floor(1000 + Math.random() * 9000)}`; }

        const result = await db.run('INSERT INTO ventas (total, metodoPago, caja_id, club_id, deporte_id, estado_entrega, codigo_retiro) VALUES (?, ?, ?, ?, ?, ?, ?)', [total, metodoPago, caja_id, club_id, deporte_id, estado, codigo_retiro]);
        const ventaId = result.lastID;

        for (const item of items) { 
            await db.run('UPDATE productos SET stock = stock - ? WHERE id = ?', [item.cantidad, item.id]); 
            await db.run('INSERT INTO ventas_detalles (venta_id, producto_nombre, cantidad) VALUES (?, ?, ?)', [ventaId, item.nombre, item.cantidad]);
        }
        res.json({ success: true, idVenta: ventaId, codigo_retiro });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/despacho/pendientes/:deporteId', verificarToken, async (req, res) => {
    try {
        const ventas = await db.all(`SELECT id, codigo_retiro, fecha FROM ventas WHERE deporte_id = ? AND estado_entrega = 'PENDIENTE' ORDER BY id ASC`, [req.params.deporteId]);
        for (let v of ventas) { v.items = await db.all(`SELECT producto_nombre, cantidad FROM ventas_detalles WHERE venta_id = ?`, [v.id]); }
        res.json(ventas);
    } catch (e) { res.status(500).json({error: e.message}); }
});

app.get('/despacho/entregados/:deporteId', verificarToken, async (req, res) => {
    try {
        const ventas = await db.all(`SELECT id, codigo_retiro, fecha FROM ventas WHERE deporte_id = ? AND estado_entrega = 'ENTREGADO' AND codigo_retiro IS NOT NULL ORDER BY id DESC LIMIT 15`, [req.params.deporteId]);
        for (let v of ventas) { v.items = await db.all(`SELECT producto_nombre, cantidad FROM ventas_detalles WHERE venta_id = ?`, [v.id]); }
        res.json(ventas);
    } catch (e) { res.status(500).json({error: e.message}); }
});

app.get('/despacho/buscar/:codigo/:deporteId', verificarToken, async (req, res) => {
    try {
        const venta = await db.get(`SELECT id, codigo_retiro, estado_entrega, fecha FROM ventas WHERE codigo_retiro = ? AND deporte_id = ?`, [req.params.codigo.toUpperCase(), req.params.deporteId]);
        if (!venta) return res.json({ success: false, mensaje: "TICKET NO ENCONTRADO" });
        if (venta.estado_entrega === 'ENTREGADO') return res.json({ success: false, mensaje: "❌ ESTE TICKET YA FUE ENTREGADO" });
        venta.items = await db.all(`SELECT producto_nombre, cantidad FROM ventas_detalles WHERE venta_id = ?`, [venta.id]);
        res.json({ success: true, venta });
    } catch (e) { res.status(500).json({error: e.message}); }
});

app.put('/despacho/entregar/:id', verificarToken, async (req, res) => {
    try { await db.run(`UPDATE ventas SET estado_entrega = 'ENTREGADO' WHERE id = ?`, [req.params.id]); res.json({success:true}); } catch (e) { res.status(500).json({error: e.message}); }
});

app.post('/gastos', verificarToken, async (req, res) => { try { await db.run('INSERT INTO gastos (descripcion, monto, caja_id, club_id, deporte_id) VALUES (?, ?, ?, ?, ?)', [req.body.descripcion, req.body.monto, req.body.caja_id, req.body.club_id, req.body.deporte_id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });

app.get('/resumen-caja/:id', verificarToken, async (req, res) => { try { const info = await db.get('SELECT * FROM cajas WHERE id = ?', [req.params.id]); const ventas = await db.all('SELECT metodoPago as metodo, SUM(total) as total FROM ventas WHERE caja_id = ? GROUP BY metodoPago', [req.params.id]); const gastos = await db.get('SELECT SUM(monto) as total FROM gastos WHERE caja_id = ?', [req.params.id]); res.json({ ventas, gastos: gastos.total || 0, apertura: info.monto_apertura || 0 }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/historial-ventas/:cajaId', verificarToken, async (req, res) => { try { res.json(await db.all("SELECT * FROM ventas WHERE caja_id = ? ORDER BY id DESC", [req.params.cajaId])); } catch (e) { res.json([]); } });
app.get('/historial-gastos/:cajaId', verificarToken, async (req, res) => { try { res.json(await db.all("SELECT * FROM gastos WHERE caja_id = ? ORDER BY id DESC", [req.params.cajaId])); } catch (e) { res.json([]); } });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor SAAS corriendo en el puerto ${PORT}`));