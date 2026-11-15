// testes/teste-mensageria.js — evidências da Parte 2 (cenas 3 e 4 do roteiro).
//
//   npm run teste-evento      → solicita um aluguel pelo gateway: o evento chega aos consumidores
//   npm run teste-falha       → aluguel para Diego (telefone com DDD 00): a notificação falha 3 vezes e vai para a DLQ
//   npm run teste-duplicado   → publica o MESMO evento duas vezes no RabbitMQ: o efeito acontece uma vez só
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';

const BASE = process.env.API_BASE ?? 'http://localhost:3000/api';
const CHAVE = process.env.API_KEY ?? 'chave-painel-moderacao-456';
const RABBITMQ = process.env.RABBITMQ_URL ?? 'amqp://localhost';
const cena = process.argv[2] ?? 'evento';

const dia = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function api(metodo, caminho, corpo) {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'X-API-Key': CHAVE, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = r.status === 204 ? null : await r.json();
  console.log(`${metodo} ${caminho} -> ${r.status}  X-Request-Id: ${r.headers.get('x-request-id')}`);
  if (!r.ok) console.log('  ', dados);
  return dados;
}

// Procura um período livre para o objeto (a demonstração pode ser repetida várias vezes)
async function solicitarEmPeriodoLivre(objetoId, locatarioId) {
  for (let inicio = 1 + Math.floor(Math.random() * 20); inicio < 120; inicio += 3) {
    const r = await fetch(`${BASE}/alugueis`, {
      method: 'POST',
      headers: { 'X-API-Key': CHAVE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ objetoId, locatarioId, dataInicio: dia(inicio), dataFim: dia(inicio + 1) }),
    });
    const corpo = await r.json();
    if (r.status !== 409) {
      console.log(`POST /alugueis -> ${r.status}  Location: ${r.headers.get('location')}  X-Request-Id: ${r.headers.get('x-request-id')}`);
      if (!r.ok) console.log('  ', corpo);
      return corpo;
    }
  }
  throw new Error('nenhum período livre encontrado');
}

if (cena === 'evento') {
  // Bruno (2) pede a furadeira da Ana (1): a resposta 201 volta antes de os consumidores agirem
  const a = await solicitarEmPeriodoLivre(1, 2);
  console.log(`\nAluguel ${a.id} ${a.status}. Veja os terminais: [notificacoes] avisa a Ana; [auditoria] registra.`);
  console.log('Agora o ciclo completo (aprovar, retirar, devolver) — o [avaliacoes] só reage à devolução:');
  for (const status of ['APROVADO', 'RETIRADO', 'DEVOLVIDO']) {
    await api('PATCH', `/alugueis/${a.id}`, { status, usuarioId: 1 });
  }
} else if (cena === 'falha') {
  // Diego (4) tem telefone com DDD 00: o aviso de aprovação para ele nunca é entregue
  const a = await solicitarEmPeriodoLivre(5, 4);
  await api('PATCH', `/alugueis/${a.id}`, { status: 'APROVADO', usuarioId: a.proprietarioId });
  console.log('\nNo terminal do [notificacoes]: tentativa 1, 2 e 3 falham e a mensagem vai para a DLQ.');
  console.log('Confira com "npm run dlq" ou no painel http://localhost:15672 (fila emprestai.notificacoes.dlq).');
} else if (cena === 'duplicado') {
  // Simula o broker (ou a outbox) entregando a mesma mensagem duas vezes
  const conexao = await amqp.connect(RABBITMQ);
  const canal = await conexao.createConfirmChannel();
  await canal.assertExchange('emprestai.eventos', 'topic', { durable: true });
  const evento = {
    eventoId: randomUUID(),
    tipo: 'aluguel.aprovado',
    versao: 1,
    ocorridoEm: new Date().toISOString(),
    requestId: `duplicado-${randomUUID().slice(0, 8)}`,
    dados: {
      id: 2, objetoId: 2, dataInicio: dia(5), dataFim: dia(8), valorTotal: 100, status: 'APROVADO',
      objeto: { id: 2, titulo: 'Barraca de camping 4 pessoas', categoria: 'CAMPING' },
      proprietario: { id: 2, nome: 'Bruno Lima', telefone: '+55 (31) 98888-0002' },
      locatario: { id: 3, nome: 'Carla Dias', telefone: '+55 (31) 98888-0003' },
    },
  };
  for (let i = 1; i <= 2; i++) {
    canal.publish('emprestai.eventos', evento.tipo, Buffer.from(JSON.stringify(evento)), {
      persistent: true, contentType: 'application/json', messageId: evento.eventoId,
      correlationId: evento.requestId, headers: { 'x-request-id': evento.requestId },
    });
    await canal.waitForConfirms();
    console.log(`Publicada cópia ${i} do evento ${evento.eventoId} (${evento.tipo})`);
  }
  await canal.close();
  await conexao.close();
  console.log('\nNos terminais: a 1ª cópia notifica a Carla e é auditada; a 2ª aparece como "já processado, ignorando".');
} else {
  console.log('Uso: node testes/teste-mensageria.js [evento|falha|duplicado]');
}
