# Microservicio EHR: expediente clínico en base de datos convencional

## 1. Objetivo

Guardar en **MySQL** (no en blockchain), **pasando por el API Gateway**, todos los datos del Excel Norm04
(NOM-004-SSA3-2012) que necesita el camino "resuelto en enfermería":

1. **Registrar al paciente** y su **Ficha de identificación**.
2. Sus **Antecedentes** (hoja 6.1.1).
3. **Notas SOAP** de enfermería: la unión de los campos de las hojas 6.1.x, 6.2 y 7.1.

Las hojas 6.3 y 6.4 (interconsulta y referencia) quedan fuera por ahora: son del camino del médico.
Todo se puede probar con Postman sin el frontend.

## 2. Arquitectura

Copia la estructura de **`birthCertificate/birthCertificateApp`** (esqueleto de `express-generator`:
`bin/www`, `app.js`, `routes/` → `controller/`, `startApp`), pero en lugar de `web3` + Ganache usa
`mysql2` + MySQL. El `db.js` sigue el de `frontendBirthCertificateApp/db.js`.

```
Navegador ──► Frontend ECE ──► API Gateway ──► Microservicio EHR ──► MySQL
              (:5514)          (:5500)         (:5505)               (:3307)
              Express+axios    express-gateway Express+mysql2        contenedor Docker
```

Por ahora está **aislado** del resto del proyecto: corre en el host (no en `docker-compose.yml`) y su MySQL es un
contenedor temporal (`tokphy-mysql-ehr`, puerto 3307). La integración con los demás contenedores se hará después.

## 3. Archivos

| Archivo | Qué hace |
|---|---|
| `bin/www` | Crea las tablas (`ensureSchema`) y luego levanta el servidor en el puerto 5505 |
| `app.js` | Monta `/fichaIdentificacion`, `/antecedentes` y `/notaSoap`; errores en JSON |
| `db.js` | Pool `mysql2` con los datos del `.env` |
| `schema.js` | `CREATE TABLE` de las 3 tablas; detecta la tabla de la versión anterior |
| `controller/validation.js` | Validadores por tipo del Excel (texto, decimal, entero, booleano, fecha, hora) y respuesta de error |
| `controller/fichaIdentificacionController.js` | Registro de paciente + ficha (upsert por CURP) |
| `controller/antecedentesController.js` | Antecedentes (upsert por CURP) |
| `controller/notaSoapFields.js` | Lista de los 44 campos clínicos de la nota SOAP: de aquí salen tabla, validación y respuesta |
| `controller/notaSoapController.js` | Notas SOAP (solo agregar y consultar) |
| `routes/*.js` | Una ruta por recurso, `POST /` y `GET /` |
| `routes/pacientes.js` | `GET /pacientes?q=` (búsqueda; el handler está en `fichaIdentificacionController.js`) |
| `apigateway/apigatewayApp/config/gateway.config.yml` | `apiEndpoints` `ehr*` + `ehrPipeline` → `http://localhost:5505` |

## 4. Endpoints (a través del Gateway, `http://localhost:5500`)

| Método | Ruta | Qué hace | Respuesta |
|---|---|---|---|
| POST | `/fichaIdentificacion` | Registra al paciente o reemplaza su ficha | `200 {Result, ficha}` |
| GET | `/fichaIdentificacion?curp=MALK050614HJCTPN09` | Consulta la ficha | `200` / `404` |
| POST | `/antecedentes` | Crea o reemplaza los antecedentes | `200 {Result, antecedentes}` |
| GET | `/antecedentes?curp=MALK050614HJCTPN09` | Consulta los antecedentes | `200` / `404` |
| POST | `/notaSoap` | Agrega una nota al expediente | `201 {Result, nota}` |
| GET | `/notaSoap?curp=MALK050614HJCTPN09` | Lista las notas, la más reciente primero | `200 {Result, notas}` |
| GET | `/pacientes?q=gomez` | Busca pacientes por nombre y apellidos, CURP o folio (sin `q`: todos; máx. 100). No distingue mayúsculas ni acentos | `200 {Result, pacientes}` |

