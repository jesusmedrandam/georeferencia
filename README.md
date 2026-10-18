# GeoAlerta

Plataforma de reportes y gestión de emergencias georreferenciadas.

## Estado de desarrollo

Esta rama implementa la **fase 1**: autenticación existente reforzada, instituciones, membresías y permisos.

- **Ciudadano:** cualquier usuario registrado y verificado, incluso si también pertenece a una institución.
- **Operador:** miembro activo que podrá atender incidentes asignados a su institución (gestión de emergencias: fase posterior).
- **Administrador institucional:** gestiona operadores y administradores **solo de su institución**.
- **Superadministrador:** configura instituciones globalmente. Su privilegio **no** se puede asignar por registro web ni API pública.

Una persona puede tener varias membresías, con distinto rol en cada institución. Desactivar una membresía no desactiva la cuenta personal.

## Instalación

Requisitos: Node.js 20 o superior y PostgreSQL accesible.

1. Ejecuta `npm install`.
2. Copia `.env.example` como `.env` y configura `DATABASE_URL`, `BREVO_API_KEY` y un **JWT_SECRET de al menos 32 caracteres**, usando un valor aleatorio privado.
3. Inicia con `npm start`.
4. Al arrancar, se crean de manera incremental las columnas/tablas faltantes en PostgreSQL. Si una migración falla, la aplicación no arranca.
5. Ejecuta `npm run check` y `npm test` para revisar sintaxis y la lógica de los códigos.

**Antes del primer despliegue:** realiza una copia de seguridad de PostgreSQL. Se conservan usuarios, claves y perfiles existentes. Los códigos de verificación anteriores a esta versión no se reconocen: sus titulares deben solicitar uno nuevo.

Si tu despliegue anterior dependía de una clave JWT corta o predeterminada, configura una nueva clave secreta de longitud suficiente. Esto requerirá volver a iniciar sesión en los dispositivos con tokens firmados por el secreto anterior.

### Habilitar el primer superadministrador

Registra e inicia sesión con tu cuenta normal. Después, desde una sesión administrativa de PostgreSQL (no desde la web), ejecuta sustituyendo el correo por el de tu cuenta verificada:

```sql
UPDATE usuarios
SET es_superadmin = TRUE
WHERE LOWER(email) = LOWER('tu_correo_verificado@ejemplo.com')
  AND verificado = TRUE;
```

Cierra sesión y vuelve a entrar para mostrar la opción de **Registrar institución**. No hay credenciales ni superadministrador predeterminados. No concedas este permiso a cuentas de terceros.

### Cómo probar los roles

1. Entra como superadministrador y registra una institución.
2. Registra y verifica otra cuenta normal.
3. Desde la institución, añade el correo de esa cuenta como **operador**.
4. Abre sesión con la segunda cuenta: debe aparecer su institución, pero no las herramientas de administración.
5. Como superadministrador o administrador institucional, cambia a **administrador** esa membresía.
6. Comprueba que esa persona solo puede gestionar miembros de su propia institución.
7. Desactiva su membresía y comprueba que puede seguir iniciando sesión como ciudadano.

## API de la fase 1

