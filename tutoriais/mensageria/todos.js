// Atalho para a demonstração: sobe os 3 consumidores num só terminal (cada um continua sendo
// um processo separado, com a sua fila). Rode com: npm run consumidores
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pasta = dirname(fileURLToPath(import.meta.url));
const consumidores = ['consumidor-notificacoes.js', 'consumidor-auditoria.js', 'consumidor-avaliacoes.js'];

const filhos = consumidores.map((arquivo) =>
  spawn(process.execPath, [join(pasta, arquivo)], { stdio: 'inherit', env: process.env }));

const encerrar = () => { for (const f of filhos) f.kill(); process.exit(0); };
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
