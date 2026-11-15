// Base comum dos consumidores do Emprestaí (RabbitMQ + amqplib).
// Cada consumidor tem a SUA fila ligada à exchange topic "emprestai.eventos" com os seus padrões,
// e a sua DLQ. Aqui ficam as garantias que todos precisam:
//   • fila durable, confirmação manual (ack) e prefetch
//   • nova tentativa limitada, com espera crescente, e DLQ para o que não tem jeito
//   • idempotência: a mesma mensagem (mesmo messageId) não repete o efeito, nem depois de reiniciar
//   • log com o X-Request-Id da requisição que originou o evento
import amqp from 'amqplib';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXCHANGE = 'emprestai.eventos';
export const URL_RABBITMQ = process.env.RABBITMQ_URL ?? 'amqp://localhost';
export const PASTA_DADOS = join(dirname(fileURLToPath(import.meta.url)), 'dados');

// Erro que não adianta tentar de novo (ex.: mensagem malformada): vai direto para a DLQ
export class ErroPermanente extends Error {}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---------- Registro de mensagens já processadas (idempotência) ----------
// Em produção: tabela no banco com chave única no id da mensagem. Aqui: um arquivo JSON por consumidor,
// que sobrevive a reinícios do processo (um Set em memória se perderia).
function criarRegistroDeProcessadas(nome) {
  mkdirSync(PASTA_DADOS, { recursive: true });
  const arquivo = join(PASTA_DADOS, `${nome}-processadas.json`);
  const ids = new Set(existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, 'utf8')) : []);
  return {
    jaProcessada: (id) => ids.has(id),
    marcar(id) {
      ids.add(id);
      writeFileSync(arquivo, JSON.stringify([...ids]));
    },
  };
}

// Grava uma linha num arquivo .jsonl da pasta dados/ (o "efeito" observável de cada consumidor)
export function registrarEmArquivo(nomeArquivo, objeto) {
  mkdirSync(PASTA_DADOS, { recursive: true });
  appendFileSync(join(PASTA_DADOS, nomeArquivo), JSON.stringify(objeto) + '\n');
}

/**
 * Cria a lógica de tratamento de UMA mensagem. Separada da conexão para poder ser testada
 * com um canal falso (testes/unitarios/mensageria.test.js).
 */
export function criarTratador({ nome, fila, canal, processar, registro, maxTentativas = 3, esperaBaseMs = 500, log = console.log }) {
  const emAndamento = new Set(); // cópias da mesma mensagem que chegam enquanto a primeira processa
  return async function tratar(msg) {
    if (msg === null) return; // o broker cancelou o consumidor (ex.: fila apagada)
    const props = msg.properties;
    const requestId = props.headers?.['x-request-id'] ?? props.correlationId ?? 'sem-request-id';
    // Na nova tentativa a mensagem volta direto para a fila; a chave original vai num cabeçalho
    const chave = props.headers?.['x-routing-key-original'] ?? msg.fields.routingKey;
    const prefixo = `[${nome}] ${requestId} ${chave}`;

    let evento;
    try {
      evento = JSON.parse(msg.content.toString());
    } catch {
      log(`${prefixo} mensagem malformada → DLQ`);
      return canal.nack(msg, false, false); // requeue = false: vai para a DLX e daí para a DLQ
    }

    const idMensagem = props.messageId ?? evento.eventoId;
    if (idMensagem && (registro.jaProcessada(idMensagem) || emAndamento.has(idMensagem))) {
      log(`${prefixo} evento ${idMensagem} já processado, ignorando (idempotência)`);
      return canal.ack(msg);
    }

    const tentativa = (props.headers?.['x-tentativas'] ?? 0) + 1;
    if (idMensagem) emAndamento.add(idMensagem);
    try {
      await processar(evento, { chave, requestId, tentativa, log: (texto) => log(`${prefixo} ${texto}`) });
      if (idMensagem) registro.marcar(idMensagem);
      canal.ack(msg); // só agora a mensagem sai da fila
    } catch (erro) {
      if (erro instanceof ErroPermanente) {
        log(`${prefixo} erro permanente (${erro.message}) → DLQ`);
        return canal.nack(msg, false, false);
      }
      if (tentativa < maxTentativas) {
        const espera = esperaBaseMs * 2 ** (tentativa - 1); // espera crescente: 0,5 s, 1 s, 2 s...
        log(`${prefixo} falhou na tentativa ${tentativa}/${maxTentativas} (${erro.message}); nova tentativa em ${espera} ms`);
        await esperar(espera);
        // Republica com o contador atualizado (mantendo messageId e X-Request-Id) e confirma a original
        canal.sendToQueue(fila, msg.content, {
          persistent: true,
          contentType: props.contentType,
          messageId: props.messageId,
          correlationId: props.correlationId,
          type: props.type,
          headers: { ...props.headers, 'x-tentativas': tentativa, 'x-routing-key-original': chave },
        });
        canal.ack(msg);
      } else {
        log(`${prefixo} falhou ${tentativa} vezes (${erro.message}) → DLQ`);
        canal.nack(msg, false, false); // desiste: vai para a DLQ
      }
    } finally {
      if (idMensagem) emAndamento.delete(idMensagem);
    }
  };
}