Errores: `400` = datos inválidos, `404` = la CURP no está registrada, `500` = falla del servidor. Siempre
`{"Result": "Error", "Description": "..."}`. No hay `PUT` ni `DELETE` de notas: una nota clínica no se altera.

## 5. Datos

### Llave del paciente: CURP

La **CURP** (Excel: Identificador CHAR(18)) identifica al paciente en las tres tablas y en las consultas (`?curp=`).
El campo `folio` del Excel (Identificador VARCHAR(18)) es el **ID institucional** (p. ej. `0263328`): opcional, pero
no se puede repetir entre pacientes. Se guarda como texto para no perder los ceros a la izquierda.

### Tablas

```
ficha_identificacion (curp PK) ──┬── antecedentes (curp PK/FK)      una fila por paciente
                                 └── nota_soap (id PK, curp FK)     muchas notas por paciente
```

| Tabla | Columnas |
|---|---|
| `ficha_identificacion` | `curp`, `folio` (UNIQUE), nombre y apellidos, `fecha_nacimiento` CHAR(8), entidad de nacimiento, `sexo`, `nacionalidad`, entidad/municipio/localidad de residencia, `grupo_etnico`, `creado_en`, `actualizado_en` |
| `antecedentes` | 3 textos (heredo-familiares, personales patológicos y no patológicos) + `uso_tabaco`, `uso_alcohol`, `uso_otras_sustancias` |
| `nota_soap` | `id`, `curp`, `fecha_servicio`, `hora_servicio` + 44 columnas clínicas + `creado_en` (49 en total) |

**Catálogos de la ficha:** el frontend manda el `id` del `<select>` y se guarda el código del Excel (entidad `14` →
`"14"`, sexo `1`/`2` → `"H"`/`"M"`, nacionalidad `1`/`2` → `"MEX"`/`"OTR"`). Al consultar se convierte de vuelta
al `id`, así la ficha regresa con la misma forma con la que se mandó. `grupoEtnico` (Catálogo INT) se guarda tal cual.

### Nota SOAP: campos del Excel por panel

Los JSON usan los nombres del Excel; los objetos del Excel van anidados (`signosVitales.temperatura`).

| Panel (Figma) | Campos | Hoja |
|---|---|---|
| Subjetivo | `motivoAtencion`, `padecimientoActual`, `evolucionCuadroClinico`, `interrogatorioAparatosSistemas`, `resumenInterrogatorio`, `tratamientoPrevio.{tratamientoPrevioConvencional, …Alternativo, …Tradicional}` | 7.1, 6.1.1, 6.2 |
| Signos vitales | `signosVitales.{temperatura, tensionArterial, frecuenciaCardiaca, frecuenciaRespiratoria}`, `peso`, `talla` | 6.1.2, 7.1 |
| Historiales | `antecedentesHeredoFamiliares`, `antecedentesPersonalesPatologicos`, `antecedentesPersonalesNoPatologicos`, `consumoSustancias.{usoTabaco, usoAlcohol, usoOtrasSustancias}` | 6.1.1, 6.2 |
| Exploración física | `habitusExterior`, `datosExploracionFisica.{cabeza, cuello, torax, abdomen, miembros, genitales}`, `resumenExploracionFisica`, `estadoMental` | 6.1.2, 7.1 |
| Análisis diagnóstico | `diagnosticosProblemasClinicos`, `pronostico` | 6.1.4, 6.1.5, 6.2, 7.1 |
| Tratamiento | `indicacionTerapeutica`, `tratamientoIndicacionesMedicas`, `tratamientoIndicaciones.{dosis, viaAdministracion, periodicidad}`, `tratamiento` | 6.1.6, 6.2.6, 7.1 |
| Laboratorio | `resultadosPreviosEstudios.{laboratorio, gabinete, otros}`, `resultadosActualesEstudios.{…}`, `resultadosEstudiosAuxiliares` | 6.1.3, 6.2, 7.1 |
| (automático) | `fechaServicio` (aaaa-mm-dd), `horaServicio` (hh:mm): si no vienen, fecha y hora del servidor | 7.1.1 |

