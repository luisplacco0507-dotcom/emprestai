// Camada de Infraestrutura — "banco de dados" em memória.
// O ADR-001 escolheu PostgreSQL; no protótipo os dados ficam em memória, mas atrás da mesma
// interface (listar/buscar/inserir/substituir/remover). Trocar por PostgreSQL muda só este arquivo.

class Colecao {
  constructor(registros) {
    this.registros = registros;
    this.proximoId = Math.max(0, ...registros.map((r) => r.id)) + 1;
  }
  listar() { return [...this.registros]; }
  buscar(id) { return this.registros.find((r) => r.id === id) ?? null; }
  inserir(dados) {
    const novo = { id: this.proximoId++, ...dados };
    this.registros.push(novo);
    return novo;
  }
  substituir(id, registro) {
    const i = this.registros.findIndex((r) => r.id === id);
    const { id: _ignorado, ...resto } = registro;
    this.registros[i] = { id, ...resto };
    return this.registros[i];
  }
  remover(id) {
    const i = this.registros.findIndex((r) => r.id === id);
    if (i >= 0) this.registros.splice(i, 1);
  }
}

// Datas dos dados iniciais calculadas a partir de hoje, para a demonstração funcionar em qualquer dia
function dia(deslocamento) {
  const d = new Date();
  d.setDate(d.getDate() + deslocamento);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const momento = (deslocamentoDias) => new Date(Date.now() + deslocamentoDias * 86_400_000).toISOString();

export function criarRepositorio() {
  // Todos os dados pessoais são fictícios
  const usuarios = [
    { id: 1, nome: 'Ana Souza', email: 'ana.souza@exemplo.com', telefone: '+55 (31) 98888-0001', cidade: 'Belo Horizonte', criadoEm: momento(-90) },
    { id: 2, nome: 'Bruno Lima', email: 'bruno.lima@exemplo.com', telefone: '+55 (31) 98888-0002', cidade: 'Belo Horizonte', criadoEm: momento(-80) },
    { id: 3, nome: 'Carla Dias', email: 'carla.dias@exemplo.com', telefone: '+55 (31) 98888-0003', cidade: 'Contagem', criadoEm: momento(-60) },
    // DDD 00 não existe: o serviço de notificações recusa, e a mensagem acaba na DLQ (cena 4)
    { id: 4, nome: 'Diego Rocha', email: 'diego.rocha@exemplo.com', telefone: '+55 (00) 90000-0000', cidade: 'Belo Horizonte', criadoEm: momento(-5) },
  ];

  const objetos = [
    { id: 1, proprietarioId: 1, titulo: 'Furadeira de impacto 650W', descricao: 'Acompanha maleta e jogo de brocas.', categoria: 'FERRAMENTAS', estado: 'SEMINOVO', valorDiaria: 15, maxDias: 7, cidade: 'Belo Horizonte', disponivel: true, criadoEm: momento(-70) },
    { id: 2, proprietarioId: 2, titulo: 'Barraca de camping 4 pessoas', descricao: 'Impermeável, com sobreteto.', categoria: 'CAMPING', estado: 'USADO', valorDiaria: 25, maxDias: 10, cidade: 'Belo Horizonte', disponivel: true, criadoEm: momento(-65) },
    { id: 3, proprietarioId: 3, titulo: 'Projetor Full HD', descricao: 'Com cabo HDMI de 5 m.', categoria: 'ELETRONICOS', estado: 'SEMINOVO', valorDiaria: 40, maxDias: 3, cidade: 'Contagem', disponivel: true, criadoEm: momento(-50) },
    { id: 4, proprietarioId: 1, titulo: 'Bicicleta aro 29', descricao: 'Tamanho M, com capacete.', categoria: 'ESPORTE', estado: 'USADO', valorDiaria: 30, maxDias: 5, cidade: 'Belo Horizonte', disponivel: true, criadoEm: momento(-40) },
    { id: 5, proprietarioId: 3, titulo: 'Kit de festa infantil', descricao: 'Toalhas, bandejas e painel. Empréstimo gratuito.', categoria: 'FESTA', estado: 'USADO', valorDiaria: 0, maxDias: 2, cidade: 'Contagem', disponivel: true, criadoEm: momento(-30) },
    { id: 6, proprietarioId: 2, titulo: 'Escada de alumínio 7 degraus', descricao: 'Anúncio pausado pelo dono.', categoria: 'FERRAMENTAS', estado: 'USADO', valorDiaria: 10, maxDias: 7, cidade: 'Belo Horizonte', disponivel: false, criadoEm: momento(-20) },
  ];

  const historico = (...passos) => passos.map(([status, porUsuarioId, d]) => ({ status, porUsuarioId, em: momento(d) }));

  const alugueis = [
    { id: 1, objetoId: 1, proprietarioId: 1, locatarioId: 2, dataInicio: dia(-10), dataFim: dia(-8), dias: 3, valorTotal: 45, status: 'DEVOLVIDO',
      historico: historico(['SOLICITADO', 2, -12], ['APROVADO', 1, -12], ['RETIRADO', 1, -10], ['DEVOLVIDO', 1, -8]), criadoEm: momento(-12) },
    { id: 2, objetoId: 2, proprietarioId: 2, locatarioId: 3, dataInicio: dia(5), dataFim: dia(8), dias: 4, valorTotal: 100, status: 'APROVADO',
      historico: historico(['SOLICITADO', 3, -2], ['APROVADO', 2, -1]), criadoEm: momento(-2) },
    { id: 3, objetoId: 3, proprietarioId: 3, locatarioId: 1, dataInicio: dia(2), dataFim: dia(3), dias: 2, valorTotal: 80, status: 'SOLICITADO',
      historico: historico(['SOLICITADO', 1, -1]), criadoEm: momento(-1) },
    { id: 4, objetoId: 4, proprietarioId: 1, locatarioId: 3, dataInicio: dia(-1), dataFim: dia(1), dias: 3, valorTotal: 90, status: 'RETIRADO',
      historico: historico(['SOLICITADO', 3, -3], ['APROVADO', 1, -3], ['RETIRADO', 1, -1]), criadoEm: momento(-3) },
    { id: 5, objetoId: 1, proprietarioId: 1, locatarioId: 3, dataInicio: dia(12), dataFim: dia(13), dias: 2, valorTotal: 30, status: 'SOLICITADO',
      historico: historico(['SOLICITADO', 3, 0]), criadoEm: momento(0) },
  ];

  const avaliacoes = [
    { id: 1, aluguelId: 1, avaliadorId: 2, avaliadoId: 1, nota: 5, comentario: 'Furadeira impecável, dona muito atenciosa.', criadoEm: momento(-7) },
    { id: 2, aluguelId: 1, avaliadorId: 1, avaliadoId: 2, nota: 4, comentario: 'Devolveu no prazo.', criadoEm: momento(-7) },
  ];

  return {
    usuarios: new Colecao(usuarios),
    objetos: new Colecao(objetos),
    alugueis: new Colecao(alugueis),
    avaliacoes: new Colecao(avaliacoes),
  };
}