/**
 * Sobe um consumidor: declara exchange, DLX, DLQ e fila; liga os padrões; consome com prefetch.
 * Se o RabbitMQ não estiver no ar (ou cair), tenta reconectar a cada 3 segundos.
 */
export async function iniciarConsumidor({ nome, padroes, processar, prefetch = 5, maxTentativas = 3 }) {
  const fila = `emprestai.${nome}`;
  const dlx = `${fila}.dlx`;
  const dlq = `${fila}.dlq`;
  const registro = criarRegistroDeProcessadas(nome);

  async function conectar() {
    const conexao = await amqp.connect(URL_RABBITMQ);
    try {
      await prepararCanal(conexao);
    } catch (erro) {
      // ex.: PRECONDITION_FAILED se a fila já existe com outros argumentos (veja o README)
      await conexao.close().catch(() => {});
      throw erro;
    }
    conexao.on('error', () => {});
    conexao.on('close', () => {
      console.log(`[${nome}] conexão com o RabbitMQ perdida; reconectando...`);
      setTimeout(tentar, 3000);
    });
  }

  async function prepararCanal(conexao) {
    const canal = await conexao.createChannel();

    await canal.assertExchange(EXCHANGE, 'topic', { durable: true });

    // Exchange e fila que recebem as mensagens "mortas" deste consumidor
    await canal.assertExchange(dlx, 'fanout', { durable: true });
    await canal.assertQueue(dlq, { durable: true });
    await canal.bindQueue(dlq, dlx, '');

    // Fila principal: durable, desviando para a DLX o que for rejeitado
    await canal.assertQueue(fila, { durable: true, arguments: { 'x-dead-letter-exchange': dlx } });
    for (const padrao of padroes) await canal.bindQueue(fila, EXCHANGE, padrao);
    await canal.prefetch(prefetch); // no máximo N mensagens sem ack por vez

    const tratar = criarTratador({ nome, fila, canal, processar, registro, maxTentativas });
    await canal.consume(fila, tratar, { noAck: false });
    console.log(`[${nome}] ouvindo "${fila}" com ${padroes.map((p) => `"${p}"`).join(', ')} (prefetch ${prefetch}, DLQ "${dlq}")`);
  }

  async function tentar() {
    try {
      await conectar();
    } catch (erro) {
      console.log(`[${nome}] não foi possível consumir de ${URL_RABBITMQ} (${erro.code ?? erro.message}); nova tentativa em 3 s`);
      setTimeout(tentar, 3000);
    }
  }

  await tentar();
}
