let provider;
let signer;
let contrato;
let cuenta;

const mensajeEl = document.getElementById("mensaje-global");
const registroEl = document.getElementById("registro-eventos");

function mostrarMensaje(texto, tipo) {
  mensajeEl.textContent = texto;
  mensajeEl.className = tipo || "";
}

function agregarEvento(texto) {
  const li = document.createElement("li");
  const hora = new Date().toLocaleTimeString();
  li.textContent = `[${hora}] ${texto}`;
  registroEl.prepend(li);
}

function extraerMensajeError(error) {
  if (error && error.reason) return error.reason;
  if (error && error.shortMessage) return error.shortMessage;
  if (error && error.info && error.info.error && error.info.error.message) {
    return error.info.error.message;
  }
  return error && error.message ? error.message : "Error desconocido";
}

// Lee un campo de texto obligatorio (no numerico) y valida que no este vacio.
function campoTexto(id, etiqueta) {
  const valor = document.getElementById(id).value.trim();
  if (valor === "") {
    throw new Error(`El campo "${etiqueta}" es obligatorio.`);
  }
  return valor;
}

// Lee un campo numerico obligatorio y valida que sea un entero valido antes
// de enviarlo a ethers.js (evita "invalid BigNumberish string: empty string").
function campoNumerico(id, etiqueta, { permitirCero = true } = {}) {
  const valor = document.getElementById(id).value.trim();
  if (valor === "" || !/^\d+$/.test(valor)) {
    throw new Error(`El campo "${etiqueta}" debe ser un numero entero valido.`);
  }
  if (!permitirCero && BigInt(valor) === 0n) {
    throw new Error(`El campo "${etiqueta}" debe ser mayor que cero.`);
  }
  return valor;
}

async function cargarAbi(nombreArchivo) {
  const respuesta = await fetch(`abi/${nombreArchivo}`);
  if (!respuesta.ok) {
    throw new Error(`No se pudo cargar el ABI: ${nombreArchivo}`);
  }
  return respuesta.json();
}

async function conectarWallet() {
  if (!window.ethereum) {
    mostrarMensaje("No se detecto una wallet (MetaMask). Instalala para continuar.", "error");
    return;
  }

  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    cuenta = await signer.getAddress();

    const red = await provider.getNetwork();
    if (Number(red.chainId) !== window.APP_CONFIG.CHAIN_ID_ESPERADO) {
      mostrarMensaje(
        `Red inesperada (chainId ${red.chainId}). Se esperaba ${window.APP_CONFIG.CHAIN_ID_ESPERADO}.`,
        "error"
      );
    }

    const abi = await cargarAbi("FuentePagoDemo.json");
    contrato = new ethers.Contract(window.APP_CONFIG.OBLIGACION_ADDRESS, abi, signer);

    document.getElementById("cuenta-conectada").textContent =
      cuenta.slice(0, 6) + "..." + cuenta.slice(-4);
    document.getElementById("btn-conectar").textContent = "Conectado";
    document.getElementById("btn-conectar").disabled = true;

    escucharEventos();
    await refrescarEstado();
    mostrarMensaje("Wallet conectada correctamente.", "ok");
  } catch (error) {
    mostrarMensaje(extraerMensajeError(error), "error");
  }
}

function formatear(valor) {
  try {
    return valor.toString();
  } catch {
    return String(valor);
  }
}

async function refrescarEstado() {
  if (!contrato) {
    mostrarMensaje("Conecta tu wallet primero.", "error");
    return;
  }
  try {
    const estado = await contrato.consultarEstado();
    document.getElementById("v-id").textContent = estado.id || "(sin crear)";
    document.getElementById("v-deuda").textContent = formatear(estado.deuda);
    document.getElementById("v-cuota").textContent = formatear(estado.cuota);
    document.getElementById("v-recursos").textContent = formatear(estado.recursos);
    document.getElementById("v-reserva").textContent = formatear(estado.reservaRequerida);
    document.getElementById("v-autorizado").textContent = formatear(estado.autorizado);
    document.getElementById("v-excedente").textContent = formatear(estado.excedente);
    document.getElementById("v-recaudado").textContent = formatear(estado.recaudadoHistorico);
    document.getElementById("v-pagado").textContent = formatear(estado.pagadoHistorico);
    document.getElementById("v-bloqueada").innerHTML = estado.bloqueada
      ? '<span class="badge si">SI</span>'
      : '<span class="badge no">NO</span>';
    document.getElementById("v-cerrada").innerHTML = estado.cerrada
      ? '<span class="badge si">SI</span>'
      : '<span class="badge no">NO</span>';
  } catch (error) {
    mostrarMensaje(extraerMensajeError(error), "error");
  }
}

