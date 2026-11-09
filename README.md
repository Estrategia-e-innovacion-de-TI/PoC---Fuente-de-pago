# Fuente de Pago Inteligente

MVP de una **Fuente de Pago Inteligente** o Patrimonio Autonomo Digital. El
proyecto muestra como registrar en blockchain los hechos verificables de una
obligacion, aplicar reglas objetivas de autorizacion y conservar trazabilidad
de las decisiones.

El proyecto implementa el proceso descrito en `Fuente de Pago Inteligente.docx`
(diagrama TO-BE), pero deliberadamente mantiene la ejecucion del dinero fuera
de la cadena:

- El backend o servicio de integracion consulta el Core/AS400, concilia los
   recaudos y envia los hechos al contrato.
- El contrato calcula la reserva, evalua si corresponde autorizar una cuota y
   registra la autorizacion.
- El backend ejecuta el pago real en el sistema tradicional y luego confirma
   el resultado en blockchain.
- Los documentos completos permanecen fuera de blockchain; el contrato solo
   registra sus hashes y tipo de evidencia.

> **Importante:** este es un MVP demostrativo. Los contratos no son `payable`,
> no custodian fondos, no transfieren tokens ni dinero y no reemplazan las
> validaciones legales, operativas o de seguridad necesarias para producción.

## Que incluye

### `FuentePagoFactory`

Factory administrada por su `owner`. Despliega contratos individuales
`FuentePagoDemo`, evita identificadores duplicados y mantiene el listado de
obligaciones creadas.

### `FuentePagoDemo`

Contrato de una obligacion. Solo la cuenta `administrador` puede operar sus
funciones de negocio. Registra:

- identificador, deuda pendiente y proxima cuota;
- recaudos conciliados y referencias idempotentes;
- reserva requerida, pago autorizado y excedentes pendientes;
- pagos ejecutados, giros de excedentes y totales historicos;
- evidencias, bloqueos operativos, paz y salvo y cierre.

### Frontend de demostracion

`frontend/` contiene una interfaz HTML/CSS/JavaScript sin bundler. Usa
`ethers.js` desde CDN y MetaMask para conectarse a la red local. Permite
consultar el estado, ejecutar las acciones del administrador y ver los eventos
emitidos por el contrato.

## Modelo de autorizacion

`porcentajeReserva` expresa la cobertura total de la cuota, no una reserva
adicional de ese mismo porcentaje. Una cobertura del 120 % significa una cuota
del 100 % mas un colchon del 20 %. La reserva adicional retenida se calcula asi:

```text
reserva adicional = min(cuota fija, deuda pendiente) * (porcentaje de reserva - 100) / 100
```

`porcentajeReserva` debe ser como minimo `100`. En cada evaluacion:

| Condicion | Resultado | Efecto |
| --- | --- | --- |
| La obligacion esta bloqueada | `RevisionManualRequerida` | No autoriza pago; requiere resolver la excepcion. |
| Hay cuota y los recursos cubren reserva mas cuota | `PagoAutorizado` | Autoriza el menor valor entre cuota y deuda, conservando la reserva. |
| Hay cuota y los recursos superan la reserva, pero no alcanzan para toda la cuota | `PagoParcialAutorizado` | Autoriza solo los recursos por encima de la reserva, hasta la cuota/deuda. |
| Los recursos no superan la reserva o no hay cuota pendiente | `PagoNoAutorizado` | No crea una autorizacion. |

Por ejemplo, con deuda 200, cuota 100, cobertura 120 % y recaudos por 240:
el primer pago de 100 deja 140, de los que 20 se conservan como reserva
adicional. Sin girar los excedentes entre pagos, el segundo pago tambien es de
100 y deja 40. Al quedar la deuda en cero, los 20 antes reservados se liberan y
los 40 completos pueden gestionarse como excedente. Una cobertura del 100 %
no exige reserva adicional. No se aplica una excepcion especial al ultimo pago:
es la misma regla de cuota mas colchon durante toda la obligacion.

Una autorizacion no mueve fondos. Tiene que seguir este ciclo:

1. El backend registra un recaudo conciliado con una referencia unica.
2. El administrador ejecuta `evaluarYAutorizarPago`.
3. El backend ejecuta el pago fuera de la cadena.
4. El administrador confirma el pago con `confirmarPagoEjecutado`.
5. Si la ejecucion externa falla, puede cancelar la autorizacion.

