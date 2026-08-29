/**
 * Historial multi-turno del FinOps Copilot.
 *
 * Hasta ahora cada mensaje viajaba solo: el modelo recibía la pregunta y el
 * payload de la página, sin los turnos previos. Una repregunta ("¿y el mes
 * anterior?", "profundizá en el punto 2") llegaba sin referente y el modelo
 * respondía de cero o pedía que se le repitiera todo.
 *
 * El historial lo manda el CLIENTE, así que es entrada no confiable: se valida
 * la forma, se recorta y se normaliza acá antes de que llegue al proveedor.
 * Dos motivos, no uno:
 *   - Costo: cada turno viejo son tokens de entrada que se cobran de nuevo en
 *     CADA mensaje. Sin tope, una charla larga multiplica el gasto de IA (y
 *     este producto justamente mide ese gasto).
 *   - Compatibilidad: la ruta es provider-agnóstica (google/openai/deepseek/
 *     azure/anthropic). Anthropic rechaza con 400 una conversación que empieza
 *     en `assistant` o que trae dos turnos seguidos del mismo rol, cosas que un
 *     historial armado en el navegador produce con facilidad (un error de red
 *     deja una pregunta sin respuesta colgada al final).
 */

export type CopilotTurn = { role: "user" | "assistant"; content: string };

/** 4 idas y vueltas. Alcanza para resolver referencias sin inflar el prompt. */
export const MAX_HISTORY_TURNS = 8;

/** Tope por turno. Corta respuestas largas viejas (el modo reporte ejecutivo
 *  puede devolver ~450 palabras) sin perder el hilo de la conversación. */
export const MAX_TURN_CHARS = 2000;

/**
 * Normaliza el historial que manda el cliente a algo que cualquier proveedor
 * acepte. Devuelve `[]` ante cualquier entrada que no sirva: el Copilot
 * responde igual, sólo que sin memoria de la conversación.
 */
export function sanitizeCopilotHistory(raw: unknown): CopilotTurn[] {
    if (!Array.isArray(raw)) return [];

    const turns: CopilotTurn[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;

        // La UI usa 'ai' para el asistente (ver GlobalCopilot); se aceptan las
        // dos formas para no romper si un cliente viejo queda cacheado.
        const rawRole = String((entry as { role?: unknown }).role ?? "").toLowerCase();
        const role: CopilotTurn["role"] | null =
            rawRole === "user" ? "user" : rawRole === "assistant" || rawRole === "ai" ? "assistant" : null;
        if (!role) continue;

        const rawContent = (entry as { content?: unknown }).content;
        const content = typeof rawContent === "string" ? rawContent.trim() : "";
        if (!content) continue;

        turns.push({ role, content: content.slice(0, MAX_TURN_CHARS) });
    }

    // Los más recientes: son los que dan contexto a la repregunta.
    let trimmed = turns.slice(-MAX_HISTORY_TURNS);

    // El recorte de arriba puede dejar un `assistant` primero. La conversación
    // tiene que arrancar en `user`.
    while (trimmed.length > 0 && trimmed[0].role === "assistant") trimmed = trimmed.slice(1);

    // Un `user` al final es una pregunta sin responder (el cliente la mandó de
    // más, o la respuesta anterior falló): se descarta para no dejar dos turnos
    // de usuario seguidos al agregarle el mensaje nuevo.
    while (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "user") trimmed = trimmed.slice(0, -1);

    // Turnos consecutivos del mismo rol se funden en uno.
    const collapsed: CopilotTurn[] = [];
    for (const turn of trimmed) {
        const last = collapsed[collapsed.length - 1];
        if (last && last.role === turn.role) {
            last.content = `${last.content}\n\n${turn.content}`.slice(0, MAX_TURN_CHARS);
        } else {
            collapsed.push({ ...turn });
        }
    }

    return collapsed;
}