const RESULTADOS_EVALUACION = [
  "PagoAutorizado",
  "PagoParcialAutorizado",
  "PagoNoAutorizado",
  "RevisionManualRequerida",
];

async function ejecutarAccion(accion) {
  if (!contrato) {
    mostrarMensaje("Conecta tu wallet primero.", "error");
    return;
  }

  try {
    let tx;
    switch (accion) {
      case "crearObligacion": {
        const id = campoTexto("co-id", "Identificador");
        const deuda = campoNumerico("co-deuda", "Deuda inicial", { permitirCero: false });
        const reserva = campoNumerico("co-reserva", "% Reserva", { permitirCero: false });
        tx = await contrato.crearObligacion(id, deuda, reserva);
        break;
      }
      case "actualizarSaldoYCuota": {
        const deuda = campoNumerico("asc-deuda", "Deuda pendiente");
        const cuota = campoNumerico("asc-cuota", "Proxima cuota");
        tx = await contrato.actualizarSaldoYCuota(deuda, cuota);
        break;
      }
      case "registrarRecaudo": {
        const ref = campoTexto("rr-ref", "Referencia");
        const valor = campoNumerico("rr-valor", "Valor", { permitirCero: false });
        tx = await contrato.registrarRecaudo(ref, valor);
        break;
      }
      case "evaluarYAutorizarPago": {
        const resultado = await contrato.evaluarYAutorizarPago.staticCall();
        const nombreResultado = RESULTADOS_EVALUACION[Number(resultado[0])];
        tx = await contrato.evaluarYAutorizarPago();
        await tx.wait();
        agregarEvento(`Resultado evaluacion: ${nombreResultado} · valor autorizado: ${formatear(resultado[1])}`);
        await refrescarEstado();
        mostrarMensaje(`Evaluacion completada: ${nombreResultado}`, "ok");
        return;
      }
      case "confirmarPagoEjecutado": {
        const ref = campoTexto("cpe-ref", "Referencia de pago");
        tx = await contrato.confirmarPagoEjecutado(ref);
        break;
      }
      case "cancelarAutorizacion": {
        tx = await contrato.cancelarAutorizacion();
        break;
      }
      case "confirmarGiroExcedente": {
        const ref = campoTexto("cge-ref", "Referencia de giro");
        tx = await contrato.confirmarGiroExcedente(ref);
        break;
      }
      case "registrarEvidencia": {
        const texto = campoTexto("re-texto", "Texto o identificador del documento");
        const tipo = campoTexto("re-tipo", "Tipo");
        const hash = ethers.keccak256(ethers.toUtf8Bytes(texto));
        tx = await contrato.registrarEvidencia(hash, tipo);
        break;
      }
      case "bloquear": {
        const motivo = campoTexto("ab-motivo", "Motivo");
        tx = await contrato.actualizarBloqueo(true, motivo);
        break;
      }
      case "desbloquear": {
        const motivo = campoTexto("ab-motivo", "Motivo");
        tx = await contrato.actualizarBloqueo(false, motivo);
        break;
      }
      case "registrarPazYSalvo": {
        tx = await contrato.registrarPazYSalvo();
        break;
      }
      case "cerrarObligacion": {
        tx = await contrato.cerrarObligacion();
        break;
      }
      default:
        return;
    }

    mostrarMensaje("Transaccion enviada, esperando confirmacion...", "ok");
    await tx.wait();
    mostrarMensaje("Transaccion confirmada.", "ok");
    await refrescarEstado();
  } catch (error) {
    mostrarMensaje(extraerMensajeError(error), "error");
  }
}

function escucharEventos() {
  const eventos = [
    "ObligacionCreada",
    "SaldoYCuotaActualizados",
    "RecaudoRegistrado",
    "PagoAutorizadoEvento",
    "PagoNoAutorizado",
    "RevisionManualRequerida",
    "PagoEjecutado",
    "AutorizacionCancelada",
    "ExcedenteDisponible",
    "ExcedenteGirado",
    "EvidenciaRegistrada",
    "BloqueoActualizado",
    "PazYSalvoRegistrado",
    "ObligacionCerrada",
  ];

  eventos.forEach((nombre) => {
    contrato.on(nombre, (...args) => {
      const datos = args.slice(0, -1).map(formatear).join(", ");
      agregarEvento(`${nombre}(${datos})`);
    });
  });
}

document.getElementById("btn-conectar").addEventListener("click", conectarWallet);
document.getElementById("btn-refrescar").addEventListener("click", refrescarEstado);

document.querySelectorAll("[data-accion]").forEach((boton) => {
  boton.addEventListener("click", () => ejecutarAccion(boton.dataset.accion));
});
