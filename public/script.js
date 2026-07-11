const API_URL = window.location.origin;
let usuarioActual = null;
let emailEnVerificacion = '';

document.addEventListener("DOMContentLoaded", () => {
    verificarSesionActiva();

    // Eventos de Navegación entre Pestañas y Vistas
    document.getElementById('tabLoginBtn').addEventListener('click', () => switchTab('login'));
    document.getElementById('tabRegisterBtn').addEventListener('click', () => switchTab('register'));
    document.getElementById('goToForgotLink').addEventListener('click', () => switchTab('forgot'));
    
    document.querySelectorAll('.go-back-login').forEach(btn => {
        btn.addEventListener('click', (e) => { e.preventDefault(); switchTab('login'); });
    });

    // Envío de Formularios
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('forgotForm').addEventListener('submit', handleForgot);
    document.getElementById('resetPasswordForm').addEventListener('submit', handleResetReal);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    document.getElementById('verifyForm').addEventListener('submit', handleVerify);

    // Botones de Reenvío (Ambos usan ahora la misma función optimizada)
    document.getElementById('btnResendCode').addEventListener('click', () => solicitarCodigoServidor(emailEnVerificacion, '¡Código de activación reenviado!'));
    document.getElementById('btnResendResetCode').addEventListener('click', () => solicitarCodigoServidor(emailEnVerificacion, '¡Código de restablecimiento reenviado!'));

    // Perfil y Desplegables
    document.getElementById('btnSaveProfile').addEventListener('click', (e) => { e.preventDefault(); saveProfile(); });
    document.getElementById('btnLogout').addEventListener('click', logout);
    document.getElementById('userMenuBtn').addEventListener('click', toggleProfileDropdown);
    document.getElementById('profileDropdown').addEventListener('click', (e) => e.stopPropagation());

    // Listener para estética del Input File
    document.getElementById('profFotoFile').addEventListener('change', function() {
        document.getElementById('fileNameLabel').innerText = this.files[0] ? this.files[0].name : "Seleccionar foto de tu equipo";
    });

    // Control de visibilidad de contraseñas
    document.querySelectorAll('.toggle-password').forEach(button => {
        button.addEventListener('click', function() {
            const input = document.getElementById(this.getAttribute('data-target'));
            const icon = this.querySelector('i');
            input.type = input.type === 'password' ? 'text' : 'password';
            icon.className = input.type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
        });
    });
});

// ==========================================
// FUNCIONES REUTILIZABLES (MÓDULOS DE OPTIMIZACIÓN)
// ==========================================

