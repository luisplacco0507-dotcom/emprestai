// Testes automatizados das rotas da API REST — rode com: npm test
// Cada teste sobe a API numa porta livre, com dados novos e um publicador de eventos em memória.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { criarApp } from '../../rest/app.js';
import { criarPublicadorEmMemoria } from '../../rest/infraestrutura/publicador-eventos.js';
import { hoje, somarDias } from '../../rest/dominio/regras.js';

let servidor;
let base;
let publicador;

before(async () => {
  publicador = criarPublicadorEmMemoria();
  const app = criarApp({ publicador, log: () => {} });
  await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

const dia = (n) => somarDias(hoje(), n);

async function chamar(metodo, caminho, corpo, cabecalhos = {}) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...cabecalhos },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  return { status: r.status, headers: r.headers, corpo: texto ? JSON.parse(texto) : null };
}

const objetoValido = {
  proprietarioId: 1, titulo: 'Serra tico-tico', categoria: 'FERRAMENTAS', estado: 'NOVO',
  valorDiaria: 12.5, maxDias: 3, cidade: 'Belo Horizonte',
};

test('CRUD de objetos: 201 com Location, 200, 204 e 404', async () => {
  const criado = await chamar('POST', '/objetos', objetoValido);
  assert.equal(criado.status, 201);
  assert.equal(criado.headers.get('location'), `/objetos/${criado.corpo.id}`);
  assert.ok(publicador.eventos.some((e) => e.tipo === 'objeto.anunciado'));

  const lido = await chamar('GET', `/objetos/${criado.corpo.id}`);
  assert.equal(lido.status, 200);
  assert.equal(lido.corpo.titulo, 'Serra tico-tico');

  const alterado = await chamar('PATCH', `/objetos/${criado.corpo.id}`, { valorDiaria: 10, id: 999, proprietarioId: 2 });
  assert.equal(alterado.corpo.valorDiaria, 10);
  assert.equal(alterado.corpo.id, criado.corpo.id, 'o id não muda (mass assignment)');
  assert.equal(alterado.corpo.proprietarioId, 1, 'o dono não muda pelo corpo');

  const substituido = await chamar('PUT', `/objetos/${criado.corpo.id}`, { ...objetoValido, titulo: 'Serra tico-tico 500W' });
  assert.equal(substituido.status, 200);
  assert.equal(substituido.corpo.titulo, 'Serra tico-tico 500W');

  assert.equal((await chamar('DELETE', `/objetos/${criado.corpo.id}`)).status, 204);
  const removido = await chamar('GET', `/objetos/${criado.corpo.id}`);
  assert.equal(removido.status, 404);
  assert.equal(removido.headers.get('content-type'), 'application/problem+json; charset=utf-8');
});

test('lista com filtro, ordenação, paginação e teto de 50', async () => {
  const r = await chamar('GET', '/objetos?categoria=FERRAMENTAS&ordenar=valorDiaria&ordem=desc&limite=1000');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.paginacao.limite, 50);
  assert.ok(r.corpo.dados.every((o) => o.categoria === 'FERRAMENTAS'));
  const valores = r.corpo.dados.map((o) => o.valorDiaria);
  assert.deepEqual(valores, [...valores].sort((a, b) => b - a));
});

