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

La reserva requerida se calcula así:

```text
reserva requerida = proxima cuota * porcentaje de reserva / 100
```

`porcentajeReserva` debe ser como minimo `100`. En cada evaluacion:

| Condicion | Resultado | Efecto |
| --- | --- | --- |
| La obligacion esta bloqueada | `RevisionManualRequerida` | No autoriza pago; requiere resolver la excepcion. |
| Hay cuota y los recursos cubren la reserva | `PagoAutorizado` | Autoriza el menor valor entre cuota y deuda. |
| Hay cuota, pero la reserva no se cubre | `PagoParcialAutorizado` | Autoriza el menor valor entre recursos disponibles y deuda. |
| No hay recursos o no hay cuota pendiente | `PagoNoAutorizado` | No crea una autorizacion. |

Una autorizacion no mueve fondos. Tiene que seguir este ciclo:

1. El backend registra un recaudo conciliado con una referencia unica.
2. El administrador ejecuta `evaluarYAutorizarPago`.
3. El backend ejecuta el pago fuera de la cadena.
4. El administrador confirma el pago con `confirmarPagoEjecutado`.
5. Si la ejecucion externa falla, puede cancelar la autorizacion.

Los recursos que superan la reserva y el pago autorizado se marcan como
excedente. El backend realiza el giro externo y confirma el resultado con una
referencia unica mediante `confirmarGiroExcedente`. Si queda una reserva
remanente cuando ya no existe cuota, una nueva evaluacion puede liberarla como
excedente.

## Ciclo de vida de una obligacion

1. La factory despliega una obligacion y define su administrador.
2. El administrador llama a `crearObligacion` una sola vez.
3. El backend actualiza deuda y cuota con `actualizarSaldoYCuota`.
4. Se registran recaudos conciliados con `registrarRecaudo`.
5. Se evalua y, cuando corresponde, se confirma o cancela el pago.
6. Se registran evidencias y se puede activar un bloqueo para revision manual.
7. Cuando la deuda llega a cero, se registra el paz y salvo.
8. Se gestionan todos los recursos y excedentes.
9. Se llama a `cerrarObligacion`.

Para cerrar, el contrato exige deuda cero, paz y salvo registrado, ausencia de
bloqueo, ninguna autorizacion pendiente y cero recursos o excedentes por
gestionar.

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

La cuenta conectada debe ser la misma que se entregó como `administrador` al
desplegar la obligacion demo. La interfaz espera ese `chainId` y muestra un
error si la wallet esta conectada a otra red.

## Pruebas

Ejecuta la suite de Hardhat con:

```bash
npm test
```

Las pruebas cubren la factory, permisos, creacion unica, autorizacion total y
parcial, ausencia de recursos, revision manual, confirmacion y cancelacion de
pagos, excedentes, evidencia, idempotencia y cierre de principio a fin.

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