// 1. Función genérica para enviar peticiones POST de autenticación (Login, Registro, Códigos, etc.)
async function enviarPeticionAuth(endpoint, bodyData) {
    try {
        const response = await fetch(`${API_URL}/api/auth/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });

        // OPTIMIZACIÓN CRÍTICA: Validamos si la respuesta es JSON o texto plano para evitar que se rompa el JS
        const contentType = response.headers.get("content-type");
        let data;
        if (contentType && contentType.includes("application/json")) {
            data = await response.json();
        } else {
            const textoPlano = await response.text();
            data = { mensaje: textoPlano }; // Lo envolvemos en un objeto para mantener compatibilidad
        }

        return { ok: response.ok, data };
    } catch (err) {
        console.error(`Error en petición ${endpoint}:`, err);
        return { ok: false, data: { mensaje: 'Error de conexión con el servidor.' } };
    }
}

// 2. Función genérica para solicitar / reenviar códigos al correo del usuario (Usada por activación y olvido de clave)
async function solicitarCodigoServidor(email, mensajeExito) {
    clearNotification();
    if (!email) {
        showNotification('No se detectó un correo electrónico válido.', 'error');
        return false;
    }
    const { ok, data } = await enviarPeticionAuth('forgot-password', { email });
    if (ok) {
        showNotification(mensajeExito || data.mensaje, 'success');
        return true;
    } else {
        showNotification(data.mensaje || 'No se pudo enviar el código.', 'error');
        return false;
    }
}

// ==========================================
// CONTROLADORES DE EVENTOS (MANIPULADORES)
// ==========================================

async function handleLogin(e) {
    e.preventDefault();
    clearNotification();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    const { ok, data } = await enviarPeticionAuth('login', { email, password });

    if (ok) {
        localStorage.setItem('token', data.token);
        usuarioActual = data.usuario;
        cargarDashboard();
    } else {
        const msgError = data.mensaje ? data.mensaje.toLowerCase() : '';
        // Si el servidor responde que no está verificado, saltamos inmediatamente de vista
        if (msgError.includes('verificado')) {
            emailEnVerificacion = email; 
            switchTab('verify');
            showNotification('Tu cuenta no está verificada. Introduce el código que enviamos a tu correo.', 'error');
        } else {
            showNotification(data.mensaje || 'Credenciales incorrectas.', 'error');
        }
    }
}

async function handleForgot(e) {
    e.preventDefault();
    const email = document.getElementById('forgotEmail').value;
    // Llama a la función reutilizable
    const enviado = await solicitarCodigoServidor(email, '¡Código de restablecimiento enviado!');
    if (enviado) {
        emailEnVerificacion = email;
        switchTab('reset');
    }
}

async function handleResetReal(e) {
    e.preventDefault();
    clearNotification();
    const codigo = document.getElementById('resetCode').value;
    const nuevaPassword = document.getElementById('resetNewPassword').value;

    const { ok, data } = await enviarPeticionAuth('reset-password', { email: emailEnVerificacion, codigo, nuevaPassword });
    if (ok) {
        switchTab('login');
        showNotification(data.mensaje, 'success');
    } else {
        showNotification(data.mensaje || 'Código incorrecto.', 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    clearNotification();
    const nombre = document.getElementById('regNombre').value;
    const apellido = document.getElementById('regApellido').value;
    const email = document.getElementById('regEmail').value;
    const fecha_nacimiento = document.getElementById('regFecha').value;
    const password = document.getElementById('regPassword').value;

    const { ok, data } = await enviarPeticionAuth('register', { nombre, apellido, email, fecha_nacimiento, password });
    if (ok) {
        emailEnVerificacion = email;
        switchTab('verify'); 
        showNotification(data.mensaje, 'success');
    } else {
        showNotification(data.mensaje || 'Error al crear la cuenta.', 'error');
    }
}

async function handleVerify(e) {
    e.preventDefault();
    clearNotification();
    const codigo = document.getElementById('verifyCode').value;

    const { ok, data } = await enviarPeticionAuth('verify', { email: emailEnVerificacion, codigo });
    if (ok) {
        switchTab('login');
        showNotification(data.mensaje, 'success');
    } else {
        showNotification(data.mensaje || 'Código inválido.', 'error');
    }
}

// ==========================================
// VISTAS, NOTIFICACIONES Y SESIONES
// ==========================================

function switchTab(type) {
    clearNotification();
    const vistas = ['loginForm', 'registerForm', 'verifyForm', 'forgotForm', 'resetPasswordForm'];
    vistas.forEach(id => document.getElementById(id).classList.add('hidden'));

    const elementosComunes = ['authTabs', 'oauthContainer', 'dividerText'];
    const ocultarComunes = ['forgot', 'reset', 'verify'].includes(type);
    elementosComunes.forEach(id => {
        document.getElementById(id).classList.toggle('hidden', ocultarComunes);
    });

    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));

    if (type === 'login') {
        document.getElementById('tabLoginBtn').classList.add('active');
        document.getElementById('loginForm').classList.remove('hidden');
    } else if (type === 'register') {
        document.getElementById('tabRegisterBtn').classList.add('active');
        document.getElementById('registerForm').classList.remove('hidden');
    } else {
        document.getElementById(`${type}Form` || 'verifyForm').classList.remove('hidden');
    }
}

async function verificarSesionActiva() {
    const token = localStorage.getItem('token');
    if (!token) return; 
    try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const data = await response.json();
            usuarioActual = data.usuario;
            cargarDashboard();
        } else {
            localStorage.removeItem('token');
        }
    } catch (err) {
        console.error('Error sesión:', err);
    }
}

function showNotification(message, type = 'error') {
    const alertDiv = document.getElementById('globalAlert');
    alertDiv.className = `custom-alert alert-${type}`;
    alertDiv.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-xmark' : 'fa-circle-check'}"></i> ${message}`;
    alertDiv.classList.remove('hidden');
}

function clearNotification() {
    document.getElementById('globalAlert').classList.add('hidden');
}

function cargarDashboard() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('dashboardScreen').classList.remove('hidden');
    document.getElementById('dashWelcomeName').innerText = usuarioActual.nombre;
    document.getElementById('navUserName').innerText = `${usuarioActual.nombre} ${usuarioActual.apellido}`;
    document.getElementById('navAvatar').src = usuarioActual.foto_url || `https://ui-avatars.com/api/?name=${usuarioActual.nombre}+${usuarioActual.apellido}&background=ef4444&color=fff`;
    document.getElementById('profNombre').value = usuarioActual.nombre;
    document.getElementById('profApellido').value = usuarioActual.apellido;
    document.getElementById('profTelefono').value = usuarioActual.telefono || '';
}

async function saveProfile() {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('nombre', document.getElementById('profNombre').value);
    formData.append('apellido', document.getElementById('profApellido').value);
    formData.append('telefono', document.getElementById('profTelefono').value);
    
    const fileInput = document.getElementById('profFotoFile');
    if (fileInput.files[0]) formData.append('foto_perfil', fileInput.files[0]);

    try {
        const res = await fetch(`${API_URL}/api/usuario/perfil`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        if (res.ok) {
            const data = await res.json();
            usuarioActual = data.usuario;
            cargarDashboard();
            document.getElementById('profileDropdown').classList.add('hidden');
            alert('¡Perfil actualizado!');
        } else {
            alert('Error al actualizar.');
        }
    } catch (e) {
        alert('Error de conexión.');
    }
}

function toggleProfileDropdown(e) {
    e.stopPropagation();
    document.getElementById('profileDropdown').classList.toggle('hidden');
}

function logout() {
    localStorage.removeItem('token');
    document.getElementById('dashboardScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    switchTab('login');
}
