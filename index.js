const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); // 🔒 LIBRERÍA DE TOKENS AGREGADA

const app = express();
app.use(express.static('public')); 
app.use(express.json()); 

// 🔑 Secreto para firmar los tokens (En producción esto va en variables de entorno)
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
            CREATE TABLE IF NOT EXISTS ventas (id INTEGER PRIMARY KEY AUTOINCREMENT, caja_id INTEGER, club_id INTEGER, deporte_id INTEGER, total REAL, metodoPago TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')));
            CREATE TABLE IF NOT EXISTS gastos (id INTEGER PRIMARY KEY AUTOINCREMENT, caja_id INTEGER, club_id INTEGER, deporte_id INTEGER, descripcion TEXT, monto REAL, fecha DATETIME DEFAULT (datetime('now', 'localtime')));
            CREATE TABLE IF NOT EXISTS movimientos (id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER, deporte_id INTEGER, tipo TEXT, concepto TEXT, monto REAL, fecha DATETIME DEFAULT (datetime('now', 'localtime')));
        `);

        const tablasConClubYDeporte = ['usuarios', 'productos', 'cajas', 'ventas', 'gastos', 'movimientos'];
        for(let t of tablasConClubYDeporte) {
            try { await db.exec(`ALTER TABLE ${t} ADD COLUMN club_id INTEGER`); } catch(e){}
            try { await db.exec(`ALTER TABLE ${t} ADD COLUMN deporte_id INTEGER`); } catch(e){}
        }
        try { await db.exec(`ALTER TABLE productos ADD COLUMN categoria TEXT DEFAULT 'OTROS'`); } catch(e){}
        try { await db.exec(`ALTER TABLE deportes ADD COLUMN estado TEXT DEFAULT 'ACTIVO'`); } catch(e){} 

        const adminEmail = "admin@buffet.com";
        const adminExists = await db.get('SELECT * FROM usuarios WHERE email = ?', [adminEmail]);
        if (!adminExists) {
            const hashedAdminPass = await bcrypt.hash("1234", 10);
            await db.run('INSERT INTO usuarios (nombre, email, password, rol, club_id, deporte_id) VALUES (?, ?, ?, ?, ?, ?)', ["Dueño del Sistema", adminEmail, hashedAdminPass, "SYSADMIN", 1, 1]);
            await db.run('INSERT OR IGNORE INTO clubes (id, nombre, logo) VALUES (1, "SISTEMA CENTRAL", "https://cdn-icons-png.flaticon.com/512/857/857681.png")');
            await db.run('INSERT OR IGNORE INTO deportes (id, nombre, club_id) VALUES (1, "ADMINISTRACIÓN", 1)');
        }

        const usuariosViejos = await db.all('SELECT id, password FROM usuarios');
        for (let u of usuariosViejos) {
            if (u.password && u.password.length < 50) {
                const newHash = await bcrypt.hash(u.password, 10);
                await db.run('UPDATE usuarios SET password = ? WHERE id = ?', [newHash, u.id]);
            }
        }

        console.log("✅ Servidor iniciado. 🛡️ JWT Activado y Seguridad Máxima.");
    } catch (error) { console.error("❌ Error crítico:", error); }
})();

// =======================================================
// 🛡️ MIDDLEWARE DE SEGURIDAD (EL PATOVICA DEL SERVIDOR)
// =======================================================
const verificarToken = (req, res, next) => {
    // Busca la llave en las cabeceras de la petición
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(403).json({ success: false, mensaje: "Acceso denegado. No hay token." });
    
    const token = authHeader.split(' ')[1]; // Formato: "Bearer TOKEN_AQUI"
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ success: false, mensaje: "Token inválido o expirado." });
        req.usuarioVerificado = decoded; // Guarda los datos del usuario para usarlos si se necesita
        next(); // Lo deja pasar a la ruta
    });
};

// =======================================================
// RUTAS (Login público, el resto protegido por verificarToken)
// =======================================================
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
                
                // 🎟️ GENERAMOS EL TOKEN QUE DURA 12 HORAS
                const token = jwt.sign({ id: user.id, rol: user.rol, email: user.email }, JWT_SECRET, { expiresIn: '12h' });
                
                // Le devolvemos al frontend sus datos y SU TOKEN
                res.json({ success: true, user, cajaAbierta: caja ? caja.id : null, token });
            } else { res.json({ success: false, mensaje: "Credenciales incorrectas" }); }
        } else { res.json({ success: false, mensaje: "Credenciales incorrectas" }); }
    } catch (e) { res.status(500).json({ success: false, mensaje: "Error interno" }); }
});

// A partir de aquí, TODAS las rutas tienen "verificarToken"
app.get('/clubes', verificarToken, async (req, res) => { try { res.json(await db.all('SELECT * FROM clubes WHERE id != 1')); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/clubes', verificarToken, async (req, res) => { try { await db.run('INSERT INTO clubes (nombre, logo) VALUES (?, ?)', [req.body.nombre.toUpperCase(), req.body.logo]); res.json({ success: true }); } catch (e) { res.json({ success: false, mensaje: "Error al crear club. ¿Nombre duplicado?" }); } });
app.get('/estadisticas-sysadmin', verificarToken, async (req, res) => { try { const stats = await db.all(`SELECT c.id, c.nombre, c.logo, COALESCE((SELECT SUM(total) FROM ventas WHERE club_id = c.id), 0) as total_ventas, COALESCE((SELECT SUM(monto) FROM gastos WHERE club_id = c.id), 0) as total_gastos FROM clubes c WHERE c.id != 1`); res.json(stats); } catch (e) { res.status(500).json({ error: e.message }); } });

app.get('/deportes', verificarToken, async (req, res) => { try { res.json(await db.all(`SELECT d.*, c.nombre as club_nombre FROM deportes d LEFT JOIN clubes c ON d.club_id = c.id WHERE d.id != 1`)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/deportes/:clubId', verificarToken, async (req, res) => { try { res.json(await db.all('SELECT * FROM deportes WHERE club_id = ? AND id != 1', [req.params.clubId])); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/deportes', verificarToken, async (req, res) => { try { await db.run('INSERT INTO deportes (nombre, imagen, club_id) VALUES (?, ?, ?)', [req.body.nombre.toUpperCase(), req.body.imagen, req.body.club_id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });
app.put('/deportes/:id/estado', verificarToken, async (req, res) => { try { await db.run('UPDATE deportes SET estado = ? WHERE id = ?', [req.body.estado, req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); } });

app.get('/estadisticas-subcomision/:deporteId', verificarToken, async (req, res) => { try { const v = await db.get(`SELECT SUM(total) as t FROM ventas WHERE deporte_id = ?`, [req.params.deporteId]); const g = await db.get(`SELECT SUM(monto) as t FROM gastos WHERE deporte_id = ?`, [req.params.deporteId]); const mi = await db.get(`SELECT SUM(monto) as t FROM movimientos WHERE deporte_id = ? AND tipo = 'INGRESO'`, [req.params.deporteId]); const me = await db.get(`SELECT SUM(monto) as t FROM movimientos WHERE deporte_id = ? AND tipo = 'EGRESO'`, [req.params.deporteId]); res.json({ ventas_pos: v.t || 0, gastos_pos: g.t || 0, ingresos_extra: mi.t || 0, egresos_extra: me.t || 0 }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/cajas-subcomision/:deporteId', verificarToken, async (req, res) => { try { const cajas = await db.all(`SELECT c.*, u.nombre as cajero_nombre, COALESCE((SELECT SUM(total) FROM ventas WHERE caja_id = c.id), 0) as total_ingresos, COALESCE((SELECT SUM(monto) FROM gastos WHERE caja_id = c.id), 0) as total_gastos FROM cajas c LEFT JOIN usuarios u ON c.usuario_id = u.id WHERE c.deporte_id = ? ORDER BY c.id DESC LIMIT 30`, [req.params.deporteId]); res.json(cajas); } catch (e) { res.status(500).json({ error: e.message }); } });

app.get('/movimientos/:deporteId', verificarToken, async (req, res) => { try { res.json(await db.all('SELECT * FROM movimientos WHERE deporte_id = ? ORDER BY id DESC', [req.params.deporteId])); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/movimientos', verificarToken, async (req, res) => { try { await db.run('INSERT INTO movimientos (club_id, deporte_id, tipo, concepto, monto) VALUES (?, ?, ?, ?, ?)', [req.body.club_id, req.body.deporte_id, req.body.tipo, req.body.concepto, req.body.monto]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });
app.delete('/movimientos/:id', verificarToken, async (req, res) => { try { await db.run('DELETE FROM movimientos WHERE id = ?', [req.params.id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });

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

app.post('/confirmar-venta', verificarToken, async (req, res) => {
    const { items, metodoPago, caja_id, club_id, deporte_id } = req.body;
    try {
        await db.run('BEGIN TRANSACTION'); let total = 0;
        for (const item of items) { total += (item.precio * item.cantidad); await db.run('UPDATE productos SET stock = stock - ? WHERE id = ?', [item.cantidad, item.id]); }
        const result = await db.run('INSERT INTO ventas (total, metodoPago, caja_id, club_id, deporte_id) VALUES (?, ?, ?, ?, ?)', [total, metodoPago, caja_id, club_id, deporte_id]);
        await db.run('COMMIT'); res.json({ success: true, idVenta: result.lastID });
    } catch (e) { await db.run('ROLLBACK'); res.json({ success: false }); }
});

app.post('/gastos', verificarToken, async (req, res) => { try { await db.run('INSERT INTO gastos (descripcion, monto, caja_id, club_id, deporte_id) VALUES (?, ?, ?, ?, ?)', [req.body.descripcion, req.body.monto, req.body.caja_id, req.body.club_id, req.body.deporte_id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); } });

app.get('/resumen-caja/:id', verificarToken, async (req, res) => { try { const info = await db.get('SELECT * FROM cajas WHERE id = ?', [req.params.id]); const ventas = await db.all('SELECT metodoPago as metodo, SUM(total) as total FROM ventas WHERE caja_id = ? GROUP BY metodoPago', [req.params.id]); const gastos = await db.get('SELECT SUM(monto) as total FROM gastos WHERE caja_id = ?', [req.params.id]); res.json({ ventas, gastos: gastos.total || 0, apertura: info.monto_apertura || 0 }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/historial-ventas/:cajaId', verificarToken, async (req, res) => { try { res.json(await db.all("SELECT * FROM ventas WHERE caja_id = ? ORDER BY id DESC", [req.params.cajaId])); } catch (e) { res.json([]); } });
app.get('/historial-gastos/:cajaId', verificarToken, async (req, res) => { try { res.json(await db.all("SELECT * FROM gastos WHERE caja_id = ? ORDER BY id DESC", [req.params.cajaId])); } catch (e) { res.json([]); } });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor SAAS corriendo en el puerto ${PORT}`));