La demo usa cuotas fijas, configuradas inicialmente mediante
`actualizarSaldoYCuota`. Despues de confirmar un pago, el contrato descuenta la
deuda y deja lista la cuota siguiente automaticamente, sin otra transaccion de
sincronizacion. Un abono parcial reduce lo pendiente de la cuota actual; al
completarla se restablece la cuota fija, limitada a la deuda restante. Al terminar
la deuda, la proxima cuota y la reserva requerida quedan en cero. Los abonos
parciales no reducen la reserva de la cuota fija para financiar nuevos pagos.
`actualizarSaldoYCuota` sigue disponible para correcciones externas, cambios de
cuota o pausas (cuota cero). El contrato no modela fechas de vencimiento: cada
nueva evaluacion puede autorizar otra cuota si hay recursos suficientes.
Si el saldo vuelve a ser positivo despues de registrar el paz y salvo, este se
invalida y debe registrarse de nuevo al terminar la obligacion.

La reserva requerida se mantiene separada de los recursos destinados al pago:
la autorizacion solo consume recursos que excedan la reserva. Los recursos que
superan la reserva y el pago autorizado se marcan como excedente. El backend
realiza el giro externo y confirma el resultado con una
referencia unica mediante `confirmarGiroExcedente`. Si queda una reserva
remanente cuando la deuda llega a cero, una nueva evaluacion puede liberarla
como excedente. Si aun hay deuda pero temporalmente no hay cuota vigente, los
recursos permanecen retenidos hasta que se informe una cuota. Si una
actualizacion de cuota aumenta la reserva requerida, el
contrato reduce el excedente pendiente al valor que sigue siendo seguro y emite
`ExcedentePendienteAjustado`; el backend debe consultar el valor vigente antes
de ejecutar el giro.

## Ciclo de vida de una obligacion

1. La factory despliega una obligacion y define su administrador.
2. El administrador llama a `crearObligacion` una sola vez.
3. El administrador configura inicialmente deuda y cuota fija con `actualizarSaldoYCuota`.
4. Se registran recaudos conciliados con `registrarRecaudo`.
5. Se evalua y, cuando corresponde, se confirma o cancela el pago. Confirmar
   actualiza automaticamente el saldo y la cuota pendiente.
6. Se registran evidencias y se puede activar un bloqueo para revision manual.
7. Cuando la deuda llega a cero, se registra el paz y salvo.
8. Se gestionan todos los recursos y excedentes.
9. Se llama a `cerrarObligacion`.

Para cerrar, el contrato exige deuda cero, paz y salvo registrado, ausencia de
bloqueo y cero recursos o excedentes por gestionar. El pago pendiente tambien
impide el cierre al mantener deuda por pagar.

## Requisitos

- Node.js y npm.
- MetaMask para usar el frontend.
- Un navegador con acceso a `https://cdn.jsdelivr.net` para cargar ethers.js.

No se necesita una base de datos ni un servidor backend para ejecutar la demo:
el nodo Hardhat y el frontend estatico son suficientes.

## Instalacion y ejecucion local

Desde la raiz del repositorio:

```bash
npm install
```

En una primera terminal, inicia la blockchain local:

```bash
npm run node
```

Conserva las cuentas y claves privadas que imprime Hardhat. En una segunda
terminal, compila y despliega:

```bash
npx hardhat compile
npm run deploy:localhost
npm run copy-abi
npm run frontend
```

`deploy:localhost` despliega `FuentePagoFactory` y una obligacion demo con el
identificador `OBLIGACION-DEMO-001`. Al terminar imprime las direcciones de la
factory y de la obligacion. Copia esas direcciones en
`frontend/config.js` como `FACTORY_ADDRESS` y `OBLIGACION_ADDRESS` cada vez que
reinicies el nodo y vuelvas a desplegar. Los ABI que consume el frontend se
generan con `npm run copy-abi`.

Abre <http://localhost:5173> y configura MetaMask así:

- RPC: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Cuenta: importa una de las claves privadas impresas por `npm run node`

Para operar una obligacion, la cuenta conectada debe ser su `administrador`.
Otras cuentas pueden consultar su estado. Solo el `owner` de la factory puede
desplegar obligaciones nuevas; en la demo es la cuenta que ejecuto el despliegue.
La interfaz espera ese `chainId` y muestra un error si la wallet esta conectada
a otra red.

Las consultas y los eventos del frontend usan directamente `RPC_URL` de
`frontend/config.js` (`http://127.0.0.1:8545` por defecto), mientras MetaMask
autoriza y envia las transacciones. El RPC y la wallet deben apuntar a la misma
red. Esto evita que las lecturas del panel dependan de bloques antiguos
conservados por MetaMask despues de reiniciar Hardhat, aunque no elimina las
consultas internas que pueda emitir la extension. Reiniciar Hardhat borra el
estado local y requiere volver a desplegar los contratos.

