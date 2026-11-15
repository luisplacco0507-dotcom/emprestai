// Regra arquitetural verificável do ADR-002 (camadas fechadas no backend do Emprestaí):
//   Permitido:     Apresentação → Aplicação → Domínio      (a Infraestrutura é entregue à Aplicação)
//   Não permitido: Apresentação → Infraestrutura / banco / broker
//                  Domínio → Infraestrutura / banco / broker
// O teste lê os "import" de cada arquivo e falha se alguma camada depender do que não deve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'rest');
const DRIVERS = ['amqplib', 'pg', 'mysql2', 'mongodb', 'node:fs', 'node:net'];

function importsDe(camada) {
  return readdirSync(join(REST, camada))
    .filter((f) => f.endsWith('.js'))
    .flatMap((arquivo) => {
      const codigo = readFileSync(join(REST, camada, arquivo), 'utf8');
      return [...codigo.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => ({ arquivo, alvo: m[1] }));
    });
}

const proibir = (camada, criterio, motivo) => {
  const violacoes = importsDe(camada).filter(({ alvo }) => criterio(alvo));
  assert.deepEqual(violacoes, [], `${camada} viola o ADR-002: ${motivo}`);
};

test('Apresentação só fala com a Aplicação (nada de infraestrutura, banco ou broker)', () => {
  proibir('apresentacao', (alvo) => alvo.includes('infraestrutura') || alvo.includes('dominio') || DRIVERS.includes(alvo),
    'a Apresentação não pode acessar Domínio, Infraestrutura ou drivers diretamente');
});

test('Aplicação não importa a Infraestrutura (ela é injetada)', () => {
  proibir('aplicacao', (alvo) => alvo.includes('infraestrutura') || DRIVERS.includes(alvo),
    'a Aplicação recebe repositório e publicador por injeção');
});

test('Domínio não depende de banco, broker nem infraestrutura', () => {
  proibir('dominio', (alvo) => alvo.includes('infraestrutura') || alvo.includes('aplicacao') ||
    alvo.includes('apresentacao') || DRIVERS.includes(alvo), 'o Domínio deve ser puro');
});
