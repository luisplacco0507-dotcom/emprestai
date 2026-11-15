// Camada de Infraestrutura — publicação de eventos no RabbitMQ com o padrão Outbox.
//
// 1. registrar() grava o evento na "caixa de saída" (outbox) no MESMO passo síncrono em que o
//    serviço altera os dados em memória: ou acontecem os dois, ou nenhum.
// 2. Um laço separado lê a outbox e publica no broker com publisher confirms; só remove o evento
//    depois que o broker confirma que o guardou.
// 3. Se o RabbitMQ estiver fora do ar, a API continua respondendo (201 etc.) e os eventos esperam
//    na outbox até a conexão voltar. Por isso os consumidores precisam ser idempotentes.
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';

export const EXCHANGE = 'emprestai.eventos';

export function criarPublicador({
  url = process.env.RABBITMQ_URL ?? 'amqp://localhost',
  intervaloMs = 500,
  log = console.log,
} = {}) {
  const outbox = []; // em produção: tabela "outbox" no PostgreSQL, gravada na mesma transação
  let conexao = null;
  let canal = null;
  let conectando = false;
  let avisouFalha = false;
  let timer = null;
  let publicando = false;
  let proximaTentativa = 0; // sem broker, tenta reconectar a cada 3 s (e não a cada volta do laço)

  async function conectar() {
    if (conectando || canal || Date.now() < proximaTentativa) return;
    conectando = true;
    proximaTentativa = Date.now() + 3000;
    try {
      conexao = await amqp.connect(url);
      conexao.on('error', () => {}); // o 'close' abaixo trata a queda
      conexao.on('close', () => {
        canal = null;
        conexao = null;
        log('[outbox] conexão com o RabbitMQ perdida; eventos ficam guardados até reconectar');
      });
      const novoCanal = await conexao.createConfirmChannel();
      await novoCanal.assertExchange(EXCHANGE, 'topic', { durable: true });
      canal = novoCanal;
      avisouFalha = false;
      log(`[outbox] conectado ao RabbitMQ (${url}), exchange "${EXCHANGE}"`);
    } catch (erro) {
      if (!avisouFalha) {
        log(`[outbox] RabbitMQ indisponível (${erro.code ?? erro.message}); tentando de novo em segundo plano`);
        avisouFalha = true;
      }
    } finally {
      conectando = false;
    }
  }

  async function publicarPendentes() {
    if (publicando) return;
    publicando = true;
    try {
      if (!canal) await conectar();
      while (canal && outbox.length > 0) {
        const evento = outbox[0];
        canal.publish(EXCHANGE, evento.tipo, Buffer.from(JSON.stringify(evento)), {
          persistent: true,                 // a mensagem é gravada em disco pelo broker
          contentType: 'application/json',
          messageId: evento.eventoId,       // usado pelos consumidores para a idempotência
          correlationId: evento.requestId,  // o mesmo X-Request-Id da requisição de origem
          type: evento.tipo,
          timestamp: Math.floor(Date.parse(evento.ocorridoEm) / 1000),
          headers: { 'x-request-id': evento.requestId },
        });
        await canal.waitForConfirms(); // lança erro se o broker recusar
        outbox.shift();
        evento.publicadoEm = new Date().toISOString();
        log(`[outbox] ${evento.requestId} publicado ${evento.tipo} (evento ${evento.eventoId})`);
      }
    } catch (erro) {
      log(`[outbox] falha ao publicar (${erro.message}); o evento continua na outbox`);
      canal = null;
    } finally {
      publicando = false;
    }
  }

  return {
    // Chamado pela Camada de Aplicação logo depois de alterar os dados (síncrono, não espera o broker)
    registrar(tipo, dados, requestId) {
      const evento = {
        eventoId: randomUUID(),
        tipo,
        versao: 1,
        ocorridoEm: new Date().toISOString(),
        requestId: requestId ?? 'sem-request-id',
        dados,
      };
      outbox.push(evento);
      log(`[rest] ${evento.requestId} evento ${tipo} registrado na outbox (${outbox.length} pendente(s))`);
      return evento;
    },
    iniciar() {
      timer = setInterval(publicarPendentes, intervaloMs);
      publicarPendentes();
    },
    async parar() {
      clearInterval(timer);
      try { await conexao?.close(); } catch { /* já fechada */ }
    },
    estado() {
      return { brokerConectado: Boolean(canal), eventosPendentes: outbox.length };
    },
  };
}

// Versão sem broker, usada nos testes automatizados: só guarda os eventos registrados
export function criarPublicadorEmMemoria() {
  const eventos = [];
  return {
    eventos,
    registrar(tipo, dados, requestId) {
      const evento = { eventoId: randomUUID(), tipo, versao: 1, ocorridoEm: new Date().toISOString(), requestId, dados };
      eventos.push(evento);
      return evento;
    },
    iniciar() {},
    async parar() {},
    estado() { return { brokerConectado: false, eventosPendentes: eventos.length }; },
  };
}