Al juntar hojas: si un campo tiene tamaños distintos se usa el mayor (`pronostico`: 1000); `signosVitales` es el
objeto (en 6.2 el Excel lo define como texto VARCHAR(500)). Los paneles "Alergias" y "PLAN" no tienen campos: el
primero no está en el Excel y el segundo solo tendría campos de 6.3/6.4.

## 6. Validaciones

- **CURP**: obligatoria, 18 caracteres con el patrón oficial RENAPO.
- **Ficha**: nombre y apellido paterno obligatorios; folio opcional (hasta 18 letras, dígitos o guiones) y no repetido
  en otro paciente; fecha de
  nacimiento real y no futura; catálogos existentes; municipio/localidad solo dígitos.
- **Nota SOAP**: **ningún campo es obligatorio** (la enfermera captura solo lo crucial), pero lo que viene se valida
  con el tipo y tamaño del Excel (tensión arterial `120/80`; booleanos `true`/`false`; texto con su máximo) y, en los
  números, con un **rango clínico propuesto** (no viene del Excel):

  | Campo | Rango |
  |---|---|
  | Temperatura | 30 – 45 °C |
  | Frecuencia cardiaca | 20 – 250 lpm |
  | Frecuencia respiratoria | 4 – 80 rpm |
  | Peso | 0.5 – 400 kg |
  | Talla | 0.30 – 2.50 m |

  La nota no puede ir totalmente vacía y la CURP debe estar registrada.
- **Antecedentes**: mismos tipos; la CURP debe estar registrada.

Un campo vacío se guarda como `NULL` ("sin dato"), que no es lo mismo que `false`.

## 7. Cómo levantarlo (en este orden)

```bash
# 1. Docker Desktop abierto, luego el MySQL temporal
cd electronicHealthRecord
docker compose up -d

# 2. Microservicio EHR (crea las tablas al arrancar)
cd electronicHealthRecordApp
npm install        # solo la primera vez
node bin/www

# 3. API Gateway
cd apigateway/apigatewayApp
node server.js
```

`.env` del microservicio (ignorado por git):

```
DB_HOST=localhost
DB_PORT=3307
DB_USER=tokuser
DB_PASSWORD=user_pw123
DB_NAME=tokphydb
PORT=5505
```

**Si vienes de la versión intermedia** (llave = folio), el servicio no arranca y te pide renombrar esas tablas
(conservan sus datos):

```bash
docker exec tokphy-mysql-ehr mysql -utokuser -puser_pw123 tokphydb -e "RENAME TABLE ficha_identificacion TO ficha_identificacion_v2, antecedentes TO antecedentes_v2, nota_soap TO nota_soap_v2;"
```

## 8. Pruebas en Postman (Body → raw → JSON)

**1. Registrar paciente** — `POST http://localhost:5500/fichaIdentificacion`

```json
{
  "curp": "MALK050614HJCTPN09",
  "folio": "0263328",
  "nombre": "Kenzo",
  "apellidoP": "Matoo",
  "apellidoM": "López",
  "fechaNacimiento": "2005-06-14",
  "entidadNacimiento": 14,
  "sexo": 1,
  "nacionalidad": 1,
  "entidadResidencia": 14,
  "municipioResidencia": "039",
  "localidadResidencia": "0001",
  "grupoEtnico": 0
}
```

**2. Antecedentes** — `POST http://localhost:5500/antecedentes`

```json
{
  "curp": "MALK050614HJCTPN09",
  "antecedentesHeredoFamiliares": "Madre con diabetes tipo 2",
  "antecedentesPersonalesPatologicos": "Asma en la infancia",
  "antecedentesPersonalesNoPatologicos": "Ejercicio 3 veces por semana",
  "consumoSustancias": { "usoTabaco": false, "usoAlcohol": true }
}
```

**3. Nota SOAP** — `POST http://localhost:5500/notaSoap`

