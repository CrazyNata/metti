import type { StylistRepairInput } from "../types.ts";

export const STYLIST_REPAIR_PROMPT_VERSION = "1.1";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function buildStylistRepairPrompt(input: StylistRepairInput): string {
  return `Корректирующая попытка Metti AI Stylist (версия ${STYLIST_REPAIR_PROMPT_VERSION}).

Предыдущий ответ не прошёл backend validation.

Ошибки validation:
${json(input.validationErrors)}

Разрешённые реальные itemId:
${json(input.generation.availableItems.map((item) => item.itemId))}

Предыдущий ответ:
${json(input.previousResponse)}

Исправь только ошибки, сохрани хорошие валидные варианты и не создавай новые варианты без необходимости.
При исправлении соблюдай исходный brief, выбранные и locked-вещи, полноту базы и точную identity каждой вещи. Не выдумывай itemId, не меняй itemId на похожую вещь и не удаляй обязательный якорь ради прохождения проверки.
Верни только валидный structured JSON в исходной схеме. Язык ответа: ${input.generation.context.language ?? "ru"}.`;
}