## Gestionar varias obligaciones

El selector **Obligacion activa** muestra los contratos registrados por la
factory configurada. Cambiar de obligacion actualiza el estado, los permisos y
los eventos del panel y limpia los campos de la obligacion anterior.
**Actualizar listado** incorpora despliegues realizados desde otra sesion.

Para agregar otra obligacion sin reemplazar las existentes:

1. Conecta la cuenta propietaria de la factory y abre **Nueva obligacion**.
2. Ingresa un identificador unico y una direccion de administrador distinta de
   cero. Por defecto se usa la cuenta conectada.
3. Pulsa **Desplegar obligacion** y confirma la transaccion en MetaMask. El nuevo
   contrato se agrega al selector y queda seleccionado automaticamente.
4. Con su cuenta administradora, completa deuda inicial y porcentaje de reserva
   (cobertura total, minimo 100) en **Inicializar obligacion** y confirma una segunda transaccion.

Desplegar e inicializar son pasos separados. Si se rechaza la inicializacion,
el contrato desplegado permanece en el listado para reintentar; no hace falta
desplegarlo otra vez. Una obligacion inicializada no puede inicializarse de
nuevo. Las operaciones posteriores siempre se aplican al contrato seleccionado.

`OBLIGACION_ADDRESS` solo indica la seleccion inicial preferida al conectar.
No es necesario editarla para crear o cambiar obligaciones. No reinicies
Hardhat para agregar otra obligacion: el reinicio borra todas las anteriores.

### Activar una version nueva de los contratos

Los contratos desplegados son inmutables. Compilar o copiar el ABI no cambia
el comportamiento de una obligacion ni de una factory existente. La version
con cuotas automaticas y cobertura corregida requiere desplegar una factory nueva y crear las
obligaciones desde esa factory; la factory anterior sigue desplegando el
bytecode anterior. No reinicies Hardhat para desplegar una version nueva:
conservar el nodo mantiene los contratos y datos anteriores, aunque cambiar
`FACTORY_ADDRESS` cambia el listado que muestra el panel. Las obligaciones
anteriores no se migran automaticamente.

## Pruebas

Ejecuta la suite de Hardhat con:

```bash
npm test
```

Las pruebas cubren la factory, permisos, creacion unica, autorizacion total y
parcial, ausencia de recursos, revision manual, confirmacion y cancelacion de
pagos, excedentes, evidencia, idempotencia y cierre de principio a fin.
Tambien cubren cuotas fijas consecutivas, pagos parciales sin consumir la
reserva, ajuste de la ultima cuota y cierre sin sincronizaciones manuales.
Las pruebas del frontend cubren ademas el listado, seleccion, despliegue e
inicializacion de varias obligaciones, los permisos y la prevencion de envios
duplicados.

## Estructura del repositorio

```text
contracts/
   FuentePagoDemo.sol       Contrato de una obligacion
   FuentePagoFactory.sol    Factory y registro de obligaciones
frontend/
   index.html               Panel de demostracion
   app.js                   Conexion wallet, acciones y eventos
   config.js                Direcciones y chain ID local
   server.js                Servidor estatico sin dependencias
   abi/                     ABI usados por el frontend
scripts/
   deploy.js                Despliegue local de factory y obligacion demo
   copy-abi.js              Copia ABI desde artifacts hacia frontend/abi
test/
   FuentePagoDemo.js        Pruebas unitarias y de ciclo completo
hardhat.config.js          Configuracion de Solidity y red Hardhat
```

## Limitaciones y siguientes pasos para produccion

Este repositorio sirve para validar el flujo y las reglas del MVP. Antes de
usarlo con datos o dinero reales habría que, como minimo:

- reemplazar el administrador unico por un esquema de roles y multisig;
- integrar autenticacion, autorizacion y auditoria del backend;
- definir controles de idempotencia y conciliacion con el Core;
- proteger la configuracion de red y las direcciones desplegadas;
- auditar los contratos y definir una estrategia de upgrade o inmutabilidad;
- incorporar privacidad, retencion de evidencias y cumplimiento normativo;
- desplegar en una red autorizada y probar recuperacion ante errores.

## Paleta del frontend

`#FFD204` `#00C587` `#FF803A` `#FFB8D2` `#01CDEB` `#2C2A29`, con fondo
`#F7F7F7`.
