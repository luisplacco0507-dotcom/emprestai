// Mostra o que está parado nas DLQs dos consumidores, sem tirar nada de lá.
// Rode com: npm run dlq          (ou veja no painel: http://localhost:15672, aba Queues)
import amqp from 'amqplib';
import { URL_RABBITMQ } from './base-consumidor.js';

const DLQS = ['notificacoes', 'auditoria', 'avaliacoes'].map((n) => `emprestai.${n}.dlq`);

const conexao = await amqp.connect(URL_RABBITMQ);
const canal = await conexao.createChannel();

for (const dlq of DLQS) {
  const { messageCount } = await canal.assertQueue(dlq, { durable: true });
  console.log(`\n${dlq}: ${messageCount} mensagem(ns)`);
  const lidas = [];
  for (let i = 0; i < messageCount; i++) {
    const msg = await canal.get(dlq, { noAck: false });
    if (!msg) break;
    lidas.push(msg);
    const morte = msg.properties.headers?.['x-death']?.[0];
    let evento = {};
    try { evento = JSON.parse(msg.content.toString()); } catch { /* malformada */ }
    console.log(`  • ${msg.properties.headers?.['x-routing-key-original'] ?? morte?.['routing-keys']?.[0] ?? '?'}` +
      `  evento=${msg.properties.messageId ?? '-'}  X-Request-Id=${msg.properties.headers?.['x-request-id'] ?? '-'}` +
      `  tentativas=${msg.properties.headers?.['x-tentativas'] ?? 0}  motivo=${morte?.reason ?? '-'}` +
      (evento.dados?.locatario ? `  locatário=${evento.dados.locatario.nome} (${evento.dados.locatario.telefone})` : ''));
  }
  // devolve tudo para a DLQ: inspecionar não pode apagar nada
  for (const msg of lidas) canal.nack(msg, false, true);
}

await canal.close();
await conexao.close();
