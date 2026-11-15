// Consumidor 3 — Convites de avaliação: só se interessa pela devolução ("aluguel.devolvido").
// Quando o objeto volta, abre um convite para cada parte avaliar a outra (avaliações após a negociação,
// como descrito na oficina do projeto). Rode com: npm run avaliacoes
import { iniciarConsumidor, registrarEmArquivo } from './base-consumidor.js';

await iniciarConsumidor({
  nome: 'avaliacoes',
  padroes: ['aluguel.devolvido'],
  async processar(evento, { log }) {
    const a = evento.dados;
    const convites = [
      { avaliadorId: a.locatario.id, avaliadoId: a.proprietario.id },
      { avaliadorId: a.proprietario.id, avaliadoId: a.locatario.id },
    ];
    for (const c of convites) {
      registrarEmArquivo('convites-avaliacao.jsonl', {
        eventoId: evento.eventoId, requestId: evento.requestId, aluguelId: a.id, ...c,
        validoAte: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
      });
    }
    log(`convites de avaliação abertos para ${a.locatario.nome} e ${a.proprietario.nome} (aluguel ${a.id})`);
  },
});
