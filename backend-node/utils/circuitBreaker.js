// backend-node > utils > JS circuitBreaker.js

// ---------------------------------------------------------------------------
// Circuit Breaker - Mecanismo de protecao contra falhas em cascata
// ---------------------------------------------------------------------------
//
// Implementacao simples com tres estados: CLOSED, OPEN e HALF_OPEN.
//
// CLOSED (Fechado):
//   Chamadas passam normalmente. Falhas consecutivas sao contadas.
//   Ao atingir failureThreshold, o circuito abre.
//
// OPEN (Aberto):
//   Chamadas sao bloqueadas e retornam fallbackValue imediatamente,
//   sem executar a funcao. Permanece aberto ate que timeoutMs tenha
//   decorrido desde a abertura. Entao transita para HALF_OPEN.
//
// HALF_OPEN (Semiaberto):
//   Permite chamadas de teste. Sao necessarias successThreshold
//   respostas bem-sucedidas consecutivas para fechar o circuito.
//   Qualquer falha reabre o circuito imediatamente.

// ---------------------------------------------------------------------------
// Constantes de estado
// ---------------------------------------------------------------------------

const STATE = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

// ---------------------------------------------------------------------------
// Factory do Circuit Breaker
// ---------------------------------------------------------------------------

export function createCircuitBreaker({
  name,
  failureThreshold = 3,
  successThreshold = 1,
  timeoutMs = 30_000,
} = {}) {
  if (!name) throw new Error('createCircuitBreaker: "name" is required');

  // ---------------------------------------------------------------------------
  // Variaveis internas de controle
  // ---------------------------------------------------------------------------

  let state = STATE.CLOSED;
  let failureCount = 0;
  let successCount = 0;
  let openedAt = null;

  // ---------------------------------------------------------------------------
  // Transicoes de estado
  // ---------------------------------------------------------------------------

  function toClosed() {
    state = STATE.CLOSED;
    failureCount = 0;
    successCount = 0;
    openedAt = null;
    console.log(`CircuitBreaker[${name}] -> CLOSED`);
  }

  function toOpen() {
    state = STATE.OPEN;
    openedAt = Date.now();
    failureCount = 0;
    successCount = 0;
    console.warn(`CircuitBreaker[${name}] -> OPEN (cooldown ${timeoutMs}ms)`);
  }

  function toHalfOpen() {
    state = STATE.HALF_OPEN;
    successCount = 0;
    failureCount = 0;
    console.log(`CircuitBreaker[${name}] -> HALF_OPEN`);
  }

  // ---------------------------------------------------------------------------
  // Verificacao de permissao de chamada
  // ---------------------------------------------------------------------------

  function canAttempt() {
    if (state === STATE.CLOSED) return true;

    if (state === STATE.OPEN) {
      // Se o tempo de cooldown ja expirou, transita para HALF_OPEN e permite
      if (Date.now() - openedAt >= timeoutMs) {
        toHalfOpen();
        return true;
      }
      return false;
    }

    // HALF_OPEN: sempre permite tentativa de teste
    return true;
  }

  // ---------------------------------------------------------------------------
  // Registro de resultado bem-sucedido
  // ---------------------------------------------------------------------------

  function onSuccess() {
    if (state === STATE.HALF_OPEN) {
      successCount++;
      if (successCount >= successThreshold) toClosed();
    } else if (state === STATE.CLOSED) {
      // Reinicia contagem de falhas apos um sucesso no estado fechado
      failureCount = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Registro de falha
  // ---------------------------------------------------------------------------

  function onFailure() {
    if (state === STATE.HALF_OPEN) {
      // Qualquer falha no estado semiaberto reabre o circuito
      toOpen();
      return;
    }

    failureCount++;
    if (failureCount >= failureThreshold) toOpen();
  }

  // ---------------------------------------------------------------------------
  // Funcao principal de execucao protegida
  // ---------------------------------------------------------------------------

  /**
   * Executa fn() respeitando o estado atual do circuito.
   *
   * Comportamento por estado:
   * - OPEN e cooldown nao expirado: retorna fallbackValue sem chamar fn().
   * - fn() rejeita ou lanca excecao: registra a falha (possivelmente
   *   abrindo o circuito) e retorna fallbackValue.
   * - fn() resolve com sucesso: registra o sucesso e retorna o resultado.
   *
   * @param {Function} fn - Funcao assincrona a ser executada.
   * @param {*} fallbackValue - Valor retornado quando o circuito esta aberto
   *   ou quando fn() falha. Padrao: null.
   * @returns {Promise<*>} Resultado de fn() ou fallbackValue.
   */
  async function exec(fn, fallbackValue = null) {
    if (!canAttempt()) {
      console.warn(`CircuitBreaker[${name}] OPEN — call blocked, returning fallback.`);
      return fallbackValue;
    }

    try {
      const result = await fn();
      onSuccess();
      return result;
    } catch (err) {
      onFailure();
      console.error(
        `CircuitBreaker[${name}] failure recorded (${failureCount}/${failureThreshold}):`,
        err.message
      );
      return fallbackValue;
    }
  }

  // ---------------------------------------------------------------------------
  // Consulta do estado atual (util para monitoramento)
  // ---------------------------------------------------------------------------

  function getState() {
    return state;
  }

  // ---------------------------------------------------------------------------
  // Interface publica
  // ---------------------------------------------------------------------------

  return { exec, getState };
}