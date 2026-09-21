// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FuentePagoDemo
 * @notice MVP de una Fuente de Pago Inteligente (Patrimonio Autonomo Digital).
 *
 * Principio arquitectonico (ver "Fuente de Pago Inteligente.docx"):
 * El backend recopila, concilia, integra y ejecuta.
 * El smart contract registra hechos verificables, evalua condiciones
 * objetivas, autoriza pagos y conserva la trazabilidad.
 *
 * IMPORTANTE:
 * - No recibe ni custodia dinero (no es payable).
 * - No ejecuta transferencias reales.
 * - El backend confirma posteriormente la ejecucion real en el Core.
 */
contract FuentePagoDemo {

    // =========================================================
    // ADMINISTRACION
    // =========================================================

    address public administrador;

    error NoAutorizado();
    error ObligacionYaExiste();
    error ObligacionInexistente();
    error ObligacionCerradaError();
    error ObligacionBloqueadaError();
    error ValorInvalido();
    error ReservaInvalida();
    error CuotaSuperaDeuda();
    error PagoAutorizadoPendiente();
    error RecaudoDuplicado();
    error PagoDuplicado();
    error SinAutorizacionVigente();
    error RecursosInsuficientes();
    error SaldoPendienteExiste();
    error PazYSalvoFaltante();
    error RecursosPorGestionar();
    error SinExcedenteDisponible();
    error GiroExcedenteDuplicado();
    error EvidenciaDuplicada();
    error DireccionInvalida();

    modifier soloAdministrador() {
        if (msg.sender != administrador) revert NoAutorizado();
        _;
    }

    // =========================================================
    // ESTADO DE LA OBLIGACION
    // =========================================================

    string public identificador;

    uint256 public deudaPendiente;
    uint256 public proximaCuota;

    // Por ejemplo: 120 representa una reserva del 120 %
    uint256 public porcentajeReserva;

    // Recursos conciliados y registrados por el backend
    uint256 public recursosDisponibles;

    // Valor aprobado por el contrato, todavia no confirmado como ejecutado
    uint256 public pagoAutorizado;

    // Excedente detectado y pendiente de giro por el backend
    uint256 public excedentePendienteGiro;

    // Informacion historica acumulada
    uint256 public totalRecaudado;
    uint256 public totalPagado;
    uint256 public totalExcedentesGirados;

    bool public obligacionCreada;
    bool public obligacionBloqueada;
    bool public pazYSalvoRegistrado;
    bool public obligacionCerrada;

    // Evita registrar dos veces el mismo recaudo
    mapping(bytes32 => bool) public recaudosRegistrados;

    // Evita confirmar dos veces el mismo pago
    mapping(bytes32 => bool) public pagosRegistrados;

    // Evita confirmar dos veces el mismo giro de excedente
    mapping(bytes32 => bool) public girosExcedenteRegistrados;

    // Evita registrar dos veces la misma evidencia
    mapping(bytes32 => bool) public evidenciasRegistradas;

    // =========================================================
    // RESULTADOS DE EVALUACION (seccion 4.2 del documento funcional)
    // =========================================================

    enum ResultadoEvaluacion {
        PagoAutorizado,
        PagoParcialAutorizado,
        PagoNoAutorizado,
        RevisionManualRequerida
    }

    // =========================================================
    // EVENTOS
    // =========================================================

    event ObligacionCreada(
        string identificador,
        uint256 deudaInicial,
        uint256 porcentajeReserva
    );

    event SaldoYCuotaActualizados(
        uint256 deudaPendiente,
        uint256 proximaCuota
    );

    event RecaudoRegistrado(
        bytes32 referencia,
        uint256 valor
    );

    event PagoAutorizadoEvento(
        uint256 valor,
        bool pagoParcial,
        bool reservaCumplida
    );

    event PagoNoAutorizado(
        string motivo
    );

    event RevisionManualRequerida(
        string motivo
    );

    event PagoEjecutado(
        bytes32 referencia,
        uint256 valor,
        uint256 nuevaDeudaPendiente
    );

    event AutorizacionCancelada(
        uint256 valor
    );

    event ExcedenteDisponible(
        uint256 valor
    );

    event ExcedenteGirado(
        bytes32 referencia,
        uint256 valor
    );

    event EvidenciaRegistrada(
        bytes32 hash,
        string tipo
    );

    event BloqueoActualizado(
        bool bloqueada,
        string motivo
    );

    event PazYSalvoRegistrado();

    event ObligacionCerrada(
        string identificador
    );

    // =========================================================
    // CONSTRUCTOR
    // =========================================================

    /**
     * @param _administrador Cuenta autorizada para operar la obligacion
     * (tipicamente el backend/servicio de integracion). Permite que una
     * factory despliegue el contrato y delegue la administracion.
     */
    constructor(address _administrador) {
        if (_administrador == address(0)) revert DireccionInvalida();
        administrador = _administrador;
    }

    // =========================================================
    // 1. CREAR OBLIGACION
    // =========================================================

    function crearObligacion(
        string calldata _identificador,
        uint256 _deudaInicial,
        uint256 _porcentajeReserva
    )
        external
        soloAdministrador
    {
        if (obligacionCreada) revert ObligacionYaExiste();
        if (_deudaInicial == 0) revert ValorInvalido();
        if (_porcentajeReserva < 100) revert ReservaInvalida();

        identificador = _identificador;
        deudaPendiente = _deudaInicial;
        porcentajeReserva = _porcentajeReserva;

        obligacionCreada = true;

        emit ObligacionCreada(
            _identificador,
            _deudaInicial,
            _porcentajeReserva
        );
    }

    // =========================================================
    // 2. ACTUALIZAR SALDO Y PROXIMA CUOTA
    // =========================================================

    /**
     * Esta informacion vendria del Core o AS400, conciliada por el backend.
     */
    function actualizarSaldoYCuota(
        uint256 _deudaPendiente,
        uint256 _proximaCuota
    )
        external
        soloAdministrador
    {
        validarObligacionActiva();

        if (pagoAutorizado != 0) revert PagoAutorizadoPendiente();
        // _proximaCuota puede ser 0: indica que no hay cuota pendiente
        // (por ejemplo, deuda ya cubierta o entre ciclos de facturacion).
        if (_proximaCuota > _deudaPendiente) revert CuotaSuperaDeuda();

        deudaPendiente = _deudaPendiente;
        proximaCuota = _proximaCuota;

        emit SaldoYCuotaActualizados(
            _deudaPendiente,
            _proximaCuota
        );
    }

    // =========================================================
    // 3. REGISTRAR RECAUDO CONCILIADO
    // =========================================================

    /**
     * El dinero no entra al contrato. El backend informa que un recaudo
     * ya fue identificado y conciliado en los sistemas tradicionales.
     */
    function registrarRecaudo(
        string calldata _referencia,
        uint256 _valor
    )
        external
        soloAdministrador
    {
        validarObligacionActiva();

        if (_valor == 0) revert ValorInvalido();

        bytes32 referenciaHash = keccak256(bytes(_referencia));

        if (recaudosRegistrados[referenciaHash]) revert RecaudoDuplicado();

        recaudosRegistrados[referenciaHash] = true;

        recursosDisponibles += _valor;
        totalRecaudado += _valor;

        emit RecaudoRegistrado(
            referenciaHash,
            _valor
        );
    }

    // =========================================================
    // 4. CALCULAR RESERVA
    // =========================================================

    function calcularReservaRequerida()
        public
        view
        returns (uint256)
    {
        if (proximaCuota == 0) {
            return 0;
        }

        return (proximaCuota * porcentajeReserva) / 100;
    }

    // =========================================================
    // 5. EVALUAR Y AUTORIZAR PAGO
    // =========================================================

    /**
     * Regla demostrativa:
     * 1. Obligacion bloqueada -> RevisionManualRequerida (no autoriza).
     * 2. Recursos cubren la reserva requerida -> pago total.
     * 3. Recursos no cubren la reserva pero existen -> pago parcial.
     * 4. No existen recursos -> PagoNoAutorizado.
     *
     * La autorizacion no mueve dinero.
     */
    function evaluarYAutorizarPago()
        external
        soloAdministrador
        returns (
            ResultadoEvaluacion resultado,
            uint256 valorAutorizado
        )
    {
        validarObligacionActiva();

        if (pagoAutorizado != 0) revert PagoAutorizadoPendiente();

        if (obligacionBloqueada) {
            emit RevisionManualRequerida("La obligacion esta bloqueada");
            return (ResultadoEvaluacion.RevisionManualRequerida, 0);
        }

        uint256 reservaRequerida = calcularReservaRequerida();

        // No hay cuota pendiente por autorizar (deuda ya cubierta o sin
        // cuota vigente). Se liberan como excedente los recursos que ya
        // no estan comprometidos con ninguna reserva.
        if (proximaCuota == 0 || deudaPendiente == 0) {
            _detectarExcedente(reservaRequerida);
            emit PagoNoAutorizado("No hay cuota pendiente por autorizar");
            return (ResultadoEvaluacion.PagoNoAutorizado, 0);
        }

        // Caso 1: cumple la reserva -> pago total
        if (recursosDisponibles >= reservaRequerida) {
            valorAutorizado = minimo(proximaCuota, deudaPendiente);
            pagoAutorizado = valorAutorizado;

            emit PagoAutorizadoEvento(valorAutorizado, false, true);

            _detectarExcedente(reservaRequerida);

            return (ResultadoEvaluacion.PagoAutorizado, valorAutorizado);
        }

        // Caso 2: pago parcial con lo disponible (reserva insuficiente)
        if (recursosDisponibles > 0) {
            valorAutorizado = minimo(recursosDisponibles, deudaPendiente);
            pagoAutorizado = valorAutorizado;

            emit PagoAutorizadoEvento(valorAutorizado, true, false);

            return (ResultadoEvaluacion.PagoParcialAutorizado, valorAutorizado);
        }

        // Caso 3: no hay recursos
        emit PagoNoAutorizado("No existen recursos disponibles");

        return (ResultadoEvaluacion.PagoNoAutorizado, 0);
    }

    // =========================================================
    // 6. CONFIRMAR PAGO EJECUTADO
    // =========================================================

    /**
     * Simula la confirmacion enviada por el backend
     * despues de ejecutar el pago en el Core.
     */
    function confirmarPagoEjecutado(
        string calldata _referenciaPago
    )
        external
        soloAdministrador
    {
        validarObligacionActiva();

        if (pagoAutorizado == 0) revert SinAutorizacionVigente();

        bytes32 referenciaHash = keccak256(bytes(_referenciaPago));

        if (pagosRegistrados[referenciaHash]) revert PagoDuplicado();
        if (recursosDisponibles < pagoAutorizado) revert RecursosInsuficientes();

        pagosRegistrados[referenciaHash] = true;

        uint256 valorEjecutado = pagoAutorizado;

        recursosDisponibles -= valorEjecutado;
        deudaPendiente -= valorEjecutado;
        totalPagado += valorEjecutado;

        pagoAutorizado = 0;

        emit PagoEjecutado(
            referenciaHash,
            valorEjecutado,
            deudaPendiente
        );
    }

    // =========================================================
    // 7. CANCELAR AUTORIZACION
    // =========================================================

    /**
     * Se usa si el backend no pudo ejecutar el pago.
     */
    function cancelarAutorizacion()
        external
        soloAdministrador
    {
        validarObligacionActiva();

        if (pagoAutorizado == 0) revert SinAutorizacionVigente();

        uint256 valorCancelado = pagoAutorizado;
        pagoAutorizado = 0;

        emit AutorizacionCancelada(valorCancelado);
    }

    // =========================================================
    // 8. EXCEDENTES (seccion 3.7 y 4.2 del documento funcional)
    // =========================================================

    /**
     * @notice Recursos disponibles despues de cubrir reserva y pago
     * autorizado vigente. Solo informativo, no reserva fondos.
     */
    function calcularExcedente()
        public
        view
        returns (uint256)
    {
        uint256 reservaRequerida = calcularReservaRequerida();
        uint256 comprometido = reservaRequerida + pagoAutorizado;

        if (recursosDisponibles <= comprometido) {
            return 0;
        }

        return recursosDisponibles - comprometido;
    }

    function _detectarExcedente(uint256 _reservaRequerida) private {
        // Si ya hay un excedente pendiente de giro, no se recalcula ni se
        // sobrescribe: primero debe confirmarse su giro.
        if (excedentePendienteGiro != 0) {
            return;
        }

        uint256 comprometido = _reservaRequerida + pagoAutorizado;

        if (recursosDisponibles > comprometido) {
            uint256 excedente = recursosDisponibles - comprometido;
            excedentePendienteGiro = excedente;
            emit ExcedenteDisponible(excedente);
        }
    }

    /**
     * Confirma que el backend giro el excedente detectado hacia el
     * beneficiario correspondiente en el sistema de pagos.
     */
    function confirmarGiroExcedente(
        string calldata _referenciaGiro
    )
        external
        soloAdministrador
    {
        validarObligacionActiva();

        if (excedentePendienteGiro == 0) revert SinExcedenteDisponible();

        bytes32 referenciaHash = keccak256(bytes(_referenciaGiro));

        if (girosExcedenteRegistrados[referenciaHash]) revert GiroExcedenteDuplicado();
        if (recursosDisponibles < excedentePendienteGiro) revert RecursosInsuficientes();

        girosExcedenteRegistrados[referenciaHash] = true;

        uint256 valorGirado = excedentePendienteGiro;

        recursosDisponibles -= valorGirado;
        totalExcedentesGirados += valorGirado;
        excedentePendienteGiro = 0;

        emit ExcedenteGirado(referenciaHash, valorGirado);
    }

    // =========================================================
    // 9. REGISTRO DE EVIDENCIA
    // =========================================================

    /**
     * Registra el hash de un documento (contrato, comprobante, paz y
     * salvo, etc.). El documento completo permanece fuera de blockchain.
     */
    function registrarEvidencia(
        bytes32 _hash,
        string calldata _tipo
    )
        external
        soloAdministrador
    {
        validarObligacionActiva();

        if (evidenciasRegistradas[_hash]) revert EvidenciaDuplicada();

        evidenciasRegistradas[_hash] = true;

        emit EvidenciaRegistrada(_hash, _tipo);
    }

    // =========================================================
    // 10. BLOQUEO OPERATIVO
    // =========================================================

    /**
     * Representa una excepcion o revision manual.
     */
    function actualizarBloqueo(
        bool _bloqueada,
        string calldata _motivo
    )
        external
        soloAdministrador
    {
        validarObligacionActiva();

        if (pagoAutorizado != 0) revert PagoAutorizadoPendiente();

        obligacionBloqueada = _bloqueada;

        emit BloqueoActualizado(_bloqueada, _motivo);
    }

    // =========================================================
    // 11. PAZ Y SALVO Y CIERRE
    // =========================================================

    function registrarPazYSalvo()
        external
        soloAdministrador
    {
        validarObligacionActiva();

        if (deudaPendiente != 0) revert SaldoPendienteExiste();
        if (pagoAutorizado != 0) revert PagoAutorizadoPendiente();
        if (obligacionBloqueada) revert ObligacionBloqueadaError();

        pazYSalvoRegistrado = true;

        emit PazYSalvoRegistrado();
    }

    function cerrarObligacion()
        external
        soloAdministrador
    {
        validarObligacionActiva();

        if (deudaPendiente != 0) revert SaldoPendienteExiste();
        if (!pazYSalvoRegistrado) revert PazYSalvoFaltante();
        if (recursosDisponibles != 0) revert RecursosPorGestionar();
        if (excedentePendienteGiro != 0) revert RecursosPorGestionar();

        obligacionCerrada = true;

        emit ObligacionCerrada(identificador);
    }

    // =========================================================
    // 12. CONSULTA GENERAL
    // =========================================================

    function consultarEstado()
        external
        view
        returns (
            string memory id,
            uint256 deuda,
            uint256 cuota,
            uint256 recursos,
            uint256 reservaRequerida,
            uint256 autorizado,
            uint256 excedente,
            uint256 recaudadoHistorico,
            uint256 pagadoHistorico,
            bool bloqueada,
            bool cerrada
        )
    {
        return (
            identificador,
            deudaPendiente,
            proximaCuota,
            recursosDisponibles,
            calcularReservaRequerida(),
            pagoAutorizado,
            excedentePendienteGiro,
            totalRecaudado,
            totalPagado,
            obligacionBloqueada,
            obligacionCerrada
        );
    }

    // =========================================================
    // FUNCIONES INTERNAS
    // =========================================================

    function validarObligacionActiva() internal view {
        if (!obligacionCreada) revert ObligacionInexistente();
        if (obligacionCerrada) revert ObligacionCerradaError();
    }

    function minimo(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
