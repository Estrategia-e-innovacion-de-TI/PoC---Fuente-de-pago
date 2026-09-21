// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./FuentePagoDemo.sol";

/**
 * @title FuentePagoFactory
 * @notice Orquesta la creacion de obligaciones (P3 del proceso TO-BE),
 * una vez el backend/fiducia completo las validaciones previas
 * (constitucion del PAD, configuracion de reglas, aceptacion, etc.).
 */
contract FuentePagoFactory {

    error NoAutorizado();
    error IdentificadorDuplicado();
    error DireccionInvalida();

    address public owner;

    address[] public obligaciones;
    mapping(string => address) public obligacionPorIdentificador;

    event ObligacionDesplegada(
        string identificador,
        address contratoObligacion,
        address administrador
    );

    modifier soloOwner() {
        if (msg.sender != owner) revert NoAutorizado();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Despliega una nueva FuentePagoDemo y la deja lista para
     * que `_administrador` (backend/servicio de integracion) la opere.
     */
    function crearFuentePago(
        string calldata _identificador,
        address _administrador
    )
        external
        soloOwner
        returns (address nuevaObligacion)
    {
        if (_administrador == address(0)) revert DireccionInvalida();
        if (obligacionPorIdentificador[_identificador] != address(0)) {
            revert IdentificadorDuplicado();
        }

        FuentePagoDemo obligacion = new FuentePagoDemo(_administrador);
        nuevaObligacion = address(obligacion);

        obligaciones.push(nuevaObligacion);
        obligacionPorIdentificador[_identificador] = nuevaObligacion;

        emit ObligacionDesplegada(_identificador, nuevaObligacion, _administrador);
    }

    function totalObligaciones() external view returns (uint256) {
        return obligaciones.length;
    }
}