Todas las rutas de instituciones requieren cabecera `Authorization: Bearer <token>`.

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/api/auth/me` | Sesión activa |
| GET | `/api/instituciones/mis` | Sesión activa |
| GET | `/api/admin/instituciones` | Superadministrador |
| POST | `/api/admin/instituciones` | Superadministrador |
| PATCH | `/api/admin/instituciones/:id` | Superadministrador |
| GET | `/api/instituciones/:id/miembros` | Administrador de esa institución / superadministrador |
| POST | `/api/instituciones/:id/miembros` | Administrador de esa institución / superadministrador |
| PATCH | `/api/instituciones/:id/miembros/:usuarioId` | Administrador de esa institución / superadministrador |

El alta de miembros requiere que el usuario **ya exista y haya verificado su correo**. Cambiar estado o rol de un miembro existente usa PATCH; POST no modifica membresías existentes.

## Seguridad de la autenticación

- Contraseñas con bcrypt; los nuevos registros exigen entre 8 y 72 caracteres.
- Códigos de verificación y recuperación **con finalidades separadas**, firma HMAC, vigencia de **15 minutos**, **5 intentos** y espera de **60 segundos** para solicitar otro.
- Después de 5 contraseñas incorrectas, se bloquea temporalmente el acceso de esa cuenta durante 5 minutos.
- Los JWT contienen solo ID de usuario y versión de contraseña; el middleware comprueba la cuenta activa, verificada y la versión actual.
- La restauración o cambio de contraseña invalida los tokens anteriores; el cambio desde el perfil entrega un token renovado.
- Las autorizaciones institucionales se comprueban en el backend con membresías activas: ocultar controles en el navegador no concede ni sustituye permisos.
- Faltan pruebas de integración reales contra PostgreSQL y comprobaciones operativas de correo antes de usar el sistema en producción.

## Diseño para las siguientes fases (todavía no implementado)

Se propone separar cuatro conceptos:

- **Reporte ciudadano:** autor, categoría, descripción, ubicación, estado de validación.
- **Emergencia validada:** incidente confirmado, prioridad, ubicación y estado general.
- **Asignación institucional:** relación entre emergencia e institución, responsable y estado propio de atención.
- **Bitácora:** entradas inmutables con actor, fecha/hora, acción y cambios relevantes.

Cuando empecemos esa fase, añade migraciones controladas para `reportes`, `evidencias`, `emergencias`, `emergencia_instituciones` y `bitacora`. Las notificaciones públicas requieren reglas de validación y evaluación de riesgo, no solo la clasificación automática por tipo.

**GeoAlerta aún no es un servicio oficial de emergencias. Ante una emergencia real en Ecuador, utiliza el ECU 911.**


## Fase 2: reportes ciudadanos y mapa (2026-10)

El sistema permite que cualquier cuenta verificada envíe un reporte de incidente y consulte su historial. El rol de superadministrador también conserva la posibilidad de reportar como ciudadano.

### Formulario ciudadano

- Tipo de emergencia desde el catálogo de PostgreSQL (8 categorías iniciales).
- Descripción obligatoria de 15 a 1500 caracteres.
- Cantidad estimada de personas afectadas, observaciones opcionales y referencia del lugar.
- Latitud/longitud obligatorias, seleccionables tocando el mapa Leaflet + OpenStreetMap, arrastrando el marcador, introduciendo coordenadas o aceptando la geolocalización del navegador.
- Hasta **3 fotografías** JPEG/PNG/WebP de máximo **3 MB cada una**. Sharp normaliza las imágenes a WebP, las redimensiona y retira metadatos EXIF, incluidos datos GPS. En este prototipo las imágenes se almacenan en PostgreSQL en BYTEA. Para escala real debe sustituirse por almacenamiento de objetos con autorización de lectura.
- Hasta **5 reportes por usuario en una hora** como limitación inicial contra abusos. No sustituye controles adicionales por IP/cuenta.

### Privacidad y validación

Un reporte se crea con estado **pendiente**. Su autor lo puede consultar en **Mis reportes**, incluidas sus fotografías, mediante endpoints autenticados que comprueban la propiedad del registro. No se publica públicamente como emergencia validada.

La nueva tabla `emergencias` es distinta de `reportes`. El mapa de emergencias verificadas solo utiliza registros de `emergencias` y se mostrará **vacío al comienzo**, hasta que se implemente el panel de validación institucional. Este es el comportamiento correcto. Los puntos azules del mapa son únicamente reportes del usuario autenticado (en la página del historial visible). Los rojos representarán emergencias ya validadas.

Los estados del reporte son `pendiente`, `informacion_solicitada`, `validado` y `rechazado`. Los estados de una emergencia validada son `validada`, `en_atencion`, `controlada` y `cerrada`. La fase 2 **no agrega aún botones para validar o rechazar**: corresponden a la fase 3 y deben verificar el rol institucional autorizado del lado del servidor.

### Nuevos endpoints (sesión Bearer obligatoria)

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/tipos-emergencia` | Catálogo activo |
| POST | `/api/reportes` | Multipart/form-data: tipo_id, descripcion, personas_afectadas, latitud, longitud, observaciones, referencia_ubicacion, fotografias (opcional) |
| GET | `/api/reportes/mios?pagina=1` | Historial del ciudadano; 20 reportes por página |
| GET | `/api/reportes/:id/fotos/:fotoId` | Foto de un reporte propio, tras comprobar el propietario |
| GET | `/api/mapa/emergencias` | Máximo 500 emergencias verificadas no cerradas, sin datos privados del autor |

### Aiven / Render

**No ejecutes SQL adicional si el servicio de Render ya inicia correctamente con el código de `main`.** `src/report-schema.js` crea las tablas `tipos_emergencia`, `reportes`, `reporte_fotografias`, `emergencias` y `reporte_bitacora`, sus índices y las categorías iniciales en una transacción al arrancar. No borra `usuarios` ni `instituciones`.

Render tiene que poder instalar las nuevas dependencias de `package.json`, incluida `sharp`, y conservar las variables `DATABASE_URL`, `JWT_SECRET` y `BREVO_API_KEY`. El mapa necesita conexión para obtener las teselas de OpenStreetMap, pero el formulario permite introducir las coordenadas manualmente si no se carga el mapa.

### Verificación sugerida

1. Inicia sesión y abre **Reportes de emergencia**.
2. Selecciona una categoría, escribe la descripción, marca la ubicación y envía un reporte de prueba.
3. Comprueba el mensaje `pendiente` y el punto azul en **Mis reportes**.
4. Adjunta una foto, comprueba que se muestra al pulsar `Ver fotografía(s)`.
5. Inicia sesión con otro usuario y verifica que no puede consultar el reporte ni recuperar la foto del primer usuario.
6. Comprueba que el mapa de emergencias verificadas está vacío hasta que se implemente la revisión institucional.
7. Ejecuta `npm test` y `npm run check` para las pruebas automáticas.

**Advertencia:** GeoAlerta sigue en desarrollo. El formulario no envía avisos a instituciones ni servicios oficiales todavía. Para emergencias reales en Ecuador se debe llamar al ECU 911.
