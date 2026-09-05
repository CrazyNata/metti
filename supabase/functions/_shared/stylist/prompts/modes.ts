import type { GenerateOutfitsInput, StylistMode } from "../types.ts";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function commonContext(input: GenerateOutfitsInput): string {
  return [
    `language: ${input.context.language ?? "ru"}`,
    `styleProfile:\n${json(input.styleProfile)}`,
    `availableItems:\n${json(input.availableItems)}`,
  ].join("\n\n");
}

function creativityInstruction(input: GenerateOutfitsInput): string {
  if (input.preferredCreativity) {
    return `Предпочтительный уровень стилизации: ${input.preferredCreativity}. Соблюдай его, если пользователь не попросил обратное.`;
  }
  return input.count >= 3
    ? "Для трёх и более вариантов стремись дать микс: один safe, один balanced и один bold. Все варианты должны оставаться носибельными."
    : "Выбирай уровень стилизации по контексту и запросу пользователя.";
}

export function buildStylistUserPrompt(input: GenerateOutfitsInput): string {
  const context = commonContext(input);
  switch (input.mode) {
    case "selected_item":
      return `Создай ${input.count} разных образа вокруг выбранной вещи.

selectedItemId: ${input.selectedItemId ?? ""}
Выбранная вещь ОБЯЗАТЕЛЬНО должна присутствовать в каждом варианте. Не заменяй её похожей вещью.
Выбранная вещь — якорь, а не полный образ. Собери законченный комплект: платье + обувь или обычный верх + низ + обувь, если такие категории есть в availableItems. Верхняя одежда не заменяет базовый верх и низ.

Контекст:
${json(input.context)}

Пользовательский запрос:
${input.prompt || "Собери лучшие повседневные варианты."}

${context}

${creativityInstruction(input)}

Сделай варианты действительно разными.`;

    case "restyle":
      return `Перед тобой существующий outfit. Создай ${input.count} улучшенных варианта.

Current itemIds:
${json(input.currentItemIds)}

Locked itemIds:
${json(input.lockedItemIds)}

Locked items должны остаться в каждом варианте. Меняй минимально необходимое количество вещей.
Каждый вариант должен остаться полноценным: платье + обувь или обычный верх + низ + обувь, если эти вещи доступны. Не оставляй только куртку и обувь.

Instruction:
${input.instruction || input.prompt || "Сделай образ более цельным."}

Контекст:
${json(input.context)}

${context}

${creativityInstruction(input)}`;

    case "packing":
      return `Собери капсулу для поездки и ${input.count} разных образа из неё.

Учитывай длительность поездки, погоду, мероприятия, возможность стирки, повторное использование вещей, число комбинаций и минимум багажа. Каждая вещь по возможности должна сочетаться минимум с двумя другими вещами капсулы. Не бери несколько почти одинаковых вещей без необходимости.

Контекст поездки:
${json(input.context)}

Пользовательский запрос:
${input.prompt}

${context}

${creativityInstruction(input)}`;

    case "shopping_recommendation":
      return `Проанализируй дыры гардероба пользователя и подготовь ${input.count} приоритетных рекомендаций, которые увеличат число хороших сочетаний.

Не придумывай конкретный товар или бренд и не смешивай отсутствующие категории с wardrobe itemIds. В этом режиме response может содержать только отдельные рекомендации покупок.

Контекст:
${json(input.context)}

Пользовательский запрос:
${input.prompt}

${context}

${creativityInstruction(input)}`;

    case "today":
    default:
      return `Собери лучшие образы на сегодня. Создай ${input.count} разных образа.

Каждый вариант должен быть полноценным: платье + обувь или обычный верх + низ + обувь, если эти категории доступны. Верхняя одежда и обувь сами по себе не являются полным образом.

Контекст:
${json(input.context)}

Пользовательский запрос:
${input.prompt || "Что надеть сегодня?"}

${context}

${creativityInstruction(input)}`;
  }
}

export function promptModeLabel(mode: StylistMode): string {
  return mode.replace(/_/g, " ");
}
