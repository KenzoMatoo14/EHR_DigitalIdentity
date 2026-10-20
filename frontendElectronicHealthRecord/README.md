# frontendElectronicHealthRecord

Frontend del **Expediente Clínico Electrónico (ECE)** del Departamento Médico UP. Es una mezcla de tres cosas:

- **Estructura y aspecto** (barra, menú, agenda, modales, pestañas, botones, tipografía Inter): el diseño en Figma
  **[ECE UP diseño](https://www.figma.com/design/KC0Emp8LPGABVHlths0Zjg/ECE-UP-dise%C3%B1o)** (archivo `KC0Emp8LPGABVHlths0Zjg`).
- **Contenido de la consulta**: la nota por secciones de la NOM-004 generada desde el Excel Norm04 (la versión
  anterior del proyecto), repartida en **dos columnas**.
- **Paleta de colores**: la de los demás frontends del repo (`frontendBirthCertificate`, `frontendIdentityDigital`,
  `frontendUsersInteface`, `frontendScholarCurriculum`), que usan la escala de Tailwind.

**Datos:** una parte ya es real y otra sigue simulada, todo detrás de una sola capa (`core/api.js`):

| Real: MySQL vía `server.js` → API Gateway → microservicio `electronicHealthRecord` | Simulado: `localStorage` del navegador |
|---|---|
| Registro del paciente, Ficha de datos, Antecedentes y Notas SOAP de enfermería, todo por **CURP** | Agenda, citas, llegada y la consulta del médico |

El paciente local (`P-00x`) guarda su `curp`, que es el enlace con MySQL. El buscador de **Pacientes** consulta MySQL (`GET /api/pacientes?q=`, por nombre, CURP o
ID institucional) y agrega/actualiza en el navegador los pacientes que encuentra: así aparecen los registrados en otra
computadora o antes de limpiar el navegador, y se les puede agendar cita y abrir su expediente. Para levantar el backend ver
`electronicHealthRecord/README.md` (MySQL en Docker + `node bin/www` + Gateway).

### Camino "resuelto en enfermería" (recepción / enfermería)

1. **Registrar Paciente**: el modal pide además la **CURP** (obligatoria, llave del paciente). El ID institucional
   se guarda como `folio` del Excel. Si la CURP ya existe en la base, no se sobrescribe: el paciente se agrega a este
   navegador con los datos guardados en MySQL (útil tras limpiar el navegador o si se registró en otra computadora).
2. **Ficha de datos**: se lee de MySQL al abrir; al guardar, la CURP queda de solo lectura.
3. **Antecedentes**: se leen y guardan en MySQL (una fila por paciente; guardar reemplaza).
4. **Consultas → nota SOAP** (frame `ConsultaSOAP`): 7 paneles en dos columnas con los 44 campos clínicos del Excel
   (`SOAP_PANELS` en `js/data/schema.js`). Ningún campo es obligatorio, pero lo capturado se valida (tipo, tamaño
   y rango clínico; si algo falla, un aviso junto al botón dice qué revisar). Abre vacía: no precarga antecedentes,
   así cada nota guarda solo lo escrito en esa visita. Guardar agrega una nota (no se editan); abajo, las notas
   anteriores mostrando solo los campos con dato. Los paneles "Alergias" y "PLAN" no se dibujan: no tienen campos del
   Excel (PLAN solo tendría 6.3/6.4, que son del camino del médico).

Un paciente sin CURP muestra un aviso en Antecedentes y Consultas: hay que capturarla primero en su Ficha de datos. El médico sigue viendo su consulta de siempre en "Consultas".

## Cómo correrlo

```bash
cd frontendElectronicHealthRecord/frontendElectronicHealthRecordApp
npm install
npm start          # o `npm run live` para recarga automática al editar server.js
```

Abrir <http://localhost:5514>. Cuentas de demo (contraseña `demo1234`):

| Cuenta | Rol |
|---|---|
| `recepcion@up.edu.mx` (V. Cadena) | Recepción / Enfermería: agenda, citas, registro de pacientes, registrar llegada |
| `medico@up.edu.mx` (Dr. R. Aguilar) | Médico general: pacientes que ya llegaron, expediente, consulta |

Requiere Internet (CDN de Tailwind y Google Fonts/Inter). **La agenda empieza vacía**: ya no hay pacientes de
demostración (`js/data/seed.js` solo trae las dos cuentas). Los datos del navegador ya no se regeneran cada día;
solo se reinician si cambia `DB_VERSION` en `core/api.js`. Se quitó el botón "Restablecer datos de demostración".

## Mapa Figma → código

| Frame de Figma | Dónde está |
|---|---|
| `Main` (Agenda del día) | `app/pages/recepcion/agenda.html` + `js/pages/recepcionAgenda.js` |
| `RegistrarPaciente`, `Pacientes`, `PacientesEjemplo`, `CitaPaciente` (modales) | `js/core/modals.js` |
| `Ficha de datos` | `js/pages/tabs/fichaTab.js`; los campos salen del Excel (`FICHA_FIELDS` en `js/data/schema.js`), no del Figma |
| `Consulta` / `ConsultaSOAP` | **Sustituidos** por la consulta por secciones NOM en dos columnas: `js/pages/tabs/consultasTab.js` + `consultaForm.js` (ver abajo) |
| Barra superior, menú, pestañas, botones, inputs | `js/core/ui.js` + `css/app.css` |

**Paleta** (todo vive en `:root` de `css/app.css`; cambiar de paleta = cambiar ese bloque): fondo `gray-100` ·
barra, cabeceras y botón neutro `gray-200` · texto `gray-700` · menú activo `gray-600` · acciones `blue-500/600/700`
(pestañas y cabeceras de modal `blue-600`) · cancelar/eliminar `red-500/600` · aro de foco `indigo-500` · círculo de
usuario naranja `rgb(255,102,0)`. Layout, medidas y formas siguen siendo las del Figma. El modo oscuro de los otros
frontends no se replicó (el Figma no lo incluye).

## Flujo

```
Agenda del día (recepción) ── Nueva cita / clic en un hueco ──► modal "Cita Edición"
   │                       └─ + Registrar paciente ──────────► modal "Registrar nuevo paciente" ─► agendar
   ├─ Registrar llegada ─► el paciente aparece en la agenda del médico
   └─ (médico) Atender ─► Expediente ─► pestaña Consultas ─► consulta en dos columnas ─► notas en el expediente

Agenda del médico ── + Agregar consulta ─► buscador de pacientes ─► motivo + ¿Consulta estilo SOAP | Historial médico completo?
                                          └─► abre la consulta (crea la visita con folio; sin cita previa)
```

**Triage: fuera por ahora.** Se quitó la página, el menú, los estados (`esperando_triage`, `en_triage`,
`resuelto_recepcion`), el resumen en la consulta y los datos demo. El BPMN sí lo contempla; cuando regrese habrá
que reintroducirlo entre "Registrar llegada" y "Esperando médico".

## Agenda del médico

Una fila por paciente que ya llegó, en el orden de su cita: hora, nombre, tipo y el **motivo de la visita** (ya no se
muestra el estado). Abajo, "Atendidos hoy". El botón **+ Agregar consulta** abre el buscador de pacientes (nombre, ID
institucional o expediente); al elegir uno se pide el motivo (opcional) y qué se le va a hacer:

- **Consulta estilo SOAP** → abre la consulta con la *nota de evolución* (6.2).
- **Historial médico completo** → abre la consulta con la *historia clínica* (6.1).

Ambas se pueden cambiar después con el selector "Tipo de nota" de la propia consulta. `api.startWalkInConsulta` crea la
visita con folio y la deja "con el médico"; si el paciente ya tenía una visita abierta, reutiliza esa.

## Consulta médica (dos columnas)

De arriba abajo, en `consultaForm.js`:

1. **Datos de la visita** (folio, cita, tipo y motivo) | **Alergias (notas importantes)**.
2. **Historial de consultas** (plegado, ancho completo).
3. **Tipo de nota**: Primera vez → historia clínica 6.1 · Subsecuente → nota de evolución 6.2 · Urgencia → nota inicial
   de urgencias 7.1. Por defecto sugiere la que corresponde según haya o no historia clínica.
4. **Una tarjeta por sección de la NOM** (6.1.1 Interrogatorio, 6.1.2 Exploración física… / 6.2.x / 7.1.x), con todos los
   campos del Excel para ese tipo de nota, repartidas en dos columnas. El reparto **mide la altura real** de cada
   tarjeta: conserva el orden de la NOM si las columnas quedan parejas (≤ 15 % de diferencia) y, si no, coloca cada
   tarjeta en la columna más corta.
5. **Decisión clínica y manejo**: Interconsulta interna 6.3 (psicología) y Referencia/traslado 6.4 | Manejo / resolución
   (medicamento, RPBI, notificación obligatoria, indicaciones para el paciente).
6. **Salir sin cerrar · Guardar borrador · Cerrar consulta** (las notas son solo-agregar, por eso pide confirmación).

En la historia clínica, la **ficha de identificación** y el **grupo étnico** se muestran en solo lectura (tarjeta 6.1.1)
y se copian de la Ficha de datos al cerrar; no se vuelven a capturar. En pantallas angostas (≤ 1000 px) las columnas
se apilan.

## Excel Norm04

`data/schema.js` transcribe el Excel **sin renombrar campos**; `core/formRenderer.js` genera de ahí los
formularios, la validación (`VARCHAR(n)`, `DECIMAL(3,1)`, `CHAR(18)` + patrón CURP, tensión `120/80`) y las
vistas de solo lectura. Los valores se guardan tipados (`36.7`, `82`, `true`) para mapearlos a Solidity.
**Ficha de datos = solo el Excel.** Tiene los 12 campos de `FichaIdentificacion` (CURP, nombre, apellido paterno,
apellido materno, fecha de nacimiento, entidad de nacimiento, sexo, nacionalidad, folio, entidad de residencia,
municipio de residencia, localidad de residencia) y `grupoEtnico`.
Los campos que la consulta muestra por tipo de nota son los del Excel completos: historia clínica 33 campos +
ficha y grupo étnico (copiados), evolución 12, urgencias 14, interconsulta 4, referencia 8 (los objetos cuentan por sus hijos).

## Permisos

Recepción solo ve la pestaña "Ficha de datos" y el resumen de visita; antecedentes, consultas, interconsultas y
notas son del médico. `api.js` lo hace cumplir (`requireRole`) aunque sea simulado. Las notas son **solo-agregar**.

## Decisiones mías (el Figma no las define; conviene confirmarlas)

- **Rango de la agenda**: 07:00–14:55 en bloques de 5 min (`config.js`). El Figma solo muestra 07:00–08:05.
- **Zona derecha de la agenda** (vacía en el Figma): muestra el estado de la visita y su acción ("Registrar llegada", "Ver →"…). Clic en un hueco = nueva cita; clic en una cita = editarla.
- **Opciones de los selects** que el Figma solo muestra como "Sin indicar": tipos de cita (Primera vez / Subsecuente / Urgencia), estatus (por confirmar / confirmada) y duraciones del modal "Cita Edición".
- **"Tipo de paciente"** (Alumno/Colaborador): campo que agregué al modal "Registrar nuevo paciente" porque la agenda muestra ese dato y el modal no lo captura. El modal conserva fecha de nacimiento y sexo biológico (los pide el Figma), aunque ya no están en la Ficha de datos.
- **Sidebar por rol**: recepción ve Inicio / Registrar Paciente / Pacientes; el médico, Inicio / Pacientes.
- **Pestañas Antecedentes e Interconsultas**: el Figma solo las nombra. Antecedentes usa los campos del Excel (6.1.1); Interconsultas lista las notas 6.3/6.4.
- **Login**: sin diseño en Figma; usa los mismos tokens.
- **"Alergias (notas importantes)"**: viene del frame `ConsultaSOAP` del Figma pero **no está en el Excel**. Es dato del paciente (no de la nota) y se actualiza al cerrar la consulta.
- **Motivo de la cita**: como ya no hay triage, es el que trae la cita ("Consulta general" por defecto) o el que el médico escribe en "Agregar consulta".
- **"Consulta estilo SOAP" = nota de evolución (6.2) e "Historial médico completo" = historia clínica (6.1)**: es mi interpretación de tus dos opciones; la nota 6.2 es la equivalente NOM del SOAP. Si "SOAP" debe verse con las letras S/O/A/P, hay que agruparlas así.
- **Reagendar** un "No se presentó" = abrir la cita, cambiar fecha/hora y guardar.

## Quitado en esta versión

- **Tipo 1 (texto libre) / Tipo 2 (catálogos)** de la consulta SOAP y la pantalla "Seleccione el tipo de registro médico";
  también los 9 paneles SOAP del Figma (`SOAP_LAYOUT`, la nota `soapLibre`).
- **Todo el triage**: página `/recepcion/triage` (redirige a `/recepcion`), ítem del menú, cola, manejo básico en recepción, resumen de triage y datos demo.

## Pendiente por decidir

1. **Ficha de datos (ajustada al Excel, corregida 2026-09-22):** se quitaron los campos que el Excel no pide: No. de expediente y fecha de registro (el número sigue en el encabezado), género, estado civil, migración, afrodescendiente, indígena, lengua indígena, clasificación, empleado de/referido por, ocupación, escolaridad y las casillas de **aviso de privacidad** y **consentimiento informado**. Los 9 campos que se habían capturado antes (nivel socioeconómico, vivienda, tipo sanguíneo, discapacidad, religión) NO correspondían a esta hoja del Excel y se reemplazaron por los 12 correctos de `FichaIdentificacion`: CURP, nombre, apellido paterno, apellido materno, fecha de nacimiento, entidad de nacimiento, sexo, nacionalidad, folio, entidad de residencia, municipio de residencia, localidad de residencia. Decisiones a confirmar: `grupoEtnico` se incluyó en la ficha (el Excel lo lista aparte, en la historia clínica); `municipioResidencia`/`localidadResidencia` se capturan como código INEGI directo (texto) porque no hay catálogo oficial cascada entidad→municipio→localidad cargado todavía; y sigue pendiente si `fechaNacimiento`/`sexo` de la ficha deben unificarse con los campos `fechaNacimiento`/`sexoBiologico` que ya existían en el paciente (modal "Registrar nuevo paciente") — hoy son dos datos independientes.
2. Discrepancias del Excel (se respetó el Excel): `signosVitales` es objeto en 6.1/7.1 pero texto en 6.2; en 6.2.6 hay dos campos casi iguales; `consumoSustancias` con sección 6.1.2 en la hoja 6.1.1; `pronostico` mide 1000/500/500; nombres de campo distintos en "Objetos"; catálogos (`sexo`, `nacionalidad`, `grupoEtnico`) solo dicen `Catálogo`/`INT` sin definir valores → **provisionales** en `data/catalogs.js` (`entidad` sí usa el código oficial INEGI).
3. Interconsulta 6.3: la NOM dice que la escribe el médico consultado (psicología); aquí se captura desde la consulta del médico general.
4. ¿Cuándo regresa el **triage**? El BPMN lo incluye (ver "Flujo").
5. Conectar `api.js` al gateway (JWT real), Google Calendar para la agenda y catálogos oficiales.
6. Docker/`docker-compose.yml` (puerto reservado **5514**; no se tocó el compose).
7. **Blockchain**: los datos clínicos en cadena son legibles por cualquiera; lo habitual es guardar hash/referencia en cadena y los datos fuera.
