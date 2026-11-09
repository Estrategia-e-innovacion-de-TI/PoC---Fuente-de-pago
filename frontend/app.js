let provider;
let providerLectura;
let signer;
let contrato;
let contratoLectura;
let cuenta;
let cuentaEsAdministrador = false;
let versionConexion = 0;
let versionSeleccion = 0;
let abiObligacion;
let factory;
let factoryLectura;
let cuentaEsOwner = false;
let obligacionCreada = false;
let seleccionando = false;
let transaccionEnCurso = false;
let cargandoListado = false;
let versionListado = 0;
const obligaciones = new Map();

function actualizarControles() {
  const ocupado = seleccionando || transaccionEnCurso || cargandoListado;
  document.querySelectorAll("[data-accion]").forEach((boton) => {
    boton.disabled = ocupado || !cuentaEsAdministrador ||
      (boton.dataset.accion === "crearObligacion" ? obligacionCreada : !obligacionCreada);
  });
  document.getElementById("btn-desplegar").disabled = ocupado || !factory || !cuentaEsOwner;
  document.getElementById("obligacion-select").disabled = ocupado || obligaciones.size === 0;
  document.getElementById("btn-listar").disabled = ocupado || !factoryLectura;
  document.getElementById("btn-refrescar").disabled = ocupado || !contratoLectura;
  document.getElementById("btn-conectar").disabled = ocupado;
}

async function cargarObligaciones(preferida = document.getElementById("obligacion-select").value) {
  const actual = factoryLectura;
  const version = ++versionListado;
  cargandoListado = true;
  actualizarControles();
  try {
    const eventos = await actual.queryFilter("ObligacionDesplegada", 0, "latest");
    if (actual !== factoryLectura || version !== versionListado) return;
    obligaciones.clear();
    const selector = document.getElementById("obligacion-select");
    selector.replaceChildren();
    eventos.forEach((evento) => {
      const direccion = evento.args.contratoObligacion;
      const identificador = evento.args.identificador;
      obligaciones.set(direccion.toLowerCase(), { direccion, identificador });
      const opcion = document.createElement("option");
      opcion.value = direccion;
      opcion.textContent = `${identificador} (${direccion.slice(0, 6)}...${direccion.slice(-4)})`;
      selector.append(opcion);
    });
    const elegida = obligaciones.get((preferida || "").toLowerCase()) || obligaciones.values().next().value;
    if (elegida) {
      selector.value = elegida.direccion;
      await seleccionarObligacion(elegida.direccion);
    } else {
      mostrarMensaje("La factory aun no tiene obligaciones.", "ok");
    }
  } finally {
    if (version === versionListado) {
      cargandoListado = false;
      actualizarControles();
    }
  }
}

async function desplegarObligacion() {
  if (transaccionEnCurso || seleccionando || cargandoListado) return;
  if (!factory || !cuentaEsOwner) {
    mostrarMensaje("Solo el propietario de la factory puede desplegar obligaciones.", "error");
    return;
  }
  const actual = factory;
  const lecturaActual = factoryLectura;
  const conexion = versionConexion;
  try {
    const id = campoTexto("nueva-id", "Identificador de la nueva obligacion");
    const administrador = campoTexto("nueva-admin", "Administrador");
    if (!ethers.isAddress(administrador) || administrador === ethers.ZeroAddress) {
      throw new Error("El administrador debe ser una direccion Ethereum valida y distinta de cero.");
    }
    transaccionEnCurso = true;
    actualizarControles();
    await lecturaActual.crearFuentePago.staticCall(id, administrador, { from: cuenta, blockTag: "latest" });
    if (conexion !== versionConexion) return;
    mostrarMensaje("Confirma el despliegue en MetaMask.", "ok");
    const tx = await actual.crearFuentePago(id, administrador);
    if (conexion !== versionConexion) return;
    mostrarMensaje("Despliegue enviado, esperando confirmacion...", "ok");
    const recibo = await tx.wait();
    if (conexion !== versionConexion) return;
    const evento = recibo.logs.map((log) => {
      try { return actual.interface.parseLog(log); } catch { return null; }
    }).find((log) => log && log.name === "ObligacionDesplegada");
    if (!evento) throw new Error("No se encontro el evento del despliegue. Actualiza el listado antes de volver a intentar.");
    await cargarObligaciones(evento.args.contratoObligacion);
    if (conexion !== versionConexion) return;
    document.getElementById("nueva-id").value = "";
    mostrarMensaje(cuentaEsAdministrador
      ? "Nueva obligacion desplegada y seleccionada. Pendiente de inicializar deuda y reserva."
      : "Nueva obligacion desplegada y seleccionada. Su administrador debe inicializarla.", "ok");
  } catch (error) {
    if (conexion === versionConexion) mostrarMensaje(extraerMensajeError(error), "error");
  } finally {
    if (conexion === versionConexion) {
      transaccionEnCurso = false;
      actualizarControles();
    }
  }
}

