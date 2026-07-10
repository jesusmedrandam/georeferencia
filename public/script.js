const API_URL = window.location.origin;
let usuarioActual = null;
let emailEnVerificacion = '';

document.addEventListener("DOMContentLoaded", () => {
    // === VALIDACIÓN DE SESIÓN AUTOMÁTICA AL CARGAR ===
    verificarSesionActiva();

    // Controladores de Pestañas
    document.getElementById('tabLoginBtn').addEventListener('click', () => switchTab('login'));
    document.getElementById('tabRegisterBtn').addEventListener('click', () => switchTab('register'));
    document.getElementById('goToForgotLink').addEventListener('click', () => switchTab('forgot'));
    
    document.querySelectorAll('.go-back-login').forEach(btn => {
        btn.addEventListener('click', () => switchTab('login'));
    });

    // Controladores de Formularios
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('forgotForm').addEventListener('submit', handleForgot);
    document.getElementById('resetPasswordForm').addEventListener('submit', handleResetReal);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    document.getElementById('verifyForm').addEventListener('submit', handleVerify);

    // Controlador para Reenviar Código
    document.getElementById('btnResendCode').addEventListener('click', handleResendCode);

    // Guardar cambios y perfil
    document.getElementById('btnSaveProfile').addEventListener('click', (e) => {
        e.preventDefault();
        saveProfile();
    });
    document.getElementById('btnLogout').addEventListener('click', logout);
    
    // CORREGIDO: Evita que el menú de actualizar datos desaparezca erráticamente
    document.getElementById('userMenuBtn').addEventListener('click', toggleProfileDropdown);
    document.getElementById('profileDropdown').addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => {
        const userPanel = document.querySelector('.user-panel');
        if (!userPanel.contains(e.target)) {
            document.getElementById('profileDropdown').classList.add('hidden');
        }
    });

    // Actualizar nombre de archivo en label al seleccionar foto
    document.getElementById('profFotoFile').addEventListener('change', (e) => {
        const fileName = e.target.files[0]?.name || "Seleccionar foto de tu equipo";
        document.getElementById('fileNameLabel').innerText = fileName;
    });
});

// === MENSAJES FLOTANTES ===
function showNotification(message, type = 'success') {
    const notif = document.getElementById('notification');
    notif.className = `notification ${type}`;
    notif.innerHTML = type === 'success' 
        ? `<i class="fa-solid fa-circle-check"></i> <span>${message}</span>`
        : `<i class="fa-solid fa-circle-exclamation"></i> <span>${message}</span>`;
    
    notif.classList.add('show');
    setTimeout(() => notif.classList.remove('show'), 4000);
}

function clearNotification() {
    document.getElementById('notification').classList.remove('show');
}

// === CONTROLADOR DE VISTAS (PESTAÑAS ORIGINALES) ===
function switchTab(tab) {
    clearNotification();
    
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('registerScreen').classList.add('hidden');
    document.getElementById('forgotScreen').classList.add('hidden');
    document.getElementById('resetPasswordScreen').classList.add('hidden');
    document.getElementById('verifyScreen').classList.add('hidden');

    document.getElementById('tabLoginBtn').classList.remove('active');
    document.getElementById('tabRegisterBtn').classList.remove('active');

    if (tab === 'login') {
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('tabLoginBtn').classList.add('active');
    } else if (tab === 'register') {
        document.getElementById('registerScreen').classList.remove('hidden');
        document.getElementById('tabRegisterBtn').classList.add('active');
    } else if (tab === 'forgot') {
        document.getElementById('forgotScreen').classList.remove('hidden');
    } else if (tab === 'reset') {
        document.getElementById('resetPasswordScreen').classList.remove('hidden');
    } else if (tab === 'verify') {
        document.getElementById('verifyScreen').classList.remove('hidden');
        document.getElementById('displayVerifyEmail').innerText = emailEnVerificacion || 'tu correo';
    }
}

// === LÓGICA DE USUARIOS ===

async function verificarSesionActiva() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        const res = await fetch(`${API_URL}/api/auth/me`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) {
            usuarioActual = data.usuario;
            showDashboard();
        } else {
            localStorage.removeItem('token');
        }
    } catch (err) {
        console.error("Error validando token.");
    }
}

async function handleLogin(e) {
    e.preventDefault();
    clearNotification();

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const res = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (res.ok) {
            localStorage.setItem('token', data.token);
            usuarioActual = data.usuario;
            showDashboard();
            showNotification('¡Inicio de sesión exitoso!', 'success');
        } else if (res.status === 401) {
            // CAPTURA DE CUENTA NO VERIFICADA
            emailEnVerificacion = email;
            switchTab('verify');
            showNotification('Tu cuenta no está verificada. Ingresa tu código aquí.', 'error');
        } else {
            showNotification(data.mensaje || 'Credenciales incorrectas.', 'error');
        }
    } catch (err) {
        showNotification('Error de conexión con el servidor.', 'error');
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

    try {
        const res = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, apellido, email, fecha_nacimiento, password })
        });

        const data = await res.json();

        if (res.ok) {
            emailEnVerificacion = email;
            switchTab('verify'); 
            showNotification(data.mensaje, 'success');
        } else {
            showNotification(data.mensaje || 'Error al crear cuenta.', 'error');
        }
    } catch (err) { 
        showNotification('Error de conexión en el servidor.', 'error'); 
    }
}

