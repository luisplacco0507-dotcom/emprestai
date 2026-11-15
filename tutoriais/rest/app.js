// Ponto de montagem da API REST: liga as camadas (Apresentação → Aplicação → Domínio)
// e entrega à Aplicação a Infraestrutura que ela vai usar (repositório e publicador de eventos).
import express from 'express';
import { randomUUID } from 'node:crypto';
import { criarRotas } from './apresentacao/rotas.js';
import { rotaInexistente, tratadorDeErros } from './apresentacao/problemas.js';
import { criarServicos } from './aplicacao/servicos.js';
import { criarRepositorio } from './infraestrutura/repositorio-memoria.js';

export function criarApp({ repositorio = criarRepositorio(), publicador, log = console.log } = {}) {
  const servicos = criarServicos({ repositorio, publicador });
  const app = express();
  app.disable('x-powered-by');
  // X-Request-Id: vem do gateway; se a API for chamada direto (desenvolvimento), gera um
  app.use((req, res, next) => {
    req.id = req.get('x-request-id') ?? randomUUID();
    res.set('X-Request-Id', req.id);
    const inicio = performance.now();
    res.on('finish', () => {
      const ms = Math.round(performance.now() - inicio);
      const cliente = req.get('x-cliente-id') ?? '-';
      log(`[rest] ${req.id} ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms} ms) cliente=${cliente}`);
    });
    next();
  });
  app.use(express.json()); // depois do X-Request-Id, para que até o "JSON inválido" saia com o id

  // Só para demonstrar o timeout do gateway (como o ?atraso do tutorial): GET /objetos?atraso=5000
  app.use(async (req, res, next) => {
    const ms = Number(req.query.atraso);
    if (req.method === 'GET' && ms > 0) await new Promise((ok) => setTimeout(ok, Math.min(ms, 10_000)));
    next();
  });

  app.get('/saude', (req, res) => res.json({ status: 'ok', ...publicador.estado() }));
  app.use(criarRotas(servicos));
  app.use(rotaInexistente);
  app.use(tratadorDeErros);
  return app;
}
