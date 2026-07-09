const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Configuración del transportador de correos (Gmail)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,       // Tu cuenta de Gmail de salida
        pass: process.env.EMAIL_PASS        // Tu "Contraseña de Aplicación" de Google
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. RUTA: REGISTRO MANUAL Y ENVÍO DE CÓDIGO
app.post('/api/auth/register', async (req, res) => {
    const { nombre, apellido, email, fecha_nacimiento, password } = req.body;
    try {
        const usuarioExiste = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (usuarioExiste.rows.length > 0) {
            return res.status(400).json({ mensaje: 'El correo electrónico ya está registrado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHasheada = await bcrypt.hash(password, salt);
        
        // Generar un código aleatorio de 6 dígitos
        const codigoVerificacion = Math.floor(100000 + Math.random() * 900000).toString();

        await pool.query(
            `INSERT INTO usuarios (nombre, apellido, email, fecha_nacimiento, password, auth_provider, codigo_verificacion) 
             VALUES ($1, $2, $3, $4, $5, 'manual', $6)`,
            [nombre, apellido, email, fecha_nacimiento, passwordHasheada, codigoVerificacion]
        );

        // Enviar el correo electrónico real
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Código de Verificación - GeoAlerta',
            text: `Hola ${nombre}, tu código de verificación es: ${codigoVerificacion}`
        };

        await transporter.sendMail(mailOptions);
        res.status(201).json({ mensaje: 'Usuario registrado. Código enviado al correo.' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error interno en el servidor.' });
    }
});

// 2. RUTA: VERIFICAR EL CÓDIGO DEL CORREO
app.post('/api/auth/verify', async (req, res) => {
    const { email, codigo } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(404).json({ mensaje: 'Usuario no encontrado.' });

        const usuario = result.rows[0];
        if (usuario.codigo_verificacion === codigo) {
            await pool.query('UPDATE usuarios SET verificado = true, codigo_verificacion = NULL WHERE email = $1', [email]);
            return res.json({ mensaje: 'Cuenta verificada exitosamente. Ya puedes iniciar sesión.' });
        } else {
            return res.status(400).json({ mensaje: 'Código incorrecto.' });
        }
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al verificar.' });
    }
});

// 3. RUTA: INICIAR SESIÓN (LOGIN)
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ mensaje: 'Credenciales inválidas.' });

        const usuario = result.rows[0];
        
        // Verificar si la cuenta ya fue activada por el código
        if (!usuario.verificado) return res.status(401).json({ mensaje: 'Por favor, verifica tu correo antes de ingresar.' });

        const passwordCorrecta = await bcrypt.compare(password, usuario.password);
        if (!passwordCorrecta) return res.status(400).json({ mensaje: 'Credenciales inválidas.' });

        // Generar sesión segura de JWT
        const token = jwt.sign({ id: usuario.id }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, mensaje: 'Ingreso exitoso' });

    } catch (error) {
        res.status(500).json({ mensaje: 'Error en el login.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