async function seleccionarObligacion(direccion) {
  const version = ++versionSeleccion;
  const conexion = versionConexion;
  const contratoAnterior = contratoLectura;
  contrato = undefined;
  contratoLectura = undefined;
  cuentaEsAdministrador = false;
  obligacionCreada = false;
  seleccionando = true;
  actualizarControles();
  document.querySelectorAll("#tarjetas-estado .valor").forEach((valor) => {
    valor.textContent = "-";
  });
  registroEl.replaceChildren();
  document.getElementById("direccion-obligacion").textContent = "-";
  document.getElementById("estado-inicializacion").textContent = "-";
  document.querySelectorAll(".grid-acciones input").forEach((input) => { input.value = ""; });
  try {
    if (contratoAnterior) await contratoAnterior.removeAllListeners();
    if (version !== versionSeleccion || conexion !== versionConexion) return;
    const nuevoContrato = new ethers.Contract(direccion, abiObligacion, signer);
    const nuevoContratoLectura = nuevoContrato.connect(providerLectura);
    const administrador = await nuevoContratoLectura.administrador({ blockTag: "latest" });
    if (version !== versionSeleccion || conexion !== versionConexion) return;
    contrato = nuevoContrato;
    contratoLectura = nuevoContratoLectura;
    cuentaEsAdministrador = cuenta.toLowerCase() === administrador.toLowerCase();
    const registrada = obligaciones.get(direccion.toLowerCase());
    document.getElementById("co-id").value = registrada ? registrada.identificador : "";
    document.getElementById("direccion-obligacion").textContent = direccion;
    escucharEventos();
    await refrescarEstado();
  } finally {
    if (version === versionSeleccion) {
      seleccionando = false;
      actualizarControles();
    }
  }
}

const mensajeEl = document.getElementById("mensaje-global");
const registroEl = document.getElementById("registro-eventos");

async function limpiarConexion() {
  const version = ++versionConexion;
  ++versionSeleccion;
  ++versionListado;
  const contratoAnterior = contratoLectura;
  const providerAnterior = provider;
  const providerLecturaAnterior = providerLectura;
  contrato = undefined;
  contratoLectura = undefined;
  provider = undefined;
  providerLectura = undefined;
  signer = undefined;
  cuenta = undefined;
  cuentaEsAdministrador = false;
  cuentaEsOwner = false;
  obligacionCreada = false;
  seleccionando = false;
  transaccionEnCurso = false;
  cargandoListado = false;
  factory = undefined;
  factoryLectura = undefined;
  obligaciones.clear();
  document.getElementById("obligacion-select").replaceChildren();
  document.getElementById("direccion-obligacion").textContent = "-";
  document.getElementById("estado-inicializacion").textContent = "-";
  document.getElementById("nueva-admin").value = "";
  actualizarControles();
  document.getElementById("cuenta-conectada").textContent = "No conectado";
  document.getElementById("btn-conectar").textContent = "Conectar wallet";
  document.getElementById("btn-conectar").disabled = false;
  document.querySelectorAll("[data-accion]").forEach((boton) => {
    boton.disabled = true;
  });
  document.querySelectorAll("#tarjetas-estado .valor").forEach((valor) => {
    valor.textContent = "-";
  });
  registroEl.replaceChildren();
  try {
    if (contratoAnterior) await contratoAnterior.removeAllListeners();
  } finally {
    if (providerAnterior) providerAnterior.destroy();
    if (providerLecturaAnterior) providerLecturaAnterior.destroy();
  }
  return version;
}

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
  const pendientes = [error?.info?.error, error?.error, error];
  const visitados = new Set();
  const mensajes = [];
  const codigos = [];
  while (pendientes.length && visitados.size < 30) {
    const origen = pendientes.shift();
    if (!origen || visitados.has(origen)) continue;
    visitados.add(origen);
    if (typeof origen === "string") {
      try {
        pendientes.push(JSON.parse(origen));
      } catch {
        mensajes.push(origen);
      }
      continue;
    }
    if (typeof origen !== "object") continue;
    if (typeof origen.message === "string") mensajes.push(origen.message);
    if (origen.code !== undefined) codigos.push(origen.code);
    pendientes.push(origen.error, origen.data, origen.originalError, origen.cause);
  }
  const detalle = mensajes.find((mensaje) =>
    typeof mensaje === "string" && mensaje.trim() &&
    !/could not coalesce error|internal json-rpc error/i.test(mensaje)
  );
  const codigoRpc = codigos.find((codigo) => typeof codigo === "number");
  const mensajeBase = detalle || error?.shortMessage || error?.message || "Error desconocido";
  const codigo = codigoRpc === undefined || mensajeBase.includes(`codigo RPC: ${codigoRpc}`)
    ? "" : ` (codigo RPC: ${codigoRpc})`;
  const mensaje = mensajeBase + codigo;
  const metodo = error?.payload?.method || error?.info?.payload?.method;
  return metodo ? `${mensaje} (metodo RPC: ${metodo})` : mensaje;
}

