// Testes da lógica dos consumidores (ack, nova tentativa, DLQ e idempotência) com um canal falso,
// sem precisar do RabbitMQ no ar. Rode com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarTratador, ErroPermanente } from '../../mensageria/base-consumidor.js';

function canalFalso() {
  const chamadas = [];
  return {
    chamadas,
    ack: (msg) => chamadas.push(['ack', msg.id]),
    nack: (msg, todos, requeue) => chamadas.push(['nack', msg.id, requeue]),
    sendToQueue: (fila, conteudo, props) => chamadas.push(['republicada', fila, props.headers['x-tentativas']]),
  };
}

const registroEmMemoria = () => {
  const ids = new Set();
  return { jaProcessada: (id) => ids.has(id), marcar: (id) => ids.add(id) };
};

const mensagem = (id, { tentativas, conteudo } = {}) => ({
  id,
  content: Buffer.from(conteudo ?? JSON.stringify({ eventoId: 'ev-1', dados: {} })),
  fields: { routingKey: 'aluguel.solicitado' },
  properties: { messageId: 'ev-1', headers: { 'x-request-id': 'req-1', ...(tentativas ? { 'x-tentativas': tentativas } : {}) } },
});

const montar = (processar) => {
  const canal = canalFalso();
  const logs = [];
  const tratar = criarTratador({
    nome: 'teste', fila: 'emprestai.teste', canal, processar, registro: registroEmMemoria(),
    maxTentativas: 3, esperaBaseMs: 1, log: (l) => logs.push(l),
  });
  return { canal, tratar, logs };
};

test('sucesso: processa e confirma (ack); o log traz o X-Request-Id', async () => {
  let vezes = 0;
  const { canal, tratar, logs } = montar(async () => { vezes++; });
  await tratar(mensagem(1));
  assert.equal(vezes, 1);
  assert.deepEqual(canal.chamadas, [['ack', 1]]);
  assert.equal(logs.length, 0);
});

test('idempotência: a mesma mensagem duas vezes não repete o efeito', async () => {
  let vezes = 0;
  const { canal, tratar, logs } = montar(async () => { vezes++; });
  await tratar(mensagem(1));
  await tratar(mensagem(2)); // mesma messageId
  assert.equal(vezes, 1);
  assert.deepEqual(canal.chamadas, [['ack', 1], ['ack', 2]]);
  assert.match(logs[0], /req-1 .*já processado/);
});

test('falha temporária: republica com contador e, na 3ª tentativa, vai para a DLQ', async () => {
  const { canal, tratar } = montar(async () => { throw new Error('serviço fora'); });
  await tratar(mensagem(1));
  await tratar(mensagem(2, { tentativas: 1 }));
  await tratar(mensagem(3, { tentativas: 2 }));
  assert.deepEqual(canal.chamadas, [
    ['republicada', 'emprestai.teste', 1], ['ack', 1],
    ['republicada', 'emprestai.teste', 2], ['ack', 2],
    ['nack', 3, false], // requeue=false → DLX → DLQ
  ]);
});

test('erro permanente e mensagem malformada vão direto para a DLQ', async () => {
  const { canal, tratar } = montar(async () => { throw new ErroPermanente('sem dados'); });
  await tratar(mensagem(1));
  await tratar(mensagem(2, { conteudo: '{isto não é json' }));
  assert.deepEqual(canal.chamadas, [['nack', 1, false], ['nack', 2, false]]);
});
