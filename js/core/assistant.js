// Оркестратор: фраза → правила → (если не поняли) ИИ → команды. Без ИИ/сети — «черновик» с сырым текстом.
import { parse, splitDictation } from './rules.js';
import { askBrain, brainReady } from './brain.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// → {commands, usedBrain, brainError}
export async function interpret({ text, today, settings, secrets, fetchImpl }) {
  const commands = [];
  const unknown = [];
  for (const piece of splitDictation(text)) {
    const r = parse(piece.text, today, { assumeTask: piece.assumeTask });
    if (r.type === 'unknown') { if (r.text) unknown.push(r.text); }
    else commands.push(r);
  }
  let usedBrain = false;
  let brainError = null;
  if (unknown.length) {
    if (brainReady(settings, secrets).ok) {
      const r = await askBrain({ settings, secrets, text: unknown.join('\n'), today, fetchImpl });
      if (r.ok) {
        usedBrain = true;
        for (const c of r.commands) commands.push(c.type === 'add' ? { ...c, due: c.due || today } : c);
      } else {
        brainError = r;
      }
    }
    if (!usedBrain) {
      // Запасной путь: сохраняем как есть, Игорь поправит в карточке.
      for (const u of unknown) commands.push({ type: 'add', title: cap(u).slice(0, 200), due: today, time: null, object: null, draft: true, via: 'raw' });
    }
  }
  return { commands, usedBrain, brainError };
}