```json
{
  "curp": "MALK050614HJCTPN09",
  "motivoAtencion": "Dolor de cabeza",
  "padecimientoActual": "Cefalea frontal de 2 días",
  "tratamientoPrevio": { "tratamientoPrevioConvencional": "Paracetamol 500 mg" },
  "signosVitales": { "temperatura": 36.5, "tensionArterial": "120/80", "frecuenciaCardiaca": 72, "frecuenciaRespiratoria": 16 },
  "peso": 70.5,
  "talla": 1.75,
  "consumoSustancias": { "usoTabaco": false, "usoAlcohol": true, "usoOtrasSustancias": false },
  "habitusExterior": "Consciente, orientado",
  "datosExploracionFisica": { "cabeza": "Normocéfalo", "torax": "Sin alteraciones" },
  "diagnosticosProblemasClinicos": "Cefalea tensional",
  "pronostico": "Bueno",
  "tratamientoIndicaciones": { "dosis": "500 mg", "viaAdministracion": "Oral", "periodicidad": "Cada 8 h" },
  "resultadosPreviosEstudios": { "laboratorio": "BH normal 2025" }
}
```

**4. Consultas** — `GET http://localhost:5500/fichaIdentificacion?curp=MALK050614HJCTPN09`, `…/antecedentes?curp=MALK050614HJCTPN09`,
`…/notaSoap?curp=MALK050614HJCTPN09`

**Errores para mostrar la validación:** nota con una CURP válida no registrada, p. ej. `"XEXX010101HNEXXXA4"` (404),
nota solo con la CURP (400), `"temperatura": 365` (400), `"tensionArterial": "alta"` (400), ficha sin CURP (400),
ficha con el folio de otro paciente (400), `?curp=ABC` (400).

La colección `EHR.postman_collection.json` (en esta carpeta) trae todas estas peticiones con sus pruebas:
**Import** en Postman y **Run collection**.

Ver las filas directamente:

```bash
docker exec tokphy-mysql-ehr mysql -utokuser -puser_pw123 tokphydb -e "SELECT * FROM ficha_identificacion; SELECT * FROM antecedentes; SELECT * FROM nota_soap\G"
```

## 9. Decisiones de diseño y por qué

| Decisión | Motivo |
|---|---|
| Microservicio detrás del Gateway | Sigue la estructura de los demás servicios; el Gateway es el punto donde después irá la autenticación |
| Llave `curp` | Identifica a la persona en todo el país y está en el Excel; el folio (ID institucional) queda como dato único opcional |
| Registro = upsert de la ficha | Registrar y editar la ficha guardan los mismos campos; no hace falta una tabla aparte |
| Revisar el folio antes del upsert | `ON DUPLICATE KEY UPDATE` también se dispara con el folio (UNIQUE) y sobrescribiría a otro paciente |
| Nota SOAP = unión de campos del Excel | Un solo formulario para enfermería que no inventa campos |
| Una columna por campo (no un JSON) | Tipos y tamaños del Excel en la base, consultas por campo y mapeo directo a contratos después |
| Campos declarados en una lista (`notaSoapFields.js`) | 44 campos: tabla, validación y respuesta salen de una sola fuente y no se desincronizan |
| Textos de más de 255 caracteres como `TEXT` | MySQL limita una fila a 65,535 bytes; en utf8mb4 tantos VARCHAR(500/1000) no caben. El tamaño del Excel lo impone la validación |
| Notas solo-agregar | Lo exige el expediente clínico y lo dará la blockchain |
| Tablas creadas al arrancar | Si MySQL falla, se sabe antes de la primera petición |
| `dateStrings` y `timezone: 'Z'` en el pool | Evitan que fechas y horas se corran por la zona horaria |
| 400 vs 500 | Distingue un dato mal capturado de una falla del servidor |

## 10. Pendientes

- Frontend: conectar registro, ficha (también leerla), antecedentes y la pantalla SOAP a estos endpoints.
- `sexo`, `nacionalidad` y `grupoEtnico` usan catálogos **provisionales**; municipio y localidad sin catálogo INEGI.
- Hojas 6.3 y 6.4 (camino del médico).
- Integración: meter el servicio y su MySQL al `docker-compose.yml`; `ehrFichaIdentificacionB` apunta a
  `172.18.1.8` (debería ser la IP del Gateway, como `ehrAntecedentesB`/`ehrNotaSoapB`).
- Sin autenticación en los endpoints (el Gateway tiene `key-auth` disponible pero desactivado).
- Sin autor de la nota: el Excel no lo incluye.
