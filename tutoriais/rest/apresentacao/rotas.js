// Camada de Apresentação — rotas HTTP. Só conhece a Camada de Aplicação (os "servicos"):
// não acessa o repositório nem o RabbitMQ (regra verificável do ADR-002).
import { Router } from 'express';

export function criarRotas(servicos) {
  const r = Router();
  const ctx = (req) => ({ requestId: req.id });

  // ---------- Usuários ----------
  r.get('/usuarios', (req, res) => res.json(servicos.listarUsuarios(req.query)));
  r.get('/usuarios/:id', (req, res) => res.json(servicos.obterUsuario(req.params.id)));
  r.post('/usuarios', (req, res) => {
    const novo = servicos.criarUsuario(req.body);
    res.status(201).location(`/usuarios/${novo.id}`).json(novo);
  });

  // ---------- Objetos (anúncios): CRUD completo ----------
  r.get('/objetos', (req, res) => res.json(servicos.listarObjetos(req.query)));
  r.get('/objetos/:id', (req, res) => res.json(servicos.obterObjeto(req.params.id)));
  r.post('/objetos', (req, res) => {
    const novo = servicos.anunciarObjeto(req.body, ctx(req));
    res.status(201).location(`/objetos/${novo.id}`).json(novo);
  });
  r.put('/objetos/:id', (req, res) => res.json(servicos.substituirObjeto(req.params.id, req.body, ctx(req))));
  r.patch('/objetos/:id', (req, res) => res.json(servicos.alterarObjeto(req.params.id, req.body, ctx(req))));
  r.delete('/objetos/:id', (req, res) => {
    servicos.removerObjeto(req.params.id, ctx(req));
    res.status(204).end();
  });

  // ---------- Aluguéis ----------
  r.get('/alugueis', (req, res) => res.json(servicos.listarAlugueis(req.query)));
  r.get('/alugueis/:id', (req, res) => res.json(servicos.obterAluguel(req.params.id)));
  r.post('/alugueis', (req, res) => {
    const novo = servicos.solicitarAluguel(req.body, ctx(req));
    // 201 sai já: os consumidores do evento aluguel.solicitado trabalham depois, sem a API esperar
    res.status(201).location(`/alugueis/${novo.id}`).json(novo);
  });
  // Muda o status (aprovar, recusar, cancelar, registrar retirada e devolução)
  r.patch('/alugueis/:id', (req, res) => res.json(servicos.mudarStatusAluguel(req.params.id, req.body, ctx(req))));

  // ---------- Avaliações ----------
  r.get('/avaliacoes', (req, res) => res.json(servicos.listarAvaliacoes(req.query)));
  r.get('/avaliacoes/:id', (req, res) => res.json(servicos.obterAvaliacao(req.params.id)));
  r.post('/avaliacoes', (req, res) => {
    const nova = servicos.registrarAvaliacao(req.body, ctx(req));
    res.status(201).location(`/avaliacoes/${nova.id}`).json(nova);
  });

  return r;
}