test('400: id inválido, filtro inválido e JSON quebrado', async () => {
  assert.equal((await chamar('GET', '/objetos/abc')).corpo.type.endsWith('identificador-invalido'), true);
  assert.equal((await chamar('GET', '/objetos?categoria=CARRO')).status, 400);
  assert.equal((await chamar('GET', '/objetos?pagina=0')).status, 400);
  const r = await fetch(`${base}/objetos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"titulo":' });
  assert.equal(r.status, 400);
});

test('422: validação lista os campos inválidos', async () => {
  const r = await chamar('POST', '/objetos', { titulo: 'X', categoria: 'CARRO', valorDiaria: -1 });
  assert.equal(r.status, 422);
  const campos = r.corpo.erros.map((e) => e.campo);
  for (const c of ['proprietarioId', 'titulo', 'categoria', 'valorDiaria', 'estado', 'maxDias', 'cidade']) {
    assert.ok(campos.includes(c), `faltou o campo ${c}`);
  }
});

test('regras do aluguel: 422 passado, 422 limite, 422 próprio objeto, 409 ocupado, 201', async () => {
  const ok = await chamar('POST', '/alugueis', { objetoId: 1, locatarioId: 2, dataInicio: dia(1), dataFim: dia(2) });
  assert.equal(ok.status, 201);
  assert.equal(ok.corpo.valorTotal, 30);
  assert.equal(ok.corpo.status, 'SOLICITADO');
  const evento = publicador.eventos.at(-1);
  assert.equal(evento.tipo, 'aluguel.solicitado');
  assert.equal(evento.dados.locatario.nome, 'Bruno Lima');

  const tipo = async (corpo) => (await chamar('POST', '/alugueis', corpo)).corpo.type.split('/').pop();
  assert.equal(await tipo({ objetoId: 1, locatarioId: 3, dataInicio: dia(-1), dataFim: dia(1) }), 'data-no-passado');
  assert.equal(await tipo({ objetoId: 1, locatarioId: 3, dataInicio: dia(10), dataFim: dia(30) }), 'periodo-acima-do-limite');
  assert.equal(await tipo({ objetoId: 1, locatarioId: 1, dataInicio: dia(10), dataFim: dia(11) }), 'aluguel-do-proprio-objeto');
  assert.equal(await tipo({ objetoId: 6, locatarioId: 1, dataInicio: dia(10), dataFim: dia(11) }), 'objeto-indisponivel');
  const ocupado = await chamar('POST', '/alugueis', { objetoId: 1, locatarioId: 3, dataInicio: dia(2), dataFim: dia(3) });
  assert.equal(ocupado.status, 409);
  assert.equal(ocupado.corpo.aluguelConflitante, ok.corpo.id);
});

test('máquina de estados: 403 papel errado, 409 transição inválida, fluxo completo e avaliação', async () => {
  const { corpo: a } = await chamar('POST', '/alugueis', { objetoId: 5, locatarioId: 4, dataInicio: dia(20), dataFim: dia(21) });
  const mudar = (status, usuarioId) => chamar('PATCH', `/alugueis/${a.id}`, { status, usuarioId });

  assert.equal((await mudar('APROVADO', 4)).status, 403); // locatário não aprova
  assert.equal((await mudar('DEVOLVIDO', 3)).status, 409); // pulou etapas
  assert.equal((await chamar('POST', '/avaliacoes', { aluguelId: a.id, avaliadorId: 4, nota: 5 })).status, 422);

  for (const s of ['APROVADO', 'RETIRADO', 'DEVOLVIDO']) assert.equal((await mudar(s, 3)).status, 200);
  assert.equal(publicador.eventos.at(-1).tipo, 'aluguel.devolvido');

  const av = await chamar('POST', '/avaliacoes', { aluguelId: a.id, avaliadorId: 4, nota: 5, comentario: 'Ótimo' });
  assert.equal(av.status, 201);
  assert.equal(av.corpo.avaliadoId, 3);
  assert.equal((await chamar('POST', '/avaliacoes', { aluguelId: a.id, avaliadorId: 4, nota: 4 })).status, 409);
  assert.equal((await chamar('POST', '/avaliacoes', { aluguelId: a.id, avaliadorId: 1, nota: 4 })).status, 403);
});

test('409: não remove anúncio com aluguel ativo', async () => {
  const r = await chamar('DELETE', '/objetos/2'); // aluguel 2 está APROVADO
  assert.equal(r.status, 409);
  assert.equal(r.corpo.aluguelAtivo, 2);
});

test('X-Request-Id recebido é devolvido e vai no evento', async () => {
  const id = 'teste-request-id-123';
  const r = await chamar('POST', '/alugueis', { objetoId: 3, locatarioId: 2, dataInicio: dia(15), dataFim: dia(15) }, { 'X-Request-Id': id });
  assert.equal(r.headers.get('x-request-id'), id);
  assert.equal(publicador.eventos.at(-1).requestId, id);
});