function transporteWallet(ethereum) {
  return {
    async request(payload) {
      try {
        return await ethereum.request(payload);
      } catch (error) {
        const errorRpc = new Error(extraerMensajeError(error));
        errorRpc.code = error?.code;
        errorRpc.data = error?.data;
        throw errorRpc;
      }
    },
  };
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

  let version;
  try {
    version = await limpiarConexion();
    if (version !== versionConexion) return;
    const nuevoProvider = new ethers.BrowserProvider(transporteWallet(window.ethereum), undefined, { cacheTimeout: -1 });
    provider = nuevoProvider;
    await nuevoProvider.send("eth_requestAccounts", []);
    const red = await nuevoProvider.getNetwork();
    if (version !== versionConexion) return;
    if (Number(red.chainId) !== window.APP_CONFIG.CHAIN_ID_ESPERADO) {
      mostrarMensaje(
        `Red inesperada (chainId ${red.chainId}). Se esperaba ${window.APP_CONFIG.CHAIN_ID_ESPERADO}.`,
        "error"
      );
      return;
    }

    const nuevoSigner = await nuevoProvider.getSigner();
    const nuevaCuenta = await nuevoSigner.getAddress();
    const nuevoProviderLectura = new ethers.JsonRpcProvider(window.APP_CONFIG.RPC_URL, undefined, {
      cacheTimeout: -1,
      batchMaxCount: 1,
    });
    if (version !== versionConexion) {
      nuevoProviderLectura.destroy();
      return;
    }
    providerLectura = nuevoProviderLectura;
    const redLectura = await nuevoProviderLectura.getNetwork();
    if (version !== versionConexion) return;
    if (redLectura.chainId !== red.chainId) {
      throw new Error("El RPC de lectura y MetaMask deben estar conectados a la misma red.");
    }
    const abi = await cargarAbi("FuentePagoDemo.json");
    const abiFactory = await cargarAbi("FuentePagoFactory.json");
    const codigo = await nuevoProviderLectura.getCode(window.APP_CONFIG.FACTORY_ADDRESS, "latest");
    if (version !== versionConexion) return;
    if (codigo === "0x") {
      throw new Error("No hay contrato en la direccion configurada. Si reiniciaste Hardhat, ejecuta npm run deploy:localhost y verifica frontend/config.js.");
    }
    signer = nuevoSigner;
    cuenta = nuevaCuenta;
    abiObligacion = abi;
    factory = new ethers.Contract(window.APP_CONFIG.FACTORY_ADDRESS, abiFactory, signer);
    factoryLectura = factory.connect(providerLectura);
    const owner = await factoryLectura.owner({ blockTag: "latest" });
    if (version !== versionConexion) return;
    cuentaEsOwner = cuenta.toLowerCase() === owner.toLowerCase();
    document.getElementById("nueva-admin").value = cuenta;
    await cargarObligaciones(window.APP_CONFIG.OBLIGACION_ADDRESS);
    if (version !== versionConexion) return;

    document.getElementById("cuenta-conectada").textContent =
      cuenta.slice(0, 6) + "..." + cuenta.slice(-4);
    document.getElementById("btn-conectar").textContent = cuentaEsAdministrador
      ? "Conectado"
      : "Cambiar cuenta";
    actualizarControles();

    if (!contratoLectura) {
      mostrarMensaje("Wallet conectada. La factory aun no tiene obligaciones.", "ok");
    } else if (cuentaEsAdministrador) {
      mostrarMensaje("Wallet administradora conectada correctamente.", "ok");
    } else {
      mostrarMensaje(
        `La cuenta ${cuenta} no es la administradora de esta obligacion.`,
        "error"
      );
    }
  } catch (error) {
    if (version !== undefined && version !== versionConexion) return;
    await limpiarConexion();
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
  const contratoActual = contratoLectura;
  try {
    const [estado, creada] = await Promise.all([
      contratoActual.consultarEstado({ blockTag: "latest" }),
      contratoActual.obligacionCreada({ blockTag: "latest" }),
    ]);
    if (contratoActual !== contratoLectura) return;
    obligacionCreada = creada;
    document.getElementById("estado-inicializacion").textContent = creada ? "Inicializada" : "Pendiente de inicializar";
    actualizarControles();
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
    if (contratoActual !== contratoLectura) return;
    await limpiarConexion();
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
  if (transaccionEnCurso || seleccionando || cargandoListado) return;
  if (!contrato) {
    mostrarMensaje("Conecta tu wallet primero.", "error");
    return;
  }
  if (!cuentaEsAdministrador) {
    mostrarMensaje("Conecta la cuenta administradora para enviar transacciones.", "error");
    return;
  }
  if (accion === "crearObligacion" ? obligacionCreada : !obligacionCreada) {
    mostrarMensaje(obligacionCreada
      ? "Esta obligacion ya esta inicializada. Despliega una nueva desde la factory."
      : "Inicializa la obligacion antes de registrar operaciones.", "error");
    return;
  }

  const conexion = versionConexion;
  transaccionEnCurso = true;
  actualizarControles();
  try {
    let tx;
    switch (accion) {
      case "crearObligacion": {
        const id = campoTexto("co-id", "Identificador");
        const deuda = campoNumerico("co-deuda", "Deuda inicial", { permitirCero: false });
        const reserva = campoNumerico("co-reserva", "% Reserva", { permitirCero: false });
        await contratoLectura.crearObligacion.staticCall(id, deuda, reserva, {
          blockTag: "latest", from: cuenta,
        });
        if (conexion !== versionConexion) return;
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
        const resultado = await contratoLectura.evaluarYAutorizarPago.staticCall({ blockTag: "latest", from: cuenta });
        if (conexion !== versionConexion) return;
        const nombreResultado = RESULTADOS_EVALUACION[Number(resultado[0])];
        tx = await contrato.evaluarYAutorizarPago();
        await tx.wait();
        if (conexion !== versionConexion) return;
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

    if (conexion !== versionConexion) return;
    mostrarMensaje("Transaccion enviada, esperando confirmacion...", "ok");
    await tx.wait();
    if (conexion !== versionConexion) return;
    mostrarMensaje("Transaccion confirmada.", "ok");
    await refrescarEstado();
  } catch (error) {
    if (conexion !== versionConexion) return;
    console.error(`Error al ejecutar ${accion}:`, error);
    mostrarMensaje(extraerMensajeError(error), "error");
  } finally {
    if (conexion === versionConexion) {
      transaccionEnCurso = false;
      actualizarControles();
    }
  }
}

function escucharEventos() {
  const contratoActual = contratoLectura;
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
    "ExcedentePendienteAjustado",
    "ExcedenteGirado",
    "EvidenciaRegistrada",
    "BloqueoActualizado",
    "PazYSalvoRegistrado",
    "ObligacionCerrada",
  ];

  eventos.forEach((nombre) => {
    contratoActual.on(nombre, (...args) => {
      if (contratoActual !== contratoLectura) return;
      const datos = args.slice(0, -1).map(formatear).join(", ");
      agregarEvento(`${nombre}(${datos})`);
    });
  });
}

document.getElementById("btn-conectar").addEventListener("click", conectarWallet);
document.getElementById("btn-refrescar").addEventListener("click", refrescarEstado);
document.getElementById("btn-desplegar").addEventListener("click", desplegarObligacion);
document.getElementById("btn-listar").addEventListener("click", async () => {
  try {
    await cargarObligaciones();
  } catch (error) {
    mostrarMensaje(extraerMensajeError(error), "error");
  }
});
document.getElementById("obligacion-select").addEventListener("change", async (evento) => {
  try {
    await seleccionarObligacion(evento.target.value);
    mostrarMensaje(cuentaEsAdministrador ? "Obligacion seleccionada." : "Obligacion seleccionada en modo consulta.", "ok");
  } catch (error) {
    mostrarMensaje(extraerMensajeError(error), "error");
  }
});

document.querySelectorAll("[data-accion]").forEach((boton) => {
  boton.disabled = true;
  boton.addEventListener("click", () => ejecutarAccion(boton.dataset.accion));
});
actualizarControles();

if (window.ethereum) {
  ["accountsChanged", "chainChanged", "disconnect"].forEach((evento) => {
    window.ethereum.on(evento, async () => {
      try {
        await limpiarConexion();
        mostrarMensaje("La conexion de la wallet cambio. Vuelve a conectar para consultar el estado actual.", "error");
      } catch (error) {
        mostrarMensaje(extraerMensajeError(error), "error");
      }
    });
  });
}
