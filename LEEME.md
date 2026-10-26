# Libreta de gastos (app instalable con sincronización)

App web instalable (PWA) para llevar ingresos, gastos y tarjetas con cuotas.
Tus datos se guardan en tu propia base de datos de Supabase y se sincronizan entre la PC y el celular. Funciona sin conexión: los cambios se envían solos al volver internet.

## Qué hay en esta carpeta

- `index.html`, `app.js`, `app.css`: la app.
- `config.js`: acá pegás la URL y la clave pública de tu proyecto de Supabase.
- `supabase/schema.sql`: crea la tabla y las reglas de seguridad.
- `vendor/supabase.js`: biblioteca de Supabase (versión 2.117.3), incluida para que la app no dependa de terceros.
- `manifest.webmanifest`, `sw.js`, `icons/`: lo necesario para instalarla y abrirla sin conexión.

## Paso 1: crear la base de datos en Supabase (una sola vez)

1. Entrá a https://supabase.com y creá un proyecto nuevo (el plan gratuito alcanza).
2. En el panel del proyecto abrí **SQL Editor**, creá una consulta nueva, pegá el contenido completo de `supabase/schema.sql` y ejecutalo (**Run**).
   - Este archivo crea la tabla `items` y activa la seguridad por filas (RLS): cada persona solo puede leer y modificar sus propios registros.
   - La última línea activa los cambios en vivo entre dispositivos. Si da un aviso porque la tabla ya estaba agregada, se puede ignorar.
3. Copiá dos datos del proyecto: la **URL** y la **clave publishable** (empieza con `sb_publishable_`). Están en **Settings > API Keys**, o en el botón **Connect** del panel.
   - Esa clave está pensada para usarse en el navegador y por eso puede ir en `config.js`.
   - **No uses nunca** la clave `secret` ni la `service_role` en esta app: se saltean la seguridad.
4. Abrí `config.js` y reemplazá `TU_URL_DE_SUPABASE` y `TU_CLAVE_PUBLISHABLE` por esos dos valores.

## Paso 2: publicar la app en internet (una sola vez)

Una app instalable necesita una dirección HTTPS. La opción gratuita más simple es GitHub Pages.

1. En GitHub creá un repositorio nuevo, por ejemplo `libreta`, **Público** (en el plan gratuito GitHub Pages lo exige).
2. Subí el contenido de esta carpeta, con `config.js` ya completo. Se puede hacer con **Add file > Upload files**.
3. En el repositorio entrá a **Settings > Pages**, elegí "Deploy from a branch", la rama `main` y la carpeta `/ (root)`. Guardá.
4. Después de uno o dos minutos la app queda en `https://TU-USUARIO.github.io/libreta/`.

El repositorio público contiene el código y la clave publishable. Tus gastos no están ahí: viven en tu cuenta de Supabase y solo se ven con tu usuario y contraseña.

## Paso 3: configurar los correos de Supabase

Los enlaces de confirmación de cuenta y de recuperación de contraseña se arman con la dirección del sitio. En Supabase, dentro de **Authentication**, buscá la configuración de URL (**URL Configuration**) y poné como *Site URL* la dirección de tu app en GitHub Pages. Revisá también si la confirmación de correo está activada para el proveedor Email: si lo está, vas a recibir un correo al crear la cuenta y tenés que tocar el enlace antes de ingresar.

## Paso 4: instalarla

- **PC con Chrome o Edge:** abrí la dirección y usá el ícono de instalar en la barra de direcciones, o el botón "Instalar la app" dentro de la página.
- **Android con Chrome:** abrí la dirección y elegí menú ⋮ > Instalar aplicación.
- **iPhone o iPad (iOS 16.4 o posterior):** abrí la dirección en Safari, tocá Compartir y elegí "Agregar a pantalla de inicio". El iPhone no muestra un botón automático de instalación.
- **Mac con Safari 17 o posterior:** menú Archivo > Agregar al Dock.
- Firefox de escritorio no instala este tipo de apps.

Después creá tu cuenta con correo y contraseña. En el otro dispositivo ingresá con la misma cuenta y vas a ver los mismos datos.

## Cosas que conviene saber

- **Sin conexión:** podés cargar movimientos sin internet. Se guardan en el dispositivo y se envían al volver la conexión. El texto bajo el título muestra cuántos cambios faltan enviar.
- **Respaldo:** Supabase guarda tus datos, pero conviene usar de vez en cuando el botón "Exportar a CSV" del Resumen, que descarga una copia en tu dispositivo. Los proyectos del plan gratuito de Supabase pueden pausarse por inactividad prolongada; revisá las condiciones vigentes en supabase.com.
- **Actualizar la app:** reemplazá los archivos en el repositorio y subí el número de `CACHE` en `sw.js` (por ejemplo `libreta-v3`). Los dispositivos toman la versión nueva al volver a abrir la app con conexión.
- **Cerrar sesión** borra la copia local de los datos de ese dispositivo; los datos siguen en tu cuenta.