async function handleVerify(e) {
    e.preventDefault();
    clearNotification();
    const codigo = document.getElementById('verifyCode').value;
    try {
        const res = await fetch(`${API_URL}/api/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailEnVerificacion, codigo })
        });
        const data = await res.json();
        if (res.ok) {
            switchTab('login');
            showNotification(data.mensaje, 'success');
        } else {
            showNotification(data.mensaje || 'Código inválido.', 'error');
        }
    } catch (err) { 
        showNotification('Error al verificar.', 'error'); 
    }
}

async function handleResendCode() {
    clearNotification();
    if (!emailEnVerificacion) {
        showNotification('No hay un correo registrado para reenvío. Vuelve al login.', 'error');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailEnVerificacion })
        });

        const data = await res.json();
        if (res.ok) {
            showNotification('¡Código nuevo enviado con éxito! Revisa tu bandeja.', 'success');
        } else {
            showNotification(data.mensaje || 'No se pudo reenviar el código.', 'error');
        }
    } catch (err) {
        showNotification('Error de conexión al reenviar.', 'error');
    }
}

async function handleForgot(e) {
    e.preventDefault();
    clearNotification();
    const email = document.getElementById('forgotEmail').value;

    try {
        const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok) {
            emailEnVerificacion = email;
            switchTab('reset');
            showNotification('Código enviado. Introduce el código y tu nueva contraseña.', 'success');
        } else {
            showNotification(data.mensaje || 'Error al procesar solicitud.', 'error');
        }
    } catch (err) {
        showNotification('Error de conexión.', 'error');
    }
}

async function handleResetReal(e) {
    e.preventDefault();
    clearNotification();
    const codigo = document.getElementById('resetCode').value;
    const nuevaPassword = document.getElementById('resetNewPassword').value;

    try {
        const res = await fetch(`${API_URL}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailEnVerificacion, codigo, nuevaPassword })
        });
        const data = await res.json();
        if (res.ok) {
            switchTab('login');
            showNotification(data.mensaje, 'success');
        } else {
            showNotification(data.mensaje || 'No se pudo restablecer.', 'error');
        }
    } catch (err) {
        showNotification('Error al conectar con servidor.', 'error');
    }
}

// === FUNCIONES EXCLUSIVAS DEL DASHBOARD ===

function showDashboard() {
    if (!usuarioActual) return;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('dashboardScreen').classList.remove('hidden');

    document.getElementById('dashWelcomeName').innerText = usuarioActual.nombre;
    document.getElementById('dashName').innerText = `${usuarioActual.nombre} ${usuarioActual.apellido}`;
    
    document.getElementById('profNombre').value = usuarioActual.nombre;
    document.getElementById('profApellido').value = usuarioActual.apellido;
    document.getElementById('profTelefono').value = usuarioActual.telefono || '';

    const avatar = document.getElementById('dashAvatar');
    if (usuarioActual.foto_url) {
        avatar.src = usuarioActual.foto_url;
    } else {
        avatar.src = "https://www.w3schools.com/howto/img_avatar.png";
    }
}

async function saveProfile() {
    clearNotification();
    const token = localStorage.getItem('token');
    
    const formData = new FormData();
    formData.append('nombre', document.getElementById('profNombre').value);
    formData.append('apellido', document.getElementById('profApellido').value);
    formData.append('telefono', document.getElementById('profTelefono').value);
    
    const fileInput = document.getElementById('profFotoFile');
    if (fileInput.files[0]) {
        formData.append('foto_perfil', fileInput.files[0]);
    }

    try {
        const res = await fetch(`${API_URL}/api/usuario/perfil`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        const data = await res.json();
        if (res.ok) {
            usuarioActual = data.usuario;
            showDashboard();
            showNotification(data.mensaje, 'success');
            document.getElementById('profileDropdown').classList.add('hidden');
        } else {
            showNotification(data.mensaje || 'Error al guardar perfil.', 'error');
        }
    } catch (err) {
        showNotification('Error al intentar guardar cambios.', 'error');
    }
}

function toggleProfileDropdown(event) {
    event.stopPropagation();
    document.getElementById('profileDropdown').classList.toggle('hidden');
}

function logout() {
    localStorage.removeItem('token');
    document.getElementById('dashboardScreen').classList.add('hidden');
    switchTab('login');
    document.getElementById('authScreen').classList.remove('hidden');
}
