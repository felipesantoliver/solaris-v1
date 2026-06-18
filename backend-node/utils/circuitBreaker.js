// backend-node/utils/circuitBreaker.js
//
// Circuit breaker simples com estados CLOSED / OPEN / HALF_OPEN.
//
// CLOSED:    chamadas passam normalmente. Falhas consecutivas são contadas;
//            ao atingir failureThreshold, abre o circuito.
// OPEN:      chamadas são bloqueadas (retornam fallback) até timeoutMs
//            se passarem desde a abertura, quando transiciona para HALF_OPEN.
// HALF_OPEN: permite chamadas de teste. successThreshold sucessos seguidos
//            fecha o circuito; qualquer falha reabre imediatamente.

const STATE = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

export function createCircuitBreaker({
  name,
  failureThreshold = 3,
  successThreshold = 1,
  timeoutMs = 30_000,
} = {}) {
  if (!name) throw new Error('createCircuitBreaker: "name" é obrigatório');

  let state = STATE.CLOSED;
  let failureCount = 0;
  let successCount = 0;
  let openedAt = null;

  function toClosed() {
    state = STATE.CLOSED;
    failureCount = 0;
    successCount = 0;
    openedAt = null;
    console.log(`🔵 CircuitBreaker[${name}] -> CLOSED`);
  }

  function toOpen() {
    state = STATE.OPEN;
    openedAt = Date.now();
    failureCount = 0;
    successCount = 0;
    console.warn(`🔴 CircuitBreaker[${name}] -> OPEN (cooldown ${timeoutMs}ms)`);
  }

  function toHalfOpen() {
    state = STATE.HALF_OPEN;
    successCount = 0;
    failureCount = 0;
    console.log(`🟡 CircuitBreaker[${name}] -> HALF_OPEN`);
  }

  function canAttempt() {
    if (state === STATE.CLOSED) return true;
    if (state === STATE.OPEN) {
      if (Date.now() - openedAt >= timeoutMs) {
        toHalfOpen();
        return true;
      }
      return false;
    }
    // HALF_OPEN
    return true;
  }

  function onSuccess() {
    if (state === STATE.HALF_OPEN) {
      successCount++;
      if (successCount >= successThreshold) toClosed();
    } else if (state === STATE.CLOSED) {
      failureCount = 0;
    }
  }

  function onFailure() {
    if (state === STATE.HALF_OPEN) {
      toOpen();
      return;
    }
    failureCount++;
    if (failureCount >= failureThreshold) toOpen();
  }

  /**
   * Executa fn() respeitando o estado do circuito.
   * - Se o circuito estiver OPEN (e o cooldown ainda não expirou): retorna
   *   fallbackValue imediatamente, sem chamar fn().
   * - Se fn() lançar/rejeitar: registra a falha (podendo abrir o circuito) e
   *   retorna fallbackValue.
   * - Se fn() resolver: registra sucesso e retorna o resultado.
   */
  async function exec(fn, fallbackValue = null) {
    if (!canAttempt()) {
      console.warn(`⛔ CircuitBreaker[${name}] OPEN — chamada bloqueada, retornando fallback.`);
      return fallbackValue;
    }

    try {
      const result = await fn();
      onSuccess();
      return result;
    } catch (err) {
      onFailure();
      console.error(`❌ CircuitBreaker[${name}] falha registrada (${failureCount}/${failureThreshold}):`, err.message);
      return fallbackValue;
    }
  }

  function getState() {
    return state;
  }

  return { exec, getState };
}